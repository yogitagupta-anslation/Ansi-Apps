/**
 * ApiClient — the network seam.
 *
 * The backend handles identity, event configuration, the attendee directory
 * and connections. It is explicitly *not* in the presence path: raw BLE
 * telemetry never leaves the device (§40). Sending every RSSI sample to a
 * server would be both wasteful and a surveillance feature nobody asked for.
 *
 * Everything here is failure-tolerant by construction. Each call is wrapped so
 * a timeout or a dead hotspot surfaces as a typed `ApiError` the caller can
 * queue around, rather than an exception that takes the map down.
 */

import type {
  Connection,
  ConnectionState,
  EventDetail,
  EventId,
  EventSummary,
  PeopleFilter,
  Profile,
  ProfileId,
  Visibility,
} from '../types';
import type { DirectoryEntry } from '../event/AttendeeDirectory';
import type { PeerIdWindow } from '../bluetooth/BleIdentity';

export type ApiErrorCode =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'server'
  | 'unknown';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  /** True when retrying later is sensible — drives the offline outbox. */
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = code === 'network' || code === 'timeout' || code === 'server';
  }
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  cursor: string | null;
  hasMore: boolean;
  syncedAt: number;
}

export interface JoinEventResult {
  event: EventDetail;
  membership: {
    eventId: EventId;
    visibility: Visibility;
    joinedAt: number;
  };
}

export interface EventPulseApi {
  listEvents(query?: string): Promise<EventSummary[]>;
  getEvent(eventId: EventId): Promise<EventDetail>;
  joinEvent(eventId: EventId, visibility: Visibility): Promise<JoinEventResult>;
  leaveEvent(eventId: EventId): Promise<void>;

  /** Incremental directory sync. `since` is the cursor from the previous page. */
  getDirectory(eventId: EventId, since?: string | null): Promise<DirectoryPage>;
  /** Fetch specific profiles whose advertised version outran our cache. */
  getProfiles(eventId: EventId, profileIds: ProfileId[]): Promise<DirectoryEntry[]>;

  /** Publish the peer ids we will broadcast, so other attendees can resolve us. */
  publishPeerSchedule(eventId: EventId, windows: PeerIdWindow[]): Promise<void>;

  updateProfile(profile: Profile): Promise<Profile>;
  updateEventProfile(
    eventId: EventId,
    patch: { availability?: string; lookingToMeet?: string[]; whyAttending?: string; currentProject?: string },
  ): Promise<void>;
  updateVisibility(eventId: EventId, visibility: Visibility): Promise<void>;

  listConnections(eventId: EventId): Promise<Connection[]>;
  requestConnection(eventId: EventId, profileId: ProfileId, note?: string): Promise<Connection>;
  respondToConnection(connectionId: string, accept: boolean): Promise<Connection>;

  blockUser(profileId: ProfileId): Promise<void>;
  unblockUser(profileId: ProfileId): Promise<void>;
  reportUser(profileId: ProfileId, reason: string, details?: string): Promise<void>;

  searchAttendees(eventId: EventId, filter: PeopleFilter): Promise<DirectoryEntry[]>;
}

export interface HttpApiOptions {
  baseUrl: string;
  getAuthToken: () => string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpApiClient implements EventPulseApi {
  private readonly baseUrl: string;
  private readonly getAuthToken: () => string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getAuthToken = options.getAuthToken;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const token = this.getAuthToken();

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) throw errorForStatus(response.status, await safeText(response));
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new ApiError('timeout', `Request to ${path} timed out`);
      }
      throw new ApiError('network', (error as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  listEvents(query?: string): Promise<EventSummary[]> {
    const suffix = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.request<EventSummary[]>(`/events${suffix}`);
  }

  getEvent(eventId: EventId): Promise<EventDetail> {
    return this.request<EventDetail>(`/events/${encodeURIComponent(eventId)}`);
  }

  joinEvent(eventId: EventId, visibility: Visibility): Promise<JoinEventResult> {
    return this.request<JoinEventResult>(`/events/${encodeURIComponent(eventId)}/join`, {
      method: 'POST',
      body: JSON.stringify({ visibility }),
    });
  }

  leaveEvent(eventId: EventId): Promise<void> {
    return this.request<void>(`/events/${encodeURIComponent(eventId)}/leave`, { method: 'POST' });
  }

  getDirectory(eventId: EventId, since?: string | null): Promise<DirectoryPage> {
    const suffix = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.request<DirectoryPage>(`/events/${encodeURIComponent(eventId)}/directory${suffix}`);
  }

  getProfiles(eventId: EventId, profileIds: ProfileId[]): Promise<DirectoryEntry[]> {
    return this.request<DirectoryEntry[]>(`/events/${encodeURIComponent(eventId)}/profiles`, {
      method: 'POST',
      body: JSON.stringify({ profileIds }),
    });
  }

  publishPeerSchedule(eventId: EventId, windows: PeerIdWindow[]): Promise<void> {
    return this.request<void>(`/events/${encodeURIComponent(eventId)}/peer-schedule`, {
      method: 'PUT',
      body: JSON.stringify({ windows }),
    });
  }

  updateProfile(profile: Profile): Promise<Profile> {
    return this.request<Profile>('/me/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    });
  }

  updateEventProfile(
    eventId: EventId,
    patch: Record<string, unknown>,
  ): Promise<void> {
    return this.request<void>(`/events/${encodeURIComponent(eventId)}/me`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  updateVisibility(eventId: EventId, visibility: Visibility): Promise<void> {
    return this.request<void>(`/events/${encodeURIComponent(eventId)}/me/visibility`, {
      method: 'PUT',
      body: JSON.stringify({ visibility }),
    });
  }

  listConnections(eventId: EventId): Promise<Connection[]> {
    return this.request<Connection[]>(`/events/${encodeURIComponent(eventId)}/connections`);
  }

  requestConnection(eventId: EventId, profileId: ProfileId, note?: string): Promise<Connection> {
    return this.request<Connection>(`/events/${encodeURIComponent(eventId)}/connections`, {
      method: 'POST',
      body: JSON.stringify({ profileId, note }),
    });
  }

  respondToConnection(connectionId: string, accept: boolean): Promise<Connection> {
    return this.request<Connection>(`/connections/${encodeURIComponent(connectionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: accept ? 'connected' : 'declined' satisfies ConnectionState }),
    });
  }

  blockUser(profileId: ProfileId): Promise<void> {
    return this.request<void>('/me/blocks', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    });
  }

  unblockUser(profileId: ProfileId): Promise<void> {
    return this.request<void>(`/me/blocks/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
  }

  reportUser(profileId: ProfileId, reason: string, details?: string): Promise<void> {
    return this.request<void>('/reports', {
      method: 'POST',
      body: JSON.stringify({ profileId, reason, details }),
    });
  }

  searchAttendees(eventId: EventId, filter: PeopleFilter): Promise<DirectoryEntry[]> {
    return this.request<DirectoryEntry[]>(`/events/${encodeURIComponent(eventId)}/search`, {
      method: 'POST',
      body: JSON.stringify(filter),
    });
  }
}

function errorForStatus(status: number, body: string): ApiError {
  if (status === 401) return new ApiError('unauthorized', body || 'Not signed in', status);
  if (status === 403) return new ApiError('forbidden', body || 'Not a member of this event', status);
  if (status === 404) return new ApiError('not_found', body || 'Not found', status);
  if (status === 409) return new ApiError('conflict', body || 'Conflict', status);
  if (status >= 500) return new ApiError('server', body || 'Server error', status);
  return new ApiError('unknown', body || `HTTP ${status}`, status);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
