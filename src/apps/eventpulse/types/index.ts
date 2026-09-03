/**
 * EventPulse domain types.
 *
 * This module is intentionally free of any React Native / platform imports so the
 * whole domain layer stays unit-testable in plain Node.
 */

/* ------------------------------------------------------------------ *
 * Identity & profile
 * ------------------------------------------------------------------ */

export type UserId = string;
export type ProfileId = string;
export type EventId = string;
/** Event-scoped, rotatable, non-permanent identifier broadcast over BLE. */
export type PeerId = string;

export type Availability = 'available' | 'maybe' | 'busy' | 'invisible';

export type Visibility = 'visible' | 'connections_only' | 'invisible';

/** Which audience may see a given profile field. */
export type FieldVisibility = 'public' | 'connections' | 'private';

export type AvatarKind = 'photo' | 'initials' | 'generated' | 'emoji';

export interface Avatar {
  kind: AvatarKind;
  /** Stable short id broadcast in the BLE payload so a peer can render before cache hydration. */
  avatarId: string;
  /** Remote/local URI, only for `photo`. */
  uri?: string;
  /** Emoji glyph, only for `emoji`. */
  emoji?: string;
  /** Deterministic hue 0-359 used by initials/generated avatars. */
  hue: number;
}

export interface ProfileLinks {
  linkedin?: string;
  github?: string;
  portfolio?: string;
  website?: string;
  twitter?: string;
}

/**
 * Broad professional archetype. Drives map filters, colours and recommendations.
 * Deliberately generic so the same app serves conferences, job fairs,
 * hackathons, startup events and campus events.
 */
export type PersonCategory =
  | 'engineer'
  | 'product'
  | 'design'
  | 'data'
  | 'founder'
  | 'investor'
  | 'recruiter'
  | 'student'
  | 'speaker'
  | 'mentor'
  | 'organizer'
  | 'other';

export interface Profile {
  id: ProfileId;
  userId: UserId;
  name: string;
  pronouns?: string;
  headline?: string;
  company?: string;
  role?: string;
  category: PersonCategory;
  /** Years of professional experience. */
  experienceYears?: number;
  industry?: string;
  skills: string[];
  interests: string[];
  bio?: string;
  avatar: Avatar;
  links?: ProfileLinks;
  /** Monotonically increasing; used to invalidate cached copies on peers. */
  version: number;
  updatedAt: number;
}

/** Event-specific overlay on top of the durable profile. */
/**
 * What someone came to the event to do.
 *
 * Deliberately a closed set rather than free text. Free text is friendlier to
 * write and useless to match on — "looking for my next thing" and "job hunting"
 * mean the same and share no tokens. A fixed vocabulary is what lets the app
 * answer "6 people here match your goal" without guessing.
 */
export type NetworkingGoal =
  | 'find_job'
  | 'meet_recruiters'
  | 'find_cofounders'
  | 'meet_engineers'
  | 'learn_ai'
  | 'find_clients'
  | 'explore_startups'
  | 'grow_network'
  | 'just_explore';

export interface EventProfile {
  eventId: EventId;
  profileId: ProfileId;
  whyAttending?: string;
  lookingToMeet?: string[];
  currentProject?: string;
  availability: Availability;
  /** Sessions the user marked interested/attending. */
  sessionInterests?: SessionInterest[];
  /** Structured goals for this event — the matcher's strongest input. */
  goals?: NetworkingGoal[];
  /**
   * Topics this person is happy to be asked about. The single most useful
   * field on a profile at an event: it converts "I should talk to them" into a
   * sentence you can actually open with.
   */
  askMeAbout?: string[];
}

export interface PrivacySettings {
  visibility: Visibility;
  /** Per-field visibility overrides; a missing key means `public`. */
  fields: Partial<Record<ProfileField, FieldVisibility>>;
  /** Broadcast the compact display name in the BLE payload. */
  broadcastDisplayName: boolean;
  /** Allow inbound connection requests. */
  allowConnectionRequests: boolean;
  /** Show up in Discover even when not physically nearby. */
  discoverable: boolean;
}

