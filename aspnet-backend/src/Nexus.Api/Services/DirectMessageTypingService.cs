// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

public sealed record MessageTypingError(
    string Code,
    string Message,
    int Status,
    SafeguardingInteractionDecision? Decision = null);
public sealed record MessageTypingOutcome(bool Succeeded, MessageTypingError? Error = null);

public sealed class DirectMessageTypingService
{
    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    private readonly IPusherEventPublisher _pusher;

    public DirectMessageTypingService(
        NexusDbContext db,
        SafeguardingInteractionPolicy safeguarding,
        IPusherEventPublisher pusher)
    {
        _db = db;
        _safeguarding = safeguarding;
        _pusher = pusher;
    }

    public async Task<MessageTypingOutcome> SendAsync(
        int tenantId,
        int senderId,
        int recipientId,
        bool isTyping,
        CancellationToken cancellationToken = default)
    {
        if (recipientId <= 0 || recipientId == senderId)
            return Failed("VALIDATION_ERROR", recipientId <= 0
                ? "Message recipient is required"
                : "You cannot send a message to yourself", StatusCodes.Status400BadRequest);

        var senderAllowed = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId
                && user.Id == senderId
                && user.IsActive
                && user.SuspendedAt == null,
                cancellationToken);
        if (!senderAllowed)
            return Failed("FORBIDDEN", "Your account is not allowed to send messages", StatusCodes.Status403Forbidden);

        var recipientExists = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId && user.Id == recipientId, cancellationToken);
        if (!recipientExists)
            return Failed("NOT_FOUND", "Message recipient not found", StatusCodes.Status404NotFound);

        var messagingDisabled = await _db.UserMonitoringRestrictions.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(row => row.TenantId == tenantId
                && row.UserId == senderId
                && row.MessagingDisabled
                && (row.MonitoringExpiresAt == null || row.MonitoringExpiresAt > DateTime.UtcNow),
                cancellationToken);
        if (messagingDisabled)
            return Failed("MESSAGING_DISABLED", "Your messaging has been restricted by an administrator", StatusCodes.Status403Forbidden);

        var blocked = await _db.UserBlocks.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(row => row.TenantId == tenantId
                && ((row.UserId == senderId && row.BlockedUserId == recipientId)
                    || (row.UserId == recipientId && row.BlockedUserId == senderId)),
                cancellationToken);
        if (blocked)
            return Failed("BLOCKED", "You cannot send messages to this user", StatusCodes.Status403Forbidden);

        var decision = await _safeguarding.EvaluateLocalContactAsync(
            senderId, recipientId, tenantId, "direct_message", cancellationToken);
        if (!decision.IsAllowed)
        {
            return new(false, new(
                decision.Code,
                decision.IsUnavailable
                    ? "Safeguarding policy is temporarily unavailable"
                    : "This interaction is restricted by safeguarding policy",
                decision.IsUnavailable
                    ? StatusCodes.Status503ServiceUnavailable
                    : StatusCodes.Status403Forbidden,
                decision));
        }

        await _pusher.TriggerAsync(
            $"private-tenant.{tenantId}.user.{recipientId}",
            "typing",
            new { user_id = senderId, is_typing = isTyping },
            cancellationToken);
        return new(true);
    }

    private static MessageTypingOutcome Failed(string code, string message, int status)
        => new(false, new(code, message, status));
}
