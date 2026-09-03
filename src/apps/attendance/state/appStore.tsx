/**
 * appStore.tsx
 * -----------------------------------------------------------------------------
 * The Application Services layer. Owns the managers and is the ONE place where
 * the BLE layer is wired to the attendance engine.
 *
 * THREE KINDS OF STATE, KEPT SEPARATE ON PURPOSE (see spec §23)
 *
 *   PERSISTENT   settings, employees, attendance, scanningEnabled
 *                -> survives restart, lives in storage
 *
 *   REAL BLE     scan.scanning, bluetooth state, detected peers, RSSI
 *                -> comes from the radio, never written to storage,
 *                   never assumed
 *
 *   UI           which tab, which modal
 *                -> component-local, not here
 *
 * THE RULE THAT MATTERS MOST
 *
 *   `settings.scanningEnabled` is a PREFERENCE ("the user wants scanning on").
 *   `scan.scanning` is the FACT ("the radio is actually scanning").
 *
 *   They are deliberately two different values and are never conflated. When
 *   the preference is on but the scanner is not running, the app says so and
 *   offers a Resume action - it never paints the UI green and hopes.
 * -----------------------------------------------------------------------------
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { AttendanceManager } from '../attendance/AttendanceManager';
import {
  deriveStatus,
  type AttendanceRecord,
  type AttendanceRow,
  type TodaySummary,
} from '../attendance/attendanceTypes';
import {
  getAdvertiserState,
  subscribeToAdvertiserState,
  type AdvertiserState,
} from '../bluetooth/BleAdvertiser';
import { checkReadiness, observeBluetoothState, type Readiness } from '../bluetooth/BleManager';
import {
  getScanSnapshot,
  stopScan as bleStopScan,
  subscribeToScan,
  setAttendanceMarkedToday,
  type ScanSnapshot,
} from '../bluetooth/BleScanner';
import { hasScanPermissions } from '../bluetooth/permissions';
import * as RoleService from '../role/RoleService';
import { HostAttendanceService } from '../services/HostAttendanceService';
import { EmployeePresenceService } from '../services/EmployeePresenceService';
import {
  DEFAULT_HOST_ID,
  DEFAULT_HOST_NAME,
  generateHostId,
  SETTINGS_KEYS,
  todayDateString,
  type AppRole,
} from '../constants/appConfig';
import {
  DEFAULT_PROXIMITY_CONFIG,
  type ProximityConfig,
} from '../constants/proximityConfig';
import { EmployeeStatusStore, type StoredDay } from '../attendance/EmployeeStatusStore';
import type { StatusReport } from '../bluetooth/statusReport';
import { EmployeeManager } from '../employees/EmployeeManager';
import type { Employee } from '../employees/employeeTypes';
import { SettingsStorage } from '../storage/SettingsStorage';
import type { ThemePreference } from '../theme/ThemeContext';
import { log } from '../utils/logger';

/* =============================================================================
 * SETTINGS
 * ========================================================================== */

export interface AppSettings {
  role: AppRole | null;
  themePreference: ThemePreference;
  verboseLogging: boolean;

  hostId: string;
  hostName: string;

  employeeId: string;
  employeeName: string;
  /**
   * The employee's own profile, shown on this device's Profile screen.
   * Local metadata only: none of it is ever broadcast — the advertisement
   * carries employeeId and nothing else.
   */
  employeeDepartment: string;
  employeePhone: string;
  employeeEmail: string;
  /** Base64 data URI, or '' when unset. Never broadcast. */
  employeePhoto: string;

  /**
   * The user's SCANNING PREFERENCE, not the scanner's state.
   * See the header note - these are never conflated.
   */
  scanningEnabled: boolean;
  /** Employee-side equivalent. */
  advertisingEnabled: boolean;

  proximity: ProximityConfig;
}

const defaultSettings: AppSettings = {
  role: null,
  themePreference: 'dark',
  verboseLogging: false,
  hostId: DEFAULT_HOST_ID,
  hostName: DEFAULT_HOST_NAME,
  employeeId: '',
  employeeName: '',
  employeeDepartment: '',
  employeePhone: '',
  employeeEmail: '',
  employeePhoto: '',
  scanningEnabled: false,
  advertisingEnabled: false,
  proximity: DEFAULT_PROXIMITY_CONFIG,
};

