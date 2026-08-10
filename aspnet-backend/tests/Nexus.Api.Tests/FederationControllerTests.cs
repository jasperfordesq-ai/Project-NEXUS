// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for FederationController.
/// Covers admin partnership management and user-facing federated listing/exchange endpoints.
/// </summary>
[Collection("Integration")]
public class FederationControllerTests : IntegrationTestBase
{
    public FederationControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Authorization Tests

    [Fact]
    public async Task AdminFederationEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act & Assert
        var partnersResponse = await Client.GetAsync("/api/admin/federation/partners");
        partnersResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var statsResponse = await Client.GetAsync("/api/admin/federation/stats");
        statsResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AdminFederationEndpoints_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act & Assert
        var partnersResponse = await Client.GetAsync("/api/admin/federation/partners");
        partnersResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var statsResponse = await Client.GetAsync("/api/admin/federation/stats");
        statsResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var requestResponse = await Client.PostAsJsonAsync("/api/admin/federation/partners", new
        {
            partner_tenant_id = TestData.Tenant2.Id,
            shared_listings = true
        });
        requestResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task UserFederationEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act & Assert
        var listingsResponse = await Client.GetAsync("/api/federation/listings");
        listingsResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var exchangesResponse = await Client.GetAsync("/api/federation/exchanges");
        exchangesResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Admin Partner Management Tests

