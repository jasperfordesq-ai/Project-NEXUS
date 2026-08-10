// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for handling gamification logic - XP awards, level ups, and badge checks.
/// Implements V1's comprehensive badge system (70+ badge types across 8 categories).
/// Badges are never removed (monotonically increasing).
/// </summary>
public class GamificationService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<GamificationService> _logger;
    private readonly PushNotificationService? _pushNotifications;
    private readonly EmailNotificationService? _emailNotifications;
    private readonly FeedActivityService? _feedActivity;

    public GamificationService(
        NexusDbContext db,
        ILogger<GamificationService> logger,
        PushNotificationService? pushNotifications = null,
        EmailNotificationService? emailNotifications = null,
        FeedActivityService? feedActivity = null)
    {
        _db = db;
        _logger = logger;
        _pushNotifications = pushNotifications;
        _emailNotifications = emailNotifications;
        _feedActivity = feedActivity;
    }

    /// <summary>
    /// Award XP to a user and check for level up.
    /// Handles concurrency conflicts with retry logic.
    /// </summary>
    public async Task<XpAwardResult> AwardXpAsync(int userId, int amount, string source, int? referenceId = null, string? description = null)
    {
        const int maxRetries = 3;
        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
                if (user == null)
                {
                    return new XpAwardResult { Success = false, Error = "User not found" };
                }

                var previousLevel = user.Level;
                var previousXp = user.TotalXp;

                var xpLog = new XpLog
                {
                    TenantId = user.TenantId,
                    UserId = userId,
                    Amount = amount,
                    Source = source,
                    ReferenceId = referenceId,
                    Description = description
                };
                _db.XpLogs.Add(xpLog);

                user.TotalXp += amount;
                if (user.TotalXp < 0) user.TotalXp = 0;

                var newLevel = User.CalculateLevelFromXp(user.TotalXp);
                var leveledUp = newLevel > previousLevel;
                user.Level = newLevel;

                await _db.SaveChangesAsync();

                _logger.LogInformation(
                    "User {UserId} awarded {Amount} XP for {Source}. Total: {TotalXp}, Level: {Level}",
                    userId, amount, source, user.TotalXp, user.Level);

                if (leveledUp)
                {
                    _logger.LogInformation("User {UserId} leveled up from {OldLevel} to {NewLevel}!", userId, previousLevel, newLevel);
                    // Check level milestone badges
                    try { await CheckLevelBadges(userId); } catch (Exception ex) when (ex is InvalidOperationException or Microsoft.EntityFrameworkCore.DbUpdateException or OperationCanceledException) { _logger.LogWarning(ex, "Failed to check level badges for user {UserId}", userId); }
                }

                return new XpAwardResult
                {
                    Success = true,
                    Amount = amount,
                    PreviousXp = previousXp,
                    NewXp = user.TotalXp,
                    PreviousLevel = previousLevel,
                    NewLevel = newLevel,
                    LeveledUp = leveledUp
                };
            }
            catch (DbUpdateConcurrencyException ex)
            {
                _logger.LogWarning(ex, "Concurrency conflict awarding XP to user {UserId}, attempt {Attempt}/{MaxRetries}",
                    userId, attempt, maxRetries);

                if (attempt == maxRetries)
                {
                    _logger.LogError(ex, "Failed to award XP to user {UserId} after {MaxRetries} attempts", userId, maxRetries);
                    return new XpAwardResult { Success = false, Error = "Concurrency conflict - please try again" };
                }

                foreach (var entry in _db.ChangeTracker.Entries<User>().Where(e => e.Entity.Id == userId))
                    entry.State = EntityState.Detached;
                foreach (var entry in _db.ChangeTracker.Entries<XpLog>().Where(e => e.Entity.UserId == userId))
                    entry.State = EntityState.Detached;

                await Task.Delay(50 * attempt);
            }
        }

        return new XpAwardResult { Success = false, Error = "Unexpected error" };
    }

    /// <summary>
    /// Award a badge to a user if they don't already have it.
    /// </summary>
    public async Task<BadgeAwardResult> AwardBadgeAsync(int userId, string badgeSlug)
    {
        var tenantId = await _db.Users
            .IgnoreQueryFilters()
            .Where(user => user.Id == userId)
            .Select(user => (int?)user.TenantId)
            .SingleOrDefaultAsync();
        if (tenantId is null)
        {
            return new BadgeAwardResult { Success = false, Error = "User not found" };
        }

        var badge = await _db.Badges
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(b => b.TenantId == tenantId.Value
                && b.Slug == badgeSlug
                && b.IsActive);
        if (badge == null)
        {
            return new BadgeAwardResult { Success = false, Error = "Badge not found" };
        }

        var existingBadge = await _db.UserBadges
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(ub => ub.TenantId == tenantId.Value
                && ub.UserId == userId
                && ub.BadgeId == badge.Id);

        if (existingBadge != null)
        {
            return new BadgeAwardResult { Success = false, Error = "User already has this badge", AlreadyEarned = true };
        }

        var userBadge = new UserBadge
        {
            TenantId = tenantId.Value,
            UserId = userId,
            BadgeId = badge.Id
        };
        _db.UserBadges.Add(userBadge);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex)
        {
            _logger.LogDebug(ex, "Badge '{BadgeSlug}' already earned by user {UserId} (duplicate key)", badgeSlug, userId);
            _db.Entry(userBadge).State = EntityState.Detached;
            return new BadgeAwardResult { Success = false, Error = "User already has this badge", AlreadyEarned = true };
        }

        _logger.LogInformation("User {UserId} earned badge '{BadgeSlug}' ({BadgeName})", userId, badgeSlug, badge.Name);

        XpAwardResult? xpResult = null;
        if (badge.XpReward > 0)
        {
            xpResult = await AwardXpAsync(
                userId,
                badge.XpReward,
                XpLog.Sources.BadgeEarned,
                badge.Id,
                $"Earned badge: {badge.Name}");
        }

        await TryDispatchBadgeEarnedSideEffectsAsync(tenantId.Value, userId, badge);

        return new BadgeAwardResult
        {
            Success = true,
            Badge = badge,
            XpAwarded = xpResult
        };
    }

    /// <summary>
    /// Recomputes Laravel's volunteer-hour badge milestones from the canonical
    /// approved <c>vol_logs</c> sum for one tenant/user. Fractional totals are
    /// truncated before threshold comparison, matching Laravel's integer cast.
    ///
    /// Relational callers may invoke this inside an existing approval
    /// transaction. Otherwise the method creates and commits its own
    /// transaction. A PostgreSQL advisory transaction lock serializes checks
    /// for the same tenant/user, while the existing user_badges unique index is
    /// the final duplicate-award guard.
    /// </summary>
    public async Task<VolunteerHourBadgeCheckResult> CheckAndAwardVolunteerHourBadgesAsync(
        int tenantId,
        int userId,
        CancellationToken ct = default)
    {
        await using var ownedTransaction = _db.Database.IsRelational()
            && _db.Database.CurrentTransaction is null
                ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
                : null;

        try
        {
            if (_db.Database.IsRelational())
            {
                var lockKey = VolunteerHourBadgeLockNamespace
                    ^ ((long)(uint)tenantId << 32)
                    ^ (uint)userId;
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({lockKey})",
                    ct);
            }

            var user = await _db.Users
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(
                    candidate => candidate.TenantId == tenantId && candidate.Id == userId,
                    ct);
            if (user is null)
            {
                if (ownedTransaction is not null)
                    await ownedTransaction.RollbackAsync(ct);

                return new VolunteerHourBadgeCheckResult(
                    false,
                    0m,
                    0,
                    Array.Empty<string>(),
                    0,
                    "User not found");
            }

            var badgesBySlug = await UpsertVolunteerHourBadgeDefinitionsAsync(tenantId, ct);
            var approvedHours = await _db.VolunteerLogs
                .IgnoreQueryFilters()
                .Where(log => log.TenantId == tenantId
                    && log.UserId == userId
                    && log.Status == "approved")
                .SumAsync(log => (decimal?)log.Hours, ct)
                ?? 0m;
            var wholeHours = decimal.ToInt64(decimal.Truncate(approvedHours));
            var newlyEarned = new List<string>();

            foreach (var definition in Badge.VolunteerHours.Definitions)
            {
                if (wholeHours < definition.Threshold)
                    continue;

                var badge = badgesBySlug[definition.Slug];
                if (!await TryInsertUserBadgeAsync(tenantId, userId, badge.Id, ct))
                    continue;

                newlyEarned.Add(definition.Slug);
                _db.XpLogs.Add(new XpLog
                {
                    TenantId = tenantId,
                    UserId = userId,
                    Amount = XpLog.Amounts.BadgeEarned,
                    Source = XpLog.Sources.BadgeEarned,
                    ReferenceId = badge.Id,
                    Description = $"Earned badge: {definition.Name}",
                    CreatedAt = DateTime.UtcNow
                });
            }

            var xpAwarded = newlyEarned.Count * XpLog.Amounts.BadgeEarned;
            if (xpAwarded > 0)
            {
                user.TotalXp += xpAwarded;
                user.Level = User.CalculateLevelFromXp(user.TotalXp);
                user.UpdatedAt = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync(ct);
            if (ownedTransaction is not null)
                await ownedTransaction.CommitAsync(ct);

            // An ambient transaction belongs to the caller. Do not emit email,
            // push, or feed effects before that caller commits; the canonical
            // volunteer-hours path invokes this method post-commit and therefore
            // owns the short badge transaction above.
            if (ownedTransaction is not null || !_db.Database.IsRelational())
            {
                foreach (var slug in newlyEarned)
                {
                    await TryDispatchBadgeEarnedSideEffectsAsync(
                        tenantId,
                        userId,
                        badgesBySlug[slug],
                        ct);
                }
            }

            if (newlyEarned.Count > 0)
            {
                _logger.LogInformation(
                    "User {UserId} earned volunteer-hour badges {BadgeSlugs} for {WholeHours} approved hours",
                    userId,
                    string.Join(", ", newlyEarned),
                    wholeHours);
            }

            return new VolunteerHourBadgeCheckResult(
                true,
                approvedHours,
                wholeHours,
                newlyEarned,
                xpAwarded,
                null);
        }
        catch
        {
            if (ownedTransaction is not null)
                await ownedTransaction.RollbackAsync(CancellationToken.None);
            throw;
        }
    }

    /// <summary>
    /// Check and award badges based on user's actions.
    /// Implements V1's comprehensive badge checking across 8 categories.
    /// </summary>
    public async Task CheckAndAwardBadgesAsync(int userId, string action)
    {
        try
        {
            switch (action)
            {
                case "listing_created":
                    await CheckListingBadges(userId);
                    break;
                case "connection_accepted":
                    await CheckConnectionBadges(userId);
                    break;
                case "transaction_completed":
                case "exchange_completed":
                    await CheckTransactionBadges(userId);
                    break;
                case "review_left":
                    await CheckReviewBadges(userId);
                    break;
                case "post_created":
                    await CheckPostBadges(userId);
                    break;
                case "event_created":
                    await CheckEventHostBadges(userId);
                    break;
                case "event_attended":
                    await CheckEventAttendBadges(userId);
                    break;
                case "group_created":
                    await AwardBadgeAsync(userId, Badge.Slugs.GroupCreate1);
                    break;
                case "group_joined":
                    await CheckGroupJoinBadges(userId);
                    break;
                case "post_liked":
                    await CheckLikesBadges(userId);
                    break;
                case "message_sent":
                    await CheckMessageBadges(userId);
                    break;
                case "five_star_received":
                    await CheckFiveStarBadges(userId);
                    break;
                case "level_up":
                    await CheckLevelBadges(userId);
                    break;
                case "membership_check":
                    await CheckMembershipBadges(userId);
                    break;
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or Microsoft.EntityFrameworkCore.DbUpdateException or OperationCanceledException)
        {
            _logger.LogWarning(ex, "Badge check failed for user {UserId} action {Action}", userId, action);
        }
    }

    /// <summary>
    /// Re-runs every badge family currently represented by the ASP model after
    /// a canonical activity transition. Laravel performs the equivalent full
    /// sweep after volunteer-hour XP, rather than checking hour milestones in
    /// isolation. The user lookup pins the sweep to one tenant even when this
    /// service is invoked from a background or test scope without a resolved
    /// request tenant.
    /// </summary>
    public async Task RunAllBadgeChecksAsync(int tenantId, int userId, CancellationToken ct = default)
    {
        var exists = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId && user.Id == userId, ct);
        if (!exists)
            return;

        await CheckAndAwardVolunteerHourBadgesAsync(tenantId, userId, ct);
        await CheckListingBadges(userId);
        await CheckConnectionBadges(userId);
        await CheckTransactionBadges(userId);
        await CheckReviewBadges(userId);
        await CheckPostBadges(userId);
        await CheckEventHostBadges(userId);
        await CheckEventAttendBadges(userId);
        await CheckGroupJoinBadges(userId);
        await CheckGroupCreateBadges(userId);
        await CheckMessageBadges(userId);
        await CheckFiveStarBadges(userId);
        await CheckLikesBadges(userId);
        await CheckLevelBadges(userId);
        await CheckMembershipBadges(userId);
    }

    #region Badge Checks

    private async Task CheckListingBadges(int userId)
    {
        var offers = await _db.Listings.CountAsync(l => l.UserId == userId && l.Type == ListingType.Offer);
        var requests = await _db.Listings.CountAsync(l => l.UserId == userId && l.Type == ListingType.Request);

        if (offers + requests >= 1) await AwardBadgeAsync(userId, Badge.Slugs.FirstListing);
        if (offers >= 5) await AwardBadgeAsync(userId, Badge.Slugs.Offer5);
        if (offers >= 10) await AwardBadgeAsync(userId, Badge.Slugs.Offer10);
        if (offers >= 25) await AwardBadgeAsync(userId, Badge.Slugs.Offer25);
        if (requests >= 5) await AwardBadgeAsync(userId, Badge.Slugs.Request5);
        if (requests >= 10) await AwardBadgeAsync(userId, Badge.Slugs.Request10);
    }

    private async Task CheckConnectionBadges(int userId)
    {
        var count = await _db.Connections
            .CountAsync(c => (c.RequesterId == userId || c.AddresseeId == userId) && c.Status == "accepted");

        if (count >= 1) await AwardBadgeAsync(userId, Badge.Slugs.FirstConnection);
        if (count >= 10) await AwardBadgeAsync(userId, Badge.Slugs.Connect10);
        if (count >= 25) await AwardBadgeAsync(userId, Badge.Slugs.Connect25);
        if (count >= 50) await AwardBadgeAsync(userId, Badge.Slugs.Connect50);
    }

    private async Task CheckTransactionBadges(int userId)
    {
        var txCount = await _db.Transactions
            .CountAsync(t => (t.SenderId == userId || t.ReceiverId == userId)
                && t.Status == TransactionStatus.Completed
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType);

        if (txCount >= 1) await AwardBadgeAsync(userId, Badge.Slugs.FirstTransaction);
        if (txCount >= 10)
        {
            await AwardBadgeAsync(userId, Badge.Slugs.Transaction10);
            await AwardBadgeAsync(userId, Badge.Slugs.HelpfulNeighbor);
        }
        if (txCount >= 50) await AwardBadgeAsync(userId, Badge.Slugs.Transaction50);

        var earned = await _db.Transactions
            .ExcludeInternalWalletAdapters()
            .Where(t => t.ReceiverId == userId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount);

        if (earned >= 10) await AwardBadgeAsync(userId, Badge.Slugs.Earn10);
        if (earned >= 50) await AwardBadgeAsync(userId, Badge.Slugs.Earn50);
        if (earned >= 100) await AwardBadgeAsync(userId, Badge.Slugs.Earn100);
        if (earned >= 250) await AwardBadgeAsync(userId, Badge.Slugs.Earn250);

        var spent = await _db.Transactions
            .Where(t => t.SenderId == userId
                && t.Status == TransactionStatus.Completed
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType)
            .SumAsync(t => t.Amount);

        if (spent >= 10) await AwardBadgeAsync(userId, Badge.Slugs.Spend10);
        if (spent >= 50) await AwardBadgeAsync(userId, Badge.Slugs.Spend50);

        var uniquePeople = await _db.Transactions
            .Where(t => t.SenderId == userId
                && t.Status == TransactionStatus.Completed
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType)
            .Select(t => t.ReceiverId)
            .Distinct()
            .CountAsync();

        if (uniquePeople >= 3) await AwardBadgeAsync(userId, Badge.Slugs.Diversity3);
        if (uniquePeople >= 10) await AwardBadgeAsync(userId, Badge.Slugs.Diversity10);
        if (uniquePeople >= 25) await AwardBadgeAsync(userId, Badge.Slugs.Diversity25);
    }

    private async Task CheckReviewBadges(int userId)
    {
        var count = await _db.Reviews.CountAsync(r => r.ReviewerId == userId);

        if (count >= 1) await AwardBadgeAsync(userId, Badge.Slugs.FirstReview);
        if (count >= 10) await AwardBadgeAsync(userId, Badge.Slugs.Review10);
        if (count >= 25) await AwardBadgeAsync(userId, Badge.Slugs.Review25);
    }

    private async Task CheckPostBadges(int userId)
    {
        var count = await _db.FeedPosts.CountAsync(p => p.UserId == userId);

        if (count >= 1) await AwardBadgeAsync(userId, Badge.Slugs.FirstPost);
        if (count >= 25) await AwardBadgeAsync(userId, Badge.Slugs.Posts25);
        if (count >= 100) await AwardBadgeAsync(userId, Badge.Slugs.Posts100);
    }

    private async Task CheckEventHostBadges(int userId)
    {
        var count = await _db.Events.CountAsync(e => e.CreatedById == userId);

        if (count >= 1)
        {
            await AwardBadgeAsync(userId, Badge.Slugs.FirstEvent);
            await AwardBadgeAsync(userId, Badge.Slugs.EventHost1);
        }
        if (count >= 5)
        {
            await AwardBadgeAsync(userId, Badge.Slugs.EventHost5);
            await AwardBadgeAsync(userId, Badge.Slugs.EventOrganizer);
        }
    }

    private async Task CheckEventAttendBadges(int userId)
    {
        var count = await _db.EventRsvps.CountAsync(r => r.UserId == userId && r.Status == "going");

        if (count >= 1) await AwardBadgeAsync(userId, Badge.Slugs.EventAttend1);
        if (count >= 10) await AwardBadgeAsync(userId, Badge.Slugs.EventAttend10);
        if (count >= 25) await AwardBadgeAsync(userId, Badge.Slugs.EventAttend25);
    }

    private async Task CheckGroupJoinBadges(int userId)
    {
        var count = await _db.GroupMembers.CountAsync(gm => gm.UserId == userId);

        if (count >= 1) await AwardBadgeAsync(userId, Badge.Slugs.GroupJoin1);
        if (count >= 5)
        {
            await AwardBadgeAsync(userId, Badge.Slugs.GroupJoin5);
            await AwardBadgeAsync(userId, Badge.Slugs.CommunityBuilder);
        }
    }

    private async Task CheckGroupCreateBadges(int userId)
    {
        if (await _db.Groups.AnyAsync(group => group.CreatedById == userId))
            await AwardBadgeAsync(userId, Badge.Slugs.GroupCreate1);
    }

    private async Task CheckMessageBadges(int userId)
    {
        var count = await _db.Messages.CountAsync(m => m.SenderId == userId);

        if (count >= 1) await AwardBadgeAsync(userId, Badge.Slugs.FirstMessage);
        if (count >= 50) await AwardBadgeAsync(userId, Badge.Slugs.Msg50);
        if (count >= 200) await AwardBadgeAsync(userId, Badge.Slugs.Msg200);
    }

    private async Task CheckFiveStarBadges(int userId)
    {
        var fiveStarCount = await _db.ExchangeRatings
            .CountAsync(r => r.RatedUserId == userId && r.Rating == 5);

        if (fiveStarCount >= 1) await AwardBadgeAsync(userId, Badge.Slugs.FiveStar1);
        if (fiveStarCount >= 10) await AwardBadgeAsync(userId, Badge.Slugs.FiveStar10);
        if (fiveStarCount >= 25) await AwardBadgeAsync(userId, Badge.Slugs.FiveStar25);
    }

    private async Task CheckLikesBadges(int userId)
    {
        var hasPopularPost = await _db.FeedPosts
            .Where(p => p.UserId == userId)
            .AnyAsync(p => p.Likes.Count >= 10);
        if (hasPopularPost) await AwardBadgeAsync(userId, Badge.Slugs.PopularPost);

        var totalLikes = await _db.FeedPosts
            .Where(p => p.UserId == userId)
            .SelectMany(p => p.Likes)
            .CountAsync();

        if (totalLikes >= 50) await AwardBadgeAsync(userId, Badge.Slugs.Likes50);
        if (totalLikes >= 200) await AwardBadgeAsync(userId, Badge.Slugs.Likes200);
    }

    private async Task CheckLevelBadges(int userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null) return;

        if (user.Level >= 5) await AwardBadgeAsync(userId, Badge.Slugs.Level5);
        if (user.Level >= 10) await AwardBadgeAsync(userId, Badge.Slugs.Level10);
    }

    private async Task CheckMembershipBadges(int userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null) return;

        var age = DateTime.UtcNow - user.CreatedAt;
        if (age.TotalDays >= 30) await AwardBadgeAsync(userId, Badge.Slugs.Member30d);
        if (age.TotalDays >= 180) await AwardBadgeAsync(userId, Badge.Slugs.Member180d);
        if (age.TotalDays >= 365)
        {
            await AwardBadgeAsync(userId, Badge.Slugs.Member365d);
            await AwardBadgeAsync(userId, Badge.Slugs.Veteran);
        }
    }

    #endregion

    /// <summary>
    /// Re-check all XP-threshold badges for a user and award any newly qualifying ones.
    /// Returns list of newly earned UserBadge records.
    /// </summary>
    public async Task<(List<UserBadge> NewlyEarned, string? Error)> RecheckAllBadgesAsync(int tenantId, int userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null) return (new List<UserBadge>(), "User not found");

        var earnedBadgeIds = await _db.UserBadges
            .Where(ub => ub.UserId == userId)
            .Select(ub => ub.BadgeId)
            .ToListAsync();

        var allBadges = await _db.Badges
            .Where(b => b.IsActive && !earnedBadgeIds.Contains(b.Id))
            .ToListAsync();

        // Count completed exchanges for this user
        var exchangeCount = await _db.Exchanges
            .CountAsync(e => e.Status == ExchangeStatus.Completed &&
                             (e.InitiatorId == userId || e.ListingOwnerId == userId));

        var newlyEarned = new List<UserBadge>();

        foreach (var badge in allBadges)
        {
            bool qualifies = badge.Name switch
            {
                "Bronze" => user.TotalXp >= 100,
                "Silver" => user.TotalXp >= 500,
                "Gold" => user.TotalXp >= 1000,
                "Platinum" => user.TotalXp >= 5000,
                _ => false // Don't auto-award unrecognized badges
            };

            if (qualifies)
            {
                var userBadge = new UserBadge
                {
                    TenantId = tenantId,
                    UserId = userId,
                    BadgeId = badge.Id
                };
                _db.UserBadges.Add(userBadge);

                try
                {
                    await _db.SaveChangesAsync();
                    newlyEarned.Add(userBadge);

                    if (badge.XpReward > 0)
                    {
                        await AwardXpAsync(userId, badge.XpReward, XpLog.Sources.BadgeEarned, badge.Id, $"Earned badge: {badge.Name}");
                    }

                    _logger.LogInformation("Recheck: user {UserId} earned badge '{BadgeName}'", userId, badge.Name);
                }
                catch (DbUpdateException ex)
                {
                    _logger.LogDebug(ex, "Recheck: badge '{BadgeName}' already earned by user {UserId} (race condition)", badge.Name, userId);
                    _db.Entry(userBadge).State = EntityState.Detached;
                    // Already earned (race) � skip
                }
            }
        }

        return (newlyEarned, null);
    }

    /// <summary>
    /// Get all achievements (badges) with earned status and estimated progress for a user.
    /// </summary>
    public async Task<List<object>> GetAchievementsAsync(int tenantId, int userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null) return new List<object>();

        var earnedMap = await _db.UserBadges
            .Where(ub => ub.UserId == userId)
            .Select(ub => new { ub.BadgeId, ub.EarnedAt })
            .ToDictionaryAsync(x => x.BadgeId, x => x.EarnedAt);

        var badges = await _db.Badges
            .Where(b => b.IsActive)
            .OrderBy(b => b.SortOrder).ThenBy(b => b.Name)
            .ToListAsync();

        var exchangeCount = await _db.Exchanges
            .CountAsync(e => e.Status == ExchangeStatus.Completed &&
                             (e.InitiatorId == userId || e.ListingOwnerId == userId));

        var result = new List<object>();

        foreach (var badge in badges)
        {
            var isEarned = earnedMap.ContainsKey(badge.Id);
            DateTime? earnedAt = isEarned ? earnedMap[badge.Id] : null;

            // Estimate progress percent based on badge name
            double progressPercent = badge.Name switch
            {
                "Bronze" => isEarned ? 100 : Math.Min(100, user.TotalXp / 100.0 * 100),
                "Silver" => isEarned ? 100 : Math.Min(100, user.TotalXp / 500.0 * 100),
                "Gold" => isEarned ? 100 : Math.Min(100, user.TotalXp / 1000.0 * 100),
                "Platinum" => isEarned ? 100 : Math.Min(100, user.TotalXp / 5000.0 * 100),
                _ => isEarned ? 100 : 0 // Unknown badges show 0 progress
            };

            result.Add(new
            {
                badge = new
                {
                    badge.Id,
                    badge.Slug,
                    badge.Name,
                    badge.Description,
                    badge.Icon,
                    badge.XpReward
                },
                earned = isEarned,
                earned_at = earnedAt,
                progress_percent = Math.Round(progressPercent, 1)
            });
        }

        return result;
    }

    /// <summary>
    /// Admin: manually award a badge to a user.
    /// </summary>
    public async Task<(UserBadge?, string? Error)> AwardBadgeManuallyAsync(int tenantId, int userId, int badgeId, int adminId)
    {
        var badge = await _db.Badges.FirstOrDefaultAsync(b => b.Id == badgeId && b.IsActive);
        if (badge == null) return (null, "Badge not found");

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null) return (null, "User not found");

        var existing = await _db.UserBadges
            .FirstOrDefaultAsync(ub => ub.UserId == userId && ub.BadgeId == badgeId);
        if (existing != null) return (null, "User already has this badge");

        var userBadge = new UserBadge
        {
            TenantId = tenantId,
            UserId = userId,
            BadgeId = badgeId
        };
        _db.UserBadges.Add(userBadge);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex)
        {
            _logger.LogDebug(ex, "Manual badge award: badge {BadgeId} already earned by user {UserId} (duplicate key)", badgeId, userId);
            _db.Entry(userBadge).State = EntityState.Detached;
            return (null, "User already has this badge");
        }

        if (badge.XpReward > 0)
        {
            await AwardXpAsync(userId, badge.XpReward, XpLog.Sources.BadgeEarned, badge.Id, $"Badge manually awarded: {badge.Name}");
        }

        await TryDispatchBadgeEarnedSideEffectsAsync(tenantId, userId, badge);

        _logger.LogInformation("Admin {AdminId} manually awarded badge '{BadgeSlug}' to user {UserId}", adminId, badge.Slug, userId);
        return (userBadge, null);
    }

    /// <summary>
    /// Admin: revoke a badge from a user.
    /// </summary>
    public async Task<(bool Success, string? Error)> RevokeBadgeAsync(int tenantId, int userId, int badgeId, int adminId)
    {
        var userBadge = await _db.UserBadges
            .FirstOrDefaultAsync(ub => ub.UserId == userId && ub.BadgeId == badgeId);

        if (userBadge == null) return (false, "User does not have this badge");

        _db.UserBadges.Remove(userBadge);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} revoked badge {BadgeId} from user {UserId}", adminId, badgeId, userId);
        return (true, null);
    }

    private const long VolunteerHourBadgeLockNamespace = 0x564F4C4200000000L;

    /// <summary>
    /// Lazy per-tenant seed/upsert for the six canonical definitions. This
    /// avoids a schema fork and also covers tenants created after deployment.
    /// </summary>
    private async Task<Dictionary<string, Badge>> UpsertVolunteerHourBadgeDefinitionsAsync(
        int tenantId,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        if (_db.Database.IsRelational())
        {
            foreach (var definition in Badge.VolunteerHours.Definitions)
            {
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO badges
                        ("TenantId", "Slug", "Name", "Description", "Icon", "XpReward", "IsActive", "SortOrder", "CreatedAt", "UpdatedAt")
                    VALUES
                        ({tenantId}, {definition.Slug}, {definition.Name}, {definition.Description}, {definition.Icon}, {XpLog.Amounts.BadgeEarned}, TRUE, {definition.SortOrder}, {now}, NULL)
                    ON CONFLICT ("TenantId", "Slug") DO UPDATE SET
                        "Name" = EXCLUDED."Name",
                        "Description" = EXCLUDED."Description",
                        "Icon" = EXCLUDED."Icon",
                        "XpReward" = EXCLUDED."XpReward",
                        "IsActive" = TRUE,
                        "SortOrder" = EXCLUDED."SortOrder",
                        "UpdatedAt" = {now}
                    """, ct);
            }
        }
        else
        {
            var slugs = Badge.VolunteerHours.Definitions
                .Select(definition => definition.Slug)
                .ToArray();
            var existing = await _db.Badges
                .IgnoreQueryFilters()
                .Where(badge => badge.TenantId == tenantId && slugs.Contains(badge.Slug))
                .ToDictionaryAsync(badge => badge.Slug, StringComparer.Ordinal, ct);

            foreach (var definition in Badge.VolunteerHours.Definitions)
            {
                if (!existing.TryGetValue(definition.Slug, out var badge))
                {
                    badge = new Badge
                    {
                        TenantId = tenantId,
                        Slug = definition.Slug,
                        CreatedAt = now
                    };
                    _db.Badges.Add(badge);
                    existing.Add(definition.Slug, badge);
                }

                badge.Name = definition.Name;
                badge.Description = definition.Description;
                badge.Icon = definition.Icon;
                badge.XpReward = XpLog.Amounts.BadgeEarned;
                badge.IsActive = true;
                badge.SortOrder = definition.SortOrder;
                badge.UpdatedAt = badge.Id == 0 ? null : now;
            }

            await _db.SaveChangesAsync(ct);
        }

        var definitionSlugs = Badge.VolunteerHours.Definitions
            .Select(definition => definition.Slug)
            .ToArray();
        return await _db.Badges
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(badge => badge.TenantId == tenantId
                && definitionSlugs.Contains(badge.Slug))
            .ToDictionaryAsync(badge => badge.Slug, StringComparer.Ordinal, ct);
    }

    private async Task<bool> TryInsertUserBadgeAsync(
        int tenantId,
        int userId,
        int badgeId,
        CancellationToken ct)
    {
        if (_db.Database.IsRelational())
        {
            var inserted = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO user_badges ("TenantId", "UserId", "BadgeId", "EarnedAt")
                VALUES ({tenantId}, {userId}, {badgeId}, {DateTime.UtcNow})
                ON CONFLICT ("TenantId", "UserId", "BadgeId") DO NOTHING
                """, ct);
            return inserted == 1;
        }

        var exists = await _db.UserBadges
            .IgnoreQueryFilters()
            .AnyAsync(userBadge => userBadge.TenantId == tenantId
                && userBadge.UserId == userId
                && userBadge.BadgeId == badgeId, ct);
        if (exists)
            return false;

        _db.UserBadges.Add(new UserBadge
        {
            TenantId = tenantId,
            UserId = userId,
            BadgeId = badgeId,
            EarnedAt = DateTime.UtcNow
        });
        return true;
    }

    private async Task TryDispatchBadgeEarnedSideEffectsAsync(
        int tenantId,
        int userId,
        Badge badge,
        CancellationToken ct = default)
    {
        var iconPrefix = string.IsNullOrWhiteSpace(badge.Icon) ? string.Empty : $"{badge.Icon} ";
        var message = $"{iconPrefix}You earned the {badge.Name} badge!";
        var data = JsonSerializer.Serialize(new
        {
            badge_key = badge.Slug,
            badge_name = badge.Name,
            badge_icon = badge.Icon,
            url = "/profile"
        });

        try
        {
            _db.Notifications.Add(new Notification
            {
                TenantId = tenantId,
                UserId = userId,
                Type = "achievement",
                Title = "Badge earned",
                Body = message,
                Data = data,
                Link = "/profile",
                CreatedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception exception)
        {
            _db.ChangeTracker.Clear();
            _logger.LogWarning(
                exception,
                "Failed to create badge notification for tenant {TenantId}, user {UserId}, badge {BadgeSlug}",
                tenantId,
                userId,
                badge.Slug);
        }

        if (_pushNotifications is not null)
        {
            try
            {
                await _pushNotifications.SendPushAsync(
                    userId,
                    "Badge earned",
                    message,
                    data,
                    tenantId);
            }
            catch (Exception exception)
            {
                _db.ChangeTracker.Clear();
                _logger.LogWarning(
                    exception,
                    "Failed to queue badge push for tenant {TenantId}, user {UserId}, badge {BadgeSlug}",
                    tenantId,
                    userId,
                    badge.Slug);
            }
        }

        if (_emailNotifications is not null)
        {
            try
            {
                await _emailNotifications.SendTemplatedEmailAsync(
                    userId,
                    "badge_earned",
                    new Dictionary<string, string>
                    {
                        ["badge_key"] = badge.Slug,
                        ["badge_name"] = badge.Name,
                        ["name"] = badge.Name,
                        ["badge_icon"] = badge.Icon ?? string.Empty,
                        ["profile_url"] = "/profile"
                    },
                    tenantId);
            }
            catch (Exception exception)
            {
                _db.ChangeTracker.Clear();
                _logger.LogWarning(
                    exception,
                    "Failed to send badge email for tenant {TenantId}, user {UserId}, badge {BadgeSlug}",
                    tenantId,
                    userId,
                    badge.Slug);
            }
        }

        if (_feedActivity is not null)
        {
            try
            {
                await _feedActivity.RecordActivityAsync(
                    tenantId,
                    userId,
                    FeedActivitySourceTypes.BadgeEarned,
                    userId,
                    new FeedActivityData
                    {
                        Title = badge.Name,
                        Content = $"Earned the \"{badge.Name}\" badge!",
                        Metadata = new Dictionary<string, object?>
                        {
                            ["badge_key"] = badge.Slug,
                            ["badge_name"] = badge.Name,
                            ["badge_icon"] = badge.Icon
                        }
                    },
                    ct);
            }
            catch (Exception exception)
            {
                _db.ChangeTracker.Clear();
                _logger.LogWarning(
                    exception,
                    "Failed to publish badge activity for tenant {TenantId}, user {UserId}, badge {BadgeSlug}",
                    tenantId,
                    userId,
                    badge.Slug);
            }
        }
    }

}

public class XpAwardResult
{
    public bool Success { get; set; }
    public string? Error { get; set; }
    public int Amount { get; set; }
    public int PreviousXp { get; set; }
    public int NewXp { get; set; }
    public int PreviousLevel { get; set; }
    public int NewLevel { get; set; }
    public bool LeveledUp { get; set; }
}


public class BadgeAwardResult
{
    public bool Success { get; set; }
    public string? Error { get; set; }
    public bool AlreadyEarned { get; set; }
    public Badge? Badge { get; set; }
    public XpAwardResult? XpAwarded { get; set; }
}

public sealed record VolunteerHourBadgeCheckResult(
    bool Success,
    decimal ApprovedHours,
    long WholeHours,
    IReadOnlyList<string> NewlyEarnedBadges,
    int XpAwarded,
    string? Error);
