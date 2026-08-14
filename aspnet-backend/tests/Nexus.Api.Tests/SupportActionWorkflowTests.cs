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
/// Pins the support-action consent workflow against Laravel's
/// SupportActionControllerTest and MessageAccessConsentTest: a co_decide
/// supporter prepares but never receives the token; only the supported member
/// confirms; confirmation executes with acting-user attribution; the emailed
/// token is single-use with a read-only GET; authority is re-checked at use
/// time; declining needs no reason; and message access rises only through
/// this workflow.
/// </summary>
[Collection("Integration")]
public class SupportActionWorkflowTests : IntegrationTestBase
{
    public SupportActionWorkflowTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>AdminUser supports MemberUser at the given tiers.</summary>
    private async Task<int> SeedRelationshipAsync(Dictionary<string, string> tiers)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = new AccountRelationship
        {
            TenantId = TestData.Tenant1.Id,
            ParentUserId = TestData.AdminUser.Id,
            ChildUserId = TestData.MemberUser.Id,
            RelationshipType = "carer",
            Permissions = AccountRelationshipService.StorePermissions(
                SupportTiers.Resolve(null, tiers)),
            Status = AccountRelationship.StatusActive,
            ApprovedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.AccountRelationships.Add(relationship);
        await db.SaveChangesAsync();
        return relationship.Id;
    }

    private async Task SeedBalanceAsync(int userId, decimal amount)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.Transactions.Add(new Transaction
        {
            TenantId = TestData.Tenant1.Id,
            ReceiverId = userId,
            Amount = amount,
            TransactionType = "transfer",
            Status = TransactionStatus.Completed,
            Description = "Seed balance",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private async Task<(int Id, string Email)> CreateRecipientAsync()
    {
        var email = $"recipient-{Guid.NewGuid():N}@test.com";
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Transfer",
            LastName = "Recipient",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (user.Id, email);
    }

    private async Task<SupportPendingAction> RowAsync(int actionId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.SupportPendingActions.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.Id == actionId);
    }

    /// <summary>Recover the raw token via its hash — tests only.</summary>
    private async Task<string> RawTokenForAsync(int actionId, Func<Task<string>> issueKnownToken)
        => await issueKnownToken();

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    private async Task<int> PrepareTransferAsync(int recipientId, decimal amount = 3m)
    {
        await AuthenticateAsAdminAsync();
        var prepare = await Client.PostAsJsonAsync("/api/v2/users/me/support-actions", new
        {
            supported_user_id = TestData.MemberUser.Id,
            action_type = "credit_transfer",
            payload = new { recipient = recipientId, amount, description = "Weekly shop" }
        });
        prepare.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(prepare)).GetProperty("data");
        data.GetProperty("status").GetString().Should().Be("pending");
        data.TryGetProperty("token", out _).Should().BeFalse(
            "the raw token is never returned to the supporter");
        return data.GetProperty("id").GetInt32();
    }

    /// <summary>Swap in a known token so token-route tests can use it.</summary>
    private async Task<string> PlantTokenAsync(int actionId)
    {
        var token = SupportPendingActionService.NewToken();
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await db.SupportPendingActions.IgnoreQueryFilters()
            .Where(a => a.Id == actionId)
            .ExecuteUpdateAsync(s => s.SetProperty(
                a => a.TokenHash, SupportPendingActionService.HashToken(token)));
        return token;
    }

