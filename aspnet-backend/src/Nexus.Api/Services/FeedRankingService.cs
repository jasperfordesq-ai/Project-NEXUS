// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Feed ranking algorithm that scores posts based on recency, engagement,
/// connection proximity, group relevance, and author activity.
/// </summary>
public class FeedRankingService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<FeedRankingService> _logger;

    /// <summary>
    /// Half-life for recency decay in hours. Posts lose half their recency score
    /// every 6 hours.
    /// </summary>
    private const double RecencyHalfLifeHours = 6.0;

    /// <summary>
    /// Weight multipliers for engagement signals.
    /// </summary>
    private const double LikeWeight = 1.0;
    private const double CommentWeight = 2.0;
    private const double ShareWeight = 3.0;

    /// <summary>
    /// Bonus multipliers for relationship signals.
    /// </summary>
    private const double ConnectionBonus = 1.5;
    private const double GroupBonus = 1.3;
    private const double ActiveAuthorBonus = 1.1;

    /// <summary>
    /// Number of days to look back when checking author activity.
    /// </summary>
    private const int AuthorActivityDays = 7;

    /// <summary>
    /// Minimum number of posts in the activity window to qualify as "active".
    /// </summary>
    private const int ActiveAuthorMinPosts = 3;

    public FeedRankingService(NexusDbContext db, ILogger<FeedRankingService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Get a ranked feed for the given user. Posts are scored and sorted by relevance
    /// rather than simple chronological order. Pinned posts always appear first.
    /// </summary>
    public async Task<RankedFeedResult> GetRankedFeedAsync(int userId, int page = 1, int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var now = DateTime.UtcNow;

        // Pre-fetch the user's connection IDs for proximity scoring
        var connectionIds = await _db.Connections
            .Where(c => (c.RequesterId == userId || c.AddresseeId == userId)
                        && c.Status == Connection.Statuses.Accepted)
            .Select(c => c.RequesterId == userId ? c.AddresseeId : c.RequesterId)
            .ToListAsync();

        var connectionIdSet = new HashSet<int>(connectionIds);

        // Pre-fetch the user's group IDs for group relevance
        var userGroupIds = await _db.GroupMembers
            .Where(gm => gm.UserId == userId)
            .Select(gm => gm.GroupId)
            .ToListAsync();

        var groupIdSet = new HashSet<int>(userGroupIds);

        // Pre-fetch active author IDs (users with >= N posts in the last week)
        var activityCutoff = now.AddDays(-AuthorActivityDays);
        var activeAuthorIds = await _db.FeedPosts
            .Where(p => p.CreatedAt >= activityCutoff)
            .GroupBy(p => p.UserId)
            .Where(g => g.Count() >= ActiveAuthorMinPosts)
            .Select(g => g.Key)
            .ToListAsync();

        var activeAuthorIdSet = new HashSet<int>(activeAuthorIds);

        // Load recent posts with engagement data (limit to 14-day window to avoid
        // loading the entire table into memory — older posts score near-zero anyway
        // due to recency decay with a 6-hour half-life)
        var feedCutoff = now.AddDays(-14);

        // Pre-fetch share counts per post (since PostShares may not be in DbContext yet,
        // we query them separately). We handle the case where the DbSet doesn't exist.
        var shareCountsByPost = new Dictionary<int, int>();
        try
        {
            shareCountsByPost = await _db.Set<PostShare>()
                .Where(s => s.CreatedAt >= feedCutoff)
                .GroupBy(s => s.PostId)
                .ToDictionaryAsync(g => g.Key, g => g.Count());
        }
        catch (DbUpdateException ex)
        {
            // PostShares table may not exist yet if migration hasn't run
            _logger.LogWarning(ex, "PostShare table not available, share counts will be zero");
        }
        catch (InvalidOperationException ex)
        {
            // PostShares table may not exist yet if migration hasn't run
            _logger.LogWarning(ex, "PostShare table not available, share counts will be zero");
        }
        catch (System.Data.Common.DbException ex)
        {
            // PostShares table may not exist yet if migration hasn't run
            _logger.LogWarning(ex, "PostShare table not available, share counts will be zero");
        }

        // Project counts server-side instead of loading full Like/Comment collections
        var allPostData = await _db.FeedPosts
            .Include(p => p.User)
            .Include(p => p.Group)
            .Where(p => p.CreatedAt >= feedCutoff)
            .OrderByDescending(p => p.CreatedAt)
            .Take(500)
            .Select(p => new
            {
                Post = p,
                LikeCount = p.Likes.Count,
                CommentCount = p.Comments.Count,
                IsLiked = p.Likes.Any(l => l.UserId == userId)
            })
            .ToListAsync();

        // Score each post
        var scoredPosts = new List<ScoredPost>();

        foreach (var item in allPostData)
        {
            shareCountsByPost.TryGetValue(item.Post.Id, out var shareCount);

            // 1. Recency score (exponential decay)
            var ageHours = (now - item.Post.CreatedAt).TotalHours;
            var recencyScore = Math.Pow(0.5, ageHours / RecencyHalfLifeHours);

            // 2. Engagement score
            var engagementScore = (item.LikeCount * LikeWeight)
                                + (item.CommentCount * CommentWeight)
                                + (shareCount * ShareWeight);

            // 3. Connection proximity multiplier
            var connectionMultiplier = connectionIdSet.Contains(item.Post.UserId) ? ConnectionBonus : 1.0;

            // 4. Group relevance multiplier
            var groupMultiplier = item.Post.GroupId.HasValue && groupIdSet.Contains(item.Post.GroupId.Value)
                ? GroupBonus
                : 1.0;

            // 5. Author activity multiplier
            var authorMultiplier = activeAuthorIdSet.Contains(item.Post.UserId) ? ActiveAuthorBonus : 1.0;

            // Combined score
            var totalScore = (recencyScore * 10.0 + engagementScore)
                           * connectionMultiplier
                           * groupMultiplier
                           * authorMultiplier;

            scoredPosts.Add(new ScoredPost
            {
                Post = item.Post,
                Score = totalScore,
                LikeCount = item.LikeCount,
                CommentCount = item.CommentCount,
                ShareCount = shareCount,
                IsLiked = item.IsLiked
            });
        }

        // Sort: pinned first, then by score descending
        var sorted = scoredPosts
            .OrderByDescending(sp => sp.Post.IsPinned)
            .ThenByDescending(sp => sp.Score)
            .ToList();

        var total = sorted.Count;
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var paged = sorted
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToList();

        return new RankedFeedResult
        {
            Posts = paged,
            Page = page,
            Limit = limit,
            Total = total,
            TotalPages = totalPages
        };
    }

    /// <summary>
    /// Get trending posts by engagement velocity (highest engagement in the given time window).
    /// </summary>
    public async Task<List<TrendingPostResult>> GetTrendingPostsAsync(int hours = 24, int limit = 10)
    {
        if (hours < 1) hours = 1;
        if (hours > 168) hours = 168; // Max 1 week
        if (limit < 1) limit = 1;
        if (limit > 50) limit = 50;

        var cutoff = DateTime.UtcNow.AddHours(-hours);

        // Project counts server-side instead of loading full Like/Comment collections
        var recentPostData = await _db.FeedPosts
            .Where(p => p.CreatedAt >= cutoff)
            .Include(p => p.User)
            .Include(p => p.Group)
            .Select(p => new
            {
                Post = p,
                LikeCount = p.Likes.Count,
                CommentCount = p.Comments.Count
            })
            .ToListAsync();

        // Get share counts for these posts
        var postIds = recentPostData.Select(d => d.Post.Id).ToList();
        var shareCountsByPost = new Dictionary<int, int>();
        try
        {
            shareCountsByPost = await _db.Set<PostShare>()
                .Where(s => postIds.Contains(s.PostId))
                .GroupBy(s => s.PostId)
                .ToDictionaryAsync(g => g.Key, g => g.Count());
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "PostShare table not available for trending calculation");
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "PostShare table not available for trending calculation");
        }
        catch (System.Data.Common.DbException ex)
        {
            _logger.LogWarning(ex, "PostShare table not available for trending calculation");
        }

        var trending = recentPostData
            .Select(item =>
            {
                shareCountsByPost.TryGetValue(item.Post.Id, out var shareCount);
                var ageHours = Math.Max((DateTime.UtcNow - item.Post.CreatedAt).TotalHours, 0.1);
                var engagement = (item.LikeCount * LikeWeight)
                               + (item.CommentCount * CommentWeight)
                               + (shareCount * ShareWeight);

                // Velocity = engagement per hour
                var velocity = engagement / ageHours;

                return new TrendingPostResult
                {
                    Post = item.Post,
                    Velocity = velocity,
                    LikeCount = item.LikeCount,
                    CommentCount = item.CommentCount,
                    ShareCount = shareCount
                };
            })
            .OrderByDescending(t => t.Velocity)
            .Take(limit)
            .ToList();

        return trending;
    }

    /// <summary>
    /// Bookmark a post for the current user.
    /// </summary>
    public async Task<(bool Success, string? Error)> BookmarkPostAsync(int userId, int postId)
    {
        var postExists = await _db.FeedPosts.AnyAsync(p => p.Id == postId);
        if (!postExists)
            return (false, "Post not found");

        try
        {
            var existing = await _db.Set<FeedBookmark>()
                .FirstOrDefaultAsync(b => b.UserId == userId && b.PostId == postId);

            if (existing != null)
                return (false, "Post is already bookmarked");

            var bookmark = new FeedBookmark
            {
                UserId = userId,
                PostId = postId
            };

            _db.Set<FeedBookmark>().Add(bookmark);
            await _db.SaveChangesAsync();

            _logger.LogInformation("User {UserId} bookmarked post {PostId}", userId, postId);
            return (true, null);
        }
        catch (DbUpdateException)
        {
            // Unique constraint violation (race condition)
            return (false, "Post is already bookmarked");
        }
    }

    /// <summary>
    /// Remove a bookmark for the current user.
    /// </summary>
    public async Task<(bool Success, string? Error)> UnbookmarkPostAsync(int userId, int postId)
    {
        var bookmark = await _db.Set<FeedBookmark>()
            .FirstOrDefaultAsync(b => b.UserId == userId && b.PostId == postId);

        if (bookmark == null)
            return (false, "Bookmark not found");

        _db.Set<FeedBookmark>().Remove(bookmark);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} removed bookmark for post {PostId}", userId, postId);
        return (true, null);
    }

    /// <summary>
    /// Get bookmarked posts for the current user, paginated.
    /// </summary>
    public async Task<BookmarkListResult> GetBookmarksAsync(int userId, int page = 1, int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Set<FeedBookmark>()
            .Where(b => b.UserId == userId)
            .OrderByDescending(b => b.CreatedAt);

        var total = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var bookmarks = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .Include(b => b.Post)
                .ThenInclude(p => p!.User)
            .Include(b => b.Post)
                .ThenInclude(p => p!.Group)
            .Include(b => b.Post)
                .ThenInclude(p => p!.Likes)
            .Include(b => b.Post)
                .ThenInclude(p => p!.Comments)
            .ToListAsync();

        return new BookmarkListResult
        {
            Bookmarks = bookmarks,
            Page = page,
            Limit = limit,
            Total = total,
            TotalPages = totalPages
        };
    }

    /// <summary>
    /// Record a share of a post.
    /// </summary>
    public async Task<(bool Success, string? Error)> SharePostAsync(int userId, int postId, string? sharedTo)
    {
        var postExists = await _db.FeedPosts.AnyAsync(p => p.Id == postId);
        if (!postExists)
            return (false, "Post not found");

        // Validate sharedTo value if provided
        if (sharedTo != null && !PostShare.Channels.All.Contains(sharedTo))
        {
            return (false, $"Invalid share channel. Must be one of: {string.Join(", ", PostShare.Channels.All)}");
        }

        var share = new PostShare
        {
            UserId = userId,
            PostId = postId,
            SharedTo = sharedTo
        };

        _db.Set<PostShare>().Add(share);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} shared post {PostId} to {SharedTo}", userId, postId, sharedTo ?? "unspecified");
        return (true, null);
    }

    /// <summary>
    /// Get detailed engagement statistics for a post.
    /// </summary>
    public async Task<PostEngagementResult?> GetPostEngagementAsync(int postId)
    {
        var post = await _db.FeedPosts
            .Include(p => p.Likes)
            .Include(p => p.Comments)
            .FirstOrDefaultAsync(p => p.Id == postId);

        if (post == null)
            return null;

        var shareCount = 0;
        var bookmarkCount = 0;

        try
        {
            shareCount = await _db.Set<PostShare>().CountAsync(s => s.PostId == postId);
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "PostShare table not available for engagement stats");
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "PostShare table not available for engagement stats");
        }
        catch (System.Data.Common.DbException ex)
        {
            _logger.LogWarning(ex, "PostShare table not available for engagement stats");
        }

        try
        {
            bookmarkCount = await _db.Set<FeedBookmark>().CountAsync(b => b.PostId == postId);
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "FeedBookmark table not available for engagement stats");
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "FeedBookmark table not available for engagement stats");
        }
        catch (System.Data.Common.DbException ex)
        {
            _logger.LogWarning(ex, "FeedBookmark table not available for engagement stats");
        }

        return new PostEngagementResult
        {
            PostId = postId,
            LikeCount = post.Likes.Count,
            CommentCount = post.Comments.Count,
            ShareCount = shareCount,
            BookmarkCount = bookmarkCount,
            TotalEngagement = post.Likes.Count + post.Comments.Count + shareCount + bookmarkCount
        };
    }

    // ---- NEW METHODS (Task 3 additions) ----

    public async Task<(bool Success, string? Error)> AddReactionAsync(int tenantId, int postId, int userId, string reactionType)
    {
        if (!PostReaction.Types.All.Contains(reactionType))
            return (false, string.Concat("Invalid reaction type. Must be one of: ", string.Join(", ", PostReaction.Types.All)));

        var postExists = await _db.FeedPosts.AnyAsync(p => p.Id == postId);
        if (!postExists) return (false, "Post not found");

        var existing = await _db.Set<PostReaction>().FirstOrDefaultAsync(r => r.PostId == postId && r.UserId == userId);
        if (existing != null)
        {
            existing.ReactionType = reactionType;
            await _db.SaveChangesAsync();
            return (true, null);
        }

        _db.Set<PostReaction>().Add(new PostReaction
        {
            TenantId = tenantId,
            PostId = postId,
            UserId = userId,
            ReactionType = reactionType
        });
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(bool Success, string? Error)> RemoveReactionAsync(int tenantId, int postId, int userId)
    {
        var reaction = await _db.Set<PostReaction>().FirstOrDefaultAsync(r => r.PostId == postId && r.UserId == userId);
        if (reaction == null) return (false, "No reaction found");
        _db.Set<PostReaction>().Remove(reaction);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<Dictionary<string, int>> GetReactionsAsync(int tenantId, int postId)
    {
        var counts = new Dictionary<string, int>();
        foreach (var type in PostReaction.Types.All)
            counts[type] = 0;

        var reactions = await _db.Set<PostReaction>()
            .AsNoTracking()
            .Where(r => r.PostId == postId)
            .GroupBy(r => r.ReactionType)
            .Select(g => new { Type = g.Key, Count = g.Count() })
            .ToListAsync();

        foreach (var r in reactions)
            counts[r.Type] = r.Count;

        return counts;
    }

    public async Task<List<object>> SearchMentionsAsync(int tenantId, string query)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Length < 2)
            return new List<object>();

        var term = query.Trim().ToLower();
        var users = await _db.Users
            .AsNoTracking()
            .Where(u => u.FirstName.ToLower().Contains(term) ||
                        u.LastName.ToLower().Contains(term) ||
                        (u.Email != null && u.Email.ToLower().Contains(term)))
            .Take(10)
            .Select(u => (object)new { id = u.Id, name = string.Concat(u.FirstName, " ", u.LastName), username = u.Email })
            .ToListAsync();

        return users;
    }

    public async Task<(PostShare? Share, string? Error)> SharePostWithCommentAsync(int tenantId, int postId, int userId, string? comment)
    {
        var postExists = await _db.FeedPosts.AnyAsync(p => p.Id == postId);
        if (!postExists) return (null, "Post not found");

        var share = new PostShare
        {
            TenantId = tenantId,
            UserId = userId,
            PostId = postId,
            SharedTo = "internal"
        };

        _db.Set<PostShare>().Add(share);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} shared post {PostId}", userId, postId);
        return (share, null);
    }


// --- Result DTOs ---

}

public class ScoredPost
{
    public FeedPost Post { get; set; } = null!;
    public double Score { get; set; }
    public int LikeCount { get; set; }
    public int CommentCount { get; set; }
    public int ShareCount { get; set; }
    public bool IsLiked { get; set; }
}

public class RankedFeedResult
{
    public List<ScoredPost> Posts { get; set; } = new();
    public int Page { get; set; }
    public int Limit { get; set; }
    public int Total { get; set; }
    public int TotalPages { get; set; }
}

public class TrendingPostResult
{
    public FeedPost Post { get; set; } = null!;
    public double Velocity { get; set; }
    public int LikeCount { get; set; }
    public int CommentCount { get; set; }
    public int ShareCount { get; set; }
}

public class BookmarkListResult
{
    public List<FeedBookmark> Bookmarks { get; set; } = new();
    public int Page { get; set; }
    public int Limit { get; set; }
    public int Total { get; set; }
    public int TotalPages { get; set; }
}

public class PostEngagementResult
{
    public int PostId { get; set; }
    public int LikeCount { get; set; }
    public int CommentCount { get; set; }
    public int ShareCount { get; set; }
    public int BookmarkCount { get; set; }
    public int TotalEngagement { get; set; }
}
