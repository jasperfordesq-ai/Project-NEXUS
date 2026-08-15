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
/// Group membership administration — the first of the no-op stubs to be
/// implemented for real (R-1).
///
/// 🔴 All four endpoints previously returned 200 with a plausible message and
/// did nothing. The runtime proof caught it exactly: promoting a user who was
/// not a member of the group returned 200 {"message":"Member promoted"}. An
/// admin saw success; nothing changed.
///
/// These tests assert the EFFECT, not the status code, because a status code is
/// precisely what the stubs got right.
/// </summary>
[Collection("Integration")]
public sealed class AdminGroupMembershipTests : IntegrationTestBase
{
    public AdminGroupMembershipTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<(int GroupId, int OwnerId, int MemberId)> SeedGroupAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var suffix = Guid.NewGuid().ToString("N")[..8];

        var group = new Group
        {
            TenantId = TestData.Tenant1.Id,
            Name = $"Membership Test {suffix}",
            CreatedById = TestData.AdminUser.Id,
        };
        db.Set<Group>().Add(group);
        await db.SaveChangesAsync();

        var member = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"group-member-{suffix}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Group",
            LastName = "Member",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow,
        };
        db.Users.Add(member);
        await db.SaveChangesAsync();

        db.Set<GroupMember>().AddRange(
            new GroupMember
            {
                TenantId = TestData.Tenant1.Id,
                GroupId = group.Id,
                UserId = TestData.AdminUser.Id,
                Role = Group.Roles.Owner,
                Status = "active",
            },
            new GroupMember
            {
                TenantId = TestData.Tenant1.Id,
                GroupId = group.Id,
                UserId = member.Id,
                Role = Group.Roles.Member,
                Status = "active",
            });
        await db.SaveChangesAsync();

        return (group.Id, TestData.AdminUser.Id, member.Id);
    }

    private async Task<string?> RoleOfAsync(int groupId, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Set<GroupMember>().IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.GroupId == groupId && m.UserId == userId)
            .Select(m => m.Role)
            .SingleOrDefaultAsync();
    }

    [Fact]
    public async Task Promote_ChangesTheStoredRole_NotJustTheResponse()
    {
        var (groupId, _, memberId) = await SeedGroupAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/admin/groups/{groupId}/members/{memberId}/promote", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await RoleOfAsync(groupId, memberId)).Should().Be(Group.Roles.Admin,
            "the point of the endpoint is the stored role, not the message");
    }

    [Fact]
    public async Task Demote_ChangesTheStoredRoleBack_AndIsIdempotent()
    {
        var (groupId, _, memberId) = await SeedGroupAsync();
        await AuthenticateAsAdminAsync();

        await Client.PostAsJsonAsync($"/api/admin/groups/{groupId}/members/{memberId}/promote", new { });
        await Client.PostAsJsonAsync($"/api/admin/groups/{groupId}/members/{memberId}/demote", new { });
        (await RoleOfAsync(groupId, memberId)).Should().Be(Group.Roles.Member);

        var again = await Client.PostAsJsonAsync(
            $"/api/admin/groups/{groupId}/members/{memberId}/demote", new { });
        again.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await again.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("changed").GetBoolean().Should().BeFalse(
            "a repeat must report the real state rather than invent a change");
    }

    /// <summary>The exact case the stub got wrong, in the exact way.</summary>
    [Fact]
    public async Task Promote_ForSomeoneWhoIsNotInTheGroup_IsRefused()
    {
        var (groupId, _, _) = await SeedGroupAsync();
        await AuthenticateAsAdminAsync();

        var outsiderId = TestData.MemberUser.Id;
        var response = await Client.PostAsJsonAsync(
            $"/api/admin/groups/{groupId}/members/{outsiderId}/promote", new { });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "the stub returned 200 'Member promoted' for a non-member");
        (await RoleOfAsync(groupId, outsiderId)).Should().BeNull(
            "and it must not have created a membership as a side effect");
    }

    [Fact]
    public async Task Owner_CannotBeDemotedOrRemoved()
    {
        var (groupId, ownerId, _) = await SeedGroupAsync();
        await AuthenticateAsAdminAsync();

        (await Client.PostAsJsonAsync($"/api/admin/groups/{groupId}/members/{ownerId}/demote", new { }))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Client.DeleteAsync($"/api/admin/groups/{groupId}/members/{ownerId}"))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);

        (await RoleOfAsync(groupId, ownerId)).Should().Be(Group.Roles.Owner,
            "a group must not be left without an owner");
    }

    [Fact]
    public async Task Remove_ActuallyRemovesTheMembership()
    {
        var (groupId, _, memberId) = await SeedGroupAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.DeleteAsync($"/api/admin/groups/{groupId}/members/{memberId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await RoleOfAsync(groupId, memberId)).Should().BeNull();
    }

    [Fact]
    public async Task List_ReturnsTheRealMembers_NotAnEmptyArray()
    {
        var (groupId, ownerId, memberId) = await SeedGroupAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync($"/api/admin/groups/{groupId}/members");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("meta").GetProperty("total").GetInt32().Should().Be(2,
            "the stub reported total 0 with an empty array");

        var ids = body.GetProperty("data").EnumerateArray()
            .Select(x => x.GetProperty("user_id").GetInt32()).ToList();
        ids.Should().Contain(new[] { ownerId, memberId });
    }
}
