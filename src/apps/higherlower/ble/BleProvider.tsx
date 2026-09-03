import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../settings/SettingsProvider';
import { createTransport, makeRoomCode } from './index';
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
  /** Everyone but you has flipped their ready switch. */
  allReady: boolean;
  hostRoom(): Promise<RoomInfo>;
  scan(cb: (rooms: DiscoveredRoom[]) => void): Unsubscribe;
  joinRoom(room: DiscoveredRoom): Promise<void>;
  setReady(ready: boolean): void;
  leaveRoom(): Promise<void>;
  send(msg: Msg): void;
  onMessage(cb: (msg: Msg, fromId: string) => void): Unsubscribe;
}

const BleContext = createContext<BleContextValue | null>(null);

/**
 * Owns the link and the lobby roster for the whole app.
 *
 * Lobby bookkeeping (who is here, who is ready) lives here because it has to
 * survive navigating from Host/Join into the Lobby and on into the round.
 * Per-round traffic ('go' / 'g' / 'win') is left to the game screen, which
 * subscribes through `onMessage`.
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

  // The provider needs the current room when a 'hello' lands, but re-subscribing
  // on every room change would drop in-flight messages, so read it from a ref.
  const roomRef = useRef<RoomInfo | null>(null);
  const roleRef = useRef<BleRole>(null);
  useEffect(() => {
    roomRef.current = room;
    roleRef.current = role;
  }, [room, role]);

  useEffect(() => transport.onStateChange(setState), [transport]);

  useEffect(() => {
    const off = transport.onMessage((msg) => {
      if (msg.t === 'hello') {
        if (msg.id === transport.deviceId) return; // our own announcement
        setPeers((prev) => {
          if (prev.some((p) => p.id === msg.id)) return prev;
          // On the client side the host is the peer carrying the advertised
          // name -- the only identity the scan result gives us.
          const isHost = roleRef.current === 'client' && msg.nm === roomRef.current?.hostName;
          return [...prev, { id: msg.id, name: msg.nm, ready: false, isHost, isYou: false }];
        });
        return;
      }
      if (msg.t === 'bye') {
        setPeers((prev) => prev.filter((p) => p.id !== msg.id));
        return;
      }
      if (msg.t === 'rdy') {
        setPeers((prev) => prev.map((p) => (p.id === msg.id ? { ...p, ready: msg.r } : p)));
      }
    });
    return off;
  }, [transport]);

  useEffect(() => {
    return () => transport.destroy?.();
  }, [transport]);

  const hostRoom = useCallback(async () => {
    const info: RoomInfo = {
      id: `room-${Math.random().toString(36).slice(2, 8)}`,
      code: makeRoomCode(),
      hostName: playerName,
      range,
    };
    setRole('host');
    roleRef.current = 'host';
    setRoom(info);
    roomRef.current = info;
    setPeers([]);
    setYouReady(true); // the host is implicitly ready; they hold the start button
    await transport.startHosting(info);
    return info;
  }, [playerName, range, transport]);

  const scan = useCallback((cb: (rooms: DiscoveredRoom[]) => void) => transport.startScan(cb), [transport]);

  const joinRoom = useCallback(
    async (discovered: DiscoveredRoom) => {
      const info: RoomInfo = {
        id: discovered.id,
        code: discovered.code,
        hostName: discovered.hostName,
        range: discovered.range,
      };
      setRole('client');
      roleRef.current = 'client';
      setRoom(info);
      roomRef.current = info;
      setPeers([]);
      setYouReady(false);
      await transport.join(discovered.id, playerName);
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

  const leaveRoom = useCallback(async () => {
    void transport.send({ t: 'bye', id: transport.deviceId });
    await transport.leave();
    setRoom(null);
    setRole(null);
    setPeers([]);
    setYouReady(false);
  }, [transport]);

  const send = useCallback((msg: Msg) => void transport.send(msg), [transport]);
  const onMessage = useCallback((cb: (msg: Msg, from: string) => void) => transport.onMessage(cb), [transport]);

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

  const value = useMemo<BleContextValue>(
    () => ({
      transport,
      state,
      youId: transport.deviceId,
      room,
      role,
      players,
      allReady: players.filter((p) => !p.isYou).every((p) => p.ready),
      hostRoom,
      scan,
      joinRoom,
      setReady,
      leaveRoom,
      send,
      onMessage,
    }),
    [transport, state, room, role, players, hostRoom, scan, joinRoom, setReady, leaveRoom, send, onMessage],
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
