// Copyright (c) 2024-2026 Jasper Ford
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
using Nexus.Api.Services;
using Nexus.Api.Support.Safeguarding;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins the rebuilt carer relationship model (account_relationships +
/// SupportTiers) against the Laravel behaviours its tests pin: only the
/// supported member expands authority, a supporter's boolean true never
/// escalates, the dead can_view_messages boolean never surfaces as real
/// access, message-access withdrawal is always available, and the event
/// trail refuses updates at the database level.
/// </summary>
[Collection("Integration")]
public class AccountRelationshipTests : IntegrationTestBase
{
    public AccountRelationshipTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> SeedRelationshipAsync(
        Dictionary<string, string>? tiers = null,
        string status = AccountRelationship.StatusActive,
        string? rawPermissionsJson = null,
        DateTime? messageAccessGrantedAt = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = new AccountRelationship
        {
            TenantId = TestData.Tenant1.Id,
            ParentUserId = TestData.AdminUser.Id,
            ChildUserId = TestData.MemberUser.Id,
            RelationshipType = "carer",
            Permissions = rawPermissionsJson
                ?? AccountRelationshipService.StorePermissions(
                    SupportTiers.Resolve(null, tiers ?? new Dictionary<string, string>())),
            Status = status,
            ApprovedAt = status == AccountRelationship.StatusActive ? DateTime.UtcNow : null,
            MessageAccessGrantedAt = messageAccessGrantedAt,
            CreatedAt = DateTime.UtcNow
        };
        db.AccountRelationships.Add(relationship);
        await db.SaveChangesAsync();
        return relationship.Id;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<JsonElement>(body);
    }

    private async Task<Dictionary<string, string>> StoredTiersAsync(int relationshipId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = await db.AccountRelationships
            .IgnoreQueryFilters()
            .SingleAsync(r => r.Id == relationshipId);
        return AccountRelationshipService.ResolvedTiers(relationship);
    }

    [Fact]
    public async Task Request_CreatesPendingRelationship_AndOnlyTheChildApproves()
    {
        await AuthenticateAsAdminAsync();
        var created = await Client.PostAsJsonAsync("/api/v2/users/me/sub-accounts", new
        {
            email = TestData.MemberUser.Email,
            relationship_type = "guardian",
            permissions = new { can_view_activity = true, can_transact = true }
        });
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var row = (await ReadJsonAsync(created)).GetProperty("data")[0];
        row.GetProperty("status").GetString().Should().Be("pending");
        var relationshipId = row.GetProperty("relationship_id").GetInt32();

        // The requesting supporter cannot approve their own request.
        var selfApprove = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{relationshipId}/approve", new { });
        selfApprove.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "only the supported member may approve");

        await AuthenticateAsMemberAsync();
        var approve = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{relationshipId}/approve", new { });
        approve.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(approve)).GetProperty("data")[0].GetProperty("status")
            .GetString().Should().Be("active");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var actions = await db.AccountRelationshipEvents.IgnoreQueryFilters()
            .Where(e => e.RelationshipId == relationshipId)
            .Select(e => e.Action)
            .ToListAsync();
        actions.Should().Contain(["requested", "approved"]);
    }

    [Fact]
    public async Task PendingRelationship_GrantsNothing()
    {
        var relationshipId = await SeedRelationshipAsync(
            new Dictionary<string, string> { ["credits"] = SupportTiers.Represent },
            status: AccountRelationship.StatusPending);
        using var scope = Factory.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<AccountRelationshipService>();

        (await service.HasPermissionAsync(
            TestData.AdminUser.Id, TestData.MemberUser.Id, "can_transact", CancellationToken.None))
            .Should().BeFalse("a relationship row is never authorisation until approved");
        relationshipId.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Supporter_CannotGrantThemselvesATierFromNone()
    {
        var relationshipId = await SeedRelationshipAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{relationshipId}/permissions",
            new { permissions = new { can_transact = true } });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(response)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("MEMBER_APPROVAL_REQUIRED");
        (await StoredTiersAsync(relationshipId))["credits"].Should().Be(SupportTiers.None);
    }

    [Fact]
    public async Task Supporter_BooleanTrueNeverEscalatesAnExistingTier()
    {
        var relationshipId = await SeedRelationshipAsync(
            new Dictionary<string, string> { ["listings"] = SupportTiers.CoDecide });
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{relationshipId}/permissions",
            new { permissions = new { can_manage_listings = true } });

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "boolean true means on, never maximum power");
        (await StoredTiersAsync(relationshipId))["listings"].Should().Be(SupportTiers.CoDecide);
    }

    [Fact]
    public async Task Supporter_BooleanFalseStillSwitchesACapabilityOff()
    {
        var relationshipId = await SeedRelationshipAsync(new Dictionary<string, string>
        {
            ["listings"] = SupportTiers.CoDecide,
            ["credits"] = SupportTiers.CoDecide
        });
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{relationshipId}/permissions",
            new { permissions = new { can_manage_listings = false } });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var tiers = await StoredTiersAsync(relationshipId);
        tiers["listings"].Should().Be(SupportTiers.None, "shrinking is always allowed");
        tiers["credits"].Should().Be(SupportTiers.CoDecide, "untouched capabilities keep their tier");
    }

    [Fact]
    public async Task SupportedMember_IsTheOnlyOneWhoExpandsTiers()
    {
        var relationshipId = await SeedRelationshipAsync();
        await AuthenticateAsMemberAsync();

        var response = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/parent-accounts/{relationshipId}/permissions",
            new { tiers = new { listings = "represent" } });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await StoredTiersAsync(relationshipId))["listings"].Should().Be(SupportTiers.Represent);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetArrayLength().Should().BeGreaterThan(0,
            "the member route returns the full parent-accounts array");
    }

    [Fact]
    public async Task MemberPermissionsRoute_RefusesEmptyAndMessagesOnlyTiers()
    {
        var relationshipId = await SeedRelationshipAsync();
        await AuthenticateAsMemberAsync();

        var empty = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/parent-accounts/{relationshipId}/permissions", new { });
        empty.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var messagesOnly = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/parent-accounts/{relationshipId}/permissions",
            new { tiers = new { messages = "assist" } });
        messagesOnly.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "the messages capability moves only through its dedicated consent workflow");
        (await StoredTiersAsync(relationshipId))["messages"].Should().Be(SupportTiers.None);
    }

    [Fact]
    public async Task DeadBoolean_NeverSurfacesAsRealAccessOnTheWire()
    {
        await SeedRelationshipAsync(rawPermissionsJson:
            "{\"can_view_activity\":true,\"can_view_messages\":true}");
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/users/me/sub-accounts");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var row = (await ReadJsonAsync(response)).GetProperty("data")[0];
        var permissions = row.GetProperty("permissions");
        permissions.GetProperty("can_view_messages").GetBoolean().Should().BeFalse(
            "historical stored true values must never activate the real capability");
        permissions.GetProperty("tiers").GetProperty("messages").GetString()
            .Should().Be("none");
        row.GetProperty("message_access").GetString().Should().Be("none");
    }

    [Fact]
    public async Task WithdrawMessageAccess_StandsDownImmediately()
    {
        var relationshipId = await SeedRelationshipAsync(
            rawPermissionsJson:
            "{\"can_view_activity\":true,\"tiers\":{\"activity\":\"assist\",\"messages\":\"assist\"}}",
            messageAccessGrantedAt: DateTime.UtcNow);
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/parent-accounts/{relationshipId}/message-access/withdraw", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(response)).GetProperty("data").GetProperty("message_access")
            .GetString().Should().Be("none");
        (await StoredTiersAsync(relationshipId))["messages"].Should().Be(SupportTiers.None);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = await db.AccountRelationships.IgnoreQueryFilters()
            .SingleAsync(r => r.Id == relationshipId);
        relationship.MessageAccessGrantedAt.Should().BeNull("the notice mirror column stands down too");
        (await db.Notifications.IgnoreQueryFilters().AnyAsync(n =>
            n.UserId == TestData.AdminUser.Id
            && n.Type == "sub_account_message_access_revoked"))
            .Should().BeTrue("the supporter is told, without a reason attached");
    }

    [Fact]
    public async Task EventTrail_RefusesUpdatesAtTheDatabaseLevel()
    {
        var relationshipId = await SeedRelationshipAsync();
        await AuthenticateAsMemberAsync();
        (await Client.PutAsJsonAsync(
            $"/api/v2/users/me/parent-accounts/{relationshipId}/permissions",
            new { tiers = new { activity = "assist" } }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var eventId = await db.AccountRelationshipEvents.IgnoreQueryFilters()
            .Where(e => e.RelationshipId == relationshipId)
            .Select(e => e.Id)
            .FirstAsync();

        var rewrite = async () => await db.Database.ExecuteSqlRawAsync(
            "UPDATE account_relationship_events SET reason = 'rewritten' WHERE id = {0}", eventId);
        (await rewrite.Should().ThrowAsync<Exception>())
            .WithMessage("*account_relationship_events_immutable*");
    }

    [Fact]
    public async Task Revoke_IsASoftStateChange_AndEitherPartyMayEndIt()
    {
        var relationshipId = await SeedRelationshipAsync();
        await AuthenticateAsMemberAsync();

        var response = await Client.DeleteAsync($"/api/v2/users/me/sub-accounts/{relationshipId}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = await db.AccountRelationships.IgnoreQueryFilters()
            .SingleAsync(r => r.Id == relationshipId);
        relationship.Status.Should().Be(AccountRelationship.StatusRevoked,
            "the row survives so the event trail keeps pointing at something real");
        (await db.AccountRelationshipEvents.IgnoreQueryFilters()
            .AnyAsync(e => e.RelationshipId == relationshipId && e.Action == "withdrawn"))
            .Should().BeTrue("the supported member's exit is recorded as withdrawn");
    }
}
