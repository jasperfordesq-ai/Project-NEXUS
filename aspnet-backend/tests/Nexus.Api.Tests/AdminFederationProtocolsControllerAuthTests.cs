// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for AdminFederationProtocolsController (federated hour-transfer admin).
 * Verifies the [Authorize(Policy = "AdminOnly")] gate by hitting a
 * representative endpoint as anonymous / member / admin.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminFederationProtocolsControllerAuthTests : IntegrationTestBase
{
    public AdminFederationProtocolsControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/admin/federation/protocols/transfers";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", 200)]
    public async Task AdminFederationProtocolsTransfers_AuthGate(string role, int expectedStatus)
    {
        if (role == "anonymous")
        {
            ClearAuthToken();
        }
        else
        {
            var email = role == "admin" ? "admin@test.com" : "member@test.com";
            var token = await GetAccessTokenAsync(email, "test-tenant");
            SetAuthToken(token);
        }

        var resp = await Client.GetAsync(Path);

        if (role == "admin")
        {
            ((int)resp.StatusCode).Should().BeLessThan(401,
                $"admin must not get auth-rejected on {Path}");
        }
        else
        {
            ((int)resp.StatusCode).Should().Be(expectedStatus);
        }
    }

    [Fact]
    public async Task CreateTransfer_AsAdmin_WhenSagaUnavailable_Returns503WithoutLedgerOrTransferMutation()
    {
        var memberBalanceBefore = await GetBalanceAsync();
        int transferCountBefore;
        int transactionCountBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            transferCountBefore = await db.FederatedHourTransfers.IgnoreQueryFilters().CountAsync();
            transactionCountBefore = await db.Transactions.IgnoreQueryFilters().CountAsync();
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync(Path, new
        {
            partner_id = 1,
            local_user_id = TestData.MemberUser.Id,
            remote_user_external_id = "remote-member",
            amount = 2m,
            protocol = "native",
            description = "Blocked federation transfer"
        });

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("error").GetString().Should().Be("federation_settlement_unavailable");

        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.FederatedHourTransfers.IgnoreQueryFilters().CountAsync()).Should().Be(transferCountBefore);
            (await db.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(transactionCountBefore);
        }

        (await GetBalanceAsync()).Should().Be(memberBalanceBefore);
    }

    [Fact]
    public async Task ReconcileNow_AsAdmin_WhenSagaUnavailable_Returns503WithoutClaimingPendingTransfer()
    {
        int transferId;
        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var partnerId = await db.FederationPartners.IgnoreQueryFilters()
                .Where(row => row.TenantId == TestData.Tenant1.Id)
                .Select(row => row.Id)
                .FirstAsync();
            var transfer = new FederatedHourTransfer
            {
                TenantId = TestData.Tenant1.Id,
                PartnerId = partnerId,
                Direction = FederatedTransferDirection.Outbound,
                LocalUserId = TestData.MemberUser.Id,
                RemoteUserExternalId = "blocked-reconcile",
                Amount = 1m,
                Protocol = "native",
                Status = FederatedTransferStatus.Pending,
                Description = "Pending transfer must remain untouched",
                CreatedAt = DateTime.UtcNow
            };
            db.FederatedHourTransfers.Add(transfer);
            await db.SaveChangesAsync();
            transferId = transfer.Id;
        }

        var memberBalanceBefore = await GetBalanceAsync();
        int transactionCountBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            transactionCountBefore = await scope.ServiceProvider.GetRequiredService<NexusDbContext>()
                .Transactions.IgnoreQueryFilters().CountAsync();
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsync($"{Path}/reconcile", null);

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("error").GetString().Should().Be("federation_settlement_unavailable");

        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var transfer = await db.FederatedHourTransfers.IgnoreQueryFilters()
                .SingleAsync(row => row.Id == transferId);
            transfer.Status.Should().Be(FederatedTransferStatus.Pending);
            transfer.LocalTransactionId.Should().BeNull();
            transfer.RetryCount.Should().Be(0);
            transfer.LastReconcileAttemptAt.Should().BeNull();
            transfer.FailureReason.Should().BeNull();
            (await db.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(transactionCountBefore);
        }

        (await GetBalanceAsync()).Should().Be(memberBalanceBefore);
    }

    [Fact]
    public async Task CancelTransfer_AsAdmin_WhenPristinePending_CancelsLocally()
    {
        var transferId = await SeedTransferAsync(FederatedTransferStatus.Pending);

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsync($"{Path}/{transferId}/cancel", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var persisted = await scope.ServiceProvider.GetRequiredService<NexusDbContext>()
            .FederatedHourTransfers.IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(row => row.Id == transferId);
        persisted.Status.Should().Be(FederatedTransferStatus.Cancelled);
        persisted.ExternalReference.Should().BeNull();
        persisted.LocalTransactionId.Should().BeNull();
    }

    [Theory]
    [InlineData(FederatedTransferStatus.Sent)]
    [InlineData(FederatedTransferStatus.Acknowledged)]
    public async Task CancelTransfer_AsAdmin_WhenRemoteAssociated_Returns503AndLeavesStateUnchanged(
        FederatedTransferStatus status)
    {
        var unchangedAt = new DateTime(2026, 7, 11, 9, 30, 0, DateTimeKind.Utc);
        var externalReference = $"remote-{status}-{Guid.NewGuid():N}";
        var transferId = await SeedTransferAsync(status, externalReference, unchangedAt);

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsync($"{Path}/{transferId}/cancel", null);

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("error").GetString().Should().Be("federation_cancellation_unavailable");

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var persisted = await scope.ServiceProvider.GetRequiredService<NexusDbContext>()
            .FederatedHourTransfers.IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(row => row.Id == transferId);
        persisted.Status.Should().Be(status);
        persisted.ExternalReference.Should().Be(externalReference);
        persisted.UpdatedAt.Should().Be(unchangedAt);
        persisted.LocalTransactionId.Should().BeNull();
    }

    private async Task<int> SeedTransferAsync(
        FederatedTransferStatus status,
        string? externalReference = null,
        DateTime? updatedAt = null)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var partnerId = await db.FederationPartners.IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id)
            .Select(row => row.Id)
            .FirstAsync();
        var transfer = new FederatedHourTransfer
        {
            TenantId = TestData.Tenant1.Id,
            PartnerId = partnerId,
            Direction = FederatedTransferDirection.Outbound,
            LocalUserId = TestData.MemberUser.Id,
            RemoteUserExternalId = $"cancel-{Guid.NewGuid():N}",
            Amount = 1m,
            Protocol = "credit-commons",
            Status = status,
            ExternalReference = externalReference,
            Description = "Federation cancellation boundary regression",
            CreatedAt = DateTime.UtcNow.AddMinutes(-10),
            UpdatedAt = updatedAt
        };
        db.FederatedHourTransfers.Add(transfer);
        await db.SaveChangesAsync();
        return transfer.Id;
    }

    private async Task<decimal> GetBalanceAsync()
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        return await wallet.GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id);
    }
}
