// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Npgsql;

namespace Nexus.Api.Services;

public sealed record EventLifecycleHistoryError(string Code, string Message, int Status, string? Field = null);
public sealed record EventLifecycleHistoryResult(object? Data, object? Meta = null, EventLifecycleHistoryError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed class EventLifecycleHistoryQueryService(NexusDbContext db)
{
    public async Task<EventLifecycleHistoryResult> IndexAsync(
        int tenantId, int eventId, int actorId, string? cursor, int perPage, CancellationToken ct)
    {
        var evt = await db.Events.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
        if (evt is null) return Error("EVENT_LIFECYCLE_HISTORY_NOT_FOUND", "Event not found", 404);
        var actor = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == actorId && x.IsActive, ct);
        if (actor is null || !await CanManageAsync(tenantId, evt, actor, ct))
            return Error("EVENT_LIFECYCLE_HISTORY_FORBIDDEN", "Forbidden", 403);
        if (perPage is < 1 or > 100)
            return Error("EVENT_LIFECYCLE_HISTORY_VALIDATION_FAILED", "Validation failed", 422, "per_page");

        long? cursorId = null;
        if (cursor is not null)
        {
            if (!TryDecodeCursor(cursor, eventId, out var decoded))
                return Error("EVENT_LIFECYCLE_HISTORY_VALIDATION_FAILED", "Validation failed", 422, "cursor");
            cursorId = decoded;
        }

        try
        {
            var query = db.EventStatusHistories.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.EventId == eventId);
            if (cursorId is long before) query = query.Where(x => x.Id < before);
            var rows = await query.OrderByDescending(x => x.Id).Take(perPage + 1).ToListAsync(ct);
            var hasMore = rows.Count > perPage;
            if (hasMore) rows.RemoveAt(rows.Count - 1);
            var actorIds = rows.Select(x => x.ActorUserId).Distinct().ToArray();
            var actors = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && actorIds.Contains(x.Id))
                .ToDictionaryAsync(x => x.Id, ct);
            var items = rows.Select(x => Project(x, actors.GetValueOrDefault(x.ActorUserId))).ToArray();
            var next = hasMore && rows.Count > 0 ? EncodeCursor(eventId, rows[^1].Id) : null;
            return new(items, new { per_page = perPage, next_cursor = next, has_more = hasMore });
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UndefinedTable)
        {
            return Error("EVENT_LIFECYCLE_HISTORY_UNAVAILABLE", "Service unavailable", 503);
        }
    }

    internal static string EncodeCursor(int eventId, long historyId)
    {
        if (eventId <= 0 || historyId <= 0) throw new ArgumentOutOfRangeException();
        var json = JsonSerializer.Serialize(new { v = 1, event_id = eventId, history_id = historyId });
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(json)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    internal static bool TryDecodeCursor(string cursor, int eventId, out long historyId)
    {
        historyId = 0;
        cursor = cursor.Trim();
        if (eventId <= 0 || cursor.Length is 0 or > 256 || cursor.Any(x => !char.IsAsciiLetterOrDigit(x) && x is not '-' and not '_')) return false;
        try
        {
            var base64 = cursor.Replace('-', '+').Replace('_', '/');
            base64 += new string('=', (4 - base64.Length % 4) % 4);
            using var document = JsonDocument.Parse(Convert.FromBase64String(base64), new JsonDocumentOptions { MaxDepth = 8 });
            if (document.RootElement.ValueKind != JsonValueKind.Object) return false;
            var properties = document.RootElement.EnumerateObject().ToArray();
            if (properties.Length != 3
                || properties[0].Name != "v" || properties[1].Name != "event_id" || properties[2].Name != "history_id"
                || !properties[0].Value.TryGetInt32(out var version) || version != 1
                || !properties[1].Value.TryGetInt32(out var boundEvent) || boundEvent != eventId
                || !properties[2].Value.TryGetInt64(out historyId) || historyId <= 0
                || EncodeCursor(eventId, historyId) != cursor)
            {
                historyId = 0;
                return false;
            }
            return true;
        }
        catch (Exception exception) when (exception is FormatException or JsonException or ArgumentException or InvalidOperationException)
        {
            historyId = 0;
            return false;
        }
    }

    private async Task<bool> CanManageAsync(int tenantId, Event evt, User actor, CancellationToken ct)
    {
        var admin = IsAdmin(actor);
        if (evt.GroupId is int groupId)
        {
            var group = await db.Groups.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId, ct);
            if (group is null || !group.IsActive || group.Status != "active") return false;
            if (!admin && group.CreatedById != actor.Id && !await db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(x => x.TenantId == tenantId && x.GroupId == groupId && x.UserId == actor.Id && x.Status == "active", ct))
                return false;
        }
        if (admin || evt.CreatedById == actor.Id) return true;
        return await db.EventStaffAssignments.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
            x.TenantId == tenantId && x.EventId == evt.Id && x.UserId == actor.Id && x.Role == "co_organizer"
            && x.Status == "active" && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow), ct);
    }

    private static object Project(EventStatusHistory row, User? actor)
    {
        var axes = new List<string>();
        var cascade = new Dictionary<string, int>();
        object? series = null;
        var notificationsSuppressed = false;
        try
        {
            using var metadata = JsonDocument.Parse(row.Metadata);
            if (metadata.RootElement.TryGetProperty("axes_changed", out var rawAxes) && rawAxes.ValueKind == JsonValueKind.Array)
                axes.AddRange(rawAxes.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                    .Select(x => x.GetString()).Where(x => x is "publication" or "operational")!);
            if (metadata.RootElement.TryGetProperty("cascade", out var rawCascade) && rawCascade.ValueKind == JsonValueKind.Object)
                foreach (var key in new[] { "reminders_cancelled", "waitlist_cancelled", "registrations_cancelled" })
                    if (rawCascade.TryGetProperty(key, out var value) && value.TryGetInt32(out var count)) cascade[key] = Math.Max(0, count);
            if (metadata.RootElement.TryGetProperty("series", out var rawSeries) && rawSeries.ValueKind == JsonValueKind.Object
                && rawSeries.TryGetProperty("root_event_id", out var root) && root.TryGetInt32(out var rootId) && rootId > 0
                && rawSeries.TryGetProperty("member_type", out var member) && member.GetString() is "template" or "occurrence")
                series = new { root_event_id = rootId, member_type = member.GetString() };
            notificationsSuppressed = metadata.RootElement.TryGetProperty("notifications_suppressed", out var suppressed) && suppressed.ValueKind == JsonValueKind.True;
        }
        catch (JsonException) { }

        return new
        {
            id = row.Id, lifecycle_version = row.LifecycleVersion,
            publication = new { from = row.FromPublicationStatus, to = row.ToPublicationStatus },
            operational = new { from = row.FromOperationalStatus, to = row.ToOperationalStatus },
            reason = string.IsNullOrWhiteSpace(row.Reason) ? null : row.Reason,
            actor = new { id = row.ActorUserId, display_name = Name(actor) },
            evidence = new { axes_changed = axes, cascade, series, notifications_suppressed = notificationsSuppressed },
            created_at = row.CreatedAt.ToUniversalTime().ToString("O"), immutable = true
        };
    }

    private static EventLifecycleHistoryResult Error(string code, string message, int status, string? field = null)
        => new(null, Error: new(code, message, status, field));
    private static bool IsAdmin(User user) => user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod
        || user.Role is "admin" or "super_admin" or "tenant_admin" or "god";
    private static string? Name(User? user) => user is null ? null : string.IsNullOrWhiteSpace($"{user.FirstName} {user.LastName}".Trim()) ? null : $"{user.FirstName} {user.LastName}".Trim();
}
