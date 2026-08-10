// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for AdminAiProvidersController (AI provider routing admin).
 * Verifies the [Authorize(Policy = "AdminOnly")] gate by hitting a
 * representative endpoint as anonymous / member / admin.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminAiProvidersControllerAuthTests : IntegrationTestBase
{
    public AdminAiProvidersControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/admin/ai/providers";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", 200)]
    public async Task AdminAiProvidersList_AuthGate(string role, int expectedStatus)
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

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", (int)HttpStatusCode.OK)]
    public async Task LaravelProviderTest_IsAdminOnlyAndNeverFabricatesSuccess(string role, int expectedStatus)
    {
        if (role == "anonymous")
        {
            ClearAuthToken();
        }
        else if (role == "admin")
        {
            await AuthenticateAsAdminAsync();
        }
        else
        {
            await AuthenticateAsMemberAsync();
        }

        var response = await Client.PostAsJsonAsync("/api/v2/ai/test-provider", new { provider = "not-configured" });

        ((int)response.StatusCode).Should().Be(expectedStatus);
        if (role == "admin")
        {
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            body.GetProperty("data").GetProperty("success").GetBoolean().Should().BeFalse();
            body.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        }
    }
}
