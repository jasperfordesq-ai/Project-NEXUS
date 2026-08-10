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
public sealed class EventPeopleWorkflowParityTests : IntegrationTestBase
{
    public EventPeopleWorkflowParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Relationship_ReturnsCanonicalPrivateSelfProjectionOnBothAliases()
    {
        var eventId = await EventWithPendingMemberAsync("confirmed");
        await AuthenticateAsMemberAsync();
        foreach (var prefix in new[] { "/api/events", "/api/v2/events" })
        {
            var response = await Client.GetAsync($"{prefix}/{eventId}/relationship");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            response.Headers.CacheControl!.NoStore.Should().BeTrue();
            var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            data.GetProperty("contract_version").GetInt32().Should().Be(1);
            data.GetProperty("member_id").GetInt32().Should().Be(TestData.MemberUser.Id);
            data.GetProperty("registration").GetProperty("state").GetString().Should().Be("confirmed");
            data.GetProperty("capacity").GetProperty("confirmed").GetInt32().Should().Be(1);
            data.GetProperty("actions").GetProperty("withdraw").GetBoolean().Should().BeTrue();
            data.GetProperty("privacy").GetProperty("sensitive_fields_redacted").GetBoolean().Should().BeTrue();
            data.ToString().ToLowerInvariant().Should().NotContain("email").And.NotContain("notes");
        }
        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/relationship")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task List_FiltersPaginatesAndReturnsStrictRedactedProjection()
    {
        var eventId = await EventWithPendingMemberAsync(); await AuthenticateAsAdminAsync(); var response = await Client.GetAsync($"/api/v2/events/{eventId}/people?registration_state=pending&sort=name&direction=asc"); response.StatusCode.Should().Be(HttpStatusCode.OK); response.Headers.CacheControl!.NoStore.Should().BeTrue(); var json = await response.Content.ReadFromJsonAsync<JsonElement>(); json.GetProperty("data").GetArrayLength().Should().Be(1); var person = json.GetProperty("data")[0]; person.GetProperty("member").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id); person.ToString().ToLowerInvariant().Should().NotContain("email").And.NotContain("notes"); person.GetProperty("privacy").GetProperty("sensitive_fields_redacted").GetBoolean().Should().BeTrue(); var meta = json.GetProperty("meta"); meta.GetProperty("projection").GetString().Should().Be("full"); meta.GetProperty("capabilities").GetProperty("manage_attendance").GetBoolean().Should().BeTrue();
        (await Client.GetAsync($"/api/v2/events/{eventId}/people?unknown=x")).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task ManagerRegistrationTransitions_AreVersionedAndAppearInUnifiedHistory()
    {
        var eventId = await EventWithPendingMemberAsync(); await AuthenticateAsAdminAsync(); var approved = await Post($"/api/v2/events/{eventId}/people/{TestData.MemberUser.Id}/approve", new { expected_version = 1 }, "people-approve-0001"); approved.StatusCode.Should().Be(HttpStatusCode.OK); var a = (await approved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); a.GetProperty("state").GetString().Should().Be("confirmed"); a.GetProperty("version").GetInt64().Should().Be(2);
        var replay = await Post($"/api/v2/events/{eventId}/people/{TestData.MemberUser.Id}/approve", new { expected_version = 1 }, "people-approve-0001"); (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        var cancelled = await Post($"/api/v2/events/{eventId}/people/{TestData.MemberUser.Id}/cancel", new { expected_version = 2, reason = "Duplicate booking" }, "people-cancel-0001"); cancelled.StatusCode.Should().Be(HttpStatusCode.OK);
        var history = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}/people/{TestData.MemberUser.Id}/history"); history.GetProperty("data").GetArrayLength().Should().Be(3); history.GetProperty("data").EnumerateArray().Should().OnlyContain(x => x.GetProperty("axis").GetString() == "registration"); history.GetProperty("meta").GetProperty("sensitive_fields_redacted").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task AttendanceTransitions_EnforceVersionAndAppendImmutableActivity()
    {
        var eventId = await EventWithPendingMemberAsync("confirmed"); await AuthenticateAsAdminAsync(); var checkIn = await Post($"/api/v2/events/{eventId}/people/{TestData.MemberUser.Id}/attendance", new { action = "check_in", expected_version = 0 }, "people-checkin-0001"); checkIn.StatusCode.Should().Be(HttpStatusCode.OK); var first = (await checkIn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("mutation"); first.GetProperty("to_state").GetString().Should().Be("checked_in"); first.GetProperty("attendance_version").GetInt64().Should().Be(1);
        var stale = await Post($"/api/v2/events/{eventId}/people/{TestData.MemberUser.Id}/attendance", new { action = "check_out", expected_version = 0 }, "people-checkout-stale"); stale.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var checkOut = await Post($"/api/v2/events/{eventId}/people/{TestData.MemberUser.Id}/attendance", new { action = "check_out", expected_version = 1 }, "people-checkout-0001"); checkOut.StatusCode.Should().Be(HttpStatusCode.OK);
        var undo = await Post($"/api/v2/events/{eventId}/people/{TestData.MemberUser.Id}/attendance", new { action = "undo", expected_version = 2, reason = "Scanner mistake" }, "people-undo-0001"); undo.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var fact = await db.EventAttendance.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId); fact.AttendanceVersion.Should().Be(3); fact.AttendanceStatus.Should().Be("not_checked_in"); var activity = await db.EventAttendanceActivity.IgnoreQueryFilters().Where(x => x.AttendanceId == fact.Id).ToListAsync(); activity.Should().HaveCount(3); var mutate = async () => await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE event_attendance_activity SET \"Action\" = {'x'} WHERE \"Id\" = {activity[0].Id}"); await mutate.Should().ThrowAsync<PostgresException>().Where(x => x.SqlState == "P0001");
    }

    [Fact]
    public async Task BulkCsvAndTenantAuthorization_AreBoundedSafeAndPrivate()
    {
        var eventId = await EventWithPendingMemberAsync(); await AuthenticateAsAdminAsync(); var bulk = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/people/bulk", new { operations = new object[] { new { user_id = TestData.MemberUser.Id, action = "approve", expected_version = 1, idempotency_key = "bulk-approve-0001" }, new { user_id = TestData.MemberUser.Id, action = "check_in", expected_version = 0, idempotency_key = "bulk-checkin-0001" } } }); bulk.StatusCode.Should().Be(HttpStatusCode.OK); var b = (await bulk.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); b.GetProperty("requested").GetInt32().Should().Be(2); b.GetProperty("succeeded").GetInt32().Should().Be(2);
        using (var scope = Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var user = await db.Users.IgnoreQueryFilters().SingleAsync(x => x.Id == TestData.MemberUser.Id); user.FirstName = "=Injected"; await db.SaveChangesAsync(); }
        var csv = await Client.GetAsync($"/api/v2/events/{eventId}/people/export.csv"); csv.StatusCode.Should().Be(HttpStatusCode.OK); csv.Content.Headers.ContentType!.MediaType.Should().Be("text/csv"); (await csv.Content.ReadAsStringAsync()).Should().Contain("'=Injected"); csv.Headers.CacheControl!.NoStore.Should().BeTrue();
        await AuthenticateAsOtherTenantUserAsync(); (await Client.GetAsync($"/api/v2/events/{eventId}/people")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<int> EventWithPendingMemberAsync(string state = "pending") { using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "People event", MaxAttendees = 20, StartsAt = DateTime.UtcNow.AddDays(2), EndsAt = DateTime.UtcNow.AddDays(2).AddHours(2), Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled" }; db.Events.Add(evt); await db.SaveChangesAsync(); var now = DateTime.UtcNow; var registration = new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, RegistrationState = state, StateChangedAt = now, StateChangedBy = TestData.MemberUser.Id, PendingAt = state == "pending" ? now : null, ConfirmedAt = state == "confirmed" ? now : null }; db.EventRegistrations.Add(registration); await db.SaveChangesAsync(); db.EventRegistrationHistory.Add(new EventRegistrationHistory { TenantId = TestData.Tenant1.Id, EventId = evt.Id, RegistrationId = registration.Id, UserId = TestData.MemberUser.Id, ActorUserId = TestData.MemberUser.Id, RegistrationVersion = 1, Action = state, ToState = state, IdempotencyKey = $"seed-{Guid.NewGuid():N}", Metadata = "{}" }); await db.SaveChangesAsync(); return evt.Id; }
    private Task<HttpResponseMessage> Post(string path, object body, string key) { var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return Client.SendAsync(request); }
}
