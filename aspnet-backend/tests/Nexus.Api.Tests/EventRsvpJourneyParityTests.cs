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

[Collection("Integration")]
public sealed class EventRsvpJourneyParityTests : IntegrationTestBase
{
    public EventRsvpJourneyParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CanonicalRsvp_ReturnsClientContractAndSurvivesDetailReload()
    {
        var eventId = await CreateEventAsync();
        await AuthenticateAsMemberAsync();
        Client.DefaultRequestHeaders.Add("X-Events-Contract", "2");

        var response = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/rsvp", new
        {
            status = "going",
            user_id = TestData.AdminUser.Id,
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.GetValues("X-Events-Contract").Should().ContainSingle("2");
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("contract_version").GetInt32().Should().Be(2);
        data.GetProperty("event_id").GetInt32().Should().Be(eventId);
        data.GetProperty("status").GetString().Should().Be("going");
        data.GetProperty("relationship").GetProperty("registration").GetProperty("state")
            .GetString().Should().Be("confirmed");
        data.GetProperty("metrics").GetProperty("confirmed_count").GetInt32().Should().Be(1);
        data.GetProperty("rsvp_counts").GetProperty("going").GetInt32().Should().Be(1);
        data.GetProperty("waitlist_position").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("message").ValueKind.Should().Be(JsonValueKind.Null);

        var detail = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}");
        detail.GetProperty("data").GetProperty("relationship").GetProperty("registration")
            .GetProperty("state").GetString().Should().Be("confirmed");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var saved = await db.EventRsvps.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(rsvp => rsvp.EventId == eventId);
        saved.UserId.Should().Be(TestData.MemberUser.Id,
            "self-service RSVP must ignore a body-supplied user_id");
        saved.Status.Should().Be("going");
    }

    [Fact]
    public async Task InterestedRsvp_IsReflectedInCanonicalCountsAndReloadedRelationship()
    {
        var eventId = await CreateEventAsync();
        await AuthenticateAsMemberAsync();
        Client.DefaultRequestHeaders.Add("X-Events-Contract", "2");

        var response = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/rsvp", new
        {
            status = "interested",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("relationship").GetProperty("engagement").GetProperty("state")
            .GetString().Should().Be("interested");
        data.GetProperty("metrics").GetProperty("interested_count").GetInt32().Should().Be(1);
        data.GetProperty("rsvp_counts").GetProperty("interested").GetInt32().Should().Be(1);

        var detail = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}");
        detail.GetProperty("data").GetProperty("relationship").GetProperty("engagement")
            .GetProperty("state").GetString().Should().Be("interested");
    }

    private async Task<int> CreateEventAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var ev = new Event
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.AdminUser.Id,
            Title = "RSVP journey event",
            StartsAt = DateTime.UtcNow.AddDays(2),
            EndsAt = DateTime.UtcNow.AddDays(2).AddHours(1),
            Status = "active",
            PublicationStatus = "published",
            OperationalStatus = "scheduled",
            MaxAttendees = 10,
        };
        db.Events.Add(ev);
        await db.SaveChangesAsync();
        return ev.Id;
    }
}
