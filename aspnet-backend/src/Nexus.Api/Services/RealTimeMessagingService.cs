// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.SignalR;
using Nexus.Api.Hubs;

namespace Nexus.Api.Services;

/// <summary>
/// Interface for sending real-time message notifications via SignalR.
/// All methods require tenantId to ensure tenant-isolated connection lookups.
/// </summary>
public interface IRealTimeMessagingService
{
    /// <summary>
    /// Notify a user that they received a new message.
    /// </summary>
    Task NotifyNewMessageAsync(int tenantId, int recipientUserId, MessageNotification notification);

    /// <summary>
    /// Notify participants in a conversation that messages were read.
    /// </summary>
    Task NotifyMessagesReadAsync(int conversationId, int readByUserId, int markedReadCount);

    /// <summary>
    /// Notify a user that their unread count has changed.
    /// </summary>
    Task NotifyUnreadCountChangedAsync(int tenantId, int userId, int newUnreadCount);

    /// <summary>
    /// Broadcast a message to all participants in a conversation.
    /// </summary>
    Task BroadcastToConversationAsync(int conversationId, string eventName, object data);
}

/// <summary>
/// DTO for message notifications sent via SignalR.
/// </summary>
public class MessageNotification
{
    public int Id { get; set; }
    public int ConversationId { get; set; }
    public string Content { get; set; } = string.Empty;
    public SenderInfo Sender { get; set; } = null!;
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// DTO for sender information in notifications.
/// Surname is intentionally omitted — surnames are admin-only on this platform
/// (see SurnamePrivacyMiddleware). SignalR bypasses HTTP middleware, so the
/// privacy boundary is enforced at the DTO level here.
/// </summary>
public class SenderInfo
{
    public int Id { get; set; }
    public string? FirstName { get; set; }
}

/// <summary>
/// Service for sending real-time message notifications via SignalR.
/// </summary>
public class RealTimeMessagingService : IRealTimeMessagingService
{
    private readonly IHubContext<MessagesHub> _hubContext;
    private readonly IUserConnectionService _connectionService;
    private readonly ILogger<RealTimeMessagingService> _logger;

    public RealTimeMessagingService(
        IHubContext<MessagesHub> hubContext,
        IUserConnectionService connectionService,
        ILogger<RealTimeMessagingService> logger)
    {
        _hubContext = hubContext;
        _connectionService = connectionService;
        _logger = logger;
    }

    public async Task NotifyNewMessageAsync(int tenantId, int recipientUserId, MessageNotification notification)
    {
        var connectionIds = _connectionService.GetConnections(tenantId, recipientUserId);
        if (connectionIds.Count == 0)
        {
            _logger.LogDebug("User {UserId} (tenant {TenantId}) has no active connections, skipping real-time notification",
                recipientUserId, tenantId);
            return;
        }

        _logger.LogInformation("Sending real-time message notification to user {UserId} ({ConnectionCount} connections)",
            recipientUserId, connectionIds.Count);

        try
        {
            await _hubContext.Clients.Clients(connectionIds).SendAsync("ReceiveMessage", notification);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to send real-time notification to user {UserId}", recipientUserId);
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to send real-time notification to user {UserId}", recipientUserId);
        }

        // Also broadcast to the conversation group (for UI updates in both participants' views)
        try
        {
            var groupName = MessagesHub.GetConversationGroupName(notification.ConversationId);
            await _hubContext.Clients.Group(groupName).SendAsync("ConversationUpdated", new
            {
                conversation_id = notification.ConversationId,
                last_message = new
                {
                    id = notification.Id,
                    content = notification.Content.Length > 100
                        ? notification.Content[..100] + "..."
                        : notification.Content,
                    sender_id = notification.Sender.Id,
                    is_read = notification.IsRead,
                    created_at = notification.CreatedAt
                }
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to broadcast conversation update for conversation {ConversationId}", notification.ConversationId);
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to broadcast conversation update for conversation {ConversationId}", notification.ConversationId);
        }
    }

    public async Task NotifyMessagesReadAsync(int conversationId, int readByUserId, int markedReadCount)
    {
        var groupName = MessagesHub.GetConversationGroupName(conversationId);

        _logger.LogDebug("Broadcasting MessageRead event to conversation {ConversationId}", conversationId);

        try
        {
            await _hubContext.Clients.Group(groupName).SendAsync("MessageRead", new
            {
                conversation_id = conversationId,
                read_by_user_id = readByUserId,
                marked_read = markedReadCount
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to broadcast MessageRead event for conversation {ConversationId}", conversationId);
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to broadcast MessageRead event for conversation {ConversationId}", conversationId);
        }
    }

    public async Task NotifyUnreadCountChangedAsync(int tenantId, int userId, int newUnreadCount)
    {
        var connectionIds = _connectionService.GetConnections(tenantId, userId);
        if (connectionIds.Count == 0)
        {
            return;
        }

        _logger.LogDebug("Sending unread count update to user {UserId}: {Count}",
            userId, newUnreadCount);

        try
        {
            await _hubContext.Clients.Clients(connectionIds).SendAsync("UnreadCountUpdated", new
            {
                unread_count = newUnreadCount
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to send unread count update to user {UserId}", userId);
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to send unread count update to user {UserId}", userId);
        }
    }

    public async Task BroadcastToConversationAsync(int conversationId, string eventName, object data)
    {
        var groupName = MessagesHub.GetConversationGroupName(conversationId);
        try
        {
            await _hubContext.Clients.Group(groupName).SendAsync(eventName, data);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to broadcast {EventName} to conversation {ConversationId}", eventName, conversationId);
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to broadcast {EventName} to conversation {ConversationId}", eventName, conversationId);
        }
    }
}
