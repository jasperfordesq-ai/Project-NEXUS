// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Support.Safeguarding;

namespace Nexus.Api.Services;

/// <summary>
/// Staff-proposed guardian arrangements — Laravel parity for
/// App\Services\GuardianArrangementService (guardian redesign phase 5).
/// Storage is account_relationships with proposed_by_user_id set;
/// safeguarding_assignments remains a read-only archive that these paths
/// never touch. The API parameter is still named assignment_id but it is an
/// account_relationships id.
///
/// State machine (only the WARD moves it):
///   pending   → consented | declined
///   consented → withdrawn | declined
///   declined  → consented
///   withdrawn → consented
/// Declined/withdrawn keep status='pending' — 'revoked' is the staff exit
/// only. Ending consent resets all tiers to zero and nulls the message
/// mirror; consenting again does NOT restore them.
/// </summary>
public class GuardianArrangementService
{
    public const string ActionConsented = "consented";
    public const string ActionDeclined = "declined";
    public const string ActionWithdrawn = "withdrawn";

    private static readonly Dictionary<string, string[]> AllowedFrom = new()
    {
        ["pending"] = [ActionConsented, ActionDeclined],
        ["consented"] = [ActionWithdrawn, ActionDeclined],
        ["declined"] = [ActionConsented],
        ["withdrawn"] = [ActionConsented],
    };

    private static readonly Dictionary<string, string> EventAction = new()
    {
        [ActionConsented] = "approved",
        [ActionDeclined] = "declined",
        [ActionWithdrawn] = "withdrawn",
    };

    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    private readonly SupportPendingActionService _pendingActions;
    private readonly ILogger<GuardianArrangementService> _logger;

    public GuardianArrangementService(
        NexusDbContext db,
        SafeguardingInteractionPolicy safeguarding,
        SupportPendingActionService pendingActions,
        ILogger<GuardianArrangementService> logger)
    {
        _db = db;
        _safeguarding = safeguarding;
        _pendingActions = pendingActions;
        _logger = logger;
    }

    public sealed record RespondResult(bool Ok, string? Code, string? State, bool Already);
    public sealed record TiersResult(bool Ok, string? Code, Dictionary<string, string>? Tiers);

    // ─── Reads ──────────────────────────────────────────────────────

    public async Task<List<object>> ForWardAsync(int wardUserId, CancellationToken ct)
    {
        var rows = await _db.AccountRelationships
            .AsNoTracking()
            .Include(r => r.ParentUser)
            .Where(r => r.ChildUserId == wardUserId
                && r.ProposedByUserId != null
                && r.Status != AccountRelationship.StatusRevoked)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        return rows.Select(r => (object)new
        {
            id = r.Id,
            guardian_name = r.ParentUser is null
                ? null : $"{r.ParentUser.FirstName} {r.ParentUser.LastName}".Trim(),
            assigned_at = Iso(r.CreatedAt),
            consent_given_at = Iso(r.ApprovedAt),
            consent_declined_at = Iso(r.DeclinedAt),
            consent_withdrawn_at = Iso(r.WithdrawnAt),
            ward_response_reason = r.ResponseReason,
            state = StateOf(r),
            consent_given = r.ApprovedAt is not null,
            notes = r.StaffNotes,
            tiers = AccountRelationshipService.ResolvedTiers(r)
        }).ToList();
    }

    public Task<int> PendingCountForWardAsync(int wardUserId, CancellationToken ct)
        => _db.AccountRelationships.CountAsync(r => r.ChildUserId == wardUserId
            && r.ProposedByUserId != null
            && r.Status == AccountRelationship.StatusPending
            && r.DeclinedAt == null
            && r.WithdrawnAt == null, ct);

    /// <summary>Deliberately minimal: no tiers, notes, reason, or contact details.</summary>
    public async Task<List<object>> ForGuardianAsync(int guardianUserId, CancellationToken ct)
    {
        var rows = await _db.AccountRelationships
            .AsNoTracking()
            .Include(r => r.ChildUser)
            .Where(r => r.ParentUserId == guardianUserId
                && r.ProposedByUserId != null
                && r.Status != AccountRelationship.StatusRevoked)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        return rows.Select(r => (object)new
        {
            id = r.Id,
            ward_name = r.ChildUser is null
                ? null : $"{r.ChildUser.FirstName} {r.ChildUser.LastName}".Trim(),
            assigned_at = Iso(r.CreatedAt),
            state = StateOf(r)
        }).ToList();
    }

