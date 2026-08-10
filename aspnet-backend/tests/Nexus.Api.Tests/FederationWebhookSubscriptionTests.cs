// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Fix 1: typed federation webhook subscription registry replaces the
/// previous TenantConfig JSON-blob persistence.
/// Verifies auth gates + CRUD round-trip + legacy migration.
/// </summary>
[Collection("Integration")]
public class FederationWebhookSubscriptionTests : IntegrationTestBase
{
    public FederationWebhookSubscriptionTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ListWebhooks_Anonymous_Returns401()
    {
        ClearAuthToken();
        var resp = await Client.GetAsync("/api/v2/admin/federation/webhooks");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListWebhooks_Member_Returns403()
    {
        await AuthenticateAsMemberAsync();
        var resp = await Client.GetAsync("/api/v2/admin/federation/webhooks");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task ListWebhooks_Admin_EmptyList_Returns200()
    {
        await AuthenticateAsAdminAsync();
        var resp = await Client.GetAsync("/api/v2/admin/federation/webhooks");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CreateWebhook_Admin_Persists_TypedRow()
    {
        await AuthenticateAsAdminAsync();
        var payload = new
        {
            name = "Outbound test hook",
            target_url = "https://example.test/hooks/x",
            event_types = "listings.shared,events.shared",
            direction = "outbound",
            status = "active"
        };
        var createResp = await Client.PostAsJsonAsync("/api/v2/admin/federation/webhooks", payload);
        createResp.StatusCode.Should().Be(HttpStatusCode.Created);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var any = await db.FederationWebhookSubscriptions
            .IgnoreQueryFilters()
            .AnyAsync(s => s.TargetUrl == payload.target_url);
        any.Should().BeTrue("create should write a typed entity row");
    }

    [Fact]
    public async Task DeleteWebhook_Admin_RemovesRow()
    {
        await AuthenticateAsAdminAsync();
        var payload = new
        {
            name = "to-delete",
            target_url = "https://example.test/hooks/del",
            event_types = "listings.shared",
            direction = "outbound",
            status = "active"
        };
        var createResp = await Client.PostAsJsonAsync("/api/v2/admin/federation/webhooks", payload);
        createResp.EnsureSuccessStatusCode();
        var created = await createResp.Content.ReadFromJsonAsync<CreateResponse>();
        created.Should().NotBeNull();
        var id = created!.Data!.Id;

        var delResp = await Client.DeleteAsync($"/api/v2/admin/federation/webhooks/{id}");
        delResp.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stillThere = await db.FederationWebhookSubscriptions
            .IgnoreQueryFilters()
            .AnyAsync(s => s.Id == id);
        stillThere.Should().BeFalse();
    }

    [Fact]
    public async Task LegacyTenantConfigBlob_MigratesOnServiceCall()
    {
        // Verify the legacy migration by invoking the service directly.
        // (Going through the HTTP endpoint adds tenant-context overhead that
        //  is covered separately by the other tests in this class.)
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var service = scope.ServiceProvider.GetRequiredService<Nexus.Api.Services.Federation.IFederationWebhookSubscriptionService>();
        var tenantId = TestData.Tenant1.Id;

        // Clean slate.
        var existing = db.FederationWebhookSubscriptions.IgnoreQueryFilters()
            .Where(s => s.TenantId == tenantId).ToList();
        db.FederationWebhookSubscriptions.RemoveRange(existing);
        var existingLegacy = db.TenantConfigs.IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "admin_explicit.federation.webhooks").ToList();
        db.TenantConfigs.RemoveRange(existingLegacy);
        await db.SaveChangesAsync();

        var legacyJson = "[{\"id\":1,\"name\":\"Legacy hook A\",\"status\":\"active\",\"payload\":{\"target_url\":\"https://legacy.test/a\",\"event_types\":\"listings.shared\",\"direction\":\"outbound\"},\"created_at\":\"2024-01-01T00:00:00Z\",\"updated_at\":\"2024-01-01T00:00:00Z\",\"deleted_at\":null}]";
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "admin_explicit.federation.webhooks",
            Value = legacyJson,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        await service.EnsureLegacyMigratedAsync(tenantId);

        var migrated = await db.FederationWebhookSubscriptions
            .IgnoreQueryFilters()
            .Where(s => s.TenantId == tenantId && s.TargetUrl == "https://legacy.test/a")
            .ToListAsync();
        migrated.Should().HaveCount(1, "the legacy blob should have been promoted to a typed row");

        var legacyKey = await db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "admin_explicit.federation.webhooks")
            .FirstOrDefaultAsync();
        (legacyKey?.Value ?? string.Empty).Should().BeEmpty("legacy key should be cleared after migration");
    }

    private sealed class CreateResponse
    {
        public CreatedData? Data { get; set; }
    }

    private sealed class CreatedData
    {
        public int Id { get; set; }
    }
}
