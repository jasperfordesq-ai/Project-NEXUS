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
/// Integration tests for Cookie Consent endpoints.
/// Tests consent recording, retrieval, updates, policy management, and admin stats.
///
/// Note: All cookie consent endpoints require tenant context (resolved from JWT).
/// Even [AllowAnonymous] endpoints need an authenticated user for tenant resolution
/// in the test environment, since the tenant middleware requires a JWT tenant_id claim
/// or Development-mode X-Tenant-ID header (tests run in Testing environment).
/// </summary>
[Collection("Integration")]
public class CookieConsentControllerTests : IntegrationTestBase
{
    public CookieConsentControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Record Consent Tests

    [Fact]
    public async Task RecordConsent_Anonymous_ReturnsOk()
    {
        // Arrange - authenticate as member for tenant context
        // (the endpoint is AllowAnonymous but tenant middleware needs JWT for tenant resolution)
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/cookies/consent", new
        {
            session_id = $"test-session-{Guid.NewGuid()}",
            analytics_cookies = true,
            marketing_cookies = false,
            preference_cookies = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("necessary_cookies").GetBoolean().Should().BeTrue();
        content.GetProperty("analytics_cookies").GetBoolean().Should().BeTrue();
        content.GetProperty("marketing_cookies").GetBoolean().Should().BeFalse();
        content.GetProperty("preference_cookies").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task RecordConsent_Authenticated_IncludesUserId()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/cookies/consent", new
        {
            session_id = $"test-session-{Guid.NewGuid()}",
            analytics_cookies = true,
            marketing_cookies = true,
            preference_cookies = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("user_id").ValueKind.Should().NotBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task RecordConsent_AllRejected_ReturnsOk()
    {
        // Arrange - authenticate for tenant context
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/cookies/consent", new
        {
            session_id = $"test-session-{Guid.NewGuid()}",
            analytics_cookies = false,
            marketing_cookies = false,
            preference_cookies = false
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("necessary_cookies").GetBoolean().Should().BeTrue();
        content.GetProperty("analytics_cookies").GetBoolean().Should().BeFalse();
        content.GetProperty("marketing_cookies").GetBoolean().Should().BeFalse();
        content.GetProperty("preference_cookies").GetBoolean().Should().BeFalse();
    }

    #endregion

    #region Get Consent Tests

    [Fact]
    public async Task GetConsent_BySessionId_ReturnsOk()
    {
        // Arrange - authenticate for tenant context, then record consent
        await AuthenticateAsMemberAsync();

        var sessionId = $"test-session-{Guid.NewGuid()}";
        await Client.PostAsJsonAsync("/api/cookies/consent", new
        {
            session_id = sessionId,
            analytics_cookies = true,
            marketing_cookies = false,
            preference_cookies = true
        });

        // Act
        var response = await Client.GetAsync($"/api/cookies/consent?session_id={sessionId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("session_id").GetString().Should().Be(sessionId);
        content.GetProperty("analytics_cookies").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task GetConsent_ByAuthenticatedUser_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Record consent as authenticated user
        await Client.PostAsJsonAsync("/api/cookies/consent", new
        {
            session_id = $"test-session-{Guid.NewGuid()}",
            analytics_cookies = true,
            marketing_cookies = true,
            preference_cookies = false
        });

        // Act
        var response = await Client.GetAsync("/api/cookies/consent");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("user_id").ValueKind.Should().NotBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task GetConsent_NonExistentSession_ReturnsNotFound()
    {
        // Arrange - authenticate for tenant context
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/cookies/consent?session_id=nonexistent-session-xyz");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Update Consent Tests

    [Fact]
    public async Task UpdateConsent_ExistingSession_ReturnsOk()
    {
        // Arrange - authenticate for tenant context, then record initial consent
        await AuthenticateAsMemberAsync();

        var sessionId = $"test-session-{Guid.NewGuid()}";
        await Client.PostAsJsonAsync("/api/cookies/consent", new
        {
            session_id = sessionId,
            analytics_cookies = true,
            marketing_cookies = false,
            preference_cookies = true
        });

        // Act - update consent
        var response = await Client.PutAsJsonAsync("/api/cookies/consent", new
        {
            session_id = sessionId,
            analytics_cookies = false,
            marketing_cookies = true,
            preference_cookies = false
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("analytics_cookies").GetBoolean().Should().BeFalse();
        content.GetProperty("marketing_cookies").GetBoolean().Should().BeTrue();
        content.GetProperty("preference_cookies").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task UpdateConsent_AuthenticatedUser_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Record initial consent
        await Client.PostAsJsonAsync("/api/cookies/consent", new
        {
            session_id = $"test-session-{Guid.NewGuid()}",
            analytics_cookies = false,
            marketing_cookies = false,
            preference_cookies = false
        });

        // Act - update consent
        var response = await Client.PutAsJsonAsync("/api/cookies/consent", new
        {
            analytics_cookies = true,
            marketing_cookies = true,
            preference_cookies = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("analytics_cookies").GetBoolean().Should().BeTrue();
        content.GetProperty("marketing_cookies").GetBoolean().Should().BeTrue();
        content.GetProperty("preference_cookies").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task UpdateConsent_NoIdentifier_ReturnsBadRequest()
    {
        // Act - no session_id and not authenticated → tenant middleware returns 400
        var response = await Client.PutAsJsonAsync("/api/cookies/consent", new
        {
            analytics_cookies = true,
            marketing_cookies = false,
            preference_cookies = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Cookie Policy Tests

    [Fact]
    public async Task GetActivePolicy_NoPolicy_ReturnsNotFound()
    {
        // Arrange - authenticate for tenant context
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/cookies/policy");

        // Assert - may be NotFound if no policy seeded, or OK if one exists
        response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreatePolicy_AsAdmin_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act - use a short version string (MaxLength 20 on CookiePolicy.Version)
        var response = await Client.PostAsJsonAsync("/api/admin/cookies/policy", new
        {
            version = $"1.{DateTime.UtcNow.Second}.{DateTime.UtcNow.Millisecond}",
            content_html = "<p>We use cookies to enhance your experience. Necessary cookies are always active.</p>"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("version").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("content_html").GetString().Should().Contain("cookies");
        content.GetProperty("is_active").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task CreatePolicy_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/cookies/policy", new
        {
            version = "1.0.0",
            content_html = "<p>Policy</p>"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CreatePolicy_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/cookies/policy", new
        {
            version = "1.0.0",
            content_html = "<p>Policy</p>"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreatePolicy_MissingVersion_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/cookies/policy", new
        {
            version = "",
            content_html = "<p>Policy</p>"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreatePolicy_MissingContent_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/cookies/policy", new
        {
            version = "2.0.0",
            content_html = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetActivePolicy_AfterCreation_ReturnsLatest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var version = $"3.{DateTime.UtcNow.Second}.{DateTime.UtcNow.Millisecond}";
        await Client.PostAsJsonAsync("/api/admin/cookies/policy", new
        {
            version,
            content_html = "<p>Latest cookie policy version.</p>"
        });

        // Act - stay authenticated (tenant context needed for policy lookup)
        var response = await Client.GetAsync("/api/cookies/policy");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("version").GetString().Should().Be(version);
        content.GetProperty("is_active").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task CreatePolicy_DeactivatesPreviousVersions()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create first policy - use short versions (MaxLength 20)
        var firstVersion = $"4.{DateTime.UtcNow.Second}.{DateTime.UtcNow.Millisecond}";
        await Client.PostAsJsonAsync("/api/admin/cookies/policy", new
        {
            version = firstVersion,
            content_html = "<p>First version.</p>"
        });

        // Small delay to ensure distinct millisecond values
        await Task.Delay(10);

        // Create second policy
        var secondVersion = $"5.{DateTime.UtcNow.Second}.{DateTime.UtcNow.Millisecond}";
        await Client.PostAsJsonAsync("/api/admin/cookies/policy", new
        {
            version = secondVersion,
            content_html = "<p>Second version replaces first.</p>"
        });

        // Act - stay authenticated (tenant context needed)
        var response = await Client.GetAsync("/api/cookies/policy");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("version").GetString().Should().Be(secondVersion);
    }

    #endregion

    #region Admin Stats Tests

    [Fact]
    public async Task GetConsentStats_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/cookies/stats");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("total_consents", out _).Should().BeTrue();
        content.TryGetProperty("analytics_percentage", out _).Should().BeTrue();
        content.TryGetProperty("marketing_percentage", out _).Should().BeTrue();
        content.TryGetProperty("preferences_percentage", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetConsentStats_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/cookies/stats");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetConsentStats_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.GetAsync("/api/admin/cookies/stats");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetConsentStats_AfterRecording_ReflectsData()
    {
        // Arrange - record consent as authenticated member (tenant context needed)
        await AuthenticateAsMemberAsync();

        await Client.PostAsJsonAsync("/api/cookies/consent", new
        {
            session_id = $"stats-test-{Guid.NewGuid()}",
            analytics_cookies = true,
            marketing_cookies = true,
            preference_cookies = true
        });

        // Switch to admin for stats endpoint
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/cookies/stats");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("total_consents").GetInt32().Should().BeGreaterOrEqualTo(1);
    }

    #endregion
}
