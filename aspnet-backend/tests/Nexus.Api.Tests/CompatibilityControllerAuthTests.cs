// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for CompatibilityController.
 * Verifies the class-level [Authorize] gate on CompatibilityController via /api/skills/categories.
 */

using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class CompatibilityControllerAuthTests : IntegrationTestBase
{
    public CompatibilityControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/skills/categories";

    /// <summary>
    /// 🔴 Corrected 2026-08-16. This asserted that /api/skills/categories rejects
    /// an anonymous caller with 401. Laravel does the opposite: the route carries
    /// an explicit ->withoutMiddleware('auth:sanctum') at routes/api.php:790, so
    /// the skill taxonomy is public — it is a vocabulary, not member data, and a
    /// signed-out visitor browsing what a community offers needs it.
    ///
    /// The endpoint was changed to match Laravel, which left this test pinning
    /// the old behaviour. An anonymous caller now needs tenant context instead of
    /// credentials, so the request carries X-Tenant-ID and expects 200.
    /// </summary>
    [Theory]
    [InlineData("anonymous", 200)]
    [InlineData("member", 200)]
    public async Task MemberAuthGate(string role, int expectedStatus)
    {
        if (role == "anonymous")
        {
            ClearAuthToken();
        }
        else
        {
            var email = role == "admin" ? "admin@test.com" : "member@test.com";
            var token = await GetAccessTokenAsync(email, "test-tenant");
            SetAuthToken(token);
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, Path);
        if (role == "anonymous")
        {
            // Public, but still tenant-scoped: without a community there is no
            // taxonomy to return, and the backend answers 400 rather than
            // guessing which community was meant.
            request.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        }

        var resp = await Client.SendAsync(request);

        if (role == "member")
        {
            var code = (int)resp.StatusCode;
            code.Should().NotBe(401, $"member must not get auth-rejected on {Path}");
            code.Should().NotBe(403, $"{role} must not get authz-rejected on {Path}");
        }
        else
        {
            ((int)resp.StatusCode).Should().Be(expectedStatus);
        }
    }
}
