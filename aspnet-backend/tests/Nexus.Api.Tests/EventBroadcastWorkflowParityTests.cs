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
using Npgsql;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventBroadcastWorkflowParityTests : IntegrationTestBase
{
    public EventBroadcastWorkflowParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task PreviewCreateListAndShow_MatchPrivateReactContract()
    {
        var eventId = await EventWithAudienceAsync(); await AuthenticateAsMemberAsync(); var input = Content();
        var preview = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/broadcasts/preview", input);
        preview.StatusCode.Should().Be(HttpStatusCode.OK); preview.Headers.CacheControl!.NoStore.Should().BeTrue();
        var p = (await preview.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); p.GetProperty("contract_version").GetInt32().Should().Be(1); p.GetProperty("recipient_count").GetInt32().Should().Be(1); p.GetProperty("delivery_count").GetInt32().Should().Be(2);

        var created = await Post($"/api/v2/events/{eventId}/broadcasts", input, "broadcast-create-0001"); created.StatusCode.Should().Be(HttpStatusCode.Created); var c = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); var id = c.GetProperty("broadcast").GetProperty("id").GetInt64(); c.GetProperty("broadcast").GetProperty("body").GetString().Should().Be("Exact organizer prose.  ");
        var replay = await Post($"/api/v2/events/{eventId}/broadcasts", input, "broadcast-create-0001"); replay.StatusCode.Should().Be(HttpStatusCode.OK); (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        var list = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}/broadcasts"); list.GetProperty("data")[0].GetProperty("body").ValueKind.Should().Be(JsonValueKind.Null); list.GetProperty("meta").GetProperty("total").GetInt32().Should().Be(1);
        var show = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/event-broadcasts/{id}"); show.GetProperty("data").GetProperty("history").GetArrayLength().Should().Be(1);
    }

    [Fact]
    public async Task ReviseAndSchedule_FreezeCanonicalAudienceDeliveries()
    {
        var eventId = await EventWithAudienceAsync(includeLegacyRsvp: true); await AuthenticateAsMemberAsync(); var id = await CreateAsync(eventId, "broadcast-schedule-create");
        var revised = await Post($"/api/v2/event-broadcasts/{id}/revisions", new { expected_version = 1, variant = "announcement", segments = new[] { "registration_confirmed" }, channels = new[] { "email", "push" }, body = "Revised exact prose" }, "broadcast-revise-0001"); revised.StatusCode.Should().Be(HttpStatusCode.OK);
        var scheduled = await Post($"/api/v2/event-broadcasts/{id}/schedule", new { expected_version = 2, scheduled_at = DateTimeOffset.UtcNow.AddHours(1) }, "broadcast-schedule-0001"); scheduled.StatusCode.Should().Be(HttpStatusCode.OK); var data = (await scheduled.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); data.GetProperty("broadcast").GetProperty("status").GetString().Should().Be("scheduled"); data.GetProperty("broadcast").GetProperty("version").GetInt32().Should().Be(3);
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var deliveries = await db.EventBroadcastDeliveries.IgnoreQueryFilters().Where(x => x.BroadcastId == id).ToListAsync(); deliveries.Should().HaveCount(2).And.OnlyContain(x => x.RecipientUserId == TestData.AdminUser.Id && x.FrozenBroadcastVersion == 3 && x.Status == "pending");
        (await db.EventRsvps.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId)).Should().Be(1); // deliberately ignored by canonical resolver
    }

    [Fact]
    public async Task CancelRetryAndIdempotency_EnforceLifecycle()
    {
        var eventId = await EventWithAudienceAsync(); await AuthenticateAsMemberAsync(); var id = await CreateAsync(eventId, "broadcast-cancel-create"); await Post($"/api/v2/event-broadcasts/{id}/schedule", new { expected_version = 1, scheduled_at = DateTimeOffset.UtcNow.AddHours(1) }, "broadcast-cancel-schedule");
        var conflict = await Post($"/api/v2/event-broadcasts/{id}/cancel", new { expected_version = 2, reason = "No longer required" }, "broadcast-cancel-schedule"); conflict.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var cancelled = await Post($"/api/v2/event-broadcasts/{id}/cancel", new { expected_version = 2, reason = "No longer required" }, "broadcast-cancel-valid"); cancelled.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); (await db.EventBroadcastDeliveries.IgnoreQueryFilters().Where(x => x.BroadcastId == id).Select(x => x.Status).Distinct().SingleAsync()).Should().Be("cancelled");

        var failed = new EventBroadcast { TenantId = TestData.Tenant1.Id, EventId = eventId, Variant = "announcement", Status = "failed", BroadcastVersion = 4, AudienceSegments = "[\"registration_confirmed\"]", Channels = "[\"email\"]", Body = "Failed prose", ContentHash = new string('a', 64), RecipientCount = 1, DeliveryCount = 1, DeadLetterCount = 1, FailureCode = "event_broadcast_delivery_dead_lettered", FailedAt = DateTime.UtcNow, CreatedByUserId = TestData.MemberUser.Id, UpdatedByUserId = TestData.MemberUser.Id };
        db.EventBroadcasts.Add(failed); await db.SaveChangesAsync(); db.EventBroadcastDeliveries.Add(new EventBroadcastDelivery { TenantId = TestData.Tenant1.Id, EventId = eventId, BroadcastId = failed.Id, FrozenBroadcastVersion = 3, RecipientUserId = TestData.AdminUser.Id, Channel = "email", DeliveryKey = new string('b', 64), Status = "dead_letter", Attempts = 5, AvailableAt = DateTime.UtcNow, DeadLetteredAt = DateTime.UtcNow }); await db.SaveChangesAsync();
        var retry = await Post($"/api/v2/event-broadcasts/{failed.Id}/retry", new { expected_version = 4 }, "broadcast-retry-valid"); retry.StatusCode.Should().Be(HttpStatusCode.OK); (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("broadcast").GetProperty("status").GetString().Should().Be("scheduled");
    }

    [Fact]
    public async Task TenantAuthorizationValidationAndHistoryImmutability_FailClosed()
    {
        var eventId = await EventWithAudienceAsync(); await AuthenticateAsMemberAsync(); var invalid = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/broadcasts/preview", new { variant = "follow_up", segments = new[] { "registration_confirmed" }, channels = new[] { "email" } }); invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity); var id = await CreateAsync(eventId, "broadcast-security-create");
        await AuthenticateAsOtherTenantUserAsync(); (await Client.GetAsync($"/api/v2/event-broadcasts/{id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var history = await db.EventBroadcastHistory.IgnoreQueryFilters().SingleAsync(x => x.BroadcastId == id); var mutate = async () => await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE event_broadcast_history SET \"Action\" = {'x'} WHERE \"Id\" = {history.Id}"); await mutate.Should().ThrowAsync<PostgresException>().Where(x => x.SqlState == "P0001");
    }

    private static object Content() => new { variant = "announcement", segments = new[] { "registration_confirmed" }, channels = new[] { "email", "push" }, body = "Exact organizer prose.  " };
    private async Task<int> EventWithAudienceAsync(bool includeLegacyRsvp = false) { using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.MemberUser.Id, Title = "Broadcast event", StartsAt = DateTime.UtcNow.AddDays(2), EndsAt = DateTime.UtcNow.AddDays(2).AddHours(2), Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled" }; db.Events.Add(evt); await db.SaveChangesAsync(); db.EventRegistrations.Add(new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.AdminUser.Id, RegistrationState = "confirmed" }); if (includeLegacyRsvp) db.EventRsvps.Add(new EventRsvp { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, Status = "going" }); await db.SaveChangesAsync(); return evt.Id; }
    private async Task<long> CreateAsync(int eventId, string key) { var response = await Post($"/api/v2/events/{eventId}/broadcasts", Content(), key); response.StatusCode.Should().Be(HttpStatusCode.Created); return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("broadcast").GetProperty("id").GetInt64(); }
    private Task<HttpResponseMessage> Post(string path, object body, string key) { var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return Client.SendAsync(request); }
}
