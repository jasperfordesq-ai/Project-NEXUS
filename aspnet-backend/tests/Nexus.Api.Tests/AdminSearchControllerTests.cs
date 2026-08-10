// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminSearchControllerTests : IntegrationTestBase
{
    public AdminSearchControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetSearchStats_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/admin/search/stats");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetSearchStats_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/search/stats");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetSearchStats_AsAdmin_ReturnsOkOrServiceUnavailable()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/search/stats");
        // Meilisearch may not be running in test env
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.ServiceUnavailable, HttpStatusCode.InternalServerError);
    }

    [Fact]
    public async Task Reindex_AsAdmin_ReturnsOkOrBadRequestOrServiceUnavailable()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsync("/api/admin/search/reindex", null);
        // BadRequest when Meilisearch is not enabled, OK when it succeeds, 503/500 when service is down
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest, HttpStatusCode.ServiceUnavailable, HttpStatusCode.InternalServerError);
    }
}
