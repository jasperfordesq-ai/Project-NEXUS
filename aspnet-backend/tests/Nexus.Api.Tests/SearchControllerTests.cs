using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for search endpoints.
/// Tests full-text search and autocomplete suggestions.
/// </summary>
[Collection("Integration")]
public class SearchControllerTests : IntegrationTestBase
{
    public SearchControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Search Tests

    [Fact]
    public async Task Search_ValidQuery_ReturnsResults()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act - search for seeded listing
        var response = await Client.GetAsync("/api/search?q=Test Service");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("listings").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task Search_MissingQuery_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/search");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Search_TooShortQuery_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/search?q=a");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Search_FilterByType_ReturnsFilteredResults()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/search?q=Test&type=listings");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("listings").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task Search_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.GetAsync("/api/search?q=test");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Suggestions Tests

    [Fact]
    public async Task GetSuggestions_ValidQuery_ReturnsResults()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/search/suggestions?q=Test");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task GetSuggestions_MissingQuery_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/search/suggestions");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion
}
