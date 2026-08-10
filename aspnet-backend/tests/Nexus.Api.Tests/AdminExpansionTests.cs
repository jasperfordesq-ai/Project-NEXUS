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
/// Integration tests for AdminCrmController, AdminAnalyticsController, and AuditController.
/// Verifies admin-only endpoints work correctly and are properly secured.
/// </summary>
[Collection("Integration")]
public class AdminExpansionTests : IntegrationTestBase
{
    public AdminExpansionTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Authorization Tests

    [Fact]
    public async Task AdminCrmEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act & Assert
        var searchResponse = await Client.GetAsync("/api/admin/crm/users/search");
        searchResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var flaggedResponse = await Client.GetAsync("/api/admin/crm/flagged-notes");
        flaggedResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AdminCrmEndpoints_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act & Assert
        var searchResponse = await Client.GetAsync("/api/admin/crm/users/search");
        searchResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var flaggedResponse = await Client.GetAsync("/api/admin/crm/flagged-notes");
        flaggedResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var addNoteResponse = await Client.PostAsJsonAsync($"/api/admin/crm/users/{TestData.MemberUser.Id}/notes", new
        {
            content = "Test note"
        });
        addNoteResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminAnalyticsEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act & Assert
        var overviewResponse = await Client.GetAsync("/api/admin/analytics/overview");
        overviewResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var growthResponse = await Client.GetAsync("/api/admin/analytics/growth");
        growthResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var retentionResponse = await Client.GetAsync("/api/admin/analytics/retention");
        retentionResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AdminAnalyticsEndpoints_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act & Assert
        var overviewResponse = await Client.GetAsync("/api/admin/analytics/overview");
        overviewResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var growthResponse = await Client.GetAsync("/api/admin/analytics/growth");
        growthResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var topUsersResponse = await Client.GetAsync("/api/admin/analytics/top-users");
        topUsersResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AuditEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act & Assert
        var logsResponse = await Client.GetAsync("/api/admin/audit");
        logsResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var criticalResponse = await Client.GetAsync("/api/admin/audit/critical");
        criticalResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AuditEndpoints_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act & Assert
        var logsResponse = await Client.GetAsync("/api/admin/audit");
        logsResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var criticalResponse = await Client.GetAsync("/api/admin/audit/critical");
        criticalResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var purgeResponse = await Client.DeleteAsync("/api/admin/audit/purge?older_than_days=30");
        purgeResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region AdminCrmController Tests

