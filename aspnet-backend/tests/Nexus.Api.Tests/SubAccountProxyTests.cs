// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text;
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
/// Pins the represent-tier proxy endpoints against Laravel's
/// SubAccountControllerTest: a carer with the represent tier acts directly;
/// co_decide and strangers are refused; the supported member stays owner and
/// sender; the carer is stamped as acting user; the carer's own balance is
/// provably untouched; and the wallet summary is gated on the credits tier.
/// </summary>
[Collection("Integration")]
public class SubAccountProxyTests : IntegrationTestBase
{
    public SubAccountProxyTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> SeedRelationshipAsync(
        Dictionary<string, string> tiers, string status = AccountRelationship.StatusActive)
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
            Status = status,
            ApprovedAt = status == AccountRelationship.StatusActive ? DateTime.UtcNow : null,
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

    private async Task<decimal> BalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var received = await db.Transactions.IgnoreQueryFilters()
            .Where(t => t.ReceiverId == userId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        var sent = await db.Transactions.IgnoreQueryFilters()
            .Where(t => t.SenderId == userId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        return received - sent;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    [Fact]
    public async Task RepresentCarer_CanPostAListingForTheDependent()
    {
        await SeedRelationshipAsync(new() { ["listings"] = SupportTiers.Represent });
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/listings",
            new { title = "Weekly shopping run", type = "offer", description = "Happy to help" });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var listingId = (await ReadJsonAsync(response)).GetProperty("data").GetProperty("id").GetInt32();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var listing = await db.Listings.IgnoreQueryFilters().SingleAsync(l => l.Id == listingId);
        listing.UserId.Should().Be(TestData.MemberUser.Id, "the supported member owns the listing");
        listing.ActingUserId.Should().Be(TestData.AdminUser.Id, "the carer is recorded as acting");
        (await db.AuditLogs.IgnoreQueryFilters().AnyAsync(a =>
            a.Action == "subaccount_listing_created" && a.EntityId == listingId))
            .Should().BeTrue("proxy acts must be attributable");
        (await db.Notifications.IgnoreQueryFilters().AnyAsync(n =>
            n.UserId == TestData.MemberUser.Id && n.Type == "sub_account_proxy_listing"))
            .Should().BeTrue("the supported member is always told");
    }

    [Fact]
    public async Task CoDecideTier_NeverAuthorisesActingAlone()
    {
        await SeedRelationshipAsync(new()
        {
            ["listings"] = SupportTiers.CoDecide,
            ["credits"] = SupportTiers.CoDecide
        });
        await SeedBalanceAsync(TestData.MemberUser.Id, 10m);
        var balanceBefore = await BalanceAsync(TestData.MemberUser.Id);
        await AuthenticateAsAdminAsync();

        var listing = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/listings",
            new { title = "Should not exist" });
        listing.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "co_decide means co-decide: its path is the consent workflow");

