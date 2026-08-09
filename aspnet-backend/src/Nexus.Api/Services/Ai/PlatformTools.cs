// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Services.Ai;

/// <summary>
/// The platform-aware tool catalogue surfaced to the LLM. Each tool is a
/// thin, safe, tenant-scoped read against the live database. The chat
/// orchestrator dispatches tool calls here.
/// </summary>
public class PlatformTools
{
    private readonly NexusDbContext _db;
    private readonly AiKnowledgeService _knowledge;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly ILogger<PlatformTools> _logger;

    public PlatformTools(
        NexusDbContext db,
        AiKnowledgeService knowledge,
        PersonalWalletLedgerService personalWallet,
        ILogger<PlatformTools> logger)
    {
        _db = db;
        _knowledge = knowledge;
        _personalWallet = personalWallet;
        _logger = logger;
    }

    public IReadOnlyList<AiToolDefinition> Definitions { get; } = BuildDefinitions();

    private static IReadOnlyList<AiToolDefinition> BuildDefinitions()
    {
        AiToolDefinition Def(string name, string description, string schema)
        {
            using var doc = JsonDocument.Parse(schema);
            return new AiToolDefinition(name, description, doc.RootElement.Clone());
        }

        return new[]
        {
            Def("search_platform",
                "Semantic search over platform content (listings, members, skills, groups, events, blog posts, KB articles, FAQs). Returns the top matches by relevance.",
                @"{""type"":""object"",""properties"":{""query"":{""type"":""string"",""description"":""Natural-language query.""},""types"":{""type"":""array"",""items"":{""type"":""string"",""enum"":[""listing"",""user"",""skill"",""group"",""event"",""blog"",""kb_article"",""faq""]},""description"":""Restrict to these source types (optional).""},""limit"":{""type"":""integer"",""minimum"":1,""maximum"":20,""description"":""Max hits (default 8).""}},""required"":[""query""]}"),

            Def("get_listing",
                "Fetch one listing by its id. Use this after search_platform when the user asks for details on a specific listing.",
                @"{""type"":""object"",""properties"":{""listing_id"":{""type"":""integer""}},""required"":[""listing_id""]}"),

            Def("get_user_profile",
                "Fetch a member's public profile with skills and listing count.",
                @"{""type"":""object"",""properties"":{""user_id"":{""type"":""integer""}},""required"":[""user_id""]}"),

            Def("find_members_with_skill",
                "Find members who hold a given skill, ordered by endorsement count.",
                @"{""type"":""object"",""properties"":{""skill_name"":{""type"":""string""},""verified_only"":{""type"":""boolean"",""description"":""Only return members whose skill is verified.""},""limit"":{""type"":""integer"",""minimum"":1,""maximum"":50}},""required"":[""skill_name""]}"),

            Def("list_upcoming_events",
                "List upcoming events within the next N days.",
                @"{""type"":""object"",""properties"":{""days_ahead"":{""type"":""integer"",""minimum"":1,""maximum"":365,""description"":""Lookahead window (default 30).""},""limit"":{""type"":""integer"",""minimum"":1,""maximum"":50}}}"),

            Def("get_platform_stats",
                "Tenant-wide counts: members, active listings, groups, upcoming events, transactions in the last 30 days.",
                @"{""type"":""object"",""properties"":{}}"),

            Def("get_my_balance",
                "The calling user's hour balance plus a small list of their most recent transactions.",
                @"{""type"":""object"",""properties"":{}}"),

            Def("get_my_recent_activity",
                "Recent listings the calling user has created and events they have RSVP'd to.",
                @"{""type"":""object"",""properties"":{""limit"":{""type"":""integer"",""minimum"":1,""maximum"":20}}}")
        };
    }

