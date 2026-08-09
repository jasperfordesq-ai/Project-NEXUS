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
/// Integration tests for the SkillsController.
/// Tests skill catalog, user skills, endorsements, and suggestions.
/// </summary>
[Collection("Integration")]
public class SkillsControllerTests : IntegrationTestBase
{
    public SkillsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Auth Checks

    [Fact]
    public async Task GetSkillCatalog_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/skills");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetUserSkills_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync($"/api/skills/users/{TestData.MemberUser.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Skill Catalog

    [Fact]
    public async Task GetSkillCatalog_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/skills");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task GetSkillCatalog_WithSearch_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/skills?search=gardening&limit=5");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("pagination").GetProperty("limit").GetInt32().Should().Be(5);
    }

    #endregion

    #region User Skills

    [Fact]
    public async Task GetUserSkills_ValidUser_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync($"/api/skills/users/{TestData.AdminUser.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("user_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task RemoveSkill_NotAdded_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync("/api/skills/my/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Endorsements

    [Fact]
    public async Task EndorseSkill_NonExistentSkill_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync(
            $"/api/skills/users/{TestData.AdminUser.Id}/99999/endorse",
            new { comment = "Great skill!" });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task RemoveEndorsement_NotEndorsed_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync(
            $"/api/skills/users/{TestData.AdminUser.Id}/99999/endorse");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetEndorsements_NonExistentSkill_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync(
            $"/api/skills/users/{TestData.AdminUser.Id}/99999/endorsements");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Top Endorsed & Suggestions

    [Fact]
    public async Task GetTopEndorsed_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/skills/top-endorsed?limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.TryGetProperty("total", out _).Should().BeTrue();
    }

    [Fact]
    public async Task GetSuggestions_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/skills/suggestions");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.TryGetProperty("total", out _).Should().BeTrue();
    }

    #endregion
}
