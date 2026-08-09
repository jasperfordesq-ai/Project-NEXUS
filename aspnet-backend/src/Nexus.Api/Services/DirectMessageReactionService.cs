// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record MessageReactionError(string Code, string Message, int Status, SafeguardingInteractionDecision? Decision = null);
public sealed record MessageReactionToggle(bool Succeeded, bool Added, string Emoji, int MessageId, MessageReactionError? Error = null);
public sealed record MessageReactionGroup(string Emoji, int Count, IReadOnlyList<int> UserIds);

public sealed class DirectMessageReactionService
{
    public static readonly IReadOnlySet<string> AllowedEmoji = new HashSet<string>(StringComparer.Ordinal)
    {
        "👍", "❤️", "😂", "😮", "😢", "🙏"
    };

    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;

    public DirectMessageReactionService(NexusDbContext db, SafeguardingInteractionPolicy safeguarding)
    {
        _db = db;
        _safeguarding = safeguarding;
    }

    public async Task<MessageReactionToggle> ToggleAsync(
        int tenantId,
        int actorUserId,
        int messageId,
        string emoji,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        if (IsPostgres())
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({ReactionLockKey(tenantId, messageId, actorUserId, emoji)})",
                cancellationToken);
        }

        var message = await _db.Messages.IgnoreQueryFilters()
            .Include(row => row.Conversation)
            .SingleOrDefaultAsync(row => row.TenantId == tenantId && row.Id == messageId, cancellationToken);
        if (message?.Conversation == null)
            return Failed(messageId, emoji, "NOT_FOUND", "Message not found", StatusCodes.Status404NotFound);

        var recipientId = OtherParticipantId(message.Conversation, actorUserId);
        if (recipientId == null)
            return Failed(messageId, emoji, "FORBIDDEN", "You cannot react to this message", StatusCodes.Status403Forbidden);

        var existing = await _db.MessageReactions.IgnoreQueryFilters()
            .SingleOrDefaultAsync(row => row.TenantId == tenantId
                && row.MessageId == messageId
                && row.UserId == actorUserId
                && row.Emoji == emoji,
                cancellationToken);
        if (existing != null)
        {
            _db.MessageReactions.Remove(existing);
            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new(true, false, emoji, messageId);
        }

        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(
            _db, tenantId, cancellationToken);
        await LockOrdinaryInteractionStateAsync(
            tenantId, actorUserId, recipientId.Value, cancellationToken);

        var ordinaryError = await ValidateOrdinaryContactAsync(
            tenantId, actorUserId, recipientId.Value, cancellationToken);
        if (ordinaryError != null)
            return new(false, false, emoji, messageId, ordinaryError);

        var decision = await _safeguarding.EvaluateLockedLocalContactAsync(
            actorUserId,
            recipientId.Value,
            tenantId,
            "message_reaction",
            cancellationToken);
        if (!decision.IsAllowed)
        {
            return new(false, false, emoji, messageId, new(
                decision.Code,
                decision.IsUnavailable
                    ? "Safeguarding policy is temporarily unavailable"
                    : "This interaction is restricted by safeguarding policy",
                decision.IsUnavailable
                    ? StatusCodes.Status503ServiceUnavailable
                    : StatusCodes.Status403Forbidden,
                decision));
        }

        _db.MessageReactions.Add(new MessageReaction
        {
            TenantId = tenantId,
            MessageId = messageId,
            UserId = actorUserId,
            Emoji = emoji,
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(true, true, emoji, messageId);
    }

    public async Task<IReadOnlyDictionary<int, IReadOnlyList<MessageReactionGroup>>> BatchAsync(
        int tenantId,
        int viewerUserId,
        IReadOnlyCollection<int> messageIds,
        CancellationToken cancellationToken = default)
    {
        if (messageIds.Count == 0)
            return new Dictionary<int, IReadOnlyList<MessageReactionGroup>>();

        var visibleMessageIds = await _db.Messages.IgnoreQueryFilters().AsNoTracking()
            .Where(message => message.TenantId == tenantId
                && messageIds.Contains(message.Id)
                && message.Conversation != null
                && (message.Conversation.Participant1Id == viewerUserId
                    || message.Conversation.Participant2Id == viewerUserId))
            .Select(message => message.Id)
            .ToListAsync(cancellationToken);

        var rows = await _db.MessageReactions.IgnoreQueryFilters().AsNoTracking()
            .Where(row => row.TenantId == tenantId && visibleMessageIds.Contains(row.MessageId))
            .OrderBy(row => row.MessageId)
            .ThenBy(row => row.CreatedAt)
            .ThenBy(row => row.Id)
            .Select(row => new { row.MessageId, row.Emoji, row.UserId, row.CreatedAt, row.Id })
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(row => row.MessageId)
            .ToDictionary(
                messages => messages.Key,
                messages => (IReadOnlyList<MessageReactionGroup>)messages
                    .GroupBy(row => row.Emoji)
                    .OrderBy(group => group.Min(row => row.CreatedAt))
                    .ThenBy(group => group.Min(row => row.Id))
                    .Select(group => new MessageReactionGroup(
                        group.Key,
                        group.Count(),
                        group.Select(row => row.UserId).ToArray()))
                    .ToArray());
    }

    private async Task<MessageReactionError?> ValidateOrdinaryContactAsync(
        int tenantId,
        int actorUserId,
        int recipientId,
        CancellationToken cancellationToken)
    {
        var senderAllowed = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId
                && user.Id == actorUserId
                && user.IsActive
                && user.SuspendedAt == null,
                cancellationToken);
        if (!senderAllowed)
            return new("FORBIDDEN", "Your account is not allowed to send messages", StatusCodes.Status403Forbidden);

        var recipientExists = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId && user.Id == recipientId, cancellationToken);
        if (!recipientExists)
            return new("NOT_FOUND", "Recipient not found", StatusCodes.Status404NotFound);

        var messagingDisabled = await _db.UserMonitoringRestrictions.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(row => row.TenantId == tenantId
                && row.UserId == actorUserId
                && row.MessagingDisabled
                && (row.MonitoringExpiresAt == null || row.MonitoringExpiresAt > DateTime.UtcNow),
                cancellationToken);
        if (messagingDisabled)
            return new("MESSAGING_DISABLED", "Your messaging has been restricted by an administrator", StatusCodes.Status403Forbidden);

        var blocked = await _db.UserBlocks.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(row => row.TenantId == tenantId
                && ((row.UserId == actorUserId && row.BlockedUserId == recipientId)
                    || (row.UserId == recipientId && row.BlockedUserId == actorUserId)),
                cancellationToken);
        return blocked
            ? new("BLOCKED", "You cannot send messages to this user", StatusCodes.Status403Forbidden)
            : null;
    }

    private async Task LockOrdinaryInteractionStateAsync(
        int tenantId,
        int senderId,
        int recipientId,
        CancellationToken cancellationToken)
    {
        if (!IsPostgres())
            return;

        await _db.Database.ExecuteSqlRawAsync(
            "SELECT \"Id\" FROM users WHERE \"TenantId\" = {0} AND \"Id\" IN ({1}, {2}) ORDER BY \"Id\" FOR UPDATE",
            [tenantId, senderId, recipientId],
            cancellationToken);
        await _db.Database.ExecuteSqlRawAsync(
            "SELECT \"Id\" FROM user_monitoring_restrictions WHERE \"TenantId\" = {0} AND \"UserId\" = {1} FOR UPDATE",
            [tenantId, senderId],
            cancellationToken);
        await _db.Database.ExecuteSqlRawAsync(
            "SELECT id FROM user_blocks WHERE tenant_id = {0} AND ((user_id = {1} AND blocked_user_id = {2}) OR (user_id = {2} AND blocked_user_id = {1})) ORDER BY id FOR UPDATE",
            [tenantId, senderId, recipientId],
            cancellationToken);
    }

    private static int? OtherParticipantId(Conversation conversation, int userId)
        => conversation.Participant1Id == userId
            ? conversation.Participant2Id
            : conversation.Participant2Id == userId
                ? conversation.Participant1Id
                : null;

    private static MessageReactionToggle Failed(int messageId, string emoji, string code, string message, int status)
        => new(false, false, emoji, messageId, new(code, message, status));

    private bool IsPostgres()
        => _db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true;

    private static long ReactionLockKey(int tenantId, int messageId, int userId, string emoji)
    {
        unchecked
        {
            var hash = 17L;
            foreach (var value in emoji)
                hash = (hash * 31) + value;
            return 0x4e58535200000000L ^ ((long)(uint)tenantId << 32) ^ (uint)messageId ^ ((long)(uint)userId << 1) ^ hash;
        }
    }
}
