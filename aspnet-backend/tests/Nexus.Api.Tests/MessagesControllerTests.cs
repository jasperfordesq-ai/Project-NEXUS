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
/// Integration tests for messages/conversations endpoints.
/// Tests sending messages, listing conversations, reading messages,
/// marking as read, unread counts, and tenant isolation.
/// </summary>
[Collection("Integration")]
public class MessagesControllerTests : IntegrationTestBase
{
    public MessagesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Send Message Tests

    [Fact]
    public async Task SendMessage_ValidRequest_ReturnsCreated()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Hello from integration test!"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        content.GetProperty("conversation_id").GetInt32().Should().BeGreaterThan(0);
        content.GetProperty("content").GetString().Should().Be("Hello from integration test!");
        content.GetProperty("sender").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        content.GetProperty("recipient").GetProperty("id").GetInt32().Should().Be(TestData.AdminUser.Id);
        content.GetProperty("is_read").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task V2SendMessage_WithLaravelBodyField_ReturnsCreated()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Hello from Laravel React v2 body!"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.TryGetProperty("success", out _).Should().BeFalse(
            "Laravel respondWithData returns a plain data/meta envelope");
        content.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrWhiteSpace();
        var data = content.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("conversation_id").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("content").GetString().Should().Be("Hello from Laravel React v2 body!");
        data.GetProperty("body").GetString().Should().Be("Hello from Laravel React v2 body!");
        data.GetProperty("sender").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        data.GetProperty("recipient").GetProperty("id").GetInt32().Should().Be(TestData.AdminUser.Id);
        data.GetProperty("is_read").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task SendMessage_ToSelf_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.MemberUser.Id,
            content = "Talking to myself"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("yourself");
    }

    [Fact]
    public async Task SendMessage_ToNonExistentUser_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = 99999,
            content = "Message to ghost"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("not found");
    }

    [Fact]
    public async Task SendMessage_WithoutAuth_ReturnsUnauthorized()
    {
        // Arrange - no authentication
        ClearAuthToken();

        // Act
        var response = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Unauthorized message"
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task SendMessage_EmptyContent_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = ""
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("required");
    }

    [Fact]
    public async Task SendMessage_ContentTooLong_ReturnsBadRequest()
    {
        // Arrange
        await AuthenticateAsMemberAsync();
        var longContent = new string('A', 5001);

        // Act
        var response = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = longContent
        });

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("5000");
    }

    [Fact]
    public async Task SendMessage_ReuseExistingConversation()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act - send two messages to the same recipient
        var response1 = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "First message"
        });

        var response2 = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Second message"
        });

        // Assert - both should use the same conversation
        response1.StatusCode.Should().Be(HttpStatusCode.Created);
        response2.StatusCode.Should().Be(HttpStatusCode.Created);

        var content1 = await response1.Content.ReadFromJsonAsync<JsonElement>();
        var content2 = await response2.Content.ReadFromJsonAsync<JsonElement>();

        content1.GetProperty("conversation_id").GetInt32()
            .Should().Be(content2.GetProperty("conversation_id").GetInt32());
    }

    #endregion

    #region Get Conversations Tests

    [Fact]
    public async Task GetConversations_WithMessages_ReturnsConversations()
    {
        // Arrange - create a conversation by sending a message
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Test conversation message"
        });

        // Act
        var response = await Client.GetAsync("/api/messages");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var conversations = content.GetProperty("data").EnumerateArray().ToList();
        conversations.Should().NotBeEmpty();

        var conversation = conversations.First();
        conversation.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        conversation.GetProperty("participant").GetProperty("id").GetInt32()
            .Should().Be(TestData.AdminUser.Id);
        conversation.GetProperty("last_message").GetProperty("content").GetString()
            .Should().Be("Test conversation message");

        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task GetConversations_NoMessages_ReturnsEmpty()
    {
        // Arrange - authenticate as other tenant user who has no conversations
        await AuthenticateAsOtherTenantUserAsync();

        // Act
        var response = await Client.GetAsync("/api/messages");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().Be(0);
        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().Be(0);
    }

    #endregion

    #region Get Conversation Messages Tests

    [Fact]
    public async Task GetConversation_AsParticipant_ReturnsMessages()
    {
        // Arrange - create a conversation
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Message for conversation test"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Act
        var response = await Client.GetAsync($"/api/messages/{conversationId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().Be(conversationId);
        content.GetProperty("participant").GetProperty("id").GetInt32()
            .Should().Be(TestData.AdminUser.Id);

        var messages = content.GetProperty("messages").EnumerateArray().ToList();
        messages.Should().NotBeEmpty();
        messages.First().GetProperty("content").GetString()
            .Should().Be("Message for conversation test");

        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task GetConversation_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/messages/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("not found");
    }

    [Fact]
    public async Task GetConversation_NotParticipant_ReturnsNotFound()
    {
        // Arrange - create a conversation between member and admin
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Private message"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Act - try to access as other tenant user
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.GetAsync($"/api/messages/{conversationId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetConversation_OtherParticipant_ReturnsMessages()
    {
        // Arrange - member sends message to admin
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Message from member to admin"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Act - admin reads the conversation
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync($"/api/messages/{conversationId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().Be(conversationId);
        content.GetProperty("participant").GetProperty("id").GetInt32()
            .Should().Be(TestData.MemberUser.Id);

        var messages = content.GetProperty("messages").EnumerateArray().ToList();
        messages.Should().NotBeEmpty();
    }

    #endregion

    #region Mark Conversation Read Tests

    [Fact]
    public async Task MarkConversationRead_WithUnreadMessages_ReturnsMarkedCount()
    {
        // Arrange - member sends messages to admin
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Unread message 1"
        });

        await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Unread message 2"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Act - admin marks conversation as read
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsync($"/api/messages/{conversationId}/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("conversation_id").GetInt32().Should().Be(conversationId);
        content.GetProperty("marked_read").GetInt32().Should().BeGreaterThanOrEqualTo(2);
    }

    [Fact]
    public async Task MarkConversationRead_AlreadyRead_ReturnsZero()
    {
        // Arrange - member sends message to admin
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Will be read"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Mark as read first time
        await AuthenticateAsAdminAsync();
        await Client.PutAsync($"/api/messages/{conversationId}/read", null);

        // Act - mark as read again
        var response = await Client.PutAsync($"/api/messages/{conversationId}/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("marked_read").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task MarkConversationRead_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsync("/api/messages/99999/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task MarkConversationRead_NotParticipant_ReturnsNotFound()
    {
        // Arrange - create a conversation between member and admin
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Private conversation"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Act - try to mark read as other tenant user
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.PutAsync($"/api/messages/{conversationId}/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Unread Count Tests

    [Fact]
    public async Task GetUnreadCount_WithUnreadMessages_ReturnsCount()
    {
        // Arrange - member sends messages to admin
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Unread count test 1"
        });

        await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Unread count test 2"
        });

        // Act - check admin's unread count
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/messages/unread-count");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("unread_count").GetInt32().Should().BeGreaterThanOrEqualTo(2);
    }

    [Fact]
    public async Task GetUnreadCount_NoMessages_ReturnsZero()
    {
        // Arrange - other tenant user has no conversations
        await AuthenticateAsOtherTenantUserAsync();

        // Act
        var response = await Client.GetAsync("/api/messages/unread-count");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("unread_count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task GetUnreadCount_AfterMarkingRead_Decreases()
    {
        // Arrange - member sends message to admin
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Count decrease test"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Get initial unread count as admin
        await AuthenticateAsAdminAsync();
        var beforeResponse = await Client.GetAsync("/api/messages/unread-count");
        var beforeContent = await beforeResponse.Content.ReadFromJsonAsync<JsonElement>();
        var beforeCount = beforeContent.GetProperty("unread_count").GetInt32();

        // Mark conversation as read
        await Client.PutAsync($"/api/messages/{conversationId}/read", null);

        // Act - get unread count after marking read
        var afterResponse = await Client.GetAsync("/api/messages/unread-count");

        // Assert
        afterResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var afterContent = await afterResponse.Content.ReadFromJsonAsync<JsonElement>();
        afterContent.GetProperty("unread_count").GetInt32().Should().BeLessThan(beforeCount);
    }

    #endregion

    #region Tenant Isolation Tests

    [Fact]
    public async Task TenantIsolation_OtherTenantCannotSeeConversation()
    {
        // Arrange - create a conversation in tenant 1
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Tenant isolation test"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Act - try to access from other tenant
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.GetAsync($"/api/messages/{conversationId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task TenantIsolation_OtherTenantCannotMarkRead()
    {
        // Arrange - create a conversation in tenant 1
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Tenant mark read test"
        });

        var sendContent = await sendResponse.Content.ReadFromJsonAsync<JsonElement>();
        var conversationId = sendContent.GetProperty("conversation_id").GetInt32();

        // Act - try to mark read from other tenant
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.PutAsync($"/api/messages/{conversationId}/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task TenantIsolation_ConversationsOnlyShowOwnTenant()
    {
        // Arrange - create a conversation in tenant 1
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            content = "Tenant-scoped conversation"
        });

        // Act - list conversations from other tenant
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.GetAsync("/api/messages");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().Be(0);
    }

    #endregion
}
