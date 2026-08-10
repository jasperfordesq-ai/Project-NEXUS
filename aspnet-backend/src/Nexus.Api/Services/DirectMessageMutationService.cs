// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Laravel-compatible edit and scoped-delete lifecycle for persisted direct
/// messages. Mutations are serialized per message and never hard-delete the
/// message row.
/// </summary>
public sealed class DirectMessageMutationService
{
    private const string DeletedPlaceholder = "[Message deleted]";

    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DirectMessageMutationService> _logger;

    public DirectMessageMutationService(
        NexusDbContext db,
        SafeguardingInteractionPolicy safeguarding,
        IServiceScopeFactory scopeFactory,
        ILogger<DirectMessageMutationService> logger)
    {
        _db = db;
        _safeguarding = safeguarding;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task<DirectMessageEditOutcome> EditAsync(
        int tenantId,
        int actorUserId,
        int messageId,
        string trimmedBody,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        await AcquireMessageMutationLockAsync(tenantId, messageId, cancellationToken);

        var message = await _db.Messages
            .IgnoreQueryFilters()
            .Include(row => row.Conversation)
            .SingleOrDefaultAsync(row => row.TenantId == tenantId && row.Id == messageId, cancellationToken);
        if (message?.Conversation == null)
        {
            return DirectMessageEditOutcome.Failed(new(
                "NOT_FOUND",
                "Message not found",
                StatusCodes.Status404NotFound));
        }

        if (message.SenderId != actorUserId)
        {
            return DirectMessageEditOutcome.Failed(new(
                "FORBIDDEN",
                "You can only edit your own messages",
                StatusCodes.Status403Forbidden));
        }

        var editCutoff = DateTime.UtcNow.AddHours(-24);
        if (message.CreatedAt < editCutoff)
        {
            return DirectMessageEditOutcome.Failed(new(
                "EDIT_EXPIRED",
                "Messages can only be edited within 24 hours of sending",
                StatusCodes.Status422UnprocessableEntity));
        }

        var recipientId = OtherParticipantId(message.Conversation, actorUserId);
        if (recipientId == null)
        {
            return DirectMessageEditOutcome.Failed(new(
                "FORBIDDEN",
                "You are not a participant in this conversation",
                StatusCodes.Status403Forbidden));
        }

        // Safeguarding writers acquire the tenant policy row before touching
        // user-owned preference/FK state. Keep that global order here before
        // taking the stronger user locks used to serialize new block or
        // monitoring-restriction inserts.
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(
            _db,
            tenantId,
            cancellationToken);
        await LockOrdinaryInteractionStateAsync(
            tenantId,
            actorUserId,
            recipientId.Value,
            cancellationToken);

        var senderAllowed = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId
                && user.Id == actorUserId
                && user.IsActive
                && user.SuspendedAt == null,
                cancellationToken);
        if (!senderAllowed)
        {
            await transaction.CommitAsync(cancellationToken);
            return DirectMessageEditOutcome.Failed(new(
                "FORBIDDEN",
                "Your account is not allowed to send messages",
                StatusCodes.Status403Forbidden));
        }

        var recipientExists = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId && user.Id == recipientId.Value, cancellationToken);
        if (!recipientExists)
        {
            await transaction.CommitAsync(cancellationToken);
            return DirectMessageEditOutcome.Failed(new(
                "NOT_FOUND",
                "Recipient not found",
                StatusCodes.Status404NotFound));
        }

        await ExpireSenderRestrictionAsync(tenantId, actorUserId, cancellationToken);
        var messagingDisabled = await _db.UserMonitoringRestrictions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(restriction => restriction.TenantId == tenantId
                && restriction.UserId == actorUserId
                && restriction.MessagingDisabled,
                cancellationToken);
        if (messagingDisabled)
        {
            await transaction.CommitAsync(cancellationToken);
            return DirectMessageEditOutcome.Failed(new(
                "MESSAGING_DISABLED",
                "Your messaging has been restricted by an administrator",
                StatusCodes.Status403Forbidden));
        }

        var blocked = await _db.UserBlocks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(block => block.TenantId == tenantId
                && ((block.UserId == actorUserId && block.BlockedUserId == recipientId.Value)
                    || (block.UserId == recipientId.Value && block.BlockedUserId == actorUserId)),
                cancellationToken);
        if (blocked)
        {
            await transaction.CommitAsync(cancellationToken);
            return DirectMessageEditOutcome.Failed(new(
                "BLOCKED",
                "You cannot send messages to this user",
                StatusCodes.Status403Forbidden));
        }

