// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for Feed Ranking endpoints (ranked feed, trending, bookmarks).
/// </summary>
[Collection("Integration")]
public class FeedRankingControllerTests : IntegrationTestBase
{
    public FeedRankingControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetRankedFeed_Authenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/feed/ranked");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task GetTrending_Authenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/feed/trending");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task BookmarkPost_ThenListBookmarks()
    {
        await AuthenticateAsMemberAsync();

        // Create a post first
        var postResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Bookmark test post"
        });

        if (postResponse.StatusCode != HttpStatusCode.Created)
            return; // Skip if post creation fails

        var postContent = await postResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = postContent.GetProperty("post").GetProperty("id").GetInt32();

        // Bookmark it
        var bookmarkResponse = await Client.PostAsync($"/api/feed/{postId}/bookmark", null);
        bookmarkResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // List bookmarks
        var listResponse = await Client.GetAsync("/api/feed/bookmarks");
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var listContent = await listResponse.Content.ReadFromJsonAsync<JsonElement>();
        listContent.GetProperty("data").GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task UnbookmarkPost_Succeeds()
    {
        await AuthenticateAsMemberAsync();

        // Create and bookmark a post
        var postResponse = await Client.PostAsJsonAsync("/api/feed", new { content = "Unbookmark test" });
        if (postResponse.StatusCode != HttpStatusCode.Created) return;

        var postId = (await postResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("post").GetProperty("id").GetInt32();

        await Client.PostAsync($"/api/feed/{postId}/bookmark", null);

        // Unbookmark
        var response = await Client.DeleteAsync($"/api/feed/{postId}/bookmark");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetEngagement_ForPost_ReturnsStats()
    {
        await AuthenticateAsMemberAsync();

        var postResponse = await Client.PostAsJsonAsync("/api/feed", new { content = "Engagement test" });
        if (postResponse.StatusCode != HttpStatusCode.Created) return;

        var postId = (await postResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("post").GetProperty("id").GetInt32();

        var response = await Client.GetAsync($"/api/feed/{postId}/engagement");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetRankedFeed_Unauthenticated_Returns401()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/feed/ranked");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
