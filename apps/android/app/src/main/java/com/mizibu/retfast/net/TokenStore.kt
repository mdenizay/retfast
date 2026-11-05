package com.mizibu.retfast.net

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Persistence for the refresh token only. Access tokens live in memory. */
interface TokenStore {
    fun loadRefreshToken(): String?
    fun saveRefreshToken(token: String?)
}

class InMemoryTokenStore(private var token: String? = null) : TokenStore {
    @Synchronized override fun loadRefreshToken() = token
    @Synchronized override fun saveRefreshToken(token: String?) { this.token = token }
}

/**
 * Refresh token encrypted with an AES-256-GCM key that lives in the Android Keystore
 * (non-exportable, hardware-backed where available). Ciphertext (IV + data) sits in
 * a private SharedPreferences file. If the key is invalidated (e.g. after a restore
 * to another device) decryption fails and the user simply signs in again.
 */
class KeystoreTokenStore(context: Context) : TokenStore {
    private val prefs = context.applicationContext.getSharedPreferences("retfast_auth", Context.MODE_PRIVATE)

    @Synchronized
    override fun loadRefreshToken(): String? {
        val stored = prefs.getString(KEY_BLOB, null) ?: return null
        return try {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val iv = raw.copyOfRange(0, IV_LEN)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(raw, IV_LEN, raw.size - IV_LEN), Charsets.UTF_8)
        } catch (e: Exception) {
            prefs.edit().remove(KEY_BLOB).apply()
            null
        }
    }

    @Synchronized
    override fun saveRefreshToken(token: String?) {
        if (token == null) {
            prefs.edit().remove(KEY_BLOB).apply()
            return
        }
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ct = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(KEY_BLOB, Base64.encodeToString(cipher.iv + ct, Base64.NO_WRAP)).apply()
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private companion object {
        const val ALIAS = "retfast_refresh_token_key"
        const val KEY_BLOB = "refresh_blob"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV_LEN = 12
    }
}
