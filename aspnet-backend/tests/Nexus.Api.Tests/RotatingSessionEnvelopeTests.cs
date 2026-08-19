// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * The rotating-session envelope every auth response must carry.
 *
 * 🔴 What this fixes, and why page-level probing missed it for weeks. The accessible
 * frontend refuses to build a session unless the response carries ALL FOUR of
 * access_token, refresh_token, expires_in and refresh_expires_in — see
 * `rotatingSessionFrom` at web-uk/src/routes/auth.js:204-216, which throws
 * AUTH_SESSION_RESPONSE_INVALID (502) otherwise. This backend omitted
 * `refresh_expires_in` on all four emitting paths, so signing in to web-uk against
 * ASP.NET could not succeed at all.
 *
 * It stayed invisible because the SIGNED-OUT surface looked perfectly healthy: a probe
 * of ten accessible pages showed ten identical results against both backends, and every
 * authenticated page simply redirected to /login — which is what an unauthenticated
 * probe expects to see anyway. "All pages match" and "nobody can sign in" are
 * indistinguishable from outside unless you assert on the envelope itself.
 *
 * Laravel reports the field on every equivalent path (AuthController.php:446, 751;
 * TotpController.php:372; TwoFactorController.php:254).
 *
 * 🔴 The assertion is "positive finite number", not "present". web-uk does
 * `Number(result?.refresh_expires_in)` and rejects anything that is not finite and > 0,
 * so a null, a 0, or a string that does not parse fails there while satisfying a
 * key-presence check here.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class RotatingSessionEnvelopeTests : IntegrationTestBase
{
    /// <summary>The four fields web-uk requires before it will create a session.</summary>
    private static readonly string[] RequiredFields =
        ["access_token", "refresh_token", "expires_in", "refresh_expires_in"];

    private static void AssertRotatingSessionEnvelope(JsonElement body, string what)
    {
        foreach (var field in RequiredFields)
        {
            body.TryGetProperty(field, out var value).Should().BeTrue(
                $"{what} must carry `{field}` — web-uk's rotatingSessionFrom refuses the "
                + "whole session without it and answers 502 AUTH_SESSION_RESPONSE_INVALID");

            if (field.EndsWith("expires_in", StringComparison.Ordinal))
            {
                value.ValueKind.Should().Be(JsonValueKind.Number, $"{what}.{field} must be a number");
                value.GetInt64().Should().BeGreaterThan(0,
                    $"{what}.{field} must be a POSITIVE number — web-uk rejects 0, null and "
                    + "anything Number() cannot parse, so mere presence is not enough");
            }
            else
            {
                value.GetString().Should().NotBeNullOrWhiteSpace($"{what}.{field} must be a real token");
            }
        }
    }

    public RotatingSessionEnvelopeTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Login_ReturnsTheCompleteRotatingSessionEnvelope()
    {
        ClearAuthToken();
        // 🔴 `tenant_slug` (snake) and the SEEDER's password constant — not a guessed
        // literal. Both were wrong in the first draft and the login answered 400, which
        // looked like the backend refusing a valid request. Mirror IntegrationTestBase's
        // own GetAccessTokenAsync rather than re-deriving the credentials.
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "member@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        AssertRotatingSessionEnvelope(await response.Content.ReadFromJsonAsync<JsonElement>(), "login");
    }

    [Fact]
    public async Task RefreshToken_ReturnsTheCompleteRotatingSessionEnvelope()
    {
        ClearAuthToken();
        var login = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "member@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant",
        });
        login.StatusCode.Should().Be(HttpStatusCode.OK);
        var refreshToken = (await login.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("refresh_token").GetString();

        // 🔴 The refresh call carries a TENANT HEADER, because both clients send one:
        // web-uk attaches X-Tenant-Slug (api.js:286-292) and React sends X-Tenant-ID
        // (api.ts:781-783). Without it TenantResolutionMiddleware correctly answers 400
        // "Tenant context required" — which the first draft of this test read as the
        // refresh endpoint being broken. Reproduce what the CLIENT sends, not the
        // minimum the route will accept.
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh-token")
        {
            Content = JsonContent.Create(new { refresh_token = refreshToken }),
        };
        request.Headers.Add("X-Tenant-Slug", "test-tenant");

        var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "🔴 /api/auth/refresh-token is the ONLY refresh path either frontend calls "
            + "(react-frontend/src/lib/api.ts:786, web-uk/src/lib/api.js:286-292)");
        AssertRotatingSessionEnvelope(
            await response.Content.ReadFromJsonAsync<JsonElement>(), "refresh-token");
    }
}
