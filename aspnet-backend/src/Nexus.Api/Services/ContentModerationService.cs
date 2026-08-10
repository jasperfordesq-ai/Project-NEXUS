// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for automatic content moderation using AI.
/// Integrates with the AiService to moderate listings, posts, messages, and other content.
/// </summary>
public class ContentModerationService
{
    private readonly AiService _aiService;
    private readonly NexusDbContext _db;
    private readonly ILogger<ContentModerationService> _logger;

    // Severity thresholds for automatic actions
    private const string SEVERITY_BLOCK = "critical";
    private const string SEVERITY_FLAG = "high";
    private const string SEVERITY_WARN = "medium";

    public ContentModerationService(
        AiService aiService,
        NexusDbContext db,
        ILogger<ContentModerationService> logger)
    {
        _aiService = aiService;
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Moderate a listing before publication.
    /// Returns true if the listing passes moderation, false if it should be blocked.
    /// </summary>
    public async Task<ContentModerationOutcome> ModerateListingAsync(
        Listing listing,
        CancellationToken ct = default)
    {
        var content = $"Title: {listing.Title}\nDescription: {listing.Description ?? "N/A"}";
        return await SafeModerateAsync(content, "listing", listing.Id, $"listing {listing.Id}", ct);
    }

    /// <summary>
    /// Moderate a feed post before publication.
    /// </summary>
    public async Task<ContentModerationOutcome> ModerateFeedPostAsync(
        FeedPost post,
        CancellationToken ct = default)
    {
        return await SafeModerateAsync(post.Content, "post", post.Id, $"post {post.Id}", ct);
    }

    /// <summary>
    /// Moderate a message before sending.
    /// </summary>
    public async Task<ContentModerationOutcome> ModerateMessageAsync(
        string messageContent,
        int? messageId = null,
        CancellationToken ct = default)
    {
        return await SafeModerateAsync(messageContent, "message", messageId ?? 0, "message", ct);
    }

    /// <summary>
    /// Moderate a comment before posting.
    /// </summary>
    public async Task<ContentModerationOutcome> ModerateCommentAsync(
        string commentContent,
        CancellationToken ct = default)
    {
        return await SafeModerateAsync(commentContent, "comment", 0, "comment", ct);
    }

    /// <summary>
    /// Moderate user profile content (bio, skills, etc.).
    /// </summary>
    public async Task<ContentModerationOutcome> ModerateProfileAsync(
        string profileContent,
        int userId,
        CancellationToken ct = default)
    {
        return await SafeModerateAsync(profileContent, "profile", userId, $"profile {userId}", ct);
    }

    /// <summary>
    /// Batch moderate multiple pieces of content.
    /// </summary>
    public async Task<List<ContentModerationOutcome>> BatchModerateAsync(
        List<(string Content, string ContentType, int EntityId)> items,
        CancellationToken ct = default)
    {
        var outcomes = new List<ContentModerationOutcome>();

        foreach (var item in items)
        {
            var outcome = await SafeModerateAsync(
                item.Content, item.ContentType, item.EntityId,
                $"{item.ContentType} entity {item.EntityId}", ct);
            outcomes.Add(outcome);
        }

        return outcomes;
    }

    /// <summary>
    /// Create a notification for admins about flagged content.
    /// </summary>
    public async Task NotifyAdminsAboutFlaggedContent(
        string contentType,
        int entityId,
        string severity,
        List<string> issues,
        CancellationToken ct = default)
    {
        // Get admin users in the current tenant
        var admins = await _db.Users
            .Where(u => (u.Role == "admin" || u.Role == "super_admin") && u.IsActive)
            .ToListAsync(ct);

        foreach (var admin in admins)
        {
            var notification = new Notification
            {
                TenantId = admin.TenantId,
                UserId = admin.Id,
                Type = "content_flagged",
                Title = $"Content Flagged: {contentType}",
                Body = $"A {contentType} (ID: {entityId}) was flagged with severity '{severity}'. Issues: {string.Join(", ", issues)}",
                Data = System.Text.Json.JsonSerializer.Serialize(new
                {
                    contentType,
                    entityId,
                    severity,
                    issues
                }),
                CreatedAt = DateTime.UtcNow
            };

            _db.Notifications.Add(notification);
        }

        await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Safely moderate content with unified error handling.
    /// On AI service failure, content is allowed but flagged for manual review.
    /// </summary>
    private async Task<ContentModerationOutcome> SafeModerateAsync(
        string content,
        string contentType,
        int entityId,
        string logContext,
        CancellationToken ct)
    {
        try
        {
            var result = await _aiService.ModerateContent(content, contentType, ct);
            var outcome = ProcessModerationResult(result, contentType, entityId);

            _logger.LogInformation(
                "{ContentType} {LogContext} moderation: Approved={Approved}, Severity={Severity}",
                contentType, logContext, outcome.IsApproved, outcome.Severity);

            return outcome;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Moderation failed for {LogContext}, allowing with warning", logContext);
            return ModerationUnavailableOutcome();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Unexpected moderation failure for {LogContext}, allowing with warning", logContext);
            return ModerationUnavailableOutcome();
        }
    }

    /// <summary>
    /// Returns a default outcome when the moderation service is unavailable.
    /// Content is allowed but flagged for manual review.
    /// </summary>
    private static ContentModerationOutcome ModerationUnavailableOutcome() => new()
    {
        IsApproved = true,
        RequiresReview = true,
        Severity = "unknown",
        Message = "Moderation service unavailable, content allowed pending review"
    };

    /// <summary>
    /// Process the raw moderation result into an actionable outcome.
    /// </summary>
    private ContentModerationOutcome ProcessModerationResult(
        ModerationResult result,
        string contentType,
        int entityId)
    {
        var outcome = new ContentModerationOutcome
        {
            Severity = result.Severity,
            FlaggedIssues = result.FlaggedIssues,
            Suggestions = result.Suggestions
        };

        switch ((result.Severity ?? "none").ToLowerInvariant())
        {
            case "critical":
                outcome.IsApproved = false;
                outcome.RequiresReview = false;
                outcome.Message = "Content blocked: Critical policy violation detected";
                outcome.Action = ModerationAction.Block;
                break;

            case "high":
                outcome.IsApproved = false;
                outcome.RequiresReview = true;
                outcome.Message = "Content flagged for review: Potential policy violation";
                outcome.Action = ModerationAction.Flag;
                break;

            case "medium":
                outcome.IsApproved = true;
                outcome.RequiresReview = true;
                outcome.Message = "Content allowed with warning: Please review flagged issues";
                outcome.Action = ModerationAction.Warn;
                break;

            default:
                outcome.IsApproved = result.IsApproved;
                outcome.RequiresReview = false;
                outcome.Message = result.IsApproved ? "Content approved" : "Content not approved";
                outcome.Action = result.IsApproved ? ModerationAction.Allow : ModerationAction.Block;
                break;
        }

        return outcome;
    }
}

/// <summary>
/// Outcome of content moderation.
/// </summary>
public class ContentModerationOutcome
{
    /// <summary>
    /// Whether the content is approved for publication.
    /// </summary>
    public bool IsApproved { get; set; }

    /// <summary>
    /// Whether the content should be flagged for human review.
    /// </summary>
    public bool RequiresReview { get; set; }

    /// <summary>
    /// Severity level of any issues found.
    /// </summary>
    public string Severity { get; set; } = "none";

    /// <summary>
    /// Human-readable message about the moderation result.
    /// </summary>
    public string Message { get; set; } = "";

    /// <summary>
    /// Specific issues that were flagged.
    /// </summary>
    public List<string> FlaggedIssues { get; set; } = new();

    /// <summary>
    /// Suggestions for improving the content.
    /// </summary>
    public List<string> Suggestions { get; set; } = new();

    /// <summary>
    /// The recommended action to take.
    /// </summary>
    public ModerationAction Action { get; set; }
}

/// <summary>
/// Actions that can be taken based on moderation results.
/// </summary>
public enum ModerationAction
{
    Allow,    // Content is fine
    Warn,     // Content allowed but flagged for attention
    Flag,     // Content blocked pending review
    Block     // Content permanently blocked
}
