// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Support.Safeguarding;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins supervised message viewing against Laravel's SupporterMessageViewTest:
/// no purpose means 422 with no data and no audit row; the header purpose is
/// what the audit records; every read writes one immutable row BEFORE data;
/// reads run as the member (their deletions stay invisible, nothing is marked
/// read, unread counts are stripped); and there is no write route under the
/// viewer prefix.
/// </summary>
[Collection("Integration")]
public class SupporterMessageViewTests : IntegrationTestBase
{
    public SupporterMessageViewTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> SeedGrantedRelationshipAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = new AccountRelationship
        {
            TenantId = TestData.Tenant1.Id,
            ParentUserId = TestData.AdminUser.Id,
            ChildUserId = TestData.MemberUser.Id,
            RelationshipType = "carer",
            Permissions = AccountRelationshipService.StorePermissions(new Dictionary<string, string>
            {
                ["activity"] = SupportTiers.Assist,
                ["messages"] = SupportTiers.Assist
            }),
            Status = AccountRelationship.StatusActive,
            ApprovedAt = DateTime.UtcNow,
            MessageAccessGrantedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.AccountRelationships.Add(relationship);
        await db.SaveChangesAsync();
        return relationship.Id;
    }

    /// <summary>A conversation between the member and a partner, three messages.</summary>
    private async Task<int> SeedConversationAsync(bool memberDeletedOne = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var partner = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"msg-partner-{Guid.NewGuid():N}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Chat",
            LastName = "Partner",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(partner);
        await db.SaveChangesAsync();

        var conversation = new Conversation
        {
            TenantId = TestData.Tenant1.Id,
            Participant1Id = TestData.MemberUser.Id,
            Participant2Id = partner.Id,
            CreatedAt = DateTime.UtcNow
        };
        db.Conversations.Add(conversation);
        await db.SaveChangesAsync();

        db.Messages.AddRange(
            new Message
            {
                TenantId = TestData.Tenant1.Id,
                ConversationId = conversation.Id,
                SenderId = partner.Id,
                Content = "Hello there",
                IsRead = false,
                CreatedAt = DateTime.UtcNow.AddMinutes(-30)
            },
            new Message
            {
                TenantId = TestData.Tenant1.Id,
                ConversationId = conversation.Id,
                SenderId = TestData.MemberUser.Id,
                Content = "Hi, how are you?",
                IsRead = true,
                CreatedAt = DateTime.UtcNow.AddMinutes(-20)
            },
            new Message
            {
                TenantId = TestData.Tenant1.Id,
                ConversationId = conversation.Id,
                SenderId = partner.Id,
                Content = memberDeletedOne ? "Deleted by the member" : "All good!",
                IsRead = false,
                IsDeletedReceiver = memberDeletedOne,
                CreatedAt = DateTime.UtcNow.AddMinutes(-10)
            });
        await db.SaveChangesAsync();
        return partner.Id;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    private async Task<int> AuditCountAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.SupporterMessageViewAudits.IgnoreQueryFilters().CountAsync();
    }

    [Fact]
    public async Task NoPurpose_Means422_NoData_AndNoAuditRow()
    {
        await SeedGrantedRelationshipAsync();
        await SeedConversationAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages");

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await AuditCountAsync()).Should().Be(0, "a refused view must leave no audit row");

