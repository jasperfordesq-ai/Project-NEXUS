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
/// Integration tests verifying tenant isolation.
/// Ensures users cannot access data from other tenants.
/// </summary>
[Collection("Integration")]
public class TenantIsolationTests : IntegrationTestBase
{
    public TenantIsolationTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Listings Isolation

    [Fact]
    public async Task GetListings_OnlyReturnsSameTenantListings()
    {
        // Arrange
        await AuthenticateAsAdminAsync(); // test-tenant user

        // Act
        var response = await Client.GetAsync("/api/listings");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var listings = content.GetProperty("data").EnumerateArray().ToList();

        // Should only see listings from test-tenant (Listing1 and Listing2)
        listings.Should().HaveCountGreaterThanOrEqualTo(2);
        listings.All(l => l.GetProperty("title").GetString()!.Contains("Service")).Should().BeTrue();
    }

    [Fact]
    public async Task GetListing_FromOtherTenant_ReturnsNotFound()
    {
        // Arrange - Authenticate as other-tenant user
        await AuthenticateAsOtherTenantUserAsync();

        // Act - Try to get listing from test-tenant
        var response = await Client.GetAsync($"/api/listings/{TestData.Listing1.Id}");

        // Assert - Should not find it due to tenant isolation
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateListing_InOwnTenant_Succeeds()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/listings", new
        {
            title = "New Tenant Service",
            description = "A service in the correct tenant",
            type = "offer",
            estimated_hours = 1.0
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    #endregion

    #region Users Isolation

    [Fact]
    public async Task GetUsers_OnlyReturnsSameTenantUsers()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/users");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var users = content.GetProperty("data").EnumerateArray().ToList();

        // Should only see users from test-tenant (admin and member)
        users.Should().HaveCountGreaterThanOrEqualTo(2);
        users.Any(u => u.GetProperty("email").GetString() == "other@test.com").Should().BeFalse();
    }

    [Fact]
    public async Task GetUser_FromOtherTenant_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act - Try to get user from other-tenant
        var response = await Client.GetAsync($"/api/users/{TestData.OtherTenantUser.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Wallet Isolation

    [Fact]
    public async Task Transfer_ToUserInOtherTenant_Fails()
    {
        // Arrange
        await AuthenticateAsMemberAsync(); // Has balance from seed data

        // Act - Try to transfer to user in other-tenant
        var response = await Client.PostAsJsonAsync("/api/wallet/transfer", new
        {
            receiver_id = TestData.OtherTenantUser.Id,
            amount = 1.0,
            description = "Cross-tenant transfer attempt"
        });

        // Assert - Should fail because receiver is in different tenant
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetTransactions_OnlyReturnsSameTenantTransactions()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/transactions");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var transactions = content.GetProperty("data").EnumerateArray().ToList();

        // Should only see transactions from test-tenant
        transactions.Should().NotBeEmpty();
    }

    #endregion

    #region Messages Isolation

    [Fact]
    public async Task SendMessage_ToUserInOtherTenant_Fails()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act - Try to send message to user in other-tenant
        var response = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.OtherTenantUser.Id,
            content = "Cross-tenant message attempt"
        });

        // Assert - Should fail
        response.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.NotFound);
    }

    #endregion

    #region Connections Isolation

    [Fact]
    public async Task CreateConnection_ToUserInOtherTenant_Fails()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act - Try to connect with user in other-tenant
        var response = await Client.PostAsJsonAsync("/api/connections", new
        {
            addressee_id = TestData.OtherTenantUser.Id
        });

        // Assert
        response.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.NotFound);
    }

    #endregion
}
