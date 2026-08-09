// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for ReactFrontendCompatibilityController.
 * Verifies the per-action [Authorize] gate on /api/metrics/summary.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class ReactFrontendCompatibilityControllerAuthTests : IntegrationTestBase
{
    public ReactFrontendCompatibilityControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/metrics/summary";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]

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

        var resp = await Client.GetAsync(Path);

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

    [Fact]
    public async Task FederationNeighborhoodTenantMembership_V2Aliases_ReturnLaravelReactShapes()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/admin/federation/neighborhoods", new
        {
            name = $"Auth alias neighborhood {Guid.NewGuid():N}",
            description = "Created by the auth alias smoke test"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var neighborhoodId = createJson.GetProperty("data").GetProperty("id").GetInt32();

        var add = await Client.PostAsJsonAsync($"/api/v2/admin/federation/neighborhoods/{neighborhoodId}/tenants", new
        {
            tenant_id = TestData.Tenant2.Id
        });
        add.StatusCode.Should().Be(HttpStatusCode.OK);
        var addJson = await add.Content.ReadFromJsonAsync<JsonElement>();
        addJson.GetProperty("success").GetBoolean().Should().BeTrue();

        var remove = await Client.DeleteAsync($"/api/v2/admin/federation/neighborhoods/{neighborhoodId}/tenants/{TestData.Tenant2.Id}");
        remove.StatusCode.Should().Be(HttpStatusCode.OK);
        var removeJson = await remove.Content.ReadFromJsonAsync<JsonElement>();
        removeJson.GetProperty("success").GetBoolean().Should().BeTrue();
    }
}
