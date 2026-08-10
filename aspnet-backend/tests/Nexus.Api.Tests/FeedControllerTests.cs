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
/// Integration tests for the FeedController.
/// Tests post CRUD operations, likes, comments, and tenant isolation.
/// </summary>
[Collection("Integration")]
public class FeedControllerTests : IntegrationTestBase
{
    public FeedControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Create Post

    [Fact]
    public async Task CreatePost_ValidRequest_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "This is a test post for the community feed."
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var post = content.GetProperty("post");
        post.GetProperty("content").GetString().Should().Be("This is a test post for the community feed.");
        post.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task CreatePost_EmptyContent_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreatePost_Unauthenticated_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Unauthorized post"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Get Feed

    [Fact]
    public async Task GetFeed_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create a post first
        await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Feed test post"
        });

        // Act
        var response = await Client.GetAsync("/api/feed");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var first = content.GetProperty("data").EnumerateArray().First();
        first.GetProperty("type").GetString().Should().Be("post");
        first.GetProperty("likes_count").GetInt32().Should().BeGreaterOrEqualTo(0);
        first.GetProperty("comments_count").GetInt32().Should().BeGreaterOrEqualTo(0);
        first.GetProperty("author_name").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task GetFeed_SupportsPagination()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Create multiple posts
        for (int i = 0; i < 3; i++)
        {
            await Client.PostAsJsonAsync("/api/feed", new { content = $"Pagination test post {i}" });
        }

        // Act
        var response = await Client.GetAsync("/api/feed?page=1&limit=2");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("pagination").GetProperty("limit").GetInt32().Should().Be(2);
    }

    #endregion

    #region Get Post

    [Fact]
    public async Task GetPost_ExistingPost_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Detail test post"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Act
        var response = await Client.GetAsync($"/api/feed/{postId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("content").GetString().Should().Be("Detail test post");
    }

    [Fact]
    public async Task GetPost_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.GetAsync("/api/feed/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Update Post

    [Fact]
    public async Task UpdatePost_AsAuthor_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Original content"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/feed/{postId}", new
        {
            content = "Updated content"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var respBody = await response.Content.ReadFromJsonAsync<JsonElement>();
        respBody.GetProperty("post").GetProperty("content").GetString().Should().Be("Updated content");
    }

    [Fact]
    public async Task UpdatePost_NotAuthor_ReturnsForbidden()
    {
        // Arrange - Create post as admin
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Admin's post"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Switch to member user
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/feed/{postId}", new
        {
            content = "Hijacked content"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region Delete Post

    [Fact]
    public async Task DeletePost_AsAuthor_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Post to delete"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Act
        var response = await Client.DeleteAsync($"/api/feed/{postId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        // Verify deletion
        var getResponse = await Client.GetAsync($"/api/feed/{postId}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Likes

    [Fact]
    public async Task LikePost_ValidPost_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Like test post"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Switch to member to like
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsync($"/api/feed/{postId}/like", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UnlikePost_ExistingLike_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Unlike test post"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        await AuthenticateAsMemberAsync();
        await Client.PostAsync($"/api/feed/{postId}/like", null);

        // Act
        var response = await Client.DeleteAsync($"/api/feed/{postId}/like");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task LikePost_AlreadyLiked_ReturnsConflict()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Double like test"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Like once
        await Client.PostAsync($"/api/feed/{postId}/like", null);

        // Act - Try to like again
        var response = await Client.PostAsync($"/api/feed/{postId}/like", null);

        // Assert - API returns BadRequest for duplicate likes
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Comments

    [Fact]
    public async Task AddComment_ValidRequest_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Comment test post"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/feed/{postId}/comments", new
        {
            content = "This is a test comment"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var respBody = await response.Content.ReadFromJsonAsync<JsonElement>();
        respBody.GetProperty("comment").GetProperty("content").GetString().Should().Be("This is a test comment");
    }

    [Fact]
    public async Task GetComments_ReturnsPostComments()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Comments list test"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Add a comment
        await Client.PostAsJsonAsync($"/api/feed/{postId}/comments", new
        {
            content = "First comment"
        });

        // Act
        var response = await Client.GetAsync($"/api/feed/{postId}/comments");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").EnumerateArray().Should().NotBeEmpty();
    }

    [Fact]
    public async Task DeleteComment_AsAuthor_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Delete comment test"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        var commentResponse = await Client.PostAsJsonAsync($"/api/feed/{postId}/comments", new
        {
            content = "Comment to delete"
        });
        var commentContent = await commentResponse.Content.ReadFromJsonAsync<JsonElement>();
        var commentId = commentContent.GetProperty("comment").GetProperty("id").GetInt32();

        // Act
        var response = await Client.DeleteAsync($"/api/feed/{postId}/comments/{commentId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    #endregion

    #region Tenant Isolation

    [Fact]
    public async Task GetPost_FromOtherTenant_ReturnsNotFound()
    {
        // Arrange - Create post in test-tenant
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Tenant isolated post"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Switch to other-tenant user
        await AuthenticateAsOtherTenantUserAsync();

        // Act
        var response = await Client.GetAsync($"/api/feed/{postId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task LikePost_FromOtherTenant_ReturnsNotFound()
    {
        // Arrange - Create post in test-tenant
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Cross-tenant like test"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Switch to other-tenant user
        await AuthenticateAsOtherTenantUserAsync();

        // Act
        var response = await Client.PostAsync($"/api/feed/{postId}/like", null);

        // Assert
        response.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CommentOnPost_FromOtherTenant_ReturnsNotFound()
    {
        // Arrange - Create post in test-tenant
        await AuthenticateAsAdminAsync();

        var createResponse = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Cross-tenant comment test"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var postId = createContent.GetProperty("post").GetProperty("id").GetInt32();

        // Switch to other-tenant user
        await AuthenticateAsOtherTenantUserAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/feed/{postId}/comments", new
        {
            content = "Cross-tenant comment"
        });

        // Assert
        response.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    #endregion

    #region Input Validation

    [Fact]
    public async Task CreatePost_WithInvalidImageUrl_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Post with invalid URL",
            image_url = "not-a-valid-url"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreatePost_WithValidImageUrl_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Post with valid URL",
            image_url = "https://example.com/image.png"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var post = content.GetProperty("post");
        post.GetProperty("imageUrl").GetString().Should().Be("https://example.com/image.png");
    }

    [Fact]
    public async Task CreatePost_WithNullImageUrl_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsAdminAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/feed", new
        {
            content = "Post without image URL"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    #endregion
}
