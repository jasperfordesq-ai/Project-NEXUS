// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class LaravelReactAppreciationsCompatibilityTests : IntegrationTestBase
{
    public LaravelReactAppreciationsCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task AppreciationsV2_SupportsLaravelReactSendWallReactionAndLeaderboardShapes()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/appreciations", new
        {
            receiver_id = TestData.MemberUser.Id,
            message = "Thank you for helping with the community garden.",
            context_type = "general",
            is_public = true
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createdJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        createdJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var created = createdJson.GetProperty("data");
        var appreciationId = created.GetProperty("id").GetInt32();
        created.GetProperty("sender_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        created.GetProperty("receiver_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        created.GetProperty("message").GetString().Should().Be("Thank you for helping with the community garden.");
        created.GetProperty("context_type").GetString().Should().Be("general");
        created.GetProperty("is_public").GetBoolean().Should().BeTrue();
        created.GetProperty("reactions_count").GetInt32().Should().Be(0);
        created.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();

        await AuthenticateAsMemberAsync();

        var wall = await Client.GetAsync($"/api/v2/users/{TestData.MemberUser.Id}/appreciations?page=1&per_page=10");

        wall.StatusCode.Should().Be(HttpStatusCode.OK);
        var wallJson = await wall.Content.ReadFromJsonAsync<JsonElement>();
        wallJson.GetProperty("success").GetBoolean().Should().BeTrue();
        wallJson.GetProperty("meta").GetProperty("total_pages").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        var item = wallJson.GetProperty("data").EnumerateArray()
            .Single(row => row.GetProperty("id").GetInt32() == appreciationId);
        item.GetProperty("sender").GetProperty("id").GetInt32().Should().Be(TestData.AdminUser.Id);
        item.GetProperty("sender").GetProperty("name").GetString().Should().NotBeNullOrWhiteSpace();
        item.GetProperty("my_reaction").ValueKind.Should().Be(JsonValueKind.Null);

        var mine = await Client.GetAsync("/api/v2/me/appreciations?tab=received&page=1&per_page=10");
        mine.StatusCode.Should().Be(HttpStatusCode.OK);
        var mineJson = await mine.Content.ReadFromJsonAsync<JsonElement>();
        mineJson.GetProperty("success").GetBoolean().Should().BeTrue();
        mineJson.GetProperty("data").EnumerateArray()
            .Should().Contain(row => row.GetProperty("id").GetInt32() == appreciationId);

        var reaction = await Client.PostAsJsonAsync($"/api/v2/appreciations/{appreciationId}/react", new
        {
            reaction_type = "heart"
        });

        reaction.StatusCode.Should().Be(HttpStatusCode.OK);
        var reactionData = (await reaction.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        reactionData.GetProperty("reacted").GetBoolean().Should().BeTrue();
        reactionData.GetProperty("reaction_type").GetString().Should().Be("heart");
        reactionData.GetProperty("reactions_count").GetInt32().Should().Be(1);

        var reactedWall = await Client.GetAsync($"/api/v2/users/{TestData.MemberUser.Id}/appreciations?page=1&per_page=10");
        var reactedItem = (await reactedWall.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Single(row => row.GetProperty("id").GetInt32() == appreciationId);
        reactedItem.GetProperty("my_reaction").GetString().Should().Be("heart");
        reactedItem.GetProperty("reactions_count").GetInt32().Should().Be(1);

        var leaderboard = await Client.GetAsync("/api/v2/appreciations/most-appreciated?period=all_time&limit=5");

        leaderboard.StatusCode.Should().Be(HttpStatusCode.OK);
        var leaderRows = (await leaderboard.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .ToArray();
        leaderRows.Should().Contain(row =>
            row.GetProperty("user_id").GetInt32() == TestData.MemberUser.Id &&
            row.GetProperty("name").GetString() == "Member User" &&
            row.GetProperty("count").GetInt32() >= 1);
    }
}
