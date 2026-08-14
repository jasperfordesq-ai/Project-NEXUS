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
/// Carer relationship model — Laravel parity for SubAccountService's
/// relationship surface, rebuilt on account_relationships with SupportTiers.
/// Central rules, all pinned by tests:
/// - a relationship row is never authorisation; authority is the resolved tier;
/// - only the SUPPORTED member may expand authority (supporter expansion is
///   refused with MEMBER_APPROVAL_REQUIRED);
/// - a supporter's boolean true never escalates an existing tier, boolean
///   false always shrinks;
/// - the messages capability changes only through its dedicated consent
///   workflow (support_pending_actions — build step 2) or the member's
///   withdraw, never through ordinary permission writes;
/// - every state change appends an immutable AccountRelationshipEvent.
/// </summary>
public class AccountRelationshipService
{
    public static readonly Dictionary<string, bool> DefaultPermissions = new()
    {
        ["can_view_activity"] = true,
        ["can_manage_listings"] = false,
        ["can_transact"] = false,
        ["can_view_messages"] = false,
    };

    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    private readonly ILogger<AccountRelationshipService> _logger;
    private readonly List<object> _errors = [];

    public AccountRelationshipService(
        NexusDbContext db,
        SafeguardingInteractionPolicy safeguarding,
        ILogger<AccountRelationshipService> logger)
    {
        _db = db;
        _safeguarding = safeguarding;
        _logger = logger;
    }

    public IReadOnlyList<object> Errors => _errors;

    // ─── Permissions document ───────────────────────────────────────

