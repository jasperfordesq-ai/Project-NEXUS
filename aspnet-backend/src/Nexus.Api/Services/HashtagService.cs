// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

using System.Text.RegularExpressions;

/// <summary>
/// Service for managing hashtags across the platform.
/// Extracts hashtags from content, tracks usage, and provides trending/search functionality.
/// </summary>
public class HashtagService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<HashtagService> _logger;

    private static readonly Regex HashtagRegex = new(@"#([A-Za-z0-9_]{2,50})", RegexOptions.Compiled);

    public HashtagService(NexusDbContext db, ILogger<HashtagService> logger)
    {
        _db = db;
        _logger = logger;
    }

    // --- DTOs ---

    public class TrendingHashtag
    {
        public string Tag { get; set; } = string.Empty;
        public int UsageCount { get; set; }
        public int TrendScore { get; set; }
    }

    public class HashtagContentItem
    {
        public int Id { get; set; }
        public string TargetType { get; set; } = string.Empty;
        public int TargetId { get; set; }
        public string? Title { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    /// <summary>
    /// Extract #hashtags from content, create or update Hashtag records,
    /// create HashtagUsage links, and increment UsageCount.
    /// </summary>
    public async Task<(List<Hashtag> Hashtags, string? Error)> ExtractAndLinkHashtagsAsync(
        int tenantId, int userId, string targetType, int targetId, string content)
    {
        if (string.IsNullOrWhiteSpace(content))
            return (new List<Hashtag>(), null);

        var matches = HashtagRegex.Matches(content);
        if (matches.Count == 0)
            return (new List<Hashtag>(), null);

        var tags = matches
            .Select(m => m.Groups[1].Value.ToLowerInvariant())
            .Distinct()
            .ToList();

        var result = new List<Hashtag>();

        foreach (var tag in tags)
        {
            var hashtag = await _db.Set<Hashtag>()
                .FirstOrDefaultAsync(h => h.Tag == tag);

            if (hashtag == null)
            {
                hashtag = new Hashtag
                {
                    TenantId = tenantId,
                    Tag = tag,
                    UsageCount = 0,
                    CreatedAt = DateTime.UtcNow,
                    LastUsedAt = DateTime.UtcNow
                };
                _db.Set<Hashtag>().Add(hashtag);
                await _db.SaveChangesAsync();
            }

            var existingUsage = await _db.Set<HashtagUsage>()
                .AnyAsync(u =>
                    u.HashtagId == hashtag.Id &&
                    u.TargetType == targetType &&
                    u.TargetId == targetId);

            if (!existingUsage)
            {
                _db.Set<HashtagUsage>().Add(new HashtagUsage
                {
                    TenantId = tenantId,
                    HashtagId = hashtag.Id,
                    TargetType = targetType.ToLowerInvariant(),
                    TargetId = targetId,
                    CreatedById = userId,
                    CreatedAt = DateTime.UtcNow
                });
                await _db.SaveChangesAsync();

                // Use atomic SQL increment to prevent race conditions on UsageCount
                await _db.Database.ExecuteSqlRawAsync(
                    "UPDATE \"Hashtags\" SET \"UsageCount\" = \"UsageCount\" + 1, \"LastUsedAt\" = {0} WHERE \"Id\" = {1}",
                    DateTime.UtcNow, hashtag.Id);

                // Detach to prevent EF from overwriting the atomically-updated values on the next SaveChanges
                _db.Entry(hashtag).State = Microsoft.EntityFrameworkCore.EntityState.Detached;
            }

            result.Add(hashtag);
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Linked {Count} hashtags to {TargetType}:{TargetId}",
            result.Count, targetType, targetId);

        return (result, null);
    }

    /// <summary>
    /// Remove all hashtag usages for a target and decrement counts.
    /// </summary>
    public async Task<(int Removed, string? Error)> RemoveHashtagsForTargetAsync(
        string targetType, int targetId)
    {
        var usages = await _db.Set<HashtagUsage>()
            .Where(u => u.TargetType == targetType && u.TargetId == targetId)
            .ToListAsync();

        if (usages.Count == 0)
            return (0, null);

        var hashtagIds = usages.Select(u => u.HashtagId).Distinct().ToList();
        var hashtags = await _db.Set<Hashtag>()
            .Where(h => hashtagIds.Contains(h.Id))
            .ToListAsync();

        foreach (var usage in usages)
        {
            var hashtag = hashtags.FirstOrDefault(h => h.Id == usage.HashtagId);
            if (hashtag != null && hashtag.UsageCount > 0)
                hashtag.UsageCount--;
        }

        _db.Set<HashtagUsage>().RemoveRange(usages);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Removed {Count} hashtag usages from {TargetType}:{TargetId}",
            usages.Count, targetType, targetId);

        return (usages.Count, null);
    }

    /// <summary>
    /// Get trending hashtags by usage count in the last N days.
    /// Returns TrendingHashtag objects with TrendScore (recent usage count).
    /// </summary>
    public async Task<List<TrendingHashtag>> GetTrendingAsync(int tenantId, int limit = 20, int days = 7)
    {
        var since = DateTime.UtcNow.AddDays(-days);

        var trending = await _db.Set<HashtagUsage>()
            .Where(u => u.CreatedAt >= since)
            .GroupBy(u => u.HashtagId)
            .Select(g => new { HashtagId = g.Key, RecentCount = g.Count() })
            .OrderByDescending(x => x.RecentCount)
            .Take(limit)
            .ToListAsync();

        if (trending.Count == 0)
            return new List<TrendingHashtag>();

        var hashtagIds = trending.Select(t => t.HashtagId).ToList();
        var hashtags = await _db.Set<Hashtag>()
            .Where(h => hashtagIds.Contains(h.Id))
            .ToListAsync();

        return trending
            .Select(t =>
            {
                var h = hashtags.FirstOrDefault(x => x.Id == t.HashtagId);
                return h == null ? null : new TrendingHashtag
                {
                    Tag = h.Tag,
                    UsageCount = h.UsageCount,
                    TrendScore = t.RecentCount
                };
            })
            .Where(x => x != null)
            .Cast<TrendingHashtag>()
            .ToList();
    }

    /// <summary>
    /// Search hashtags by tag prefix.
    /// </summary>
    public async Task<List<Hashtag>> SearchAsync(int tenantId, string query, int limit = 20)
    {
        if (string.IsNullOrWhiteSpace(query))
            return new List<Hashtag>();

        var term = query.TrimStart('#').ToLowerInvariant();

        return await _db.Set<Hashtag>()
            .Where(h => h.Tag.StartsWith(term))
            .OrderByDescending(h => h.UsageCount)
            .Take(limit)
            .ToListAsync();
    }

    /// <summary>
    /// Get a single hashtag with its usage count.
    /// </summary>
    public async Task<(Hashtag? Hashtag, string? Error)> GetByTagAsync(int tenantId, string tag)
    {
        if (string.IsNullOrWhiteSpace(tag))
            return (null, "Tag is required.");

        var normalised = tag.TrimStart('#').ToLowerInvariant();

        var hashtag = await _db.Set<Hashtag>()
            .FirstOrDefaultAsync(h => h.Tag == normalised);

        if (hashtag == null)
            return (null, "Hashtag not found.");

        return (hashtag, null);
    }

    /// <summary>
    /// Get all content items linked to a hashtag, optionally filtered by target type.
    /// Returns a 3-tuple: (items, total, error).
    /// </summary>
    public async Task<(List<HashtagContentItem>? Items, int Total, string? Error)> GetContentByTagAsync(
        int tenantId, string tag, string? targetType, int page = 1, int limit = 20)
    {
        var normalised = tag.TrimStart('#').ToLowerInvariant();

        var hashtag = await _db.Set<Hashtag>()
            .FirstOrDefaultAsync(h => h.Tag == normalised);

        if (hashtag == null)
            return (null, 0, "Hashtag not found.");

        var query = _db.Set<HashtagUsage>()
            .Where(u => u.HashtagId == hashtag.Id);

        if (!string.IsNullOrWhiteSpace(targetType))
            query = query.Where(u => u.TargetType == targetType.ToLowerInvariant());

        var total = await query.CountAsync();

        var usages = await query
            .OrderByDescending(u => u.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        var items = usages.Select(u => new HashtagContentItem
        {
            Id = u.Id,
            TargetType = u.TargetType,
            TargetId = u.TargetId,
            Title = null, // Content title would require joining to the target entity
            CreatedAt = u.CreatedAt
        }).ToList();

        return (items, total, null);
    }

    /// <summary>
    /// Search hashtags by tag prefix (original name preserved for compatibility).
    /// </summary>
    public async Task<List<Hashtag>> SearchHashtagsAsync(string query, int limit = 20)
    {
        if (string.IsNullOrWhiteSpace(query))
            return new List<Hashtag>();

        var term = query.TrimStart('#').ToLowerInvariant();

        return await _db.Set<Hashtag>()
            .Where(h => h.Tag.StartsWith(term))
            .OrderByDescending(h => h.UsageCount)
            .Take(limit)
            .ToListAsync();
    }

    /// <summary>
    /// Get a single hashtag (original name preserved for compatibility).
    /// </summary>
    public async Task<(Hashtag? Hashtag, string? Error)> GetHashtagAsync(string tag)
    {
        return await GetByTagAsync(0, tag);
    }

    /// <summary>
    /// Get content by hashtag (original name preserved for compatibility).
    /// </summary>
    public async Task<(List<HashtagUsage> Usages, int Total)> GetContentByHashtagAsync(
        string tag, string? targetType, int page = 1, int limit = 20)
    {
        var normalised = tag.TrimStart('#').ToLowerInvariant();

        var hashtag = await _db.Set<Hashtag>()
            .FirstOrDefaultAsync(h => h.Tag == normalised);

        if (hashtag == null)
            return (new List<HashtagUsage>(), 0);

        var query = _db.Set<HashtagUsage>()
            .Where(u => u.HashtagId == hashtag.Id);

        if (!string.IsNullOrWhiteSpace(targetType))
            query = query.Where(u => u.TargetType == targetType.ToLowerInvariant());

        var total = await query.CountAsync();

        var usages = await query
            .OrderByDescending(u => u.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (usages, total);
    }

    /// <summary>
    /// Get trending hashtags (original name preserved for compatibility).
    /// </summary>
    public async Task<List<Hashtag>> GetTrendingHashtagsAsync(int limit = 20, int days = 7)
    {
        var since = DateTime.UtcNow.AddDays(-days);

        var trendingIds = await _db.Set<HashtagUsage>()
            .Where(u => u.CreatedAt >= since)
            .GroupBy(u => u.HashtagId)
            .Select(g => new { HashtagId = g.Key, RecentCount = g.Count() })
            .OrderByDescending(x => x.RecentCount)
            .Take(limit)
            .Select(x => x.HashtagId)
            .ToListAsync();

        if (trendingIds.Count == 0)
            return new List<Hashtag>();

        var hashtags = await _db.Set<Hashtag>()
            .Where(h => trendingIds.Contains(h.Id))
            .ToListAsync();

        return trendingIds
            .Select(id => hashtags.FirstOrDefault(h => h.Id == id))
            .Where(h => h != null)
            .Cast<Hashtag>()
            .ToList();
    }
}
