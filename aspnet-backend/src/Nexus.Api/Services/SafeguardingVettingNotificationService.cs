// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Post-commit in-app notification delivery for safeguarding-vetting workflows.
/// Each delivery uses a fresh scope so a failed bell cannot poison the domain
/// DbContext that already committed the authoritative decision.
/// </summary>
public sealed class SafeguardingVettingNotificationService
{
    public const string StatusUpdatedType = "safeguarding_status_updated";
    public const string ReviewRequestedType = "safeguarding_review_requested";
    public const string VettingReviewType = "safeguarding_vetting_review";
    public const string PolicyReviewType = "safeguarding_policy_review";

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<SafeguardingVettingNotificationService> _logger;

    public SafeguardingVettingNotificationService(
        IServiceScopeFactory scopeFactory,
        ILogger<SafeguardingVettingNotificationService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public Task NotifyMemberStatusUpdatedAsync(
        int tenantId,
        int memberId,
        CancellationToken cancellationToken = default)
        => BestEffortAsync(
            "member status update",
            tenantId,
            async ct =>
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                var exists = await db.Users.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(user => user.TenantId == tenantId && user.Id == memberId, ct);
                if (!exists)
                {
                    return;
                }

                db.Notifications.Add(Create(
                    tenantId,
                    memberId,
                    StatusUpdatedType,
                    "Your community safeguarding vetting confirmation has been updated.",
                    "/settings?safeguarding=1",
                    isImportant: false));
                await db.SaveChangesAsync(ct);
            },
            cancellationToken);

    public Task NotifyPolicyRotationMembersAsync(
        int tenantId,
        IEnumerable<int> memberIds,
        CancellationToken cancellationToken = default)
        => BestEffortAsync(
            "policy rotation",
            tenantId,
            async ct =>
            {
                var ids = memberIds.Distinct().ToArray();
                if (ids.Length == 0)
                {
                    return;
                }

                await using var scope = _scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                var recipients = await db.Users.IgnoreQueryFilters().AsNoTracking()
                    .Where(user => user.TenantId == tenantId && ids.Contains(user.Id))
                    .Select(user => user.Id)
                    .ToListAsync(ct);
                db.Notifications.AddRange(recipients.Select(memberId => Create(
                    tenantId,
                    memberId,
                    VettingReviewType,
                    "Your community has started a safeguarding policy review. Your broker must reconfirm your private contact status; this is not a certificate expiry.",
                    "/settings",
                    isImportant: true)));
                await db.SaveChangesAsync(ct);
            },
            cancellationToken);

    /// <summary>
    /// Canonical member-review notification delivery is not best-effort: a
    /// delivery failure is surfaced after the idempotent review row commits.
    /// </summary>
    public async Task NotifyDecisionMakersOfReviewRequestAsync(
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var recipients = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(user => user.TenantId == tenantId
                && user.IsActive
                && user.SuspendedAt == null
                && (user.Role == "broker"
                    || user.Role == "admin"
                    || user.Role == "tenant_admin"
                    || user.Role == "super_admin"
                    || user.Role == "god"
                    || user.IsAdmin
                    || user.IsSuperAdmin
                    || user.IsTenantSuperAdmin
                    || user.IsGod))
            .Select(user => user.Id)
            .Distinct()
            .ToListAsync(cancellationToken);

        db.Notifications.AddRange(recipients.Select(userId => Create(
            tenantId,
            userId,
            ReviewRequestedType,
            "A member has requested a safeguarding vetting review.",
            "/broker/vetting?status=review_requested",
            isImportant: false)));
        await db.SaveChangesAsync(cancellationToken);
    }

    public Task NotifyJurisdictionReviewRequiredAsync(
        int tenantId,
        IEnumerable<int> affectedMemberIds,
        CancellationToken cancellationToken = default)
        => BestEffortAsync(
            "jurisdiction review",
            tenantId,
            async ct =>
            {
                var memberIds = affectedMemberIds.Distinct().ToArray();
                await using var scope = _scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

                var activeMembers = memberIds.Length == 0
                    ? new List<int>()
                    : await db.Users.IgnoreQueryFilters().AsNoTracking()
                        .Where(user => user.TenantId == tenantId && user.IsActive && memberIds.Contains(user.Id))
                        .Select(user => user.Id)
                        .ToListAsync(ct);
                var staff = await db.Users.IgnoreQueryFilters().AsNoTracking()
                    .Where(user => user.TenantId == tenantId
                        && user.IsActive
                        && (user.Role == "admin"
                            || user.Role == "tenant_admin"
                            || user.Role == "broker"
                            || user.Role == "super_admin"))
                    .Select(user => user.Id)
                    .ToListAsync(ct);

                db.Notifications.AddRange(activeMembers.Select(userId => Create(
                    tenantId,
                    userId,
                    PolicyReviewType,
                    "Your community changed its safeguarding jurisdiction. Your existing protection remains active, but please review the updated wording in Settings.",
                    "/settings",
                    isImportant: true)));
                db.Notifications.AddRange(staff.Select(userId => Create(
                    tenantId,
                    userId,
                    PolicyReviewType,
                    "The safeguarding jurisdiction changed. Affected member protections remain active and now require member review.",
                    "/broker/safeguarding",
                    isImportant: true)));
                await db.SaveChangesAsync(ct);
            },
            cancellationToken);

    public Task NotifyConsentRevokedAsync(
        int tenantId,
        string? firstName,
        string? lastName,
        int memberId,
        string optionLabel,
        CancellationToken cancellationToken = default)
        => BestEffortAsync(
            "member consent revocation",
            tenantId,
            async ct =>
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                var recipients = await db.Users.IgnoreQueryFilters().AsNoTracking()
                    .Where(user => user.TenantId == tenantId
                        && user.IsActive
                        && user.SuspendedAt == null
                        && (user.Role == "admin"
                            || user.Role == "tenant_admin"
                            || user.Role == "broker"
                            || user.Role == "super_admin"))
                    .Select(user => user.Id)
                    .Distinct()
                    .ToListAsync(ct);
                var displayName = string.Join(' ', new[] { firstName, lastName }
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Select(value => value!.Trim()));
                if (displayName.Length == 0)
                {
                    displayName = "A member";
                }

                db.Notifications.AddRange(recipients.Select(userId => Create(
                    tenantId,
                    userId,
                    "safeguarding_flag",
                    $"{displayName} has withdrawn safeguarding consent (option: {optionLabel})",
                    $"/broker/safeguarding?user={memberId}",
                    isImportant: false)));
                await db.SaveChangesAsync(ct);
            },
            cancellationToken);

    private async Task BestEffortAsync(
        string operation,
        int tenantId,
        Func<CancellationToken, Task> delivery,
        CancellationToken cancellationToken)
    {
        try
        {
            await delivery(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Safeguarding vetting {Operation} notification failed for tenant {TenantId}",
                operation,
                tenantId);
        }
    }

    private static Notification Create(
        int tenantId,
        int userId,
        string type,
        string title,
        string link,
        bool isImportant)
        => new()
        {
            TenantId = tenantId,
            UserId = userId,
            Type = type,
            Title = title,
            Link = link,
            // Laravel accepts an isImportant argument but currently persists no
            // priority field or metadata. Keep the argument for call-site parity
            // without exposing a noncanonical Data payload.
            Data = null,
            IsRead = false,
            CreatedAt = DateTime.UtcNow
        };
}
