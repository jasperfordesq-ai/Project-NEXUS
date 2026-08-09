// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Nexus.Api.Services;

/// <summary>
/// Phase 73 — VAPID JWT signer for Web-Push (RFC 8292).
///
/// Produces a JWT signed with EC P-256 (ES256) for the VAPID Authorization
/// header. The push service uses this to verify the sender's identity and
/// throttle abusive senders.
///
/// Format of the produced Authorization header:
///   Authorization: vapid t=&lt;jwt&gt;, k=&lt;url-base64-public-key&gt;
///
/// Inputs:
///  - VAPID public + private keys (configured per-tenant or globally as
///    Vapid:PublicKey / Vapid:PrivateKey, base64-url encoded with no
///    padding — the standard format browsers use in JavaScript).
///  - The push subscription's audience (origin of the push service URL,
///    e.g. https://fcm.googleapis.com).
///  - A subject (mailto:contact@... or https URL) — push services use this
///    if they need to reach you about abuse.
///
/// What this does NOT do:
///  - Encrypt the payload (RFC 8291 / Aes128Gcm). Full payload encryption
///    requires HKDF + ECDH key agreement with the subscription's p256dh
///    key + AES-128-GCM. PushSubscription would need extra columns
///    (P256dh, Auth) before that's possible. For now we send empty bodies
///    and let the service worker fetch the payload from a separate
///    authenticated endpoint.
///
/// Implementation note: pure System.Security.Cryptography (no NuGet) using
/// ECDsa.Create on the NIST P-256 curve. JWT format is hand-rolled because
/// the .NET JWT libraries default to RSA and are awkward for ES256 raw key
/// material from base64url strings.
/// </summary>
public static class VapidJwtSigner
{
    /// <summary>
    /// Sign a VAPID JWT for a given push-service audience.
    /// </summary>
    /// <param name="audience">Origin of the push service (scheme + host),
    /// e.g. <c>https://fcm.googleapis.com</c>. Derived from the
    /// subscription endpoint's URL.</param>
    /// <param name="subject">Mailto: or HTTPS URL the push service can reach
    /// the sender at for abuse complaints.</param>
    /// <param name="privateKeyBase64Url">VAPID private key, raw 32-byte EC
    /// P-256 scalar, base64-url encoded (no padding) — the format browser
    /// JS uses for VAPID keys.</param>
    /// <param name="publicKeyBase64Url">VAPID public key, raw 65-byte
    /// uncompressed EC P-256 point (0x04 prefix + 32 X + 32 Y), base64-url
    /// encoded (no padding).</param>
    /// <param name="expirySeconds">JWT lifetime. Default 12h; max per RFC
    /// 8292 is 24h.</param>
    /// <returns>The full <c>Authorization: vapid ...</c> header value.</returns>
    public static string BuildAuthorizationHeader(
        string audience,
        string subject,
        string privateKeyBase64Url,
        string publicKeyBase64Url,
        int expirySeconds = 12 * 3600)
    {
        if (string.IsNullOrWhiteSpace(audience)) throw new ArgumentException("audience required", nameof(audience));
        if (string.IsNullOrWhiteSpace(subject)) throw new ArgumentException("subject required", nameof(subject));
        if (expirySeconds <= 0 || expirySeconds > 24 * 3600)
            throw new ArgumentOutOfRangeException(nameof(expirySeconds), "must be 1..86400 seconds (RFC 8292)");

        var jwt = SignJwt(audience, subject, privateKeyBase64Url, publicKeyBase64Url, expirySeconds);
        return $"vapid t={jwt}, k={publicKeyBase64Url}";
    }

