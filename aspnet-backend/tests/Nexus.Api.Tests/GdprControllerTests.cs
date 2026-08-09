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
/// Integration tests for GDPR privacy endpoints.
/// Tests data export, data deletion, and consent management.
/// </summary>
[Collection("Integration")]
public class GdprControllerTests : IntegrationTestBase
{
    public GdprControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Data Export Tests

    [Fact]
    public async Task RequestExport_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/privacy/export", new { format = "json" });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        content.GetProperty("status").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("format").GetString().Should().Be("json");
        content.GetProperty("message").GetString().Should().Contain("data export");
    }

    [Fact]
    public async Task RequestExport_DefaultFormat_UsesJson()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/privacy/export", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("format").GetString().Should().Be("json");
    }

    [Fact]
    public async Task RequestExport_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/privacy/export", new { format = "json" });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetExportRequests_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Create an export request first
        await Client.PostAsJsonAsync("/api/privacy/export", new { format = "json" });

        // Act
        var response = await Client.GetAsync("/api/privacy/export");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("total").GetInt32().Should().BeGreaterOrEqualTo(1);
    }

    [Fact]
    public async Task GetExportRequests_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.GetAsync("/api/privacy/export");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task DownloadExport_NonExistentId_ReturnsNotFoundOrBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/privacy/export/99999/download");

        // Assert
        response.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task DownloadExport_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.GetAsync("/api/privacy/export/1/download");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Data Deletion Tests

    [Fact]
    public async Task RequestDeletion_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/privacy/delete", new
        {
            reason = "I no longer wish to use this platform."
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        content.GetProperty("status").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("message").GetString().Should().Contain("deletion");
    }

    [Fact]
    public async Task RequestDeletion_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.PostAsJsonAsync("/api/privacy/delete", new
        {
            reason = "Test"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task RequestDeletion_DuplicateRequest_ReturnsConflict()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // First request
        var first = await Client.PostAsJsonAsync("/api/privacy/delete", new
        {
            reason = "First request"
        });
        first.StatusCode.Should().Be(HttpStatusCode.OK);

        // Act - second request should conflict
        var second = await Client.PostAsJsonAsync("/api/privacy/delete", new
        {
            reason = "Duplicate request"
        });

        // Assert
        second.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    #endregion

    #region Consent Management Tests

    [Fact]
    public async Task GetConsents_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/privacy/consents");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.TryGetProperty("total", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetConsents_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.GetAsync("/api/privacy/consents");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task UpdateConsent_GrantConsent_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/privacy/consents", new
        {
            consent_type = "marketing",
            is_granted = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("consent_type").GetString().Should().Be("marketing");
        content.GetProperty("is_granted").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task UpdateConsent_RevokeConsent_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // First grant consent
        await Client.PutAsJsonAsync("/api/privacy/consents", new
        {
            consent_type = "analytics",
            is_granted = true
        });

        // Act - revoke it
        var response = await Client.PutAsJsonAsync("/api/privacy/consents", new
        {
            consent_type = "analytics",
            is_granted = false
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("consent_type").GetString().Should().Be("analytics");
        content.GetProperty("is_granted").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task UpdateConsent_MissingConsentType_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/privacy/consents", new
        {
            consent_type = "",
            is_granted = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task UpdateConsent_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.PutAsJsonAsync("/api/privacy/consents", new
        {
            consent_type = "marketing",
            is_granted = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task RevokeConsent_ExistingConsent_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // First grant consent
        await Client.PutAsJsonAsync("/api/privacy/consents", new
        {
            consent_type = "newsletter",
            is_granted = true
        });

        // Act - revoke via DELETE
        var response = await Client.DeleteAsync("/api/privacy/consents/newsletter");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("consent_type").GetString().Should().Be("newsletter");
        content.GetProperty("is_granted").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task RevokeConsent_NonExistentType_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync("/api/privacy/consents/nonexistent_type_xyz");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RevokeConsent_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.DeleteAsync("/api/privacy/consents/marketing");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Admin GDPR Endpoints

    [Fact]
    public async Task AdminGetDeletionRequests_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/privacy/deletions");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task AdminGetDeletionRequests_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/privacy/deletions");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminGetDeletionRequests_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.GetAsync("/api/admin/privacy/deletions");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AdminGetDeletionRequests_WithStatusFilter_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/privacy/deletions?status=pending&page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("pagination").GetProperty("limit").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task AdminReviewDeletion_NonExistentId_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/privacy/deletions/99999/review", new
        {
            approved = false,
            retained_reason = "No valid reason provided"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AdminReviewDeletion_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/privacy/deletions/1/review", new
        {
            approved = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion
}
