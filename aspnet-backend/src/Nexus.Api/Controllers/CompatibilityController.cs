// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Compatibility alias endpoints for frontend clients that call paths
/// differing from the canonical backend routes. Each endpoint delegates
/// to the same services/data used by the primary controllers.
/// </summary>
[ApiController]
[Authorize]
public class CompatibilityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly UserPreferencesService _preferencesService;
    private readonly MatchingService _matchingService;
    private readonly NexusScoreService _nexusScoreService;
    private readonly GdprService _gdprService;
    private readonly IdeationService _ideationService;
    private readonly VolunteerOrganisationService _volunteerOrganisations;
    private readonly ILogger<CompatibilityController> _logger;

    public CompatibilityController(
        NexusDbContext db,
        TenantContext tenantContext,
        UserPreferencesService preferencesService,
        MatchingService matchingService,
        NexusScoreService nexusScoreService,
        GdprService gdprService,
        IdeationService ideationService,
        VolunteerOrganisationService volunteerOrganisations,
        ILogger<CompatibilityController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _preferencesService = preferencesService;
        _matchingService = matchingService;
        _nexusScoreService = nexusScoreService;
        _gdprService = gdprService;
        _ideationService = ideationService;
        _volunteerOrganisations = volunteerOrganisations;
        _logger = logger;
    }

    // ──────────────────────────────────────────────
    // 1. PUT /api/users/me/notifications
    //    Alias for PUT /api/preferences/notifications
    // ──────────────────────────────────────────────

    /// <summary>
    /// PUT /api/users/me/notifications - Update notification preferences (alias).
    /// </summary>
    [HttpPut("api/users/me/notifications")]
    public async Task<IActionResult> UpdateNotificationPreferences(
        [FromBody] SetNotificationPreferenceRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.NotificationType))
            return BadRequest(new { error = "notification_type is required" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        try
        {
            var pref = await _preferencesService.SetNotificationPreferenceAsync(
                tenantId, userId.Value,
                request.NotificationType,
                request.EnableInApp,
                request.EnablePush,
                request.EnableEmail);

            return Ok(new
            {
                success = true,
                message = "Notification preference updated",
                preference = new
                {
                    notification_type = pref.NotificationType,
                    enable_in_app = pref.EnableInApp,
                    enable_push = pref.EnablePush,
                    enable_email = pref.EnableEmail,
                    updated_at = pref.UpdatedAt ?? pref.CreatedAt
                }
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    // ──────────────────────────────────────────────
    // 2. PUT /api/users/me/preferences
    //    Alias for PUT /api/preferences
    // ──────────────────────────────────────────────

    /// <summary>
    /// PUT /api/users/me/preferences - Update general preferences (alias).
    /// </summary>
    [HttpPut("api/users/me/preferences")]
    public async Task<IActionResult> UpdatePreferences([FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        try
        {
            var prefs = await _preferencesService.GetPreferencesAsync(tenantId, userId.Value);
            var user = await _db.Users.FirstOrDefaultAsync(u => u.TenantId == tenantId && u.Id == userId.Value);
            if (user == null) return NotFound(new { error = "User not found" });

            var bag = ParsePreferenceBag(user.NotificationPreferences);

            if (ReadString(body, "theme") is { } theme) prefs.Theme = theme;
            if (ReadString(body, "language") is { } language) prefs.Language = language;
            if (ReadString(body, "timezone") is { } timezone) prefs.Timezone = timezone;
            if (ReadString(body, "email_digest_frequency") is { } digest) prefs.EmailDigestFrequency = digest;

            if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("privacy", out var privacy) && privacy.ValueKind == JsonValueKind.Object)
            {
                var privacyProfile = ReadString(privacy, "privacy_profile");
                if (!string.IsNullOrWhiteSpace(privacyProfile))
                {
                    if (privacyProfile is not ("public" or "members" or "connections"))
                    {
                        return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "privacy.privacy_profile" });
                    }

                    prefs.ProfileVisibility = privacyProfile;
                }

                if (ReadBool(privacy, "privacy_search") is { } privacySearch)
                {
                    prefs.Searchable = privacySearch;
                }

                if (ReadBool(privacy, "privacy_contact") is { } privacyContact)
                {
                    bag["privacy_contact"] = privacyContact;
                }
            }

            if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("feed", out var feed) && feed.ValueKind == JsonValueKind.Object)
            {
                if (ReadBool(feed, "prefers_chronological") is { } chronological)
                {
                    bag["prefers_chronological_feed"] = chronological;
                }
            }

            if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("translation", out var translation) && translation.ValueKind == JsonValueKind.Object)
            {
                if (ReadBool(translation, "auto_translate_ugc") is { } autoTranslate)
                {
                    bag["auto_translate_ugc"] = autoTranslate;
                }

                if (ReadString(translation, "auto_translate_target_locale") is { } targetLocale)
                {
                    bag["auto_translate_target_locale"] = string.IsNullOrWhiteSpace(targetLocale)
                        ? null
                        : targetLocale.Trim()[..Math.Min(5, targetLocale.Trim().Length)];
                }
            }

            user.NotificationPreferences = bag.ToJsonString(new JsonSerializerOptions(JsonSerializerDefaults.Web));
            user.UpdatedAt = DateTime.UtcNow;
            prefs.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                data = BuildLaravelPreferences(prefs, user)
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    // ──────────────────────────────────────────────
    // 3. POST /api/users/me/password
    //    Authenticated password change (genuinely new)
    // ──────────────────────────────────────────────

    /// <summary>
    /// POST /api/users/me/password - Change password for the currently authenticated user.
    /// </summary>
    [HttpPost("api/users/me/password")]
    public async Task<IActionResult> ChangePassword(
        [FromBody] ChangePasswordRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.CurrentPassword))
            return BadRequest(new { error = "current_password is required" });

        if (string.IsNullOrWhiteSpace(request.NewPassword))
            return BadRequest(new { error = "new_password is required" });

        if (request.NewPassword.Length < 8)
            return BadRequest(new { error = "new_password must be at least 8 characters" });

        var user = await _db.Users.FindAsync(userId.Value);
        if (user == null) return NotFound(new { error = "User not found" });

        // Verify current password
        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
            return BadRequest(new { error = "Current password is incorrect" });

        // Update to new password
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} changed their password", userId.Value);

        return Ok(new { success = true, message = "Password changed successfully" });
    }

    // ──────────────────────────────────────────────
    // 4. DELETE /api/users/me
    //    Account deletion (soft-delete: sets IsActive = false)
    // ──────────────────────────────────────────────

    /// <summary>
    /// DELETE /api/compat/users/me - Legacy soft-delete compatibility endpoint.
    /// The Laravel-compatible /api/users/me and /api/v2/users/me routes are
    /// handled by UsersController.DeleteMe and require password re-authentication.
    /// </summary>
    [HttpDelete("api/compat/users/me")]
    public async Task<IActionResult> DeleteAccount()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var user = await _db.Users.FindAsync(userId.Value);
        if (user == null) return NotFound(new { error = "User not found" });

        user.IsActive = false;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} soft-deleted their account", userId.Value);

        return Ok(new { success = true, message = "Account has been deactivated" });
    }

    // ──────────────────────────────────────────────
    // 5. PUT /api/users/me/consent
    //    Alias for PUT /api/privacy/consents
    // ──────────────────────────────────────────────

    /// <summary>
    /// PUT /api/users/me/consent - Update a consent record (alias).
    /// </summary>
    [HttpPut("api/users/me/consent")]
    public async Task<IActionResult> UpdateConsent([FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var consentType = ReadString(body, "slug", "consent_type", "consent_type_slug")?.Trim();
        if (string.IsNullOrWhiteSpace(consentType))
            return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "slug" });

        var granted = ReadBool(body, "given", "is_granted", "granted") ?? false;

        var ipAddress = HttpContext.Connection.RemoteIpAddress?.ToString();

        var consent = await _gdprService.RecordConsentAsync(
            userId.Value, consentType, granted, ipAddress);

        return Ok(new
        {
            success = true,
            data = MapLaravelConsent(consent)
        });
    }

    // ──────────────────────────────────────────────
    // 6. GET /api/matches/all  +  POST /api/matches/{id}/dismiss
    //    Aliases for matching endpoints
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/matches/all - Get all matches for the current user (alias).
    /// </summary>
    [HttpGet("api/matches/all")]
    public async Task<IActionResult> GetAllMatches(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var (data, total) = await _matchingService.GetMatchesForUserAsync(userId.Value, page, limit);
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = data.Select(m => new
            {
                id = m.Id,
                matched_user = m.MatchedUser != null ? new
                {
                    id = m.MatchedUser.Id,
                    first_name = m.MatchedUser.FirstName,
                    last_name = m.MatchedUser.LastName,
                    level = m.MatchedUser.Level
                } : null,
                matched_listing = m.MatchedListing != null ? new
                {
                    id = m.MatchedListing.Id,
                    title = m.MatchedListing.Title,
                    type = m.MatchedListing.Type.ToString().ToLower()
                } : null,
                score = m.Score,
                status = m.Status.ToString().ToLower(),
                viewed_at = m.ViewedAt,
                responded_at = m.RespondedAt,
                created_at = m.CreatedAt
            }),
            pagination = new { page, limit, total, pages = totalPages }
        });
    }

    /// <summary>
    /// POST /api/matches/{id}/dismiss - Dismiss (decline) a match (alias).
    /// </summary>
    [HttpPost("api/matches/{id:int}/dismiss")]
    public async Task<IActionResult> DismissMatch(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (match, error) = await _matchingService.RespondToMatchAsync(id, userId.Value, MatchStatus.Declined);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            success = true,
            message = "Match dismissed",
            match = new
            {
                id = match!.Id,
                status = match.Status.ToString().ToLower(),
                responded_at = match.RespondedAt
            }
        });
    }

    // ──────────────────────────────────────────────
    // 7. GET /api/gamification/nexus-score
    //    Alias for GET /api/nexus-score/me
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/gamification/nexus-score - Get current user's NexusScore (alias).
    /// </summary>
    [HttpGet("api/gamification/nexus-score")]
    public async Task<IActionResult> GetNexusScore()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var score = await _nexusScoreService.GetScoreAsync(userId.Value);
        if (score == null)
            return Ok(new
            {
                data = new
                {
                    total_score = 0,
                    max_score = 1000,
                    percentage = 0,
                    percentile = 0,
                    tier = new { name = "Novice", icon = "seedling", color = "slate" },
                    breakdown = Array.Empty<object>(),
                    insights = new[] { "Complete exchanges and earn reviews to build your NexusScore." }
                },
                message = "Score not yet calculated"
            });

        static object Category(string key, string label, int value, int max) => new
        {
            key,
            label,
            score = value,
            max,
            percentage = max > 0 ? Math.Round(value / (double)max * 100, 1) : 0,
            details = new { }
        };

        return Ok(new
        {
            data = new
            {
                user_id = score.UserId,
                total_score = score.Score,
                max_score = 1000,
                percentage = Math.Round(score.Score / 1000d * 100, 1),
                percentile = 0,
                tier = new
                {
                    name = score.Tier,
                    icon = score.Tier.ToLowerInvariant(),
                    color = score.Tier.ToLowerInvariant()
                },
                exchange_score = score.ExchangeScore,
                review_score = score.ReviewScore,
                engagement_score = score.EngagementScore,
                reliability_score = score.ReliabilityScore,
                tenure_score = score.TenureScore,
                last_calculated_at = score.LastCalculatedAt,
                breakdown = new[]
                {
                    Category("engagement", "Engagement", score.EngagementScore, 200),
                    Category("quality", "Reviews", score.ReviewScore, 200),
                    Category("activity", "Exchanges", score.ExchangeScore, 250),
                    Category("reliability", "Reliability", score.ReliabilityScore, 200),
                    Category("impact", "Tenure", score.TenureScore, 150)
                },
                insights = new[] { "Keep exchanging, reviewing, and taking part to improve your score." }
            }
        });
    }

    // ──────────────────────────────────────────────
    // 8. GET /api/skills/categories
    //    Return skill categories from the database
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/skills/categories - Get skill categories (distinct categories that have skills).
    /// </summary>
    [HttpGet("api/skills/categories")]
    public async Task<IActionResult> GetSkillCategories()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Return categories that have at least one skill linked to them
        var categories = await _db.Categories
            .AsNoTracking()
            .Where(c => c.IsActive)
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                slug = c.Slug,
                description = c.Description,
                parent_category_id = c.ParentCategoryId,
                sort_order = c.SortOrder
            })
            .ToListAsync();

        return Ok(new { data = categories, total = categories.Count });
    }

    // ──────────────────────────────────────────────
    // 9. GET /api/onboarding/categories
    //    Return listing categories for onboarding interest selection
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/onboarding/categories - Get listing categories for interest selection during onboarding.
    /// </summary>
    [HttpGet("api/onboarding/categories")]
    public async Task<IActionResult> GetOnboardingCategories()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var categories = await _db.Categories
            .AsNoTracking()
            .Where(c => c.IsActive)
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                slug = c.Slug,
                description = c.Description,
                parent_category_id = c.ParentCategoryId
            })
            .ToListAsync();

        return Ok(new { data = categories, total = categories.Count });
    }

    /// <summary>
    /// GET /api/v2/onboarding/categories - V2 alias for onboarding category selection.
    /// </summary>
    [HttpGet("api/v2/onboarding/categories")]
    public Task<IActionResult> GetV2OnboardingCategories() => GetOnboardingCategories();

    // POST /api/v2/onboarding/complete is owned by OnboardingController through
    // AdminV2RouteAliasConvention. Keep a single owner to avoid ambiguous matches.

    // ──────────────────────────────────────────────
    // 10. Hashtags — /api/feed/hashtags/*
    //     Frontend calls /api/feed/hashtags/trending and /search
    //     Backend canonical: /api/hashtags/*
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/feed/hashtags/trending - Get trending hashtags (alias).
    /// </summary>
    [HttpGet("api/feed/hashtags/trending")]
    public async Task<IActionResult> GetTrendingHashtags([FromQuery] int limit = 20)
    {
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var hashtags = await _db.Hashtags
            .AsNoTracking()
            .OrderByDescending(h => h.UsageCount)
            .ThenByDescending(h => h.LastUsedAt)
            .Take(limit)
            .Select(h => new
            {
                id = h.Id,
                tag = h.Tag,
                usage_count = h.UsageCount,
                last_used_at = h.LastUsedAt
            })
            .ToListAsync();

        return Ok(new { data = hashtags, total = hashtags.Count });
    }

    /// <summary>
    /// GET /api/feed/hashtags/search - Search hashtags (alias).
    /// </summary>
    [HttpGet("api/feed/hashtags/search")]
    public async Task<IActionResult> SearchHashtags(
        [FromQuery] string? q = null,
        [FromQuery] int limit = 20)
    {
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Hashtags.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower().TrimStart('#');
            query = query.Where(h => h.Tag.Contains(term));
        }

        var hashtags = await query
            .OrderByDescending(h => h.UsageCount)
            .Take(limit)
            .Select(h => new
            {
                id = h.Id,
                tag = h.Tag,
                usage_count = h.UsageCount,
                last_used_at = h.LastUsedAt
            })
            .ToListAsync();

        return Ok(new { data = hashtags, total = hashtags.Count });
    }

    // ──────────────────────────────────────────────
    // 11. Federation — /api/federation/*
    //     Frontend calls /api/federation/*, backend has /api/v1/federation/*
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/federation/connections - List federation partners (alias).
    /// </summary>
    [HttpGet("api/federation/connections")]
    public async Task<IActionResult> GetFederationConnections(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.FederationPartners
            .AsNoTracking()
            .Include(f => f.PartnerTenant);

        var total = await query.CountAsync();
        var partners = await query
            .OrderByDescending(f => f.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(f => new
            {
                id = f.Id,
                partner_tenant_id = f.PartnerTenantId,
                partner_name = f.PartnerTenant != null ? f.PartnerTenant.Name : null,
                status = f.Status.ToString().ToLower(),
                shared_listings = f.SharedListings,
                shared_events = f.SharedEvents,
                shared_members = f.SharedMembers,
                credit_exchange_rate = f.CreditExchangeRate,
                approved_at = f.ApprovedAt,
                created_at = f.CreatedAt
            })
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = partners,
            pagination = new { page, limit, total, pages = totalPages }
        });
    }

    /// <summary>
    /// GET /api/federation/hub - Federation stats overview (alias).
    /// </summary>
    [HttpGet("api/federation/hub")]
    public async Task<IActionResult> GetFederationHub()
    {
        var totalPartners = await _db.FederationPartners.CountAsync();
        var activePartners = await _db.FederationPartners.CountAsync(f => f.Status == PartnerStatus.Active);
        var pendingPartners = await _db.FederationPartners.CountAsync(f => f.Status == PartnerStatus.Pending);

        return Ok(new
        {
            data = new
            {
                total_partners = totalPartners,
                active_partners = activePartners,
                pending_partners = pendingPartners
            }
        });
    }

    // ──────────────────────────────────────────────
    // 12. Ideation — /api/ideation-challenges, /api/ideation-ideas, /api/ideation-categories
    //     Frontend calls /api/ideation-*, backend has /api/challenges, /api/ideas
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/ideation-challenges - List challenges (alias).
    /// </summary>
    [HttpGet("api/ideation-challenges")]
    public async Task<IActionResult> GetIdeationChallenges(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] bool? active_only = null)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Challenges.AsNoTracking().AsQueryable();
        if (active_only == true)
            query = query.Where(c => c.IsActive && c.EndsAt > DateTime.UtcNow);

        var total = await query.CountAsync();
        var challenges = await query
            .OrderByDescending(c => c.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(c => new
            {
                id = c.Id,
                title = c.Title,
                description = c.Description,
                challenge_type = c.ChallengeType.ToString().ToLower(),
                difficulty = c.Difficulty.ToString().ToLower(),
                target_action = c.TargetAction,
                target_count = c.TargetCount,
                xp_reward = c.XpReward,
                starts_at = c.StartsAt,
                ends_at = c.EndsAt,
                is_active = c.IsActive,
                max_participants = c.MaxParticipants,
                created_at = c.CreatedAt
            })
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = challenges,
            pagination = new { page, limit, total, pages = totalPages }
        });
    }

    /// <summary>
    /// GET /api/ideation-ideas - List ideas (alias).
    /// </summary>
    [HttpGet("api/ideation-ideas")]
    public async Task<IActionResult> GetIdeationIdeas(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? status = null,
        [FromQuery] string? sort = "newest")
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Ideas.AsNoTracking().Include(i => i.Author).AsQueryable();

        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(i => i.Status == status);

        query = sort switch
        {
            "popular" => query.OrderByDescending(i => i.UpvoteCount),
            "oldest" => query.OrderBy(i => i.CreatedAt),
            _ => query.OrderByDescending(i => i.CreatedAt)
        };

        var total = await query.CountAsync();
        var ideas = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(i => new
            {
                id = i.Id,
                title = i.Title,
                content = i.Content,
                category = i.Category,
                status = i.Status,
                upvote_count = i.UpvoteCount,
                comment_count = i.CommentCount,
                author = i.Author != null ? new
                {
                    id = i.Author.Id,
                    first_name = i.Author.FirstName,
                    last_name = i.Author.LastName
                } : null,
                created_at = i.CreatedAt,
                updated_at = i.UpdatedAt
            })
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = ideas,
            pagination = new { page, limit, total, pages = totalPages }
        });
    }

    /// <summary>
    /// GET /api/ideation-categories - List idea categories (alias).
    /// Returns distinct category values used in ideas.
    /// </summary>
    [HttpGet("api/ideation-categories")]
    public IActionResult GetIdeationCategories()
    {
        var data = IdeationBootstrapCompatibility.Categories
            .OrderBy(category => category.SortOrder)
            .ThenBy(category => category.Name)
            .ToArray();

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// POST /api/ideation-ideas - Create a new idea (alias).
    /// </summary>
    [HttpPost("api/ideation-ideas")]
    public async Task<IActionResult> CreateIdeationIdea([FromBody] CreateIdeaRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "title is required" });
        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { error = "content is required" });

        var (idea, error) = await _ideationService.CreateIdeaAsync(
            userId.Value, request.Title, request.Content, request.Category);

        if (error != null) return BadRequest(new { error });

        return Ok(new
        {
            success = true,
            data = new
            {
                id = idea!.Id,
                title = idea.Title,
                content = idea.Content,
                category = idea.Category,
                status = idea.Status,
                created_at = idea.CreatedAt
            }
        });
    }

    /// <summary>
    /// POST /api/ideation-ideas/{id}/vote - Vote on an idea (alias).
    /// </summary>
    [HttpPost("api/ideation-ideas/{id:int}/vote")]
    public async Task<IActionResult> VoteOnIdea(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _ideationService.VoteIdeaAsync(id, userId.Value);
        if (error != null) return BadRequest(new { error });

        return Ok(new { success = true, message = "Vote recorded" });
    }

    // ──────────────────────────────────────────────
    // 13. Knowledge Base — /api/kb/*
    //     Frontend calls /api/kb/*, backend has /api/knowledge/*
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/kb - List knowledge base articles (alias).
    /// </summary>
    [HttpGet("api/kb")]
    public async Task<IActionResult> GetKnowledgeBaseArticles(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? category = null,
        [FromQuery] string? q = null)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.KnowledgeArticles
            .AsNoTracking()
            .Where(a => a.IsPublished);

        if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(a => a.Category == category);

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower();
            query = query.Where(a =>
                a.Title.ToLower().Contains(term) ||
                (a.Tags != null && a.Tags.ToLower().Contains(term)));
        }

        var total = await query.CountAsync();
        var articles = await query
            .OrderBy(a => a.SortOrder)
            .ThenByDescending(a => a.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(a => new
            {
                id = a.Id,
                title = a.Title,
                slug = a.Slug,
                category = a.Category,
                tags = a.Tags,
                sort_order = a.SortOrder,
                view_count = a.ViewCount,
                created_at = a.CreatedAt,
                updated_at = a.UpdatedAt
            })
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = articles,
            pagination = new { page, limit, total, pages = totalPages }
        });
    }

    /// <summary>
    /// GET /api/kb/categories - List KB article categories (alias).
    /// </summary>
    [HttpGet("api/kb/categories")]
    public async Task<IActionResult> GetKbCategories()
    {
        var categories = await _db.KnowledgeArticles
            .AsNoTracking()
            .Where(a => a.IsPublished && a.Category != null && a.Category != "")
            .GroupBy(a => a.Category!)
            .Select(g => new
            {
                name = g.Key,
                slug = g.Key.ToLower().Replace(" ", "-"),
                article_count = g.Count()
            })
            .OrderBy(c => c.name)
            .ToListAsync();

        return Ok(new { data = categories, total = categories.Count });
    }

    /// <summary>
    /// GET /api/kb/{slug} - Get knowledge base article by slug (alias).
    /// </summary>
    [HttpGet("api/kb/{slug}")]
    public async Task<IActionResult> GetKbArticleBySlug(string slug)
    {
        var article = await _db.KnowledgeArticles
            .AsNoTracking()
            .Where(a => a.IsPublished && a.Slug == slug)
            .Select(a => new
            {
                id = a.Id,
                title = a.Title,
                slug = a.Slug,
                content = a.Content,
                category = a.Category,
                tags = a.Tags,
                sort_order = a.SortOrder,
                view_count = a.ViewCount,
                created_at = a.CreatedAt,
                updated_at = a.UpdatedAt
            })
            .FirstOrDefaultAsync();

        if (article == null)
            return NotFound(new { error = "Article not found" });

        return Ok(new { data = article });
    }

    // ──────────────────────────────────────────────
    // 14. Organisations — /api/volunteering/organisations/*
    //     Frontend calls /api/volunteering/organisations, backend has /api/organisations
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/volunteering/organisations - List organisations (alias).
    /// </summary>
    [HttpGet("api/volunteering/organisations")]
    [AllowAnonymous]
    public async Task<IActionResult> GetVolunteeringOrganisations(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? type = null,
        [FromQuery] string? q = null)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { errors = new[] { new { code = "TENANT_CONTEXT_REQUIRED", message = "Tenant context required" } } });
        SetVolunteerOrganisationHeaders(tenantId.Value);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId.Value, HttpContext.RequestAborted))
            return StatusCode(403, new { errors = new[] { new { code = "FEATURE_DISABLED", message = "Volunteering module is not enabled for this community" } } });

        limit = Math.Clamp(
            int.TryParse(Request.Query["per_page"].FirstOrDefault(), out var perPage) ? perPage : limit,
            1,
            50);
        var search = Request.Query["search"].FirstOrDefault() ?? q;
        var cursor = DecodeCursor(Request.Query["cursor"].FirstOrDefault());
        var query = _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(org => org.TenantId == tenantId.Value
                && (org.Status == "approved" || org.Status == "active"));
        if (!string.IsNullOrWhiteSpace(type))
            query = query.Where(org => org.OrgType == type);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(org => org.Name.ToLower().Contains(term)
                || (org.Description != null && org.Description.ToLower().Contains(term)));
        }
        if (cursor.HasValue)
            query = query.Where(org => org.Id < cursor.Value);

        var organizations = await query
            .OrderByDescending(org => org.Id)
            .Take(limit + 1)
            .Select(org => new
            {
                org.Id,
                org.Name,
                org.Slug,
                org.Description,
                org.LogoUrl,
                org.Website,
                org.ContactEmail,
                org.Location,
                org.Status,
                org.OrgType,
                org.CreatedAt,
                org.UpdatedAt,
                OwnerName = org.OwnerUser == null
                    ? null
                    : (org.OwnerUser.FirstName + " " + org.OwnerUser.LastName).Trim(),
                OwnerAvatarUrl = org.OwnerUser == null ? null : org.OwnerUser.AvatarUrl
            })
            .ToListAsync(HttpContext.RequestAborted);
        var hasMore = organizations.Count > limit;
        if (hasMore) organizations.RemoveAt(organizations.Count - 1);
        var data = new List<object>(organizations.Count);
        foreach (var org in organizations)
        {
            var stats = await _volunteerOrganisations.GetAsync(
                org.Id,
                tenantId.Value,
                includeNonPublic: false,
                HttpContext.RequestAborted);
            data.Add(new
            {
                id = org.Id,
                name = org.Name,
                slug = org.Slug,
                description = org.Description,
                logo_url = org.LogoUrl,
                website = org.Website,
                contact_email = org.ContactEmail,
                location = org.Location,
                status = org.Status,
                org_type = org.OrgType ?? "organisation",
                created_at = org.CreatedAt,
                updated_at = org.UpdatedAt,
                owner = new { display_name = org.OwnerName, avatar_url = org.OwnerAvatarUrl },
                opportunity_count = stats?.OpportunityCount ?? 0,
                volunteer_count = stats?.VolunteerCount ?? 0,
                total_hours = stats?.TotalHours ?? 0m,
                review_count = stats?.ReviewCount ?? 0,
                average_rating = stats?.AverageRating ?? 0m
            });
        }
        var nextCursor = hasMore && organizations.Count > 0
            ? EncodeCursor(organizations[^1].Id)
            : null;

        return Ok(new
        {
            data,
            meta = new
            {
                base_url = await VolunteerOrganisationBaseUrlAsync(tenantId.Value),
                cursor = nextCursor,
                per_page = limit,
                has_more = hasMore
            }
        });
    }

    /// <summary>
    /// GET /api/volunteering/organisations/{id} - Get organisation by ID (alias).
    /// </summary>
    [HttpGet("api/volunteering/organisations/{id:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetVolunteeringOrganisation(int id)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { errors = new[] { new { code = "TENANT_CONTEXT_REQUIRED", message = "Tenant context required" } } });
        SetVolunteerOrganisationHeaders(tenantId.Value);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId.Value, HttpContext.RequestAborted))
            return StatusCode(403, new { errors = new[] { new { code = "FEATURE_DISABLED", message = "Volunteering module is not enabled for this community" } } });

        var org = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.Id == id
                && row.TenantId == tenantId.Value
                && (row.Status == "approved" || row.Status == "active"))
            .Select(row => new
            {
                row.Id,
                row.Name,
                row.Slug,
                row.Description,
                row.LogoUrl,
                row.Website,
                row.ContactEmail,
                row.Location,
                row.Status,
                row.OrgType,
                row.CreatedAt,
                row.UpdatedAt,
                OwnerName = row.OwnerUser == null
                    ? null
                    : (row.OwnerUser.FirstName + " " + row.OwnerUser.LastName).Trim(),
                OwnerAvatarUrl = row.OwnerUser == null ? null : row.OwnerUser.AvatarUrl
            })
            .SingleOrDefaultAsync(HttpContext.RequestAborted);
        if (org is null)
            return NotFound(new { errors = new[] { new { code = "NOT_FOUND", message = "Organization not found" } } });

        var stats = await _volunteerOrganisations.GetAsync(
            id,
            tenantId.Value,
            includeNonPublic: false,
            HttpContext.RequestAborted);
        return Ok(new
        {
            data = new
            {
                id = org.Id,
                name = org.Name,
                slug = org.Slug,
                description = org.Description,
                logo_url = org.LogoUrl,
                website = org.Website,
                contact_email = org.ContactEmail,
                location = org.Location,
                status = org.Status,
                org_type = org.OrgType ?? "organisation",
                created_at = org.CreatedAt,
                updated_at = org.UpdatedAt,
                owner = new { display_name = org.OwnerName, avatar_url = org.OwnerAvatarUrl },
                opportunity_count = stats?.OpportunityCount ?? 0,
                opportunities_count = stats?.OpportunityCount ?? 0,
                volunteer_count = stats?.VolunteerCount ?? 0,
                total_volunteers = stats?.VolunteerCount ?? 0,
                total_hours = stats?.TotalHours ?? 0m,
                review_count = stats?.ReviewCount ?? 0,
                average_rating = stats?.AverageRating ?? 0m
            },
            meta = new { base_url = await VolunteerOrganisationBaseUrlAsync(tenantId.Value) }
        });
    }

    // ──────────────────────────────────────────────
    // 15. Leaderboard seasons — /api/gamification/seasons/*
    //     Frontend calls /api/gamification/seasons/*, backend has /api/gamification/v2/seasons/*
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/gamification/seasons - List leaderboard seasons (alias).
    /// </summary>
    [HttpGet("api/gamification/seasons")]
    public async Task<IActionResult> GetLeaderboardSeasons(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.LeaderboardSeasons.AsNoTracking();

        var total = await query.CountAsync();
        var seasons = await query
            .OrderByDescending(s => s.StartsAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(s => new
            {
                id = s.Id,
                name = s.Name,
                starts_at = s.StartsAt,
                ends_at = s.EndsAt,
                status = s.Status.ToString().ToLower(),
                prize_description = s.PrizeDescription,
                created_at = s.CreatedAt
            })
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = seasons,
            pagination = new { page, limit, total, pages = totalPages }
        });
    }

    /// <summary>
    /// GET /api/gamification/seasons/current - Get current active season (alias).
    /// </summary>
    [HttpGet("api/gamification/seasons/current")]
    public async Task<IActionResult> GetCurrentSeason()
    {
        var now = DateTime.UtcNow;
        var season = await _db.LeaderboardSeasons
            .AsNoTracking()
            .Where(s => s.Status == SeasonStatus.Active || (s.StartsAt <= now && s.EndsAt >= now))
            .OrderByDescending(s => s.StartsAt)
            .Select(s => new
            {
                id = s.Id,
                name = s.Name,
                starts_at = s.StartsAt,
                ends_at = s.EndsAt,
                status = s.Status.ToString().ToLower(),
                prize_description = s.PrizeDescription,
                created_at = s.CreatedAt
            })
            .FirstOrDefaultAsync();

        if (season == null)
            return NotFound(new { error = "No active season found" });

        return Ok(new { data = season });
    }

    // ──────────────────────────────────────────────
    // 16. Settings sub-routes — /api/users/me/*
    //     Frontend calls /api/users/me/* for settings reads
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/users/me/notifications - Get notification preferences (alias).
    /// </summary>
    [HttpGet("api/users/me/notifications")]
    public async Task<IActionResult> GetNotificationPreferences()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var prefs = await _preferencesService.GetNotificationPreferencesAsync(tenantId, userId.Value);

        return Ok(new
        {
            data = prefs.Select(p => new
            {
                notification_type = p.NotificationType,
                enable_in_app = p.EnableInApp,
                enable_push = p.EnablePush,
                enable_email = p.EnableEmail,
                updated_at = p.UpdatedAt ?? p.CreatedAt
            })
        });
    }

    /// <summary>
    /// GET /api/users/me/preferences - Get user preferences (alias).
    /// </summary>
    [HttpGet("api/users/me/preferences")]
    public async Task<IActionResult> GetPreferences()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var prefs = await _preferencesService.GetPreferencesAsync(tenantId, userId.Value);
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.TenantId == tenantId && u.Id == userId.Value);
        if (user == null) return NotFound(new { error = "User not found" });

        return Ok(new
        {
            success = true,
            data = BuildLaravelPreferences(prefs, user)
        });
    }

    /// <summary>
    /// GET /api/users/me/sessions - Get active sessions for current user (alias).
    /// </summary>
    [HttpGet("api/users/me/sessions")]
    public async Task<IActionResult> GetMySessions()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var rows = await _db.UserSessions
            .AsNoTracking()
            .Where(s => s.UserId == userId.Value && s.IsActive && s.ExpiresAt > DateTime.UtcNow)
            .OrderByDescending(s => s.LastActivityAt)
            .Select(s => new
            {
                s.Id,
                s.IpAddress,
                s.UserAgent,
                s.DeviceInfo,
                s.CreatedAt,
                s.LastActivityAt,
                s.ExpiresAt
            })
            .ToListAsync();
        var sessions = rows.Select(s => new
        {
            id = s.Id,
            device = string.IsNullOrWhiteSpace(s.DeviceInfo) ? "Unknown device" : s.DeviceInfo,
            browser = ParseSessionBrowser(s.UserAgent),
            ip_address = s.IpAddress,
            user_agent = s.UserAgent,
            device_info = s.DeviceInfo,
            last_active = s.LastActivityAt,
            is_current = false,
            created_at = s.CreatedAt,
            last_activity_at = s.LastActivityAt,
            expires_at = s.ExpiresAt
        }).ToList();

        return Ok(new { success = true, data = sessions, total = sessions.Count });
    }

    /// <summary>
    /// GET /api/users/me/consent - Get consent records for current user (alias).
    /// </summary>
    [HttpGet("api/users/me/consent")]
    public async Task<IActionResult> GetMyConsent()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var consents = await _gdprService.GetUserConsentsAsync(userId.Value);

        return Ok(new
        {
            success = true,
            data = consents.Select(MapLaravelConsent)
        });
    }

    /// <summary>
    /// GET /api/users/me/skills - Get skills for current user (alias).
    /// </summary>
    [HttpGet("api/users/me/skills")]
    public async Task<IActionResult> GetMySkills()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var skills = await _db.UserSkills
            .AsNoTracking()
            .Where(us => us.TenantId == _tenantContext.GetTenantIdOrThrow() && us.UserId == userId.Value)
            .Include(us => us.Skill)
            .ThenInclude(skill => skill!.Category)
            .OrderBy(us => us.Skill!.Name)
            .ToListAsync();

        var data = skills.Select(us => new
            {
                id = us.Id,
                user_id = us.UserId,
                tenant_id = us.TenantId,
                skill_id = us.SkillId,
                category_id = us.Skill?.CategoryId,
                skill_name = us.Skill?.Name ?? string.Empty,
                category_name = us.Skill?.Category?.Name,
                category_slug = us.Skill?.Category?.Slug,
                proficiency_level = us.ProficiencyLevel.ToString().ToLowerInvariant(),
                is_offering = true,
                is_requesting = false,
                endorsement_count = us.EndorsementCount,
                created_at = us.CreatedAt
            })
            .ToList();

        return Ok(new { data, total = data.Count });
    }

    /// <summary>
    /// GET /api/users/me/insurance - Get insurance certificates for current user (alias).
    /// </summary>
    [HttpGet("api/users/me/insurance")]
    public async Task<IActionResult> GetMyInsurance()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var certs = await _db.InsuranceCertificates
            .AsNoTracking()
            .Where(c => c.UserId == userId.Value)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                id = c.Id,
                type = c.Type,
                provider = c.Provider,
                policy_number = c.PolicyNumber,
                cover_amount = c.CoverAmount,
                start_date = c.StartDate,
                expiry_date = c.ExpiryDate,
                document_url = c.DocumentUrl,
                status = c.Status,
                verified_at = c.VerifiedAt,
                created_at = c.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = certs, total = certs.Count });
    }

    /// <summary>
    /// POST /api/users/me/gdpr-request - Create a GDPR export or deletion request (alias).
    /// </summary>
    [HttpPost("api/users/me/gdpr-request")]
    public async Task<IActionResult> CreateGdprRequest([FromBody] GdprRequestDto request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Type))
            return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "type" });

        try
        {
            var type = request.Type.Trim().ToLowerInvariant();
            if (type is "access" or "portability")
            {
                var export = await _gdprService.RequestDataExportAsync(
                    userId.Value, request.Format ?? "json");
                return StatusCode(201, new
                {
                    success = true,
                    data = new
                    {
                        request_id = export.Id,
                        type,
                        status = export.Status.ToString().ToLowerInvariant(),
                        message = "GDPR request submitted"
                    }
                });
            }
            else if (type is "erasure")
            {
                var deletion = await _gdprService.RequestDataDeletionAsync(
                    userId.Value, request.Notes ?? request.Reason);
                return StatusCode(201, new
                {
                    success = true,
                    data = new
                    {
                        request_id = deletion.Id,
                        type,
                        status = deletion.Status.ToString().ToLowerInvariant(),
                        message = "GDPR request submitted"
                    }
                });
            }
            else if (type is "rectification" or "restriction" or "objection")
            {
                var export = await _gdprService.RequestDataExportAsync(
                    userId.Value, request.Format ?? "json");
                return StatusCode(201, new
                {
                    success = true,
                    data = new
                    {
                        request_id = export.Id,
                        type,
                        status = export.Status.ToString().ToLowerInvariant(),
                        message = "GDPR request submitted"
                    }
                });
            }
            else
            {
                return BadRequest(new { success = false, error = "VALIDATION_ERROR", field = "type" });
            }
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    // ──────────────────────────────────────────────
    // 17. Skills browse — /api/skills/categories/{id}, /api/skills/members
    //     Note: GET /api/skills/categories already exists above (#8)
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/skills/categories/{id} - Get skills in a specific category (alias).
    /// </summary>
    [HttpGet("api/skills/categories/{id:int}")]
    public async Task<IActionResult> GetSkillsInCategory(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var category = await _db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
        if (category == null) return NotFound(new { error = "Category not found" });

        var skills = await _db.Skills
            .AsNoTracking()
            .Where(s => s.CategoryId == id)
            .OrderBy(s => s.Name)
            .Select(s => new
            {
                id = s.Id,
                name = s.Name,
                slug = s.Slug,
                description = s.Description,
                is_verifiable = s.IsVerifiable,
                category_id = s.CategoryId
            })
            .ToListAsync();

        return Ok(new
        {
            category = new { id = category.Id, name = category.Name, slug = category.Slug },
            data = skills,
            total = skills.Count
        });
    }

    /// <summary>
    /// GET /api/skills/members - Get members with matching skills (alias).
    /// </summary>
    [HttpGet("api/skills/members")]
    public async Task<IActionResult> GetSkillMembers(
        [FromQuery] int? skill_id = null,
        [FromQuery] string? q = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.UserSkills
            .AsNoTracking()
            .Include(us => us.User)
            .Include(us => us.Skill)
            .Where(us => us.User != null && us.User.IsActive);

        if (skill_id.HasValue)
            query = query.Where(us => us.SkillId == skill_id.Value);

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower();
            query = query.Where(us =>
                (us.Skill != null && us.Skill.Name.ToLower().Contains(term)) ||
                (us.User != null && (us.User.FirstName.ToLower().Contains(term) || us.User.LastName.ToLower().Contains(term))));
        }

        var total = await query.Select(us => us.UserId).Distinct().CountAsync();
        var members = await query
            .OrderByDescending(us => us.EndorsementCount)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(us => new
            {
                user_id = us.UserId,
                first_name = us.User != null ? us.User.FirstName : null,
                last_name = us.User != null ? us.User.LastName : null,
                skill_id = us.SkillId,
                skill_name = us.Skill != null ? us.Skill.Name : null,
                proficiency_level = us.ProficiencyLevel.ToString().ToLower(),
                is_verified = us.IsVerified,
                endorsement_count = us.EndorsementCount
            })
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = members,
            pagination = new { page, limit, total, pages = totalPages }
        });
    }

    // ──────────────────────────────────────────────
    // TENANT BOOTSTRAP (P0 — required for all pages)
    // Frontend calls GET /api/tenant/bootstrap?slug=xxx
    // Returns tenant config, features, branding, categories
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/tenant/bootstrap — Tenant bootstrap endpoint for React frontend.
    /// Returns tenant config including features, modules, branding, categories,
    /// and compliance settings. Called on every page load (no auth required).
    /// </summary>
    [HttpGet("api/tenant/bootstrap")]
    [HttpGet("api/v2/tenant/bootstrap")]
    [AllowAnonymous]
    public async Task<IActionResult> TenantBootstrap([FromQuery] string? slug = null)
    {
        Tenant? tenant = null;

        // Laravel TRS-001: an explicit slug is authoritative. Unknown,
        // whitespace-only, and inactive slugs fail closed instead of falling
        // through to a header, host, origin, or arbitrary default tenant.
        if (slug is { Length: > 0 })
        {
            var normalizedSlug = slug.Trim();
            tenant = await _db.Tenants
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Slug == normalizedSlug && t.IsActive);

            if (tenant == null)
            {
                Response.Headers["API-Version"] = "2.0";
                return NotFound(new
                {
                    errors = new[]
                    {
                        new
                        {
                            code = "TENANT_NOT_FOUND",
                            message = "The requested community was not found or is inactive."
                        }
                    }
                });
            }
        }
        else
        {
            // Laravel resolves a custom Host before considering Origin. Strip
            // the conventional www alias because tenant domains are stored as
            // their canonical host names.
            var requestHost = NormalizeTenantHost(Request.Host.Host);
            tenant = await FindActiveTenantByDomainAsync(requestHost);

            // Origin is only a fallback while Host is unresolved or resolved
            // to the platform/master tenant. It must never override a custom
            // tenant Host, which would allow cross-community bootstrap drift.
            if (tenant is null || tenant.Id <= 1)
            {
                var origin = Request.Headers["Origin"].FirstOrDefault();
                if (Uri.TryCreate(origin, UriKind.Absolute, out var originUri))
                {
                    var originTenant = await FindActiveTenantByDomainAsync(
                        NormalizeTenantHost(originUri.Host),
                        excludeMaster: true);
                    if (originTenant is not null)
                    {
                        tenant = originTenant;
                    }
                }
            }

            // Preserve the public API's explicit numeric tenant compatibility
            // only when neither Host nor Origin selected a non-master tenant.
            if (tenant is null || tenant.Id <= 1)
            {
                var headerTenantId = Request.Headers["X-Tenant-ID"].FirstOrDefault();
                if (int.TryParse(headerTenantId, out var tenantId))
                {
                    var headerTenant = await _db.Tenants
                        .IgnoreQueryFilters()
                        .AsNoTracking()
                        .FirstOrDefaultAsync(t => t.Id == tenantId && t.IsActive);
                    if (headerTenant is not null)
                    {
                        tenant = headerTenant;
                    }
                }
            }

            if (tenant == null)
            {
                // Shared-host/default landing behavior remains compatible for
                // deployments without an explicit tenant selector.
                tenant = await _db.Tenants
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(t => t.IsActive)
                    .OrderBy(t => t.Id)
                    .FirstOrDefaultAsync();
            }
        }

        if (tenant == null)
        {
            return NotFound(new { error = "No active tenant found" });
        }

        // Load tenant config key-value pairs
        var configEntries = await _db.Set<TenantConfig>()
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenant.Id)
            .ToDictionaryAsync(c => c.Key, c => c.Value);

        // Load categories for this tenant
        var categories = await _db.Categories
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenant.Id)
            .OrderBy(c => c.Name)
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                slug = c.Slug,
                icon = (string?)null,
                color = (string?)null
            })
            .ToListAsync();

        // Build features object from config entries (feature.xxx keys)
        var features = new Dictionary<string, bool>
        {
            ["events"] = GetConfigBool(configEntries, "feature.events", true),
            ["groups"] = GetConfigBool(configEntries, "feature.groups", true),
            ["gamification"] = GetConfigBool(configEntries, "feature.gamification", true),
            ["goals"] = GetConfigBool(configEntries, "feature.goals", true),
            ["blog"] = GetConfigBool(configEntries, "feature.blog", true),
            ["resources"] = GetConfigBool(configEntries, "feature.resources", true),
            ["volunteering"] = GetConfigBool(configEntries, "feature.volunteering", true),
            ["exchange_workflow"] = GetConfigBool(configEntries, "feature.exchange_workflow", true),
            ["organisations"] = GetConfigBool(configEntries, "feature.organisations", true),
            ["federation"] = GetConfigBool(configEntries, "feature.federation", true),
            ["connections"] = GetConfigBool(configEntries, "feature.connections", true),
            ["reviews"] = GetConfigBool(configEntries, "feature.reviews", true),
            ["polls"] = GetConfigBool(configEntries, "feature.polls", true),
            ["job_vacancies"] = GetConfigBool(configEntries, "feature.job_vacancies", true),
            ["ideation_challenges"] = GetConfigBool(configEntries, "feature.ideation_challenges", true),
            ["direct_messaging"] = GetConfigBool(configEntries, "feature.direct_messaging", true),
            ["group_exchanges"] = GetConfigBool(configEntries, "feature.group_exchanges", true),
            ["search"] = GetConfigBool(configEntries, "feature.search", true),
            ["explore"] = GetConfigBool(configEntries, "feature.explore", true),
            ["ai_chat"] = GetConfigBool(configEntries, "feature.ai_chat", true),
        };

        // Build modules object
        var modules = new Dictionary<string, bool>
        {
            ["feed"] = GetConfigBool(configEntries, "module.feed", true),
            ["listings"] = GetConfigBool(configEntries, "module.listings", true),
            ["messages"] = GetConfigBool(configEntries, "module.messages", true),
            ["wallet"] = GetConfigBool(configEntries, "module.wallet", true),
            ["notifications"] = GetConfigBool(configEntries, "module.notifications", true),
            ["profile"] = GetConfigBool(configEntries, "module.profile", true),
            ["settings"] = GetConfigBool(configEntries, "module.settings", true),
            ["dashboard"] = GetConfigBool(configEntries, "module.dashboard", true),
        };

        // Build branding object
        var branding = new
        {
            name = tenant.Name,
            tagline = tenant.Tagline ?? GetConfigString(configEntries, "branding.tagline", "Time Banking Platform"),
            logo = tenant.LogoUrl,
            logo_url = tenant.LogoUrl,
            favicon = GetConfigString(configEntries, "branding.favicon_url"),
            favicon_url = GetConfigString(configEntries, "branding.favicon_url"),
            primary_color = GetConfigString(configEntries, "branding.primary_color", "#6366f1"),
            primaryColor = GetConfigString(configEntries, "branding.primary_color", "#6366f1"),
            secondary_color = GetConfigString(configEntries, "branding.secondary_color", "#a855f7"),
            secondaryColor = GetConfigString(configEntries, "branding.secondary_color", "#a855f7"),
            og_image_url = GetConfigString(configEntries, "branding.og_image_url"),
        };

        // Build contact info
        var contact = new
        {
            email = GetConfigString(configEntries, "contact.email"),
            phone = GetConfigString(configEntries, "contact.phone"),
            address = GetConfigString(configEntries, "contact.address"),
            location = GetConfigString(configEntries, "contact.location"),
        };

        // Build compliance flags
        var compliance = new
        {
            vetting_enabled = GetConfigBool(configEntries, "compliance.vetting_enabled", false),
            insurance_enabled = GetConfigBool(configEntries, "compliance.insurance_enabled", false),
        };

        // Build SEO
        var seo = new
        {
            meta_title = GetConfigString(configEntries, "seo.meta_title", tenant.Name),
            meta_description = GetConfigString(configEntries, "seo.meta_description", tenant.Tagline),
        };

        var bootstrap = new
        {
            id = tenant.Id,
            name = tenant.Name,
            slug = tenant.Slug,
            tagline = tenant.Tagline,
            features,
            modules,
            branding,
            contact,
            compliance,
            seo,
            categories,
            config = new
            {
                footer_text = GetConfigString(configEntries, "config.footer_text"),
            },
            settings = configEntries
                .Where(kv => kv.Key.StartsWith("settings."))
                .ToDictionary(kv => kv.Key.Replace("settings.", ""), kv => (object)kv.Value),
        };

        // Laravel consumers read the canonical data envelope, while the
        // copied React frontend still reads the historical root properties.
        // Keep both projections until every ASP.NET consumer has moved to the
        // Laravel contract.
        return Ok(new
        {
            data = bootstrap,
            bootstrap.id,
            bootstrap.name,
            bootstrap.slug,
            bootstrap.tagline,
            bootstrap.features,
            bootstrap.modules,
            bootstrap.branding,
            bootstrap.contact,
            bootstrap.compliance,
            bootstrap.seo,
            bootstrap.categories,
            bootstrap.config,
            bootstrap.settings,
        });
    }

    private async Task<Tenant?> FindActiveTenantByDomainAsync(
        string? host,
        bool excludeMaster = false)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            return null;
        }

        var normalizedHost = host.ToLowerInvariant();
        return await _db.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(tenant => tenant.IsActive
                && tenant.Domain != null
                && tenant.Domain.ToLower() == normalizedHost
                && (!excludeMaster || tenant.Id != 1))
            .FirstOrDefaultAsync();
    }

    private static string? NormalizeTenantHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            return null;
        }

        var normalized = host.Trim().TrimEnd('.').ToLowerInvariant();
        return normalized.StartsWith("www.", StringComparison.Ordinal)
            ? normalized[4..]
            : normalized;
    }

    // ──────────────────────────────────────────────
    // CONNECTION STATUS (P1 — ProfilePage needs this)
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/connections/status/{userId} — Check connection status with another user.
    /// Returns the connection object if one exists, or { status: "none" }.
    /// </summary>
    [HttpGet("api/connections/status/{userId}")]
    public async Task<IActionResult> GetConnectionStatus(int userId)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var connection = await _db.Connections
            .Include(c => c.Requester)
            .Include(c => c.Addressee)
            .FirstOrDefaultAsync(c =>
                (c.RequesterId == currentUserId && c.AddresseeId == userId) ||
                (c.RequesterId == userId && c.AddresseeId == currentUserId));

        if (connection == null)
        {
            return Ok(new { status = "none", connection_id = (int?)null });
        }

        return Ok(new
        {
            status = connection.Status.ToLowerInvariant(),
            connection_id = connection.Id,
            is_requester = connection.RequesterId == currentUserId,
            created_at = connection.CreatedAt
        });
    }

    // ──────────────────────────────────────────────
    // USER LISTINGS (P1 — ProfilePage needs this)
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/users/{userId}/listings — Get listings for a specific user.
    /// </summary>
    [HttpGet("api/users/{userId}/listings")]
    public async Task<IActionResult> GetUserListings(
        int userId,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Listings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Where(l => l.UserId == userId && l.Status == ListingStatus.Active);

        var total = await query.CountAsync();
        var listings = await query
            .OrderByDescending(l => l.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(l => new
            {
                id = l.Id,
                title = l.Title,
                description = l.Description,
                type = l.Type,
                status = l.Status,
                category_id = l.CategoryId,
                category = l.Category == null ? null : new { id = l.Category.Id, name = l.Category.Name },
                location = l.Location,
                estimated_hours = l.EstimatedHours,
                is_featured = l.IsFeatured,
                user = l.User == null ? null : new
                {
                    id = l.User.Id,
                    first_name = l.User.FirstName,
                    last_name = l.User.LastName,
                    name = (l.User.FirstName + " " + l.User.LastName).Trim(),
                    avatar_url = l.User.AvatarUrl
                },
                created_at = l.CreatedAt,
                updated_at = l.UpdatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            data = listings,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling(total / (double)limit) }
        });
    }

    // ──────────────────────────────────────────────
    // SEARCH SAVED (P2 — SearchPage)
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/search/saved — List saved searches for the current user.
    /// </summary>
    [HttpGet("api/search/saved")]
    public async Task<IActionResult> ListSavedSearches()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var searches = await _db.Set<SavedSearch>()
            .Where(s => s.UserId == userId.Value)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new
            {
                id = s.Id,
                name = s.Name,
                query_params = s.QueryJson,
                created_at = s.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = searches });
    }

    /// <summary>
    /// POST /api/search/saved — Save a search.
    /// </summary>
    [HttpPost("api/search/saved")]
    public async Task<IActionResult> SaveSearch([FromBody] SaveSearchRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var saved = new SavedSearch
        {
            UserId = userId.Value,
            TenantId = tenantId,
            Name = request.Name.Trim(),
            QueryJson = request.QueryParams ?? "{}",
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<SavedSearch>().Add(saved);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new { id = saved.Id, name = saved.Name, query_params = saved.QueryJson, created_at = saved.CreatedAt }
        });
    }

    /// <summary>
    /// DELETE /api/search/saved/{id} — Delete a saved search.
    /// </summary>
    [HttpDelete("api/search/saved/{id:int}")]
    public async Task<IActionResult> DeleteSavedSearch(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var search = await _db.Set<SavedSearch>()
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId.Value);

        if (search == null) return NotFound(new { error = "Saved search not found" });

        _db.Set<SavedSearch>().Remove(search);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Search deleted" });
    }

    // ──────────────────────────────────────────────
    // Hashtag route removed — served by HashtagsController

    // ──────────────────────────────────────────────
    // ENDORSEMENTS (P2 — DashboardPage, ProfilePage)
    // ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/members/{userId}/endorsements — Get endorsements for a user.
    /// </summary>
    [HttpGet("api/members/{userId}/endorsements")]
    public async Task<IActionResult> GetUserEndorsements(int userId)
    {
        var endorsements = await _db.Set<Endorsement>()
            .Include(e => e.Endorser)
            .Include(e => e.UserSkill)
            .ThenInclude(us => us!.Skill)
            .Where(e => e.UserSkill != null && e.UserSkill.UserId == userId)
            .OrderByDescending(e => e.CreatedAt)
            .Take(50)
            .Select(e => new
            {
                id = e.Id,
                skill_name = e.UserSkill!.Skill != null ? e.UserSkill.Skill.Name : null,
                endorser = e.Endorser == null ? null : new
                {
                    id = e.Endorser.Id,
                    first_name = e.Endorser.FirstName,
                    last_name = e.Endorser.LastName,
                    name = (e.Endorser.FirstName + " " + e.Endorser.LastName).Trim(),
                    avatar_url = e.Endorser.AvatarUrl
                },
                created_at = e.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = endorsements, total = endorsements.Count });
    }

    // ──────────────────────────────────────────────
    // Config helpers
    // ──────────────────────────────────────────────

    private static bool GetConfigBool(Dictionary<string, string> config, string key, bool defaultValue = false)
    {
        if (config.TryGetValue(key, out var value))
        {
            return value.Equals("true", StringComparison.OrdinalIgnoreCase)
                || value == "1";
        }
        return defaultValue;
    }

    private static string? GetConfigString(Dictionary<string, string> config, string key, string? defaultValue = null)
    {
        return config.TryGetValue(key, out var value) ? value : defaultValue;
    }

    private static object MapLaravelConsent(ConsentRecord consent)
    {
        return new
        {
            id = consent.Id,
            consent_type_slug = consent.ConsentType,
            consent_type = consent.ConsentType,
            given = consent.IsGranted,
            is_granted = consent.IsGranted,
            granted_at = consent.GrantedAt,
            revoked_at = consent.RevokedAt,
            updated_at = consent.UpdatedAt
        };
    }

    private static object BuildLaravelPreferences(UserPreference prefs, User user)
    {
        var bag = ParsePreferenceBag(user.NotificationPreferences);
        var targetLocale = PreferenceString(bag, "auto_translate_target_locale", prefs.Language);

        return new
        {
            privacy = new
            {
                privacy_profile = string.IsNullOrWhiteSpace(prefs.ProfileVisibility) ? "public" : prefs.ProfileVisibility,
                privacy_search = prefs.Searchable,
                privacy_contact = PreferenceBool(bag, "privacy_contact", true)
            },
            notifications = new { },
            accessibility = new
            {
                large_text = false,
                high_contrast = false,
                reduced_motion = false,
                simplified_layout = false
            },
            feed = new
            {
                prefers_chronological = PreferenceBool(bag, "prefers_chronological_feed", false)
            },
            translation = new
            {
                auto_translate_ugc = PreferenceBool(bag, "auto_translate_ugc", false),
                auto_translate_target_locale = targetLocale
            }
        };
    }

    private static JsonObject ParsePreferenceBag(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(raw) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private static bool PreferenceBool(JsonObject bag, string key, bool defaultValue)
    {
        if (!bag.TryGetPropertyValue(key, out var node) || node is not JsonValue value)
        {
            return defaultValue;
        }

        try
        {
            if (value.TryGetValue<bool>(out var boolValue)) return boolValue;
            if (value.TryGetValue<int>(out var intValue)) return intValue != 0;
            if (value.TryGetValue<string>(out var stringValue) && bool.TryParse(stringValue, out var parsed)) return parsed;
        }
        catch (InvalidOperationException)
        {
            return defaultValue;
        }

        return defaultValue;
    }

    private static string? PreferenceString(JsonObject bag, string key, string? defaultValue)
    {
        if (!bag.TryGetPropertyValue(key, out var node) || node is not JsonValue value)
        {
            return defaultValue;
        }

        try
        {
            return value.TryGetValue<string>(out var stringValue) && !string.IsNullOrWhiteSpace(stringValue)
                ? stringValue
                : defaultValue;
        }
        catch (InvalidOperationException)
        {
            return defaultValue;
        }
    }

    private static string ParseSessionBrowser(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent)) return "Unknown";
        if (userAgent.Contains("Edg/", StringComparison.OrdinalIgnoreCase)) return "Edge";
        if (userAgent.Contains("Chrome/", StringComparison.OrdinalIgnoreCase)) return "Chrome";
        if (userAgent.Contains("Firefox/", StringComparison.OrdinalIgnoreCase)) return "Firefox";
        if (userAgent.Contains("Safari/", StringComparison.OrdinalIgnoreCase)) return "Safari";
        return "Unknown";
    }

    private static string? ReadString(JsonElement body, params string[] names)
    {
        foreach (var name in names)
        {
            if (body.ValueKind == JsonValueKind.Object &&
                body.TryGetProperty(name, out var value) &&
                value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined)
            {
                return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            }
        }

        return null;
    }

    private static bool? ReadBool(JsonElement body, params string[] names)
    {
        foreach (var name in names)
        {
            if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.True) return true;
            if (value.ValueKind == JsonValueKind.False) return false;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number != 0;
            if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed)) return parsed;
        }

        return null;
    }

    private static int? DecodeCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return null;
        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, out var id) ? id : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string EncodeCursor(int id) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(id.ToString()));

    private void SetVolunteerOrganisationHeaders(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString();
    }

    private async Task<string> VolunteerOrganisationBaseUrlAsync(int tenantId)
    {
        var domain = await _db.Tenants
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Domain)
            .SingleOrDefaultAsync(HttpContext.RequestAborted);
        return string.IsNullOrWhiteSpace(domain)
            ? $"{Request.Scheme}://{Request.Host}".TrimEnd('/')
            : domain.TrimEnd('/');
    }
}

// ──────────────────────────────────────────────
// DTOs specific to CompatibilityController
// ──────────────────────────────────────────────

public class SaveSearchRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("query_params")]
    public string? QueryParams { get; set; }
}

public class ChangePasswordRequest
{
    [JsonPropertyName("current_password")]
    public string CurrentPassword { get; set; } = string.Empty;

    [JsonPropertyName("new_password")]
    public string NewPassword { get; set; } = string.Empty;
}

public class GdprRequestDto
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("format")]
    public string? Format { get; set; }

    [JsonPropertyName("reason")]
    public string? Reason { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}
