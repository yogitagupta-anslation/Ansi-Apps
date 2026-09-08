import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../settings/SettingsProvider';
import { createTransport, makeRoomCode } from './index';
import { DEFAULT_CAPACITY, MAX_CAPACITY, MIN_CAPACITY } from './constants';
import { Msg } from './protocol';
import { BleState, BleTransport, DiscoveredRoom, RoomInfo, Unsubscribe } from './transport';

export interface RoomPlayer {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
  isYou: boolean;
}

export type BleRole = 'host' | 'client' | null;

interface BleContextValue {
  transport: BleTransport;
  state: BleState;
  youId: string;
  room: RoomInfo | null;
  role: BleRole;
  players: RoomPlayer[];
  /** How many phones the host is letting in, including their own. */
  capacity: number;
  /** No seat left. The host stops taking joiners at this point. */
  full: boolean;
  /** Everyone but you has flipped their ready switch. */
  allReady: boolean;
  /** Radio trouble worth showing: permissions, a dropped link, a full room. */
  error: string | null;
  clearError(): void;
  hostRoom(capacity: number): Promise<RoomInfo>;
  setCapacity(capacity: number): void;
  scan(cb: (rooms: DiscoveredRoom[]) => void): Unsubscribe;
  joinRoom(room: DiscoveredRoom): Promise<void>;
  setReady(ready: boolean): void;
  /** Host: shut the door so a latecomer is not dropped into a live round. */
  setPlaying(playing: boolean): void;
  leaveRoom(): Promise<void>;
  send(msg: Msg, to?: string): void;
  onMessage(cb: (msg: Msg, fromId: string) => void): Unsubscribe;
}

const BleContext = createContext<BleContextValue | null>(null);

/**
 * Owns the link and the lobby roster for the whole app.
 *
 * Lobby bookkeeping (who is here, who is ready, how many may come) lives here
 * because it has to survive navigating from Host/Join into the Lobby and on
 * into the round. Per-round traffic ('go' / 'g' / 'fin') is left to the game
 * screen, which subscribes through `onMessage`.
 *
 * The roster is built entirely from messages, never from the transport's own
 * bookkeeping: a peer exists once it has said hello and stops existing when it
 * says goodbye or its link drops. That is what lets the same code drive a real
 * room and a simulated one.
 */