/** Why an auto-resume could not happen. Drives the Resume banner's wording. */
export type ResumeBlockedReason =
  | 'BLUETOOTH_OFF'
  | 'PERMISSIONS_MISSING'
  | 'NOT_SUPPORTED'
  | 'FAILED';

/**
 * How healthy the scanner actually is — as distinct from whether we called
 * startScan().
 *
 * WHY THIS EXISTS
 * Several Android scan failures are completely SILENT: the app is throttled
 * (more than ~5 startScan calls in a rolling 30s window), the scan is
 * downgraded to opportunistic mode, or it is suspended while the screen is
 * off. In every one of those, startScan() returns without error, no error
 * callback fires, and zero advertisements ever arrive.
 *
 * So "we called startScan and it did not throw" is NOT evidence that scanning
 * works. The only real evidence is advertisements arriving. This type lets the
 * UI distinguish the two rather than showing a green light over a dead radio.
 */
export type ScanHealth =
  /** Not scanning at all. */
  | 'STOPPED'
  /** Started very recently — too early to judge. */
  | 'STARTING'
  /** Started, but nothing has been received yet. Could be an empty room, or a silent failure. */
  | 'NO_ADVERTISEMENTS'
  /** Advertisements are genuinely arriving. */
  | 'RECEIVING';

/** Grace before "no advertisements yet" is worth mentioning. */
const SCAN_WARMUP_MS = 8000;

/* =============================================================================
 * CONTEXT
 * ========================================================================== */

interface AppStoreValue {
  ready: boolean;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  updateProximity: (patch: Partial<ProximityConfig>) => Promise<void>;
  /**
   * Choose the role at FIRST INSTALL. There is no production path to change it
   * afterwards - see resetDeviceSetup for the developer-only escape hatch.
   */
  setInitialRole: (role: AppRole) => Promise<void>;
  /** DEVELOPER ONLY: clear the role so first-run setup appears again. */
  resetDeviceSetup: () => Promise<void>;

  employees: Employee[];
  employeeManager: EmployeeManager;
  attendanceManager: AttendanceManager;

  /** REAL scanner state, straight from the BLE layer. */
  scan: ScanSnapshot;
  /** REAL advertiser state. */
  advertiser: AdvertiserState;
  readiness: Readiness | null;

  /**
   * True when the user wants scanning on but the radio is NOT scanning.
   * The UI must show a Resume prompt rather than claiming to be active.
   */
  scanResumePending: boolean;
  resumeBlockedReason: ResumeBlockedReason | null;
  /** Evidence-based scanner health — see the ScanHealth doc comment. */
  scanHealth: ScanHealth;
  /**
   * Employee wants to be broadcasting, but the advertiser is not confirmed
   * ACTIVE. The UI shows a Resume prompt with the real reason.
   */
  advertisingResumePending: boolean;

  /** Today's Host-delivered status report (EMPLOYEE role), or null. */
  employeeStatusReport: StatusReport | null;
  /** Past days a Host has delivered to this phone, newest first. */
  employeeHistory: StoredDay[];
  /** When a Host last wrote to this phone. null = never synced. */
  employeeLastSyncedAt: number | null;

  todayRecords: AttendanceRecord[];
  todaySummary: TodaySummary;
  attendanceRows: AttendanceRow[];

  startScanning: () => Promise<boolean>;
  stopScanning: () => Promise<void>;
  startAdvertising: () => Promise<{ success: boolean; error: string | null }>;
  stopAdvertising: () => Promise<void>;

