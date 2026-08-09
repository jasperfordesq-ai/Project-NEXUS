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
public sealed class LaravelReactPresenceContractTests : IntegrationTestBase
{
    public LaravelReactPresenceContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task PresenceContextEndpoints_ReturnLaravelReactShapesAndPersistStatus()
    {
        await AuthenticateAsMemberAsync();

        var heartbeat = await Client.PostAsync("/api/v2/presence/heartbeat", null);
        var heartbeatData = await ReadOkDataAsync(heartbeat);
        heartbeatData.GetProperty("ok").GetBoolean().Should().BeTrue();

        var onlineCount = await ReadOkDataAsync(await Client.GetAsync("/api/v2/presence/online-count"));
        onlineCount.GetProperty("online_count").GetInt32().Should().BeGreaterThanOrEqualTo(1);

        var status = await Client.PutAsJsonAsync("/api/v2/presence/status", new
        {
            status = "dnd",
            custom_status = "Focus time",
            emoji = ":focus:"
        });
        var statusData = await ReadOkDataAsync(status);
        statusData.GetProperty("status").GetString().Should().Be("dnd");
        statusData.GetProperty("custom_status").GetString().Should().Be("Focus time");
        statusData.GetProperty("emoji").GetString().Should().Be(":focus:");

        var userId = TestData.MemberUser.Id;
        var users = await ReadOkDataAsync(await Client.GetAsync($"/api/v2/presence/users?user_ids={userId},999999"));
        users.ValueKind.Should().Be(JsonValueKind.Object);
        var memberPresence = users.GetProperty(userId.ToString());
        memberPresence.GetProperty("status").GetString().Should().Be("dnd");
        memberPresence.GetProperty("last_seen_at").GetString().Should().NotBeNullOrWhiteSpace();
        memberPresence.GetProperty("custom_status").GetString().Should().Be("Focus time");
        memberPresence.GetProperty("status_emoji").GetString().Should().Be(":focus:");
        users.GetProperty("999999").GetProperty("status").GetString().Should().Be("offline");

        var privacy = await Client.PutAsJsonAsync("/api/v2/presence/privacy", new { hide_presence = true });
        var privacyData = await ReadOkDataAsync(privacy);
        privacyData.GetProperty("hide_presence").GetBoolean().Should().BeTrue();
    }

    private static async Task<JsonElement> ReadOkDataAsync(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        return json.GetProperty("data");
    }
}
