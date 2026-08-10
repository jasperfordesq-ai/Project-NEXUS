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
/// Integration tests for the WalletFeaturesController.
/// Tests categories, limits, summary, donations, alerts, and export.
/// </summary>
[Collection("Integration")]
public class WalletFeaturesControllerTests : IntegrationTestBase
{
    public WalletFeaturesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Auth Checks

    [Fact]
    public async Task GetCategories_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/wallet/features/categories");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetSummary_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/wallet/features/summary");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Categories

    [Fact]
    public async Task GetCategories_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/features/categories");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    #endregion

    #region Limits

    [Fact]
    public async Task GetMyLimits_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/features/limits");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("source").GetString().Should().NotBeNull();
    }

    #endregion

    #region Summary

    [Fact]
    public async Task GetSummary_Authenticated_ReturnsBalanceSummary()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/features/summary");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("currency").GetString().Should().Be("hours");
        content.TryGetProperty("balance", out _).Should().BeTrue();
        content.TryGetProperty("received_total", out _).Should().BeTrue();
        content.TryGetProperty("sent_total", out _).Should().BeTrue();
    }

    #endregion

    #region Donations

    [Fact]
    public async Task Donate_NegativeAmount_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/features/donate", new
        {
            amount = -5,
            recipient_id = TestData.AdminUser.Id
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("greater than zero");
    }

    [Fact]
    public async Task Donate_ToSelf_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/features/donate", new
        {
            amount = 1,
            recipient_id = TestData.MemberUser.Id
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Cannot donate to yourself");
    }

    [Fact]
    public async Task GetDonations_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/features/donations");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
    }

    #endregion

    #region Alerts

    [Fact]
    public async Task CreateAlert_ValidThreshold_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/features/alerts", new
        {
            threshold_amount = 5.0
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("threshold_amount").GetDecimal().Should().Be(5.0m);
        content.GetProperty("is_active").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task CreateAlert_NegativeThreshold_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/wallet/features/alerts", new
        {
            threshold_amount = -1.0
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("negative");
    }

    [Fact]
    public async Task DeleteAlert_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync("/api/wallet/features/alerts/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Export

    [Fact]
    public async Task ExportTransactions_Authenticated_ReturnsCsv()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/wallet/features/export");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
    }

    #endregion
}
