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
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Volunteer emergency alerts.
///
/// 🔴 The most dangerous stub found in this backend. POST returned
/// {status:"sent"} with a hashed id and stored nothing. This is the alert a
/// volunteer or coordinator raises when something goes wrong on a shift —
/// someone hurt, someone missing, a situation needing help. It reported "sent"
/// while no record existed and nobody could see it.
///
/// The GET and the store both existed the whole time, so the list showed seeded
/// demo alerts and swallowed every real one — which is why nothing looked
/// broken.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerEmergencyAlertTests : IntegrationTestBase
{
    public VolunteerEmergencyAlertTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task RaisingAnAlert_StoresIt_AndItAppearsInTheList()
    {
        await AuthenticateAsMemberAsync();
        var title = $"Volunteer in difficulty {Guid.NewGuid():N}"[..32];

        var created = await Client.PostAsJsonAsync("/api/v2/volunteering/emergency-alerts", new
        {
            title,
            description = "Needs assistance at the community garden.",
            urgency = "critical",
        });

        created.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = body.GetProperty("data").GetProperty("id").GetInt32();
        id.Should().BeGreaterThan(0, "the stub returned a hash of the message as an id");
        body.GetProperty("data").GetProperty("urgency").GetString().Should().Be("critical");

        // 🔴 The read-back is the whole point: the write must land in the SAME
        // store the list reads from. Three alert tables exist in this backend,
        // and writing to the wrong one would be a phantom write — the same
        // failure as the stub, only harder to spot.
        var list = await Client.GetAsync("/api/v2/volunteering/emergency-alerts");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        (await list.Content.ReadAsStringAsync()).Should().Contain(title,
            "an alert nobody can see is the same as an alert never raised");
    }

    [Fact]
    public async Task RaisingAnAlert_NotifiesSomebody()
    {
        await AuthenticateAsMemberAsync();
        var title = $"Alert with notification {Guid.NewGuid():N}"[..30];

        var created = await Client.PostAsJsonAsync("/api/v2/volunteering/emergency-alerts", new
        {
            title,
            description = "Please respond.",
            urgency = "high",
        });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var notified = await db.Set<Notification>().IgnoreQueryFilters().AsNoTracking()
            .CountAsync(n => n.Type == "volunteer_emergency_alert"
                && n.Data == $"volunteer_emergency_alert:{id}");

        notified.Should().BeGreaterThan(0,
            "an emergency stored but not surfaced to a human is only marginally better than one lost");
    }

    [Fact]
    public async Task AnAlertWithoutATitle_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/volunteering/emergency-alerts", new
        {
            description = "no title supplied",
        });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task StandingDownAnAlert_RemovesItFromTheActiveList_ButKeepsTheRecord()
    {
        await AuthenticateAsMemberAsync();
        var title = $"Stand down {Guid.NewGuid():N}"[..26];

        var created = await Client.PostAsJsonAsync("/api/v2/volunteering/emergency-alerts", new
        {
            title,
            description = "Resolved on site.",
            urgency = "medium",
        });
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        var deleted = await Client.DeleteAsync($"/api/v2/volunteering/emergency-alerts/{id}");
        deleted.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var list = await Client.GetAsync("/api/v2/volunteering/emergency-alerts");
        (await list.Content.ReadAsStringAsync()).Should().NotContain(title,
            "a stood-down alert must leave the active list");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Set<EmergencyAlert>().IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(a => a.Id == id);
        stored.Should().NotBeNull("an emergency that happened is a record worth keeping");
        stored!.IsActive.Should().BeFalse();
        stored.ResolvedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task StandingDownAnAlertThatDoesNotExist_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.DeleteAsync("/api/v2/volunteering/emergency-alerts/99999999");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "the stub returned 204 for anything, so a typo looked like a successful stand-down");
    }
}
