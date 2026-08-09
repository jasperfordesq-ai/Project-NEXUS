// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Phase 73 — VAPID JWT signer tests (RFC 8292).
 *
 * Pure unit tests, no integration host. We generate a test EC P-256 key
 * pair, sign a JWT, then verify it with ECDsa.VerifyData using the public
 * key — proving the signature round-trips correctly.
 *
 * No external test vectors needed because VAPID JWT verification is
 * deterministic: a JWT signed with private key K is verifiable with the
 * matching public key Q.
 */

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class VapidJwtSignerTests
{
    /// <summary>
    /// Generate an ephemeral EC P-256 key pair encoded the same way browsers
    /// emit VAPID keys: base64url private (32 bytes raw scalar) + base64url
    /// public (65 bytes uncompressed 0x04 || X || Y).
    /// </summary>
    private static (string PrivateB64Url, string PublicB64Url, ECParameters PublicParams) GenerateTestKeyPair()
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var p = ecdsa.ExportParameters(includePrivateParameters: true);

        var pubBytes = new byte[65];
        pubBytes[0] = 0x04;
        Buffer.BlockCopy(p.Q.X!, 0, pubBytes, 1, 32);
        Buffer.BlockCopy(p.Q.Y!, 0, pubBytes, 33, 32);

        var publicParams = new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = p.Q
        };

        return (
            VapidJwtSigner.Base64UrlEncode(p.D!),
            VapidJwtSigner.Base64UrlEncode(pubBytes),
            publicParams);
    }

    [Fact]
    public void SignJwt_ProducesThreePartJwtWithExpectedHeaderAndClaims()
    {
        var (priv, pub, _) = GenerateTestKeyPair();

        var jwt = VapidJwtSigner.SignJwt(
            audience: "https://fcm.googleapis.com",
            subject: "mailto:ops@example.test",
            privateKeyBase64Url: priv,
            publicKeyBase64Url: pub);

        var parts = jwt.Split('.');
        parts.Should().HaveCount(3);

        var headerJson = Encoding.UTF8.GetString(VapidJwtSigner.Base64UrlDecode(parts[0]));
        var claimsJson = Encoding.UTF8.GetString(VapidJwtSigner.Base64UrlDecode(parts[1]));

        using var headerDoc = JsonDocument.Parse(headerJson);
        headerDoc.RootElement.GetProperty("alg").GetString().Should().Be("ES256");
        headerDoc.RootElement.GetProperty("typ").GetString().Should().Be("JWT");

        using var claimsDoc = JsonDocument.Parse(claimsJson);
        claimsDoc.RootElement.GetProperty("aud").GetString().Should().Be("https://fcm.googleapis.com");
        claimsDoc.RootElement.GetProperty("sub").GetString().Should().Be("mailto:ops@example.test");
        var exp = claimsDoc.RootElement.GetProperty("exp").GetInt64();
        var nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        exp.Should().BeGreaterThan(nowUnix, "exp must be in the future");
        exp.Should().BeLessThan(nowUnix + 24 * 3600 + 60, "exp must be ≤24h ahead per RFC 8292");
    }

    [Fact]
    public void SignJwt_SignatureVerifiesAgainstPublicKey()
    {
        var (priv, pub, publicParams) = GenerateTestKeyPair();

        var jwt = VapidJwtSigner.SignJwt(
            audience: "https://updates.push.services.mozilla.com",
            subject: "https://project-nexus.net/contact",
            privateKeyBase64Url: priv,
            publicKeyBase64Url: pub);

        var parts = jwt.Split('.');
        var signingInput = $"{parts[0]}.{parts[1]}";
        var signature = VapidJwtSigner.Base64UrlDecode(parts[2]);

        // Round-trip: verify with the public key. The signer outputs IEEE
        // P1363 format (raw r||s, 64 bytes for P-256) which is what JWT
        // ES256 expects.
        signature.Length.Should().Be(64, "P-256 ES256 signature must be 64 bytes (raw r || s)");

        using var verifier = ECDsa.Create();
        verifier.ImportParameters(publicParams);
        var ok = verifier.VerifyData(
            Encoding.UTF8.GetBytes(signingInput),
            signature,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        ok.Should().BeTrue("the JWT signature must verify with the matching public key");
    }

    [Fact]
    public void BuildAuthorizationHeader_ProducesCorrectFormat()
    {
        var (priv, pub, _) = GenerateTestKeyPair();

        var header = VapidJwtSigner.BuildAuthorizationHeader(
            audience: "https://fcm.googleapis.com",
            subject: "mailto:ops@example.test",
            privateKeyBase64Url: priv,
            publicKeyBase64Url: pub);

        header.Should().StartWith("vapid t=");
        header.Should().Contain($", k={pub}");
        var t = header["vapid t=".Length..header.IndexOf(", k=")];
        t.Split('.').Should().HaveCount(3, "the t= value must be a 3-segment JWT");
    }

    [Fact]
    public void DeriveAudience_StripsPathFromEndpoint()
    {
        var fcm = VapidJwtSigner.DeriveAudience(new Uri("https://fcm.googleapis.com/wp/abc123def"));
        fcm.Should().Be("https://fcm.googleapis.com");

        var mozilla = VapidJwtSigner.DeriveAudience(new Uri("https://updates.push.services.mozilla.com/wpush/v2/long-token"));
        mozilla.Should().Be("https://updates.push.services.mozilla.com");

        // Non-default port preserved.
        var custom = VapidJwtSigner.DeriveAudience(new Uri("https://push.example:8443/x/y"));
        custom.Should().Be("https://push.example:8443");
    }

    [Fact]
    public void Base64UrlEncode_NoPaddingNoStandardChars()
    {
        // Bytes whose normal base64 contains + / and = padding.
        var bytes = new byte[] { 0xFB, 0xFF, 0xBF, 0xFE };
        var standard = Convert.ToBase64String(bytes); // "+/+//g==" or similar with + / =
        var url = VapidJwtSigner.Base64UrlEncode(bytes);
        url.Should().NotContain("+").And.NotContain("/").And.NotContain("=");
        // Round-trip.
        VapidJwtSigner.Base64UrlDecode(url).Should().BeEquivalentTo(bytes);
        // And the ROUND-TRIP also handles input that did have standard padding.
        VapidJwtSigner.Base64UrlDecode(url + (url.Length % 4 == 2 ? "==" : url.Length % 4 == 3 ? "=" : ""))
            .Should().BeEquivalentTo(bytes);
        _ = standard; // silence unused
    }

    [Fact]
    public void SignJwt_RejectsExpiryGreaterThan24Hours()
    {
        var (priv, pub, _) = GenerateTestKeyPair();
        var act = () => VapidJwtSigner.SignJwt(
            audience: "https://fcm.googleapis.com",
            subject: "mailto:ops@example.test",
            privateKeyBase64Url: priv,
            publicKeyBase64Url: pub,
            expirySeconds: 25 * 3600);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void SignJwt_RejectsMalformedKeys()
    {
        var (priv, _, _) = GenerateTestKeyPair();

        // Wrong-length private key.
        var act1 = () => VapidJwtSigner.SignJwt(
            "https://fcm.googleapis.com", "mailto:x@y.z",
            privateKeyBase64Url: VapidJwtSigner.Base64UrlEncode(new byte[16]),
            publicKeyBase64Url: VapidJwtSigner.Base64UrlEncode(new byte[65]));
        act1.Should().Throw<ArgumentException>().Where(e => e.Message.Contains("32 bytes"));

        // Public key without 0x04 prefix.
        var badPub = new byte[65];
        // leading byte is 0x00 (uncompressed marker missing)
        var act2 = () => VapidJwtSigner.SignJwt(
            "https://fcm.googleapis.com", "mailto:x@y.z",
            privateKeyBase64Url: priv,
            publicKeyBase64Url: VapidJwtSigner.Base64UrlEncode(badPub));
        act2.Should().Throw<ArgumentException>().Where(e => e.Message.Contains("uncompressed"));
    }
}
