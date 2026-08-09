// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Hubs;

/// <summary>
/// SignalR hub for real-time messaging.
/// Handles WebSocket connections and broadcasts new messages to recipients.
///
/// TENANT ISOLATION: SignalR hub methods do NOT go through the TenantResolutionMiddleware
/// on each invocation (only the initial WebSocket upgrade request does). Therefore, this hub
/// explicitly extracts tenant_id from JWT claims and passes it to the connection service
/// and query filters to ensure proper tenant isolation.
///
/// Client events (server → client):
/// - ReceiveMessage: New message received
/// - MessageRead: Messages in a conversation were marked as read
/// - ConversationUpdated: Conversation metadata changed
/// - UnreadCountUpdated: Total unread count changed
///
/// Server methods (client → server):
/// - JoinConversation: Subscribe to updates for a specific conversation
/// - LeaveConversation: Unsubscribe from conversation updates
/// </summary>
[Authorize]
public class MessagesHub : Hub
{
    private readonly ILogger<MessagesHub> _logger;
    private readonly IUserConnectionService _connectionService;
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public MessagesHub(
        ILogger<MessagesHub> logger,
        IUserConnectionService connectionService,
        NexusDbContext db,
        TenantContext tenantContext)
    {
        _logger = logger;
        _connectionService = connectionService;
        _db = db;
        _tenantContext = tenantContext;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = GetUserId();
        var tenantId = GetTenantId();
        if (!userId.HasValue || !tenantId.HasValue)
        {
            _logger.LogWarning("Connection attempt to MessagesHub without valid user/tenant claims. Aborting");
            Context.Abort();
            return;
        }

        EnsureTenantContext(tenantId.Value);

        _connectionService.AddConnection(tenantId.Value, userId.Value, Context.ConnectionId);
        _logger.LogInformation("User {UserId} (tenant {TenantId}) connected to MessagesHub with connection {ConnectionId}",
            userId.Value, tenantId.Value, Context.ConnectionId);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = GetUserId();
        var tenantId = GetTenantId();
        if (userId.HasValue && tenantId.HasValue)
        {
            _connectionService.RemoveConnection(tenantId.Value, userId.Value, Context.ConnectionId);
            _logger.LogInformation("User {UserId} (tenant {TenantId}) disconnected from MessagesHub. Connection {ConnectionId}",
                userId.Value, tenantId.Value, Context.ConnectionId);
        }

        if (exception != null)
        {
            _logger.LogError(exception, "MessagesHub disconnection error for connection {ConnectionId}",
                Context.ConnectionId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// Join a conversation group to receive real-time updates for that conversation.
    /// Validates that the user is a participant in the conversation before allowing subscription.
    /// Explicitly checks tenant_id from JWT to prevent cross-tenant access.
    /// </summary>
    public async Task JoinConversation(int conversationId)
    {
        var userId = GetUserId();
        var tenantId = GetTenantId();
        if (!userId.HasValue || !tenantId.HasValue)
        {
            _logger.LogWarning("Unauthenticated user tried to join conversation {ConversationId}", conversationId);
            return;
        }

        EnsureTenantContext(tenantId.Value);

        // Verify the user is a participant in this conversation within their tenant
        var isParticipant = await _db.Conversations
            .AnyAsync(c => c.Id == conversationId &&
                          c.TenantId == tenantId.Value &&
                          (c.Participant1Id == userId.Value || c.Participant2Id == userId.Value));

        if (!isParticipant)
        {
            _logger.LogWarning("User {UserId} (tenant {TenantId}) attempted to join conversation {ConversationId} without being a participant",
                userId.Value, tenantId.Value, conversationId);
            return;
        }

        var groupName = GetConversationGroupName(conversationId);
        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);

        _logger.LogDebug("User {UserId} joined conversation group {GroupName}",
            userId.Value, groupName);
    }

    /// <summary>
    /// Leave a conversation group to stop receiving updates.
    /// </summary>
    public async Task LeaveConversation(int conversationId)
    {
        var groupName = GetConversationGroupName(conversationId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, groupName);

        var userId = GetUserId();
        _logger.LogDebug("User {UserId} (connection {ConnectionId}) left conversation group {GroupName}",
            userId, Context.ConnectionId, groupName);
    }

    /// <summary>
    /// Gets the group name for a conversation.
    /// </summary>
    public static string GetConversationGroupName(int conversationId)
    {
        return $"conversation_{conversationId}";
    }

    private int? GetUserId()
    {
        return Context.User?.GetUserId();
    }

    private int? GetTenantId()
    {
        return Context.User?.GetTenantId();
    }

    /// <summary>
    /// Ensures the TenantContext is set for the current hub invocation scope.
    /// SignalR hub method calls don't re-execute the HTTP middleware pipeline,
    /// so we must set the tenant context from JWT claims on each invocation.
    /// </summary>
    private void EnsureTenantContext(int tenantId)
    {
        if (!_tenantContext.IsResolved)
        {
            _tenantContext.SetTenant(tenantId);
        }
    }
}
