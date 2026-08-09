// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;

namespace Nexus.Api.Services;

/// <summary>
/// Phase 73 — RFC 8291 Web-Push payload encryption (aes128gcm scheme).
///
/// Encrypts a UTF-8 payload so that only the browser holding the
/// subscription's private p256dh key can decrypt it. Pure
/// System.Security.Cryptography — no NuGet.
///
/// Steps (RFC 8291 §3, aes128gcm):
///  1. Generate an ephemeral EC P-256 key pair (the "as" key).
///  2. ECDH(as_priv, ua_p256dh_pub) → 32-byte shared secret.
///  3. HKDF-Extract(salt = auth_secret, ikm = shared_secret, info =
///     "WebPush: info\0" || ua_pub || as_pub) → 32-byte PRK.
///  4. HKDF-Expand(prk = PRK, info = "Content-Encoding: aes128gcm\0",
///     length = 16) → CEK (content encryption key).
///  5. HKDF-Expand(prk = PRK, info = "Content-Encoding: nonce\0",
///     length = 12) → NONCE.
///  6. Pad the plaintext with 0x02 (last record marker) + arbitrary 0x00
///     padding (we use no extra padding).
///  7. AES-128-GCM encrypt → ciphertext + 16-byte tag.
///  8. Prepend RFC 8188 framing header:
///       16-byte salt || 4-byte big-endian rs (record size) ||
///       1-byte idlen || idlen-byte keyid (the as_pub key, 65 bytes uncompressed).
///  9. Output = framing-header || ciphertext || tag.
///
/// Headers the caller must set on the HTTP push request:
///   Content-Encoding: aes128gcm
///   Content-Type: application/octet-stream
///   Content-Length: (length of output bytes)
///
/// Browsers decrypt + dispatch the payload to the service worker's
/// <c>push</c> event. This replaces the empty-body workaround where the
/// SW had to fetch the payload from a separate authenticated endpoint.
/// </summary>
public static class WebPushPayloadEncryptor
{
    private const int RecordSize = 4096;
    private const int CekLength = 16;
    private const int NonceLength = 12;
    private const int SaltLength = 16;
    private const int AuthSecretLength = 16;
    private const int P256UncompressedLength = 65;
    // Maximum plaintext that fits in one record once you account for:
    //   - 1 byte 0x02 record-end marker (added before encryption)
    //   - 16 byte AES-GCM auth tag (added by Encrypt)
    // → RecordSize - 17 = 4079. We use 3993 to match common Web-Push library
    // limits which leave headroom for browser-side framing variation.
    private const int MaxPlaintextLength = 3993;

    /// <summary>
    /// Encrypt a UTF-8 string payload for a Web-Push subscription.
    /// </summary>
    /// <param name="payload">Plain-text JSON or string to deliver.</param>
    /// <param name="userAgentPublicKeyBase64Url">The browser's
    /// p256dh key (65-byte uncompressed, base64url-encoded).</param>
    /// <param name="userAgentAuthSecretBase64Url">The browser's
    /// auth secret (16 bytes, base64url-encoded).</param>
    /// <returns>The encrypted body bytes ready to send as the HTTP body.</returns>
    public static byte[] Encrypt(string payload, string userAgentPublicKeyBase64Url, string userAgentAuthSecretBase64Url)
    {
        if (payload == null) throw new ArgumentNullException(nameof(payload));
        var plaintext = Encoding.UTF8.GetBytes(payload);
        return Encrypt(plaintext, userAgentPublicKeyBase64Url, userAgentAuthSecretBase64Url);
    }

    /// <summary>
    /// Encrypt arbitrary bytes for a Web-Push subscription, using
    /// base64url-encoded subscription keys (the format browsers expose via
    /// <c>PushSubscription.getKey('p256dh' | 'auth')</c>).
    /// </summary>
    public static byte[] Encrypt(byte[] plaintext, string userAgentPublicKeyBase64Url, string userAgentAuthSecretBase64Url)
    {
        if (plaintext == null) throw new ArgumentNullException(nameof(plaintext));
        if (string.IsNullOrWhiteSpace(userAgentPublicKeyBase64Url))
            throw new ArgumentException("p256dh required", nameof(userAgentPublicKeyBase64Url));
        if (string.IsNullOrWhiteSpace(userAgentAuthSecretBase64Url))
            throw new ArgumentException("auth required", nameof(userAgentAuthSecretBase64Url));

        var uaPub = VapidJwtSigner.Base64UrlDecode(userAgentPublicKeyBase64Url);
        var authSecret = VapidJwtSigner.Base64UrlDecode(userAgentAuthSecretBase64Url);
        return Encrypt(plaintext, uaPub, authSecret);
    }

