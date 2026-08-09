// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class SavedSearchesControllerTests : IntegrationTestBase
{
    public SavedSearchesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task List_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/saved-searches");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task List_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/saved-searches");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Get_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/saved-searches/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Create_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/saved-searches", new
        {
            name = "Test Search",
            search_type = "listings",
            query_json = "{\"q\":\"gardening\"}",
            notify_on_new_results = false
        });
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }

    [Fact]
    public async Task Delete_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.DeleteAsync("/api/saved-searches/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
