using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for reviews endpoints.
/// Tests creating, reading, updating, and deleting user and listing reviews.
/// </summary>
[Collection("Integration")]
public class ReviewsControllerTests : IntegrationTestBase
{
    public ReviewsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Create User Review

    [Fact]
    public async Task CreateUserReview_ValidRequest_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 5,
            comment = "Great admin user!"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("rating").GetInt32().Should().Be(5);
        content.GetProperty("comment").GetString().Should().Be("Great admin user!");
    }

    [Fact]
    public async Task CreateUserReview_ReviewSelf_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/users/{TestData.MemberUser.Id}/reviews", new
        {
            rating = 5,
            comment = "I'm great"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateUserReview_DuplicateReview_ReturnsConflict()
    {
        // Arrange - create first review
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 4,
            comment = "First review"
        });

        // Act - try to review again
        var response = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 5,
            comment = "Second review"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task CreateUserReview_InvalidRating_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 6,
            comment = "Too high"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateUserReview_ZeroRating_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 0,
            comment = "Too low"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateUserReview_NonExistentUser_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/users/99999/reviews", new
        {
            rating = 5,
            comment = "Ghost user"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Create Listing Review

    [Fact]
    public async Task CreateListingReview_ValidRequest_ReturnsCreated()
    {
        // Arrange - review admin's listing as member
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/listings/{TestData.Listing1.Id}/reviews", new
        {
            rating = 4,
            comment = "Good service listing"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task CreateListingReview_OwnListing_ReturnsBadRequest()
    {
        // Arrange - try to review own listing
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/listings/{TestData.Listing2.Id}/reviews", new
        {
            rating = 5,
            comment = "My own listing is great"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Get Reviews

    [Fact]
    public async Task GetUserReviews_ReturnsReviewsWithSummary()
    {
        // Arrange - create a review first
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 4,
            comment = "Review for listing"
        });

        // Act
        var response = await Client.GetAsync($"/api/users/{TestData.AdminUser.Id}/reviews");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().BeGreaterThan(0);
        content.GetProperty("summary").GetProperty("average_rating").GetDouble().Should().BeGreaterThan(0);
        content.GetProperty("summary").GetProperty("total_reviews").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task GetListingReviews_ReturnsReviewsWithSummary()
    {
        // Arrange
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync($"/api/listings/{TestData.Listing1.Id}/reviews", new
        {
            rating = 3,
            comment = "Decent listing"
        });

        // Act
        var response = await Client.GetAsync($"/api/listings/{TestData.Listing1.Id}/reviews");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().BeGreaterThan(0);
        content.GetProperty("summary").ValueKind.Should().Be(JsonValueKind.Object);
    }

    [Fact]
    public async Task GetReviewById_ExistingReview_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 5,
            comment = "Get by ID test"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var reviewId = createContent.GetProperty("id").GetInt32();

        // Act
        var response = await Client.GetAsync($"/api/reviews/{reviewId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().Be(reviewId);
    }

    [Fact]
    public async Task GetReviewById_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/reviews/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Update Review

    [Fact]
    public async Task UpdateReview_AsReviewer_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 3,
            comment = "Initial review"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var reviewId = createContent.GetProperty("id").GetInt32();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/reviews/{reviewId}", new
        {
            rating = 5,
            comment = "Updated review"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UpdateReview_NotReviewer_ReturnsForbidden()
    {
        // Arrange - create review as member
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 4,
            comment = "Member's review"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var reviewId = createContent.GetProperty("id").GetInt32();

        // Act - try to update as admin
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync($"/api/reviews/{reviewId}", new
        {
            rating = 1,
            comment = "Hijacked review"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion

    #region Delete Review

    [Fact]
    public async Task DeleteReview_AsReviewer_ReturnsNoContent()
    {
        // Arrange
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 2,
            comment = "To be deleted"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var reviewId = createContent.GetProperty("id").GetInt32();

        // Act
        var response = await Client.DeleteAsync($"/api/reviews/{reviewId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task DeleteReview_NotReviewer_ReturnsForbidden()
    {
        // Arrange
        await AuthenticateAsMemberAsync();
        var createResponse = await Client.PostAsJsonAsync($"/api/users/{TestData.AdminUser.Id}/reviews", new
        {
            rating = 3,
            comment = "Not deletable by others"
        });
        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var reviewId = createContent.GetProperty("id").GetInt32();

        // Act - try to delete as admin
        await AuthenticateAsAdminAsync();
        var response = await Client.DeleteAsync($"/api/reviews/{reviewId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    #endregion
}
