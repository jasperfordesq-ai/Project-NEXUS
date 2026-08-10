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
/// Integration tests for the GroupFeaturesController.
/// Tests announcements, policies, discussions, and files on groups.
/// Prerequisite: creates a group first, then tests extended features.
/// </summary>
[Collection("Integration")]
public class GroupFeaturesControllerTests : IntegrationTestBase
{
    public GroupFeaturesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>
    /// Helper: create a group and return its ID.
    /// </summary>
    private async Task<int> CreateTestGroupAsync()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync("/api/groups", new
        {
            name = "Features Test Group",
            description = "Group for testing extended features",
            is_public = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        return content.GetProperty("group").GetProperty("id").GetInt32();
    }

    #region Auth Checks

    [Fact]
    public async Task GetAnnouncements_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/groups/1/announcements");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetDiscussions_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/groups/1/discussions");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Announcements

    [Fact]
    public async Task CreateAnnouncement_ValidRequest_ReturnsCreated()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/groups/{groupId}/announcements", new
        {
            title = "Test Announcement",
            content = "This is a test announcement for the group.",
            is_pinned = true
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("title").GetString().Should().Be("Test Announcement");
        content.GetProperty("is_pinned").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task GetAnnouncements_AfterCreation_ReturnsAnnouncements()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        await Client.PostAsJsonAsync($"/api/groups/{groupId}/announcements", new
        {
            title = "Announcement for listing",
            content = "Content of the announcement",
            is_pinned = false
        });

        // Act
        var response = await Client.GetAsync($"/api/groups/{groupId}/announcements");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("data").GetArrayLength().Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task DeleteAnnouncement_ValidId_ReturnsNoContent()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        var createResponse = await Client.PostAsJsonAsync($"/api/groups/{groupId}/announcements", new
        {
            title = "To be deleted",
            content = "This announcement will be deleted.",
            is_pinned = false
        });

        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var announcementId = createContent.GetProperty("id").GetInt32();

        // Act
        var response = await Client.DeleteAsync($"/api/groups/{groupId}/announcements/{announcementId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    #endregion

    #region Policies

    [Fact]
    public async Task SetPolicy_ValidRequest_ReturnsOk()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        // Act
        var response = await Client.PutAsJsonAsync($"/api/groups/{groupId}/policies", new
        {
            key = "max_members",
            value = "50"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("key").GetString().Should().Be("max_members");
        content.GetProperty("value").GetString().Should().Be("50");
    }

    [Fact]
    public async Task GetPolicies_AfterSetting_ReturnsPolicies()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        await Client.PutAsJsonAsync($"/api/groups/{groupId}/policies", new
        {
            key = "join_approval",
            value = "required"
        });

        // Act
        var response = await Client.GetAsync($"/api/groups/{groupId}/policies");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task DeletePolicy_ValidKey_ReturnsNoContent()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        await Client.PutAsJsonAsync($"/api/groups/{groupId}/policies", new
        {
            key = "temp_policy",
            value = "temporary"
        });

        // Act
        var response = await Client.DeleteAsync($"/api/groups/{groupId}/policies/temp_policy");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    #endregion

    #region Discussions

    [Fact]
    public async Task CreateDiscussion_ValidRequest_ReturnsCreated()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/groups/{groupId}/discussions", new
        {
            title = "Test Discussion Topic",
            content = "Let us discuss this important topic together."
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("title").GetString().Should().Be("Test Discussion Topic");
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task GetDiscussions_AfterCreation_ReturnsList()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        await Client.PostAsJsonAsync($"/api/groups/{groupId}/discussions", new
        {
            title = "Discussion for listing",
            content = "Content for listing test."
        });

        // Act
        var response = await Client.GetAsync($"/api/groups/{groupId}/discussions");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task ReplyToDiscussion_ValidRequest_ReturnsCreated()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        var createResponse = await Client.PostAsJsonAsync($"/api/groups/{groupId}/discussions", new
        {
            title = "Discussion with reply",
            content = "This discussion will get a reply."
        });

        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var discussionId = createContent.GetProperty("id").GetInt32();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/groups/{groupId}/discussions/{discussionId}/replies", new
        {
            content = "This is a reply to the discussion."
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("content").GetString().Should().Be("This is a reply to the discussion.");
    }

    #endregion

    #region Files

    [Fact]
    public async Task AddFile_ValidRequest_ReturnsCreated()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        // Act
        var response = await Client.PostAsJsonAsync($"/api/groups/{groupId}/files", new
        {
            file_name = "meeting-notes.pdf",
            file_url = "https://example.com/files/meeting-notes.pdf",
            content_type = "application/pdf",
            file_size_bytes = 102400,
            description = "Notes from the last meeting"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("file_name").GetString().Should().Be("meeting-notes.pdf");
    }

    [Fact]
    public async Task GetFiles_AfterUpload_ReturnsList()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        await Client.PostAsJsonAsync($"/api/groups/{groupId}/files", new
        {
            file_name = "agenda.docx",
            file_url = "https://example.com/files/agenda.docx",
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            file_size_bytes = 51200
        });

        // Act
        var response = await Client.GetAsync($"/api/groups/{groupId}/files");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task DeleteFile_ValidId_ReturnsNoContent()
    {
        // Arrange
        var groupId = await CreateTestGroupAsync();

        var createResponse = await Client.PostAsJsonAsync($"/api/groups/{groupId}/files", new
        {
            file_name = "to-delete.txt",
            file_url = "https://example.com/files/to-delete.txt",
            file_size_bytes = 256
        });

        var createContent = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var fileId = createContent.GetProperty("id").GetInt32();

        // Act
        var response = await Client.DeleteAsync($"/api/groups/{groupId}/files/{fileId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    #endregion
}
