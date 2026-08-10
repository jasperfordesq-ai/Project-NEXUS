// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class WalletAliasSafetyTests : IntegrationTestBase
{
    public WalletAliasSafetyTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task LegacyDonationAlias_ReturnsUnavailableAndNeverWrites()
    {
        await AuthenticateAsMemberAsync();
        int before;
        using (var read = Factory.Services.CreateScope())
        {
            var db = read.ServiceProvider.GetRequiredService<NexusDbContext>();
            before = await db.Transactions.IgnoreQueryFilters().CountAsync();
        }

        using var response = await Client.PostAsJsonAsync(
            "/api/wallet/donate",
            new { recipient_id = TestData.AdminUser.Id, amount = 2m });
        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(before);
    }

    [Fact]
    public async Task LegacyWalletUserSearch_IsNameOnlyAndReturnsEligibleSameTenantRecipients()
    {
        var token = Guid.NewGuid().ToString("N")[..12];
        User active;
        using (var seed = Factory.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<NexusDbContext>();
            active = NewUser(TestData.Tenant1.Id, token, "Active", isActive: true);
            var inactive = NewUser(TestData.Tenant1.Id, token, "Inactive", isActive: false);
            var suspended = NewUser(TestData.Tenant1.Id, token, "Suspended", isActive: true);
            suspended.SuspendedAt = DateTime.UtcNow;
            var otherTenant = NewUser(TestData.Tenant2.Id, token, "OtherTenant", isActive: true);
            var emailOnly = NewUser(TestData.Tenant1.Id, "Unrelated", "EmailOnly", isActive: true);
            emailOnly.Email = $"{token}@private.test";
            db.Users.AddRange(active, inactive, suspended, otherTenant, emailOnly);
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();
        using var response = await Client.GetAsync($"/api/wallet/user-search?q={token}&limit=20");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var users = json.GetProperty("data").EnumerateArray().ToArray();
        users.Select(item => item.GetProperty("id").GetInt32())
            .Should().Equal(active.Id);
        response.Content.Headers.ContentType.Should().NotBeNull();
        var raw = await response.Content.ReadAsStringAsync();
        raw.Should().NotContain("private.test");
        raw.ToLowerInvariant().Should().NotContain("email");
    }

    [Fact]
    public async Task LegacyWalletUserSearch_ExcludesCallerAndDoesNotEnumerateOnEmptyQuery()
    {
        await AuthenticateAsMemberAsync();
        using var caller = await Client.GetAsync("/api/wallet/user-search?q=Member");
        caller.StatusCode.Should().Be(HttpStatusCode.OK);
        var callerJson = await caller.Content.ReadFromJsonAsync<JsonElement>();
        callerJson.GetProperty("data").EnumerateArray()
            .Select(item => item.GetProperty("id").GetInt32())
            .Should().NotContain(TestData.MemberUser.Id);

        using var empty = await Client.GetAsync("/api/wallet/user-search");
        empty.StatusCode.Should().Be(HttpStatusCode.OK);
        var emptyJson = await empty.Content.ReadFromJsonAsync<JsonElement>();
        emptyJson.GetProperty("data").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public void LegacyWalletUserSearch_HasLaravelThirtyPerMinutePolicy()
    {
        var endpoint = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(candidate => string.Equals(
                (candidate.RoutePattern.RawText ?? string.Empty).Trim().TrimStart('/'),
                "api/wallet/user-search",
                StringComparison.Ordinal))
            .Where(candidate => candidate.Metadata.GetMetadata<IHttpMethodMetadata>()?
                .HttpMethods.Contains("GET", StringComparer.OrdinalIgnoreCase) == true)
            .Should().ContainSingle()
            .Which;

        endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>()!
            .PolicyName.Should().Be(RateLimitingExtensions.PersonalWalletUserSearchPolicy);

        var v15Endpoints = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(candidate =>
            {
                var route = (candidate.RoutePattern.RawText ?? string.Empty).Trim().TrimStart('/');
                return route == "api/v2/wallet/user-search" || route == "api/wallet/user-search";
            })
            .ToArray();
        // React GET plus V15 GET and POST compatibility aliases.
        v15Endpoints.Should().HaveCount(3);
        v15Endpoints.All(candidate =>
                candidate.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName ==
                RateLimitingExtensions.PersonalWalletUserSearchPolicy)
            .Should().BeTrue();
    }

    [Fact]
    public async Task V15WalletReadsReturnPersistedValues_AndStartingBalanceWriteIsAdminOnly()
    {
        var marker = $"fund-{Guid.NewGuid():N}";
        int expectedPending;
        using (var seed = Factory.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<NexusDbContext>();
            var donationTransaction = new Transaction
            {
                TenantId = TestData.Tenant1.Id,
                SenderId = TestData.MemberUser.Id,
                ReceiverId = null,
                Amount = 1.25m,
                Description = $"Donation to community fund: {marker}",
                TransactionType = "donation",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            };
            var pending = new Transaction
            {
                TenantId = TestData.Tenant1.Id,
                SenderId = TestData.MemberUser.Id,
                ReceiverId = TestData.AdminUser.Id,
                Amount = 0.5m,
                Description = marker,
                Status = TransactionStatus.Pending,
                CreatedAt = DateTime.UtcNow
            };
            db.Transactions.AddRange(donationTransaction, pending);
            await db.SaveChangesAsync();
            db.CreditDonations.Add(new CreditDonation
            {
                TenantId = TestData.Tenant1.Id,
                DonorId = TestData.MemberUser.Id,
                RecipientId = null,
                Amount = 1.25m,
                Message = marker,
                TransactionId = donationTransaction.Id,
                CreatedAt = donationTransaction.CreatedAt
            });
            await db.SaveChangesAsync();
            expectedPending = await db.Transactions.CountAsync(transaction =>
                (transaction.SenderId == TestData.MemberUser.Id ||
                 transaction.ReceiverId == TestData.MemberUser.Id) &&
                transaction.Status == TransactionStatus.Pending);
        }

        await AuthenticateAsMemberAsync();
        var fund = await (await Client.GetAsync("/api/v2/wallet/community-fund"))
            .Content.ReadFromJsonAsync<JsonElement>();
        fund.GetProperty("data").GetProperty("total_donated").GetDecimal()
            .Should().BeGreaterThanOrEqualTo(1.25m);

        var transactions = await (await Client.GetAsync(
                "/api/v2/wallet/community-fund/transactions?limit=100&offset=0"))
            .Content.ReadFromJsonAsync<JsonElement>();
        transactions.GetProperty("data").EnumerateArray()
            .Should().Contain(item => item.GetProperty("description").GetString() == marker &&
                                      item.GetProperty("amount").GetDecimal() == 1.25m);

        var pendingJson = await (await Client.GetAsync("/api/v2/wallet/pending-count"))
            .Content.ReadFromJsonAsync<JsonElement>();
        pendingJson.GetProperty("count").GetInt32().Should().Be(expectedPending);

        (await Client.PutAsJsonAsync(
            "/api/v2/wallet/starting-balance",
            new { amount = 7.25m })).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await AuthenticateAsAdminAsync();
        (await Client.PutAsJsonAsync(
            "/api/v2/wallet/starting-balance",
            new { amount = 7.25m })).StatusCode.Should().Be(HttpStatusCode.OK);
        var startingBalance = await (await Client.GetAsync("/api/v2/wallet/starting-balance"))
            .Content.ReadFromJsonAsync<JsonElement>();
        startingBalance.GetProperty("data").GetProperty("starting_balance").GetDecimal()
            .Should().Be(7.25m);
    }

    private static User NewUser(
        int tenantId,
        string firstName,
        string lastName,
        bool isActive)
    {
        return new User
        {
            TenantId = tenantId,
            Email = $"{Guid.NewGuid():N}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = firstName,
            LastName = lastName,
            Role = "member",
            IsActive = isActive,
            CreatedAt = DateTime.UtcNow
        };
    }
}
