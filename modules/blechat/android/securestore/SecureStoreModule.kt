package com.blechat.securestore

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Hardware-backed wrapping for the at-rest encryption key.
 *
 * The app already encrypts stored messages with XChaCha20-Poly1305. The weakness was
 * never the cipher — it was that the key sat in the same AsyncStorage as the data it
 * protected, so anyone who could read the files could read the key beside them.
 *
 * This module does one thing: WRAP that key with an AES-256-GCM key that lives inside the
 * Android Keystore and cannot be exported. The wrapped blob is what gets stored. Reading
 * the app's files now yields ciphertext and a wrapped key that is useless without the
 * hardware, because unwrapping requires the Keystore to perform the operation on this
 * device.
 *
 * Deliberately a wrapper rather than a replacement: the message crypto is already written
 * and tested, and the smallest change that closes the gap is the one least likely to
 * introduce a new one.
 *
 * Honest limits, all of which are real:
 *
 *  - `setUserAuthenticationRequired(false)`. The app must read its own storage on launch
 *    and flush a queue in the background; demanding a biometric prompt for that would
 *    break both. So this protects against someone reading the FILES, not against someone
 *    holding the unlocked phone. Requiring auth would be a different, stricter product.
 *
 *  - The key is bound to this device and this app installation. It does NOT survive a
 *    phone-to-phone restore or an app reinstall. That is the point of hardware binding,
 *    and it means old chat history becomes unreadable after a restore. The JS side
 *    treats that as "start fresh" rather than an error, because it is the expected
 *    consequence, not a fault.
 *
 *  - StrongBox is requested where available and silently skipped where it is not. A
 *    TEE-backed key is still far better than a key in a file; refusing to run without
 *    StrongBox would leave most phones with no protection at all.
 */
class SecureStoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SecureStore"

  companion object {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "blechat.atrest.wrapper.v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    /** 96 bits, the size GCM is specified for. */
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
  }

  /**
   * Whether wrapping actually works on this device.
   *
   * Answered by doing it rather than by inspecting version numbers: a Keystore that
   * exists but throws is common enough on older or unusual builds that only a real
   * round trip is worth trusting.
   */
  @ReactMethod
  fun isAvailable(promise: Promise) {
    try {
      val probe = ByteArray(32) { 0 }
      val wrapped = wrapBytes(probe)
      val unwrapped = unwrapBytes(wrapped)
      promise.resolve(unwrapped.contentEquals(probe))
    } catch (e: Exception) {
      // Not an error to report upwards: an unavailable Keystore is a supported state,
      // and the caller falls back rather than failing.
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun wrap(base64Plain: String, promise: Promise) {
    try {
      val plain = Base64.decode(base64Plain, Base64.NO_WRAP)
      promise.resolve(Base64.encodeToString(wrapBytes(plain), Base64.NO_WRAP))
    } catch (e: Exception) {
      promise.reject("wrap_failed", e.message, e)
    }
  }

  @ReactMethod
  fun unwrap(base64Wrapped: String, promise: Promise) {
    try {
      val wrapped = Base64.decode(base64Wrapped, Base64.NO_WRAP)
      promise.resolve(Base64.encodeToString(unwrapBytes(wrapped), Base64.NO_WRAP))
    } catch (e: KeyPermanentlyInvalidatedException) {
      // The key is gone for good — a device restore, or the user changing the screen
      // lock on a build that ties keys to it. Distinguished from a generic failure so
      // the JS side can start fresh rather than retrying forever.
      promise.reject("key_invalidated", "Keystore key is no longer usable", e)
    } catch (e: Exception) {
      promise.reject("unwrap_failed", e.message, e)
    }
  }

  /** Drop the wrapping key. Everything wrapped with it becomes permanently unreadable. */
  @ReactMethod
  fun destroyKey(promise: Promise) {
    try {
      val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
      if (store.containsAlias(ALIAS)) {
        store.deleteEntry(ALIAS)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("destroy_failed", e.message, e)
    }
  }

  // ---- internals --------------------------------------------------------

  private fun wrapBytes(plain: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val iv = cipher.iv
    require(iv.size == IV_BYTES) { "unexpected GCM IV length ${iv.size}" }
    val sealed = cipher.doFinal(plain)
    // iv || ciphertext+tag. The IV is generated by the cipher, never reused, and is not
    // secret — it only has to be unique per encryption under the same key.
    return iv + sealed
  }

  private fun unwrapBytes(wrapped: ByteArray): ByteArray {
    require(wrapped.size > IV_BYTES) { "wrapped blob is too short to contain an IV" }
    val iv = wrapped.copyOfRange(0, IV_BYTES)
    val sealed = wrapped.copyOfRange(IV_BYTES, wrapped.size)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
    return cipher.doFinal(sealed)
  }

  /** The Keystore-held key, created once on first use. */
  private fun secretKey(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
      return it.secretKey
    }
    return generateKey()
  }

  private fun generateKey(): SecretKey {
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    val spec =
        KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // See the class comment: the app reads its own storage at launch and while
            // in the background, so it cannot gate that behind a user prompt.
            .setUserAuthenticationRequired(false)
            .setRandomizedEncryptionRequired(true)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // Dedicated security chip where the phone has one. Attempted, not required:
      // insisting would leave most devices with no protection at all.
      try {
        generator.init(spec.setIsStrongBoxBacked(true).build())
        return generator.generateKey()
      } catch (e: Exception) {
        // No StrongBox on this hardware — fall through to a TEE-backed key.
      }
    }

    generator.init(spec.build())
    return generator.generateKey()
  }
}
