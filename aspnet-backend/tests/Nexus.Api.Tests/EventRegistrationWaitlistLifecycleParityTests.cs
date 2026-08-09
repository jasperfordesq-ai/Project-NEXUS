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
public sealed class EventRegistrationWaitlistLifecycleParityTests : IntegrationTestBase
{
    public EventRegistrationWaitlistLifecycleParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ConfirmAndWithdraw_AreVersionedIdempotentAndCapacityAware()
    {
        var eventId = await EventAsync(2); await AuthenticateAsMemberAsync();
        var first = await Post($"/api/v2/events/{eventId}/registration/confirm", new { }, "registration-confirm-0001"); first.StatusCode.Should().Be(HttpStatusCode.OK); var data = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); data.GetProperty("contract_version").GetInt32().Should().Be(2); data.GetProperty("relationship").GetProperty("registration").GetProperty("state").GetString().Should().Be("confirmed"); data.GetProperty("mutation").GetProperty("changed").GetBoolean().Should().BeTrue();
        var replay = await Post($"/api/v2/events/{eventId}/registration/confirm", new { }, "registration-confirm-0001"); (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("mutation").GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        var withdrawn = await Post($"/api/v2/events/{eventId}/registration/withdraw", new { reason = "Plans changed" }, "registration-withdraw-0001"); withdrawn.StatusCode.Should().Be(HttpStatusCode.OK); var w = (await withdrawn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); w.GetProperty("relationship").GetProperty("registration").GetProperty("state").GetString().Should().Be("cancelled"); w.GetProperty("mutation").GetProperty("released_capacity").GetBoolean().Should().BeTrue();
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var registration = await db.EventRegistrations.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId && x.UserId == TestData.MemberUser.Id); registration.RegistrationVersion.Should().Be(2); (await db.EventRegistrationHistory.IgnoreQueryFilters().CountAsync(x => x.RegistrationId == registration.Id)).Should().Be(2); (await db.EventDomainOutbox.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId && x.AggregateStream == "registration")).Should().Be(2);
    }

    [Fact]
    public async Task FullEventWaitlist_OffersReleasedCapacityAndAcceptsExactlyOnce()
    {
        var eventId = await EventAsync(1, seedAdminRegistration: true); await AuthenticateAsMemberAsync();
        var full = await Post($"/api/v2/events/{eventId}/registration/confirm", new { }, "registration-full-0001"); full.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var joined = await Post($"/api/v2/events/{eventId}/registration/waitlist", new { }, "waitlist-join-0001"); joined.StatusCode.Should().Be(HttpStatusCode.Created); var j = (await joined.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); j.GetProperty("relationship").GetProperty("registration").GetProperty("state").GetString().Should().Be("waitlisted"); j.GetProperty("waitlist_position").GetInt64().Should().Be(1);
        await AuthenticateAsAdminAsync(); var release = await Post($"/api/v2/events/{eventId}/registration/withdraw", new { reason = "Organizer released place" }, "registration-admin-withdraw"); release.StatusCode.Should().Be(HttpStatusCode.OK); (await release.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("mutation").GetProperty("next_offer_created").GetBoolean().Should().BeTrue();
        await AuthenticateAsMemberAsync(); var accepted = await Post($"/api/v2/events/{eventId}/registration/waitlist/accept", new { }, "waitlist-accept-0001"); accepted.StatusCode.Should().Be(HttpStatusCode.OK); var a = (await accepted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); a.GetProperty("relationship").GetProperty("registration").GetProperty("state").GetString().Should().Be("confirmed"); a.GetProperty("relationship").GetProperty("waitlist").GetProperty("state").GetString().Should().Be("accepted"); a.GetProperty("relationship").GetProperty("waitlist").GetProperty("offer_active").GetBoolean().Should().BeFalse();
        var replay = await Post($"/api/v2/events/{eventId}/registration/waitlist/accept", new { }, "waitlist-accept-0001"); (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("mutation").GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task LeaveWaitlist_RecordsReasonAndSupportsLaterQueueCycle()
    {
        var eventId = await EventAsync(1, seedAdminRegistration: true); await AuthenticateAsMemberAsync(); await Post($"/api/v2/events/{eventId}/registration/waitlist", new { }, "waitlist-cycle-join-1");
        var left = await Post($"/api/v2/events/{eventId}/registration/waitlist/leave", new { reason = "Cannot attend" }, "waitlist-cycle-leave-1"); left.StatusCode.Should().Be(HttpStatusCode.OK); (await left.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("relationship").GetProperty("waitlist").GetProperty("state").GetString().Should().Be("cancelled");
        var rejoined = await Post($"/api/v2/events/{eventId}/registration/waitlist", new { }, "waitlist-cycle-join-2"); rejoined.StatusCode.Should().Be(HttpStatusCode.Created);
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var entry = await db.EventWaitlistEntries.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId && x.UserId == TestData.MemberUser.Id); entry.QueueVersion.Should().Be(3); entry.QueueSequence.Should().Be(1); (await db.EventWaitlistEntryHistory.IgnoreQueryFilters().CountAsync(x => x.WaitlistEntryId == entry.Id)).Should().Be(3);
    }

    [Fact]
    public async Task TenantIsolationValidationAndHistoryImmutability_FailClosed()
    {
        var eventId = await EventAsync(2); await AuthenticateAsMemberAsync(); (await Post($"/api/v2/events/{eventId}/registration/confirm", new { }, "short")).StatusCode.Should().Be(HttpStatusCode.OK); // Laravel permits any non-empty key up to 191
        await AuthenticateAsOtherTenantUserAsync(); (await Post($"/api/v2/events/{eventId}/registration/confirm", new { }, "tenant-registration-hidden")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var history = await db.EventRegistrationHistory.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId); var mutate = async () => await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE event_registration_history SET \"Action\" = {'x'} WHERE \"Id\" = {history.Id}"); await mutate.Should().ThrowAsync<PostgresException>().Where(x => x.SqlState == "P0001");
    }

    private async Task<int> EventAsync(int capacity, bool seedAdminRegistration = false) { using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "Capacity event", MaxAttendees = capacity, StartsAt = DateTime.UtcNow.AddDays(3), EndsAt = DateTime.UtcNow.AddDays(3).AddHours(2), Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled" }; db.Events.Add(evt); await db.SaveChangesAsync(); if (seedAdminRegistration) { db.EventRegistrations.Add(new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.AdminUser.Id, RegistrationState = "confirmed", ConfirmedAt = DateTime.UtcNow, StateChangedAt = DateTime.UtcNow, StateChangedBy = TestData.AdminUser.Id }); await db.SaveChangesAsync(); } return evt.Id; }
    private Task<HttpResponseMessage> Post(string path, object body, string key) { var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return Client.SendAsync(request); }
}
