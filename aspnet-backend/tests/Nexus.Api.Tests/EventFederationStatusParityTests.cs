// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventFederationStatusParityTests : IntegrationTestBase
{
    public EventFederationStatusParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task PublishEnqueuesDurableDeliveryAndStatusIsPayloadFree()
    {
        var eventId = await DraftFederatedEventAsync(); await AuthenticateAsAdminAsync();
        var published = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/publish", new { });
        published.StatusCode.Should().Be(HttpStatusCode.OK);
        long deliveryId;
        long upsertVersion;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var evt = await db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == eventId);
            evt.FederationVersion.Should().BeGreaterThan(1);
            var delivery = await db.EventFederationDeliveries.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId);
            delivery.Action.Should().Be("upsert"); delivery.Status.Should().Be("pending"); delivery.IdempotencyKey.Should().MatchRegex("^[0-9a-f]{64}$");
            upsertVersion = delivery.EventAggregateVersion;
            delivery.Status = "dead_letter"; delivery.Attempts = 5; delivery.LastErrorCode = "REMOTE_HTTP_503";
            delivery.LastError = "PRIVATE RAW ERROR admin@example.test";
            delivery.Payload = "{\"meeting_link\":\"PRIVATE MEETING TOKEN\",\"claim_token\":\"PRIVATE CLAIM TOKEN\"}";
            delivery.DeadLetteredAt = DateTime.UtcNow; delivery.LastAttemptAt = DateTime.UtcNow; await db.SaveChangesAsync(); deliveryId = delivery.Id;
        }

        foreach (var prefix in new[] { "/api/events", "/api/v2/events" })
        {
            var response = await Client.GetAsync($"{prefix}/{eventId}/federation-status");
            response.StatusCode.Should().Be(HttpStatusCode.OK); response.Headers.CacheControl!.NoStore.Should().BeTrue();
            var vary = string.Join(",", response.Headers.Vary);
            vary.Should().Contain("Authorization").And.Contain("Cookie").And.Contain("X-Tenant-ID");
            var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            data.GetProperty("contract_version").GetInt32().Should().Be(1);
            data.GetProperty("event_id").GetInt32().Should().Be(eventId);
            data.GetProperty("health").GetString().Should().Be("degraded");
            data.GetProperty("counts").GetProperty("dead_letter").GetInt32().Should().Be(1);
            data.GetProperty("partners")[0].GetProperty("error_code").GetString().Should().Be("REMOTE_HTTP_503");
            var encoded = data.ToString(); encoded.Should().NotContain("PRIVATE").And.NotContain("admin@example.test").And.NotContain("payload_hash").And.NotContain("idempotency_key");
        }
        var cancelled = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/cancel", new { reason = "Venue unavailable" });
        cancelled.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var deliveries = await db.EventFederationDeliveries.IgnoreQueryFilters()
                .Where(x => x.EventId == eventId).OrderBy(x => x.EventAggregateVersion).ToListAsync();
            deliveries.Should().HaveCount(2);
            deliveries[^1].Action.Should().Be("tombstone");
            deliveries[^1].EventAggregateVersion.Should().BeGreaterThan(upsertVersion);
        }
        deliveryId.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task AttendeesAndForeignTenantsCannotReadOrganizerDiagnostics()
    {
        var eventId = await DraftFederatedEventAsync(); await AuthenticateAsMemberAsync();
        var forbidden = await Client.GetAsync($"/api/v2/events/{eventId}/federation-status");
        forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await forbidden.Content.ReadAsStringAsync()).Should().Contain("EVENT_FEDERATION_FORBIDDEN");
        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/federation-status")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<int> DraftFederatedEventAsync()
    {
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var partner = new FederationExternalPartner { TenantId = TestData.Tenant1.Id, Name = "Federation partner", BaseUrl = $"https://partner-{Guid.NewGuid():N}.example.test", ProtocolType = "nexus", Status = "active", AllowEvents = true };
        db.FederationExternalPartners.Add(partner);
        var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "Federated event", StartsAt = DateTime.UtcNow.AddDays(7), EndsAt = DateTime.UtcNow.AddDays(7).AddHours(1), Status = "draft", PublicationStatus = "draft", OperationalStatus = "scheduled", FederatedVisibility = "listed" };
        db.Events.Add(evt); await db.SaveChangesAsync(); return evt.Id;
    }
}
