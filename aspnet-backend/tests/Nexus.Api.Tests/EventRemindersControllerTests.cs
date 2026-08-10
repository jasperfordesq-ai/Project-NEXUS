// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class EventRemindersControllerTests : IntegrationTestBase
{
    public EventRemindersControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetMyReminders_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/users/me/reminders");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetMyReminders_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/users/me/reminders");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetEventReminders_NonExistentEvent_ReturnsNotFoundOrOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/events/99999/reminders");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateReminder_NonExistentEvent_ReturnsBadRequestOrNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/events/99999/reminders", new
        {
            minutes_before = 30,
            reminder_type = "email"
        });
        // Controller returns BadRequest when service returns error for non-existent event
        r.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteReminder_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.DeleteAsync("/api/events/99999/reminders/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
