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
public sealed class EventAgendaWorkflowParityTests : IntegrationTestBase
{
    public EventAgendaWorkflowParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task OwnerLifecycle_IsVersionedIdempotentAndPrivate()
    {
        var (eventId, start) = await EventAsync(); await AuthenticateAsAdminAsync();
        var created = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions", Session(start, "Opening", "Hall A"), "agenda-create-0001"); created.StatusCode.Should().Be(HttpStatusCode.Created); created.Headers.CacheControl!.NoStore.Should().BeTrue(); var data = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); var sessionId = data.GetProperty("session").GetProperty("id").GetInt64(); data.GetProperty("agenda_version").GetInt64().Should().Be(1); data.GetProperty("session").GetProperty("resources")[0].GetProperty("url").GetString().Should().Be("https://example.test/slides");
        var replay = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions", Session(start, "Opening", "Hall A"), "agenda-create-0001"); (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        var updated = await Send(HttpMethod.Put, $"/api/v2/events/{eventId}/agenda/sessions/{sessionId}", Session(start, "Opening keynote", "Hall A", 1), "agenda-update-0001"); updated.StatusCode.Should().Be(HttpStatusCode.OK); var u = (await updated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); u.GetProperty("session").GetProperty("version").GetInt64().Should().Be(2); u.GetProperty("agenda_version").GetInt64().Should().Be(2);
        var cancelled = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions/{sessionId}/cancel", new { expected_version = 2, reason = "Speaker unavailable" }, "agenda-cancel-0001"); cancelled.StatusCode.Should().Be(HttpStatusCode.OK); (await cancelled.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("session").GetProperty("status").GetString().Should().Be("cancelled");
    }

    [Fact]
    public async Task MemberVisibilityAndRegistration_RequireCanonicalEventRegistrationAndCapacity()
    {
        var (eventId, start) = await EventAsync(seedRegistration: true); await AuthenticateAsAdminAsync(); var created = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions", Session(start, "Workshop", "Room 1", capacity: 1, visibility: "registered"), "agenda-member-create"); var sessionId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("session").GetProperty("id").GetInt64();
        await AuthenticateAsMemberAsync(); var agenda = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}/agenda"); agenda.GetProperty("data").GetProperty("sessions").GetArrayLength().Should().Be(1); var registered = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions/{sessionId}/registration", new { expected_version = 0 }, "agenda-register-0001"); registered.StatusCode.Should().Be(HttpStatusCode.OK); var r = (await registered.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data"); r.GetProperty("registration_version").GetInt64().Should().Be(1); r.GetProperty("session").GetProperty("registration").GetProperty("state").GetString().Should().Be("registered");
        var withdrawn = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions/{sessionId}/registration/withdraw", new { expected_version = 1 }, "agenda-withdraw-0001"); withdrawn.StatusCode.Should().Be(HttpStatusCode.OK); (await withdrawn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("registration_version").GetInt64().Should().Be(2);
    }

    [Fact]
    public async Task ConflictsValidationAndTenantBoundary_FailClosed()
    {
        var (eventId, start) = await EventAsync(); await AuthenticateAsAdminAsync(); var first = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions", Session(start, "First", "Shared"), "agenda-conflict-first"); first.StatusCode.Should().Be(HttpStatusCode.Created); var conflict = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions", Session(start.AddMinutes(15), "Second", "Shared"), "agenda-conflict-second"); conflict.StatusCode.Should().Be(HttpStatusCode.Conflict); (await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions", Session(start, "Bad", "Other"), "")).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity); await AuthenticateAsOtherTenantUserAsync(); (await Client.GetAsync($"/api/v2/events/{eventId}/agenda")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AgendaAndRegistrationMutations_RecordDurableVersionedHistory()
    {
        var (eventId, start) = await EventAsync(seedRegistration: true); await AuthenticateAsAdminAsync(); var created = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions", Session(start, "Immutable", "Hall"), "agenda-immutable-create"); var sessionId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("session").GetProperty("id").GetInt64(); await AuthenticateAsMemberAsync(); await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/agenda/sessions/{sessionId}/registration", new { expected_version = 0 }, "agenda-immutable-register");
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var history = await db.EventSessionHistory.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId); history.Action.Should().Be("created"); history.AgendaVersion.Should().Be(1); var registrationHistory = await db.EventSessionRegistrationHistory.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId); registrationHistory.Action.Should().Be("registered"); registrationHistory.RegistrationVersion.Should().Be(1);
    }

    private async Task<(int Id, DateTime Start)> EventAsync(bool seedRegistration = false) { using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var start = DateTime.UtcNow.AddDays(4); var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "Agenda event", StartsAt = start.AddHours(-1), EndsAt = start.AddHours(6), Timezone = "Europe/Dublin", Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled" }; db.Events.Add(evt); await db.SaveChangesAsync(); if (seedRegistration) { db.EventRegistrations.Add(new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, RegistrationState = "confirmed", ConfirmedAt = DateTime.UtcNow, StateChangedAt = DateTime.UtcNow, StateChangedBy = TestData.MemberUser.Id }); await db.SaveChangesAsync(); } return (evt.Id, start); }
    private static object Session(DateTime start, string title, string room, long? expected = null, int? capacity = null, string visibility = "public") { var body = new Dictionary<string, object?> { ["title"] = title, ["description"] = "<b>Useful</b> session", ["type"] = "workshop", ["visibility"] = visibility, ["capacity"] = capacity, ["start_at"] = start.ToString("O"), ["end_at"] = start.AddHours(1).ToString("O"), ["timezone"] = "Europe/Dublin", ["room"] = room, ["track"] = "Main", ["position"] = 0, ["speakers"] = new[] { new { display_name = "Guest Speaker", role = "Host", position = 0 } }, ["resources"] = new[] { new { type = "slides", visibility = "public", title = "Slides", url = "https://example.test/slides", position = 0 } } }; if (expected is not null) body["expected_version"] = expected.Value; return body; }
    private Task<HttpResponseMessage> Send(HttpMethod method, string path, object body, string key) { var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) }; if (key.Length > 0) request.Headers.Add("Idempotency-Key", key); return Client.SendAsync(request); }
}
