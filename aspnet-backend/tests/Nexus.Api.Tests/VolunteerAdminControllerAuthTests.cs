// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for VolunteerAdminController.
 * Verifies the [Authorize(Policy = AdminOnly)] gate on /api/admin/volunteer/training/courses.
 */

using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class VolunteerAdminControllerAuthTests : IntegrationTestBase
{
    public VolunteerAdminControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/admin/volunteer/training/courses";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", 200)]
    public async Task AdminAuthGate(string role, int expectedStatus)
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
            var code = (int)resp.StatusCode;
            code.Should().NotBe(401, $"admin must not get auth-rejected on {Path}");
            code.Should().NotBe(403, $"{role} must not get authz-rejected on {Path}");
        }
        else
        {
            ((int)resp.StatusCode).Should().Be(expectedStatus);
        }
    }
}
