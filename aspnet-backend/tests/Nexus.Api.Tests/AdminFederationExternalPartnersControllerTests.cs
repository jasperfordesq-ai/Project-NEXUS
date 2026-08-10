// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminFederationExternalPartnersControllerTests : IntegrationTestBase
{
    public AdminFederationExternalPartnersControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Index_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/v2/admin/federation/external-partners");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Index_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/admin/federation/external-partners");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Store_AsAdmin_CreatesPendingPartnerAndProtectsCredentials()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/admin/federation/external-partners", new
        {
            name = "V1.5 Partner",
            description = "External partner parity test",
            base_url = "https://93.184.216.34",
            api_key = "plain-api-key",
            signing_secret = "plain-signing-secret",
            auth_method = "api_key",
            protocol_type = "nexus",
            status = "active",
            allow_member_search = true,
            allow_listing_search = true,
            allow_messaging = true,
            allow_transactions = true
        }, JsonOptions);

        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Created, body);
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("data").GetProperty("id").GetInt32();

        var list = await Client.GetAsync("/api/admin/federation/external-partners");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await list.Content.ReadFromJsonAsync<JsonElement>();
        var partner = json.GetProperty("data").EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == id);
        partner.GetProperty("status").GetString().Should().Be("pending");
        partner.TryGetProperty("api_key", out _).Should().BeFalse();
        partner.TryGetProperty("signing_secret", out _).Should().BeFalse();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.FederationExternalPartners.FindAsync(id);
        stored.Should().NotBeNull();
        stored!.ApiKey.Should().NotBe("plain-api-key");
        stored.SigningSecret.Should().NotBe("plain-signing-secret");
    }

    [Fact]
    public async Task Update_WithSnakeCasePayload_UpdatesAllowedFlags()
    {
        await AuthenticateAsAdminAsync();
        var id = await CreatePartnerAsync("https://93.184.216.35");

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/federation/external-partners/{id}", new
        {
            name = "Updated Partner",
            base_url = "https://93.184.216.36",
            auth_method = "hmac",
            protocol_type = "timeoverflow",
            signing_secret = "updated-secret",
            status = "suspended",
            allow_member_search = false,
            allow_listing_search = true,
            allow_messaging = false,
            allow_transactions = true,
            allow_events = true,
            allow_groups = true,
            allow_connections = true,
            allow_volunteering = true,
            allow_member_sync = true
        }, JsonOptions);

        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await Client.GetAsync("/api/v2/admin/federation/external-partners");
        var json = await list.Content.ReadFromJsonAsync<JsonElement>();
        var partner = json.GetProperty("data").EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == id);
        partner.GetProperty("name").GetString().Should().Be("Updated Partner");
        partner.GetProperty("auth_method").GetString().Should().Be("hmac");
        partner.GetProperty("protocol_type").GetString().Should().Be("timeoverflow");
        partner.GetProperty("status").GetString().Should().Be("suspended");
        partner.GetProperty("allow_connections").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Store_WithUnsafeUrl_ReturnsUnprocessable()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/admin/federation/external-partners", new
        {
            name = "Unsafe",
            base_url = "http://localhost:5080",
            auth_method = "api_key",
            protocol_type = "nexus"
        }, JsonOptions);

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Logs_And_Delete_AreScopedToTenant()
    {
        await AuthenticateAsAdminAsync();
        var id = await CreatePartnerAsync("https://93.184.216.37");

        var logs = await Client.GetAsync($"/api/v2/admin/federation/external-partners/{id}/logs");
        logs.StatusCode.Should().Be(HttpStatusCode.OK);

        await AuthenticateAsOtherTenantUserAsync();
        var otherTenantDelete = await Client.DeleteAsync($"/api/v2/admin/federation/external-partners/{id}");
        otherTenantDelete.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await AuthenticateAsAdminAsync();
        var delete = await Client.DeleteAsync($"/api/v2/admin/federation/external-partners/{id}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private async Task<int> CreatePartnerAsync(string baseUrl)
    {
        var response = await Client.PostAsJsonAsync("/api/v2/admin/federation/external-partners", new
        {
            name = "Partner",
            base_url = baseUrl,
            api_key = "test-key",
            auth_method = "api_key",
            protocol_type = "nexus"
        }, JsonOptions);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("data").GetProperty("id").GetInt32();
    }
}