  refreshReadiness: () => Promise<void>;
  /** Re-check readiness and resume any radio the stored preference wants on. */
  reconcileRadioState: () => Promise<void>;
  refreshEmployees: () => Promise<void>;
  clearAttendanceHistory: () => Promise<void>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scan, setScan] = useState<ScanSnapshot>(getScanSnapshot());
  const [advertiser, setAdvertiser] = useState<AdvertiserState>(getAdvertiserState());
  /**
   * Today's attendance status AS DELIVERED BY A HOST over the BLE reply
   * channel. Null until a report genuinely arrives — the UI shows dashes,
   * never a locally invented status.
   */
  const [employeeStatusReport, setEmployeeStatusReport] = useState<StatusReport | null>(null);
  /** Days a Host has delivered to this phone, newest first. EMPLOYEE role. */
  const [employeeHistory, setEmployeeHistory] = useState<StoredDay[]>([]);
  const [employeeLastSyncedAt, setEmployeeLastSyncedAt] = useState<number | null>(null);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [resumeBlockedReason, setResumeBlockedReason] =
    useState<ResumeBlockedReason | null>(null);


  /**
   * Live radio state as refs. The Bluetooth-adapter listener below is mounted
   * once, so reading these through state would capture the values from mount
   * time and reconcile against a world that no longer exists.
   */
  const scanRef = useRef(scan);
  scanRef.current = scan;
  const advertiserRef = useRef(advertiser);
  advertiserRef.current = advertiser;
  /** Prevents overlapping reconciles when adapter events arrive in bursts. */
  const reconcilingRef = useRef(false);

  /** Ticks purely to re-render time-derived status (PRESENT -> LEFT). */
  const [, setClock] = useState(0);

  const employeeManager = useMemo(() => new EmployeeManager(), []);
  const attendanceManager = useMemo(
    () =>
      new AttendanceManager({
        hostId: defaultSettings.hostId,
        proximity: defaultSettings.proximity,
      }),
    [],
  );

  /**
   * Settings mirrored into a ref: the BLE scan callback runs outside React's
   * render cycle and must read current values, not a stale closure.
   */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ------------------------------------------------------------ bootstrap -- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Load the role before anything else: the BLE guards read it
      // synchronously, so it must be populated before any BLE work can start.
      await RoleService.loadRole();

      const stored = await SettingsStorage.getAll();

      const num = (key: string, fallback: number) => {
        const raw = stored[key];
        const parsed = raw === undefined ? NaN : Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
      };

      const loaded: AppSettings = {
        role: (stored[SETTINGS_KEYS.role] as AppRole | undefined) ?? null,
        themePreference:
          (stored[SETTINGS_KEYS.theme] as ThemePreference | undefined) ?? 'dark',
        verboseLogging: stored[SETTINGS_KEYS.verboseLogging] === 'true',
        hostId: stored[SETTINGS_KEYS.hostId] || DEFAULT_HOST_ID,
        hostName: stored[SETTINGS_KEYS.hostName] || DEFAULT_HOST_NAME,
        employeeId: stored[SETTINGS_KEYS.employeeId] || '',
        employeeName: stored[SETTINGS_KEYS.employeeName] || '',
        employeeDepartment: stored[SETTINGS_KEYS.employeeDepartment] || '',
        employeePhone: stored[SETTINGS_KEYS.employeePhone] || '',
        employeeEmail: stored[SETTINGS_KEYS.employeeEmail] || '',
        employeePhoto: stored[SETTINGS_KEYS.employeePhoto] || '',
        scanningEnabled: stored[SETTINGS_KEYS.scanningEnabled] === 'true',
        advertisingEnabled: stored[SETTINGS_KEYS.advertisingEnabled] === 'true',
        proximity: {
          minimumRssi: num(SETTINGS_KEYS.rssiThreshold, DEFAULT_PROXIMITY_CONFIG.minimumRssi),
          requiredConsecutiveDetections: num(
            SETTINGS_KEYS.requiredNearbyReadings,
            DEFAULT_PROXIMITY_CONFIG.requiredConsecutiveDetections,
          ),
          detectionWindowMs: num(
            SETTINGS_KEYS.detectionTimeoutMs,
            DEFAULT_PROXIMITY_CONFIG.detectionWindowMs,
          ),
          missingGracePeriodMs: num(
            SETTINGS_KEYS.missingGracePeriodMs,
            DEFAULT_PROXIMITY_CONFIG.missingGracePeriodMs,
          ),
          leftEvaluationIntervalMs: DEFAULT_PROXIMITY_CONFIG.leftEvaluationIntervalMs,
        },
      };

      if (cancelled) {
        return;
      }

      setSettings(loaded);
      settingsRef.current = loaded;

      attendanceManager.updateConfig({
        hostId: loaded.hostId,
        proximity: loaded.proximity,
      });

      await employeeManager.initialize();
      await attendanceManager.initialize();

      // Restored records may already be past their grace period if the app was
      // closed for a while, so settle LEFT before the first paint.
      await attendanceManager.evaluateLeftStatuses();

      // Load any status report a Host delivered in a previous session, so an
      // employee reopening the app still sees their recorded check-in.
      await EmployeeStatusStore.initialize();

      const current = await checkReadiness(loaded.role ?? 'HOST');
      if (cancelled) {
        return;
      }
      setReadiness(current);
      setReady(true);

      // --- honest auto-resume -------------------------------------------
      // A persisted preference is NOT a claim that the radio is running. Each
      // branch attempts a REAL restart and lets the resulting state speak for
      // itself; neither pretends on the strength of a stored boolean.
      if (loaded.role === 'HOST' && loaded.scanningEnabled) {
        log.info('SCAN', 'scanningEnabled was saved as true - attempting real resume');
        await attemptResume(loaded);
      }

      if (loaded.role === 'EMPLOYEE' && loaded.advertisingEnabled) {
        log.info(
          'ADVERTISE',
          'advertisingEnabled was saved as true - attempting real restart of the advertiser',
        );
        // Goes through the same path as a user tap: pre-flight checks, then a
        // real native start. The advertiser state machine reports the outcome,
        // so if it cannot start the UI shows the actual reason.
        const result = await EmployeePresenceService.startBroadcasting(loaded.employeeId);
        if (!result.success) {
          log.warn('ADVERTISE', 'Could not restore advertising: ' + (result.error ?? 'unknown'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------------------------- resume -- */

  /**
   * Try to genuinely restart the scanner.
   *
   * Returns true ONLY if the radio actually started. Every failure path sets a
   * reason so the UI can explain what to fix, and NEVER pretends to scan.
   */
  const attemptResume = useCallback(
    async (withSettings: AppSettings): Promise<boolean> => {
      // The native BLE stack is not necessarily up yet at cold start -
      // ble-plx reports 'Unknown' for a moment. Starting a scan against an
      // uninitialised adapter fails silently, so settle the state first
      // rather than racing it.
      let current = await checkReadiness('HOST');
      if (current.bluetooth.state === 'Unknown') {
        await new Promise<void>(resolve => {
          setTimeout(resolve, 700);
        });
        current = await checkReadiness('HOST');
      }
      setReadiness(current);

      if (!current.bluetooth.ready) {
        setResumeBlockedReason('BLUETOOTH_OFF');
        log.warn('SCAN', 'Cannot resume: Bluetooth is not ready');
        return false;
      }

      // Permissions can be revoked between sessions - Android also auto-resets
      // them for unused apps. Re-check rather than trusting last run.
      const granted = await hasScanPermissions();
      if (!granted) {
        setResumeBlockedReason('PERMISSIONS_MISSING');
        log.warn('SCAN', 'Cannot resume: scan permissions not granted');
        return false;
      }

      if (current.blockers.some(b => !b.fixable)) {
        setResumeBlockedReason('NOT_SUPPORTED');
        return false;
      }

      const result = startScannerNow(withSettings);
      if (!result) {
        setResumeBlockedReason('FAILED');
        return false;
      }

      setResumeBlockedReason(null);
      log.info('SCAN', 'Scanner resumed automatically');
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * THE WIRE: a registered employee's advertisement reaches the attendance
   * engine, which enforces every rule about what may become a check-in.
   */
  const startScannerNow = useCallback((withSettings: AppSettings): boolean => {
    // Goes through the Host service, which asserts the role before touching
    // the radio. The store never calls BleScanner directly.
    const result = HostAttendanceService.startScanning({
      proximity: withSettings.proximity,
      verboseLogging: withSettings.verboseLogging,
      employeeManager,
      attendanceManager,
      hostId: withSettings.hostId,
    });
    if (!result.success && result.error) {
      log.error('SCAN', result.error);
    }
    return result.success;
  }, [employeeManager, attendanceManager]);

  /* ----------------------------------------------------------- subscribe -- */

  useEffect(() => employeeManager.subscribe(setEmployees), [employeeManager]);
  useEffect(() => attendanceManager.subscribe(setTodayRecords), [attendanceManager]);
  useEffect(() => subscribeToScan(setScan), []);
  useEffect(() => subscribeToAdvertiserState(setAdvertiser), []);
  useEffect(() => EmployeeStatusStore.subscribe(setEmployeeStatusReport), []);
  useEffect(
    () =>
      EmployeeStatusStore.subscribeHistory(() => {
        setEmployeeHistory(EmployeeStatusStore.getHistory());
        setEmployeeLastSyncedAt(EmployeeStatusStore.getLastSyncedAt());
      }),
    [],
  );

  useEffect(() => {
    setAttendanceMarkedToday(todayRecords.filter(r => r.checkInTime !== null).length);
  }, [todayRecords]);

  /**
   * Periodically recompute PRESENT -> LEFT and re-render time-derived labels.
   *
   * This is a re-evaluation cadence, not a countdown: the verdict is always
   * `now - lastSeenTime > grace`, so a missed or late tick cannot corrupt it.
   */
  useEffect(() => {
    const interval = settings.proximity.leftEvaluationIntervalMs;
    const timer = setInterval(() => {
      void attendanceManager.evaluateLeftStatuses();
      setClock(c => c + 1);
    }, interval);
    return () => clearInterval(timer);
  }, [attendanceManager, settings.proximity.leftEvaluationIntervalMs]);

  /* ----------------------------------------------------------- lifecycle -- */

  const refreshReadiness = useCallback(async () => {
    const role = settingsRef.current.role ?? 'HOST';
    setReadiness(await checkReadiness(role));
  }, []);

  /**
   * Reconcile the persisted radio INTENT with what the radio is actually doing.
   *
   * Runs when Bluetooth comes on (from the enable dialog, the quick-settings
   * tile, anywhere) and when the app returns to foreground. Each branch first
   * checks the live state through a ref, so a radio that is already running is
   * never started twice — Android treats a duplicate scan as a new client and
   * a duplicate advertise as a second slot, and both leak.
   *
   * This only ever RESUMES a stored preference. It never turns a radio on that
   * the user did not ask for.
   */
  const reconcileRadioState = useCallback(async () => {
    if (reconcilingRef.current) {
      return;
    }
    reconcilingRef.current = true;
    try {
      const current = settingsRef.current;
      await refreshReadiness();

      if (current.role === 'HOST' && current.scanningEnabled && !scanRef.current.scanning) {
        log.info('SCAN', 'Reconcile: preference is ON but scanner idle - attempting resume');
        await attemptResume(current);
      }

      if (
        current.role === 'EMPLOYEE' &&
        current.advertisingEnabled &&
        advertiserRef.current.state !== 'ACTIVE' &&
        advertiserRef.current.state !== 'STARTING'
      ) {
        log.info('ADVERTISE', 'Reconcile: preference is ON but not on air - attempting restart');
        const result = await EmployeePresenceService.startBroadcasting(current.employeeId);
        if (!result.success) {
          log.warn('ADVERTISE', 'Reconcile could not restart advertising: ' + (result.error ?? 'unknown'));
        }
      }
    } finally {
      reconcilingRef.current = false;
    }
  }, [refreshReadiness, attemptResume]);

  /**
   * React to the Bluetooth adapter itself. This is what makes "turn on
   * Bluetooth -> scanning resumes by itself" work without the user having to
   * come back and press Resume again.
   */
  useEffect(() => {
    let lastReady: boolean | null = null;
    const unsubscribe = observeBluetoothState(status => {
      const wasReady = lastReady;
      lastReady = status.ready;

      // First emission is the mount-time snapshot; startup resume owns that.
      if (wasReady === null) {
        return;
      }

      if (status.ready && !wasReady) {
        // OFF -> ON: recover whatever the user had running.
        void reconcileRadioState();
      } else if (!status.ready && wasReady) {
        // ON -> OFF: reflect reality immediately and name the blocker, so the
        // UI says "Bluetooth is off" rather than a generic failure.
        void refreshReadiness();
        const current = settingsRef.current;
        if (current.role === 'HOST' && current.scanningEnabled) {
          setResumeBlockedReason('BLUETOOTH_OFF');
        }
      }
    });
    return unsubscribe;
  }, [reconcileRadioState, refreshReadiness]);

  /**
   * On foreground: re-check everything rather than assuming it survived.
   * Bluetooth may have been switched off, permissions revoked, and the grace
   * period may have elapsed while we were away.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        return;
      }
      void (async () => {
        // Reconcile includes a readiness refresh, then recovers the radios if
        // the persisted preference says they should be running.
        await reconcileRadioState();
        await attendanceManager.evaluateLeftStatuses();
        setClock(c => c + 1);
      })();
    });
    return () => sub.remove();
  }, [reconcileRadioState, attendanceManager]);

  /**
   * Flush pending attendance records on the way out.
   *
   * This effect used to also stop scanning, stop advertising and destroy the BLE
   * manager. That was correct when this was a standalone app, because the only
   * thing that unmounted this provider was the process ending.
   *
   * Inside the hub it is not: this now unmounts every time the user presses Back
   * to the launcher, and a hub exit is far closer to backgrounding than to
   * quitting. Stopping the radios here meant an employee who checked in and then
   * browsed the hub silently stopped being visible to the host — which is exactly
   * what the foreground service (and `android:stopWithTask="false"`) exist to
   * prevent. BLE Chat reached the same conclusion for the same reason and also
   * leaves its stack running on the way out.
   *
   * Both radios stay under the user's own control: `scanningEnabled` and
   * `advertisingEnabled` are persisted preferences with switches in the app's own
   * UI, and the mount effect above already performs a real, honest resume from
   * them. Leaving the radios up simply makes that resume a no-op instead of a
   * restart. The OS reclaims them when the process ends.
   *
   * The flush is kept, and must be: records held in memory but not yet written
   * would otherwise be lost on the way back to the hub.
   */
  useEffect(
    () => () => {
      attendanceManager.dispose();
    },
    [attendanceManager],
  );

  /* ------------------------------------------------------------ settings -- */

  const persist = useCallback(async (entries: Record<string, string>) => {
    await SettingsStorage.setMany(entries);
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      setSettings(next);
      settingsRef.current = next;

      const entries: Record<string, string> = {};
      if (patch.role !== undefined && patch.role !== null) entries[SETTINGS_KEYS.role] = patch.role;
      if (patch.themePreference !== undefined) entries[SETTINGS_KEYS.theme] = patch.themePreference;
      if (patch.verboseLogging !== undefined) entries[SETTINGS_KEYS.verboseLogging] = String(patch.verboseLogging);
      if (patch.hostId !== undefined) entries[SETTINGS_KEYS.hostId] = patch.hostId;
      if (patch.hostName !== undefined) entries[SETTINGS_KEYS.hostName] = patch.hostName;
      if (patch.employeeId !== undefined) entries[SETTINGS_KEYS.employeeId] = patch.employeeId;
      if (patch.employeeName !== undefined) entries[SETTINGS_KEYS.employeeName] = patch.employeeName;
      if (patch.employeeDepartment !== undefined) entries[SETTINGS_KEYS.employeeDepartment] = patch.employeeDepartment;
      if (patch.employeePhone !== undefined) entries[SETTINGS_KEYS.employeePhone] = patch.employeePhone;
      if (patch.employeeEmail !== undefined) entries[SETTINGS_KEYS.employeeEmail] = patch.employeeEmail;
      if (patch.employeePhoto !== undefined) entries[SETTINGS_KEYS.employeePhoto] = patch.employeePhoto;
      if (patch.scanningEnabled !== undefined) entries[SETTINGS_KEYS.scanningEnabled] = String(patch.scanningEnabled);
      if (patch.advertisingEnabled !== undefined) entries[SETTINGS_KEYS.advertisingEnabled] = String(patch.advertisingEnabled);

      if (Object.keys(entries).length > 0) {
        await persist(entries);
      }

      attendanceManager.updateConfig({ hostId: next.hostId, proximity: next.proximity });
    },
    [persist, attendanceManager],
  );

  /** Proximity changes take effect on the NEXT advertisement, not on restart. */
  const updateProximity = useCallback(
    async (patch: Partial<ProximityConfig>) => {
      const proximity = { ...settingsRef.current.proximity, ...patch };
      const next = { ...settingsRef.current, proximity };
      setSettings(next);
      settingsRef.current = next;

      await persist({
        [SETTINGS_KEYS.rssiThreshold]: String(proximity.minimumRssi),
        [SETTINGS_KEYS.requiredNearbyReadings]: String(proximity.requiredConsecutiveDetections),
        [SETTINGS_KEYS.detectionTimeoutMs]: String(proximity.detectionWindowMs),
        [SETTINGS_KEYS.missingGracePeriodMs]: String(proximity.missingGracePeriodMs),
      });

      attendanceManager.updateConfig({ proximity });
      // Push the live values into the running scanner too.
      void attendanceManager.evaluateLeftStatuses();
      setClock(c => c + 1);
    },
    [persist, attendanceManager],
  );

  /* ----------------------------------------------------------------- BLE -- */

  const startScanning = useCallback(async (): Promise<boolean> => {
    const started = startScannerNow(settingsRef.current);
    // The preference is saved either way: the user asked for scanning on.
    await updateSettings({ scanningEnabled: true });
    setResumeBlockedReason(started ? null : 'FAILED');
    return started;
  }, [startScannerNow, updateSettings]);

  const stopScanning = useCallback(async () => {
    bleStopScan();
    await updateSettings({ scanningEnabled: false });
    setResumeBlockedReason(null);
  }, [updateSettings]);

  const startAdvertising = useCallback(async () => {
    const result = await EmployeePresenceService.startBroadcasting(
      settingsRef.current.employeeId,
    );
    if (result.success) {
      await updateSettings({ advertisingEnabled: true });
    }
    return result;
  }, [updateSettings]);

  const stopAdvertising = useCallback(async () => {
    await EmployeePresenceService.stopBroadcasting();
    await updateSettings({ advertisingEnabled: false });
  }, [updateSettings]);

  /* ------------------------------------------------------------ role -- */

  /**
   * Switch this device between Host and Employee.
   *
   * Order matters: both radios are released and role-specific runtime state is
   * cleared BEFORE the new role is written, so nothing can keep running under
   * the old role's permissions. Attendance history and the employee registry
   * are deliberately preserved - changing what this device does should not
   * destroy a record of who attended.
   */
  const setInitialRole = useCallback(
    async (nextRole: AppRole) => {
      const previous = settingsRef.current.role;
      if (previous === nextRole) {
        return;
      }

      log.warn('BLE', 'Changing device role: ' + (previous ?? 'none') + ' -> ' + nextRole);

      // 1. Stop whichever radio is running. Both are safe to call blindly.
      HostAttendanceService.teardown();
      await EmployeePresenceService.teardown();

      // 2. Clear role-specific PREFERENCES so the new role does not inherit
      //    "scanning was on" from the old one.
      await updateSettings({ scanningEnabled: false, advertisingEnabled: false });
      setResumeBlockedReason(null);

      // 3. Commit the role. RoleService updates its synchronous cache in the
      //    same step, so the BLE guards see the new value immediately.
      await RoleService.setRole(nextRole);

      // Mint a stable per-installation Host ID the first time this device
      // becomes a Host. Stamped onto every attendance record so records from
      // different Hosts stay distinguishable.
      const patch: Partial<AppSettings> = { role: nextRole };
      if (nextRole === 'HOST' && settingsRef.current.hostId === DEFAULT_HOST_ID) {
        patch.hostId = generateHostId();
        log.info('BLE', 'Generated Host ID: ' + patch.hostId);
      }
      await updateSettings(patch);

      // 4. Re-evaluate readiness: the two roles need different permissions.
      setReadiness(await checkReadiness(nextRole));
    },
    [updateSettings],
  );

  /**
   * DEVELOPER ONLY — clear the role so first-run setup appears again.
   *
   * Never reachable from a release build: the only caller is gated on __DEV__.
   * Attendance history and the employee registry are deliberately preserved -
   * this resets device SETUP, not the data.
   */
  const resetDeviceSetup = useCallback(async () => {
    log.warn('BLE', 'DEV: resetting device setup (role cleared)');
    HostAttendanceService.teardown();
    await EmployeePresenceService.teardown();
    await updateSettings({ scanningEnabled: false, advertisingEnabled: false });
    await RoleService.clearRole();
    // Drives the navigator back to the role gate.
    setSettings(prev => ({ ...prev, role: null }));
    settingsRef.current = { ...settingsRef.current, role: null };
  }, [updateSettings]);

  /* -------------------------------------------------------------- derived -- */

  const now = Date.now();
  const grace = settings.proximity.missingGracePeriodMs;

  const enabledEmployees = useMemo(() => employees.filter(e => e.enabled), [employees]);

  const todaySummary = useMemo<TodaySummary>(
    () => attendanceManager.buildTodaySummary(enabledEmployees.length, now),
    // `todayRecords` and the clock tick are what make this recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attendanceManager, enabledEmployees.length, todayRecords, now],
  );

  /**
   * Join registry + today's attendance + live proximity.
   *
   * `status` (persistent, derived from timestamps) and `currentlyNearby`
   * (transient, from the scanner) are independent. PRESENT while not currently
   * nearby is normal: the advertisement was missed this instant and the grace
   * period has not elapsed.
   */
  const attendanceRows = useMemo<AttendanceRow[]>(() => {
    const recordByEmployee = new Map(todayRecords.map(r => [r.employeeId, r]));
    const detectedById = new Map(scan.detected.map(d => [d.employeeId, d]));

    const statusRank = { PRESENT: 0, LEFT: 1, ABSENT: 2 } as const;

    return enabledEmployees
      .map(employee => {
        const record = recordByEmployee.get(employee.employeeId) ?? null;
        const detection = detectedById.get(employee.employeeId);
        return {
          employeeId: employee.employeeId,
          employeeName: employee.displayName,
          record,
          status: deriveStatus(record, now, grace),
          currentlyNearby: !!detection,
          currentRssi: detection ? detection.smoothedRssi : null,
        };
      })
      .sort((a, b) => {
        const byStatus = statusRank[a.status] - statusRank[b.status];
        return byStatus !== 0 ? byStatus : a.employeeName.localeCompare(b.employeeName);
      });
  }, [enabledEmployees, todayRecords, scan.detected, now, grace]);

  /**
   * Preference says on, radio says off. The UI shows a Resume prompt - it does
   * NOT render "System active".
   */
  const scanResumePending = settings.scanningEnabled && !scan.scanning;

  /**
   * Employee equivalent: the preference says broadcast, but the radio is not
   * confirmed on air. Drives a Resume prompt rather than a false green light.
   *
   * Note this compares against `advertiser.state === 'ACTIVE'` specifically -
   * STARTING is not good enough, because Android has not confirmed yet.
   */
  const advertisingResumePending =
    settings.advertisingEnabled && advertiser.state !== 'ACTIVE' && advertiser.state !== 'STARTING';

  /**
   * Health from EVIDENCE (advertisements arriving), not from intent.
   *
   * Note NO_ADVERTISEMENTS is not automatically a fault: with an OS-level
   * service-UUID filter, an empty room legitimately produces zero results. It
   * is surfaced as information, not as an error, so the user can tell the
   * difference between "nobody here" and "radio wedged" using the Debug tab.
   */
  const scanHealth: ScanHealth = !scan.scanning
    ? 'STOPPED'
    : scan.statistics.advertisementsReceived > 0
    ? 'RECEIVING'
    : scan.startedAt !== null && now - scan.startedAt < SCAN_WARMUP_MS
    ? 'STARTING'
    : 'NO_ADVERTISEMENTS';

  const refreshEmployees = useCallback(async () => {
    await employeeManager.initialize();
  }, [employeeManager]);

  const clearAttendanceHistory = useCallback(async () => {
    await attendanceManager.clearAllAttendance();
  }, [attendanceManager]);

  const value = useMemo<AppStoreValue>(
    () => ({
      ready, settings, updateSettings, updateProximity, setInitialRole, resetDeviceSetup,
      employees, employeeManager, attendanceManager,
      scan, advertiser, readiness,
      scanResumePending, resumeBlockedReason, scanHealth, advertisingResumePending,
      employeeStatusReport, employeeHistory, employeeLastSyncedAt,
      todayRecords, todaySummary, attendanceRows,
      startScanning, stopScanning, startAdvertising, stopAdvertising,
      refreshReadiness, reconcileRadioState, refreshEmployees, clearAttendanceHistory,
    }),
    [
      ready, settings, updateSettings, updateProximity, setInitialRole, resetDeviceSetup,
      employees, employeeManager, attendanceManager,
      scan, advertiser, readiness,
      scanResumePending, resumeBlockedReason, scanHealth, advertisingResumePending,
      employeeStatusReport, employeeHistory, employeeLastSyncedAt,
      todayRecords, todaySummary, attendanceRows,
      startScanning, stopScanning, startAdvertising, stopAdvertising,
      refreshReadiness, reconcileRadioState, refreshEmployees, clearAttendanceHistory,
    ],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) {
    throw new Error('useAppStore must be used inside an AppStoreProvider');
  }
  return ctx;
}

/** Today's date key, re-exported so screens do not reach into constants. */
export { todayDateString };
