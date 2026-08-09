// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for wallet concurrency and race condition handling.
/// Verifies that concurrent transfers don't cause overdrafts.
/// </summary>
[Collection("Integration")]
public class WalletConcurrencyTests : IntegrationTestBase
{
    public WalletConcurrencyTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ConcurrentTransfers_DoNotOverdraft()
    {
        // Arrange - Get auth token for member user
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");

        // Get the actual current balance first (may differ from seed data if other tests ran)
        var balanceClient = Factory.CreateClient();
        balanceClient.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var initialBalanceResponse = await balanceClient.GetAsync("/api/wallet/balance");
        var initialBalanceContent = await initialBalanceResponse.Content.ReadFromJsonAsync<JsonElement>();
        var initialBalance = initialBalanceContent.GetProperty("balance").GetDecimal();

        // Create multiple HTTP clients with the same auth
        var clients = Enumerable.Range(0, 5).Select(_ =>
        {
            var client = Factory.CreateClient();
            client.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            return client;
        }).ToList();

        // Act - Try to transfer 3.0 hours x 5 concurrently
        var testRunId = Guid.NewGuid();
        var transferTasks = clients.Select((client, index) =>
            client.PostAsJsonAsync("/api/wallet/transfer", new
            {
                receiver_id = TestData.AdminUser.Id,
                amount = 3.0,
                description = "Concurrent transfer test",
                idempotency_key = $"wallet-concurrency-{testRunId:N}-{index}"
            }));

        var responses = await Task.WhenAll(transferTasks);

        // Assert - Only some transfers should succeed (up to available balance)
        var successCount = responses.Count(r => r.StatusCode == HttpStatusCode.Created);
        var insufficientBalanceCount = responses.Count(r => r.StatusCode == HttpStatusCode.BadRequest);
        // Serialization conflicts indicate the lock prevented a race condition.
        var conflictCount = responses.Count(r => r.StatusCode == HttpStatusCode.Conflict);
        var serializationConflictCount = responses.Count(r => r.StatusCode == HttpStatusCode.InternalServerError);

        // Max possible successes depends on current balance
        var maxPossibleSuccesses = (int)(initialBalance / 3.0m);
        successCount.Should().BeLessOrEqualTo(maxPossibleSuccesses + 1,
            $"because only {initialBalance} hours are available (max {maxPossibleSuccesses} transfers of 3.0)");
        // All requests should complete with one of: Created, BadRequest (insufficient), 409, or legacy 500 serialization conflict.
        (successCount + insufficientBalanceCount + conflictCount + serializationConflictCount).Should().Be(5, "because all requests should complete");

        // Verify final balance is not negative
        var balanceResponse = await clients[0].GetAsync("/api/wallet/balance");
        var balanceContent = await balanceResponse.Content.ReadFromJsonAsync<JsonElement>();
        var finalBalance = balanceContent.GetProperty("balance").GetDecimal();

        finalBalance.Should().BeGreaterOrEqualTo(0, "balance should never go negative");

        // Verify the math: final balance = initial - (successCount * 3.0)
        var totalTransferred = successCount * 3.0m;
        var expectedBalance = initialBalance - totalTransferred;
        finalBalance.Should().Be(expectedBalance,
            $"because {successCount} transfers of 3.0 succeeded from balance of {initialBalance}");
    }

    [Fact]
    public async Task SequentialTransfers_MaintainCorrectBalance()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Get initial balance
        var initialResponse = await Client.GetAsync("/api/wallet/balance");
        var initialContent = await initialResponse.Content.ReadFromJsonAsync<JsonElement>();
        var initialBalance = initialContent.GetProperty("balance").GetDecimal();

        // Act - Make 3 sequential transfers
        var transferAmount = 1.0m;
        for (int i = 0; i < 3; i++)
        {
            var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
            {
                receiver_id = TestData.AdminUser.Id,
                amount = transferAmount,
                description = $"Sequential transfer {i + 1}"
            });

            response.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        // Assert - Final balance should be reduced by total transferred
        var finalResponse = await Client.GetAsync("/api/wallet/balance");
        var finalContent = await finalResponse.Content.ReadFromJsonAsync<JsonElement>();
        var finalBalance = finalContent.GetProperty("balance").GetDecimal();

        finalBalance.Should().Be(initialBalance - (3 * transferAmount));
    }

    [Fact]
    public async Task Transfer_ExactlyRemainingBalance_Succeeds()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Get current balance
        var balanceResponse = await Client.GetAsync("/api/wallet/balance");
        var balanceContent = await balanceResponse.Content.ReadFromJsonAsync<JsonElement>();
        var currentBalance = balanceContent.GetProperty("balance").GetDecimal();

        // Act - Transfer exactly the remaining balance
        var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = currentBalance,
            description = "Transfer entire balance"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        // Verify balance is now zero
        var newBalanceResponse = await Client.GetAsync("/api/wallet/balance");
        var newBalanceContent = await newBalanceResponse.Content.ReadFromJsonAsync<JsonElement>();
        var newBalance = newBalanceContent.GetProperty("balance").GetDecimal();

        newBalance.Should().Be(0);
    }
}
