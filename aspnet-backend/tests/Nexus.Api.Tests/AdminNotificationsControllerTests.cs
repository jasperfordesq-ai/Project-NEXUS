// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminNotificationsControllerTests : IntegrationTestBase
{
    public AdminNotificationsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetNotificationStats_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/admin/notifications/stats");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetNotificationStats_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/notifications/stats");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetNotificationStats_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/notifications/stats");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task BroadcastNotification_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync("/api/admin/notifications/broadcast", new
        {
            title = "Test Broadcast",
            message = "This is a test broadcast notification",
            type = "info"
        });
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CleanupNotifications_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.DeleteAsync("/api/admin/notifications/cleanup?days_old=90");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