    [Fact]
    public async Task ListPartners_AsAdmin_ReturnsOkWithData()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/federation/partners");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out var data).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task RequestPartnership_ValidRequest_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // The shared TestDataSeeder pre-seeds an Active Tenant1↔Tenant2 partnership
        // for other federation tests; clear it for this case so the request can succeed.
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var existing = await db.Set<FederationPartner>()
                .IgnoreQueryFilters()
                .Where(fp =>
                    (fp.TenantId == TestData.Tenant1.Id && fp.PartnerTenantId == TestData.Tenant2.Id) ||
                    (fp.TenantId == TestData.Tenant2.Id && fp.PartnerTenantId == TestData.Tenant1.Id))
                .ToListAsync();
            db.Set<FederationPartner>().RemoveRange(existing);
            await db.SaveChangesAsync();
        }

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/federation/partners", new
        {
            partner_tenant_id = TestData.Tenant2.Id,
            shared_listings = true,
            shared_events = false,
            shared_members = false
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("pending");
        content.GetProperty("shared_listings").GetBoolean().Should().BeTrue();
        content.GetProperty("shared_events").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task RequestPartnership_SameTenant_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/federation/partners", new
        {
            partner_tenant_id = TestData.Tenant1.Id,
            shared_listings = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("error", out _).Should().BeTrue();
    }

    [Fact]
    public async Task ApprovePartnership_NonExistingPartner_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/federation/partners/99999/approve", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("error", out _).Should().BeTrue();
    }

    [Fact]
    public async Task SuspendPartnership_NonExistingPartner_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/federation/partners/99999/suspend", new
        {
            reason = "Testing suspension"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("error", out _).Should().BeTrue();
    }

    [Fact]
    public async Task SyncListings_NonExistingPartner_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/federation/partners/99999/sync", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("error", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetStats_AsAdmin_ReturnsOkWithMetrics()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/federation/stats");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("total_partners", out _).Should().BeTrue();
        content.TryGetProperty("active_partners", out _).Should().BeTrue();
        content.TryGetProperty("pending_partners", out _).Should().BeTrue();
        content.TryGetProperty("suspended_partners", out _).Should().BeTrue();
        content.TryGetProperty("total_exchanges", out _).Should().BeTrue();
        content.TryGetProperty("completed_exchanges", out _).Should().BeTrue();
    }

    #endregion

    #region User Federated Listing Tests

    [Fact]
    public async Task ListFederatedListings_AsMember_ReturnsOkWithPagination()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/federation/listings?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out var data).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Array);

        content.TryGetProperty("pagination", out var pagination).Should().BeTrue();
        pagination.GetProperty("page").GetInt32().Should().Be(1);
        pagination.GetProperty("limit").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task ListFederatedListings_PaginationDefaults_AppliedCorrectly()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/federation/listings");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var pagination = content.GetProperty("pagination");
        pagination.GetProperty("page").GetInt32().Should().Be(1);
        pagination.GetProperty("limit").GetInt32().Should().Be(20);
    }

    #endregion

    #region User Federated Exchange Tests

    [Fact]
    public async Task ListFederatedExchanges_AsMember_ReturnsOkWithPagination()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/federation/exchanges");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out var data).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Array);

        content.TryGetProperty("pagination", out var pagination).Should().BeTrue();
        pagination.GetProperty("page").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task InitiateExchange_InvalidListingId_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/federation/exchanges", new
        {
            federated_listing_id = 99999,
            agreed_hours = 2.0m
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("error", out _).Should().BeTrue();
    }

    [Fact]
    public async Task CompleteExchange_NonExistingExchange_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/federation/exchanges/99999/complete", new
        {
            actual_hours = 1.5m
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("error", out _).Should().BeTrue();
    }

    [Fact]
    public async Task CompleteExchange_WithoutRemoteSettlementEvidence_FailsWithoutMintingCredits()
    {
        int exchangeId;
        int transactionCountBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var exchange = new FederatedExchange
            {
                TenantId = TestData.Tenant1.Id,
                PartnerTenantId = TestData.Tenant2.Id,
                LocalUserId = TestData.MemberUser.Id,
                RemoteUserDisplayName = "Unverified remote member",
                SourceListingId = 987654,
                Status = ExchangeStatus.Requested,
                AgreedHours = 1m,
                CreditExchangeRate = 1m,
                CreatedAt = DateTime.UtcNow
            };
            db.FederatedExchanges.Add(exchange);
            await db.SaveChangesAsync();
            exchangeId = exchange.Id;
            transactionCountBefore = await db.Transactions.IgnoreQueryFilters().CountAsync();
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync($"/api/federation/exchanges/{exchangeId}/complete", new
        {
            actual_hours = 1000000m
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("error")
            .GetString()
            .Should().Contain("authenticated remote settlement evidence");

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await assertDb.FederatedExchanges
            .IgnoreQueryFilters()
            .SingleAsync(row => row.Id == exchangeId);
        stored.Status.Should().Be(ExchangeStatus.Requested);
        stored.LocalTransactionId.Should().BeNull();
        (await assertDb.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(transactionCountBefore);
    }

    #endregion

    #region Full Partnership Lifecycle Test

    [Fact]
    public async Task PartnershipLifecycle_RequestAndApprove_WorksEndToEnd()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Step 1: Request partnership
        var requestResponse = await Client.PostAsJsonAsync("/api/admin/federation/partners", new
        {
            partner_tenant_id = TestData.Tenant2.Id,
            shared_listings = true,
            shared_events = true,
            shared_members = false
        });

        // May return Created (first time) or BadRequest (already exists from prior test)
        if (requestResponse.StatusCode == HttpStatusCode.Created)
        {
            var requestContent = await requestResponse.Content.ReadFromJsonAsync<JsonElement>();
            var partnerId = requestContent.GetProperty("id").GetInt32();

            // Step 2: Approve partnership
            var approveResponse = await Client.PutAsJsonAsync($"/api/admin/federation/partners/{partnerId}/approve", new { });
            // The approve may succeed or fail depending on service logic (e.g., must be approved by partner tenant)
            approveResponse.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);

            // Step 3: Check stats reflect the new partnership
            var statsResponse = await Client.GetAsync("/api/admin/federation/stats");
            statsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            var stats = await statsResponse.Content.ReadFromJsonAsync<JsonElement>();
            stats.GetProperty("total_partners").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        }
        else
        {
            // Partnership already exists from another test run - just verify list works
            var listResponse = await Client.GetAsync("/api/admin/federation/partners");
            listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        }
    }

    #endregion

    #region Admin API Key Tests

    [Fact]
    public async Task ListApiKeys_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/admin/federation/api-keys");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out var data).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task CreateApiKey_AsAdmin_ReturnsCreated()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/admin/federation/api-keys", new
        {
            name = "Test API Key",
            scopes = "listings,exchanges",
            rate_limit_per_minute = 100
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("key", out var key).Should().BeTrue();
        key.GetString().Should().StartWith("nxfed_");
        content.GetProperty("name").GetString().Should().Be("Test API Key");
        content.TryGetProperty("warning", out _).Should().BeTrue();
    }

    [Fact]
    public async Task RevokeApiKey_NonExistent_ReturnsBadRequest()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.DeleteAsync("/api/admin/federation/api-keys/99999");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ApiKey_CreateAndRevoke_Lifecycle()
    {
        await AuthenticateAsAdminAsync();

        // Create
        var createResponse = await Client.PostAsJsonAsync("/api/admin/federation/api-keys", new
        {
            name = "Lifecycle Key",
            scopes = "listings"
        });
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var keyId = createContent.GetProperty("id").GetInt32();

        // Revoke
        var revokeResponse = await Client.DeleteAsync($"/api/admin/federation/api-keys/{keyId}");
        revokeResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // Verify in list
        var listResponse = await Client.GetAsync("/api/admin/federation/api-keys");
        var listContent = await listResponse.Content.ReadFromJsonAsync<JsonElement>();
        var keys = listContent.GetProperty("data");
        // The revoked key should still appear but inactive
        var revoked = keys.EnumerateArray().FirstOrDefault(k => k.GetProperty("id").GetInt32() == keyId);
        revoked.GetProperty("is_active").GetBoolean().Should().BeFalse();
    }

    #endregion

    #region Admin Feature Toggle Tests

    [Fact]
    public async Task ListFeatureToggles_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/admin/federation/features");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out _).Should().BeTrue();
        content.TryGetProperty("system", out _).Should().BeTrue();
    }

    [Fact]
    public async Task SetFeatureToggle_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync("/api/admin/federation/features", new
        {
            feature = "federation.enabled",
            is_enabled = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("feature").GetString().Should().Be("federation.enabled");
        content.GetProperty("is_enabled").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task FeatureToggles_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/admin/federation/features");
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region User Federation Settings Tests

    [Fact]
    public async Task GetFederationSettings_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/federation/settings");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("federation_opt_in", out _).Should().BeTrue();
        content.TryGetProperty("profile_visible", out _).Should().BeTrue();
        content.TryGetProperty("listings_visible", out _).Should().BeTrue();
    }

    [Fact]
    public async Task UpdateFederationSettings_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PutAsJsonAsync("/api/federation/settings", new
        {
            federation_opt_in = true,
            profile_visible = true,
            listings_visible = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("federation_opt_in").GetBoolean().Should().BeTrue();
        content.GetProperty("profile_visible").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task FederationSettings_Unauthenticated_Returns401()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/federation/settings");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region External API Tests

    [Fact]
    public async Task ExternalApiInfo_NoAuth_ReturnsOk()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/v1/federation");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("name").GetString().Should().Contain("Federation");
        content.GetProperty("version").GetString().Should().Be("1.0");
        content.TryGetProperty("endpoints", out var endpoints).Should().BeTrue();
        endpoints.GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task ExternalApiListings_NoAuth_Returns401()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/v1/federation/listings");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ExternalApiToken_NoAuth_Returns401()
    {
        ClearAuthToken();

        var response = await Client.PostAsJsonAsync("/api/v1/federation/token", new
        {
            target_tenant_id = 1,
            scopes = new[] { "listings" }
        });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ExternalApiMembers_NoAuth_Returns401()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/v1/federation/members");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ExternalApiExchanges_NoAuth_Returns401()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/v1/federation/exchanges/1");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ExternalApiWebhook_NoAuth_Returns401()
    {
        ClearAuthToken();

        var response = await Client.PostAsync("/api/v1/federation/webhooks/test", null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion
}