export type ProfileField =
  | 'company'
  | 'role'
  | 'experienceYears'
  | 'skills'
  | 'interests'
  | 'bio'
  | 'links'
  | 'pronouns'
  | 'whyAttending'
  | 'lookingToMeet'
  | 'currentProject';

/**
 * The merged, render-ready view of a person inside an event. This is what the
 * attendee directory hands to the UI; privacy rules are already applied.
 */
export interface Attendee {
  profile: Profile;
  eventProfile: EventProfile;
  /** Present only for members currently sharing presence. */
  peerId?: PeerId;
  visibility: Visibility;
  isConnection: boolean;
  isBlocked: boolean;
  /**
   * People you have both connected with at this event, as a count.
   *
   * A count and never a list: naming your mutual connections to a stranger
   * discloses their network as well as yours, and neither of them agreed to
   * that. The number is enough to earn the introduction.
   */
  mutualConnectionCount?: number;
}

/* ------------------------------------------------------------------ *
 * Event
 * ------------------------------------------------------------------ */

export type ZoneKind =
  | 'stage'
  | 'networking'
  | 'food'
  | 'registration'
  | 'sponsors'
  | 'workshop'
  | 'exhibition'
  | 'lounge'
  | 'other';

export interface EventZone {
  id: string;
  name: string;
  kind: ZoneKind;
  /** Zone centre in event-local metres, relative to the venue origin. */
  x: number;
  y: number;
  /** Approximate radius in metres, used only for soft landmark rendering. */
  radius: number;
  icon?: string;
}

export interface EventSession {
  id: string;
  title: string;
  speaker?: string;
  startTime: number;
  endTime: number;
  zoneId?: string;
  tags?: string[];
}

export type SessionInterestLevel = 'interested' | 'attending';

export interface SessionInterest {
  sessionId: string;
  level: SessionInterestLevel;
}

export interface EventVenue {
  name: string;
  address?: string;
  /**
   * Where the venue is, published by the organiser.
   *
   * Used only to centre the satellite ground layer on the right building. It is
   * never combined with BLE readings to place an attendee: distance is measured
   * and bearing is not, so a coordinate per person would be fabricated. The
   * device's own GPS is never read — the app asks for no location permission.
   */
  latitude?: number;
  longitude?: number;
  /** Overall venue extent in metres; used to scale the map's Overview zoom. */
  widthMeters: number;
  heightMeters: number;
  /**
   * Compass bearing of the venue plan's +Y axis, in degrees from magnetic north.
   *
   * Supplied by the organiser. Without it a zone layer cannot be rotated into
   * the user's frame — the plan's "up" is not north — so the map would point at
   * the coffee table and mean the fire exit. Defaults to 0 (plan +Y = north).
   */
  northOffsetDegrees?: number;
}

export interface EventSummary {
  id: EventId;
  name: string;
  tagline?: string;
  description?: string;
  organizer: string;
  startTime: number;
  endTime: number;
  venue: EventVenue;
  attendeeCount: number;
  bannerHue: number;
  tags: string[];
  /** 16-bit event discriminator used to filter BLE advertisements cheaply. */
  bleEventCode: number;
}

export interface EventDetail extends EventSummary {
  zones: EventZone[];
  sessions: EventSession[];
}

export interface EventMembership {
  eventId: EventId;
  userId: UserId;
  visibility: Visibility;
  peerId: PeerId;
  joinedAt: number;
}

/* ------------------------------------------------------------------ *
 * BLE presence
 * ------------------------------------------------------------------ */

export type PresenceStatus = 'available' | 'maybe' | 'busy';

/** Optional peer capabilities advertised as a bitfield. */
export interface PeerCapabilities {
  acceptsConnections: boolean;
  supportsNavigation: boolean;
  isAnchor: boolean;
}