    /// <summary>
    /// Encrypt arbitrary bytes for a Web-Push subscription, using raw
    /// subscription key bytes. Spec-aligned overload (RFC 8291 §3).
    /// </summary>
    /// <param name="payload">Plaintext bytes (max ~3993 bytes after padding +
    /// 16-byte tag overhead).</param>
    /// <param name="subscriptionP256dh">65-byte uncompressed P-256 public key
    /// (0x04 || X(32) || Y(32)).</param>
    /// <param name="subscriptionAuth">16-byte auth secret.</param>
    public static byte[] Encrypt(byte[] payload, byte[] subscriptionP256dh, byte[] subscriptionAuth)
    {
        if (payload == null) throw new ArgumentNullException(nameof(payload));
        if (subscriptionP256dh == null) throw new ArgumentNullException(nameof(subscriptionP256dh));
        if (subscriptionAuth == null) throw new ArgumentNullException(nameof(subscriptionAuth));

        if (subscriptionP256dh.Length != P256UncompressedLength || subscriptionP256dh[0] != 0x04)
            throw new ArgumentException($"p256dh must be 65 bytes uncompressed (0x04 || X || Y) — was {subscriptionP256dh.Length} bytes", nameof(subscriptionP256dh));
        if (subscriptionAuth.Length != AuthSecretLength)
            throw new ArgumentException($"auth must be 16 bytes — was {subscriptionAuth.Length} bytes", nameof(subscriptionAuth));
        if (payload.Length > MaxPlaintextLength)
            throw new ArgumentException(
                $"payload too large: {payload.Length} bytes > {MaxPlaintextLength} byte limit (rs={RecordSize} minus padding/tag overhead)",
                nameof(payload));

        var uaPub = subscriptionP256dh;
        var authSecret = subscriptionAuth;
        var plaintext = payload;

        // Step 1 — ephemeral key pair.
        using var asKey = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var asParams = asKey.ExportParameters(includePrivateParameters: false);
        var asPub = new byte[65];
        asPub[0] = 0x04;
        Buffer.BlockCopy(asParams.Q.X!, 0, asPub, 1, 32);
        Buffer.BlockCopy(asParams.Q.Y!, 0, asPub, 33, 32);

        // Step 2 — ECDH shared secret.
        // Import UA public key, then DeriveRawSecretAgreement (raw — not the
        // hashed default).
        var uaX = new byte[32]; var uaY = new byte[32];
        Buffer.BlockCopy(uaPub, 1, uaX, 0, 32);
        Buffer.BlockCopy(uaPub, 33, uaY, 0, 32);
        using var uaKey = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = uaX, Y = uaY }
        });
        var sharedSecret = asKey.DeriveRawSecretAgreement(uaKey.PublicKey);

        // Step 3 — random salt + HKDF-Extract.
        var salt = RandomNumberGenerator.GetBytes(SaltLength);

        // info = "WebPush: info\0" || ua_pub || as_pub
        var keyInfo = new byte[14 + uaPub.Length + asPub.Length];
        var prefix = Encoding.ASCII.GetBytes("WebPush: info\0");
        Buffer.BlockCopy(prefix, 0, keyInfo, 0, prefix.Length);
        Buffer.BlockCopy(uaPub, 0, keyInfo, prefix.Length, uaPub.Length);
        Buffer.BlockCopy(asPub, 0, keyInfo, prefix.Length + uaPub.Length, asPub.Length);

        // PRK_key = HKDF(salt = auth_secret, ikm = sharedSecret, info = keyInfo, len = 32)
        var ikm = HkdfSha256(salt: authSecret, ikm: sharedSecret, info: keyInfo, length: 32);

        // PRK_main = HKDF-Extract(salt = saltBytes, ikm = ikm) — i.e. HMAC.
        // Use HKDF.DeriveKey here: HKDF.DeriveKey performs Extract+Expand. To
        // derive CEK and NONCE we need the same PRK twice; DeriveKey is fine
        // because it's deterministic and Extract is HMAC.
        // Step 4 — CEK.
        var cek = HkdfSha256(salt: salt, ikm: ikm,
            info: Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"),
            length: CekLength);

        // Step 5 — NONCE.
        var nonce = HkdfSha256(salt: salt, ikm: ikm,
            info: Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"),
            length: NonceLength);

        // Step 6 — pad plaintext: append 0x02 (last record delim).
        var padded = new byte[plaintext.Length + 1];
        Buffer.BlockCopy(plaintext, 0, padded, 0, plaintext.Length);
        padded[plaintext.Length] = 0x02;

        // Step 7 — AES-128-GCM.
        var ciphertext = new byte[padded.Length];
        var tag = new byte[16];
        using (var aesgcm = new AesGcm(cek, tagSizeInBytes: 16))
        {
            aesgcm.Encrypt(nonce, padded, ciphertext, tag);
        }

        // Step 8/9 — RFC 8188 framing.
        // Header layout: salt(16) || rs(4 BE) || idlen(1) || keyid(idlen)
        // For Web-Push aes128gcm the keyid is the as_pub (65 bytes).
        var idlen = (byte)asPub.Length;
        var headerLen = SaltLength + 4 + 1 + idlen;
        var output = new byte[headerLen + ciphertext.Length + tag.Length];

        Buffer.BlockCopy(salt, 0, output, 0, SaltLength);
        // rs = record size as 4-byte big-endian. We pad to RecordSize.
        output[16] = (byte)((RecordSize >> 24) & 0xFF);
        output[17] = (byte)((RecordSize >> 16) & 0xFF);
        output[18] = (byte)((RecordSize >> 8) & 0xFF);
        output[19] = (byte)(RecordSize & 0xFF);
        output[20] = idlen;
        Buffer.BlockCopy(asPub, 0, output, 21, idlen);
        Buffer.BlockCopy(ciphertext, 0, output, headerLen, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, output, headerLen + ciphertext.Length, tag.Length);
        return output;
    }

    /// <summary>
    /// HKDF-Extract + HKDF-Expand in one go. Equivalent to RFC 5869
    /// HKDF(salt, ikm, info, length).
    /// </summary>
    private static byte[] HkdfSha256(byte[] salt, byte[] ikm, byte[] info, int length)
    {
        // HKDF.DeriveKey with SHA-256 implements RFC 5869 directly.
        return HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, length, salt, info);
    }

    /// <summary>
    /// Convenience: returns true if the subscription has both the p256dh
    /// public key and the auth secret needed for encryption.
    /// </summary>
    public static bool CanEncrypt(string? p256dh, string? auth) =>
        !string.IsNullOrWhiteSpace(p256dh) && !string.IsNullOrWhiteSpace(auth);
}
