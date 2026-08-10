// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class FeedModerationControllerTests : IntegrationTestBase
{
    public FeedModerationControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ReportPost_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.PostAsJsonAsync("/api/feed/1/report", new { reason = "spam" });
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ReportPost_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/feed/99999/report", new { reason = "spam" });
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetReportedPosts_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/feed/reported");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetReportedPosts_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/feed/reported");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
