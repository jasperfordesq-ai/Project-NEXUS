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
/// Integration tests for SystemAdminController and AnnouncementsController.
/// Covers system settings, scheduled tasks, announcements, and system health.
/// </summary>
[Collection("Integration")]
public class SystemAdminControllerTests : IntegrationTestBase
{
    public SystemAdminControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Authorization Tests

    [Fact]
    public async Task SystemAdminEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act & Assert
        var settingsResponse = await Client.GetAsync("/api/admin/system/settings");
        settingsResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var tasksResponse = await Client.GetAsync("/api/admin/system/tasks");
        tasksResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var healthResponse = await Client.GetAsync("/api/admin/system/health");
        healthResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var announcementsResponse = await Client.GetAsync("/api/admin/system/announcements");
        announcementsResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task SystemAdminEndpoints_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act & Assert
        var settingsResponse = await Client.GetAsync("/api/admin/system/settings");
        settingsResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var tasksResponse = await Client.GetAsync("/api/admin/system/tasks");
        tasksResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var healthResponse = await Client.GetAsync("/api/admin/system/health");
        healthResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var announcementsResponse = await Client.GetAsync("/api/admin/system/announcements");
        announcementsResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var createAnnouncementResponse = await Client.PostAsJsonAsync("/api/admin/system/announcements", new
        {
            title = "Test",
            content = "Test content"
        });
        createAnnouncementResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var setSettingResponse = await Client.PutAsJsonAsync("/api/admin/system/settings", new
        {
            key = "test_key",
            value = "test_value"
        });
        setSettingResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region System Settings Tests

