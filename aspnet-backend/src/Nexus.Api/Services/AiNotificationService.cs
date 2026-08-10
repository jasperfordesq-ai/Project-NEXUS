// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for generating AI-powered personalized notifications.
/// </summary>
public class AiNotificationService
{
    private readonly AiService _aiService;
    private readonly NexusDbContext _db;
    private readonly ILogger<AiNotificationService> _logger;

    public AiNotificationService(
        AiService aiService,
        NexusDbContext db,
        ILogger<AiNotificationService> logger)
    {
        _aiService = aiService;
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Generate personalized notifications for new listings that match user's interests.
    /// </summary>
    public async Task<List<Notification>> GenerateListingMatchNotificationsAsync(
        Listing newListing,
        CancellationToken ct = default)
    {
        var notifications = new List<Notification>();

        try
        {
            // Find users who might be interested (opposite listing type)
            var targetType = newListing.Type == ListingType.Offer ? ListingType.Request : ListingType.Offer;

            var potentialUsers = await _db.Users
                .Where(u => u.Id != newListing.UserId && u.IsActive && u.TenantId == newListing.TenantId)
                .Select(u => new
                {
                    u.Id,
                    u.FirstName,
                    Listings = _db.Listings
                        .Where(l => l.UserId == u.Id && l.Type == targetType && l.Status == ListingStatus.Active)
                        .Select(l => l.Title)
                        .Take(5)
                        .ToList()
                })
                .Where(u => u.Listings.Any())
                .Take(10)
                .ToListAsync(ct);

            foreach (var user in potentialUsers)
            {
                // Check if this listing might match their needs
                var userListings = string.Join(", ", user.Listings);
                var isMatch = IsListingMatch(newListing, userListings);

                if (isMatch)
                {
                    var notification = new Notification
                    {
                        TenantId = newListing.TenantId,
                        UserId = user.Id,
                        Type = "ai_listing_match",
                        Title = $"New {newListing.Type} that matches your interests!",
                        Body = $"\"{newListing.Title}\" was just posted and looks like a great match for you.",
                        Data = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            listingId = newListing.Id,
                            listingTitle = newListing.Title,
                            listingType = newListing.Type.ToString()
                        }),
                        CreatedAt = DateTime.UtcNow
                    };

                    notifications.Add(notification);
                    _db.Notifications.Add(notification);
                }
            }

            if (notifications.Any())
            {
                await _db.SaveChangesAsync(ct);
                _logger.LogInformation(
                    "Generated {Count} AI match notifications for listing {ListingId}",
                    notifications.Count, newListing.Id);
            }
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to generate listing match notifications for {ListingId}", newListing.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to generate listing match notifications for {ListingId}", newListing.Id);
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to generate listing match notifications for {ListingId}", newListing.Id);
        }

        return notifications;
    }

    /// <summary>
    /// Generate listing improvement suggestions notification.
    /// </summary>
    public async Task<Notification?> GenerateListingImprovementNotificationAsync(
        Listing listing,
        CancellationToken ct = default)
    {
        try
        {
            var suggestions = await _aiService.SuggestListingImprovements(
                listing.Title,
                listing.Description,
                listing.Type,
                ct
            );

            if (suggestions.Tips.Any())
            {
                var notification = new Notification
                {
                    TenantId = listing.TenantId,
                    UserId = listing.UserId,
                    Type = "ai_listing_tips",
                    Title = "Tips to improve your listing",
                    Body = $"Your listing \"{listing.Title}\" could get more attention! {suggestions.Tips.First()}",
                    Data = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        listingId = listing.Id,
                        tips = suggestions.Tips,
                        suggestedTitle = suggestions.ImprovedTitle
                    }),
                    CreatedAt = DateTime.UtcNow
                };

                _db.Notifications.Add(notification);
                await _db.SaveChangesAsync(ct);

                _logger.LogInformation(
                    "Generated improvement notification for listing {ListingId}",
                    listing.Id);

                return notification;
            }
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to generate improvement notification for {ListingId}", listing.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to generate improvement notification for {ListingId}", listing.Id);
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to generate improvement notification for {ListingId}", listing.Id);
        }

        return null;
    }

    /// <summary>
    /// Generate weekly summary notification for a user.
    /// </summary>
    public async Task<Notification?> GenerateWeeklySummaryAsync(
        int userId,
        CancellationToken ct = default)
    {
        try
        {
            var user = await _db.Users
                .Include(u => u.UserBadges)
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user == null) return null;

            var weekAgo = DateTime.UtcNow.AddDays(-7);

            // Get user's activity stats
            var newConnections = await _db.Connections
                .CountAsync(c => (c.RequesterId == userId || c.AddresseeId == userId)
                    && c.Status == "accepted"
                    && c.UpdatedAt > weekAgo, ct);

            var newListings = await _db.Listings
                .CountAsync(l => l.UserId == userId && l.CreatedAt > weekAgo, ct);

            var transactionsCompleted = await _db.Transactions
                .ExcludeInternalWalletAdapters()
                .CountAsync(t => (t.SenderId == userId || t.ReceiverId == userId)
                    && t.CreatedAt > weekAgo, ct);

            // Only generate if there's meaningful activity
            if (newConnections == 0 && newListings == 0 && transactionsCompleted == 0)
                return null;

            var body = GenerateWeeklySummaryBody(user.FirstName, newConnections, newListings, transactionsCompleted);

            var notification = new Notification
            {
                UserId = userId,
                Type = "ai_weekly_summary",
                Title = $"Your weekly timebank summary, {user.FirstName}!",
                Body = body,
                Data = System.Text.Json.JsonSerializer.Serialize(new
                {
                    newConnections,
                    newListings,
                    transactionsCompleted,
                    weekEnding = DateTime.UtcNow.ToString("yyyy-MM-dd")
                }),
                CreatedAt = DateTime.UtcNow
            };

            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(ct);

            return notification;
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to generate weekly summary for user {UserId}", userId);
            return null;
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to generate weekly summary for user {UserId}", userId);
            return null;
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to generate weekly summary for user {UserId}", userId);
            return null;
        }
    }

    /// <summary>
    /// Generate engagement reminder for inactive users.
    /// </summary>
    public async Task<Notification?> GenerateEngagementReminderAsync(
        int userId,
        CancellationToken ct = default)
    {
        try
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
            if (user == null) return null;

            // Check last activity
            var lastActivity = await _db.Listings
                .Where(l => l.UserId == userId)
                .MaxAsync(l => (DateTime?)l.CreatedAt, ct);

            var lastTransaction = await _db.Transactions
                .ExcludeInternalWalletAdapters()
                .Where(t => t.SenderId == userId || t.ReceiverId == userId)
                .MaxAsync(t => (DateTime?)t.CreatedAt, ct);

            var lastActiveDate = new[] { lastActivity, lastTransaction, user.CreatedAt }
                .Where(d => d.HasValue)
                .Max() ?? user.CreatedAt;

            // Only notify if inactive for 14+ days
            if (lastActiveDate > DateTime.UtcNow.AddDays(-14))
                return null;

            // Get suggestions based on their profile
            var profileSuggestions = await _aiService.SuggestProfileEnhancements(userId, ct);

            var body = $"Hi {user.FirstName}! We miss you in the timebank community. ";
            if (profileSuggestions.Tips.Any())
            {
                body += profileSuggestions.Tips.First();
            }
            else
            {
                body += "Check out new listings and connect with community members!";
            }

            var notification = new Notification
            {
                UserId = userId,
                Type = "ai_engagement_reminder",
                Title = "We miss you in the community!",
                Body = body,
                Data = System.Text.Json.JsonSerializer.Serialize(new
                {
                    daysSinceLastActivity = (int)(DateTime.UtcNow - lastActiveDate).TotalDays,
                    suggestions = profileSuggestions.Tips
                }),
                CreatedAt = DateTime.UtcNow
            };

            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(ct);

            return notification;
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to generate engagement reminder for user {UserId}", userId);
            return null;
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to generate engagement reminder for user {UserId}", userId);
            return null;
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to generate engagement reminder for user {UserId}", userId);
            return null;
        }
    }

    /// <summary>
    /// Generate community milestone notification.
    /// IMPORTANT: This method may be called from background jobs where tenant context is not set.
    /// The tenantId parameter ensures tenant isolation regardless of TenantContext state.
    /// </summary>
    public async Task<List<Notification>> GenerateCommunityMilestoneNotificationsAsync(
        int? tenantId = null,
        CancellationToken ct = default)
    {
        var notifications = new List<Notification>();

        try
        {
            var insights = await _aiService.GetCommunityInsights(ct);

            // Check for milestones (every 10 users, 50 listings, etc.)
            var userMilestone = (insights.TotalActiveUsers / 10) * 10;
            var listingMilestone = (insights.TotalActiveListings / 50) * 50;

            if (userMilestone > 0 && insights.TotalActiveUsers == userMilestone)
            {
                // Explicitly filter by tenant to ensure isolation even without tenant context
                var usersQuery = _db.Users.Where(u => u.IsActive);
                if (tenantId.HasValue)
                {
                    usersQuery = usersQuery.Where(u => u.TenantId == tenantId.Value);
                }

                var activeUsers = await usersQuery
                    .Take(500) // Limit to prevent memory issues in large tenants
                    .ToListAsync(ct);

                foreach (var user in activeUsers)
                {
                    var notification = new Notification
                    {
                        UserId = user.Id,
                        Type = "community_milestone",
                        Title = $"Community milestone: {userMilestone} members!",
                        Body = $"Our community has reached {userMilestone} active members! {insights.Summary}",
                        Data = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            milestone = "users",
                            count = userMilestone
                        }),
                        CreatedAt = DateTime.UtcNow
                    };

                    notifications.Add(notification);
                    _db.Notifications.Add(notification);
                }

                await _db.SaveChangesAsync(ct);
            }
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to generate community milestone notifications");
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to generate community milestone notifications");
        }
        catch (OperationCanceledException ex)
        {
            _logger.LogWarning(ex, "Failed to generate community milestone notifications");
        }

        return notifications;
    }

    /// <summary>
    /// Check if a new listing matches a user's existing listings/interests.
    /// </summary>
    private static bool IsListingMatch(
        Listing newListing,
        string userListings)
    {
        // Simple keyword matching for efficiency
        // In a production system, you might want to use embeddings for semantic similarity
        var listingKeywords = $"{newListing.Title} {newListing.Description ?? ""}".ToLowerInvariant();
        var userKeywords = userListings.ToLowerInvariant();

        // Check for common words (excluding common words)
        var stopWords = new HashSet<string> { "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by" };
        var listingWords = listingKeywords.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(w => w.Length > 2 && !stopWords.Contains(w))
            .ToHashSet();
        var userWords = userKeywords.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(w => w.Length > 2 && !stopWords.Contains(w))
            .ToHashSet();

        var commonWords = listingWords.Intersect(userWords).Count();

        return commonWords >= 2; // At least 2 meaningful words in common
    }

    private static string GenerateWeeklySummaryBody(
        string firstName,
        int newConnections,
        int newListings,
        int transactionsCompleted)
    {
        var parts = new List<string>();

        if (newConnections > 0)
            parts.Add($"{newConnections} new connection{(newConnections > 1 ? "s" : "")}");
        if (newListings > 0)
            parts.Add($"{newListings} listing{(newListings > 1 ? "s" : "")} created");
        if (transactionsCompleted > 0)
            parts.Add($"{transactionsCompleted} exchange{(transactionsCompleted > 1 ? "s" : "")} completed");

        return $"Great week, {firstName}! You had {string.Join(", ", parts)}. Keep up the great work!";
    }
}
