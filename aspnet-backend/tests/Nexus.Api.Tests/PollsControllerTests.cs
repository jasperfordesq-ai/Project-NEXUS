// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class PollsControllerTests : IntegrationTestBase
{
    public PollsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ListPolls_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/polls");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task CreatePoll_AsAuthenticated_ReturnsCreated()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/polls", new
        {
            title = "Best timebanking feature?",
            description = "Vote for your favourite feature",
            poll_type = "single",
            options = new[] { "Exchanges", "Groups", "Events", "Gamification" },
            is_anonymous = false,
            show_results_before_close = true
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Vote_OnPoll_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        // Create poll
        var createResp = await Client.PostAsJsonAsync("/api/polls", new
        {
            title = "Vote test poll",
            poll_type = "single",
            options = new[] { "Option A", "Option B" }
        });
        var poll = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var pollId = poll.GetProperty("id").GetInt32();

        // Get poll to find option IDs
        var getResp = await Client.GetAsync($"/api/polls/{pollId}");
        var pollDetail = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var firstOptionId = pollDetail.GetProperty("options").EnumerateArray().First().GetProperty("id").GetInt32();

        // Vote
        var voteResp = await Client.PostAsJsonAsync($"/api/polls/{pollId}/vote", new
        {
            option_ids = new[] { firstOptionId }
        });
        voteResp.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Vote_Twice_ReturnsBadRequest()
    {
        await AuthenticateAsMemberAsync();
        var createResp = await Client.PostAsJsonAsync("/api/polls", new
        {
            title = "Double vote test",
            poll_type = "single",
            options = new[] { "Yes", "No" }
        });
        var poll = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var pollId = poll.GetProperty("id").GetInt32();

        var getResp = await Client.GetAsync($"/api/polls/{pollId}");
        var pollDetail = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var optionId = pollDetail.GetProperty("options").EnumerateArray().First().GetProperty("id").GetInt32();

        await Client.PostAsJsonAsync($"/api/polls/{pollId}/vote", new { option_ids = new[] { optionId } });
        var secondVote = await Client.PostAsJsonAsync($"/api/polls/{pollId}/vote", new { option_ids = new[] { optionId } });
        secondVote.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetResults_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var createResp = await Client.PostAsJsonAsync("/api/polls", new
        {
            title = "Results test",
            poll_type = "single",
            options = new[] { "A", "B" }
        });
        var poll = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var pollId = poll.GetProperty("id").GetInt32();

        var response = await Client.GetAsync($"/api/polls/{pollId}/results");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Polls_Unauthenticated_ReturnsUnauthorized()
    {
        var response = await Client.GetAsync("/api/polls");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