        // This definitive check locks the tenant policy, recipient preference
        // rows/options, and any sender attestation used for authorization.
        var decision = await _safeguarding.EvaluateLockedLocalContactAsync(
            actorUserId,
            recipientId.Value,
            tenantId,
            "message_edit",
            cancellationToken);
        if (!decision.IsAllowed)
        {
            await transaction.CommitAsync(cancellationToken);
            await NotifySafeguardingBlockedAttemptAsync(
                tenantId,
                actorUserId,
                recipientId.Value,
                decision);
            return DirectMessageEditOutcome.SafeguardingFailed(decision);
        }

        var now = DateTime.UtcNow;
        message.Content = PhpTextSanitizer.StripTags(trimmedBody);
        message.IsEdited = true;
        message.EditedAt = now;
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return DirectMessageEditOutcome.Succeeded(new(
            message.Id,
            message.Content,
            message.SenderId,
            message.CreatedAt));
    }

    public async Task<DirectMessageDeleteOutcome> DeleteAsync(
        int tenantId,
        int actorUserId,
        int messageId,
        DirectMessageDeleteScope scope,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        await AcquireMessageMutationLockAsync(tenantId, messageId, cancellationToken);

        var message = await _db.Messages
            .IgnoreQueryFilters()
            .Include(row => row.Conversation)
            .SingleOrDefaultAsync(row => row.TenantId == tenantId && row.Id == messageId, cancellationToken);
        if (message?.Conversation == null)
        {
            return DirectMessageDeleteOutcome.Failed(new(
                "NOT_FOUND",
                "Message not found",
                StatusCodes.Status403Forbidden));
        }

        var actorIsSender = message.SenderId == actorUserId;
        var actorIsReceiver = OtherParticipantId(message.Conversation, message.SenderId) == actorUserId;
        if (!actorIsSender && !actorIsReceiver)
        {
            return DirectMessageDeleteOutcome.Failed(new(
                "FORBIDDEN",
                "You are not a participant in this conversation",
                StatusCodes.Status403Forbidden));
        }

        if (scope == DirectMessageDeleteScope.Self)
        {
            if (actorIsSender)
            {
                message.IsDeletedSender = true;
            }
            else
            {
                message.IsDeletedReceiver = true;
            }
        }
        else
        {
            message.IsDeleted = true;
            message.Content = DeletedPlaceholder;
            message.DeletedAt = DateTime.UtcNow;
            message.DeletedByUserId = actorUserId;
            // Laravel clears only its legacy messages.reactions JSON aggregate.
            // ASP.NET has no equivalent aggregate column, so normalized reaction
            // records remain intact and require no mutation here.
        }

        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return DirectMessageDeleteOutcome.Succeeded();
    }

    private async Task AcquireMessageMutationLockAsync(
        int tenantId,
        int messageId,
        CancellationToken cancellationToken)
    {
        if (!IsPostgres())
        {
            return;
        }

        var lockKey = MessageMutationLockKey(tenantId, messageId);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({lockKey})",
            cancellationToken);
    }

    private async Task LockOrdinaryInteractionStateAsync(
        int tenantId,
        int senderId,
        int recipientId,
        CancellationToken cancellationToken)
    {
        if (!IsPostgres())
        {
            return;
        }

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

    private Task ExpireSenderRestrictionAsync(
        int tenantId,
        int senderId,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        return _db.UserMonitoringRestrictions
            .IgnoreQueryFilters()
            .Where(restriction => restriction.TenantId == tenantId
                && restriction.UserId == senderId
                && restriction.UnderMonitoring
                && restriction.MonitoringExpiresAt != null
                && restriction.MonitoringExpiresAt <= now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(restriction => restriction.UnderMonitoring, false)
                .SetProperty(restriction => restriction.MessagingDisabled, false)
                .SetProperty(restriction => restriction.MonitoringExpiresAt, (DateTime?)null),
                cancellationToken);
    }

    private async Task NotifySafeguardingBlockedAttemptAsync(
        int tenantId,
        int senderId,
        int recipientId,
        SafeguardingInteractionDecision decision)
    {
        if (decision.IsAllowed || decision.IsUnavailable)
        {
            return;
        }

        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await using var transaction = await db.Database.BeginTransactionAsync(CancellationToken.None);
            if (db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true)
            {
                var lockKey = SafeguardingAlertLockKey(tenantId, senderId, recipientId);
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({lockKey})",
                    CancellationToken.None);
            }

            var sender = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(user => user.TenantId == tenantId && user.Id == senderId);
            var recipient = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(user => user.TenantId == tenantId && user.Id == recipientId);
            var staff = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .Where(user => user.TenantId == tenantId
                    && user.IsActive
                    && user.SuspendedAt == null
                    && (user.Role == "admin"
                        || user.Role == "tenant_admin"
                        || user.Role == "broker"
                        || user.Role == "super_admin"
                        || user.IsAdmin
                        || user.IsSuperAdmin
                        || user.IsTenantSuperAdmin
                        || user.IsGod))
                .ToListAsync();

            var requiredTypes = decision.RequiredAttestationCodes?
                .OrderBy(code => code, StringComparer.Ordinal)
                .ToArray() ?? [];
            var payload = JsonSerializer.Serialize(new
            {
                sender_id = senderId,
                recipient_id = recipientId,
                reason_code = decision.Code,
                required_vetting_types = requiredTypes
            });
            var recentCutoff = DateTime.UtcNow.AddMinutes(-10);
            var existingRecipientIds = (await db.Notifications
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(notification => notification.TenantId == tenantId
                        && notification.Type == "safeguarding_contact_blocked"
                        && notification.Data == payload
                        && notification.CreatedAt >= recentCutoff)
                    .Select(notification => notification.UserId)
                    .ToListAsync())
                .ToHashSet();
            var senderName = DisplayName(sender, "A member");
            var recipientName = DisplayName(recipient, "a protected member");
            var reason = decision.Code == "VETTING_REQUIRED"
                ? "required safeguarding confirmation is not current"
                : "coordinator-mediated contact is required";

            db.Notifications.AddRange(staff
                .Where(user => !existingRecipientIds.Contains(user.Id))
                .Select(user => new Notification
                {
                    TenantId = tenantId,
                    UserId = user.Id,
                    Type = "safeguarding_contact_blocked",
                    Title = "Safeguarding contact attempt blocked",
                    Body = $"{senderName} was prevented from messaging {recipientName}: {reason}.",
                    Data = payload,
                    Link = $"/broker/safeguarding?user={recipientId}",
                    IsRead = false,
                    CreatedAt = DateTime.UtcNow
                }));
            await db.SaveChangesAsync(CancellationToken.None);
            await transaction.CommitAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogCritical(
                exception,
                "Failed to persist safeguarding blocked-contact alert for edited message in tenant {TenantId}, sender {SenderId}, recipient {RecipientId}",
                tenantId,
                senderId,
                recipientId);
        }
    }

    private static int? OtherParticipantId(Conversation conversation, int userId)
    {
        if (conversation.Participant1Id == userId)
        {
            return conversation.Participant2Id;
        }

        return conversation.Participant2Id == userId
            ? conversation.Participant1Id
            : null;
    }

    private bool IsPostgres()
        => _db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true;

    private static string DisplayName(User? user, string fallback)
    {
        if (user == null)
        {
            return fallback;
        }

        var value = $"{user.FirstName} {user.LastName}".Trim();
        return value.Length == 0 ? fallback : value;
    }

    private static long MessageMutationLockKey(int tenantId, int messageId)
    {
        unchecked
        {
            const long lockNamespace = 0x4e58534d45440000;
            return lockNamespace ^ ((long)(uint)tenantId << 32) ^ (uint)messageId;
        }
    }

    private static long SafeguardingAlertLockKey(int tenantId, int senderId, int recipientId)
    {
        unchecked
        {
            const long lockNamespace = 0x4e58534d00000000;
            return lockNamespace
                ^ ((long)(uint)tenantId << 32)
                ^ ((long)(uint)senderId << 1)
                ^ (uint)recipientId;
        }
    }

}

public enum DirectMessageDeleteScope
{
    Everyone,
    Self
}

public sealed record DirectMessageMutationError(
    string Code,
    string Message,
    int Status,
    string? Field = null);

public sealed record DirectMessageEditResult(
    int Id,
    string Body,
    int SenderId,
    DateTime CreatedAt);

public sealed record DirectMessageEditOutcome(
    DirectMessageEditResult? Result,
    DirectMessageMutationError? Error,
    SafeguardingInteractionDecision? SafeguardingDecision)
{
    public static DirectMessageEditOutcome Succeeded(DirectMessageEditResult result)
        => new(result, null, null);

    public static DirectMessageEditOutcome Failed(DirectMessageMutationError error)
        => new(null, error, null);

    public static DirectMessageEditOutcome SafeguardingFailed(SafeguardingInteractionDecision decision)
        => new(null, null, decision);
}

public sealed record DirectMessageDeleteOutcome(
    bool Success,
    DirectMessageMutationError? Error)
{
    public static DirectMessageDeleteOutcome Succeeded() => new(true, null);
    public static DirectMessageDeleteOutcome Failed(DirectMessageMutationError error) => new(false, error);
}