/** Decoded BLE advertisement payload. Deliberately tiny; see docs/BLE_PROTOCOL.md. */
export interface BleAdvertisement {
  protocolVersion: number;
  /** 16-bit truncation of the event id; scoped filtering, not a secret. */
  eventCode: number;
  peerId: PeerId;
  /** Profile version so a stale cache entry can be refreshed opportunistically. */
  profileVersion: number;
  avatarId: string;
  /** Up to 8 UTF-8 bytes; a compact display identifier, never a full profile. */
  displayTag: string;
  status: PresenceStatus;
  capabilities: PeerCapabilities;
}

/** A raw scan hit as delivered by the platform BLE stack. */
export interface BleScanResult {
  /** Raw service-data bytes carrying the EventPulse payload. */
  data: Uint8Array;
  rssi: number;
  timestamp: number;
  /** Platform device handle; never persisted, never rendered. */
  deviceKey?: string;
}

export type PeerState =
  | 'unknown'
  | 'discovered'
  | 'nearby'
  | 'active'
  | 'out_of_range'
  | 'expired';

export type ProximityBand = 'very_close' | 'close' | 'nearby' | 'far';

export type SignalTrend = 'approaching' | 'steady' | 'receding';

export interface PeerRecord {
  peerId: PeerId;
  eventCode: number;
  state: PeerState;
  advertisement: BleAdvertisement;
  /** Smoothed RSSI in dBm. */
  rssi: number;
  /** Raw last-seen RSSI, kept for diagnostics only. */
  rawRssi: number;
  band: ProximityBand;
  /** Coarse distance estimate in metres. An estimate, never exact. */
  estimatedDistance: number;
  trend: SignalTrend;
  firstSeen: number;
  lastSeen: number;
  /** Number of advertisements folded into this record. */
  packets: number;
}

/* ------------------------------------------------------------------ *
 * Spatial model
 * ------------------------------------------------------------------ */

/** Relative event-local coordinates in metres. The user is always at (0,0). */
export interface RelativePoint {
  x: number;
  y: number;
}

export interface PlacedPerson {
  peerId: PeerId;
  position: RelativePoint;
  /** Bearing in degrees clockwise from the user's forward axis, 0 = ahead. */
  bearing: number;
  band: ProximityBand;
  estimatedDistance: number;
  /** 0..1 - how much the engine trusts this placement. */
  confidence: number;
}

export interface HeadingSample {
  /** Degrees clockwise from magnetic north. */
  heading: number;
  /** Platform accuracy hint in degrees; higher is worse. -1 when unknown. */
  accuracy: number;
  timestamp: number;
}

export type MapOrientation = 'north_up' | 'heading_up';

export type MapZoom = 'overview' | 'venue' | 'hall' | 'nearby';

/* ------------------------------------------------------------------ *
 * Connections
 * ------------------------------------------------------------------ */

export type ConnectionState =
  | 'none'
  | 'outgoing_pending'
  | 'incoming_pending'
  | 'connected'
  | 'declined';

export interface Connection {
  id: string;
  eventId: EventId;
  /** The other person. */
  profileId: ProfileId;
  state: ConnectionState;
  createdAt: number;
  updatedAt: number;
  note?: string;
  /** Queued while offline, flushed by the sync worker. */
  pendingSync?: boolean;
}

/* ------------------------------------------------------------------ *
 * Filters & discovery
 * ------------------------------------------------------------------ */

export interface PeopleFilter {
  query?: string;
  categories?: PersonCategory[];
  companies?: string[];
  skills?: string[];
  interests?: string[];
  minExperience?: number;
  maxExperience?: number;
  availableOnly?: boolean;
  /** Only people currently detected over BLE. */
  nearbyOnly?: boolean;
  /**
   * Only people the match engine vouched for.
   *
   * Unlike every other field here this one is not a property of the person — it
   * depends on who is asking. It is resolved where the matcher is available
   * rather than inside `matchesPersonFilter`, which is pure and stays that way.
   */
  matchesOnly?: boolean;
  maxDistance?: number;
  lookingFor?: string[];
}

export interface Recommendation {
  profileId: ProfileId;
  score: number;
  reasons: string[];
  distance?: number;
  band?: ProximityBand;
}
