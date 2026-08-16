// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Two more writes that went somewhere nothing read (R-28).
///
/// 🔴 Archiving a conversation wrote a tenant-config blob while the inbox
/// decides its active/archived tabs from ArchivedBySender / ArchivedByReceiver
/// on the messages — so archiving reported success and the conversation stayed
/// exactly where it was, every time.
///
/// 🔴 A wellbeing check-in wrote a blob too, while a WORKING implementation
/// already existed at a different route over the real store. So a volunteer
/// said they were struggling, was thanked for checking in, and the follow-up
/// alert service — which exists precisely to notice that — never saw it.
/// </summary>
[Collection("Integration")]
public sealed class WriteOnlyStoreReconnectionTests : IntegrationTestBase
{
    public WriteOnlyStoreReconnectionTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> SeedConversationWithMessageAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var conversation = new Conversation
        {
            TenantId = TestData.Tenant1.Id,
            Participant1Id = TestData.MemberUser.Id,
            Participant2Id = TestData.AdminUser.Id,
            CreatedAt = DateTime.UtcNow.AddDays(-1),
        };
        db.Conversations.Add(conversation);
        await db.SaveChangesAsync();

        db.Messages.Add(new Message
        {
            TenantId = TestData.Tenant1.Id,
            ConversationId = conversation.Id,
            SenderId = TestData.AdminUser.Id,
            Content = "Hello there",
            CreatedAt = DateTime.UtcNow.AddHours(-2),
        });
        await db.SaveChangesAsync();

        return conversation.Id;
    }

    private async Task<List<int>> InboxIdsAsync(bool archived)
    {
        var response = await Client.GetAsync($"/api/messages?archived={archived.ToString().ToLowerInvariant()}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.TryGetProperty("data", out var data) ? data : body;
        return items.ValueKind == JsonValueKind.Array
            ? items.EnumerateArray().Select(c => c.GetProperty("id").GetInt32()).ToList()
            : [];
    }

    [Fact]
    public async Task ArchivingAConversation_MovesItOutOfTheInbox()
    {
        var conversationId = await SeedConversationWithMessageAsync();
        await AuthenticateAsMemberAsync();

        (await InboxIdsAsync(archived: false)).Should().Contain(conversationId, "control: it starts in the inbox");

        // The archive action is exposed as DELETE /api/chatrooms/{id} (Laravel
        // parity naming); there is deliberately no assertion about a nicer
        // route, because that is the one that exists.
        var archive = await Client.DeleteAsync($"/api/chatrooms/{conversationId}");
        archive.StatusCode.Should().Be(HttpStatusCode.OK);

        (await InboxIdsAsync(archived: false)).Should().NotContain(conversationId,
            "archiving used to report success and leave the conversation exactly where it was");
        (await InboxIdsAsync(archived: true)).Should().Contain(conversationId);
    }

    /// <summary>
    /// 🔴 There is no restore route. SetConversationArchiveState takes an
    /// `archived` flag and only ever receives `true`, so a member can archive a
    /// conversation and has no way to bring it back. Recorded here rather than
    /// invented: adding an endpoint the client does not call would be guessing
    /// at a contract. The restore path is proven at the service level instead.
    /// </summary>
    [Fact]
    public async Task RestoringIsImplemented_ButNotYetRoutedAnywhere()
    {
        var conversationId = await SeedConversationWithMessageAsync();
        await AuthenticateAsMemberAsync();

        await Client.DeleteAsync($"/api/chatrooms/{conversationId}");
        (await InboxIdsAsync(archived: true)).Should().Contain(conversationId);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var markers = await db.Messages.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .Select(m => new { m.SenderId, m.ArchivedBySender, m.ArchivedByReceiver })
            .ToListAsync();

        markers.Should().NotBeEmpty();
        markers.Should().OnlyContain(m => m.SenderId == TestData.MemberUser.Id
            ? m.ArchivedBySender != null
            : m.ArchivedByReceiver != null,
            "the marker is written per message and per side, which is how the inbox reads it");
    }

    [Fact]
    public async Task OnePersonArchiving_DoesNotHideTheThreadFromTheOther()
    {
        var conversationId = await SeedConversationWithMessageAsync();

        await AuthenticateAsMemberAsync();
        await Client.DeleteAsync($"/api/chatrooms/{conversationId}");

        await AuthenticateAsAdminAsync();
        (await InboxIdsAsync(archived: false)).Should().Contain(conversationId,
            "archiving is a personal filing decision, not a shared one");
    }

    [Fact]
    public async Task AWellbeingCheckin_ReachesTheStoreTheAlertServiceReads()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/volunteering/wellbeing/checkin", new
        {
            mood = 4,
            note = "Good session, felt supported",
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Set<VolunteerWellbeing>().IgnoreQueryFilters().AsNoTracking()
            .Where(w => w.UserId == TestData.MemberUser.Id)
            .OrderByDescending(w => w.Id)
            .FirstOrDefaultAsync();

        stored.Should().NotBeNull("the check-in went into a config blob nothing read");
        stored!.Score.Should().Be(4);
        stored.Note.Should().Be("Good session, felt supported");
    }

    [Fact]
    public async Task ALowMoodCheckin_IsFlaggedForFollowUp()
    {
        await AuthenticateAsMemberAsync();

        await Client.PostAsJsonAsync("/api/v2/volunteering/wellbeing/checkin", new
        {
            mood = 1,
            note = "Struggling after that shift",
        });

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Set<VolunteerWellbeing>().IgnoreQueryFilters().AsNoTracking()
            .Where(w => w.UserId == TestData.MemberUser.Id)
            .OrderByDescending(w => w.Id)
            .FirstAsync();

        stored.RequiresFollowUp.Should().BeTrue(
            "someone at the bottom of the scale is exactly what the follow-up queue is for, "
            + "and relying on a person reading every check-in is how that gets missed");
    }

    [Fact]
    public async Task AnImpossibleMood_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        foreach (var mood in new[] { 0, 6, -1 })
        {
            (await Client.PostAsJsonAsync("/api/v2/volunteering/wellbeing/checkin", new { mood }))
                .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        (await Client.PostAsJsonAsync("/api/v2/volunteering/wellbeing/checkin", new { note = "no mood" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