export function BleProvider({ children }: { children: React.ReactNode }) {
  const { playerName, range } = useSettings();
  const transportRef = useRef<BleTransport | null>(null);
  if (!transportRef.current) transportRef.current = createTransport();
  const transport = transportRef.current;

  const [state, setState] = useState<BleState>(transport.getState());
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [role, setRole] = useState<BleRole>(null);
  const [peers, setPeers] = useState<RoomPlayer[]>([]);
  const [youReady, setYouReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => transport.onStateChange(setState), [transport]);

  useEffect(() => {
    const withErrors = transport as BleTransport & {
      onError?: (cb: (message: string) => void) => Unsubscribe;
    };
    return withErrors.onError?.(setError);
  }, [transport]);

  useEffect(() => {
    const off = transport.onMessage((msg) => {
      switch (msg.t) {
        case 'hello': {
          if (msg.id === transport.deviceId) return; // our own announcement
          setPeers((prev) => {
            if (prev.some((p) => p.id === msg.id)) return prev;
            return [...prev, { id: msg.id, name: msg.nm, ready: false, isHost: msg.h === true, isYou: false }];
          });
          return;
        }

        case 'room':
          // The advertisement is only 31 bytes of preview. This is the host
          // telling us what the room actually is, so adopt it wholesale.
          setRoom((prev) =>
            prev
              ? {
                  ...prev,
                  code: msg.ct,
                  hostName: msg.hn,
                  capacity: msg.cap,
                  range: { min: msg.lo, max: msg.hi },
                }
              : prev,
          );
          return;

        case 'bye':
          setPeers((prev) => prev.filter((p) => p.id !== msg.id));
          return;

        case 'rdy':
          setPeers((prev) => prev.map((p) => (p.id === msg.id ? { ...p, ready: msg.r } : p)));
          return;

        default:
          return;
      }
    });
    return off;
  }, [transport]);

  useEffect(() => {
    return () => transport.destroy?.();
  }, [transport]);

  const hostRoom = useCallback(
    async (capacity: number) => {
      const info: RoomInfo = {
        id: `room-${Math.random().toString(36).slice(2, 8)}`,
        code: makeRoomCode(),
        hostName: playerName,
        range,
        capacity: Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, capacity)),
      };
      setError(null);
      setPeers([]);
      setYouReady(true); // the host is implicitly ready; they hold the start button
      await transport.startHosting(info);
      // Only claim the role once the radio has actually agreed to advertise --
      // a phone that cannot host should land back on the menu, not in an empty
      // lobby nobody can see.
      setRole('host');
      setRoom(info);
      return info;
    },
    [playerName, range, transport],
  );

  const setCapacity = useCallback(
    (capacity: number) => {
      const next = Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, capacity));
      setRoom((prev) => (prev ? { ...prev, capacity: next } : prev));
      void transport.setCapacity?.(next);
    },
    [transport],
  );

  const scan = useCallback((cb: (rooms: DiscoveredRoom[]) => void) => transport.startScan(cb), [transport]);

  const joinRoom = useCallback(
    async (discovered: DiscoveredRoom) => {
      const info: RoomInfo = {
        id: discovered.id,
        code: discovered.code,
        // A room hosted from an iPhone cannot advertise a name; the host sends
        // one in its 'room' message a moment after we are in.
        hostName: discovered.hostName ?? 'Host',
        range: discovered.range,
        capacity: discovered.capacity,
      };
      setError(null);
      setPeers([]);
      setYouReady(false);
      setRole('client');
      setRoom(info);
      try {
        await transport.join(discovered.id, playerName);
      } catch (err) {
        setRole(null);
        setRoom(null);
        throw err;
      }
    },
    [playerName, transport],
  );

  const setReady = useCallback(
    (ready: boolean) => {
      setYouReady(ready);
      void transport.send({ t: 'rdy', id: transport.deviceId, r: ready });
    },
    [transport],
  );

  const setPlaying = useCallback(
    (playing: boolean) => {
      transport.setPlaying?.(playing);
    },
    [transport],
  );

  const leaveRoom = useCallback(async () => {
    // Awaited on purpose: this is the difference between the others seeing
    // "Ava left" and seeing a link that mysteriously dropped. The transport
    // swallows a send to a peer that has already gone.
    await transport.send({ t: 'bye', id: transport.deviceId });
    await transport.leave();
    setRoom(null);
    setRole(null);
    setPeers([]);
    setYouReady(false);
  }, [transport]);

  const send = useCallback((msg: Msg, to?: string) => void transport.send(msg, to), [transport]);
  const onMessage = useCallback((cb: (msg: Msg, from: string) => void) => transport.onMessage(cb), [transport]);
  const clearError = useCallback(() => setError(null), []);

  const players = useMemo<RoomPlayer[]>(() => {
    const you: RoomPlayer = {
      id: transport.deviceId,
      name: playerName,
      ready: youReady,
      isHost: role === 'host',
      isYou: true,
    };
    // Host first, then you, then everyone else in arrival order.
    const host = peers.find((p) => p.isHost);
    const rest = peers.filter((p) => !p.isHost);
    return host ? [host, you, ...rest] : [you, ...rest];
  }, [peers, playerName, role, transport.deviceId, youReady]);

  const capacity = room?.capacity ?? DEFAULT_CAPACITY;

  const value = useMemo<BleContextValue>(
    () => ({
      transport,
      state,
      youId: transport.deviceId,
      room,
      role,
      players,
      capacity,
      full: players.length >= capacity,
      allReady: players.filter((p) => !p.isYou).every((p) => p.ready),
      error,
      clearError,
      hostRoom,
      setCapacity,
      scan,
      joinRoom,
      setReady,
      setPlaying,
      leaveRoom,
      send,
      onMessage,
    }),
    [
      transport,
      state,
      room,
      role,
      players,
      capacity,
      error,
      clearError,
      hostRoom,
      setCapacity,
      scan,
      joinRoom,
      setReady,
      setPlaying,
      leaveRoom,
      send,
      onMessage,
    ],
  );

  return <BleContext.Provider value={value}>{children}</BleContext.Provider>;
}

export function useBle(): BleContextValue {
  const ctx = useContext(BleContext);
  if (!ctx) throw new Error('useBle must be used inside <BleProvider>');
  return ctx;
}

/**
 * Copy for the status badge. Deliberately says nothing about MTUs, packets or
 * RSSI -- a player can act on "move closer", not on "-72 dBm".
 */
export function bleStatusLabel(state: BleState, peerCount: number): string {
  switch (state) {
    case 'off':
      return 'Starting Bluetooth…';
    case 'idle':
      return 'Bluetooth ready';
    case 'advertising':
      return 'Visible to nearby players';
    case 'scanning':
      return 'Looking for games…';
    case 'connected':
      return peerCount > 0 ? `Live · ${peerCount + 1} players` : 'Connected';
    default:
      return 'Bluetooth';
  }
}
