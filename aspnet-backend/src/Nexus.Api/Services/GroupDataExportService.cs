// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record GroupExportError(string Code, string Message, int Status);
public sealed record GroupExportResult(object? Data, GroupExportError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed class GroupDataExportService
{
    public static readonly string[] ManifestSections = ["group", "settings", "members", "feed_posts", "discussions", "announcements", "events", "files", "tags", "custom_fields", "qa", "wiki", "media", "invitations", "webhooks", "challenges", "chat", "tasks", "scheduled_posts", "notification_preferences", "moderation", "approval_requests", "audit_log"];
    private readonly NexusDbContext _db;
    private readonly string _root;

    public GroupDataExportService(NexusDbContext db, IConfiguration configuration)
    {
        _db = db;
        _root = Path.GetFullPath(configuration["GroupExports:Root"] ?? Path.Combine(AppContext.BaseDirectory, "storage"));
    }

    public async Task<GroupExportResult> RequestAsync(int tenantId, int groupId, int userId, CancellationToken ct)
    {
        var access = await AuthorizeAsync(tenantId, groupId, userId, ct);
        if (access is not null) return access;
        await using var tx = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var lockKey = unchecked(((long)tenantId << 32) ^ ((long)groupId << 16) ^ (uint)userId);
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({lockKey})", ct);
        var cutoff = DateTime.UtcNow.AddMinutes(-10);
        var existing = await _db.GroupDataExports.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.GroupId == groupId && x.RequestedByUserId == userId &&
                        (x.Status == "queued" || x.Status == "processing") && x.CreatedAt >= cutoff)
            .OrderByDescending(x => x.CreatedAt).FirstOrDefaultAsync(ct);
        if (existing is not null) return new(Serialize(existing));
        var now = DateTime.UtcNow;
        var row = new GroupDataExport { Id = Guid.NewGuid(), TenantId = tenantId, GroupId = groupId, RequestedByUserId = userId, ExpiresAt = now.AddDays(1), CreatedAt = now, UpdatedAt = now };
        _db.GroupDataExports.Add(row);
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(Serialize(row));
    }

    public async Task<GroupExportResult> GetAsync(int tenantId, int groupId, int userId, Guid exportId, CancellationToken ct)
    {
        var access = await AuthorizeAsync(tenantId, groupId, userId, ct);
        if (access is not null) return access;
        var row = await _db.GroupDataExports.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.Id == exportId && x.TenantId == tenantId && x.GroupId == groupId && x.RequestedByUserId == userId, ct);
        return row is null ? Missing() : new(Serialize(row));
    }

    public async Task<(GroupDataExport? Export, GroupExportError? Error)> GetDownloadAsync(int tenantId, int groupId, int userId, Guid exportId, CancellationToken ct)
    {
        var access = await AuthorizeAsync(tenantId, groupId, userId, ct);
        if (access is not null) return (null, access.Error);
        var row = await _db.GroupDataExports.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.Id == exportId && x.TenantId == tenantId && x.GroupId == groupId && x.RequestedByUserId == userId, ct);
        if (row is null) return (null, Missing().Error);
        if (row.Status != "completed" || row.ExpiresAt <= DateTime.UtcNow)
        {
            await ExpireAsync(row, ct);
            return (null, Missing().Error);
        }
        return SafeAbsolutePath(row) is null || !File.Exists(SafeAbsolutePath(row)) ? (null, Missing().Error) : (row, null);
    }

    public async Task<bool> GenerateAsync(Guid exportId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var stale = now.AddMinutes(-10);
        var claimed = await _db.GroupDataExports.IgnoreQueryFilters()
            .Where(x => x.Id == exportId && x.ExpiresAt > now &&
                        (x.Status == "queued" || x.Status == "processing" && x.ProcessingStartedAt < stale))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.Status, "processing")
                .SetProperty(x => x.Attempts, x => (short)(x.Attempts + 1))
                .SetProperty(x => x.ProcessingStartedAt, now)
                .SetProperty(x => x.UpdatedAt, now), ct);
        if (claimed != 1)
        {
            var unclaimed = await _db.GroupDataExports.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.Id == exportId, ct);
            if (unclaimed is not null && unclaimed.ExpiresAt <= now) await ExpireAsync(unclaimed, ct);
            return false;
        }
        var row = await _db.GroupDataExports.IgnoreQueryFilters().SingleAsync(x => x.Id == exportId, ct);
        try
        {
            if (await AuthorizeAsync(row.TenantId, row.GroupId, row.RequestedByUserId, ct) is not null) throw new InvalidOperationException("ACCESS_REVOKED");
            var payload = await BuildPayloadAsync(row, ct);
            var relative = $"groups/{row.TenantId}/{row.GroupId}/exports/{row.Id:D}.json";
            row.StoragePath = relative;
            var absolute = SafeAbsolutePath(row) ?? throw new InvalidOperationException("INVALID_EXPORT_PATH");
            Directory.CreateDirectory(Path.GetDirectoryName(absolute)!);
            await using (var stream = new FileStream(absolute, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true))
                await JsonSerializer.SerializeAsync(stream, payload, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }, ct);
            row.ByteSize = new FileInfo(absolute).Length; row.Status = "completed"; row.CompletedAt = DateTime.UtcNow; row.ProcessingStartedAt = null; row.ErrorCode = null; row.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var path = SafeAbsolutePath(row); if (path is not null && File.Exists(path)) File.Delete(path);
            row.StoragePath = null; row.ByteSize = null; row.ProcessingStartedAt = null; row.ErrorCode = ex.Message.Length <= 100 ? ex.Message : ex.GetType().Name;
            row.Status = row.Attempts >= 3 ? "failed" : "queued"; row.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return false;
        }
    }

    public string? SafeAbsolutePath(GroupDataExport row)
    {
        var expected = $"groups/{row.TenantId}/{row.GroupId}/exports/";
        var relative = row.StoragePath?.Replace('\\', '/');
        if (relative is null || !relative.StartsWith(expected, StringComparison.Ordinal) || Path.IsPathRooted(relative)) return null;
        var absolute = Path.GetFullPath(Path.Combine(_root, relative.Replace('/', Path.DirectorySeparatorChar)));
        return absolute.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? absolute : null;
    }

    private async Task<object> BuildPayloadAsync(GroupDataExport row, CancellationToken ct)
    {
        var group = await _db.Groups.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.TenantId == row.TenantId && x.Id == row.GroupId, ct);
        var members = await _db.GroupMembers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId)
            .Join(_db.Users.IgnoreQueryFilters(), m => new { m.TenantId, Id = m.UserId }, u => new { u.TenantId, u.Id }, (m, u) => new { u.Id, name = u.FirstName + " " + u.LastName, u.Email, m.Role, m.Status, joined_at = m.JoinedAt }).ToListAsync(ct);
        var discussions = await _db.GroupDiscussions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct);
        var questions = await _db.GroupQuestions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct);
        var questionIds = questions.Select(x => x.Id).ToList();
        var answers = await _db.GroupAnswers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && questionIds.Contains(x.QuestionId)).ToListAsync(ct);
        return new Dictionary<string, object?>
        {
            ["schema"] = new { name = "nexus.group-export", version = 1, sections = ManifestSections }, ["export_date"] = DateTime.UtcNow,
            ["group"] = group, ["settings"] = await _db.GroupPolicies.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct),
            ["members"] = members, ["feed_posts"] = await _db.FeedPosts.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct), ["discussions"] = discussions,
            ["announcements"] = await _db.GroupAnnouncements.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct),
            ["events"] = await _db.Events.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct),
            ["files"] = await _db.GroupFiles.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).Select(x => new { x.Id, x.FileName, file_type = x.ContentType, file_size = x.FileSizeBytes, x.CreatedAt }).ToListAsync(ct),
            ["tags"] = Array.Empty<object>(), ["custom_fields"] = await _db.GroupCustomFields.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct),
            ["qa"] = new { questions, answers }, ["wiki"] = await _db.GroupWikiPages.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct),
            ["media"] = await _db.GroupMediaItems.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).Select(x => new { x.Id, x.MediaType, x.Caption, x.CreatedAt }).ToListAsync(ct),
            ["invitations"] = await _db.GroupInvites.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).Select(x => new { x.Id, x.InviteType, x.Email, x.Status, x.ExpiresAt, x.CreatedAt }).ToListAsync(ct),
            ["webhooks"] = await _db.GroupWebhooks.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).Select(x => new { x.Id, x.Url, x.Events, x.IsActive, x.CreatedAt }).ToListAsync(ct),
            ["challenges"] = await _db.GroupChallenges.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct),
            ["chat"] = Array.Empty<object>(), ["tasks"] = Array.Empty<object>(), ["scheduled_posts"] = await _db.GroupScheduledPosts.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct),
            ["notification_preferences"] = await _db.GroupNotificationPreferences.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.GroupId == row.GroupId).ToListAsync(ct),
            ["moderation"] = Array.Empty<object>(), ["approval_requests"] = Array.Empty<object>(), ["audit_log"] = Array.Empty<object>()
        };
    }

    private async Task<GroupExportResult?> AuthorizeAsync(int tenantId, int groupId, int userId, CancellationToken ct)
    {
        var group = await _db.Groups.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId, ct);
        if (group is null) return Missing();
        var user = await _db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == userId, ct);
        var manages = group.CreatedById == userId || await _db.GroupMembers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenantId && x.GroupId == groupId && x.UserId == userId && x.Status == "active" && (x.Role == "owner" || x.Role == "admin"), ct);
        if (!manages && user is not { IsAdmin: true } && user is not { IsSuperAdmin: true } && user is not { IsTenantSuperAdmin: true } && user is not { IsGod: true })
            return new(null, new("FORBIDDEN", "Group export is forbidden", 403));
        return null;
    }

    private async Task ExpireAsync(GroupDataExport row, CancellationToken ct)
    {
        var path = SafeAbsolutePath(row); if (path is not null && File.Exists(path)) File.Delete(path);
        row.Status = "expired"; row.StoragePath = null; row.ByteSize = null; row.ProcessingStartedAt = null; row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }
    public static object Serialize(GroupDataExport row) => new { id = row.Id, status = row.Status, byte_size = row.ByteSize, created_at = row.CreatedAt, completed_at = row.CompletedAt, expires_at = row.ExpiresAt, download_url = row.Status == "completed" ? $"/api/v2/groups/{row.GroupId}/exports/{row.Id:D}/download" : null };
    private static GroupExportResult Missing() => new(null, new("NOT_FOUND", "Group not found", 404));
}