    // ─── The ward's answer ──────────────────────────────────────────

    public async Task<RespondResult> RespondAsync(
        int wardUserId, int assignmentId, string action, string? reason,
        string? ip, string? userAgent, CancellationToken ct)
    {
        var row = await _db.AccountRelationships
            .FirstOrDefaultAsync(r => r.Id == assignmentId
                && r.ChildUserId == wardUserId
                && r.ProposedByUserId != null
                && r.Status != AccountRelationship.StatusRevoked, ct);
        // Not yours, not staff-proposed, or not live are deliberately
        // indistinguishable so the endpoint cannot probe others' arrangements.
        if (row is null) return new RespondResult(false, "NOT_FOUND", null, false);

        var currentState = StateOf(row);
        if (StateMatchesAction(currentState, action))
        {
            // Idempotent no-op: nothing written, no event, no notification.
            return new RespondResult(true, null, currentState, true);
        }

        if (!AllowedFrom.TryGetValue(currentState, out var allowed) || !allowed.Contains(action))
        {
            return new RespondResult(false, "INVALID_TRANSITION", null, false);
        }

        var now = DateTime.UtcNow;
        var normalisedReason = NormaliseReason(reason);
        var endingConsent = action is ActionDeclined or ActionWithdrawn;

        row.Status = action == ActionConsented
            ? AccountRelationship.StatusActive
            : AccountRelationship.StatusPending;
        row.ApprovedAt = action == ActionConsented ? now : null;
        row.DeclinedAt = action == ActionDeclined ? now : null;
        row.WithdrawnAt = action == ActionWithdrawn ? now : null;
        row.ResponseReason = normalisedReason;
        if (endingConsent)
        {
            row.Permissions = AccountRelationshipService.StorePermissions(
                SupportTiers.Capabilities.ToDictionary(c => c, _ => SupportTiers.None));
            row.MessageAccessGrantedAt = null;
        }

        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        if (endingConsent)
        {
            await _pendingActions.CancelOpenForRelationshipAsync(row.Id,
                action == ActionDeclined ? "guardian_consent_declined" : "guardian_consent_withdrawn",
                ct);
        }

        await AppendEventAsync(row, EventAction[action], wardUserId, normalisedReason, null, ip, userAgent, ct);
        await NotifyStaffAsync(row, action, ct);
        return new RespondResult(true, null, ActionToState(action), false);
    }

    // ─── The ward grants powers ─────────────────────────────────────

    public async Task<TiersResult> SetTiersAsync(
        int wardUserId, int assignmentId, Dictionary<string, string> requestedTiers,
        CancellationToken ct)
    {
        var clean = SupportTiers.SanitizeTiers(requestedTiers);
        // Staff-recorded guardians may never hold messages at any tier —
        // dropped silently, not an error.
        clean.Remove("messages");
        if (clean.Count == 0) return new TiersResult(false, "VALIDATION_ERROR", null);

        var row = await _db.AccountRelationships
            .FirstOrDefaultAsync(r => r.Id == assignmentId
                && r.ChildUserId == wardUserId
                && r.ProposedByUserId != null
                && r.Status == AccountRelationship.StatusActive, ct);
        if (row is null) return new TiersResult(false, "NOT_FOUND", null);

        var before = AccountRelationshipService.ResolvedTiers(row);
        var after = new Dictionary<string, string>(before);
        foreach (var (capability, tier) in clean) after[capability] = tier;

        if (TiersEqual(before, after))
        {
            // No-op: no write, no event, no notification.
            return new TiersResult(true, null, after);
        }

        if (SupportTiers.IsExpansion(before, after))
        {
            // Expansion re-runs the contact policy in BOTH directions;
            // shrinking never does — withdrawing power is always a safe exit.
            await _safeguarding.AssertLocalContactAllowedAsync(
                row.ParentUserId, wardUserId, row.TenantId, "guardian_tier_grant", ct);
            await _safeguarding.AssertLocalContactAllowedAsync(
                wardUserId, row.ParentUserId, row.TenantId, "guardian_tier_grant", ct);
        }

        row.Permissions = AccountRelationshipService.StorePermissions(after);
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await AppendEventAsync(row, "permissions_changed", wardUserId, null,
            JsonSerializer.Serialize(new { tiers_before = before, tiers_after = after }),
            null, null, ct);
        await TryNotifyAsync(row.TenantId, row.ParentUserId, "safeguarding_assignment",
            "What you may do for them changed",
            "A member you are a guardian for changed what you may do for them.",
            "/settings?tab=linked-accounts", ct);
        return new TiersResult(true, null, after);
    }

