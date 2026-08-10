// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class VolunteerOrganisationWalletTests : IntegrationTestBase
{
    public VolunteerOrganisationWalletTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task MemberDeposit_DebitsPersonalLedgerCreditsOrganisationAndWritesAuditRow()
    {
        var organisationId = await CreateOrganisationAsync(
            TestData.MemberUser.Id,
            status: "active",
            balance: 1m);
        var personalBalanceBefore = await PersonalBalanceAsync(TestData.MemberUser.Id);
        await AuthenticateAsMemberAsync();
        decimal visibleSentBefore;
        using (var before = await Client.GetAsync("/api/v2/wallet/balance"))
        {
            before.StatusCode.Should().Be(HttpStatusCode.OK);
            visibleSentBefore = (await ReadJsonAsync(before)).GetProperty("sent_total").GetDecimal();
        }

        using var response = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/organisations/{organisationId}/wallet/deposit",
            new { amount = 3, note = "Community garden top-up" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        response.Headers.GetValues("X-Tenant-ID").Should().ContainSingle().Which
            .Should().Be(TestData.Tenant1.Id.ToString());
        var body = await ReadJsonAsync(response);
        body.GetProperty("data").GetProperty("message").GetString().Should().Be("Deposit successful");
        body.GetProperty("data").GetProperty("new_balance").GetDecimal().Should().Be(4m);
        body.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var organisation = await db.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == organisationId);
        organisation.Balance.Should().Be(4m);

        var personalLedger = await db.Transactions.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.SenderId == TestData.MemberUser.Id
                && row.ReceiverId == null
                && row.Description == "Volunteer organisation deposit: Community garden top-up");
        personalLedger.Amount.Should().Be(3m);
        personalLedger.Status.Should().Be(TransactionStatus.Completed);
        personalLedger.TransactionType.Should().Be(
            PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType);

        var organisationLedger = await db.VolunteerOrganisationTransactions.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.VolunteerOrganisationId == organisationId);
        organisationLedger.UserId.Should().Be(TestData.MemberUser.Id);
        organisationLedger.Type.Should().Be("deposit");
        organisationLedger.Amount.Should().Be(3m);
        organisationLedger.BalanceAfter.Should().Be(4m);
        organisationLedger.Description.Should().Be("Community garden top-up");

        (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(personalBalanceBefore - 3m);

        using (var balance = await Client.GetAsync("/api/v2/wallet/balance"))
        {
            balance.StatusCode.Should().Be(HttpStatusCode.OK);
            var wallet = await ReadJsonAsync(balance);
            wallet.GetProperty("balance").GetDecimal().Should().Be(personalBalanceBefore - 3m);
            wallet.GetProperty("sent_total").GetDecimal().Should().Be(visibleSentBefore);
        }
        using (var history = await Client.GetAsync("/api/v2/wallet/transactions"))
        {
            history.StatusCode.Should().Be(HttpStatusCode.OK);
            (await ReadJsonAsync(history)).GetProperty("data").EnumerateArray()
                .Should().NotContain(row => row.GetProperty("id").GetInt32() == personalLedger.Id);
        }
    }

    [Fact]
    public async Task Deposit_RejectsFractionalInsufficientAndSuspendedWithoutMutation()
    {
        var activeOrganisationId = await CreateOrganisationAsync(
            TestData.MemberUser.Id,
            status: "active",
            balance: 2m);
        var suspendedOrganisationId = await CreateOrganisationAsync(
            TestData.MemberUser.Id,
            status: "suspended",
            balance: 4m);
        var personalBalanceBefore = await PersonalBalanceAsync(TestData.MemberUser.Id);
        await AuthenticateAsMemberAsync();

        using (var fractional = await Client.PostAsJsonAsync(
                   $"/api/v2/volunteering/organisations/{activeOrganisationId}/wallet/deposit",
                   new { amount = 1.5m }))
        {
            fractional.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var error = (await ReadJsonAsync(fractional)).GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            error.GetProperty("field").GetString().Should().Be("amount");
        }

        using (var insufficient = await Client.PostAsJsonAsync(
                   $"/api/v2/volunteering/organisations/{activeOrganisationId}/wallet/deposit",
                   new { amount = personalBalanceBefore + 1m }))
        {
            insufficient.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var error = (await ReadJsonAsync(insufficient)).GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            error.GetProperty("message").GetString().Should().Be("Insufficient personal balance");
        }

        using (var suspended = await Client.PostAsJsonAsync(
                   $"/api/v2/volunteering/organisations/{suspendedOrganisationId}/wallet/deposit",
                   new { amount = 1 }))
        {
            suspended.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            var error = (await ReadJsonAsync(suspended)).GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("ORG_NOT_ACTIVE");
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == activeOrganisationId)).Balance.Should().Be(2m);
        (await db.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == suspendedOrganisationId)).Balance.Should().Be(4m);
        (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters()
            .CountAsync(row => row.VolunteerOrganisationId == activeOrganisationId
                || row.VolunteerOrganisationId == suspendedOrganisationId)).Should().Be(0);
        (await db.Transactions.IgnoreQueryFilters()
            .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.SenderId == TestData.MemberUser.Id
                && row.ReceiverId == null)).Should().Be(0);
        (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(personalBalanceBefore);
    }

    [Fact]
    public async Task WalletRoutes_RequireAuthenticationManagerAccessAndTenantIsolation()
    {
        var organisationId = await CreateOrganisationAsync(
            TestData.AdminUser.Id,
            status: "active",
            balance: 7m);
        var walletPath = $"/api/v2/volunteering/organisations/{organisationId}/wallet";

        using (var anonymous = await Client.GetAsync(walletPath))
        {
            anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        await AuthenticateAsMemberAsync();
        using (var nonManager = await Client.GetAsync(walletPath))
        {
            nonManager.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await ReadJsonAsync(nonManager)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("FORBIDDEN");
        }

        using (var nonAdmin = await Client.PutAsJsonAsync(
                   $"/api/v2/admin/volunteering/organizations/{organisationId}/wallet/adjust",
                   new { amount = 1, reason = "Must not execute" }))
        {
            nonAdmin.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        await AuthenticateAsOtherTenantUserAsync();
        using (var crossTenantRead = await Client.GetAsync(walletPath))
        {
            crossTenantRead.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await ReadJsonAsync(crossTenantRead)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("FORBIDDEN");
        }

        using (var crossTenantDeposit = await Client.PostAsJsonAsync(
                   $"{walletPath}/deposit",
                   new { amount = 1 }))
        {
            crossTenantDeposit.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == organisationId)).Balance.Should().Be(7m);
        (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters()
            .AnyAsync(row => row.VolunteerOrganisationId == organisationId)).Should().BeFalse();
    }

    [Fact]
    public async Task AdminAdjustment_PersistsSignedAuditRowsAndTransactionsUseCursorMetadata()
    {
        var organisationId = await CreateOrganisationAsync(
            TestData.AdminUser.Id,
            status: "active",
            balance: 5m);
        var adminPath = $"/api/v2/admin/volunteering/organizations/{organisationId}/wallet";
        await AuthenticateAsAdminAsync();

        using (var credit = await Client.PutAsJsonAsync(
                   $"{adminPath}/adjust",
                   new { amount = 2.25m, reason = "Reconciliation credit" }))
        {
            credit.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await ReadJsonAsync(credit);
            body.GetProperty("data").GetProperty("new_balance").GetDecimal().Should().Be(7.25m);
            body.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        }

        using (var debit = await Client.PutAsJsonAsync(
                   $"{adminPath}/adjust",
                   new { amount = -1m, reason = "Correct duplicate credit" }))
        {
            debit.StatusCode.Should().Be(HttpStatusCode.OK);
            (await ReadJsonAsync(debit)).GetProperty("data")
                .GetProperty("new_balance").GetDecimal().Should().Be(6.25m);
        }

        using (var rejected = await Client.PutAsJsonAsync(
                   $"{adminPath}/adjust",
                   new { amount = -10m, reason = "Must not overdraw" }))
        {
            rejected.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var error = (await ReadJsonAsync(rejected)).GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            error.GetProperty("message").GetString()
                .Should().Be("Adjustment cannot make the balance negative");
        }

        string cursor;
        using (var firstPage = await Client.GetAsync($"{adminPath}/transactions?per_page=1"))
        {
            firstPage.StatusCode.Should().Be(HttpStatusCode.OK);
            firstPage.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
            var body = await ReadJsonAsync(firstPage);
            var data = body.GetProperty("data");
            data.GetArrayLength().Should().Be(1);
            data[0].GetProperty("type").GetString().Should().Be("admin_adjustment");
            data[0].GetProperty("amount").GetDecimal().Should().Be(-1m);
            data[0].GetProperty("balance_after").GetDecimal().Should().Be(6.25m);
            data[0].GetProperty("description").GetString()
                .Should().Be("Admin adjustment: Correct duplicate credit");
            data[0].GetProperty("user").GetProperty("id").GetInt32().Should().Be(TestData.AdminUser.Id);

            var meta = body.GetProperty("meta");
            meta.GetProperty("per_page").GetInt32().Should().Be(1);
            meta.GetProperty("has_more").GetBoolean().Should().BeTrue();
            meta.GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
            cursor = meta.GetProperty("cursor").GetString()!;
            cursor.Should().NotBeNullOrWhiteSpace();
        }

        using (var secondPage = await Client.GetAsync(
                   $"{adminPath}/transactions?per_page=1&cursor={Uri.EscapeDataString(cursor)}"))
        {
            secondPage.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await ReadJsonAsync(secondPage);
            body.GetProperty("data").GetArrayLength().Should().Be(1);
            body.GetProperty("data")[0].GetProperty("amount").GetDecimal().Should().Be(2.25m);
            var meta = body.GetProperty("meta");
            meta.GetProperty("per_page").GetInt32().Should().Be(1);
            meta.GetProperty("has_more").GetBoolean().Should().BeFalse();
            meta.GetProperty("cursor").ValueKind.Should().Be(JsonValueKind.Null);
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == organisationId)).Balance.Should().Be(6.25m);
        var auditRows = await db.VolunteerOrganisationTransactions.IgnoreQueryFilters()
            .Where(row => row.VolunteerOrganisationId == organisationId)
            .OrderBy(row => row.Id)
            .ToListAsync();
        auditRows.Select(row => row.Amount).Should().Equal(2.25m, -1m);
        auditRows.Should().OnlyContain(row => row.Type == "admin_adjustment"
            && row.UserId == TestData.AdminUser.Id);
    }

    [Fact]
    public async Task MemberWallet_FeatureGateRunsBeforeDepositLimiter()
    {
        var organisationId = await CreateOrganisationAsync(
            TestData.MemberUser.Id,
            status: "active",
            balance: 0m);
        using (var disable = Factory.Services.CreateScope())
        {
            var db = disable.ServiceProvider.GetRequiredService<NexusDbContext>();
            var config = await db.TenantConfigs.IgnoreQueryFilters()
                .SingleOrDefaultAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.Key == AdminVolunteerApprovalService.FeatureConfigKey);
            if (config is null)
            {
                db.TenantConfigs.Add(new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = AdminVolunteerApprovalService.FeatureConfigKey,
                    Value = "false",
                    CreatedAt = DateTime.UtcNow
                });
            }
            else
            {
                config.Value = "false";
            }
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();
        var path = $"/api/v2/volunteering/organisations/{organisationId}/wallet/deposit";
        for (var attempt = 0; attempt < 12; attempt++)
        {
            using var disabled = await Client.PostAsJsonAsync(path, new { amount = 1 });
            disabled.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await ReadJsonAsync(disabled)).GetProperty("errors")[0]
                .GetProperty("code").GetString().Should().Be("FEATURE_DISABLED");
        }

        using (var enable = Factory.Services.CreateScope())
        {
            var db = enable.ServiceProvider.GetRequiredService<NexusDbContext>();
            var config = await db.TenantConfigs.IgnoreQueryFilters()
                .SingleAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.Key == AdminVolunteerApprovalService.FeatureConfigKey);
            config.Value = "true";
            await db.SaveChangesAsync();
        }

        using var enabled = await Client.PostAsJsonAsync(path, new { amount = 1 });
        enabled.StatusCode.Should().Be(HttpStatusCode.OK,
            "feature-disabled requests must not consume the Laravel 10/minute deposit bucket");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == organisationId)).Balance.Should().Be(1m);
        (await verifyDb.VolunteerOrganisationTransactions.IgnoreQueryFilters()
            .CountAsync(row => row.VolunteerOrganisationId == organisationId)).Should().Be(1);
    }

    [Fact]
    public async Task CanonicalTransactionDelete_HidesOnlyParticipantHistoryWithoutReversingDeposit()
    {
        var organisationId = await CreateOrganisationAsync(
            TestData.MemberUser.Id,
            status: "active",
            balance: 0m);
        var personalBalanceBefore = await PersonalBalanceAsync(TestData.MemberUser.Id);
        await AuthenticateAsMemberAsync();
        using (var deposit = await Client.PostAsJsonAsync(
                   $"/api/v2/volunteering/organisations/{organisationId}/wallet/deposit",
                   new { amount = 3, note = "Immutable deposit debit" }))
        {
            deposit.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        int transactionId;
        using (var read = Factory.Services.CreateScope())
        {
            var db = read.ServiceProvider.GetRequiredService<NexusDbContext>();
            transactionId = await db.Transactions.IgnoreQueryFilters()
                .Where(row => row.TenantId == TestData.Tenant1.Id
                    && row.SenderId == TestData.MemberUser.Id
                    && row.ReceiverId == null
                    && row.Description == "Volunteer organisation deposit: Immutable deposit debit")
                .Select(row => row.Id)
                .SingleAsync();
        }

        await AuthenticateAsOtherTenantUserAsync();
        using (var outsider = await Client.DeleteAsync($"/api/v2/wallet/transactions/{transactionId}"))
        {
            outsider.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        await AuthenticateAsMemberAsync();
        using (var hide = await Client.DeleteAsync($"/api/v2/wallet/transactions/{transactionId}"))
        {
            hide.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }
        using (var hiddenDetail = await Client.GetAsync($"/api/v2/wallet/transactions/{transactionId}"))
        {
            hiddenDetail.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var transaction = await verifyDb.Transactions.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == transactionId);
        transaction.Status.Should().Be(TransactionStatus.Completed);
        transaction.DeletedForSender.Should().BeTrue();
        transaction.DeletedForReceiver.Should().BeFalse();
        (await verifyDb.VolunteerOrganisations.IgnoreQueryFilters()
            .Where(row => row.Id == organisationId)
            .Select(row => row.Balance)
            .SingleAsync()).Should().Be(3m);
        (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(personalBalanceBefore - 3m);
    }

    [Fact]
    public async Task ConcurrentDeposits_NeverOverdrawOrLoseCommittedOrganisationCredits()
    {
        var organisationId = await CreateOrganisationAsync(
            TestData.MemberUser.Id,
            status: "active",
            balance: 0m);
        var personalBalanceBefore = await PersonalBalanceAsync(TestData.MemberUser.Id);
        personalBalanceBefore.Should().Be(10m);
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        var clients = Enumerable.Range(0, 10)
            .Select(_ => Factory.CreateClient())
            .ToArray();
        foreach (var client in clients)
        {
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", token);
        }

        HttpResponseMessage[] responses = [];
        try
        {
            responses = await Task.WhenAll(clients.Select((client, index) =>
                client.PostAsJsonAsync(
                    $"/api/v2/volunteering/organisations/{organisationId}/wallet/deposit",
                    new { amount = 2, note = $"Concurrent deposit {index + 1}" })));

            responses.Should().OnlyContain(response =>
                response.StatusCode == HttpStatusCode.OK
                || response.StatusCode == HttpStatusCode.BadRequest);
            var successCount = responses.Count(response => response.StatusCode == HttpStatusCode.OK);
            successCount.Should().Be(5);

            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var organisationBalance = await db.VolunteerOrganisations.IgnoreQueryFilters()
                .Where(row => row.Id == organisationId)
                .Select(row => row.Balance)
                .SingleAsync();
            var organisationLedger = await db.VolunteerOrganisationTransactions.IgnoreQueryFilters()
                .Where(row => row.VolunteerOrganisationId == organisationId)
                .ToListAsync();
            var personalBalanceAfter = await PersonalBalanceAsync(TestData.MemberUser.Id);

            organisationBalance.Should().Be(successCount * 2m);
            organisationLedger.Should().HaveCount(successCount);
            organisationLedger.Sum(row => row.Amount).Should().Be(organisationBalance);
            organisationLedger.Should().OnlyContain(row => row.BalanceAfter >= 0m);
            personalBalanceAfter.Should().Be(personalBalanceBefore - organisationBalance);
            personalBalanceAfter.Should().BeGreaterOrEqualTo(0m);
        }
        finally
        {
            foreach (var response in responses)
                response.Dispose();
            foreach (var client in clients)
                client.Dispose();
        }
    }

    [Fact]
    public async Task DepositAndPersonalTransfer_ShareBalanceLockAndCannotOverdraw()
    {
        var organisationId = await CreateOrganisationAsync(
            TestData.MemberUser.Id,
            status: "active",
            balance: 0m);
        (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(10m);
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        using var depositClient = Factory.CreateClient();
        using var transferClient = Factory.CreateClient();
        depositClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);
        transferClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);

        var depositTask = depositClient.PostAsJsonAsync(
            $"/api/v2/volunteering/organisations/{organisationId}/wallet/deposit",
            new { amount = 6, note = "Shared-lock deposit" });
        var transferTask = transferClient.PostAsJsonAsync(
            "/api/v2/wallet/transfer",
            new
            {
                recipient = TestData.AdminUser.Id,
                amount = 6,
                description = "Shared-lock transfer"
            });
        var responses = await Task.WhenAll(depositTask, transferTask);
        try
        {
            responses.Should().OnlyContain(response =>
                response.IsSuccessStatusCode
                || response.StatusCode == HttpStatusCode.BadRequest);
            responses.Count(response => response.IsSuccessStatusCode).Should().Be(1);

            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var depositRows = await db.Transactions.IgnoreQueryFilters()
                .Where(row => row.TenantId == TestData.Tenant1.Id
                    && row.SenderId == TestData.MemberUser.Id
                    && row.ReceiverId == null
                    && row.Description == "Volunteer organisation deposit: Shared-lock deposit")
                .ToListAsync();
            var transferRows = await db.Transactions.IgnoreQueryFilters()
                .Where(row => row.TenantId == TestData.Tenant1.Id
                    && row.SenderId == TestData.MemberUser.Id
                    && row.ReceiverId == TestData.AdminUser.Id
                    && row.Description == "Shared-lock transfer")
                .ToListAsync();
            var organisation = await db.VolunteerOrganisations.IgnoreQueryFilters()
                .SingleAsync(row => row.Id == organisationId);

            (depositRows.Count + transferRows.Count).Should().Be(1);
            organisation.Balance.Should().Be(depositRows.Count * 6m);
            (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(4m);
        }
        finally
        {
            foreach (var response in responses)
                response.Dispose();
        }
    }

    [Fact]
    public async Task CanonicalTransfer_ExplicitIdempotencyKeyReplaysWithoutSecondDebit()
    {
        var personalBalanceBefore = await PersonalBalanceAsync(TestData.MemberUser.Id);
        personalBalanceBefore.Should().Be(10m);
        await AuthenticateAsMemberAsync();
        Client.DefaultRequestHeaders.Add("Idempotency-Key", $"wallet-test-{Guid.NewGuid():N}");
        var payload = new
        {
            recipient = TestData.AdminUser.Id,
            amount = 2,
            description = "Idempotent canonical transfer"
        };

        int firstId;
        using (var first = await Client.PostAsJsonAsync("/api/v2/wallet/transfer", payload))
        {
            first.StatusCode.Should().Be(HttpStatusCode.Created);
            firstId = (await ReadJsonAsync(first)).GetProperty("data").GetProperty("id").GetInt32();
        }
        using (var replay = await Client.PostAsJsonAsync("/api/v2/wallet/transfer", payload))
        {
            replay.StatusCode.Should().Be(HttpStatusCode.Created);
            (await ReadJsonAsync(replay)).GetProperty("data").GetProperty("id").GetInt32()
                .Should().Be(firstId);
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Transactions.IgnoreQueryFilters()
            .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.SenderId == TestData.MemberUser.Id
                && row.ReceiverId == TestData.AdminUser.Id
                && row.Description == "Idempotent canonical transfer"))
            .Should().Be(1);
        (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(personalBalanceBefore - 2m);
    }

    [Fact]
    public async Task CanonicalTransfer_OnboardingGateRunsBeforeTenPerMinuteLimiter()
    {
        int requiredStepId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var step = new OnboardingStep
            {
                TenantId = TestData.Tenant1.Id,
                Key = $"wallet-gate-{Guid.NewGuid():N}",
                Title = "Wallet gate test",
                IsRequired = true,
                CreatedAt = DateTime.UtcNow
            };
            db.Set<OnboardingStep>().Add(step);
            await db.SaveChangesAsync();
            requiredStepId = step.Id;
        }

        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        using var gatedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:PersonalWallet:TransferPermitLimit"] = "10",
                    ["RateLimiting:PersonalWallet:TransferWindowSeconds"] = "60"
                }));
            builder.ConfigureServices(services =>
            {
                foreach (var hostedService in services
                             .Where(descriptor => descriptor.ServiceType == typeof(Microsoft.Extensions.Hosting.IHostedService)
                                 && descriptor.ImplementationType?.Assembly == typeof(Program).Assembly)
                             .ToList())
                {
                    services.Remove(hostedService);
                }
            });
        });
        using var gatedClient = gatedFactory.CreateClient();
        gatedClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);
        var payload = new
        {
            recipient = TestData.AdminUser.Id,
            amount = 0.25m,
            description = "Onboarding gate order"
        };

        for (var attempt = 0; attempt < 12; attempt++)
        {
            using var blocked = await gatedClient.PostAsJsonAsync("/api/v2/wallet/transfer", payload);
            blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await ReadJsonAsync(blocked)).GetProperty("errors")[0].GetProperty("code")
                .GetString().Should().Be("ONBOARDING_REQUIRED");
        }

        using (var legacyAllowed = await gatedClient.PostAsJsonAsync(
                   "/api/wallet/transfer",
                   new
                   {
                       receiver_id = TestData.AdminUser.Id,
                       amount = 0.25m,
                       description = "Legacy route has no onboarding gate"
                   }))
        {
            legacyAllowed.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Set<OnboardingProgress>().Add(new OnboardingProgress
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                StepId = requiredStepId,
                IsCompleted = true,
                CompletedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        using var allowed = await gatedClient.PostAsJsonAsync("/api/v2/wallet/transfer", payload);
        allowed.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task LegacyTransfer_ExplicitIdempotencyKeyReplaysThroughSharedService()
    {
        var balanceBefore = await PersonalBalanceAsync(TestData.MemberUser.Id);
        await AuthenticateAsMemberAsync();
        Client.DefaultRequestHeaders.Add("Idempotency-Key", $"legacy-wallet-{Guid.NewGuid():N}");
        var payload = new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = 1.25m,
            description = "Legacy shared-service replay"
        };

        int firstId;
        using (var first = await Client.PostAsJsonAsync("/api/wallet/transfer", payload))
        {
            first.StatusCode.Should().Be(HttpStatusCode.Created);
            firstId = (await ReadJsonAsync(first)).GetProperty("id").GetInt32();
        }
        using (var replay = await Client.PostAsJsonAsync("/api/wallet/transfer", payload))
        {
            replay.StatusCode.Should().Be(HttpStatusCode.Created);
            (await ReadJsonAsync(replay)).GetProperty("id").GetInt32().Should().Be(firstId);
        }

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Transactions.IgnoreQueryFilters()
            .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                && row.SenderId == TestData.MemberUser.Id
                && row.Description == "Legacy shared-service replay"))
            .Should().Be(1);
        (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(balanceBefore - 1.25m);
    }

    [Fact]
    public async Task CaringGiftReservationAndPersonalTransfer_ShareBalanceLock()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var feature = await db.TenantConfigs.IgnoreQueryFilters()
                .SingleOrDefaultAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.Key == "features.caring_community");
            if (feature is null)
            {
                db.TenantConfigs.Add(new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = "features.caring_community",
                    Value = "true"
                });
            }
            else
            {
                feature.Value = "true";
            }
            await db.SaveChangesAsync();
        }

        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        using var giftClient = Factory.CreateClient();
        using var transferClient = Factory.CreateClient();
        giftClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        transferClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var giftTask = giftClient.PostAsJsonAsync(
            "/api/caring-community/hour-gifts/send",
            new
            {
                recipient_user_id = TestData.AdminUser.Id,
                hours = 6m,
                message = "Shared-lock gift"
            });
        var transferTask = transferClient.PostAsJsonAsync(
            "/api/v2/wallet/transfer",
            new
            {
                recipient = TestData.AdminUser.Id,
                amount = 6m,
                description = "Shared-lock gift competitor"
            });
        var responses = await Task.WhenAll(giftTask, transferTask);
        try
        {
            responses.Should().OnlyContain(response => response.IsSuccessStatusCode
                || response.StatusCode == HttpStatusCode.BadRequest
                || response.StatusCode == HttpStatusCode.UnprocessableEntity);
            responses.Count(response => response.IsSuccessStatusCode).Should().Be(1);

            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var giftReservations = await db.Transactions.IgnoreQueryFilters()
                .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.SenderId == TestData.MemberUser.Id
                    && row.Description == "Caring hour gift reservation");
            var transfers = await db.Transactions.IgnoreQueryFilters()
                .CountAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.SenderId == TestData.MemberUser.Id
                    && row.Description == "Shared-lock gift competitor");
            (giftReservations + transfers).Should().Be(1);
            (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(4m);
        }
        finally
        {
            foreach (var response in responses)
                response.Dispose();
        }
    }

    [Fact]
    public async Task CanonicalTransfer_CorsPreflightAllowsIdempotencyKey()
    {
        const string origin = "https://wallet-ui.example.test";
        using var corsClient = Factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v2/wallet/transfer");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type,idempotency-key");

        using var response = await corsClient.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().ContainSingle(origin);
        response.Headers.GetValues("Access-Control-Allow-Headers")
            .SelectMany(value => value.Split(',', StringSplitOptions.TrimEntries))
            .Should().Contain(header => header.Equals("Idempotency-Key", StringComparison.OrdinalIgnoreCase));
    }

    private async Task<int> CreateOrganisationAsync(
        int ownerUserId,
        string status,
        decimal balance)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var organisation = new VolunteerOrganisation
        {
            TenantId = TestData.Tenant1.Id,
            OwnerUserId = ownerUserId,
            Name = $"Wallet Test Organisation {Guid.NewGuid():N}",
            Slug = $"wallet-test-{Guid.NewGuid():N}",
            Description = "Volunteer organisation wallet integration-test fixture.",
            ContactEmail = "wallet-test@example.test",
            Status = status,
            Balance = balance,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOrganisations.Add(organisation);
        await db.SaveChangesAsync();
        return organisation.Id;
    }

    private async Task<decimal> PersonalBalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var received = await db.Transactions.IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.ReceiverId == userId
                && row.Status == TransactionStatus.Completed)
            .SumAsync(row => row.Amount);
        var sent = await db.Transactions.IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.SenderId == userId
                && row.Status == TransactionStatus.Completed)
            .SumAsync(row => row.Amount);
        return received - sent;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }
}