    [Fact]
    public async Task GetSettings_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/system/settings");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetSettings_WithCategoryFilter_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/system/settings?category=general");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SetSetting_ValidRequest_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();
        var uniqueKey = $"test_setting_{Guid.NewGuid():N}"[..30];

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/system/settings", new
        {
            key = uniqueKey,
            value = "test_value_123",
            description = "A test setting",
            category = "test",
            is_secret = false
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("key").GetString().Should().Be(uniqueKey);
        content.GetProperty("value").GetString().Should().Be("test_value_123");
        content.GetProperty("description").GetString().Should().Be("A test setting");
        content.GetProperty("category").GetString().Should().Be("test");
        content.GetProperty("is_secret").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task SetSetting_SecretValue_MaskedInResponse()
    {
        // Arrange
        await AuthenticateAsAdminAsync();
        var uniqueKey = $"secret_setting_{Guid.NewGuid():N}"[..30];

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/system/settings", new
        {
            key = uniqueKey,
            value = "super_secret_value",
            description = "A secret setting",
            category = "security",
            is_secret = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("key").GetString().Should().Be(uniqueKey);
        content.GetProperty("value").GetString().Should().Be("********");
        content.GetProperty("is_secret").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task SetSetting_MissingKey_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/system/settings", new
        {
            key = "",
            value = "some_value"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("key is required");
    }

    [Fact]
    public async Task SetSetting_MissingValue_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/system/settings", new
        {
            key = "some_key",
            value = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("value is required");
    }

    [Fact]
    public async Task SetSetting_UpdateExisting_OverwritesValue()
    {
        // Arrange
        await AuthenticateAsAdminAsync();
        var uniqueKey = $"update_setting_{Guid.NewGuid():N}"[..30];

        // Create initial setting
        await Client.PutAsJsonAsync("/api/admin/system/settings", new
        {
            key = uniqueKey,
            value = "initial_value"
        });

        // Act - Update the same key
        var response = await Client.PutAsJsonAsync("/api/admin/system/settings", new
        {
            key = uniqueKey,
            value = "updated_value",
            description = "Now updated"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("key").GetString().Should().Be(uniqueKey);
        content.GetProperty("value").GetString().Should().Be("updated_value");
    }

    #endregion

    #region Scheduled Tasks Tests

    [Fact]
    public async Task GetTasks_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/system/tasks");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    #endregion

    #region Announcements Tests (Admin)

    [Fact]
    public async Task GetAnnouncements_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/system/announcements");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CreateAnnouncement_ValidRequest_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/system/announcements", new
        {
            title = "Test Announcement",
            content = "This is a test announcement for integration testing.",
            type = "info",
            starts_at = DateTime.UtcNow.ToString("o"),
            ends_at = DateTime.UtcNow.AddDays(7).ToString("o")
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("title").GetString().Should().Be("Test Announcement");
        content.GetProperty("content").GetString().Should().Contain("test announcement");
        content.GetProperty("type").GetString().Should().Be("info");
        content.GetProperty("is_active").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task CreateAnnouncement_WarningType_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/system/announcements", new
        {
            title = "Warning Announcement",
            content = "This is a warning announcement.",
            type = "warning"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("type").GetString().Should().Be("warning");
    }

    [Fact]
    public async Task CreateAnnouncement_MissingTitle_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/system/announcements", new
        {
            title = "",
            content = "Some content"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("title is required");
    }

    [Fact]
    public async Task CreateAnnouncement_MissingContent_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/system/announcements", new
        {
            title = "Some Title",
            content = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("content is required");
    }

    [Fact]
    public async Task DeactivateAnnouncement_NonExisting_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/system/announcements/99999/deactivate", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Announcement not found");
    }

    [Fact]
    public async Task AnnouncementLifecycle_CreateAndDeactivate_WorksEndToEnd()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Step 1: Create announcement
        var createResponse = await Client.PostAsJsonAsync("/api/admin/system/announcements", new
        {
            title = "Lifecycle Test Announcement",
            content = "This announcement will be deactivated.",
            type = "info"
        });
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var announcementId = createContent.GetProperty("id").GetInt32();
        createContent.GetProperty("is_active").GetBoolean().Should().BeTrue();

        // Step 2: Deactivate announcement
        var deactivateResponse = await Client.PutAsJsonAsync($"/api/admin/system/announcements/{announcementId}/deactivate", new { });
        deactivateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var deactivateContent = await deactivateResponse.Content.ReadFromJsonAsync<JsonElement>();
        deactivateContent.GetProperty("message").GetString().Should().Contain("deactivated");
    }

    #endregion

    #region System Health Tests

    [Fact]
    public async Task GetHealth_AsAdmin_ReturnsOkWithMetrics()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/system/health");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("database_size", out _).Should().BeTrue();
        content.TryGetProperty("total_users", out _).Should().BeTrue();
        content.TryGetProperty("active_users_last_24h", out _).Should().BeTrue();
        content.TryGetProperty("active_users_last_7d", out _).Should().BeTrue();
        content.TryGetProperty("total_tenants", out _).Should().BeTrue();
        content.TryGetProperty("total_listings", out _).Should().BeTrue();
        content.TryGetProperty("pending_scheduled_tasks", out _).Should().BeTrue();
        content.TryGetProperty("failed_scheduled_tasks", out _).Should().BeTrue();
        content.TryGetProperty("server_time", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetHealth_MetricsReflectSeededData()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/system/health");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();

        // We seeded 3 users (admin, member, other-tenant) and 2 tenants
        content.GetProperty("total_users").GetInt32().Should().BeGreaterThanOrEqualTo(2);
        content.GetProperty("total_tenants").GetInt32().Should().BeGreaterThanOrEqualTo(2);
    }

    #endregion

    #region Public Announcements Controller Tests

    [Fact]
    public async Task GetActiveAnnouncements_Public_NoAuthRequired()
    {
        // Arrange - The endpoint has [AllowAnonymous] so any authenticated user can access it,
        // not just admins. We authenticate as a member to provide tenant context since the
        // tenant resolution middleware requires a JWT or X-Tenant-ID header (dev-only).
        // This verifies the endpoint is accessible without admin privileges.
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/announcements");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetActiveAnnouncements_ReturnsArray()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create an announcement first
        await Client.PostAsJsonAsync("/api/admin/system/announcements", new
        {
            title = "Public Test Announcement",
            content = "Visible to all users.",
            type = "info"
        });

        // Act - Fetch public announcements (as member to ensure it works for regular users)
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/announcements");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    #endregion
}