    // ─── Internals ──────────────────────────────────────────────────

    /// <summary>Order matters: withdrawn beats declined beats consented.</summary>
    public static string StateOf(AccountRelationship row)
    {
        if (row.WithdrawnAt is not null) return "withdrawn";
        if (row.DeclinedAt is not null) return "declined";
        if (row.Status == AccountRelationship.StatusActive) return "consented";
        return "pending";
    }

    private static bool StateMatchesAction(string state, string action) => action switch
    {
        ActionConsented => state == "consented",
        ActionDeclined => state == "declined",
        ActionWithdrawn => state == "withdrawn",
        _ => false,
    };

    private static string ActionToState(string action) => action;

    /// <summary>Trimmed, empty→null, capped at 500 chars.</summary>
    public static string? NormaliseReason(string? reason)
    {
        if (reason is null) return null;
        var trimmed = reason.Trim();
        if (trimmed.Length == 0) return null;
        return trimmed.Length > 500 ? trimmed[..500] : trimmed;
    }

    private static bool TiersEqual(
        IReadOnlyDictionary<string, string> a, IReadOnlyDictionary<string, string> b) =>
        SupportTiers.Capabilities.All(capability =>
            (a.TryGetValue(capability, out var left) ? left : SupportTiers.None)
            == (b.TryGetValue(capability, out var right) ? right : SupportTiers.None));

    private static string? Iso(DateTime? value) =>
        value?.ToString("yyyy-MM-dd'T'HH:mm:ssK");

    private async Task AppendEventAsync(
        AccountRelationship row, string action, int actorUserId, string? reason,
        string? details, string? ip, string? userAgent, CancellationToken ct)
    {
        var record = new AccountRelationshipEvent
        {
            TenantId = row.TenantId,
            RelationshipId = row.Id,
            ParentUserId = row.ParentUserId,
            ChildUserId = row.ChildUserId,
            Action = action,
            ActorRole = "member",
            ActorUserId = actorUserId,
            Reason = reason,
            Details = details,
            IpAddress = ip is { Length: > 45 } ? ip[..45] : ip,
            UserAgent = userAgent is { Length: > 255 } ? userAgent[..255] : userAgent,
            CreatedAt = DateTime.UtcNow
        };
        try
        {
            _db.AccountRelationshipEvents.Add(record);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _db.Entry(record).State = EntityState.Detached;
            _logger.LogWarning(ex,
                "[GuardianArrangement] event append failed for relationship {RelationshipId}", row.Id);
        }
    }

    /// <summary>The proposing staff member AND the guardian are told the ward's answer.</summary>
    private async Task NotifyStaffAsync(AccountRelationship row, string action, CancellationToken ct)
    {
        var wardName = await _db.Users.AsNoTracking()
            .Where(u => u.Id == row.ChildUserId)
            .Select(u => (u.FirstName + " " + u.LastName).Trim())
            .FirstOrDefaultAsync(ct) ?? "A member";
        var message = action switch
        {
            ActionConsented => $"{wardName} has agreed to their guardian arrangement.",
            ActionDeclined => $"{wardName} has declined their guardian arrangement.",
            _ => $"{wardName} has withdrawn their agreement to a guardian arrangement.",
        };
        var recipients = new[] { row.ProposedByUserId, (int?)row.ParentUserId }
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct();
        foreach (var recipient in recipients)
        {
            await TryNotifyAsync(row.TenantId, recipient, "safeguarding_assignment",
                "Guardian arrangement update", message, "/admin/safeguarding", ct);
        }
    }

    private async Task TryNotifyAsync(
        int tenantId, int userId, string type, string title, string body, string link,
        CancellationToken ct)
    {
        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = userId,
            Type = type,
            Title = title,
            Body = body,
            Link = link,
            IsRead = false,
            CreatedAt = DateTime.UtcNow
        };
        try
        {
            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            _db.Entry(notification).State = EntityState.Detached;
            _logger.LogWarning(ex,
                "[GuardianArrangement] notification failed for user {UserId}", userId);
        }
    }
}