    public static (Dictionary<string, bool> Booleans, Dictionary<string, string> Tiers)
        ParsePermissions(string? json)
    {
        var booleans = new Dictionary<string, bool>();
        var tiers = new Dictionary<string, string>();
        if (string.IsNullOrWhiteSpace(json)) return (booleans, tiers);
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return (booleans, tiers);
            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.Value.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    booleans[property.Name] = property.Value.GetBoolean();
                }
                else if (property.Name == "tiers" && property.Value.ValueKind == JsonValueKind.Object)
                {
                    foreach (var tier in property.Value.EnumerateObject())
                    {
                        if (tier.Value.ValueKind == JsonValueKind.String)
                            tiers[tier.Name] = tier.Value.GetString() ?? "";
                    }
                }
            }
        }
        catch (JsonException)
        {
            // A corrupt document grants nothing — degrade toward less power.
        }

        return (booleans, tiers);
    }

    public static Dictionary<string, string> ResolvedTiers(AccountRelationship relationship)
    {
        var (booleans, tiers) = ParsePermissions(relationship.Permissions);
        return SupportTiers.Resolve(booleans, tiers);
    }

    /// <summary>Canonical stored shape: legacy booleans + the tiers object.</summary>
    public static string StorePermissions(IReadOnlyDictionary<string, string> tiers)
    {
        var document = new Dictionary<string, object>();
        foreach (var (key, value) in SupportTiers.ToLegacyBooleans(tiers)) document[key] = value;
        document["tiers"] = tiers;
        return JsonSerializer.Serialize(document);
    }

    // ─── Lists ──────────────────────────────────────────────────────

    public async Task<List<Dictionary<string, object?>>> GetChildAccountsAsync(
        int parentUserId, CancellationToken ct)
    {
        var rows = await RelationshipRowsAsync(
            r => r.ParentUserId == parentUserId, includeChildUser: true, ct);

        var result = new List<Dictionary<string, object?>>();
        foreach (var (relationship, user) in rows)
        {
            var tiers = ResolvedTiers(relationship);
            // Staff-proposed rows stay invisible to the supporter until the
            // member has granted a real tier on them.
            if (relationship.ProposedByUserId is not null
                && !tiers.Values.Any(t => t != SupportTiers.None))
            {
                continue;
            }

            var row = BaseRow(relationship, user, tiers);
            row["staff_recorded"] = relationship.ProposedByUserId is not null;
            result.Add(row);
        }

        return result;
    }

    public async Task<List<Dictionary<string, object?>>> GetParentAccountsAsync(
        int childUserId, CancellationToken ct)
    {
        var rows = await RelationshipRowsAsync(
            r => r.ChildUserId == childUserId && r.ProposedByUserId == null,
            includeChildUser: false, ct);

        return rows
            .Select(pair => BaseRow(pair.Relationship, pair.User, ResolvedTiers(pair.Relationship)))
            .ToList();
    }

    // ─── Lifecycle ──────────────────────────────────────────────────

    public async Task<bool> RequestRelationshipAsync(
        int parentUserId, int tenantId, int targetUserId, string relationshipType,
        Dictionary<string, bool>? requestedPermissions, CancellationToken ct)
    {
        _errors.Clear();
        var normalizedType = AccountRelationship.RelationshipTypes.Contains(relationshipType)
            ? relationshipType : "family";

        var childCount = await _db.AccountRelationships
            .CountAsync(r => r.ParentUserId == parentUserId
                && r.ChildUserId != targetUserId
                && r.Status != AccountRelationship.StatusRevoked, ct);
        if (childCount >= AccountRelationship.MaxChildren)
        {
            _errors.Add(new { code = "VALIDATION_ERROR", message = "Too many linked accounts" });
            return false;
        }

        // can_view_messages is refused at creation time, exactly as Laravel's
        // requestRelationship intersects it away.
        var booleans = new Dictionary<string, bool>(DefaultPermissions);
        if (requestedPermissions is not null)
        {
            foreach (var key in new[] { "can_view_activity", "can_manage_listings", "can_transact" })
            {
                if (requestedPermissions.TryGetValue(key, out var value)) booleans[key] = value;
            }
        }

        var tiers = SupportTiers.Resolve(booleans, null);
        var existing = await _db.AccountRelationships
            .FirstOrDefaultAsync(
                r => r.ParentUserId == parentUserId && r.ChildUserId == targetUserId, ct);
        if (existing is not null)
        {
            // Re-request: back to pending with the freshly requested grants —
            // the member must approve again before anything is authorised.
            existing.RelationshipType = normalizedType;
            existing.Permissions = StorePermissions(tiers);
            existing.Status = AccountRelationship.StatusPending;
            existing.ApprovedAt = null;
            existing.MessageAccessGrantedAt = null;
            existing.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await AppendEventAsync(existing, "requested", "member", parentUserId, null, null, ct);
            return true;
        }

        var relationship = new AccountRelationship
        {
            TenantId = tenantId,
            ParentUserId = parentUserId,
            ChildUserId = targetUserId,
            RelationshipType = normalizedType,
            Permissions = StorePermissions(tiers),
            Status = AccountRelationship.StatusPending,
            CreatedAt = DateTime.UtcNow
        };
        _db.AccountRelationships.Add(relationship);
        await _db.SaveChangesAsync(ct);
        await AppendEventAsync(relationship, "requested", "member", parentUserId, null, null, ct);
        return true;
    }

    public async Task<bool> ApproveAsync(int childUserId, int relationshipId, CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await _db.AccountRelationships
            .FirstOrDefaultAsync(r => r.Id == relationshipId
                && r.ChildUserId == childUserId
                && r.Status == AccountRelationship.StatusPending, ct);
        if (relationship is null)
        {
            _errors.Add(NotFound());
            return false;
        }

        relationship.Status = AccountRelationship.StatusActive;
        relationship.ApprovedAt = DateTime.UtcNow;
        relationship.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await AppendEventAsync(relationship, "approved", "member", childUserId, null, null, ct);
        return true;
    }

    /// <summary>
    /// Either party may end the relationship: the supporter revokes, the
    /// supported member withdraws. Soft state change (status=revoked), never a
    /// row deletion — the event trail must keep pointing at something real.
    /// </summary>
    public async Task<bool> RevokeAsync(int actorUserId, int relationshipId, CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await _db.AccountRelationships
            .FirstOrDefaultAsync(r => r.Id == relationshipId
                && (r.ParentUserId == actorUserId || r.ChildUserId == actorUserId)
                && r.Status != AccountRelationship.StatusRevoked, ct);
        if (relationship is null)
        {
            _errors.Add(NotFound());
            return false;
        }

        relationship.Status = AccountRelationship.StatusRevoked;
        relationship.WithdrawnAt = DateTime.UtcNow;
        relationship.MessageAccessGrantedAt = null;
        relationship.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        var action = relationship.ParentUserId == actorUserId ? "revoked" : "withdrawn";
        await AppendEventAsync(relationship, action, "member", actorUserId, null, null, ct);
        return true;
    }

    // ─── Permission writers ─────────────────────────────────────────

    /// <summary>
    /// The SUPPORTER's writer: expansion is refused (MEMBER_APPROVAL_REQUIRED),
    /// boolean true never escalates an existing non-none tier, boolean false
    /// and tier shrinks are honoured immediately. messages is dropped here —
    /// its grant path is the consent workflow (build step 2); messages:none is
    /// honoured as an immediate stand-down.
    /// </summary>
    public async Task<bool> UpdatePermissionsBySupporterAsync(
        int parentUserId, int relationshipId,
        Dictionary<string, bool>? requestedBooleans,
        Dictionary<string, string>? requestedTiers,
        CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await _db.AccountRelationships
            .FirstOrDefaultAsync(r => r.Id == relationshipId
                && r.ParentUserId == parentUserId
                && r.Status == AccountRelationship.StatusActive, ct);
        if (relationship is null)
        {
            _errors.Add(NotFound());
            return false;
        }

        var before = ResolvedTiers(relationship);
        var after = new Dictionary<string, string>(before);

        if (requestedBooleans is not null)
        {
            foreach (var (legacyKey, capability, tier) in new[]
                     {
                         ("can_view_activity", "activity", SupportTiers.Assist),
                         ("can_manage_listings", "listings", SupportTiers.Represent),
                         ("can_transact", "credits", SupportTiers.Represent),
                     })
            {
                if (!requestedBooleans.TryGetValue(legacyKey, out var enabled)) continue;
                if (!enabled)
                {
                    after[capability] = SupportTiers.None;
                    continue;
                }

                // Boolean true means "on", never "maximum power".
                if (before[capability] != SupportTiers.None) continue;
                after[capability] = tier;
            }
        }

        var sanitized = SupportTiers.SanitizeTiers(requestedTiers);
        var messagesStandDown = requestedTiers is not null
            && requestedTiers.TryGetValue("messages", out var requestedMessages)
            && requestedMessages == SupportTiers.None
            && before["messages"] != SupportTiers.None;
        sanitized.Remove("messages");
        foreach (var (capability, tier) in sanitized) after[capability] = tier;
        if (messagesStandDown) after["messages"] = SupportTiers.None;

        if (SupportTiers.IsExpansion(before, after))
        {
            _errors.Add(new
            {
                code = "MEMBER_APPROVAL_REQUIRED",
                message = "You do not have permission to do this for that account"
            });
            return false;
        }

        if (!TiersEqual(before, after))
        {
            relationship.Permissions = StorePermissions(after);
            if (messagesStandDown) relationship.MessageAccessGrantedAt = null;
            relationship.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await AppendEventAsync(relationship, "permissions_changed", "member", parentUserId, null,
                JsonSerializer.Serialize(new { tiers_before = before, tiers_after = after }), ct);
        }

        return true;
    }

    /// <summary>
    /// The SUPPORTED member's writer — the only path that may expand
    /// listings/credits/activity. messages is stripped (its own consent
    /// workflow); expansion re-asserts the safeguarding contact policy.
    /// </summary>
    public async Task<bool> UpdatePermissionsByMemberAsync(
        int childUserId, int relationshipId,
        Dictionary<string, string> sanitizedTiers, CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await _db.AccountRelationships
            .FirstOrDefaultAsync(r => r.Id == relationshipId
                && r.ChildUserId == childUserId
                && r.Status == AccountRelationship.StatusActive
                && r.ProposedByUserId == null, ct);
        if (relationship is null)
        {
            _errors.Add(NotFound());
            return false;
        }

        var before = ResolvedTiers(relationship);
        var after = new Dictionary<string, string>(before);
        foreach (var (capability, tier) in sanitizedTiers) after[capability] = tier;

        if (TiersEqual(before, after)) return true; // no-op success, no event

        if (SupportTiers.IsExpansion(before, after))
        {
            try
            {
                await _safeguarding.AssertLocalContactAllowedAsync(
                    relationship.ParentUserId, childUserId, relationship.TenantId,
                    "sub_account_member_permission_grant", ct);
            }
            catch (Exception ex)
            {
                _errors.Add(new { code = "FORBIDDEN", message = ex.Message });
                return false;
            }
        }

        relationship.Permissions = StorePermissions(after);
        relationship.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await AppendEventAsync(relationship, "permissions_changed", "member", childUserId, null,
            JsonSerializer.Serialize(new { tiers_before = before, tiers_after = after }), ct);
        // Build step 2: a downgrade of listings/credits below co_decide must
        // also cancel open prepared actions on this relationship.
        return true;
    }

    /// <summary>
    /// The supported member withdraws message access at any time. Shrink-only,
    /// so no safeguarding re-check. Notifies the supporter without a reason.
    /// </summary>
    public async Task<bool> WithdrawMessageAccessAsync(
        int childUserId, int relationshipId, CancellationToken ct)
    {
        _errors.Clear();
        var relationship = await _db.AccountRelationships
            .FirstOrDefaultAsync(r => r.Id == relationshipId
                && r.ChildUserId == childUserId
                && r.Status == AccountRelationship.StatusActive, ct);
        if (relationship is null)
        {
            _errors.Add(NotFound());
            return false;
        }

        var before = ResolvedTiers(relationship);
        var hadAccess = before["messages"] != SupportTiers.None;
        var after = new Dictionary<string, string>(before) { ["messages"] = SupportTiers.None };
        relationship.Permissions = StorePermissions(after);
        relationship.MessageAccessGrantedAt = null;
        relationship.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        if (hadAccess)
        {
            await AppendEventAsync(relationship, "permissions_changed", "member", childUserId, null,
                JsonSerializer.Serialize(new
                {
                    tiers_after = after,
                    via = "message_access_withdrawn"
                }), ct);
            await TryNotifyAsync(relationship.TenantId, relationship.ParentUserId,
                "sub_account_message_access_revoked",
                "Message access was withdrawn",
                "A member you support has withdrawn your access to view their messages.", ct);
        }

        return true;
    }

    /// <summary>
    /// True when the supporter holds the capability at the tier the proxy
    /// action requires (listings/credits at represent, activity at assist).
    /// can_view_messages resolves to nothing at any tier — permanently dead.
    /// </summary>
    public async Task<bool> HasPermissionAsync(
        int parentUserId, int childUserId, string legacyPermission, CancellationToken ct)
    {
        var relationship = await _db.AccountRelationships
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.ParentUserId == parentUserId
                && r.ChildUserId == childUserId
                && r.Status == AccountRelationship.StatusActive, ct);
        if (relationship is null) return false;

        var tiers = ResolvedTiers(relationship);
        return legacyPermission switch
        {
            "can_view_activity" => SupportTiers.AtLeast(tiers, "activity", SupportTiers.Assist),
            "can_manage_listings" => SupportTiers.AtLeast(tiers, "listings", SupportTiers.Represent),
            "can_transact" => SupportTiers.AtLeast(tiers, "credits", SupportTiers.Represent),
            _ => false,
        };
    }

    // ─── Internals ──────────────────────────────────────────────────

    private async Task<List<(AccountRelationship Relationship, User User)>> RelationshipRowsAsync(
        System.Linq.Expressions.Expression<Func<AccountRelationship, bool>> predicate,
        bool includeChildUser, CancellationToken ct)
    {
        var statuses = new[] { AccountRelationship.StatusActive, AccountRelationship.StatusPending };
        var relationships = await _db.AccountRelationships
            .AsNoTracking()
            .Where(predicate)
            .Where(r => statuses.Contains(r.Status))
            .OrderBy(r => r.CreatedAt)
            .ToListAsync(ct);

        var userIds = relationships
            .Select(r => includeChildUser ? r.ChildUserId : r.ParentUserId)
            .Distinct().ToArray();
        var users = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        return relationships
            .Where(r => users.ContainsKey(includeChildUser ? r.ChildUserId : r.ParentUserId))
            .Select(r => (r, users[includeChildUser ? r.ChildUserId : r.ParentUserId]))
            .ToList();
    }

    private static Dictionary<string, object?> BaseRow(
        AccountRelationship relationship, User user, IReadOnlyDictionary<string, string> tiers)
    {
        var (booleans, _) = ParsePermissions(relationship.Permissions);
        var permissions = new Dictionary<string, object>();
        foreach (var (key, value) in SupportTiers.ToLegacyBooleans(tiers)) permissions[key] = value;
        foreach (var (key, value) in booleans)
        {
            permissions.TryAdd(key, value);
        }
        permissions["tiers"] = tiers;

        return new Dictionary<string, object?>
        {
            ["relationship_id"] = relationship.Id,
            ["relationship_type"] = relationship.RelationshipType,
            ["permissions"] = permissions,
            ["status"] = relationship.Status,
            ["approved_at"] = relationship.ApprovedAt,
            // Build step 2 adds the 'pending' state (open consent ask).
            ["message_access"] = tiers["messages"] != SupportTiers.None ? "active" : "none",
            ["message_access_granted_at"] = relationship.MessageAccessGrantedAt,
            ["created_at"] = relationship.CreatedAt,
            ["user_id"] = user.Id,
            ["first_name"] = user.FirstName,
            ["last_name"] = user.LastName,
            ["avatar_url"] = user.AvatarUrl,
            ["email"] = user.Email,
        };
    }

    private async Task AppendEventAsync(
        AccountRelationship relationship, string action, string actorRole,
        int? actorUserId, string? reason, string? details, CancellationToken ct)
    {
        var record = new AccountRelationshipEvent
        {
            TenantId = relationship.TenantId,
            RelationshipId = relationship.Id,
            ParentUserId = relationship.ParentUserId,
            ChildUserId = relationship.ChildUserId,
            Action = action,
            ActorRole = actorRole,
            ActorUserId = actorUserId,
            Reason = reason,
            Details = details,
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
                "[AccountRelationships] event append failed for relationship {RelationshipId}",
                relationship.Id);
        }
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
            _logger.LogWarning(ex, "[AccountRelationships] notification failed for user {UserId}", userId);
        }
    }

    private static bool TiersEqual(
        IReadOnlyDictionary<string, string> a, IReadOnlyDictionary<string, string> b) =>
        SupportTiers.Capabilities.All(capability =>
            (a.TryGetValue(capability, out var left) ? left : SupportTiers.None)
            == (b.TryGetValue(capability, out var right) ? right : SupportTiers.None));

    private static object NotFound() =>
        new { code = "NOT_FOUND", message = "Relationship not found" };
}
