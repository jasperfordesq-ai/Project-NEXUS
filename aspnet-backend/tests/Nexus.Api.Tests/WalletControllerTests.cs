// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for wallet/transaction endpoints.
/// Tests balance calculation, transfers, and transaction history.
/// </summary>
[Collection("Integration")]
public class WalletControllerTests : IntegrationTestBase
{
    public WalletControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Balance Tests

    [Fact]
    public async Task GetBalance_ReturnsCorrectBalance()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/balance");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("balance").GetDecimal().Should().Be(10.0m); // From seed data
        content.GetProperty("currency").GetString().Should().Be("hours");
    }

    [Fact]
    public async Task GetBalance_NewUser_ReturnsZero()
    {
        // Arrange - Admin user has no received transactions in seed data
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/balance");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        // Admin sent 10 to member, so balance is negative
        content.GetProperty("sent_total").GetDecimal().Should().Be(10.0m);
    }

    #endregion

    #region Transfer Tests

    [Fact]
    public async Task Transfer_WithSufficientBalance_Succeeds()
    {
        // Arrange
        await AuthenticateAsMemberAsync();
        var initialBalanceResponse = await Client.GetAsync("/api/wallet/balance");
        var initialBalance = (await initialBalanceResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("balance").GetDecimal();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = 2.0,
            description = "Test transfer"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("amount").GetDecimal().Should().Be(2.0m);
        content.GetProperty("new_balance").GetDecimal().Should().Be(initialBalance - 2.0m);
    }

    [Fact]
    public async Task Transfer_WithInsufficientBalance_Fails()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act - Try to transfer more than available balance
        var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = 499.0, // Within single transfer limit (500) but more than balance
            description = "Too much"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Insufficient");
    }

    [Fact]
    public async Task Transfer_ToSelf_Fails()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.MemberUser.Id, // Same user
            amount = 1.0,
            description = "Self transfer"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("yourself");
    }

    [Fact]
    public async Task Transfer_NegativeAmount_Fails()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = -5.0,
            description = "Negative amount"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Transfer_ZeroAmount_Fails()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = 0,
            description = "Zero amount"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Transfer_ToNonExistentUser_Fails()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = 99999, // Non-existent
            amount = 1.0,
            description = "Ghost user"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Transaction History Tests

    [Fact]
    public async Task GetTransactions_ReturnsPaginatedResults()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/transactions?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().BeGreaterThan(0);
        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
        content.GetProperty("pagination").GetProperty("limit").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task GetTransactions_FilterBySent_ReturnsOnlySentTransactions()
    {
        // Arrange - First make a transfer
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = 1.0,
            description = "Filter test"
        });

        // Act
        var response = await Client.GetAsync("/api/wallet/transactions?type=sent");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var transactions = content.GetProperty("data").EnumerateArray().ToList();
        transactions.Should().AllSatisfy(t =>
            t.GetProperty("type").GetString().Should().Be("sent"));
    }

    [Fact]
    public async Task GetTransaction_ById_ReturnsTransaction()
    {
        // Arrange - Make a transfer first
        await AuthenticateAsMemberAsync();
        var transferResponse = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = 0.5,
            description = "Get by ID test"
        });

        var transferContent = await transferResponse.Content.ReadFromJsonAsync<JsonElement>();
        var transactionId = transferContent.GetProperty("id").GetInt32();

        // Act
        var response = await Client.GetAsync($"/api/wallet/transactions/{transactionId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().Be(transactionId);
        content.GetProperty("amount").GetDecimal().Should().Be(0.5m);
    }

    [Fact]
    public async Task GetTransaction_NotParticipant_ReturnsNotFound()
    {
        // Arrange - Make a transfer as member
        await AuthenticateAsMemberAsync();
        var transferResponse = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.AdminUser.Id,
            amount = 0.25,
            description = "Participant test"
        });

        var transferContent = await transferResponse.Content.ReadFromJsonAsync<JsonElement>();
        var transactionId = transferContent.GetProperty("id").GetInt32();

        // Act - Try to view as other tenant user (not a participant)
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.GetAsync($"/api/wallet/transactions/{transactionId}");

        // Assert - Should not find it (tenant isolation + participant check)
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion
}
