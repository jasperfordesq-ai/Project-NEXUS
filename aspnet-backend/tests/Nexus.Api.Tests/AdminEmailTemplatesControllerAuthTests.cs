// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for AdminEmailTemplatesController (v2 versioned templates).
 * Verifies the [Authorize(Policy = "AdminOnly")] gate by hitting a
 * representative endpoint as anonymous / member / admin.
 */

using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminEmailTemplatesControllerAuthTests : IntegrationTestBase
{
    public AdminEmailTemplatesControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/admin/email-templates/v2/active";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", 200)]
    public async Task AdminEmailTemplatesActive_AuthGate(string role, int expectedStatus)
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
