// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for FederationParityController.
 * Verifies the class-level [Authorize] gate on /api/federation/aggregates.
 */

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
public class FederationParityControllerAuthTests : IntegrationTestBase
{
    public FederationParityControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/federation/aggregates";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", (int)HttpStatusCode.OK)]
    public async Task AdminAuthGate(string role, int expectedStatus)
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

        ((int)resp.StatusCode).Should().Be(expectedStatus);
    }

    [Fact]
    public async Task MemberCannotReadRawHistoryOrInvokeCompatibilityMutation()
    {
        await AuthenticateAsMemberAsync();

        (await Client.GetAsync("/api/federation/cc/account/history"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await Client.PostAsJsonAsync("/api/federation/transactions", new { amount = 1 }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    public static TheoryData<string, string, HttpStatusCode> UnsafeWorkflowAuthCases()
    {
        var cases = new TheoryData<string, string, HttpStatusCode>();
        var paths = new[]
        {
            "/api/federation/transactions",
            "/api/federation/cc/transactions/not-persisted/commit",
            "/api/federation/external/webhooks/receive",
            "/api/federation/ingest/events"
        };

        foreach (var path in paths)
        {
            cases.Add(path, "anonymous", HttpStatusCode.Unauthorized);
            cases.Add(path, "member", HttpStatusCode.Forbidden);
            cases.Add(path, "admin", HttpStatusCode.ServiceUnavailable);
        }

        return cases;
    }

    [Theory]
    [MemberData(nameof(UnsafeWorkflowAuthCases))]
    public async Task UnsafeWorkflowRoutes_RequireAdminAndFailClosed(
        string path,
        string role,
        HttpStatusCode expectedStatus)
    {
        if (role == "anonymous")
        {
            ClearAuthToken();
        }
        else if (role == "member")
        {
            await AuthenticateAsMemberAsync();
        }
        else
        {
            await AuthenticateAsAdminAsync();
        }

        var response = await Client.PostAsJsonAsync(path, new
        {
            amount = 3m,
            event_id = "not-persisted",
            data = new[] { new { id = "not-persisted" } }
        });

        response.StatusCode.Should().Be(expectedStatus);
        if (expectedStatus != HttpStatusCode.ServiceUnavailable) return;

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("success").GetBoolean().Should().BeFalse();
        body.GetProperty("code").GetString().Should().Be("FEDERATION_WORKFLOW_UNAVAILABLE");
        body.GetProperty("error").GetString().Should().Be(
            "Federation protocol workflows are unavailable until durable authenticated persistence is implemented.");
    }

    [Fact]
    public async Task UnsafeFinancialProtocolWebhookAndIngestRoutes_DoNotMutateLedgerOrBalance()
    {
        var before = await ReadLedgerStateAsync();
        await AuthenticateAsAdminAsync();

        var routes = new[]
        {
            "/api/federation/transactions",
            "/api/federation/hour-transfer/inbound",
            "/api/federation/cc/transactions/not-persisted/commit",
            "/api/federation/external/webhooks/receive",
            "/api/federation/ingest/listings"
        };

        foreach (var route in routes)
        {
            var response = await Client.PostAsJsonAsync(route, new
            {
                amount = 3m,
                sender_id = TestData.MemberUser.Id,
                recipient_id = TestData.AdminUser.Id,
                data = new[] { new { id = "must-not-persist" } }
            });
            response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable, route);
        }

        var after = await ReadLedgerStateAsync();
        after.Should().Be(before);
    }

    [Theory]
    [InlineData("/api/federation/cc/accounts")]
    [InlineData("/api/federation/cc/account")]
    [InlineData("/api/federation/cc/transaction/not-persisted")]
    [InlineData("/api/federation/komunitin/test/accounts/not-persisted")]
    [InlineData("/api/federation/komunitin/test/transfers")]
    [InlineData("/api/federation/komunitin/test/transfers/not-persisted")]
    public async Task SyntheticBalanceStatusAndTransactionReads_FailClosed(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("code").GetString().Should().Be("FEDERATION_WORKFLOW_UNAVAILABLE");
    }

    private async Task<(int TransactionCount, decimal MemberBalance)> ReadLedgerStateAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var transactionCount = await db.Transactions.IgnoreQueryFilters().CountAsync();
        var memberBalance = await scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>()
            .GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id);
        return (transactionCount, memberBalance);
    }
}
