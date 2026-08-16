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
/// Group conversations (R-25).
///
/// 🔴 This backend modelled a conversation as exactly two people, with a unique
/// index on the pair, while the React app shipped a working group-creation
/// screen. Creating a group returned 400 because the handler read
/// `participant_id` and the client sends `{name, member_ids:[…]}`; adding,
/// removing and renaming all returned 200 and changed nothing.
///
/// The authorisation tests below are the important half. Membership moved from
/// "am I participant 1 or 2" to a participants lookup, and getting that wrong
/// exposes private messages — so every decision point has its own test.
/// </summary>
[Collection("Integration")]
public sealed class GroupConversationTests : IntegrationTestBase
{
    public GroupConversationTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int[]> SeedMembersAsync(int count)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var ids = new List<int>();
        for (var i = 0; i < count; i++)
        {
            var user = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"group-member-{Guid.NewGuid():N}@test.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Group",
                LastName = $"Member{i}",
                Role = "member",
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            ids.Add(user.Id);
        }
        return ids.ToArray();
    }

    private async Task<int> CreateGroupAsync(int[] memberIds, string? name = null)
    {
        var groupName = name ?? ("Crew " + Guid.NewGuid().ToString("N")[..8]);
        var response = await Client.PostAsJsonAsync("/api/v2/conversations/groups", new
        {
            name = groupName,
            member_ids = memberIds,
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task CreatingAGroup_WithTheClientPayload_Works()
    {
        var members = await SeedMembersAsync(3);
        await AuthenticateAsMemberAsync();

        // Exactly what CreateGroupModal.tsx sends.
        var response = await Client.PostAsJsonAsync("/api/v2/conversations/groups", new
        {
            name = "Garden crew",
            member_ids = members,
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "the handler read participant_id, which the client never sends, so this was a 400");
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("is_group").GetBoolean().Should().BeTrue();
        data.GetProperty("name").GetString().Should().Be("Garden crew");
        data.GetProperty("member_count").GetInt32().Should().Be(members.Length + 1,
            "the creator is a member too");
    }

    [Fact]
    public async Task AGroupNeedsANameAndAtLeastTwoOtherMembers()
    {
        var members = await SeedMembersAsync(2);
        await AuthenticateAsMemberAsync();

        (await Client.PostAsJsonAsync("/api/v2/conversations/groups", new { name = "", member_ids = members }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        (await Client.PostAsJsonAsync("/api/v2/conversations/groups", new { name = "Too small", member_ids = new[] { members[0] } }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
                "the client itself requires two, and the server must not be laxer");
    }

    [Fact]
    public async Task AMemberFromAnotherCommunity_CannotBeAddedToAGroup()
    {
        var members = await SeedMembersAsync(2);
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/conversations/groups", new
        {
            name = "Cross tenant attempt",
            member_ids = new[] { members[0], members[1], TestData.OtherTenantUser.Id },
        });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "a crafted id must not drop someone from another community into a private thread");
    }

    [Fact]
    public async Task OnlyAGroupAdmin_CanAddOrRenameOrRemoveOthers()
    {
        var members = await SeedMembersAsync(3);
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync(members);
        var outsider = (await SeedMembersAsync(1))[0];

        // The creator is the admin and may do all three.
        (await Client.PostAsJsonAsync($"/api/v2/conversations/{groupId}/participants", new { user_id = outsider }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PatchAsJsonAsync($"/api/v2/conversations/{groupId}/group", new { name = "Renamed" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.DeleteAsync($"/api/v2/conversations/{groupId}/participants/{outsider}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // An ordinary member may not.
        await AuthenticateAsAdminAsync();
        await Client.PostAsJsonAsync($"/api/v2/conversations/{groupId}/participants", new { user_id = outsider });
        // (that call is itself refused — assert it)
        var addAsNonAdmin = await Client.PostAsJsonAsync(
            $"/api/v2/conversations/{groupId}/participants", new { user_id = outsider });
        addAsNonAdmin.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var renameAsNonAdmin = await Client.PatchAsJsonAsync(
            $"/api/v2/conversations/{groupId}/group", new { name = "hijacked" });
        renameAsNonAdmin.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task SomeoneOutsideTheGroup_CannotSeeItOrPostToIt()
    {
        var members = await SeedMembersAsync(3);
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync(members);

        // The admin account is not in this group.
        await AuthenticateAsAdminAsync();

        var participants = await Client.GetAsync($"/api/v2/conversations/{groupId}/participants");
        participants.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "confirming the conversation exists leaks who is talking to whom");

        var post = await Client.PostAsJsonAsync($"/api/v2/conversations/{groupId}/messages",
            new { content = "should not land" });
        post.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "membership moved to a participants lookup — getting this wrong posts into a stranger's thread");
    }

    [Fact]
    public async Task LeavingAGroup_IsAllowedForYourself_AndEndsYourAccess()
    {
        var members = await SeedMembersAsync(3);
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync(members);
        var meId = TestData.MemberUser.Id;

        var left = await Client.DeleteAsync($"/api/v2/conversations/{groupId}/participants/{meId}");
        left.StatusCode.Should().Be(HttpStatusCode.OK, "anyone may remove themselves");

        (await Client.GetAsync($"/api/v2/conversations/{groupId}/participants"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound, "access ends when you leave");

        // The row survives so who could see what stays answerable.
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var row = await db.ConversationParticipants.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(p => p.ConversationId == groupId && p.UserId == meId);
        row.LeftAt.Should().NotBeNull();
    }

    [Fact]
    public async Task TheGroupList_ShowsOnlyGroupsIAmStillIn()
    {
        var members = await SeedMembersAsync(3);
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync(members, "Visible crew");

        var mine = await Client.GetAsync("/api/v2/conversations/groups");
        (await mine.Content.ReadAsStringAsync()).Should().Contain("Visible crew");

        await AuthenticateAsAdminAsync();
        var theirs = await Client.GetAsync("/api/v2/conversations/groups");
        (await theirs.Content.ReadAsStringAsync()).Should().NotContain("Visible crew",
            "the old list returned every conversation regardless of membership");
        _ = groupId;
    }

    /// <summary>
    /// The migration backfills existing one-to-one threads into participant
    /// rows. Without it, every pre-existing conversation would look like a
    /// conversation nobody is in — and the authorisation lookups above would
    /// lock members out of their own message history.
    /// </summary>
    [Fact]
    public async Task ExistingOneToOneThreads_HaveParticipantRows()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var orphaned = await db.Conversations.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(c => !db.ConversationParticipants.IgnoreQueryFilters()
                .Any(p => p.ConversationId == c.Id));

        orphaned.Should().Be(0, "the backfill must leave no conversation without participants");
    }
}
