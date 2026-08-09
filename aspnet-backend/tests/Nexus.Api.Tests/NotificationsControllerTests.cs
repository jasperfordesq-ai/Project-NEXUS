// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for notification endpoints.
/// Tests listing, reading, marking as read, and deleting notifications,
/// as well as tenant isolation.
/// </summary>
[Collection("Integration")]
public class NotificationsControllerTests : IntegrationTestBase
{
    public NotificationsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Helper Methods

    /// <summary>
    /// Creates a notification directly in the database for testing purposes.
    /// </summary>
    private async Task<Notification> CreateTestNotificationAsync(
        int tenantId,
        int userId,
        string type = "connection_request",
        string title = "Test Notification",
        string? body = "This is a test notification",
        string? data = null,
        bool isRead = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = userId,
            Type = type,
            Title = title,
            Body = body,
            Data = data,
            IsRead = isRead,
            CreatedAt = DateTime.UtcNow,
            ReadAt = isRead ? DateTime.UtcNow : null
        };

        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        return notification;
    }

    #endregion

    #region List Notifications Tests

    [Fact]
    public async Task GetNotifications_NoNotifications_ReturnsEmptyList()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/notifications");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().Be(0);
        content.GetProperty("unread_count").GetInt32().Should().Be(0);
        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task GetNotifications_WithNotifications_ReturnsPaginatedResults()
    {
        // Arrange
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Notification 1");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Notification 2");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Notification 3", isRead: true);

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/notifications?page=1&limit=10");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().Be(3);
        content.GetProperty("unread_count").GetInt32().Should().Be(2);
        content.GetProperty("pagination").GetProperty("page").GetInt32().Should().Be(1);
        content.GetProperty("pagination").GetProperty("limit").GetInt32().Should().Be(10);
        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().Be(3);
    }

    [Fact]
    public async Task GetNotifications_UnreadOnly_FiltersCorrectly()
    {
        // Arrange
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Unread 1");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Unread 2");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Read One", isRead: true);

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/notifications?unread_only=true");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var notifications = content.GetProperty("data").EnumerateArray().ToList();
        notifications.Should().AllSatisfy(n =>
            n.GetProperty("isRead").GetBoolean().Should().BeFalse());
    }

    [Fact]
    public async Task GetNotifications_Pagination_RespectsLimits()
    {
        // Arrange - Create more notifications than the limit
        for (int i = 0; i < 5; i++)
        {
            await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
                title: $"Notification {i}");
        }

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/notifications?page=1&limit=2");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().Be(2);
        content.GetProperty("pagination").GetProperty("total").GetInt32().Should().Be(5);
        content.GetProperty("pagination").GetProperty("pages").GetInt32().Should().Be(3);
    }

    [Fact]
    public async Task GetNotifications_Unauthenticated_ReturnsUnauthorized()
    {
        // Arrange - no authentication
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/notifications");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Unread Count Tests

    [Fact]
    public async Task GetUnreadCount_NoNotifications_ReturnsZero()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/notifications/unread-count");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("unread_count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task GetUnreadCount_WithMixedNotifications_ReturnsCorrectCount()
    {
        // Arrange
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Unread 1");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Unread 2");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Already Read", isRead: true);

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/notifications/unread-count");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("unread_count").GetInt32().Should().Be(2);
    }

    [Fact]
    public async Task GetUnreadCount_Unauthenticated_ReturnsUnauthorized()
    {
        // Arrange - no authentication
        ClearAuthToken();

        // Act
        var response = await Client.GetAsync("/api/notifications/unread-count");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    #endregion

    #region Get Single Notification Tests

    [Fact]
    public async Task GetNotification_ById_ReturnsNotification()
    {
        // Arrange
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            type: Notification.Types.ConnectionRequest,
            title: "New connection request",
            body: "Admin User wants to connect",
            data: "{\"from_user_id\": 1}");

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync($"/api/notifications/{notification.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().Be(notification.Id);
        content.GetProperty("type").GetString().Should().Be("connection_request");
        content.GetProperty("title").GetString().Should().Be("New connection request");
        content.GetProperty("body").GetString().Should().Be("Admin User wants to connect");
        content.GetProperty("isRead").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task GetNotification_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/notifications/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("not found");
    }

    [Fact]
    public async Task GetNotification_BelongingToOtherUser_ReturnsNotFound()
    {
        // Arrange - Create notification for admin
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            title: "Admin's notification");

        // Act - Try to access as member
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync($"/api/notifications/{notification.Id}");

        // Assert - Should not be visible to member
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Mark As Read Tests

    [Fact]
    public async Task MarkAsRead_UnreadNotification_MarksSuccessfully()
    {
        // Arrange
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            title: "To be read");

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsync($"/api/notifications/{notification.Id}/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("notification").GetProperty("isRead").GetBoolean().Should().BeTrue();
        content.GetProperty("notification").GetProperty("readAt").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task MarkAsRead_AlreadyReadNotification_StillSucceeds()
    {
        // Arrange
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            title: "Already read",
            isRead: true);

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsync($"/api/notifications/{notification.Id}/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task MarkAsRead_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsync("/api/notifications/99999/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("not found");
    }

    [Fact]
    public async Task MarkAsRead_OtherUsersNotification_ReturnsNotFound()
    {
        // Arrange - Create notification for admin
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            title: "Admin's notification");

        // Act - Try to mark as read as member
        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsync($"/api/notifications/{notification.Id}/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task MarkAsRead_UpdatesUnreadCount()
    {
        // Arrange
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            title: "Unread notification");

        await AuthenticateAsMemberAsync();

        // Verify initial unread count
        var countResponse = await Client.GetAsync("/api/notifications/unread-count");
        var countContent = await countResponse.Content.ReadFromJsonAsync<JsonElement>();
        var initialCount = countContent.GetProperty("unread_count").GetInt32();

        // Act
        await Client.PutAsync($"/api/notifications/{notification.Id}/read", null);

        // Assert - Unread count should decrease
        var newCountResponse = await Client.GetAsync("/api/notifications/unread-count");
        var newCountContent = await newCountResponse.Content.ReadFromJsonAsync<JsonElement>();
        newCountContent.GetProperty("unread_count").GetInt32().Should().Be(initialCount - 1);
    }

    #endregion

    #region Mark All As Read Tests

    [Fact]
    public async Task MarkAllAsRead_WithUnreadNotifications_MarksAll()
    {
        // Arrange
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Unread 1");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Unread 2");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Unread 3");

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsync("/api/notifications/read-all", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("marked_count").GetInt32().Should().Be(3);

        // Verify unread count is now 0
        var countResponse = await Client.GetAsync("/api/notifications/unread-count");
        var countContent = await countResponse.Content.ReadFromJsonAsync<JsonElement>();
        countContent.GetProperty("unread_count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task MarkAllAsRead_NoUnreadNotifications_ReturnsZeroCount()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.PutAsync("/api/notifications/read-all", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("marked_count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task MarkAllAsRead_DoesNotAffectOtherUsersNotifications()
    {
        // Arrange - Create notifications for both admin and member
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.AdminUser.Id,
            title: "Admin's notification");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Member's notification");

        // Act - Mark all as read as member
        await AuthenticateAsMemberAsync();
        await Client.PutAsync("/api/notifications/read-all", null);

        // Assert - Admin's notification should still be unread
        await AuthenticateAsAdminAsync();
        var countResponse = await Client.GetAsync("/api/notifications/unread-count");
        var countContent = await countResponse.Content.ReadFromJsonAsync<JsonElement>();
        countContent.GetProperty("unread_count").GetInt32().Should().Be(1);
    }

    #endregion

    #region Delete Notification Tests

    [Fact]
    public async Task DeleteNotification_OwnNotification_Succeeds()
    {
        // Arrange
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            title: "To be deleted");

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync($"/api/notifications/{notification.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();

        // Verify it is gone
        var getResponse = await Client.GetAsync($"/api/notifications/{notification.Id}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteNotification_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.DeleteAsync("/api/notifications/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("error").GetString().Should().Contain("not found");
    }

    [Fact]
    public async Task DeleteNotification_OtherUsersNotification_ReturnsNotFound()
    {
        // Arrange - Create notification for admin
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.AdminUser.Id,
            title: "Admin's notification");

        // Act - Try to delete as member
        await AuthenticateAsMemberAsync();
        var response = await Client.DeleteAsync($"/api/notifications/{notification.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteNotification_UpdatesListCount()
    {
        // Arrange
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Notification 1");
        var toDelete = await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Notification 2");

        await AuthenticateAsMemberAsync();

        // Verify initial count
        var listResponse = await Client.GetAsync("/api/notifications");
        var listContent = await listResponse.Content.ReadFromJsonAsync<JsonElement>();
        listContent.GetProperty("pagination").GetProperty("total").GetInt32().Should().Be(2);

        // Act
        await Client.DeleteAsync($"/api/notifications/{toDelete.Id}");

        // Assert - Count should decrease
        var newListResponse = await Client.GetAsync("/api/notifications");
        var newListContent = await newListResponse.Content.ReadFromJsonAsync<JsonElement>();
        newListContent.GetProperty("pagination").GetProperty("total").GetInt32().Should().Be(1);
    }

    #endregion

    #region Tenant Isolation Tests

    [Fact]
    public async Task GetNotifications_TenantIsolation_OnlyReturnsSameTenant()
    {
        // Arrange - Create notifications in both tenants
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            title: "Tenant 1 notification");
        await CreateTestNotificationAsync(TestData.Tenant2.Id, TestData.OtherTenantUser.Id,
            title: "Tenant 2 notification");

        // Act - List as member (tenant 1)
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/notifications");

        // Assert - Should only see tenant 1 notifications
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var notifications = content.GetProperty("data").EnumerateArray().ToList();
        notifications.Should().HaveCount(1);
        notifications[0].GetProperty("title").GetString().Should().Be("Tenant 1 notification");
    }

    [Fact]
    public async Task GetNotification_CrossTenant_ReturnsNotFound()
    {
        // Arrange - Create notification in tenant 1
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            title: "Tenant 1 only");

        // Act - Try to access from tenant 2
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.GetAsync($"/api/notifications/{notification.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task MarkAsRead_CrossTenant_ReturnsNotFound()
    {
        // Arrange - Create notification in tenant 1
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            title: "Tenant 1 only");

        // Act - Try to mark as read from tenant 2
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.PutAsync($"/api/notifications/{notification.Id}/read", null);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteNotification_CrossTenant_ReturnsNotFound()
    {
        // Arrange - Create notification in tenant 1
        var notification = await CreateTestNotificationAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            title: "Tenant 1 only");

        // Act - Try to delete from tenant 2
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.DeleteAsync($"/api/notifications/{notification.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Notification Types Tests

    [Fact]
    public async Task GetNotifications_DifferentTypes_ReturnsAllTypes()
    {
        // Arrange
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            type: Notification.Types.ConnectionRequest,
            title: "Connection request");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            type: Notification.Types.MessageReceived,
            title: "New message");
        await CreateTestNotificationAsync(TestData.Tenant1.Id, TestData.MemberUser.Id,
            type: Notification.Types.TransferReceived,
            title: "Transfer received");

        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/notifications");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var notifications = content.GetProperty("data").EnumerateArray().ToList();
        notifications.Should().HaveCount(3);

        var types = notifications.Select(n => n.GetProperty("type").GetString()).ToList();
        types.Should().Contain("connection_request");
        types.Should().Contain("message_received");
        types.Should().Contain("transfer_received");
    }

    #endregion
}