    [Fact]
    public async Task CoDecideSupporter_CanPrepare_ButAssistCannot()
    {
        await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.CoDecide });
        var (recipientId, _) = await CreateRecipientAsync();
        var actionId = await PrepareTransferAsync(recipientId);

        var row = await RowAsync(actionId);
        row.Status.Should().Be("pending");
        row.TokenHash.Length.Should().Be(64);
        row.SupporterUserId.Should().Be(TestData.AdminUser.Id);
        row.SupportedUserId.Should().Be(TestData.MemberUser.Id);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.Notifications.IgnoreQueryFilters().AnyAsync(n =>
                n.UserId == TestData.MemberUser.Id && n.Type == "support_action_pending"))
                .Should().BeTrue("the supported member is told a request awaits");
            // Downgrade to assist: preparing must now be refused.
            var relationship = await db.AccountRelationships.IgnoreQueryFilters()
                .SingleAsync(r => r.ParentUserId == TestData.AdminUser.Id
                    && r.ChildUserId == TestData.MemberUser.Id);
            relationship.Permissions = AccountRelationshipService.StorePermissions(
                new Dictionary<string, string> { ["credits"] = SupportTiers.Assist });
            await db.SaveChangesAsync();
        }

        var refused = await Client.PostAsJsonAsync("/api/v2/users/me/support-actions", new
        {
            supported_user_id = TestData.MemberUser.Id,
            action_type = "credit_transfer",
            payload = new { recipient = recipientId, amount = 1m }
        });
        refused.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadJsonAsync(refused)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("FORBIDDEN");
    }

    [Fact]
    public async Task SupportedMemberConfirming_ExecutesTheTransferWithAttribution()
    {
        await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.CoDecide });
        await SeedBalanceAsync(TestData.MemberUser.Id, 10m);
        var (recipientId, _) = await CreateRecipientAsync();
        var actionId = await PrepareTransferAsync(recipientId);

        // The supporter cannot confirm their own request.
        var selfConfirm = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/support-actions/{actionId}/confirm", new { });
        selfConfirm.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        await AuthenticateAsMemberAsync();
        var confirm = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/support-actions/{actionId}/confirm", new { });
        confirm.StatusCode.Should().Be(HttpStatusCode.OK);
        var confirmData = (await ReadJsonAsync(confirm)).GetProperty("data");
        confirmData.GetProperty("status").GetString().Should().Be("confirmed");
        var transactionId = confirmData.GetProperty("result_id").GetInt32();

        var row = await RowAsync(actionId);
        row.Status.Should().Be("confirmed");
        row.ConfirmedVia.Should().Be("in_app");
        row.ResultId.Should().Be(transactionId);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var transaction = await db.Transactions.IgnoreQueryFilters()
            .SingleAsync(t => t.Id == transactionId);
        transaction.SenderId.Should().Be(TestData.MemberUser.Id,
            "the supported member's credits move, never the carer's");
        transaction.ReceiverId.Should().Be(recipientId);
        transaction.ActingUserId.Should().Be(TestData.AdminUser.Id,
            "the ledger records who actually acted");
        (await db.Notifications.IgnoreQueryFilters().AnyAsync(n =>
            n.UserId == TestData.AdminUser.Id && n.Type == "support_action_confirmed"))
            .Should().BeTrue();
    }

    [Fact]
    public async Task PreparedListing_IsCreatedForTheSupportedMemberOnConfirm()
    {
        await SeedRelationshipAsync(new() { ["listings"] = SupportTiers.CoDecide });
        await AuthenticateAsAdminAsync();
        var prepare = await Client.PostAsJsonAsync("/api/v2/users/me/support-actions", new
        {
            supported_user_id = TestData.MemberUser.Id,
            action_type = "listing_create",
            payload = new { title = "Garden help wanted", type = "request" }
        });
        prepare.StatusCode.Should().Be(HttpStatusCode.OK);
        var actionId = (await ReadJsonAsync(prepare)).GetProperty("data").GetProperty("id").GetInt32();

        await AuthenticateAsMemberAsync();
        var confirm = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/support-actions/{actionId}/confirm", new { });
        confirm.StatusCode.Should().Be(HttpStatusCode.OK);
        var listingId = (await ReadJsonAsync(confirm)).GetProperty("data")
            .GetProperty("result_id").GetInt32();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var listing = await db.Listings.IgnoreQueryFilters().SingleAsync(l => l.Id == listingId);
        listing.UserId.Should().Be(TestData.MemberUser.Id, "the supported member owns the listing");
        listing.ActingUserId.Should().Be(TestData.AdminUser.Id);
        listing.Title.Should().Be("Garden help wanted");
    }

    [Fact]
    public async Task Decline_NeedsNoReason_AndExecutesNothing()
    {
        await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.CoDecide });
        await SeedBalanceAsync(TestData.MemberUser.Id, 10m);
        var (recipientId, _) = await CreateRecipientAsync();
        var actionId = await PrepareTransferAsync(recipientId);

        await AuthenticateAsMemberAsync();
        var decline = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/support-actions/{actionId}/decline", new { });
        decline.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(decline)).GetProperty("data").GetProperty("status")
            .GetString().Should().Be("declined");

        var row = await RowAsync(actionId);
        row.Status.Should().Be("declined");
        row.DeclineReason.Should().BeNull("requiring a reason is pressure to consent");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Transactions.IgnoreQueryFilters()
            .AnyAsync(t => t.SenderId == TestData.MemberUser.Id))
            .Should().BeFalse("nothing executes on decline");
    }

    [Fact]
    public async Task TokenGet_IsReadOnly_AndPostConfirmsExactlyOnce()
    {
        await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.CoDecide });
        await SeedBalanceAsync(TestData.MemberUser.Id, 10m);
        var (recipientId, _) = await CreateRecipientAsync();
        var actionId = await PrepareTransferAsync(recipientId);
        var token = await PlantTokenAsync(actionId);
        ClearAuthToken();

        var peek = await Client.GetAsync($"/api/v2/support-actions/confirm/{token}");
        peek.StatusCode.Should().Be(HttpStatusCode.OK);
        var peekData = (await ReadJsonAsync(peek)).GetProperty("data");
        peekData.GetProperty("status").GetString().Should().Be("pending");
        peekData.GetProperty("supporter_name").GetString().Should().NotBeNullOrEmpty();
        (await RowAsync(actionId)).Status.Should().Be("pending", "GET must never flip state");

        var confirm = await Client.PostAsJsonAsync($"/api/v2/support-actions/confirm/{token}", new { });
        confirm.StatusCode.Should().Be(HttpStatusCode.OK);
        var row = await RowAsync(actionId);
        row.Status.Should().Be("confirmed");
        row.ConfirmedVia.Should().Be("email_token");
        row.TokenConsumedAt.Should().NotBeNull();

        var replay = await Client.PostAsJsonAsync($"/api/v2/support-actions/confirm/{token}", new { });
        replay.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "the token is single-use");
        var unknown = await Client.GetAsync($"/api/v2/support-actions/confirm/{new string('a', 64)}");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ExpiredAction_CannotBeConfirmed_AndTheSweepExpiresIt()
    {
        await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.CoDecide });
        var (recipientId, _) = await CreateRecipientAsync();
        var actionId = await PrepareTransferAsync(recipientId);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.SupportPendingActions.IgnoreQueryFilters()
                .Where(a => a.Id == actionId)
                .ExecuteUpdateAsync(s => s.SetProperty(
                    a => a.ExpiresAt, DateTime.UtcNow.AddDays(-1)));
        }

        await AuthenticateAsMemberAsync();
        var confirm = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/support-actions/{actionId}/confirm", new { });
        confirm.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await RowAsync(actionId)).Status.Should().Be("pending",
            "a failed confirm leaves the row pending for the sweep");

        using (var scope = Factory.Services.CreateScope())
        {
            var sweep = scope.ServiceProvider.GetRequiredService<SupportPendingActionService>();
            (await sweep.ExpireStaleAsync(CancellationToken.None)).Should().BeGreaterThanOrEqualTo(1);
        }

        (await RowAsync(actionId)).Status.Should().Be("expired");
    }

    [Fact]
    public async Task RevokedRelationship_AutoCancelsOnConfirmWithAuthorityChanged()
    {
        var relationshipId = await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.CoDecide });
        await SeedBalanceAsync(TestData.MemberUser.Id, 10m);
        var (recipientId, _) = await CreateRecipientAsync();
        var actionId = await PrepareTransferAsync(recipientId);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.AccountRelationships.IgnoreQueryFilters()
                .Where(r => r.Id == relationshipId)
                .ExecuteUpdateAsync(s => s.SetProperty(
                    r => r.Status, AccountRelationship.StatusRevoked));
        }

        await AuthenticateAsMemberAsync();
        var confirm = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/support-actions/{actionId}/confirm", new { });
        confirm.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(confirm)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("AUTHORITY_CHANGED");
        (await RowAsync(actionId)).Status.Should().Be("cancelled",
            "lapsed authority cancels the row rather than leaving it answerable");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.Transactions.IgnoreQueryFilters()
            .AnyAsync(t => t.SenderId == TestData.MemberUser.Id))
            .Should().BeFalse();
    }

    [Fact]
    public async Task SupportedQueue_ShowsPendingCountAndSummary_NeverTheRawPayload()
    {
        await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.CoDecide });
        var (recipientId, _) = await CreateRecipientAsync();
        await PrepareTransferAsync(recipientId, amount: 2m);

        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/v2/users/me/support-actions");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("pending_count").GetInt32().Should().Be(1);
        var action = data.GetProperty("actions")[0];
        action.TryGetProperty("payload", out _).Should().BeFalse("the raw payload is never exposed");
        action.GetProperty("payload_summary").GetProperty("amount").GetDouble().Should().Be(2.0);
        action.GetProperty("other_party_name").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task Supporter_CanCancelTheirOwnPendingAction()
    {
        await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.CoDecide });
        var (recipientId, _) = await CreateRecipientAsync();
        var actionId = await PrepareTransferAsync(recipientId);

        var cancel = await Client.DeleteAsync($"/api/v2/users/me/support-actions/{actionId}");
        cancel.StatusCode.Should().Be(HttpStatusCode.OK);
        (await RowAsync(actionId)).Status.Should().Be("cancelled");
    }

    [Fact]
    public async Task MessageAccess_RisesOnlyThroughConsent_AndWithdrawCancelsOpenAsks()
    {
        var relationshipId = await SeedRelationshipAsync(new() { ["activity"] = SupportTiers.Assist });

        // Supporter asks for message access via the ordinary permissions PUT.
        await AuthenticateAsAdminAsync();
        var ask = await Client.PutAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{relationshipId}/permissions",
            new { permissions = new { tiers = new { messages = "assist" } } });
        ask.StatusCode.Should().Be(HttpStatusCode.OK);
        (await StoredTiers(relationshipId))["messages"].Should().Be(SupportTiers.None,
            "asking never writes the tier");
        var askRow = (await ReadJsonAsync(await Client.GetAsync("/api/v2/users/me/sub-accounts")))
            .GetProperty("data")[0];
        askRow.GetProperty("message_access").GetString().Should().Be("pending");

        // Asking again is idempotent, not spam.
        (await Client.PutAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{relationshipId}/permissions",
            new { permissions = new { tiers = new { messages = "assist" } } }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        int askId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var asks = await db.SupportPendingActions.IgnoreQueryFilters()
                .Where(a => a.RelationshipId == relationshipId
                    && a.ActionType == "message_access_grant")
                .ToListAsync();
            asks.Should().HaveCount(1, "one open ask per relationship, database-enforced");
            askId = asks[0].Id;
        }

        // Member confirmation is the only path that raises the tier.
        await AuthenticateAsMemberAsync();
        var confirm = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/support-actions/{askId}/confirm", new { });
        confirm.StatusCode.Should().Be(HttpStatusCode.OK);
        (await StoredTiers(relationshipId))["messages"].Should().Be(SupportTiers.Assist);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var relationship = await db.AccountRelationships.IgnoreQueryFilters()
                .SingleAsync(r => r.Id == relationshipId);
            relationship.MessageAccessGrantedAt.Should().NotBeNull(
                "the notice mirror column is set in the same confirm");
        }

        // Member withdraws any time; re-enabling needs fresh consent.
        var withdraw = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/parent-accounts/{relationshipId}/message-access/withdraw", new { });
        withdraw.StatusCode.Should().Be(HttpStatusCode.OK);
        (await StoredTiers(relationshipId))["messages"].Should().Be(SupportTiers.None);
    }

    private async Task<Dictionary<string, string>> StoredTiers(int relationshipId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = await db.AccountRelationships.IgnoreQueryFilters()
            .SingleAsync(r => r.Id == relationshipId);
        return AccountRelationshipService.ResolvedTiers(relationship);
    }
}
