// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminEventsControllerTests : IntegrationTestBase
{
    public AdminEventsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetEvents_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/admin/events");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetEvents_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/events");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetEvents_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/events");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetEventStats_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/events/stats");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CancelEvent_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PutAsync("/api/admin/events/99999/cancel", null);
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteEvent_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.DeleteAsync("/api/admin/events/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
