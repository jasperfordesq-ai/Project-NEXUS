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
public class GroupsParityControllerTests : IntegrationTestBase
{
    public GroupsParityControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Wiki_CreateAndList_ReturnsPage()
    {
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync("Wiki parity group");

        var create = await Client.PostAsJsonAsync($"/api/groups/{groupId}/wiki", new
        {
            title = "Community handbook",
            content = "Shared notes for members"
        });

        create.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await Client.GetAsync($"/api/groups/{groupId}/wiki");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await list.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").EnumerateArray().Should().Contain(e => e.GetProperty("title").GetString() == "Community handbook");
    }

    [Fact]
    public async Task Invites_CreateLinkAndAccept_AddsMember()
    {
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync("Invite parity group");

        var invite = await Client.PostAsync($"/api/groups/{groupId}/invites/link", null);
        invite.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await invite.Content.ReadFromJsonAsync<JsonElement>();
        var token = content.GetProperty("data").GetProperty("token").GetString();

        await AuthenticateAsAdminAsync();
        var accept = await Client.PostAsync($"/api/groups/invite/{token}/accept", null);
        accept.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task NotificationPrefs_UpdateAndRead_ReturnsSavedValues()
    {
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync("Prefs parity group");

        var update = await Client.PutAsJsonAsync($"/api/groups/{groupId}/notification-prefs", new
        {
            email_notifications = false,
            digest_frequency = "weekly"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var get = await Client.GetAsync($"/api/groups/{groupId}/notification-prefs");
        get.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await get.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetProperty("digestFrequency").GetString().Should().Be("weekly");
    }

    private async Task<int> CreateGroupAsync(string name)
    {
        var response = await Client.PostAsJsonAsync("/api/groups", new { name });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        return content.GetProperty("group").GetProperty("id").GetInt32();
    }
}
