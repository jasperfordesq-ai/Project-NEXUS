// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class SubAccountsControllerTests : IntegrationTestBase
{
    private const string LinkingUnavailable =
        "Sub-account linking is unavailable until the managed user can explicitly approve the relationship and permissions.";

    private const string PoolTransferUnavailable =
        "Pooled wallet transfers are unavailable until the managed user has explicitly approved transaction access.";

    public SubAccountsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task List_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/sub-accounts");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task List_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/sub-accounts");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Get_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/sub-accounts/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetPrimary_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/sub-accounts/primary");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetStatus_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/sub-accounts/status");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetPooledBalance_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/sub-accounts/pooled-balance");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Delete_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.DeleteAsync("/api/sub-accounts/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Create_WithoutChildApprovalWorkflow_FailsClosedWithoutRelationshipMutation()
    {
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);
        int relationshipsBefore;
        int transactionCountBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            relationshipsBefore = await db.SubAccounts.IgnoreQueryFilters()
                .CountAsync(row => row.TenantId == TestData.Tenant1.Id &&
                                   row.PrimaryUserId == TestData.MemberUser.Id &&
                                   row.SubUserId == TestData.AdminUser.Id);
            transactionCountBefore = await db.Transactions.IgnoreQueryFilters().CountAsync();
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/sub-accounts", new
        {
            sub_user_id = TestData.AdminUser.Id,
            relationship = "managed",
            display_name = "Unapproved managed account"
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("error").GetString().Should().Be(LinkingUnavailable);

        using var assertScope = Factory.Services.CreateScope();
        assertScope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await assertDb.SubAccounts.IgnoreQueryFilters()
            .CountAsync(row => row.TenantId == TestData.Tenant1.Id &&
                               row.PrimaryUserId == TestData.MemberUser.Id &&
                               row.SubUserId == TestData.AdminUser.Id))
            .Should().Be(relationshipsBefore);
        (await assertDb.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(transactionCountBefore);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    [Fact]
    public async Task PoolTransfer_WithoutChildApprovalWorkflow_FailsClosedWithoutLedgerOrBalanceMutation()
    {
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);
        int transactionCountBefore;
        int relationshipCountBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            transactionCountBefore = await db.Transactions.IgnoreQueryFilters().CountAsync();
            relationshipCountBefore = await db.SubAccounts.IgnoreQueryFilters().CountAsync();
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/sub-accounts/pool-transfer", new
        {
            from_user_id = TestData.MemberUser.Id,
            to_user_id = TestData.AdminUser.Id,
            amount = 1m,
            description = "Unapproved pooled transfer"
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("error").GetString().Should().Be(PoolTransferUnavailable);

        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.Transactions.IgnoreQueryFilters().CountAsync())
                .Should().Be(transactionCountBefore);
            (await db.SubAccounts.IgnoreQueryFilters().CountAsync())
                .Should().Be(relationshipCountBefore);
        }

        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    private async Task<decimal> GetBalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        return await wallet.GetBalanceAsync(TestData.Tenant1.Id, userId);
    }
}
