/**
 * The identity this install presents to other people.
 *
 * Every copy of the app used to ship the same profile id — the literal `'me'`
 * — because the id was written into the default profile by hand. Locally that
 * reads fine: `'me'` is who you are on your own phone. On the radio it is a
 * collision. Two phones both claiming `'me'` meant the receiver's own
 * self-check ("refuse a request that claims to be from us") fired on every
 * inbound request and dropped it in silence, so Connect could never complete
 * between two real devices.
 *
 * What this module mints is deliberately narrow:
 *
 *  - It is generated on the device from the platform CSPRNG. There is no
 *    server to allocate ids, and there must never be one.
 *  - It is stable for the life of the install. It has to be: the blocklist is
 *    global rather than event-scoped (`security:blocklist`, keyed by
 *    `ProfileId`), so an identity that rotated per event would quietly unblock
 *    everyone the moment the user walked into a different room.
 *  - It is NOT broadcast. Advertisements still carry only the rotating,
 *    event-derived peer id from `BleIdentity`, which stays unlinkable across
 *    events. This id travels inside a GATT payload, to one peer, only after
 *    the user has deliberately pressed Connect — it is disclosed to someone
 *    they chose, not radiated at strangers.
 *
 * That last distinction is the whole reason a durable identifier is
 * defensible here. If this value ever ends up in an advertisement, the privacy
 * posture described in `BleIdentity` is broken and this comment is a lie.
 */

import { defaultRandomSource, type RandomSource } from '../bluetooth/BleIdentity';
import { keys, type LocalDatabase } from '../storage/LocalDatabase';
import type { ProfileId } from '../types';
import { bytesToHex } from '../utils/bytes';

/**
 * The id every install carried before identities were minted locally.
 *
 * Kept as a named constant because it has to be recognised, not just avoided:
 * phones already in the field have it persisted, and boot has to notice and
 * replace it.
 */
export const LEGACY_PROFILE_ID = 'me';

/** 128 bits. Collision between two installs is not a practical concern. */
export const PROFILE_ID_BYTES = 16;

/**
 * Marks the value as an EventPulse identity in logs and on the wire, and makes
 * a placeholder obvious on sight when one does leak through.
 */
const PROFILE_ID_PREFIX = 'ep_';

/**
 * True for anything that must not be allowed onto the radio as an identity.
 *
 * Covers the legacy constant, but also empty and whitespace-only values: a
 * blank id would make every peer look like the same anonymous person, which is
 * the same bug wearing a different hat.
 */
export function isPlaceholderProfileId(profileId: string | null | undefined): boolean {
  if (!profileId) return true;
  const trimmed = profileId.trim();
  return trimmed.length === 0 || trimmed === LEGACY_PROFILE_ID;
}

/** A fresh identity. Exported for tests; production should call `ensureLocalProfileId`. */
export function mintProfileId(random: RandomSource = defaultRandomSource): ProfileId {
  return `${PROFILE_ID_PREFIX}${bytesToHex(random(PROFILE_ID_BYTES))}`;
}

/**
 * This install's id, minting and persisting one the first time it is asked.
 *
 * Idempotent by construction: the row is written once and every later call
 * returns it. Storing it separately from the profile matters — the profile can
 * be edited, redacted, or replaced wholesale, and none of that should change
 * who the user is to the people who have already connected with them.
 */
export async function ensureLocalProfileId(
  db: LocalDatabase,
  random: RandomSource = defaultRandomSource,
): Promise<ProfileId> {
  const stored = await db.get<string>(keys.localProfileId);
  if (stored && !isPlaceholderProfileId(stored)) return stored;

  const minted = mintProfileId(random);
  await db.set(keys.localProfileId, minted);
  return minted;
}

/**
 * Keep the stored id in step with the identity the profile actually carries.
 *
 * The profile is the source of truth once it holds a real id; this row exists
 * so a profile that is reset or replaced can be reseeded with the same
 * identity rather than turning the user into a new person. Writing the two
 * back into agreement costs nothing and keeps that promise honest.
 */
export async function rememberLocalProfileId(
  db: LocalDatabase,
  profileId: ProfileId,
): Promise<void> {
  if (isPlaceholderProfileId(profileId)) return;
  const stored = await db.get<string>(keys.localProfileId);
  if (stored === profileId) return;
  await db.set(keys.localProfileId, profileId);
}
