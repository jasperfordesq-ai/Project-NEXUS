// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Phase 73 — RFC 8291 Web-Push payload encryption tests.
 *
 * The strongest test we can write without a real browser is a full
 * round-trip: act as both the application server (encrypt) AND the user
 * agent (decrypt). If our encryptor produces ciphertext that we can
 * decrypt by inverting the protocol with the UA's private key, the
 * encrypt path is correct.
 *
 * No external dependencies — pure System.Security.Cryptography.
 */

using System.Security.Cryptography;
using System.Text;
using FluentAssertions;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class WebPushPayloadEncryptorTests
{
    private const int SaltLength = 16;
    private const int KeyIdLengthOffset = 20;
    private const int HeaderFixedPrefix = 21;

    /// <summary>Generate a fake browser subscription (P-256 keypair + 16-byte auth).</summary>
    private static (string P256dh, string Auth, ECParameters Private) MakeUserAgent()
    {
        using var ec = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var p = ec.ExportParameters(includePrivateParameters: true);

        var pubBytes = new byte[65];
        pubBytes[0] = 0x04;
        Buffer.BlockCopy(p.Q.X!, 0, pubBytes, 1, 32);
        Buffer.BlockCopy(p.Q.Y!, 0, pubBytes, 33, 32);

        var authSecret = RandomNumberGenerator.GetBytes(16);
        return (
            VapidJwtSigner.Base64UrlEncode(pubBytes),
            VapidJwtSigner.Base64UrlEncode(authSecret),
            p);
    }

    /// <summary>Decrypt the encryptor's output as a browser would.</summary>
    private static byte[] DecryptAsUserAgent(byte[] encryptedBody, ECParameters uaPrivate, string authBase64Url)
    {
        // Parse RFC 8188 header.
        var salt = encryptedBody[..SaltLength];
        var idlen = encryptedBody[KeyIdLengthOffset];
        var asPub = encryptedBody[HeaderFixedPrefix..(HeaderFixedPrefix + idlen)];
        var ciphertextWithTag = encryptedBody[(HeaderFixedPrefix + idlen)..];
        // AES-GCM tag is the last 16 bytes.
        var tag = ciphertextWithTag[^16..];
        var ciphertext = ciphertextWithTag[..^16];

        // ECDH(ua_priv, as_pub).
        var asX = new byte[32]; var asY = new byte[32];
        Buffer.BlockCopy(asPub, 1, asX, 0, 32);
        Buffer.BlockCopy(asPub, 33, asY, 0, 32);

        using var asKey = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = asX, Y = asY }
        });
        using var uaKey = ECDiffieHellman.Create(uaPrivate);
        var sharedSecret = uaKey.DeriveRawSecretAgreement(asKey.PublicKey);

        // Reconstruct UA public key bytes for the keyInfo.
        var uaPub = new byte[65];
        uaPub[0] = 0x04;
        Buffer.BlockCopy(uaPrivate.Q.X!, 0, uaPub, 1, 32);
        Buffer.BlockCopy(uaPrivate.Q.Y!, 0, uaPub, 33, 32);

        var authSecret = VapidJwtSigner.Base64UrlDecode(authBase64Url);

        // Mirror the encryptor's HKDF chain.
        var keyInfoPrefix = Encoding.ASCII.GetBytes("WebPush: info\0");
        var keyInfo = new byte[keyInfoPrefix.Length + uaPub.Length + asPub.Length];
        Buffer.BlockCopy(keyInfoPrefix, 0, keyInfo, 0, keyInfoPrefix.Length);
        Buffer.BlockCopy(uaPub, 0, keyInfo, keyInfoPrefix.Length, uaPub.Length);
        Buffer.BlockCopy(asPub, 0, keyInfo, keyInfoPrefix.Length + uaPub.Length, asPub.Length);

        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, sharedSecret, 32, authSecret, keyInfo);
        var cek = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));

        var padded = new byte[ciphertext.Length];
        using (var aes = new AesGcm(cek, tagSizeInBytes: 16))
        {
            aes.Decrypt(nonce, ciphertext, tag, padded);
        }

        // Strip the trailing 0x02 record-end byte (and any 0x00 padding).
        int end = padded.Length;
        while (end > 0 && padded[end - 1] == 0x00) end--;
        if (end > 0 && padded[end - 1] == 0x02) end--;
        return padded[..end];
    }

    [Fact]
    public void Encrypt_RoundTrips_ShortAsciiPayload()
    {
        var ua = MakeUserAgent();
        const string payload = """{"title":"Hi","body":"Hello browser"}""";

        var encrypted = WebPushPayloadEncryptor.Encrypt(payload, ua.P256dh, ua.Auth);

        var decrypted = DecryptAsUserAgent(encrypted, ua.Private, ua.Auth);
        Encoding.UTF8.GetString(decrypted).Should().Be(payload);
    }

    [Fact]
    public void Encrypt_RoundTrips_UnicodePayload()
    {
        var ua = MakeUserAgent();
        const string payload = """{"title":"こんにちは","body":"🚀 Test — déjà vu"}""";

        var encrypted = WebPushPayloadEncryptor.Encrypt(payload, ua.P256dh, ua.Auth);

        var decrypted = DecryptAsUserAgent(encrypted, ua.Private, ua.Auth);
        Encoding.UTF8.GetString(decrypted).Should().Be(payload);
    }

    [Fact]
    public void Encrypt_RoundTrips_LargePayload()
    {
        var ua = MakeUserAgent();
        // ~3KB — close to the 4KB record-size cap.
        var payload = new string('a', 3000);

        var encrypted = WebPushPayloadEncryptor.Encrypt(payload, ua.P256dh, ua.Auth);

        var decrypted = DecryptAsUserAgent(encrypted, ua.Private, ua.Auth);
        Encoding.UTF8.GetString(decrypted).Should().Be(payload);
    }

    [Fact]
    public void Encrypt_OutputBeginsWithSaltAndKeyId()
    {
        var ua = MakeUserAgent();
        var encrypted = WebPushPayloadEncryptor.Encrypt("x", ua.P256dh, ua.Auth);

        // RFC 8188 header layout.
        encrypted.Length.Should().BeGreaterThan(HeaderFixedPrefix + 65);
        encrypted[KeyIdLengthOffset].Should().Be(65, "keyid is the as_pub which is 65 bytes for P-256");
        encrypted[HeaderFixedPrefix].Should().Be(0x04, "as_pub starts with the uncompressed-point marker");
    }

    [Fact]
    public void Encrypt_RejectsWrongLengthP256dh()
    {
        var ua = MakeUserAgent();
        var bad = VapidJwtSigner.Base64UrlEncode(new byte[33]); // 33 bytes — wrong
        var act = () => WebPushPayloadEncryptor.Encrypt("x", bad, ua.Auth);
        act.Should().Throw<ArgumentException>().Where(e => e.Message.Contains("65 bytes"));
    }

    [Fact]
    public void Encrypt_RejectsWrongLengthAuth()
    {
        var ua = MakeUserAgent();
        var bad = VapidJwtSigner.Base64UrlEncode(new byte[8]); // 8 bytes — wrong
        var act = () => WebPushPayloadEncryptor.Encrypt("x", ua.P256dh, bad);
        act.Should().Throw<ArgumentException>().Where(e => e.Message.Contains("16 bytes"));
    }

    [Fact]
    public void Encrypt_TwoCallsProduceDifferentCiphertext()
    {
        // Salt is random per call → ciphertext differs even for identical inputs.
        var ua = MakeUserAgent();
        var a = WebPushPayloadEncryptor.Encrypt("x", ua.P256dh, ua.Auth);
        var b = WebPushPayloadEncryptor.Encrypt("x", ua.P256dh, ua.Auth);
        a.Should().NotBeEquivalentTo(b);
    }

    [Fact]
    public void Encrypt_ByteOverload_RoundTrips()
    {
        var ua = MakeUserAgent();
        var p256dh = VapidJwtSigner.Base64UrlDecode(ua.P256dh);
        var auth = VapidJwtSigner.Base64UrlDecode(ua.Auth);
        var payload = Encoding.UTF8.GetBytes("""{"hello":"bytes"}""");

        var encrypted = WebPushPayloadEncryptor.Encrypt(payload, p256dh, auth);

        var decrypted = DecryptAsUserAgent(encrypted, ua.Private, ua.Auth);
        decrypted.Should().BeEquivalentTo(payload);
    }

    [Fact]
    public void Encrypt_ByteOverload_RejectsWrongLengthP256dh()
    {
        var auth = new byte[16];
        var act = () => WebPushPayloadEncryptor.Encrypt(new byte[]{ 1 }, new byte[33], auth);
        act.Should().Throw<ArgumentException>().Where(e => e.Message.Contains("65 bytes"));
    }

    [Fact]
    public void Encrypt_ByteOverload_RejectsWrongLengthAuth()
    {
        var ua = MakeUserAgent();
        var p256dh = VapidJwtSigner.Base64UrlDecode(ua.P256dh);
        var act = () => WebPushPayloadEncryptor.Encrypt(new byte[]{ 1 }, p256dh, new byte[8]);
        act.Should().Throw<ArgumentException>().Where(e => e.Message.Contains("16 bytes"));
    }

    [Fact]
    public void Encrypt_RejectsPayloadTooLarge()
    {
        var ua = MakeUserAgent();
        var p256dh = VapidJwtSigner.Base64UrlDecode(ua.P256dh);
        var auth = VapidJwtSigner.Base64UrlDecode(ua.Auth);
        var huge = new byte[5000]; // > 3993 byte cap

        var act = () => WebPushPayloadEncryptor.Encrypt(huge, p256dh, auth);
        act.Should().Throw<ArgumentException>().Where(e => e.Message.Contains("too large"));
    }

    [Fact]
    public void Encrypt_OutputHeader_HasCorrectShape()
    {
        var ua = MakeUserAgent();
        var encrypted = WebPushPayloadEncryptor.Encrypt("x", ua.P256dh, ua.Auth);

        // RFC 8188 header: salt(16) || rs(4 BE) || idlen(1) || keyid(idlen)
        // rs must equal 4096 (RecordSize).
        var rs = (encrypted[16] << 24) | (encrypted[17] << 16) | (encrypted[18] << 8) | encrypted[19];
        rs.Should().Be(4096, "record size is fixed at 4096");
        encrypted[20].Should().Be(65, "idlen for P-256 uncompressed key is 65");
        encrypted[21].Should().Be(0x04, "keyid (as_pub) leading byte is uncompressed-point marker");
        encrypted.Length.Should().BeGreaterThan(16 + 4 + 1 + 65 + 16, "must include header + tag + ciphertext");
    }

    [Fact]
    public void CanEncrypt_BothKeysPresent_ReturnsTrue()
    {
        WebPushPayloadEncryptor.CanEncrypt("p256", "auth").Should().BeTrue();
        WebPushPayloadEncryptor.CanEncrypt(null, "auth").Should().BeFalse();
        WebPushPayloadEncryptor.CanEncrypt("p256", null).Should().BeFalse();
        WebPushPayloadEncryptor.CanEncrypt("", "").Should().BeFalse();
    }
}
