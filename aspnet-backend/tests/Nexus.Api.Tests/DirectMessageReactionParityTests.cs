// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class DirectMessageReactionParityTests : IntegrationTestBase
{
    private const string Thumb = "\U0001F44D";
    private const string Heart = "\u2764\uFE0F";

    public DirectMessageReactionParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Toggle_IsDurableAndRemovalRemainsAllowedAfterBlock()
    {
        var messageId = await SendMessageAsMemberAsync();
        using var added = await Client.PostAsJsonAsync($"/api/v2/messages/{messageId}/reactions", new { emoji = Thumb });
        added.StatusCode.Should().Be(HttpStatusCode.OK);
        (await DataAsync(added)).GetProperty("action").GetString().Should().Be("added");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.MessageReactions.IgnoreQueryFilters().SingleAsync()).Emoji.Should().Be(Thumb);
            db.UserBlocks.Add(new UserBlock
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                BlockedUserId = TestData.MemberUser.Id,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        using var removed = await Client.PostAsJsonAsync($"/api/v2/messages/{messageId}/reactions", new { emoji = Thumb });
        removed.StatusCode.Should().Be(HttpStatusCode.OK);
        (await DataAsync(removed)).GetProperty("action").GetString().Should().Be("removed");
        using var rejected = await Client.PostAsJsonAsync($"/api/v2/messages/{messageId}/reactions", new { emoji = Thumb });
        rejected.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ErrorAsync(rejected)).GetProperty("code").GetString().Should().Be("BLOCKED");
        using var verify = Factory.Services.CreateScope();
        (await verify.ServiceProvider.GetRequiredService<NexusDbContext>().MessageReactions
            .IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Batch_ReturnsLaravelGroupsForParticipantsIncludingDeletedMessages()
    {
        var messageId = await SendMessageAsMemberAsync();
        await AddReactionAsync(Client, messageId, Thumb);
        var adminToken = await GetAccessTokenAsync("admin@test.com", TestData.Tenant1.Slug);
        using var admin = Factory.CreateClient();
        admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await AddReactionAsync(admin, messageId, Thumb);
        await AddReactionAsync(admin, messageId, Heart);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var message = await db.Messages.IgnoreQueryFilters().SingleAsync(row => row.Id == messageId);
            message.IsDeleted = true;
            message.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        using var response = await Client.GetAsync($"/api/v2/messages/reactions/batch?ids={messageId},bad,0");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var reactions = (await DataAsync(response)).GetProperty("reactions").GetProperty(messageId.ToString());
        reactions.GetArrayLength().Should().Be(2);
        reactions[0].GetProperty("emoji").GetString().Should().Be(Thumb);
        reactions[0].GetProperty("count").GetInt32().Should().Be(2);
        reactions[0].GetProperty("user_ids").EnumerateArray().Select(item => item.GetInt32())
            .Should().BeEquivalentTo(new[] { TestData.MemberUser.Id, TestData.AdminUser.Id });
        reactions[1].GetProperty("emoji").GetString().Should().Be(Heart);

        var outsiderToken = await GetAccessTokenAsync("other@test.com", TestData.Tenant2.Slug);
        using var outsider = Factory.CreateClient();
        outsider.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", outsiderToken);
        using var hidden = await outsider.GetAsync($"/api/v2/messages/reactions/batch?ids={messageId}");
        (await DataAsync(hidden)).GetProperty("reactions").EnumerateObject().Should().BeEmpty();
    }

    [Fact]
    public async Task ConcurrentToggle_IsSerializedAndLeavesNoDuplicateState()
    {
        var messageId = await SendMessageAsMemberAsync();
        var responses = await Task.WhenAll(
            Client.PostAsJsonAsync($"/api/v2/messages/{messageId}/reactions", new { emoji = Thumb }),
            Client.PostAsJsonAsync($"/api/v2/messages/{messageId}/reactions", new { emoji = Thumb }));
        responses.Should().OnlyContain(response => response.StatusCode == HttpStatusCode.OK);
        var actions = await Task.WhenAll(responses.Select(async response =>
            (await DataAsync(response)).GetProperty("action").GetString()));
        actions.Should().BeEquivalentTo("added", "removed");
        using var scope = Factory.Services.CreateScope();
        (await scope.ServiceProvider.GetRequiredService<NexusDbContext>().MessageReactions
            .IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    [Theory]
    [InlineData("")]
    [InlineData("🔥")]
    [InlineData("like")]
    public async Task Toggle_RejectsMissingOrNonCanonicalEmoji(string emoji)
    {
        var messageId = await SendMessageAsMemberAsync();
        using var response = await Client.PostAsJsonAsync(
            $"/api/v2/messages/{messageId}/reactions", new { emoji });
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ErrorAsync(response)).GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public async Task Toggle_UsesIndependentLaravelSixtyPerMinuteBucket()
    {
        var messageId = await SendMessageAsMemberAsync();
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:Messages:ReactionPermitLimit"] = "1",
                    ["RateLimiting:Messages:ReactionWindowSeconds"] = "60"
                })));
        using var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var accepted = await client.PostAsJsonAsync(
            $"/api/v2/messages/{messageId}/reactions", new { emoji = Thumb });
        accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        using var rejected = await client.PostAsJsonAsync(
            $"/api/v2/messages/{messageId}/reactions", new { emoji = Thumb });
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task Batch_UsesIndependentLaravelThirtyPerMinuteBucket()
    {
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:Messages:ReactionBatchPermitLimit"] = "1",
                    ["RateLimiting:Messages:ReactionBatchWindowSeconds"] = "60"
                })));
        using var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var accepted = await client.GetAsync("/api/v2/messages/reactions/batch");
        accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        using var rejected = await client.GetAsync("/api/v2/messages/reactions/batch");
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    private async Task<int> SendMessageAsMemberAsync()
    {
        await AuthenticateAsMemberAsync();
        using var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Durable reaction target"
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await DataAsync(response)).GetProperty("id").GetInt32();
    }

    private static async Task AddReactionAsync(HttpClient client, int messageId, string emoji)
    {
        using var response = await client.PostAsJsonAsync(
            $"/api/v2/messages/{messageId}/reactions", new { emoji });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private static async Task<JsonElement> DataAsync(HttpResponseMessage response)
        => (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

    private static async Task<JsonElement> ErrorAsync(HttpResponseMessage response)
        => (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").EnumerateArray().Single();
}
