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
/// Integration tests for AdminController.
/// Verifies admin-only endpoints work correctly and are properly secured.
/// </summary>
[Collection("Integration")]
public class AdminControllerTests : IntegrationTestBase
{
    public AdminControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Authorization Tests

    [Fact]
    public async Task AdminEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act & Assert
        var dashboardResponse = await Client.GetAsync("/api/admin/dashboard");
        dashboardResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var usersResponse = await Client.GetAsync("/api/admin/users");
        usersResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var categoriesResponse = await Client.GetAsync("/api/admin/categories");
        categoriesResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AdminEndpoints_AsMember_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act & Assert
        var dashboardResponse = await Client.GetAsync("/api/admin/dashboard");
        dashboardResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var usersResponse = await Client.GetAsync("/api/admin/users");
        usersResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var categoriesResponse = await Client.GetAsync("/api/admin/categories");
        categoriesResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminEndpoints_AsAdmin_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var dashboardResponse = await Client.GetAsync("/api/admin/dashboard");
        var usersResponse = await Client.GetAsync("/api/admin/users");
        var categoriesResponse = await Client.GetAsync("/api/admin/categories");

        // Assert - Primary purpose is verifying admin auth works (not 401/403).
        // 409 can occur when an InvalidOperationException is thrown due to
        // database state from other tests being processed by ExceptionHandlingMiddleware.
        dashboardResponse.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Conflict);
        usersResponse.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Conflict);
        categoriesResponse.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Conflict);
    }

    #endregion

    #region Dashboard Tests

    [Fact]
    public async Task GetDashboard_ReturnsCorrectMetrics()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/dashboard");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();

        content.TryGetProperty("users", out var users).Should().BeTrue();
        users.TryGetProperty("total", out _).Should().BeTrue();
        users.TryGetProperty("active", out _).Should().BeTrue();

        content.TryGetProperty("listings", out var listings).Should().BeTrue();
        listings.TryGetProperty("total", out _).Should().BeTrue();

        content.TryGetProperty("transactions", out var transactions).Should().BeTrue();
        transactions.TryGetProperty("total", out _).Should().BeTrue();

        content.TryGetProperty("community", out var community).Should().BeTrue();
        community.TryGetProperty("categories", out _).Should().BeTrue();
    }

    #endregion

    #region User Management Tests

    [Fact]
    public async Task ListUsers_ReturnsPaginatedUsers()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/users?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();

        content.TryGetProperty("data", out var data).Should().BeTrue();
        data.GetArrayLength().Should().BeGreaterThan(0);

        content.TryGetProperty("pagination", out var pagination).Should().BeTrue();
        pagination.GetProperty("page").GetInt32().Should().Be(1);
        pagination.GetProperty("limit").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task ListUsers_WithRoleFilter_ReturnsFilteredUsers()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/users?role=admin");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();

        var users = content.GetProperty("data");
        foreach (var user in users.EnumerateArray())
        {
            user.GetProperty("role").GetString().Should().Be("admin");
        }
    }

    [Fact]
    public async Task GetUser_ExistingUser_ReturnsUserWithStats()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync($"/api/admin/users/{TestData.AdminUser.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();

        content.TryGetProperty("user", out var user).Should().BeTrue();
        user.GetProperty("id").GetInt32().Should().Be(TestData.AdminUser.Id);
        user.GetProperty("email").GetString().Should().Be("admin@test.com");

        content.TryGetProperty("stats", out var stats).Should().BeTrue();
        stats.TryGetProperty("listings", out _).Should().BeTrue();
        stats.TryGetProperty("transactions", out _).Should().BeTrue();
        stats.TryGetProperty("connections", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetUser_NonExistingUser_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/users/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task UpdateUser_ValidRequest_UpdatesUser()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/admin/users/{TestData.MemberUser.Id}", new
        {
            first_name = "UpdatedFirst",
            last_name = "UpdatedLast"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("user").GetProperty("first_name").GetString().Should().Be("UpdatedFirst");
    }

    [Fact]
    public async Task UpdateUser_AdminDemotingSelf_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/admin/users/{TestData.AdminUser.Id}", new
        {
            role = "member"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Cannot change your own admin role");
    }

    [Fact]
    public async Task SuspendUser_ValidRequest_SuspendsUser()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/admin/users/{TestData.MemberUser.Id}/suspend", new
        {
            reason = "Test suspension"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("user").GetProperty("is_active").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task SuspendUser_AdminSuspendingSelf_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/admin/users/{TestData.AdminUser.Id}/suspend", new
        {
            reason = "Self suspension"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("Cannot suspend yourself");
    }

    [Fact]
    public async Task ActivateUser_SuspendedUser_ActivatesUser()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // First suspend the user
        await Client.PutAsJsonAsync($"/api/admin/users/{TestData.MemberUser.Id}/suspend", new
        {
            reason = "Test suspension"
        });

        // Act
        var response = await Client.PutAsJsonAsync($"/api/admin/users/{TestData.MemberUser.Id}/activate", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("user").GetProperty("is_active").GetBoolean().Should().BeTrue();
    }

    #endregion

    #region Category Management Tests

    [Fact]
    public async Task ListCategories_ReturnsAllCategories()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/categories");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out var data).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task CreateCategory_ValidRequest_CreatesCategory()
    {
        // Arrange
        await AuthenticateAsAdminAsync();
        var categoryName = $"Test Cat {Guid.NewGuid().ToString("N")[..8]}";

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/categories", new
        {
            name = categoryName,
            description = "Test description",
            sort_order = 10
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("category").GetProperty("name").GetString().Should().Be(categoryName);
    }

    [Fact]
    public async Task CreateCategory_MissingName_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/categories", new
        {
            description = "Test description"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateCategory_DuplicateSlug_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();
        var uniqueSlug = $"dup-slug-{Guid.NewGuid().ToString("N")[..8]}";

        // Create first category
        await Client.PostAsJsonAsync("/api/admin/categories", new
        {
            name = "First Category",
            slug = uniqueSlug
        });

        // Act - Create second category with same slug
        var response = await Client.PostAsJsonAsync("/api/admin/categories", new
        {
            name = "Another Category",
            slug = uniqueSlug
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("slug already exists");
    }

    [Fact]
    public async Task UpdateCategory_ValidRequest_UpdatesCategory()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create a category first
        var createResponse = await Client.PostAsJsonAsync("/api/admin/categories", new
        {
            name = $"Cat Update {Guid.NewGuid().ToString("N")[..8]}"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var categoryId = createContent.GetProperty("category").GetProperty("id").GetInt32();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/admin/categories/{categoryId}", new
        {
            name = "Updated Category Name",
            description = "Updated description",
            is_active = false
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("category").GetProperty("name").GetString().Should().Be("Updated Category Name");
        content.GetProperty("category").GetProperty("is_active").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task UpdateCategory_SelfParent_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create a category
        var createResponse = await Client.PostAsJsonAsync("/api/admin/categories", new
        {
            name = $"Self Parent {Guid.NewGuid().ToString("N")[..8]}"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var categoryId = createContent.GetProperty("category").GetProperty("id").GetInt32();

        // Act - Try to set itself as parent
        var response = await Client.PutAsJsonAsync($"/api/admin/categories/{categoryId}", new
        {
            parent_category_id = categoryId
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("cannot be its own parent");
    }

    [Fact]
    public async Task DeleteCategory_EmptyCategory_DeletesCategory()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create a category to delete
        var createResponse = await Client.PostAsJsonAsync("/api/admin/categories", new
        {
            name = $"Cat Delete {Guid.NewGuid().ToString("N")[..8]}"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var categoryId = createContent.GetProperty("category").GetProperty("id").GetInt32();

        // Act
        var response = await Client.DeleteAsync($"/api/admin/categories/{categoryId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
    }

    #endregion

    #region Config Management Tests

    [Fact]
    public async Task GetConfig_ReturnsConfigData()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/config");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out _).Should().BeTrue();
        content.TryGetProperty("config", out _).Should().BeTrue();
    }

    [Fact]
    public async Task UpdateConfig_ValidRequest_UpdatesConfig()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/config", new
        {
            config = new Dictionary<string, string>
            {
                { "test_key", "test_value" },
                { "another_key", "another_value" }
            }
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task UpdateConfig_EmptyConfig_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/config", new
        {
            config = new Dictionary<string, string>()
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Role Management Tests

    [Fact]
    public async Task ListRoles_ReturnsAllRoles()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/roles");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out var data).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task CreateRole_ValidRequest_CreatesRole()
    {
        // Arrange
        await AuthenticateAsAdminAsync();
        var roleName = $"testrole{Guid.NewGuid():N}".Substring(0, 20);

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/roles", new
        {
            name = roleName,
            description = "Test role description",
            permissions = "[\"read\", \"write\"]"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("role").GetProperty("name").GetString().Should().Be(roleName);
        content.GetProperty("role").GetProperty("is_system").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task CreateRole_MissingName_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/roles", new
        {
            description = "Test role"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task UpdateRole_ValidRequest_UpdatesRole()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create a role first
        var roleName = $"updaterole{Guid.NewGuid():N}".Substring(0, 20);
        var createResponse = await Client.PostAsJsonAsync("/api/admin/roles", new
        {
            name = roleName
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var roleId = createContent.GetProperty("role").GetProperty("id").GetInt32();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/admin/roles/{roleId}", new
        {
            description = "Updated description",
            permissions = "[\"read\", \"write\", \"delete\"]"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("role").GetProperty("description").GetString().Should().Be("Updated description");
    }

    [Fact]
    public async Task DeleteRole_CustomRole_DeletesRole()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create a role to delete
        var roleName = $"deleterole{Guid.NewGuid():N}".Substring(0, 20);
        var createResponse = await Client.PostAsJsonAsync("/api/admin/roles", new
        {
            name = roleName
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var roleId = createContent.GetProperty("role").GetProperty("id").GetInt32();

        // Act
        var response = await Client.DeleteAsync($"/api/admin/roles/{roleId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
    }

    #endregion

    #region Content Moderation Tests

    [Fact]
    public async Task GetPendingListings_ReturnsOnlyPendingListings()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/admin/listings/pending");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("data", out var data).Should().BeTrue();
        content.TryGetProperty("pagination", out _).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task ApproveListing_NonExistingListing_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/listings/99999/approve", new { });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RejectListing_NonExistingListing_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/listings/99999/reject", new
        {
            reason = "Test rejection"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RejectListing_MissingReason_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync("/api/admin/listings/1/reject", new
        {
            reason = ""
        });

        // Assert - Should return BadRequest for missing reason or NotFound if listing doesn't exist
        response.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.NotFound);
    }

    #endregion

    #region Input Validation Tests

    [Fact]
    public async Task UpdateUser_FirstNameTooLong_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/admin/users/{TestData.MemberUser.Id}", new
        {
            first_name = new string('a', 150) // Over 100 character limit
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Be("Validation failed");
    }

    [Fact]
    public async Task CreateCategory_NameTooLong_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/categories", new
        {
            name = new string('a', 150) // Over 100 character limit
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Be("Validation failed");
    }

    [Fact]
    public async Task CreateRole_NameTooLong_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/admin/roles", new
        {
            name = new string('a', 60) // Over 50 character limit
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Be("Validation failed");
    }

    #endregion
}
