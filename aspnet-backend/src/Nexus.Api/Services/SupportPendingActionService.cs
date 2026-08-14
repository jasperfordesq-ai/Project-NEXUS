// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Support.Safeguarding;

namespace Nexus.Api.Services;

/// <summary>
/// The support-action consent workflow — Laravel parity for
/// SupportPendingActionService. A co_decide supporter prepares an action; the
/// supported member confirms (in-app or via the single-use emailed token),
/// declines, or lets it expire; only confirmation executes, through the
/// member's own execution path with the supporter stamped as acting user.
///
/// Laravel behaviours reproduced deliberately:
/// - the raw token is never returned to the supporter and never stored —
///   only its SHA-256 hash; the token travels only in the supported member's
///   notification;
/// - every transition is pending-only; terminal states never move;
/// - confirm re-checks authority at use time: a revoked relationship or
///   dropped tier auto-cancels the row and reports AUTHORITY_CHANGED;
/// - declining never requires a reason;
/// - a message-access ask is unique per relationship (nullable-unique
///   mirror column), and confirmation is the ONLY path that raises the
///   messages tier.
/// </summary>
public class SupportPendingActionService
{
    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    private readonly PersonalWalletLedgerService _wallet;
    private readonly GamificationService _gamification;
    private readonly AuditLogService _audit;
    private readonly ILogger<SupportPendingActionService> _logger;
    private readonly List<object> _errors = [];

    public SupportPendingActionService(
        NexusDbContext db,
        SafeguardingInteractionPolicy safeguarding,
        PersonalWalletLedgerService wallet,
        GamificationService gamification,
        AuditLogService audit,
        ILogger<SupportPendingActionService> logger)
    {
        _db = db;
        _safeguarding = safeguarding;
        _wallet = wallet;
        _gamification = gamification;
        _audit = audit;
        _logger = logger;
    }

    public IReadOnlyList<object> Errors => _errors;

    public sealed record PrepareResult(int Id);
    public sealed record ConfirmResult(int? ResultId);

    /// <summary>Offline attestation context: which staff member vouches, how, before whom.</summary>
    public sealed record AttestedContext(int AttestedByUserId, string Channel, string? Witness);

    // ─── Prepare ────────────────────────────────────────────────────

    public async Task<PrepareResult?> PrepareAsync(
        int supporterUserId, int supportedUserId, string actionType, string payloadJson,
        CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await _db.AccountRelationships
            .FirstOrDefaultAsync(r => r.ParentUserId == supporterUserId
                && r.ChildUserId == supportedUserId
                && r.Status == AccountRelationship.StatusActive, ct);
        if (relationship is null)
        {
            _errors.Add(Forbidden());
            return null;
        }

        var tiers = AccountRelationshipService.ResolvedTiers(relationship);
        if (actionType == SupportPendingAction.TypeMessageAccessGrant)
        {
            if (SupportTiers.AtLeast(tiers, "messages", SupportTiers.Assist))
            {
                _errors.Add(new
                {
                    code = "ALREADY_GRANTED",
                    message = "This person has already approved message access"
                });
                return null;
            }

            var open = await _db.SupportPendingActions
                .AnyAsync(a => a.RelationshipId == relationship.Id
                    && a.ActionType == SupportPendingAction.TypeMessageAccessGrant
                    && a.Status == SupportPendingAction.StatusPending, ct);
            if (open)
            {
                _errors.Add(AlreadyPending());
                return null;
            }
        }
        else
        {
            var capability = SupportPendingAction.TypeCapabilities.TryGetValue(actionType, out var c)
                ? c : null;
            if (capability is null || !SupportTiers.AtLeast(tiers, capability, SupportTiers.CoDecide))
            {
                _errors.Add(Forbidden());
                return null;
            }
        }

        try
        {
            await _safeguarding.AssertLocalContactAllowedAsync(
                supporterUserId, supportedUserId, relationship.TenantId,
                "support_action_prepare", ct);
        }
        catch (Exception ex)
        {
            _errors.Add(new { code = "FORBIDDEN", message = ex.Message });
            return null;
        }

        var token = NewToken();
        var action = new SupportPendingAction
        {
            TenantId = relationship.TenantId,
            RelationshipId = relationship.Id,
            PendingMessageRelationshipId =
                actionType == SupportPendingAction.TypeMessageAccessGrant ? relationship.Id : null,
            SupportedUserId = supportedUserId,
            SupporterUserId = supporterUserId,
            ActionType = actionType,
            Payload = payloadJson,
            Status = SupportPendingAction.StatusPending,
            TokenHash = HashToken(token),
            ExpiresAt = DateTime.UtcNow.AddDays(SupportPendingAction.ExpiryDays),
            CreatedAt = DateTime.UtcNow
        };
        _db.SupportPendingActions.Add(action);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (actionType == SupportPendingAction.TypeMessageAccessGrant)
        {
            // The nullable-unique key fired: another ask won the race.
            _db.Entry(action).State = EntityState.Detached;
            _errors.Add(AlreadyPending());
            return null;
        }

        await AuditAsync(supporterUserId, supportedUserId, "support_action_prepared",
            new { action_id = action.Id, action_type = actionType }, ct);
        await NotifySupportedOfPendingAsync(action, token, ct);
        return new PrepareResult(action.Id);
    }

