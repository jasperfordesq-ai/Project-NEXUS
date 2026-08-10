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
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class AdminWalletWriterTests : IntegrationTestBase
{
    public AdminWalletWriterTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task AdjustBalance_PositiveAdjustmentUsesSystemCreditLegAndCanonicalEnvelope()
    {
        await AuthenticateAsAdminAsync();
        var adminBalanceBefore = await BalanceAsync(TestData.AdminUser.Id);

        var response = await Client.PostAsJsonAsync("/api/v2/admin/timebanking/adjust-balance", new
        {
            user_id = TestData.MemberUser.Id,
            amount = 2.5m,
            reason = "Contract credit"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        data.GetProperty("previous_balance").GetDecimal().Should().Be(10m);
        data.GetProperty("adjustment").GetDecimal().Should().Be(2.5m);
        data.GetProperty("new_balance").GetDecimal().Should().Be(12.5m);
        json.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        var row = await TransactionByDescriptionAsync("[Admin Adjustment] Contract credit");
        row.Should().NotBeNull();
        row!.SenderId.Should().BeNull();
        row.ReceiverId.Should().Be(TestData.MemberUser.Id);
        row.Amount.Should().Be(2.5m);
        row.TransactionType.Should().Be("admin_adjustment");
        (await BalanceAsync(TestData.MemberUser.Id)).Should().Be(12.5m);
        (await BalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    [Fact]
    public async Task AdjustBalance_ConcurrentDebitsCannotOverdrawWallet()
    {
        await AuthenticateAsAdminAsync();

        Task<HttpResponseMessage> DebitAsync() => Client.PostAsJsonAsync(
            "/api/v2/admin/timebanking/adjust-balance",
            new
            {
                user_id = TestData.MemberUser.Id,
                amount = -6m,
                reason = "Concurrent correction"
            });

        var responses = await Task.WhenAll(DebitAsync(), DebitAsync());

        responses.Count(response => response.StatusCode == HttpStatusCode.OK).Should().Be(1);
        responses.Count(response => response.StatusCode == HttpStatusCode.BadRequest).Should().Be(1);
        (await BalanceAsync(TestData.MemberUser.Id)).Should().Be(4m);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var rows = await db.Transactions
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.Description == "[Admin Adjustment] Concurrent correction")
            .ToListAsync();
        rows.Should().ContainSingle();
        rows[0].SenderId.Should().Be(TestData.MemberUser.Id);
        rows[0].ReceiverId.Should().BeNull();
        rows[0].Amount.Should().Be(6m);
    }

    [Fact]
    public async Task AdjustBalance_BrokerCanAdjustMemberButCannotAdjustSelf()
    {
        int brokerId;
        const string brokerEmail = "wallet-broker@test.com";
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var broker = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = brokerEmail,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Wallet",
                LastName = "Broker",
                Role = "broker",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(broker);
            await db.SaveChangesAsync();
            brokerId = broker.Id;
        }

        SetAuthToken(await GetAccessTokenAsync(brokerEmail, TestData.Tenant1.Slug));

        var memberAdjustment = await Client.PostAsJsonAsync(
            "/api/v2/admin/timebanking/adjust-balance",
            new
            {
                user_id = TestData.MemberUser.Id,
                amount = 1m,
                reason = "Broker correction"
            });
        memberAdjustment.StatusCode.Should().Be(HttpStatusCode.OK);

        var selfAdjustment = await Client.PostAsJsonAsync(
            "/api/v2/admin/timebanking/adjust-balance",
            new
            {
                user_id = brokerId,
                amount = 1m,
                reason = "Self credit"
            });
        selfAdjustment.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GrantCredits_UsesSystemCreditLegAndCanonicalEnvelope()
    {
        await AuthenticateAsAdminAsync();
        var adminBalanceBefore = await BalanceAsync(TestData.AdminUser.Id);

        var response = await Client.PostAsJsonAsync("/api/v2/admin/wallet/grant", new
        {
            user_id = TestData.MemberUser.Id,
            amount = 3m,
            reason = "Community welcome"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        var grant = data.GetProperty("grant");
        grant.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        grant.GetProperty("amount").GetDecimal().Should().Be(3m);
        grant.GetProperty("reason").GetString().Should().Be("Community welcome");
        grant.GetProperty("admin_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        grant.GetProperty("status").GetString().Should().Be("completed");
        data.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        json.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        var row = await TransactionByDescriptionAsync("Community welcome");
        row.Should().NotBeNull();
        row!.SenderId.Should().BeNull();
        row.ReceiverId.Should().Be(TestData.MemberUser.Id);
        row.Amount.Should().Be(3m);
        row.TransactionType.Should().Be("admin_grant");
        (await BalanceAsync(TestData.MemberUser.Id)).Should().Be(13m);
        (await BalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(10000.01)]
    public async Task GrantCredits_RejectsOutOfRangeAmount(decimal amount)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/admin/wallet/grant", new
        {
            user_id = TestData.MemberUser.Id,
            amount,
            reason = "Invalid grant"
        });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    private async Task<decimal> BalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var received = await db.Transactions
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.ReceiverId == userId
                && row.Status == TransactionStatus.Completed)
            .SumAsync(row => row.Amount);
        var sent = await db.Transactions
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.SenderId == userId
                && row.Status == TransactionStatus.Completed)
            .SumAsync(row => row.Amount);
        return received - sent;
    }

    private async Task<Transaction?> TransactionByDescriptionAsync(string description)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.Description == description);
    }
}
