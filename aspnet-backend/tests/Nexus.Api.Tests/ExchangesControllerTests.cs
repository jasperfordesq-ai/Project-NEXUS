// Copyright © 2024–2026 Jasper Ford
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
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for the Exchange workflow - the core of timebanking.
/// Tests the full lifecycle: request → accept → start → complete → rate.
/// </summary>
[Collection("Integration")]
public class ExchangesControllerTests : IntegrationTestBase
{
    private const string CompletionUnavailable =
        "Exchange completion requires matching confirmation from both participants and is not available on this endpoint.";

    public ExchangesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Create Exchange

    [Fact]
    public async Task CreateExchange_OnActiveOffer_Succeeds()
    {
        // Arrange - Member requests an exchange on Admin's listing
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id, // Admin's listing
            agreed_hours = 2.0,
            message = "I'd like to exchange services"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        content.GetProperty("status").GetString().Should().Be("requested");
        content.GetProperty("agreed_hours").GetDecimal().Should().Be(2.0m);
    }

    [Fact]
    public async Task CreateExchange_OnOwnListing_Fails()
    {
        // Arrange - Admin tries to exchange on their own listing
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id, // Admin's own listing
            agreed_hours = 1.0
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("own listing");
    }

    [Fact]
    public async Task CreateExchange_OnNonExistentListing_Fails()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = 99999,
            agreed_hours = 1.0
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("not found");
    }

    [Fact]
    public async Task CreateExchange_Duplicate_Fails()
    {
        await AuthenticateAsMemberAsync();

        // First exchange
        await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });

        // Duplicate
        var response = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("already have an active");
    }

    #endregion

    #region Accept/Decline Exchange

    [Fact]
    public async Task AcceptExchange_ByListingOwner_Succeeds()
    {
        // Arrange - Create exchange as member
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 2.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        // Act - Accept as admin (listing owner)
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("accepted");
    }

    [Fact]
    public async Task AcceptExchange_ByNonOwner_Fails()
    {
        // Arrange - Create exchange as member on admin's listing
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        // Act - Member tries to accept their own request (not the listing owner)
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("listing owner");
    }

    [Fact]
    public async Task AcceptExchange_WithAdjustedHours_UpdatesHours()
    {
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 2.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new
        {
            adjusted_hours = 3.0
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("agreed_hours").GetDecimal().Should().Be(3.0m);
    }

    [Fact]
    public async Task DeclineExchange_ByListingOwner_Succeeds()
    {
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/decline", new
        {
            reason = "Not available this week"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("declined");
    }

    #endregion

    #region Start/Complete Exchange

    [Fact]
    public async Task StartExchange_WhenAccepted_Succeeds()
    {
        var exchangeId = await CreateAndAcceptExchangeAsync();

        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/start", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("inprogress");
    }

    [Fact]
    public async Task StartExchange_WhenRequested_Fails()
    {
        // Arrange - Create but don't accept
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        // Act - Try to start without accepting
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/start", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Cannot transition");
    }

    [Fact]
    public async Task CompleteExchange_WithoutTwoPartyConfirmation_FailsClosedWithoutMutation()
    {
        var exchangeId = await CreateAcceptAndStartExchangeAsync();
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);
        int transactionCountBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            transactionCountBefore = await db.Transactions.IgnoreQueryFilters().CountAsync();
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/complete", new
        {
            actual_hours = 2.0
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Be(CompletionUnavailable);

        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var exchange = await db.Exchanges.IgnoreQueryFilters().SingleAsync(row => row.Id == exchangeId);
            exchange.Status.Should().Be(ExchangeStatus.InProgress);
            exchange.ActualHours.Should().BeNull();
            exchange.CompletedAt.Should().BeNull();
            exchange.TransactionId.Should().BeNull();
            (await db.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(transactionCountBefore);
        }

        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
    }

    [Fact]
    public async Task CompleteExchange_WithInsufficientBalance_StillReturnsConfirmationUnavailableWithoutMutation()
    {
        var exchangeId = await CreateAcceptAndStartExchangeAsync();

        // Raise the settlement amount only after a valid lifecycle setup so
        // the request reaches the deliberately unavailable completion path.
        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var exchange = await db.Exchanges.SingleAsync(row => row.Id == exchangeId);
            exchange.AgreedHours = 9999m;
            await db.SaveChangesAsync();
        }

        var adminBalanceBefore = await GetBalanceAsync(TestData.AdminUser.Id);
        var memberBalanceBefore = await GetBalanceAsync(TestData.MemberUser.Id);
        int transactionCountBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            transactionCountBefore = await scope.ServiceProvider.GetRequiredService<NexusDbContext>()
                .Transactions.IgnoreQueryFilters().CountAsync();
        }

        // The confirmation boundary is checked before any balance/settlement work.
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/complete", new { });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Be(CompletionUnavailable);

        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var exchange = await db.Exchanges.IgnoreQueryFilters().SingleAsync(row => row.Id == exchangeId);
            exchange.Status.Should().Be(ExchangeStatus.InProgress);
            exchange.AgreedHours.Should().Be(9999m);
            exchange.ActualHours.Should().BeNull();
            exchange.CompletedAt.Should().BeNull();
            exchange.TransactionId.Should().BeNull();
            (await db.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(transactionCountBefore);
        }

        (await GetBalanceAsync(TestData.AdminUser.Id)).Should().Be(adminBalanceBefore);
        (await GetBalanceAsync(TestData.MemberUser.Id)).Should().Be(memberBalanceBefore);
    }

    #endregion

    #region Cancel/Dispute Exchange

    [Fact]
    public async Task CancelExchange_ByInitiator_Succeeds()
    {
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/cancel", new
        {
            reason = "Changed my mind"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("cancelled");
    }

    [Fact]
    public async Task DisputeExchange_WhenCompleted_Succeeds()
    {
        var exchangeId = await SeedCompletedExchangeAsync();

        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/dispute", new
        {
            reason = "Work was not satisfactory"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("disputed");
    }

    [Fact]
    public async Task DisputeExchange_WhenRequested_Fails()
    {
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        var response = await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/dispute", new
        {
            reason = "Some reason"
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Rate Exchange

    [Fact]
    public async Task RateExchange_WhenCompleted_Succeeds()
    {
        var exchangeId = await SeedCompletedExchangeAsync();

        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/rate", new
        {
            rating = 5,
            comment = "Great service!",
            would_work_again = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("rating").GetInt32().Should().Be(5);
        content.GetProperty("would_work_again").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task RateExchange_DuplicateRating_Fails()
    {
        var exchangeId = await SeedCompletedExchangeAsync();

        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/rate", new
        {
            rating = 5,
            comment = "Great!"
        });

        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/rate", new
        {
            rating = 4,
            comment = "Changed my mind"
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("already rated");
    }

    [Fact]
    public async Task RateExchange_InvalidRating_Fails()
    {
        var exchangeId = await SeedCompletedExchangeAsync();

        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/rate", new
        {
            rating = 6 // Max is 5
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region List/Get Exchanges

    [Fact]
    public async Task ListExchanges_ReturnsUserExchanges()
    {
        await AuthenticateAsMemberAsync();

        // Create an exchange first
        await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });

        var response = await Client.GetAsync("/api/exchanges");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().BeGreaterThan(0);
        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task GetExchange_AsParticipant_Succeeds()
    {
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        var response = await Client.GetAsync($"/api/exchanges/{exchangeId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().Be(exchangeId);
        content.GetProperty("role").GetString().Should().Be("initiator");
    }

    [Fact]
    public async Task GetExchange_AsNonParticipant_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        // Try to access from another tenant
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.GetAsync($"/api/exchanges/{exchangeId}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetExchangesByListing_ReturnsFilteredResults()
    {
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 1.0
        });

        var response = await Client.GetAsync($"/api/exchanges/by-listing/{TestData.Listing1.Id}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().BeGreaterThan(0);
    }

    #endregion

    #region Helpers

    private async Task<int> CreateAndAcceptExchangeAsync()
    {
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 2.0
        });
        var exchangeId = (await createResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        await AuthenticateAsAdminAsync();
        await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { });

        return exchangeId;
    }

    private async Task<int> CreateAcceptAndStartExchangeAsync()
    {
        var exchangeId = await CreateAndAcceptExchangeAsync();

        await AuthenticateAsMemberAsync();
        await Client.PutAsJsonAsync($"/api/exchanges/{exchangeId}/start", new { });

        return exchangeId;
    }

    private async Task<int> SeedCompletedExchangeAsync()
    {
        var exchangeId = await CreateAcceptAndStartExchangeAsync();

        // Completion itself is intentionally unavailable. Tests for dispute
        // and rating seed their required completed-state fixture directly so
        // they do not imply that the one-party completion endpoint is usable.
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.SingleAsync(row => row.Id == exchangeId);
        exchange.Status = ExchangeStatus.Completed;
        exchange.ActualHours = exchange.AgreedHours;
        exchange.CompletedAt = DateTime.UtcNow;
        exchange.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return exchangeId;
    }

    private async Task<decimal> GetBalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        return await wallet.GetBalanceAsync(TestData.Tenant1.Id, userId);
    }

    #endregion
}