    // ─── Lists ──────────────────────────────────────────────────────

    public async Task<List<object>> ListForSupportedAsync(int userId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var actions = await _db.SupportPendingActions
            .AsNoTracking()
            .Include(a => a.SupporterUser)
            .Where(a => a.SupportedUserId == userId
                && a.Status == SupportPendingAction.StatusPending
                && a.ExpiresAt > now)
            .OrderByDescending(a => a.CreatedAt)
            .Take(50)
            .ToListAsync(ct);
        return actions.Select(a => Present(a, otherParty: a.SupporterUser)).ToList();
    }

    public async Task<List<object>> ListForSupporterAsync(int userId, CancellationToken ct)
    {
        var actions = await _db.SupportPendingActions
            .AsNoTracking()
            .Include(a => a.SupportedUser)
            .Where(a => a.SupporterUserId == userId)
            .OrderByDescending(a => a.CreatedAt)
            .Take(50)
            .ToListAsync(ct);
        return actions.Select(a => Present(a, otherParty: a.SupportedUser)).ToList();
    }

    /// <summary>The tenant's pending queue for safeguarding staff — both names loaded.</summary>
    public async Task<List<object>> ListPendingForTenantAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var actions = await _db.SupportPendingActions
            .AsNoTracking()
            .Include(a => a.SupporterUser)
            .Include(a => a.SupportedUser)
            .Where(a => a.Status == SupportPendingAction.StatusPending && a.ExpiresAt > now)
            .OrderByDescending(a => a.CreatedAt)
            .Take(100)
            .ToListAsync(ct);
        return actions.Select(a => Present(a, otherParty: a.SupporterUser,
            supporter: a.SupporterUser, supported: a.SupportedUser)).ToList();
    }

    public Task<int> PendingCountForSupportedAsync(int userId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        return _db.SupportPendingActions.CountAsync(a => a.SupportedUserId == userId
            && a.Status == SupportPendingAction.StatusPending
            && a.ExpiresAt > now, ct);
    }

    // ─── Confirm / decline / cancel ─────────────────────────────────

    public Task<ConfirmResult?> ConfirmInAppAsync(
        int supportedUserId, int actionId, string? ip, string? userAgent, CancellationToken ct)
        => ConfirmAsync(
            q => q.Where(a => a.Id == actionId && a.SupportedUserId == supportedUserId),
            via: "in_app", ip, userAgent, attested: null, ct);

    /// <summary>
    /// Staff records an approval the supported member gave offline — by
    /// phone, in person, or on paper. The channel is required; the witness is
    /// optional. Runs the same shared confirm path, so authority lapses and
    /// safeguarding restrictions refuse attestation exactly as they refuse
    /// any other confirmation.
    /// </summary>
    public Task<ConfirmResult?> ConfirmAttestedAsync(
        int staffUserId, int actionId, string? channel, string? witness,
        string? ip, string? userAgent, CancellationToken ct)
    {
        if (channel is null || !SupportPendingAction.AttestChannels.Contains(channel))
        {
            _errors.Clear();
            _errors.Add(new
            {
                code = "VALIDATION_ERROR",
                message = "Choose how the approval was given: by phone, in person, or on paper"
            });
            return Task.FromResult<ConfirmResult?>(null);
        }

        var trimmedWitness = string.IsNullOrWhiteSpace(witness) ? null : witness.Trim();
        if (trimmedWitness is { Length: > 160 }) trimmedWitness = trimmedWitness[..160];
        return ConfirmAsync(
            q => q.Where(a => a.Id == actionId),
            via: "attested_offline", ip, userAgent,
            attested: new AttestedContext(staffUserId, channel, trimmedWitness), ct);
    }

    public Task<ConfirmResult?> ConfirmByTokenAsync(
        string token, string? ip, string? userAgent, CancellationToken ct)
    {
        if (!IsTokenShapeValid(token))
        {
            _errors.Clear();
            _errors.Add(new { code = "CONFIRM_FAILED", message = NotFoundMessage });
            return Task.FromResult<ConfirmResult?>(null);
        }

        var tokenHash = HashToken(token);
        // The token IS the credential; the row carries its own tenant.
        return ConfirmAsync(
            q => q.IgnoreQueryFilters()
                .Where(a => a.TokenHash == tokenHash && a.TokenConsumedAt == null),
            via: "email_token", ip, userAgent, attested: null, ct);
    }

    private async Task<ConfirmResult?> ConfirmAsync(
        Func<IQueryable<SupportPendingAction>, IQueryable<SupportPendingAction>> scope,
        string via, string? ip, string? userAgent, AttestedContext? attested, CancellationToken ct)
    {
        // No outer database transaction here: the wallet service opens its own
        // (its advisory lock requires it), and EF refuses nesting. Replays of
        // an executed-but-unmarked transfer are absorbed by the per-action
        // idempotency key instead.
        _errors.Clear();
        try
        {
            var action = await scope(_db.SupportPendingActions)
                .Where(a => a.Status == SupportPendingAction.StatusPending)
                .FirstOrDefaultAsync(ct);
            if (action is null) throw new InvalidOperationException(NotFoundMessage);
            if (action.ExpiresAt <= DateTime.UtcNow)
                throw new InvalidOperationException("This request has expired");

            var relationship = await _db.AccountRelationships
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(r => r.Id == action.RelationshipId
                    && r.TenantId == action.TenantId
                    && r.ParentUserId == action.SupporterUserId
                    && r.ChildUserId == action.SupportedUserId, ct);

            var capability = SupportPendingAction.TypeCapabilities
                .TryGetValue(action.ActionType, out var c) ? c : null;
            var tiers = relationship is null
                ? new Dictionary<string, string>()
                : AccountRelationshipService.ResolvedTiers(relationship);
            var stillAuthorised = relationship is not null
                && relationship.Status == AccountRelationship.StatusActive
                && (action.ActionType == SupportPendingAction.TypeMessageAccessGrant
                    // A message grant must STILL be ungranted.
                    ? !SupportTiers.AtLeast(tiers, "messages", SupportTiers.Assist)
                    : capability is not null
                        && SupportTiers.AtLeast(tiers, capability, SupportTiers.CoDecide));

            if (!stillAuthorised)
            {
                action.Status = SupportPendingAction.StatusCancelled;
                action.PendingMessageRelationshipId = null;
                action.CancelledAt = DateTime.UtcNow;
                action.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                await AuditAsync(action.SupporterUserId, action.SupportedUserId,
                    "support_action_cancelled",
                    new { action_id = action.Id, action_type = action.ActionType,
                          reason = "authority_no_longer_valid" }, ct);
                _errors.Add(new
                {
                    code = "AUTHORITY_CHANGED",
                    message = "You do not have permission to do this for that account"
                });
                return null;
            }

            // Use-time safeguarding re-check: a restriction that landed after
            // preparation wins.
            await _safeguarding.AssertLocalContactAllowedAsync(
                action.SupporterUserId, action.SupportedUserId, action.TenantId,
                "support_action_confirm", ct);

            var resultId = await ExecuteAsync(action, relationship!, ct);

            action.Status = SupportPendingAction.StatusConfirmed;
            action.PendingMessageRelationshipId = null;
            action.ConfirmedAt = DateTime.UtcNow;
            action.ConfirmedVia = via;
            action.ResultId = resultId;
            if (via == "email_token") action.TokenConsumedAt = DateTime.UtcNow;
            if (attested is not null)
            {
                action.AttestedByUserId = attested.AttestedByUserId;
                action.AttestedChannel = attested.Channel;
                action.AttestedWitness = attested.Witness;
            }
            action.ResponseIp = ip is { Length: > 45 } ? ip[..45] : ip;
            action.ResponseUserAgent = userAgent is { Length: > 255 } ? userAgent[..255] : userAgent;
            action.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            await AuditAsync(action.SupportedUserId, action.SupporterUserId,
                "support_action_confirmed",
                new { action_id = action.Id, action_type = action.ActionType,
                      confirmed_via = via, result_id = resultId }, ct);
            await NotifySupporterOfAnswerAsync(action, confirmed: true, ct);
            if (attested is not null)
            {
                await TryNotifyAsync(action.TenantId, action.SupportedUserId,
                    "support_action_attested", "An approval was recorded for you",
                    "A staff member recorded an approval you gave offline. "
                    + "If this is wrong, contact your community immediately.", ct);
            }

            return new ConfirmResult(resultId);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Every failure surfaces as CONFIRM_FAILED (422) with the raw
            // message — not-found, expired, safeguarding, and execution
            // failures alike — exactly as Laravel does. The row stays pending
            // because status is written only after execution succeeds.
            _errors.Add(new { code = "CONFIRM_FAILED", message = ex.Message });
            return null;
        }
    }

    public async Task<bool> DeclineAsync(
        int supportedUserId, int actionId, string? reason, CancellationToken ct)
    {
        _errors.Clear();
        var action = await _db.SupportPendingActions
            .FirstOrDefaultAsync(a => a.Id == actionId
                && a.SupportedUserId == supportedUserId
                && a.Status == SupportPendingAction.StatusPending, ct);
        if (action is null)
        {
            _errors.Add(new { code = "NOT_FOUND", message = NotFoundMessage });
            return false;
        }

        action.Status = SupportPendingAction.StatusDeclined;
        action.PendingMessageRelationshipId = null;
        action.DeclinedAt = DateTime.UtcNow;
        action.DeclineReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        action.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await AuditAsync(supportedUserId, action.SupporterUserId, "support_action_declined",
            new { action_id = action.Id, action_type = action.ActionType }, ct);
        await NotifySupporterOfAnswerAsync(action, confirmed: false, ct);
        return true;
    }

    public async Task<bool> CancelAsync(int supporterUserId, int actionId, CancellationToken ct)
    {
        _errors.Clear();
        var action = await _db.SupportPendingActions
            .FirstOrDefaultAsync(a => a.Id == actionId
                && a.SupporterUserId == supporterUserId
                && a.Status == SupportPendingAction.StatusPending, ct);
        if (action is null)
        {
            _errors.Add(new { code = "NOT_FOUND", message = NotFoundMessage });
            return false;
        }

        action.Status = SupportPendingAction.StatusCancelled;
        action.PendingMessageRelationshipId = null;
        action.CancelledAt = DateTime.UtcNow;
        action.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await AuditAsync(supporterUserId, action.SupportedUserId, "support_action_cancelled",
            new { action_id = action.Id, action_type = action.ActionType,
                  reason = "supporter_withdrew" }, ct);
        await TryNotifyAsync(action.TenantId, action.SupportedUserId, "support_action_withdrawn",
            "A request was withdrawn",
            "A request awaiting your answer was withdrawn by the person who prepared it.", ct);
        return true;
    }

    /// <summary>
    /// Cancels open message-access asks (member withdrew, supporter stood
    /// down, or the relationship was revoked). Idempotent.
    /// </summary>
    public Task CancelOpenMessageAccessRequestsAsync(
        int relationshipId, string reason, CancellationToken ct)
        => CancelOpenAsync(relationshipId, SupportPendingAction.TypeMessageAccessGrant, reason, ct);

    /// <summary>
    /// Cancels EVERY open prepared action on a relationship — used when a
    /// guardian arrangement's consent is declined or withdrawn. Idempotent.
    /// </summary>
    public Task CancelOpenForRelationshipAsync(
        int relationshipId, string reason, CancellationToken ct)
        => CancelOpenAsync(relationshipId, null, reason, ct);

    private async Task CancelOpenAsync(
        int relationshipId, string? actionType, string reason, CancellationToken ct)
    {
        var query = _db.SupportPendingActions
            .Where(a => a.RelationshipId == relationshipId
                && a.Status == SupportPendingAction.StatusPending);
        if (actionType is not null) query = query.Where(a => a.ActionType == actionType);
        var open = await query.ToListAsync(ct);
        foreach (var action in open)
        {
            action.Status = SupportPendingAction.StatusCancelled;
            action.PendingMessageRelationshipId = null;
            action.CancelledAt = DateTime.UtcNow;
            action.UpdatedAt = DateTime.UtcNow;
        }

        if (open.Count > 0)
        {
            await _db.SaveChangesAsync(ct);
            foreach (var action in open)
            {
                await AuditAsync(action.SupporterUserId, action.SupportedUserId,
                    "support_action_cancelled",
                    new { action_id = action.Id, action_type = action.ActionType, reason }, ct);
            }
        }
    }

    /// <summary>Read-only token lookup for the public GET; never mutates.</summary>
    public async Task<object?> FindByTokenAsync(string token, CancellationToken ct)
    {
        if (!IsTokenShapeValid(token)) return null;
        var tokenHash = HashToken(token);
        // Deliberately no TokenConsumedAt filter: a consumed token still
        // resolves and shows confirmed.
        var action = await _db.SupportPendingActions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(a => a.SupporterUser)
            .FirstOrDefaultAsync(a => a.TokenHash == tokenHash, ct);
        if (action is null) return null;

        var expired = action.Status == SupportPendingAction.StatusPending
            && action.ExpiresAt <= DateTime.UtcNow;
        return new
        {
            action_type = action.ActionType,
            status = expired ? SupportPendingAction.StatusExpired : action.Status,
            supporter_name = action.SupporterUser is null
                ? null
                : $"{action.SupporterUser.FirstName} {action.SupporterUser.LastName}".Trim(),
            expires_at = action.ExpiresAt.ToString("yyyy-MM-dd'T'HH:mm:ssK")
        };
    }

    /// <summary>Scheduled sweep: pending past expiry → expired. Returns count.</summary>
    public async Task<int> ExpireStaleAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var stale = await _db.SupportPendingActions
            .IgnoreQueryFilters()
            .Where(a => a.Status == SupportPendingAction.StatusPending && a.ExpiresAt <= now)
            .ToListAsync(ct);
        foreach (var action in stale)
        {
            action.Status = SupportPendingAction.StatusExpired;
            action.PendingMessageRelationshipId = null;
            action.UpdatedAt = now;
        }

        if (stale.Count > 0)
        {
            await _db.SaveChangesAsync(ct);
            foreach (var action in stale)
            {
                await AuditAsync(action.SupporterUserId, action.SupportedUserId,
                    "support_action_expired",
                    new { action_id = action.Id, action_type = action.ActionType }, ct);
                await TryNotifyAsync(action.TenantId, action.SupportedUserId,
                    "support_action_lapsed", "A request expired",
                    "A request awaiting your answer expired without being answered.", ct);
            }
        }

        return stale.Count;
    }

    // ─── Execution ──────────────────────────────────────────────────

    private async Task<int?> ExecuteAsync(
        SupportPendingAction action, AccountRelationship relationship, CancellationToken ct)
    {
        using var payload = JsonDocument.Parse(
            string.IsNullOrWhiteSpace(action.Payload) ? "{}" : action.Payload);
        var root = payload.RootElement;

        switch (action.ActionType)
        {
            case SupportPendingAction.TypeListingCreate:
            {
                var title = GetString(root, "title");
                if (string.IsNullOrWhiteSpace(title) || title.Length > 255)
                    throw new InvalidOperationException("A listing needs a title");
                var listing = new Listing
                {
                    TenantId = action.TenantId,
                    UserId = action.SupportedUserId,
                    ActingUserId = action.SupporterUserId,
                    Title = title.Trim(),
                    Description = GetString(root, "description"),
                    Type = Enum.TryParse<ListingType>(GetString(root, "type"), true, out var type)
                        ? type : ListingType.Offer,
                    Status = ListingStatus.Active,
                    Location = GetString(root, "location"),
                    EstimatedHours = root.TryGetProperty("estimated_hours", out var hours)
                        && hours.ValueKind == JsonValueKind.Number
                        ? hours.GetDecimal() : null,
                    CreatedAt = DateTime.UtcNow
                };
                _db.Listings.Add(listing);
                await _db.SaveChangesAsync(ct);
                try
                {
                    await _gamification.AwardXpAsync(action.SupportedUserId,
                        XpLog.Amounts.ListingCreated, XpLog.Sources.ListingCreated,
                        listing.Id, $"Created listing: {listing.Title}");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[SupportActions] listing XP award failed");
                }

                return listing.Id;
            }

            case SupportPendingAction.TypeCreditTransfer:
            {
                var recipient = GetString(root, "recipient")
                    ?? (root.TryGetProperty("recipient", out var r)
                        && r.ValueKind == JsonValueKind.Number
                        ? r.GetInt32().ToString() : null);
                var amount = root.TryGetProperty("amount", out var a)
                    && a.ValueKind == JsonValueKind.Number ? a.GetDecimal() : 0m;
                var result = await _wallet.TransferAsync(
                    action.TenantId, action.SupportedUserId, recipient, amount,
                    GetString(root, "description"),
                    $"support-action-{action.Id}", ct);
                if (!result.Success)
                    throw new InvalidOperationException(result.ErrorMessage ?? "Transfer failed");
                if (result.TransactionId is { } transactionId)
                {
                    // Stamp the proxy attribution on the ledger row itself.
                    await _db.Transactions
                        .IgnoreQueryFilters()
                        .Where(t => t.Id == transactionId)
                        .ExecuteUpdateAsync(setters =>
                            setters.SetProperty(t => t.ActingUserId, action.SupporterUserId), ct);
                }

                return result.TransactionId;
            }

            case SupportPendingAction.TypeMessageAccessGrant:
            {
                if (relationship.Status != AccountRelationship.StatusActive)
                    throw new InvalidOperationException("Relationship not found");
                var tiers = AccountRelationshipService.ResolvedTiers(relationship);
                var after = new Dictionary<string, string>(tiers) { ["messages"] = SupportTiers.Assist };
                relationship.Permissions = AccountRelationshipService.StorePermissions(after);
                relationship.MessageAccessGrantedAt = DateTime.UtcNow;
                relationship.UpdatedAt = DateTime.UtcNow;
                _db.AccountRelationshipEvents.Add(new AccountRelationshipEvent
                {
                    TenantId = relationship.TenantId,
                    RelationshipId = relationship.Id,
                    ParentUserId = relationship.ParentUserId,
                    ChildUserId = relationship.ChildUserId,
                    Action = "permissions_changed",
                    ActorRole = "member",
                    ActorUserId = relationship.ChildUserId,
                    Details = JsonSerializer.Serialize(new
                    {
                        tiers_after = after,
                        via = "message_access_consented"
                    }),
                    CreatedAt = DateTime.UtcNow
                });
                await _db.SaveChangesAsync(ct);
                return null;
            }

            default:
                throw new InvalidOperationException("Unknown support action type");
        }
    }

    // ─── Presentation ───────────────────────────────────────────────

    /// <summary>The raw payload is NEVER exposed — only a summary.</summary>
    private static object Present(
        SupportPendingAction action, User? otherParty,
        User? supporter = null, User? supported = null)
    {
        object payloadSummary;
        try
        {
            using var payload = JsonDocument.Parse(
                string.IsNullOrWhiteSpace(action.Payload) ? "{}" : action.Payload);
            var root = payload.RootElement;
            payloadSummary = action.ActionType switch
            {
                SupportPendingAction.TypeListingCreate => new
                {
                    title = GetString(root, "title"),
                    listing_type = GetString(root, "type")
                },
                SupportPendingAction.TypeCreditTransfer => new
                {
                    amount = root.TryGetProperty("amount", out var a)
                        && a.ValueKind == JsonValueKind.Number ? a.GetDouble() : (double?)null,
                    recipient_id = root.TryGetProperty("recipient", out var r)
                        && r.ValueKind == JsonValueKind.Number ? r.GetInt32() : (int?)null
                },
                SupportPendingAction.TypeMessageAccessGrant => new { capability = "messages" },
                _ => new { }
            };
        }
        catch (JsonException)
        {
            payloadSummary = new { };
        }

        return new
        {
            id = action.Id,
            action_type = action.ActionType,
            status = action.Status,
            payload_summary = payloadSummary,
            supporter_user_id = action.SupporterUserId,
            supported_user_id = action.SupportedUserId,
            other_party_name = otherParty is null
                ? null : $"{otherParty.FirstName} {otherParty.LastName}".Trim(),
            other_party_avatar_url = otherParty?.AvatarUrl,
            supporter_name = supporter is null
                ? null : $"{supporter.FirstName} {supporter.LastName}".Trim(),
            supported_name = supported is null
                ? null : $"{supported.FirstName} {supported.LastName}".Trim(),
            created_at = action.CreatedAt.ToString("yyyy-MM-dd'T'HH:mm:ssK"),
            expires_at = action.ExpiresAt.ToString("yyyy-MM-dd'T'HH:mm:ssK"),
            confirmed_via = action.ConfirmedVia,
            result_id = action.ResultId
        };
    }

    // ─── Internals ──────────────────────────────────────────────────

    private const string NotFoundMessage = "This request was not found or has already been answered";

    private static object Forbidden() =>
        new { code = "FORBIDDEN", message = "You do not have permission to do this for that account" };

    private static object AlreadyPending() => new
    {
        code = "ALREADY_PENDING",
        message = "A message-access request is already waiting for their answer"
    };

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

    public static string NewToken() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    public static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    private static bool IsTokenShapeValid(string token) =>
        token.Length == 64 && token.All(Uri.IsHexDigit);

    private async Task AuditAsync(
        int actorUserId, int targetUserId, string action, object details, CancellationToken ct)
    {
        try
        {
            await _audit.LogAsync(actorUserId, action, "support_pending_action", null,
                null, null, null, null,
                JsonSerializer.Serialize(new { target_user_id = targetUserId, details }));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[SupportActions] audit write failed for {Action}", action);
        }
    }

    private async Task NotifySupportedOfPendingAsync(
        SupportPendingAction action, string rawToken, CancellationToken ct)
    {
        // The raw token is the supported member's credential: it travels only
        // in their own notification, never back to the supporter.
        await TryNotifyAsync(action.TenantId, action.SupportedUserId, "support_action_pending",
            "A request needs your answer",
            "Someone who supports you has prepared an action that needs your approval. "
            + $"You can also confirm by link: /support-actions/confirm/{rawToken}", ct);
    }

    private async Task NotifySupporterOfAnswerAsync(
        SupportPendingAction action, bool confirmed, CancellationToken ct)
    {
        await TryNotifyAsync(action.TenantId, action.SupporterUserId,
            confirmed ? "support_action_confirmed" : "support_action_declined",
            confirmed ? "Your request was approved" : "Your request was declined",
            confirmed
                ? "The member you support approved your prepared action."
                : "The member you support declined your prepared action. No reason is required.",
            ct);
    }

    private async Task TryNotifyAsync(
        int tenantId, int userId, string type, string title, string body, CancellationToken ct)
    {
        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = userId,
            Type = type,
            Title = title,
            Body = body,
            Link = "/settings?tab=linked-accounts",
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
            _logger.LogWarning(ex, "[SupportActions] notification failed for user {UserId}", userId);
        }
    }
}