    /// <summary>
    /// Sign just the JWT (without the surrounding <c>vapid t=..., k=...</c>
    /// envelope). Exposed mainly for tests.
    /// </summary>
    public static string SignJwt(
        string audience,
        string subject,
        string privateKeyBase64Url,
        string publicKeyBase64Url,
        int expirySeconds = 12 * 3600)
    {
        if (string.IsNullOrWhiteSpace(audience)) throw new ArgumentException("audience required", nameof(audience));
        if (string.IsNullOrWhiteSpace(subject)) throw new ArgumentException("subject required", nameof(subject));
        if (expirySeconds <= 0 || expirySeconds > 24 * 3600)
            throw new ArgumentOutOfRangeException(nameof(expirySeconds), "must be 1..86400 seconds (RFC 8292)");

        // Header: { "typ": "JWT", "alg": "ES256" }
        var header = new { typ = "JWT", alg = "ES256" };
        var headerJson = JsonSerializer.Serialize(header);

        // Claims:
        //   aud — origin of the push service
        //   exp — unix-seconds; must be < 24h from now
        //   sub — mailto: or https://...
        var nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var claims = new
        {
            aud = audience,
            exp = nowUnix + expirySeconds,
            sub = subject
        };
        var claimsJson = JsonSerializer.Serialize(claims);

        var encodedHeader = Base64UrlEncode(Encoding.UTF8.GetBytes(headerJson));
        var encodedClaims = Base64UrlEncode(Encoding.UTF8.GetBytes(claimsJson));
        var signingInput = $"{encodedHeader}.{encodedClaims}";

        var signature = SignEs256(signingInput, privateKeyBase64Url, publicKeyBase64Url);
        var encodedSignature = Base64UrlEncode(signature);

        return $"{signingInput}.{encodedSignature}";
    }

    /// <summary>
    /// Derive the audience from a push subscription endpoint URL.
    /// Example: <c>https://fcm.googleapis.com/wp/abc123</c> →
    /// <c>https://fcm.googleapis.com</c>.
    /// </summary>
    public static string DeriveAudience(Uri endpoint)
    {
        // RFC 8292 says aud is the origin (scheme + host + non-default port).
        return endpoint.GetLeftPart(UriPartial.Authority);
    }

    private static byte[] SignEs256(string input, string privateKeyBase64Url, string publicKeyBase64Url)
    {
        var d = Base64UrlDecode(privateKeyBase64Url);   // 32 bytes — scalar
        var pubBytes = Base64UrlDecode(publicKeyBase64Url); // 65 bytes — 0x04 || X || Y

        if (d.Length != 32) throw new ArgumentException($"VAPID private key must be 32 bytes (was {d.Length})", nameof(privateKeyBase64Url));
        if (pubBytes.Length != 65 || pubBytes[0] != 0x04)
            throw new ArgumentException("VAPID public key must be 65 bytes uncompressed (0x04 + X + Y)", nameof(publicKeyBase64Url));

        var x = new byte[32];
        var y = new byte[32];
        Buffer.BlockCopy(pubBytes, 1, x, 0, 32);
        Buffer.BlockCopy(pubBytes, 33, y, 0, 32);

        var ecParams = new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = d,
            Q = new ECPoint { X = x, Y = y }
        };

        using var ecdsa = ECDsa.Create();
        ecdsa.ImportParameters(ecParams);

        // SignData on the SHA-256 of the input. ECDsa.SignData with HashAlgorithmName.SHA256
        // does both hash + sign; output is IEEE P1363 fixed-size (r || s, 64 bytes for P-256)
        // when using DSASignatureFormat.IeeeP1363FixedFieldConcatenation — which is what
        // JWT ES256 expects (NOT the DER-encoded sequence).
        return ecdsa.SignData(
            Encoding.UTF8.GetBytes(input),
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    }

    /// <summary>Base64-url-encode without padding.</summary>
    public static string Base64UrlEncode(byte[] bytes)
        => Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');

    /// <summary>Base64-url-decode (handles missing padding).</summary>
    public static byte[] Base64UrlDecode(string s)
    {
        var padded = s.Replace("-", "+").Replace("_", "/");
        switch (padded.Length % 4)
        {
            case 2: padded += "=="; break;
            case 3: padded += "="; break;
            case 0: break;
            default: throw new FormatException("Invalid base64url string");
        }
        return Convert.FromBase64String(padded);
    }
}