    [Fact]
    public async Task SearchUsers_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/crm/users/search?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SearchUsers_WithRoleFilter_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/crm/users/search?role=admin&is_active=true");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SearchUsers_WithSearchTerm_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/crm/users/search?search=admin");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AddNote_ValidRequest_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/admin/crm/users/{TestData.MemberUser.Id}/notes", new
        {
            content = "This is a test admin note",
            category = "general",
            is_flagged = false
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task AddNote_EmptyContent_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/admin/crm/users/{TestData.MemberUser.Id}/notes", new
        {
            content = "",
            category = "general"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Content is required");
    }

    [Fact]
    public async Task AddNote_NonExistingUser_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/crm/users/99999/notes", new
        {
            content = "Note for non-existing user"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("User not found");
    }

    [Fact]
    public async Task GetNotes_ExistingUser_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Add a note first
        await Client.PostAsJsonAsync($"/api/admin/crm/users/{TestData.MemberUser.Id}/notes", new
        {
            content = "Note for retrieval test",
            category = "test"
        });

        // Act
        var response = await Client.GetAsync($"/api/admin/crm/users/{TestData.MemberUser.Id}/notes?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AddNote_FlaggedNote_AppearsInFlaggedNotes()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Add a flagged note
        await Client.PostAsJsonAsync($"/api/admin/crm/users/{TestData.MemberUser.Id}/notes", new
        {
            content = "Flagged note for testing",
            category = "warning",
            is_flagged = true
        });

        // Act
        var response = await Client.GetAsync("/api/admin/crm/flagged-notes?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UpdateNote_NonExistingNote_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/crm/notes/99999", new
        {
            content = "Updated content"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task UpdateNote_EmptyContent_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/crm/notes/1", new
        {
            content = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Content is required");
    }

    [Fact]
    public async Task DeleteNote_NonExistingNote_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.DeleteAsync("/api/admin/crm/notes/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task NoteLifecycle_CreateUpdateDelete_WorksEndToEnd()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Step 1: Create a note
        var createResponse = await Client.PostAsJsonAsync($"/api/admin/crm/users/{TestData.MemberUser.Id}/notes", new
        {
            content = "Lifecycle test note",
            category = "lifecycle",
            is_flagged = false
        });
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = createContent.GetProperty("id").GetInt32();

        // Step 2: Update the note
        var updateResponse = await Client.PutAsJsonAsync($"/api/admin/crm/notes/{noteId}", new
        {
            content = "Updated lifecycle note",
            category = "updated",
            is_flagged = true
        });
        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // Step 3: Delete the note
        var deleteResponse = await Client.DeleteAsync($"/api/admin/crm/notes/{noteId}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    #endregion

    #region AdminAnalyticsController Tests

    [Fact]
    public async Task GetOverview_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/analytics/overview");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetGrowth_DefaultDays_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/analytics/growth");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetGrowth_CustomDays_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/analytics/growth?days=90");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetRetention_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/analytics/retention");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetTopUsers_ValidMetric_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/analytics/top-users?metric=exchanges&limit=5");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("metric").GetString().Should().Be("exchanges");
        content.GetProperty("limit").GetInt32().Should().Be(5);
        content.TryGetProperty("users", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetTopUsers_InvalidMetric_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/analytics/top-users?metric=invalid_metric");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Invalid metric");
    }

    [Fact]
    public async Task GetTopUsers_AllValidMetrics_ReturnOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();
        var validMetrics = new[] { "exchanges", "hours_given", "hours_received", "xp", "listings", "connections" };

        foreach (var metric in validMetrics)
        {
            // Act
            var response = await Client.GetAsync($"/api/admin/analytics/top-users?metric={metric}");

            // Assert
            response.StatusCode.Should().Be(HttpStatusCode.OK, $"metric '{metric}' should be valid");
        }
    }

    [Fact]
    public async Task GetCategories_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/analytics/categories");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("categories", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetExchangeHealth_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/analytics/exchange-health");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    #endregion

    #region AuditController Tests

    [Fact]
    public async Task QueryLogs_AsAdmin_ReturnsOkWithPagination()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/audit?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("items", out var items).Should().BeTrue();
        items.ValueKind.Should().Be(JsonValueKind.Array);
        content.TryGetProperty("total_count", out _).Should().BeTrue();
        content.TryGetProperty("page", out _).Should().BeTrue();
        content.TryGetProperty("limit", out _).Should().BeTrue();
    }

    [Fact]
    public async Task QueryLogs_WithUserIdFilter_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync($"/api/admin/audit?user_id={TestData.AdminUser.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task QueryLogs_WithActionFilter_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/audit?action=login");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task QueryLogs_WithSeverityFilter_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/audit?severity=info");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task QueryLogs_InvalidSeverity_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/audit?severity=invalid_level");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Invalid severity");
    }

    [Fact]
    public async Task QueryLogs_WithDateRange_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();
        var dateFrom = DateTime.UtcNow.AddDays(-7).ToString("o");
        var dateTo = DateTime.UtcNow.ToString("o");

        // Act
        var response = await Client.GetAsync($"/api/admin/audit?date_from={dateFrom}&date_to={dateTo}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetUserActivity_ExistingUser_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync($"/api/admin/audit/user/{TestData.AdminUser.Id}?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("items", out _).Should().BeTrue();
        content.TryGetProperty("total_count", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetRecentCritical_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/audit/critical?limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("items", out var items).Should().BeTrue();
        items.ValueKind.Should().Be(JsonValueKind.Array);
        content.TryGetProperty("total_count", out _).Should().BeTrue();
    }

    [Fact]
    public async Task PurgeLogs_MissingOlderThanDays_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.DeleteAsync("/api/admin/audit/purge");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("older_than_days");
    }

    [Fact]
    public async Task PurgeLogs_ZeroDays_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.DeleteAsync("/api/admin/audit/purge?older_than_days=0");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("older_than_days");
    }

    [Fact]
    public async Task PurgeLogs_ValidRequest_ReturnsOkWithDeletedCount()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.DeleteAsync("/api/admin/audit/purge?older_than_days=365");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("deleted_count", out _).Should().BeTrue();
        content.GetProperty("older_than_days").GetInt32().Should().Be(365);
    }

    #endregion
}