        // A blank header is refused like no purpose at all.
        Client.DefaultRequestHeaders.Add("X-Message-View-Purpose", "   ");
        var blank = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages");
        blank.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        Client.DefaultRequestHeaders.Remove("X-Message-View-Purpose");
    }

    [Fact]
    public async Task HeaderPurpose_IsWhatTheAuditRecords_AndBeatsTheQueryString()
    {
        await SeedGrantedRelationshipAsync();
        await SeedConversationAsync();
        await AuthenticateAsAdminAsync();

        Client.DefaultRequestHeaders.Add("X-Message-View-Purpose", "wellbeing");
        var response = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages?purpose=other");
        Client.DefaultRequestHeaders.Remove("X-Message-View-Purpose");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var audit = await db.SupporterMessageViewAudits.IgnoreQueryFilters().SingleAsync();
        audit.Purpose.Should().Be("wellbeing", "the header takes precedence over the query string");
        audit.Action.Should().Be("list");
        audit.SupporterUserId.Should().Be(TestData.AdminUser.Id);
        audit.SupportedUserId.Should().Be(TestData.MemberUser.Id);
    }

    [Fact]
    public async Task WithoutTheMessagesTier_ViewingIsForbidden()
    {
        // Relationship exists but messages was never consented.
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.AccountRelationships.Add(new AccountRelationship
            {
                TenantId = TestData.Tenant1.Id,
                ParentUserId = TestData.AdminUser.Id,
                ChildUserId = TestData.MemberUser.Id,
                RelationshipType = "carer",
                Permissions = AccountRelationshipService.StorePermissions(
                    new Dictionary<string, string> { ["activity"] = SupportTiers.Assist }),
                Status = AccountRelationship.StatusActive,
                ApprovedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        Client.DefaultRequestHeaders.Add("X-Message-View-Purpose", "safety");
        var response = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages");
        Client.DefaultRequestHeaders.Remove("X-Message-View-Purpose");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await AuditCountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task List_StripsUnreadCounts_AndRead_NeverMarksAnythingRead()
    {
        await SeedGrantedRelationshipAsync();
        var partnerId = await SeedConversationAsync();
        await AuthenticateAsAdminAsync();
        Client.DefaultRequestHeaders.Add("X-Message-View-Purpose", "helping_reply");

        var list = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listData = (await ReadJsonAsync(list)).GetProperty("data");
        var conversation = listData.GetProperty("conversations")[0];
        conversation.GetProperty("partner_id").GetInt32().Should().Be(partnerId);
        conversation.GetProperty("other_user").GetProperty("first_name").GetString().Should().Be("Chat");
        conversation.GetProperty("last_message").GetProperty("body").GetString().Should().Be("All good!");
        conversation.TryGetProperty("unread_count", out _).Should().BeFalse(
            "the supporter must never learn what the member has or has not read");

        var thread = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages/{partnerId}");
        Client.DefaultRequestHeaders.Remove("X-Message-View-Purpose");
        thread.StatusCode.Should().Be(HttpStatusCode.OK);
        var items = (await ReadJsonAsync(thread)).GetProperty("data").GetProperty("items");
        items.GetArrayLength().Should().Be(3);
        items[0].GetProperty("body").GetString().Should().Be("Hello there");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Messages.IgnoreQueryFilters()
            .CountAsync(m => m.SenderId == partnerId && !m.IsRead))
            .Should().Be(2, "viewing never marks the member's messages read");
        var readAudit = await db.SupporterMessageViewAudits.IgnoreQueryFilters()
            .SingleAsync(a => a.Action == "read");
        readAudit.PartnerUserId.Should().Be(partnerId);
    }

    [Fact]
    public async Task MemberDeletedMessages_AreInvisibleToTheSupporter()
    {
        await SeedGrantedRelationshipAsync();
        var partnerId = await SeedConversationAsync(memberDeletedOne: true);
        await AuthenticateAsAdminAsync();
        Client.DefaultRequestHeaders.Add("X-Message-View-Purpose", "safety");

        var thread = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages/{partnerId}");
        Client.DefaultRequestHeaders.Remove("X-Message-View-Purpose");

        thread.StatusCode.Should().Be(HttpStatusCode.OK);
        var items = (await ReadJsonAsync(thread)).GetProperty("data").GetProperty("items");
        items.GetArrayLength().Should().Be(2, "the reads run AS the member");
        items.EnumerateArray().Select(i => i.GetProperty("body").GetString())
            .Should().NotContain("Deleted by the member");
    }

    [Fact]
    public async Task ViewAudit_RefusesUpdatesAtTheDatabaseLevel()
    {
        await SeedGrantedRelationshipAsync();
        await SeedConversationAsync();
        await AuthenticateAsAdminAsync();
        Client.DefaultRequestHeaders.Add("X-Message-View-Purpose", "wellbeing");
        (await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages"))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        Client.DefaultRequestHeaders.Remove("X-Message-View-Purpose");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var auditId = await db.SupporterMessageViewAudits.IgnoreQueryFilters()
            .Select(a => a.Id).FirstAsync();
        var rewrite = async () => await db.Database.ExecuteSqlRawAsync(
            "UPDATE supporter_message_view_audits SET purpose = 'rewritten' WHERE id = {0}", auditId);
        (await rewrite.Should().ThrowAsync<Exception>())
            .WithMessage("*supporter_message_view_audit_immutable*");
    }

    [Fact]
    public async Task ThereIsNoWriteRoute_UnderTheViewerPrefix()
    {
        await SeedGrantedRelationshipAsync();
        var partnerId = await SeedConversationAsync();
        await AuthenticateAsAdminAsync();
        Client.DefaultRequestHeaders.Add("X-Message-View-Purpose", "helping_reply");

        var post = await Client.PostAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/messages/{partnerId}",
            new StringContent("{\"body\":\"forged\"}", System.Text.Encoding.UTF8, "application/json"));
        Client.DefaultRequestHeaders.Remove("X-Message-View-Purpose");

        post.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed);
    }
}
