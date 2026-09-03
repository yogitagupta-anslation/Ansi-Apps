import type {LinkId} from '../types/BLE';
import type {SessionCipher} from './SessionCrypto';

/**
 * Which links currently have an established encrypted session.
 *
 * Shared by exactly two owners: PeerManager installs a cipher once a handshake has
 * verified, and the codec consults it on every packet. Keeping it in its own object
 * rather than reaching into PeerManager from the codec is what keeps the encryption
 * decision — "is this link secure yet?" — answerable in one place.
 *
 * A cipher is removed the moment its link drops. That is not just tidiness: the keys are
 * per-link and per-connection, so holding one after the link is gone could only ever let
 * it be used on a session it was not derived for.
 */
export class SessionRegistry {
  private readonly ciphers = new Map<LinkId, SessionCipher>();

  set(linkId: LinkId, cipher: SessionCipher): void {
    this.ciphers.set(linkId, cipher);
  }

  get(linkId: LinkId): SessionCipher | undefined {
    return this.ciphers.get(linkId);
  }

  has(linkId: LinkId): boolean {
    return this.ciphers.has(linkId);
  }

  clear(linkId: LinkId): void {
    this.ciphers.delete(linkId);
  }

  clearAll(): void {
    this.ciphers.clear();
  }

  get size(): number {
    return this.ciphers.size;
  }
}
