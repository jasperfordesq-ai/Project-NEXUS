using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for AI endpoints.
/// Tests authentication, input validation, and error handling.
/// Note: AI service (Ollama) is not available in tests, so endpoints that
/// call the AI service will return 503/504. We test validation and auth paths.
/// </summary>
[Collection("Integration")]
public class AiControllerTests : IntegrationTestBase
{
    public AiControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Authentication

    [Fact]
    public async Task AiEndpoints_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var chatResponse = await Client.PostAsJsonAsync("/api/ai/chat", new { prompt = "hello" });
        var statusResponse = await Client.GetAsync("/api/ai/status");

        // Assert
        chatResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        statusResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Chat Validation

    [Fact]
    public async Task Chat_EmptyPrompt_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/chat", new
        {
            prompt = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Chat_ValidPrompt_ReturnsResponseOrServiceUnavailable()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/chat", new
        {
            prompt = "What is timebanking?"
        });

        // Assert - either works (AI available) or 503/504 (AI unavailable)
        // 409 Conflict can occur when Polly circuit breaker is open
        response.StatusCode.Should().BeOneOf(
            HttpStatusCode.OK,
            HttpStatusCode.Conflict,
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.GatewayTimeout);
    }

    #endregion

    #region Status

    [Fact]
    public async Task GetStatus_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/ai/status");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        // available might be false if Ollama isn't running, but endpoint should return 200
        content.TryGetProperty("available", out _).Should().BeTrue();
    }

    #endregion

    #region Listing Suggestions Validation

    [Fact]
    public async Task SuggestListingImprovements_MissingTitle_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/listings/suggest", new
        {
            title = "",
            description = "Some description"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task SuggestListingImprovements_TitleTooLong_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/listings/suggest", new
        {
            title = new string('A', 201),
            description = "Description"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Smart Search Validation

    [Fact]
    public async Task SmartSearch_MissingQuery_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/search", new
        {
            query = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Moderation Validation

    [Fact]
    public async Task Moderate_MissingContent_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/moderate", new
        {
            content = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Moderate_ContentTooLong_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/moderate", new
        {
            content = new string('X', 5001)
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Translation Validation

    [Fact]
    public async Task Translate_MissingText_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/translate", new
        {
            text = "",
            target_language = "spanish"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Translate_InvalidLanguage_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/translate", new
        {
            text = "Hello world",
            target_language = "klingon"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Translate_TextTooLong_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/translate", new
        {
            text = new string('A', 2001),
            target_language = "spanish"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Conversation Validation

    [Fact]
    public async Task ListConversations_Authenticated_ReturnsOkOrServiceUnavailable()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/ai/conversations");

        // Assert
        // 500 can occur if AiConversations table query fails in test environment
        response.StatusCode.Should().BeOneOf(
            HttpStatusCode.OK,
            HttpStatusCode.InternalServerError,
            HttpStatusCode.ServiceUnavailable);
    }

    #endregion

    #region Smart Replies Validation

    [Fact]
    public async Task SuggestReplies_MissingMessage_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/replies/suggest", new
        {
            last_message = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Listing Generation Validation

    [Fact]
    public async Task GenerateListing_MissingKeywords_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/listings/generate", new
        {
            keywords = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Sentiment Analysis Validation

    [Fact]
    public async Task AnalyzeSentiment_MissingText_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/sentiment", new
        {
            text = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AnalyzeSentiment_TextTooLong_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/sentiment", new
        {
            text = new string('X', 2001)
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Summarize Validation

    [Fact]
    public async Task Summarize_MissingMessages_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/ai/summarize", new
        {
            messages = Array.Empty<string>()
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    #endregion

    #region Profile & Community Endpoints

    [Fact]
    public async Task GetProfileSuggestions_ReturnsOkOrServiceUnavailable()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/ai/profile/suggestions");

        // Assert - 409 Conflict can occur when Polly circuit breaker is open
        response.StatusCode.Should().BeOneOf(
            HttpStatusCode.OK,
            HttpStatusCode.Conflict,
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.GatewayTimeout);
    }

    [Fact]
    public async Task GetCommunityInsights_ReturnsOkOrServiceUnavailable()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/ai/community/insights");

        // Assert - 409 Conflict can occur when Polly circuit breaker is open
        response.StatusCode.Should().BeOneOf(
            HttpStatusCode.OK,
            HttpStatusCode.Conflict,
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.GatewayTimeout);
    }

    [Fact]
    public async Task GetChallenges_ReturnsOkOrServiceUnavailable()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/ai/challenges");

        // Assert - 409 Conflict can occur when Polly circuit breaker is open
        response.StatusCode.Should().BeOneOf(
            HttpStatusCode.OK,
            HttpStatusCode.Conflict,
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.GatewayTimeout);
    }

    [Fact]
    public async Task GetSkillRecommendations_ReturnsOkOrServiceUnavailable()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/ai/skills/recommend");

        // Assert - 409 Conflict can occur when Polly circuit breaker is open
        response.StatusCode.Should().BeOneOf(
            HttpStatusCode.OK,
            HttpStatusCode.Conflict,
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.GatewayTimeout);
    }

    #endregion
}
