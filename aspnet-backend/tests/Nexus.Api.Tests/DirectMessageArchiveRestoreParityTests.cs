// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class DirectMessageArchiveRestoreParityTests : IntegrationTestBase
{
    public DirectMessageArchiveRestoreParityTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    [Fact]
    public async Task SelfArchive_IsIdempotentAndPerUser_UpdatesInboxUnreadAndRestoresThread()
    {
        var state = await SeedDirectConversationAsync();
        await AuthenticateAsMemberAsync();

        var archive = await Client.DeleteAsync(
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}");

        archive.StatusCode.Should().Be(HttpStatusCode.OK);
        var archiveJson = await archive.Content.ReadFromJsonAsync<JsonElement>();
        archiveJson.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();
        archiveJson.GetProperty("data").GetProperty("message").GetString()
            .Should().Be("Conversation deleted");
        archiveJson.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrWhiteSpace();

        await AssertSelfArchiveMarkersAsync(state);

        // A repeated self archive changes no rows but remains a successful,
        // idempotent operation just like Laravel.
        var repeated = await Client.DeleteAsync(
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}");
        repeated.StatusCode.Should().Be(HttpStatusCode.OK);

        var unread = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages/unread-count");
        unread.GetProperty("data").GetProperty("count").GetInt32().Should().Be(0);

        var activeInbox = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages");
        activeInbox.GetProperty("data").GetArrayLength().Should().Be(0);
        var archivedInbox = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages?archived=true");
        archivedInbox.GetProperty("data").GetArrayLength().Should().Be(1);
        archivedInbox.GetProperty("data")[0].GetProperty("partner_id").GetInt32()
            .Should().Be(TestData.AdminUser.Id);

        // Archive markers affect inbox membership, not thread history.
        var thread = await Client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/messages/{TestData.AdminUser.Id}");
        thread.GetProperty("data").GetArrayLength().Should().Be(2);

        // The partner's view remains active because self-archive markers are
        // role-relative to the current user.
        await AuthenticateAsAdminAsync();
        var partnerInbox = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages");
        partnerInbox.GetProperty("data").GetArrayLength().Should().Be(1);

        await AuthenticateAsMemberAsync();
        var restore = await Client.PostAsync(
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}/restore",
            content: null);
        restore.StatusCode.Should().Be(HttpStatusCode.OK);
        var restoreJson = await restore.Content.ReadFromJsonAsync<JsonElement>();
        restoreJson.GetProperty("data").GetProperty("restored_count").GetInt32().Should().Be(2);
        restoreJson.GetProperty("data").GetProperty("message").GetString()
            .Should().Be("Conversation restored");

        var restoredInbox = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages");
        restoredInbox.GetProperty("data").GetArrayLength().Should().Be(1);

        var noLongerArchived = await Client.PostAsync(
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}/restore",
            content: null);
        noLongerArchived.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var missingJson = await noLongerArchived.Content.ReadFromJsonAsync<JsonElement>();
        var error = missingJson.GetProperty("errors").EnumerateArray().Single();
        error.GetProperty("code").GetString().Should().Be("NOT_FOUND");
        error.GetProperty("message").GetString().Should().Be("No archived conversation found");
    }

    [Fact]
    public async Task EveryoneArchive_HidesBothViews_AndMemberRestorePreservesPartnerMarkers()
    {
        var state = await SeedDirectConversationAsync();
        await AuthenticateAsMemberAsync();
        using var archiveRequest = new HttpRequestMessage(
            HttpMethod.Delete,
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}?scope=self")
        {
            Content = JsonContent.Create(new { scope = "everyone" })
        };

        var archive = await Client.SendAsync(archiveRequest);

        archive.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var messages = await db.Messages.IgnoreQueryFilters()
                .Where(message => message.ConversationId == state.ConversationId)
                .OrderBy(message => message.Id)
                .ToListAsync();
            messages.Should().OnlyContain(message =>
                message.ArchivedBySender != null && message.ArchivedByReceiver != null);
        }

        await AuthenticateAsAdminAsync();
        var adminActive = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages");
        adminActive.GetProperty("data").GetArrayLength().Should().Be(0);
        var adminArchived = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages?archived=true");
        adminArchived.GetProperty("data").GetArrayLength().Should().Be(1);

        await AuthenticateAsMemberAsync();
        var restore = await Client.PostAsync(
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}/restore",
            content: null);
        restore.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var memberSent = await db.Messages.IgnoreQueryFilters()
                .SingleAsync(message => message.Id == state.MemberSentMessageId);
            memberSent.ArchivedBySender.Should().BeNull();
            memberSent.ArchivedByReceiver.Should().NotBeNull();

            var adminSent = await db.Messages.IgnoreQueryFilters()
                .SingleAsync(message => message.Id == state.AdminSentMessageId);
            adminSent.ArchivedByReceiver.Should().BeNull();
            adminSent.ArchivedBySender.Should().NotBeNull();
        }

        var memberActive = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages");
        memberActive.GetProperty("data").GetArrayLength().Should().Be(1);

        await AuthenticateAsAdminAsync();
        var adminStillArchived = await Client.GetFromJsonAsync<JsonElement>("/api/v2/messages");
        adminStillArchived.GetProperty("data").GetArrayLength().Should().Be(0);
    }

    [Theory]
    [InlineData("{\"scope\":\"unknown\"}")]
    [InlineData("{\"scope\":null}")]
    public async Task Archive_PresentInvalidBodyScopeOverridesQueryAndDefaultsToSelf(string body)
    {
        var state = await SeedDirectConversationAsync();
        await AuthenticateAsMemberAsync();
        using var request = new HttpRequestMessage(
            HttpMethod.Delete,
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}?scope=everyone")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };

        using var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        await AssertSelfArchiveMarkersAsync(state);
    }

    [Fact]
    public async Task Archive_MalformedJsonFallsBackToQueryWithoutAutomaticBadRequest()
    {
        var state = await SeedDirectConversationAsync();
        await AuthenticateAsMemberAsync();
        using var request = new HttpRequestMessage(
            HttpMethod.Delete,
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}?scope=everyone")
        {
            Content = new StringContent("{not-json", Encoding.UTF8, "application/json")
        };

        using var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var messages = await db.Messages.IgnoreQueryFilters()
            .Where(message => message.ConversationId == state.ConversationId)
            .ToListAsync();
        messages.Should().OnlyContain(message =>
            message.ArchivedBySender != null && message.ArchivedByReceiver != null);
    }

    [Fact]
    public async Task ThreadMetaReportsPreReadCountThenZeroAfterAutomaticMarkAsRead()
    {
        await SeedDirectConversationAsync();
        await AuthenticateAsMemberAsync();

        var firstOpen = await Client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/messages/{TestData.AdminUser.Id}");
        firstOpen.GetProperty("meta").GetProperty("conversation")
            .GetProperty("unread_count").GetInt32().Should().Be(1);

        var secondOpen = await Client.GetFromJsonAsync<JsonElement>(
            $"/api/v2/messages/{TestData.AdminUser.Id}");
        secondOpen.GetProperty("meta").GetProperty("conversation")
            .GetProperty("unread_count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task ArchiveAndRestore_HaveIndependentExactRateBucketsIncludingCompactAlias()
    {
        await SeedDirectConversationAsync();
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:Messages:ArchivePermitLimit"] = "1",
                    ["RateLimiting:Messages:ArchiveWindowSeconds"] = "60",
                    ["RateLimiting:Messages:RestorePermitLimit"] = "1",
                    ["RateLimiting:Messages:RestoreWindowSeconds"] = "60"
                }));
            builder.ConfigureServices(services =>
            {
                foreach (var hostedService in services
                             .Where(descriptor => descriptor.ServiceType == typeof(IHostedService)
                                 && descriptor.ImplementationType?.Assembly == typeof(Program).Assembly)
                             .ToList())
                {
                    services.Remove(hostedService);
                }
            });
        });
        using var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using (var acceptedArchive = await client.DeleteAsync(
                   $"/api/v2/messages/conversations/{TestData.AdminUser.Id}"))
        {
            acceptedArchive.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using (var rejectedCompactArchive = await client.DeleteAsync(
                   $"/api/v2/conversations/{TestData.AdminUser.Id}"))
        {
            await AssertRateLimitedAsync(rejectedCompactArchive, "1");
        }

        using (var acceptedRestore = await client.PostAsync(
                   $"/api/v2/messages/conversations/{TestData.AdminUser.Id}/restore",
                   content: null))
        {
            acceptedRestore.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using (var rejectedRestore = await client.PostAsync(
                   $"/api/v2/messages/conversations/{TestData.AdminUser.Id}/restore",
                   content: null))
        {
            await AssertRateLimitedAsync(rejectedRestore, "1");
        }
    }

    [Fact]
    public async Task ArchiveAliases_UsePartnerTenantBoundaryAndLaravelStatusContracts()
    {
        await AuthenticateAsMemberAsync();

        // A same-tenant partner with no messages is a valid idempotent archive.
        var noConversation = await Client.DeleteAsync(
            $"/api/v2/conversations/{TestData.AdminUser.Id}");
        noConversation.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var crossTenant = await Client.DeleteAsync(
            $"/api/v2/messages/conversations/{TestData.OtherTenantUser.Id}");
        crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var crossTenantJson = await crossTenant.Content.ReadFromJsonAsync<JsonElement>();
        var crossTenantError = crossTenantJson.GetProperty("errors").EnumerateArray().Single();
        crossTenantError.GetProperty("code").GetString().Should().Be("NOT_FOUND");
        crossTenantError.GetProperty("message").GetString().Should().Be("Conversation not found");

        var restoreMissing = await Client.PostAsync(
            $"/api/v2/messages/conversations/{TestData.AdminUser.Id}/restore",
            content: null);
        restoreMissing.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<ConversationState> SeedDirectConversationAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var conversation = new Conversation
        {
            TenantId = TestData.Tenant1.Id,
            Participant1Id = Math.Min(TestData.MemberUser.Id, TestData.AdminUser.Id),
            Participant2Id = Math.Max(TestData.MemberUser.Id, TestData.AdminUser.Id),
            CreatedAt = DateTime.UtcNow.AddMinutes(-2),
            UpdatedAt = DateTime.UtcNow.AddMinutes(-1)
        };
        db.Conversations.Add(conversation);
        await db.SaveChangesAsync();

        var memberSent = new Message
        {
            TenantId = TestData.Tenant1.Id,
            ConversationId = conversation.Id,
            SenderId = TestData.MemberUser.Id,
            Content = "member to admin",
            IsRead = true,
            ReadAt = DateTime.UtcNow.AddMinutes(-1),
            CreatedAt = DateTime.UtcNow.AddMinutes(-2)
        };
        var adminSent = new Message
        {
            TenantId = TestData.Tenant1.Id,
            ConversationId = conversation.Id,
            SenderId = TestData.AdminUser.Id,
            Content = "admin to member",
            IsRead = false,
            CreatedAt = DateTime.UtcNow.AddMinutes(-1)
        };
        db.Messages.AddRange(memberSent, adminSent);
        await db.SaveChangesAsync();
        return new ConversationState(conversation.Id, memberSent.Id, adminSent.Id);
    }

    private async Task AssertSelfArchiveMarkersAsync(ConversationState state)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var memberSent = await db.Messages.IgnoreQueryFilters()
            .SingleAsync(message => message.Id == state.MemberSentMessageId);
        memberSent.ArchivedBySender.Should().NotBeNull();
        memberSent.ArchivedByReceiver.Should().BeNull();

        var adminSent = await db.Messages.IgnoreQueryFilters()
            .SingleAsync(message => message.Id == state.AdminSentMessageId);
        adminSent.ArchivedBySender.Should().BeNull();
        adminSent.ArchivedByReceiver.Should().NotBeNull();
        (await db.Messages.IgnoreQueryFilters()
            .CountAsync(message => message.ConversationId == state.ConversationId))
            .Should().Be(2, "archive must never hard-delete message history");
    }

    private static async Task AssertRateLimitedAsync(HttpResponseMessage response, string expectedLimit)
    {
        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        response.Headers.GetValues("X-RateLimit-Limit").Should().ContainSingle().Which.Should().Be(expectedLimit);
        response.Headers.GetValues("X-RateLimit-Remaining").Should().ContainSingle().Which.Should().Be("0");
        response.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        response.Headers.Contains("X-RateLimit-Reset").Should().BeTrue();
        response.Headers.Contains("Retry-After").Should().BeTrue();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(new[] { "success", "error", "code" });
        json.GetProperty("success").GetBoolean().Should().BeFalse();
        json.GetProperty("error").GetString()
            .Should().Be("Rate limit exceeded. Please try again later.");
        json.GetProperty("code").GetString().Should().Be("RATE_LIMIT_EXCEEDED");
    }

    private sealed record ConversationState(
        int ConversationId,
        int MemberSentMessageId,
        int AdminSentMessageId);
}