        var transfer = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/transfer",
            new { recipient = TestData.AdminUser.Id, amount = 1m });
        transfer.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        (await BalanceAsync(TestData.MemberUser.Id)).Should().Be(balanceBefore, "nothing may move");
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Listings.IgnoreQueryFilters()
            .AnyAsync(l => l.Title == "Should not exist")).Should().BeFalse();
    }

    [Fact]
    public async Task Stranger_AndPendingRelationship_AreRefused()
    {
        await SeedRelationshipAsync(new() { ["listings"] = SupportTiers.Represent },
            status: AccountRelationship.StatusPending);
        await AuthenticateAsAdminAsync();

        var pending = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/listings",
            new { title = "Pending grants nothing" });
        pending.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var stranger = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.OtherTenantUser.Id}/listings",
            new { title = "No relationship at all" });
        stranger.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task RepresentCarer_TransfersFromTheDependentsBalance_NeverTheirOwn()
    {
        await SeedRelationshipAsync(new() { ["credits"] = SupportTiers.Represent });
        await SeedBalanceAsync(TestData.MemberUser.Id, 10m);
        await SeedBalanceAsync(TestData.AdminUser.Id, 50m);
        var memberBefore = await BalanceAsync(TestData.MemberUser.Id);
        var carerBefore = await BalanceAsync(TestData.AdminUser.Id);
        var recipientEmail = $"proxy-recipient-{Guid.NewGuid():N}@test.com";
        int recipientId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var recipient = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = recipientEmail,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Proxy",
                LastName = "Recipient",
                Role = "member",
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(recipient);
            await db.SaveChangesAsync();
            recipientId = recipient.Id;
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/transfer",
            new { recipient = recipientId, amount = 3m, description = "Window cleaning" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("type").GetString().Should().Be("debit");
        data.GetProperty("amount").GetDouble().Should().Be(3.0);
        data.GetProperty("receiver").GetProperty("id").GetInt32().Should().Be(recipientId);

        (await BalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBefore - 3m);
        (await BalanceAsync(recipientId)).Should().Be(3m);
        (await BalanceAsync(TestData.AdminUser.Id)).Should().Be(carerBefore,
            "the carer's own balance is provably untouched");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var transactionId = data.GetProperty("id").GetInt32();
        var transaction = await verifyDb.Transactions.IgnoreQueryFilters()
            .SingleAsync(t => t.Id == transactionId);
        transaction.SenderId.Should().Be(TestData.MemberUser.Id);
        transaction.ActingUserId.Should().Be(TestData.AdminUser.Id);
        (await verifyDb.AuditLogs.IgnoreQueryFilters().AnyAsync(a =>
            a.Action == "subaccount_transfer_sent")).Should().BeTrue();
    }

    [Fact]
    public async Task ChildWallet_IsGatedOnTheCreditsTier()
    {
        await SeedRelationshipAsync(new()
        {
            ["activity"] = SupportTiers.Assist,
            ["credits"] = SupportTiers.CoDecide
        });
        await SeedBalanceAsync(TestData.MemberUser.Id, 12.5m);
        await AuthenticateAsAdminAsync();

        var refused = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/wallet");
        refused.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "seeing the balance is the permission that permits sending");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var relationship = await db.AccountRelationships.IgnoreQueryFilters()
                .SingleAsync(r => r.ParentUserId == TestData.AdminUser.Id
                    && r.ChildUserId == TestData.MemberUser.Id);
            relationship.Permissions = AccountRelationshipService.StorePermissions(
                new Dictionary<string, string> { ["credits"] = SupportTiers.Represent });
            await db.SaveChangesAsync();
        }

        var allowed = await Client.GetAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/wallet");
        allowed.StatusCode.Should().Be(HttpStatusCode.OK);
        var expected = (double)await BalanceAsync(TestData.MemberUser.Id);
        (await ReadJsonAsync(allowed)).GetProperty("data").GetProperty("balance")
            .GetDouble().Should().Be(expected);
    }

    [Fact]
    public async Task ListingImage_UploadsForTheChildsOwnListingOnly()
    {
        await SeedRelationshipAsync(new() { ["listings"] = SupportTiers.Represent });
        await AuthenticateAsAdminAsync();
        var created = await Client.PostAsJsonAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/listings",
            new { title = "Needs a photo" });
        var listingId = (await ReadJsonAsync(created)).GetProperty("data").GetProperty("id").GetInt32();

        using var content = new MultipartFormDataContent();
        // Tiny valid PNG header + filler; the upload service checks type/size.
        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4 };
        var filePart = new ByteArrayContent(png);
        filePart.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        content.Add(filePart, "image", "photo.png");

        var upload = await Client.PostAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/listings/{listingId}/image",
            content);
        upload.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(upload)).GetProperty("data").GetProperty("image_url")
            .GetString().Should().NotBeNullOrEmpty();

        // A listing the child does not own is 404, not writable.
        using var wrongContent = new MultipartFormDataContent();
        var wrongPart = new ByteArrayContent(png);
        wrongPart.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        wrongContent.Add(wrongPart, "image", "photo.png");
        var wrong = await Client.PostAsync(
            $"/api/v2/users/me/sub-accounts/{TestData.MemberUser.Id}/listings/{TestData.Listing1.Id}/image",
            wrongContent);
        if (wrong.StatusCode != HttpStatusCode.NotFound)
        {
            // Listing1 may belong to the member in seed data; only assert the
            // contract when it genuinely is someone else's listing.
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var owner = await db.Listings.IgnoreQueryFilters()
                .Where(l => l.Id == TestData.Listing1.Id)
                .Select(l => l.UserId).SingleAsync();
            owner.Should().Be(TestData.MemberUser.Id,
                "a foreign-owned listing must have produced 404");
        }
    }
}
