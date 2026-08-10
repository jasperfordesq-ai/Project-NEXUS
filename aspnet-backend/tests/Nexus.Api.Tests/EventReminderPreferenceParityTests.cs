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
public sealed class EventReminderPreferenceParityTests : IntegrationTestBase
{
    public EventReminderPreferenceParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ReplaceReadAndReset_AreVersionedTenantSafeAndCanonical()
    {
        var eventId = await PublishedEventAsync(); await AuthenticateAsMemberAsync();
        var initial = await Client.GetFromJsonAsync<JsonElement>($"/api/events/{eventId}/reminders");
        initial.GetProperty("data").GetProperty("revision").GetInt64().Should().Be(0);

        var payload = new
        {
            expected_revision = 0,
            overrides = new { email_enabled = true, in_app_enabled = (bool?)null, web_push_enabled = false, fcm_enabled = (bool?)null, realtime_enabled = true, cadence = "instant", reminders_enabled = true },
            rules = new[] { new { offset_minutes = 1440, enabled = true, email_enabled = (bool?)true, in_app_enabled = (bool?)null, web_push_enabled = (bool?)false, fcm_enabled = (bool?)null, realtime_enabled = (bool?)true } }
        };
        var replaced = await Client.PutAsJsonAsync($"/api/v2/events/{eventId}/reminders", payload);
        replaced.StatusCode.Should().Be(HttpStatusCode.OK); replaced.Headers.CacheControl!.NoStore.Should().BeTrue();
        var data = (await replaced.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("revision").GetInt64().Should().Be(1); data.GetProperty("rules").GetArrayLength().Should().Be(1);
        data.GetProperty("rules")[0].GetProperty("offset_minutes").GetInt32().Should().Be(1440);
        data.GetProperty("resolved").GetProperty("channels").GetProperty("email").GetBoolean().Should().BeTrue();

        (await Client.PutAsJsonAsync($"/api/v2/events/{eventId}/reminders", payload)).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var reset = await Client.DeleteAsync($"/api/v2/events/{eventId}/reminders?expected_revision=1");
        reset.StatusCode.Should().Be(HttpStatusCode.OK);
        var resetData = (await reset.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        resetData.GetProperty("revision").GetInt64().Should().Be(0); resetData.GetProperty("rules").GetArrayLength().Should().Be(0);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.EventReminderRulesProduct.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId)).Enabled.Should().BeFalse();
        }
        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/reminders")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ValidationRejectsUnknownFieldsDuplicateOffsetsAndTemplates()
    {
        var eventId = await PublishedEventAsync(); await AuthenticateAsMemberAsync();
        var unknown = await Client.PutAsJsonAsync($"/api/v2/events/{eventId}/reminders", new { expected_revision = 0, overrides = new { surprise = true }, rules = Array.Empty<object>() });
        unknown.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var duplicate = await Client.PutAsJsonAsync($"/api/v2/events/{eventId}/reminders", new { expected_revision = 0, overrides = new { }, rules = new[] { new { offset_minutes = 60 }, new { offset_minutes = 60 } } });
        duplicate.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        using (var scope = Factory.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var evt = await db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == eventId); evt.IsRecurringTemplate = true; await db.SaveChangesAsync(); }
        (await Client.GetAsync($"/api/v2/events/{eventId}/reminders")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<int> PublishedEventAsync()
    {
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "Reminder preferences", StartsAt = DateTime.UtcNow.AddDays(5), EndsAt = DateTime.UtcNow.AddDays(5).AddHours(1), Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled" };
        db.Events.Add(evt); await db.SaveChangesAsync(); return evt.Id;
    }
}
