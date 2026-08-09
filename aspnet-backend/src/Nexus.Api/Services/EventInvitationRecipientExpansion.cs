// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Mail;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Nexus.Api.Services;

public sealed partial class EventRegistrationProductService
{
    private sealed record CampaignRecipient(int? User, string? Email);
    private sealed record CampaignRecipientError(int row, string code);
    private sealed record CampaignExpansion(List<CampaignRecipient> Recipients, List<CampaignRecipientError> Errors, int PreviewCount, object Snapshot, object? CriteriaSummary);

    private async Task<CampaignExpansion?> ExpandCampaignRecipientsAsync(int tenantId, int eventId, int actorId, string type, JsonElement source, CancellationToken ct)
    {
        var candidates = new List<(int? User, string? Email, int Row)>();
        var errors = new List<CampaignRecipientError>();
        string? sourceReference = null;
        object? criteria = null;
        object? summary = null;
        var fields = source.EnumerateObject().Select(x => x.Name).ToArray();

        switch (type)
        {
            case "member":
                if (fields.Any(x => x is not ("member_id" or "member_ids")) || fields.Contains("member_id") && fields.Contains("member_ids")) return null;
                if (source.TryGetProperty("member_id", out var member)) candidates.Add((member.TryGetInt32(out var id) ? id : null, null, 1));
                else if (source.TryGetProperty("member_ids", out var members) && members.ValueKind == JsonValueKind.Array)
                    candidates.AddRange(members.EnumerateArray().Select((x, i) => ((int?)(x.TryGetInt32(out var id) ? id : null), (string?)null, i + 1)));
                else return null;
                break;
            case "email":
                if (fields.Length != 1 || fields[0] != "emails" || !source.TryGetProperty("emails", out var emails) || emails.ValueKind != JsonValueKind.Array) return null;
                candidates.AddRange(emails.EnumerateArray().Select((x, i) => ((int?)null, x.ValueKind == JsonValueKind.String ? x.GetString() : null, i + 1)));
                break;
            case "csv":
                if (fields.Length != 1 || fields[0] != "csv" || !source.TryGetProperty("csv", out var csv) || csv.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(csv.GetString()) || Encoding.UTF8.GetByteCount(csv.GetString()!) > 5_000_000) return null;
                var parsed = ParseCsvEmails(csv.GetString()!); candidates.AddRange(parsed.Candidates); errors.AddRange(parsed.Errors);
                break;
            case "group":
                if (fields.Length != 1 || fields[0] != "group_id" || !source.TryGetProperty("group_id", out var groupValue) || !groupValue.TryGetInt32(out var groupId) || !await CanManageGroupSourceAsync(tenantId, actorId, groupId, ct)) return null;
                sourceReference = $"group:{groupId}";
                var groupUsers = await db.GroupMembers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.GroupId == groupId && x.Status == "active").OrderBy(x => x.Id).Select(x => x.UserId).ToListAsync(ct);
                candidates.AddRange(groupUsers.Select((id, i) => ((int?)id, (string?)null, i + 1)));
                break;
            case "audience":
                var audience = await ExpandAudienceAsync(tenantId, actorId, source, ct); if (audience is null) return null;
                candidates.AddRange(audience.Value.Users.Select((id, i) => ((int?)id, (string?)null, i + 1)));
                criteria = audience.Value.Criteria; summary = audience.Value.Summary;
                sourceReference = "audience:" + Hash(JsonSerializer.Serialize(criteria))[..24];
                break;
            default: return null;
        }
        if (candidates.Count > 10000) return null;

