// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for AdminMarketplaceController. Marketplace itself is OOS
 * for V2 parity, but the admin controller still ships and must remain locked
 * behind AdminOnly to avoid accidental member-role exposure.
 */

using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminMarketplaceControllerAuthTests : IntegrationTestBase
{
    public AdminMarketplaceControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/admin/marketplace/dashboard";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", 200)]
    public async Task AdminMarketplaceDashboard_AuthGate(string role, int expectedStatus)
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

        var resp = await Client.GetAsync(Path);

        if (role == "admin")
        {
            ((int)resp.StatusCode).Should().BeLessThan(401,
                $"admin must not get auth-rejected on {Path}");
        }
        else
        {
            ((int)resp.StatusCode).Should().Be(expectedStatus);
        }
    }
}