    /// <summary>
    /// Execute one tool call. <paramref name="callingUserId"/> is the
    /// authenticated user — used by tools like <c>get_my_balance</c>. All
    /// queries bypass the global tenant filter and apply an explicit
    /// <c>TenantId == tenantId</c> predicate for clarity and safety.
    /// </summary>
    public async Task<string> ExecuteAsync(string toolName, string argsJson, int callingUserId, int tenantId, int maxBytes = 8000, CancellationToken ct = default)
    {
        JsonElement args;
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argsJson) ? "{}" : argsJson);
            args = doc.RootElement.Clone();
        }
        catch (JsonException ex)
        {
            return Json(new { error = "invalid_arguments_json", detail = ex.Message });
        }

        string result;
        try
        {
            result = toolName switch
            {
                "search_platform" => await SearchPlatform(args, tenantId, ct),
                "get_listing" => await GetListing(args, tenantId, ct),
                "get_user_profile" => await GetUserProfile(args, tenantId, ct),
                "find_members_with_skill" => await FindMembersWithSkill(args, tenantId, ct),
                "list_upcoming_events" => await ListUpcomingEvents(args, tenantId, ct),
                "get_platform_stats" => await GetPlatformStats(tenantId, ct),
                "get_my_balance" => await GetMyBalance(callingUserId, tenantId, ct),
                "get_my_recent_activity" => await GetMyRecentActivity(args, callingUserId, tenantId, ct),
                _ => Json(new { error = "unknown_tool", tool = toolName })
            };
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Tool {Tool} failed", toolName);
            result = Json(new { error = "tool_failed", detail = ex.Message });
        }

        if (result.Length > maxBytes) result = result.Substring(0, maxBytes) + "...(truncated)";
        return result;
    }

    // ─── Tool implementations ──────────────────────────────────────────────

    private async Task<string> SearchPlatform(JsonElement args, int tenantId, CancellationToken ct)
    {
        var query = args.TryGetProperty("query", out var qEl) ? qEl.GetString() ?? string.Empty : string.Empty;
        var limit = args.TryGetProperty("limit", out var lEl) && lEl.ValueKind == JsonValueKind.Number ? lEl.GetInt32() : 8;
        if (limit < 1) limit = 1; if (limit > 20) limit = 20;
        List<string>? types = null;
        if (args.TryGetProperty("types", out var tEl) && tEl.ValueKind == JsonValueKind.Array)
            types = tEl.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList();

        var hits = await _knowledge.SearchAsync(tenantId, query, limit, types, ct);
        return Json(new
        {
            hits = hits.Select(h => new
            {
                h.SourceType,
                h.SourceId,
                h.Title,
                h.Score,
                snippet = h.Content.Length > 240 ? h.Content.Substring(0, 240) + "..." : h.Content
            })
        });
    }

    private async Task<string> GetListing(JsonElement args, int tenantId, CancellationToken ct)
    {
        if (!args.TryGetProperty("listing_id", out var idEl) || idEl.ValueKind != JsonValueKind.Number)
            return Json(new { error = "missing_listing_id" });
        var id = idEl.GetInt32();

        var l = await _db.Listings.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.Id == id && x.DeletedAt == null)
            .Select(x => new
            {
                x.Id, x.Title, x.Description, x.Location, x.EstimatedHours, x.CategoryId,
                Status = x.Status.ToString(), x.UserId, x.ViewCount, x.CreatedAt
            })
            .FirstOrDefaultAsync(ct);

        return l == null ? Json(new { error = "not_found" }) : Json(l);
    }

    private async Task<string> GetUserProfile(JsonElement args, int tenantId, CancellationToken ct)
    {
        if (!args.TryGetProperty("user_id", out var idEl) || idEl.ValueKind != JsonValueKind.Number)
            return Json(new { error = "missing_user_id" });
        var id = idEl.GetInt32();

        var u = await _db.Users.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.Id == id && x.IsActive && x.SuspendedAt == null)
            .Select(x => new { x.Id, x.FirstName, x.LastName, x.Bio, x.Level, x.TotalXp, x.CreatedAt })
            .FirstOrDefaultAsync(ct);
        if (u == null) return Json(new { error = "not_found" });

        var skills = await _db.UserSkills.IgnoreQueryFilters()
            .Where(s => s.TenantId == tenantId && s.UserId == id)
            .Join(_db.Skills.IgnoreQueryFilters(), us => us.SkillId, sk => sk.Id,
                (us, sk) => new { sk.Name, us.IsVerified, us.EndorsementCount })
            .ToListAsync(ct);

        var listingCount = await _db.Listings.IgnoreQueryFilters()
            .CountAsync(x => x.TenantId == tenantId && x.UserId == id && x.DeletedAt == null, ct);

        return Json(new { user = u, skills, listing_count = listingCount });
    }

    private async Task<string> FindMembersWithSkill(JsonElement args, int tenantId, CancellationToken ct)
    {
        var name = args.TryGetProperty("skill_name", out var nEl) ? nEl.GetString() ?? string.Empty : string.Empty;
        if (string.IsNullOrWhiteSpace(name)) return Json(new { error = "missing_skill_name" });
        var verifiedOnly = args.TryGetProperty("verified_only", out var vEl) && vEl.ValueKind == JsonValueKind.True;
        var limit = args.TryGetProperty("limit", out var lEl) && lEl.ValueKind == JsonValueKind.Number ? lEl.GetInt32() : 10;
        if (limit < 1) limit = 1; if (limit > 50) limit = 50;

        var lowered = name.ToLower();
        var query = from us in _db.UserSkills.IgnoreQueryFilters()
                    join sk in _db.Skills.IgnoreQueryFilters() on us.SkillId equals sk.Id
                    join u in _db.Users.IgnoreQueryFilters() on us.UserId equals u.Id
                    where us.TenantId == tenantId && sk.TenantId == tenantId && u.TenantId == tenantId
                          && u.IsActive && u.SuspendedAt == null
                          && sk.Name.ToLower().Contains(lowered)
                    select new { us, sk, u };
        if (verifiedOnly) query = query.Where(x => x.us.IsVerified);

        var rows = await query
            .OrderByDescending(x => x.us.EndorsementCount)
            .Take(limit)
            .Select(x => new
            {
                user_id = x.u.Id,
                name = x.u.FirstName + " " + x.u.LastName,
                skill = x.sk.Name,
                x.us.IsVerified,
                x.us.EndorsementCount
            })
            .ToListAsync(ct);

        return Json(new { skill_query = name, results = rows });
    }

    private async Task<string> ListUpcomingEvents(JsonElement args, int tenantId, CancellationToken ct)
    {
        var days = args.TryGetProperty("days_ahead", out var dEl) && dEl.ValueKind == JsonValueKind.Number ? dEl.GetInt32() : 30;
        if (days < 1) days = 1; if (days > 365) days = 365;
        var limit = args.TryGetProperty("limit", out var lEl) && lEl.ValueKind == JsonValueKind.Number ? lEl.GetInt32() : 10;
        if (limit < 1) limit = 1; if (limit > 50) limit = 50;

        var now = DateTime.UtcNow;
        var horizon = now.AddDays(days);
        var rows = await _db.Events.IgnoreQueryFilters()
            .Where(e => e.TenantId == tenantId && !e.IsCancelled && e.StartsAt >= now && e.StartsAt <= horizon)
            .OrderBy(e => e.StartsAt)
            .Take(limit)
            .Select(e => new { e.Id, e.Title, e.StartsAt, e.EndsAt, e.Location, e.GroupId, e.MaxAttendees })
            .ToListAsync(ct);

        return Json(new { window_days = days, events = rows });
    }

    private async Task<string> GetPlatformStats(int tenantId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var members = await _db.Users.IgnoreQueryFilters().CountAsync(u => u.TenantId == tenantId && u.IsActive && u.SuspendedAt == null, ct);
        var activeListings = await _db.Listings.IgnoreQueryFilters().CountAsync(l => l.TenantId == tenantId && l.DeletedAt == null && l.Status == ListingStatus.Active, ct);
        var groups = await _db.Groups.IgnoreQueryFilters().CountAsync(g => g.TenantId == tenantId, ct);
        var upcomingEvents = await _db.Events.IgnoreQueryFilters().CountAsync(e => e.TenantId == tenantId && !e.IsCancelled && e.StartsAt >= now, ct);
        var since = now.AddDays(-30);
        var txns30 = await _db.Transactions
            .IgnoreQueryFilters()
            .ExcludeInternalWalletAdapters()
            .CountAsync(t => t.TenantId == tenantId && t.CreatedAt >= since, ct);

        return Json(new
        {
            members,
            active_listings = activeListings,
            groups,
            upcoming_events = upcomingEvents,
            transactions_last_30_days = txns30
        });
    }

    private async Task<string> GetMyBalance(int callingUserId, int tenantId, CancellationToken ct)
    {
        var balance = await _personalWallet.GetBalanceAsync(tenantId, callingUserId, ct);
        var txns = await _db.Transactions.IgnoreQueryFilters()
            .ExcludeInternalWalletAdapters()
            .Where(t => t.TenantId == tenantId
                && t.Status == TransactionStatus.Completed
                && ((t.SenderId == callingUserId && !t.DeletedForSender)
                    || (t.ReceiverId == callingUserId && !t.DeletedForReceiver)))
            .OrderByDescending(t => t.CreatedAt)
            .Take(5)
            .Select(t => new { t.Id, t.SenderId, t.ReceiverId, t.Amount, t.Description, t.CreatedAt })
            .ToListAsync(ct);

        var recent = txns
            .Select(t => new
            {
                t.Id,
                direction = t.SenderId == callingUserId && t.ReceiverId == callingUserId
                    ? "legacy_neutral"
                    : t.ReceiverId == callingUserId ? "credit" : "debit",
                t.Amount,
                t.Description,
                t.CreatedAt
            })
            .ToList();

        return Json(new { balance, recent });
    }

    private async Task<string> GetMyRecentActivity(JsonElement args, int callingUserId, int tenantId, CancellationToken ct)
    {
        var limit = args.TryGetProperty("limit", out var lEl) && lEl.ValueKind == JsonValueKind.Number ? lEl.GetInt32() : 5;
        if (limit < 1) limit = 1; if (limit > 20) limit = 20;

        var listings = await _db.Listings.IgnoreQueryFilters()
            .Where(l => l.TenantId == tenantId && l.UserId == callingUserId && l.DeletedAt == null)
            .OrderByDescending(l => l.CreatedAt)
            .Take(limit)
            .Select(l => new { l.Id, l.Title, status = l.Status.ToString(), l.CreatedAt })
            .ToListAsync(ct);

        var rsvps = await _db.EventRsvps.IgnoreQueryFilters()
            .Where(r => r.TenantId == tenantId && r.UserId == callingUserId)
            .OrderByDescending(r => r.RespondedAt)
            .Take(limit)
            .Join(_db.Events.IgnoreQueryFilters(), r => r.EventId, e => e.Id,
                (r, e) => new { event_id = e.Id, e.Title, e.StartsAt, r.Status, r.RespondedAt })
            .ToListAsync(ct);

        return Json(new { listings, rsvps });
    }

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };
    private static string Json(object o) => JsonSerializer.Serialize(o, JsonOpts);
}