        var requestedMemberIds = candidates.Where(x => x.User is > 0).Select(x => x.User!.Value).Distinct().ToArray();
        var validMembers = (await db.Users.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.IsActive && requestedMemberIds.Contains(x.Id)).Select(x => x.Id).ToListAsync(ct)).ToHashSet();
        var recipients = new List<CampaignRecipient>(); var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var candidate in candidates)
        {
            if (candidate.User is int memberId)
            {
                if (memberId <= 0 || !validMembers.Contains(memberId)) { errors.Add(new(candidate.Row, "member_not_found")); continue; }
                if (!seen.Add($"member:{memberId}")) { errors.Add(new(candidate.Row, "duplicate_target")); continue; }
                recipients.Add(new(memberId, null)); continue;
            }
            if (!MailAddress.TryCreate(candidate.Email, out var address)) { errors.Add(new(candidate.Row, "email_invalid")); continue; }
            var normalized = address.Address.Trim().ToLowerInvariant(); if (!seen.Add("email:" + Hash(normalized))) { errors.Add(new(candidate.Row, "duplicate_target")); continue; }
            recipients.Add(new(null, normalized));
        }
        for (var index = recipients.Count - 1; index >= 0; index--)
        {
            if (await IsCampaignRecipientAllowedAsync(tenantId, eventId, actorId, recipients[index], ct)) continue;
            errors.Add(new(index + 1, "target_ineligible")); recipients.RemoveAt(index);
        }
        var previewCount = candidates.Count + errors.Count(x => x.code.StartsWith("csv_", StringComparison.Ordinal));
        var snapshot = new Dictionary<string, object?>
        {
            ["schema_version"] = 1, ["campaign_type"] = type,
            ["recipients"] = recipients.Select(x => new { type = x.User is null ? "email" : "member", member_id = x.User, email = x.Email }).ToArray(),
            ["errors"] = errors, ["preview_count"] = previewCount, ["source_reference"] = sourceReference
        };
        if (criteria is not null) snapshot["criteria"] = criteria;
        return new(recipients, errors, previewCount, snapshot, summary);
    }

    private async Task<List<(int? User, string? Email)>?> RestoreCampaignSnapshotAsync(int tenantId, int actorId, string expectedType, string clear, CancellationToken ct)
    {
        try
        {
            using var document = JsonDocument.Parse(clear); var root = document.RootElement;
            if (root.GetProperty("schema_version").GetInt32() != 1 || root.GetProperty("campaign_type").GetString() != expectedType || root.GetProperty("recipients").ValueKind != JsonValueKind.Array) return null;
            if (expectedType == "group")
            {
                var reference = root.GetProperty("source_reference").GetString();
                if (reference is null || !reference.StartsWith("group:", StringComparison.Ordinal) || !int.TryParse(reference[6..], out var groupId) || !await CanManageGroupSourceAsync(tenantId, actorId, groupId, ct)) return null;
            }
            if (expectedType == "audience" && root.TryGetProperty("criteria", out var criteria)
                && criteria.ValueKind == JsonValueKind.Object && criteria.TryGetProperty("group_ids", out var groupIds))
            {
                if (groupIds.ValueKind != JsonValueKind.Array) return null;
                foreach (var value in groupIds.EnumerateArray())
                    if (!value.TryGetInt32(out var groupId) || !await CanManageGroupSourceAsync(tenantId, actorId, groupId, ct)) return null;
            }
            var result = new List<(int? User, string? Email)>(); var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in root.GetProperty("recipients").EnumerateArray())
            {
                var targetType = row.GetProperty("type").GetString();
                if (targetType == "member" && row.GetProperty("member_id").TryGetInt32(out var memberId) && memberId > 0 && seen.Add($"member:{memberId}")) result.Add((memberId, null));
                else if (targetType == "email" && MailAddress.TryCreate(row.GetProperty("email").GetString(), out var address) && seen.Add("email:" + Hash(address.Address.ToLowerInvariant()))) result.Add((null, address.Address.ToLowerInvariant()));
                else return null;
            }
            if (result.Count > 10000) return null;
            var memberIds = result.Where(x => x.User is not null).Select(x => x.User!.Value).ToArray();
            var activeCount = await db.Users.IgnoreQueryFilters().AsNoTracking().CountAsync(x => x.TenantId == tenantId && x.IsActive && memberIds.Contains(x.Id), ct);
            return activeCount == memberIds.Length ? result : null;
        }
        catch { return null; }
    }

    private async Task<(List<int> Users, object Criteria, object Summary)?> ExpandAudienceAsync(int tenantId, int actorId, JsonElement source, CancellationToken ct)
    {
        var fields = source.EnumerateObject().Select(x => x.Name).ToArray();
        if (fields.SequenceEqual(["member_ids"]) && source.GetProperty("member_ids").ValueKind == JsonValueKind.Array)
        {
            var ids = source.GetProperty("member_ids").EnumerateArray().Where(x => x.TryGetInt32(out _)).Select(x => x.GetInt32()).ToList();
            return (ids, new { member_ids = ids }, new { kind = "explicit_selection", selected_count = ids.Count });
        }
        if (!fields.SequenceEqual(["criteria"]) || source.GetProperty("criteria").ValueKind != JsonValueKind.Object) return null;
        var raw = source.GetProperty("criteria"); var allowed = new HashSet<string>(["all_active", "approved", "exclude_member_ids", "group_ids", "group_match", "has_email", "joined_after", "joined_before", "preferred_languages", "roles"], StringComparer.Ordinal);
        if (!raw.EnumerateObject().Any() || raw.EnumerateObject().Any(x => !allowed.Contains(x.Name))) return null;
        IQueryable<Nexus.Api.Entities.User> query = db.Users.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.IsActive);
        var used = new List<string>();
        if (raw.TryGetProperty("all_active", out var all) && all.ValueKind != JsonValueKind.True) return null; else if (raw.TryGetProperty("all_active", out _)) used.Add("all_active");
        if (raw.TryGetProperty("approved", out var approved)) { if (approved.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null; query = query.Where(x => x.IsApproved == approved.GetBoolean()); used.Add("approved"); }
        if (raw.TryGetProperty("has_email", out var hasEmail)) { if (hasEmail.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null; query = hasEmail.GetBoolean() ? query.Where(x => x.Email != "") : query.Where(x => x.Email == ""); used.Add("has_email"); }
        if (raw.TryGetProperty("roles", out var roles)) { if (roles.ValueKind != JsonValueKind.Array) return null; var values = roles.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).Distinct().ToArray(); if (values.Length == 0 || values.Length > 20) return null; query = query.Where(x => values.Contains(x.Role)); used.Add("roles"); }
        if (raw.TryGetProperty("preferred_languages", out var languages))
        {
            if (languages.ValueKind != JsonValueKind.Array) return null;
            var languageElements = languages.EnumerateArray().ToArray();
            if (languageElements.Length == 0 || languageElements.Length > 11 || languageElements.Any(x => x.ValueKind != JsonValueKind.String)) return null;
            var values = languageElements.Select(x => x.GetString()!.Trim()).ToArray();
            if (values.Any(x => x.Length != 2 || x.Any(c => c is < 'a' or > 'z') || GuestLocale(x) != x)) return null;
            values = values.Distinct(StringComparer.Ordinal).ToArray();
            query = query.Where(x => values.Contains(x.PreferredLanguage)); used.Add("preferred_languages");
        }
        DateOnly? joinedAfter = null; DateOnly? joinedBefore = null;
        if (raw.TryGetProperty("joined_after", out var after))
        {
            if (after.ValueKind != JsonValueKind.String || !DateOnly.TryParseExact(after.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)) return null;
            joinedAfter = parsed; var boundary = parsed.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc); query = query.Where(x => x.CreatedAt >= boundary); used.Add("joined_after");
        }
        if (raw.TryGetProperty("joined_before", out var before))
        {
            if (before.ValueKind != JsonValueKind.String || !DateOnly.TryParseExact(before.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)) return null;
            joinedBefore = parsed; var exclusiveBoundary = parsed.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc); query = query.Where(x => x.CreatedAt < exclusiveBoundary); used.Add("joined_before");
        }
        if (joinedAfter.HasValue && joinedBefore.HasValue && joinedAfter > joinedBefore) return null;
        if (raw.TryGetProperty("group_ids", out var groups))
        {
            if (groups.ValueKind != JsonValueKind.Array) return null; var ids = groups.EnumerateArray().Where(x => x.TryGetInt32(out _)).Select(x => x.GetInt32()).Distinct().ToArray(); if (ids.Length == 0 || ids.Length > 25) return null; foreach (var id in ids) if (!await CanManageGroupSourceAsync(tenantId, actorId, id, ct)) return null;
            var match = raw.TryGetProperty("group_match", out var matchValue) ? matchValue.GetString() : "any"; if (match is not ("any" or "all")) return null;
            var membership = await db.GroupMembers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.Status == "active" && ids.Contains(x.GroupId)).Select(x => new { x.UserId, x.GroupId }).ToListAsync(ct);
            var matched = match == "all" ? membership.GroupBy(x => x.UserId).Where(x => x.Select(y => y.GroupId).Distinct().Count() == ids.Length).Select(x => x.Key).ToArray() : membership.Select(x => x.UserId).Distinct().ToArray(); query = query.Where(x => matched.Contains(x.Id)); used.Add("group_ids"); used.Add("group_match");
        }
        else if (raw.TryGetProperty("group_match", out _)) return null;
        if (raw.TryGetProperty("exclude_member_ids", out var excluded)) { if (excluded.ValueKind != JsonValueKind.Array) return null; var ids = excluded.EnumerateArray().Where(x => x.TryGetInt32(out _)).Select(x => x.GetInt32()).Distinct().ToArray(); if (ids.Length == 0 || ids.Length > 1000) return null; query = query.Where(x => !ids.Contains(x.Id)); used.Add("exclude_member_ids"); }
        var users = await query.OrderBy(x => x.Id).Select(x => x.Id).Take(10001).ToListAsync(ct); if (users.Count > 10000) return null;
        var criteria = JsonSerializer.Deserialize<object>(raw.GetRawText())!; return (users, criteria, new { kind = "criteria", criteria = used, matched_count = users.Count });
    }

    private async Task<bool> CanManageGroupSourceAsync(int tenantId, int actorId, int groupId, CancellationToken ct)
    {
        var group = await db.Groups.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId && x.IsActive && x.Status == "active", ct); if (group is null) return false;
        return group.CreatedById == actorId || await db.GroupMembers.IgnoreQueryFilters().AsNoTracking().AnyAsync(x => x.TenantId == tenantId && x.GroupId == groupId && x.UserId == actorId && x.Status == "active" && (x.Role == "owner" || x.Role == "admin"), ct);
    }

    private async Task<bool> IsCampaignRecipientAllowedAsync(int tenantId, int eventId, int actorId, CampaignRecipient recipient, CancellationToken ct)
    {
        var evt = await db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
        if (evt is null) return false;
        var decision = await recipientAuthorizer.EvaluateAsync(tenantId, evt, actorId, recipient.User, recipient.Email, ct);
        return decision.IsAllowed;
    }

    private static (List<(int? User, string? Email, int Row)> Candidates, List<CampaignRecipientError> Errors) ParseCsvEmails(string csv)
    {
        var rows = ParseCsv(csv); if (rows.Count == 0) return ([], [new(1, "csv_header_missing")]);
        var header = rows[0].Select(x => x.Trim().ToLowerInvariant()).ToArray(); var index = Array.IndexOf(header, "email"); if (index < 0) return ([], [new(1, "csv_email_column_missing")]);
        var candidates = new List<(int?, string?, int)>(); for (var i = 1; i < rows.Count; i++) if (rows[i].Any(x => x.Length > 0)) candidates.Add((null, index < rows[i].Count ? rows[i][index] : null, i + 1)); return (candidates, []);
    }

    private static List<List<string>> ParseCsv(string value)
    {
        var rows = new List<List<string>>(); var row = new List<string>(); var field = new StringBuilder(); var quoted = false;
        for (var i = 0; i < value.Length; i++) { var c = value[i]; if (c == '"') { if (quoted && i + 1 < value.Length && value[i + 1] == '"') { field.Append('"'); i++; } else quoted = !quoted; } else if (c == ',' && !quoted) { row.Add(field.ToString()); field.Clear(); } else if ((c == '\r' || c == '\n') && !quoted) { if (c == '\r' && i + 1 < value.Length && value[i + 1] == '\n') i++; row.Add(field.ToString()); field.Clear(); rows.Add(row); row = []; } else field.Append(c); }
        if (field.Length > 0 || row.Count > 0) { row.Add(field.ToString()); rows.Add(row); } return rows;
    }
}
