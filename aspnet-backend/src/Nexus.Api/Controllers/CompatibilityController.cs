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

using Nexus.Api.Support;

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
    /// <summary>
    /// The eleven locales the platform ships, in Laravel's order. English is
    /// master and fallback. Kept as a constant rather than read from config:
    /// a tenant cannot invent a locale the translation files do not have.
    /// </summary>
    /// <summary>
    /// Per-tenant module configuration defaults, generated 2026-08-16 from
    /// Laravel's own DEFAULTS constants (ListingConfigurationService,
    /// VolunteeringConfigurationService, JobConfigurationService,
    /// GroupConfigurationService) via reflection, NOT copied from a running
    /// tenant. A live tenant's values are its overrides; shipping those as
    /// defaults would make one community's choices everybody's.
    ///
    /// 🔴 Keys are FLAT and contain dots ("listing.max_images"), matching
    /// Laravel's payload exactly. They are not nested objects, and turning them
    /// into nested objects would be a contract change even though the field
    /// paths look identical when printed.
    /// </summary>
    private static readonly Dictionary<string, object> ListingConfigDefaults = new()
    {
        ["listing.moderation_enabled"] = false,
        ["listing.auto_approve_trusted"] = false,
        ["listing.max_per_user"] = 50,
        ["listing.max_images"] = 5,
        ["listing.max_image_size_mb"] = 8,
        ["listing.require_image"] = false,
        ["listing.min_title_length"] = 5,
        ["listing.min_description_length"] = 20,
        ["listing.allow_offers"] = true,
        ["listing.allow_requests"] = true,
        ["listing.require_category"] = true,
        ["listing.require_location"] = false,
        ["listing.require_hours_estimate"] = false,
        ["listing.enable_skill_tags"] = true,
        ["listing.enable_service_type"] = true,
        ["listing.auto_expire_days"] = 0,
        ["listing.max_renewals"] = 12,
        ["listing.renewal_days"] = 30,
        ["listing.expiry_reminders"] = true,
        ["listing.enable_featured"] = true,
        ["listing.featured_duration_days"] = 7,
        ["listing.enable_ai_descriptions"] = true,
        ["listing.enable_reporting"] = true,
        ["listing.enable_favourites"] = true,
        ["listing.enable_map_view"] = true,
        ["listing.enable_reciprocity"] = true,
    };
    private static readonly Dictionary<string, object> VolunteeringConfigDefaults = new()
    {
        ["volunteering.tab_opportunities"] = true,
        ["volunteering.tab_applications"] = true,
        ["volunteering.tab_hours"] = true,
        ["volunteering.tab_recommended"] = true,
        ["volunteering.tab_certificates"] = true,
        ["volunteering.tab_alerts"] = true,
        ["volunteering.tab_wellbeing"] = true,
        ["volunteering.tab_credentials"] = true,
        ["volunteering.tab_waitlist"] = true,
        ["volunteering.tab_swaps"] = true,
        ["volunteering.tab_group_signups"] = true,
        ["volunteering.tab_hours_review"] = true,
        ["volunteering.tab_expenses"] = true,
        ["volunteering.tab_safeguarding"] = true,
        ["volunteering.tab_community_projects"] = true,
        ["volunteering.tab_donations"] = true,
        ["volunteering.tab_accessibility"] = true,
        ["volunteering.swap_requires_admin"] = false,
        ["volunteering.auto_approve_applications"] = false,
        ["volunteering.require_org_note_on_decline"] = false,
        ["volunteering.cancellation_deadline_hours"] = 0,
        ["volunteering.max_hours_per_shift"] = 24,
        ["volunteering.hours_require_verification"] = true,
        ["volunteering.min_hours_for_certificate"] = 0,
        ["volunteering.alert_default_expiry_hours"] = 24,
        ["volunteering.alert_skill_matching"] = true,
        ["volunteering.expenses_enabled"] = true,
        ["volunteering.expense_require_receipt"] = false,
        ["volunteering.expense_max_amount"] = 500,
        ["volunteering.burnout_detection"] = true,
        ["volunteering.guardian_consent_required"] = false,
        ["volunteering.enable_qr_checkin"] = true,
        ["volunteering.enable_recurring_shifts"] = true,
        ["volunteering.enable_reviews"] = true,
        ["volunteering.enable_matching"] = true,
    };
    private static readonly Dictionary<string, object> JobConfigDefaults = new()
    {
        ["jobs.tab_browse"] = true,
        ["jobs.tab_saved"] = true,
        ["jobs.tab_my_postings"] = true,
        ["jobs.page_kanban"] = true,
        ["jobs.page_analytics"] = true,
        ["jobs.page_bias_audit"] = true,
        ["jobs.page_talent_search"] = true,
        ["jobs.page_alerts"] = true,
        ["jobs.allow_paid"] = true,
        ["jobs.allow_volunteer"] = true,
        ["jobs.allow_timebank"] = true,
        ["jobs.require_salary"] = false,
        ["jobs.default_currency"] = "EUR",
        ["jobs.max_postings_per_user"] = 20,
        ["jobs.default_deadline_days"] = 30,
        ["jobs.moderation_enabled"] = false,
        ["jobs.spam_detection"] = true,
        ["jobs.auto_approve_trusted"] = false,
        ["jobs.enable_cv_upload"] = true,
        ["jobs.require_cover_message"] = false,
        ["jobs.enable_interview_scheduling"] = true,
        ["jobs.enable_offers"] = true,
        ["jobs.enable_scorecards"] = true,
        ["jobs.enable_pipeline_rules"] = true,
        ["jobs.enable_blind_hiring"] = false,
        ["jobs.enable_featured"] = true,
        ["jobs.featured_duration_days"] = 7,
        ["jobs.enable_ai_descriptions"] = true,
        ["jobs.enable_skills_matching"] = true,
        ["jobs.enable_referrals"] = true,
        ["jobs.enable_templates"] = true,
        ["jobs.enable_rss_feed"] = true,
        ["jobs.enable_saved_profiles"] = true,
        ["jobs.enable_employer_branding"] = true,
    };
    private static readonly Dictionary<string, object> GroupTabDefaults = new()
    {
        ["tab_feed"] = true,
        ["tab_discussion"] = true,
        ["tab_members"] = true,
        ["tab_events"] = true,
        ["tab_files"] = true,
        ["tab_announcements"] = true,
        ["tab_qa"] = true,
        ["tab_wiki"] = true,
        ["tab_media"] = true,
        ["tab_chatrooms"] = true,
        ["tab_tasks"] = true,
        ["tab_challenges"] = true,
        ["tab_analytics"] = true,
        ["tab_subgroups"] = true,
    };

    /// <summary>
    /// Merge a tenant's stored settings over a block's defaults, mirroring
    /// Laravel's array_merge(DEFAULTS, stored). A tenant may override a value
    /// but may not invent a key: an unknown stored key is ignored, so a stray
    /// row in tenant config cannot add a field the client does not expect.
    /// </summary>
    /// <summary>
    /// Tenant settings, plus the two onboarding flags Laravel always sends.
    ///
    /// 🔴 Both default TRUE. Onboarding being mandatory by default is a
    /// deliberate product decision on the Laravel side; defaulting them to false
    /// here would let a member skip onboarding on one backend and not the other.
    /// </summary>
    private static Dictionary<string, object> BuildSettings(Dictionary<string, string> configEntries)
    {
        var settings = configEntries
            .Where(kv => kv.Key.StartsWith("settings."))
            .ToDictionary(kv => kv.Key.Replace("settings.", ""), kv => (object)kv.Value);

        settings["onboarding_enabled"] = GetConfigBool(configEntries, "onboarding.enabled", true);
        settings["onboarding_mandatory"] = GetConfigBool(configEntries, "onboarding.mandatory", true);
        return settings;
    }

    private static Dictionary<string, object> ResolveConfigBlock(
        IReadOnlyDictionary<string, string> configEntries,
        IReadOnlyDictionary<string, object> defaults)
    {
        var resolved = new Dictionary<string, object>(defaults.Count);
        foreach (var (key, fallback) in defaults)
        {
            if (!configEntries.TryGetValue(key, out var stored) || string.IsNullOrWhiteSpace(stored))
            {
                resolved[key] = fallback;
                continue;
            }

            resolved[key] = fallback switch
            {
                bool => stored is "1" or "true" or "True" or "TRUE",
                int => int.TryParse(stored, out var i) ? i : fallback,
                _ => stored,
            };
        }

        return resolved;
    }

    /// <summary>
    /// Two-factor and passkey settings, flat dotted keys as Laravel sends them.
    /// </summary>
    private static readonly Dictionary<string, object> AuthenticationConfigDefaults = new()
    {
        ["two_factor.allow_trusted_devices"] = true,
        ["two_factor.trusted_device_days"] = 30,
        ["two_factor.backup_code_count"] = 10,
        ["passkeys.conditional_autofill"] = true,
        ["passkeys.enrollment_enabled"] = true,
        ["passkeys.max_credentials_per_user"] = 10,
    };

    private static readonly string[] SupportedLanguages =
        ["en", "ga", "de", "fr", "it", "pt", "es", "nl", "pl", "ja", "ar"];

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
    // 🔴 Anonymous, matching Laravel: routes/api.php:790 carries an explicit
    // ->withoutMiddleware('auth:sanctum'). The skill taxonomy is a public
    // vocabulary, not member data, and a signed-out visitor browsing what a
    // community offers needs it.
    [AllowAnonymous]
    [HttpGet("api/skills/categories")]
    public async Task<IActionResult> GetSkillCategories()
    {
        // 🔴 Reads skill_categories, NOT the listing Category table. This
        // answered from Category until 2026-08-17 and so described the wrong
        // taxonomy with the wrong columns — a 200 with plausible content, which
        // is why nothing ever failed. Laravel's source is
        // App\Services\SkillTaxonomyService::getTree.
        var rows = await _db.SkillCategories
            .AsNoTracking()
            .Where(c => c.IsActive)
            .OrderBy(c => c.DisplayOrder)
            .ThenBy(c => c.Name)
            .Select(c => new
            {
                c.Id,
                c.TenantId,
                c.Name,
                c.Slug,
                c.ParentId,
                c.Description,
                c.Icon,
                c.DisplayOrder,
                c.IsActive,
                c.CreatedAt,
                c.UpdatedAt
            })
            .ToListAsync();

        // Laravel returns a TREE: every row carries a `children` array, and only
        // roots appear at the top level. `is_active` is MySQL tinyint, so it
        // serializes as 1/0 rather than as a JSON boolean.
        var byId = rows.ToDictionary(
            r => r.Id,
            r => new Dictionary<string, object?>
            {
                ["id"] = r.Id,
                ["tenant_id"] = r.TenantId,
                ["name"] = r.Name,
                ["slug"] = r.Slug,
                ["parent_id"] = r.ParentId,
                ["description"] = r.Description,
                ["icon"] = r.Icon,
                ["display_order"] = r.DisplayOrder,
                ["is_active"] = r.IsActive ? 1 : 0,
                ["created_at"] = r.CreatedAt,
                ["updated_at"] = r.UpdatedAt,
                ["children"] = new List<Dictionary<string, object?>>()
            });

        var roots = new List<Dictionary<string, object?>>();
        foreach (var row in rows)
        {
            var node = byId[row.Id];
            // A parent outside this set (inactive, or another tenant) leaves the
            // child at the top level rather than dropping it from the tree.
            if (row.ParentId is int parentId && byId.TryGetValue(parentId, out var parent))
            {
                ((List<Dictionary<string, object?>>)parent["children"]!).Add(node);
            }
            else
            {
                roots.Add(node);
            }
        }

        return Ok(new
        {
            data = roots,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
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
    /// 🔴 Authenticated, matching Laravel (401 on every tenant). Was
    /// [AllowAnonymous] until 2026-08-16 -- empty here only because the demo
    /// seed has no organisations. Found by scripts/compare-live-responses.mjs.
    [HttpGet("api/volunteering/organisations")]
    [Authorize]
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
            ["events"] = GetFeatureBool(configEntries, "events", true),
            ["groups"] = GetFeatureBool(configEntries, "groups", true),
            ["gamification"] = GetFeatureBool(configEntries, "gamification", true),
            ["goals"] = GetFeatureBool(configEntries, "goals", true),
            ["blog"] = GetFeatureBool(configEntries, "blog", true),
            ["resources"] = GetFeatureBool(configEntries, "resources", true),
            ["volunteering"] = GetFeatureBool(configEntries, "volunteering", true),
            ["exchange_workflow"] = GetFeatureBool(configEntries, "exchange_workflow", true),
            ["organisations"] = GetFeatureBool(configEntries, "organisations", true),
            ["federation"] = GetFeatureBool(configEntries, "federation", true),
            ["connections"] = GetFeatureBool(configEntries, "connections", true),
            ["reviews"] = GetFeatureBool(configEntries, "reviews", true),
            ["polls"] = GetFeatureBool(configEntries, "polls", true),
            ["job_vacancies"] = GetFeatureBool(configEntries, "job_vacancies", true),
            ["ideation_challenges"] = GetFeatureBool(configEntries, "ideation_challenges", true),
            ["direct_messaging"] = GetFeatureBool(configEntries, "direct_messaging", true),
            ["group_exchanges"] = GetFeatureBool(configEntries, "group_exchanges", true),
            ["search"] = GetFeatureBool(configEntries, "search", true),
            ["explore"] = GetFeatureBool(configEntries, "explore", true),
            ["ai_chat"] = GetFeatureBool(configEntries, "ai_chat", true),

            // 🔴 Added 2026-08-16. These twenty flags were absent from the
            // bootstrap payload while Laravel has always sent them, and the client
            // treats an absent flag as "module off" -- so marketplace, courses,
            // podcasts, identity verification, two-factor and biometric login were
            // all silently disabled on this backend, with nothing in any log to say
            // so. Found by the differential response harness.
            //
            // Defaults are Laravel's canonical ones from
            // app/Services/TenantFeatureConfig::FEATURE_DEFAULTS -- NOT the values a
            // particular tenant happens to show. hOUR Timebank has partner_venues and
            // public_events switched ON, for example, but both default OFF, and
            // copying a live tenant would have shipped its overrides as everyone's
            // defaults.
            ["caring_community"] = GetFeatureBool(configEntries, "caring_community", false),
            ["marketplace"] = GetFeatureBool(configEntries, "marketplace", false),
            ["merchant_coupons"] = GetFeatureBool(configEntries, "merchant_coupons", false),
            ["message_translation"] = GetFeatureBool(configEntries, "message_translation", true),
            ["member_premium"] = GetFeatureBool(configEntries, "member_premium", false),
            ["ai_agents"] = GetFeatureBool(configEntries, "ai_agents", false),
            ["partner_api"] = GetFeatureBool(configEntries, "partner_api", false),
            ["fadp_compliance"] = GetFeatureBool(configEntries, "fadp_compliance", false),
            ["local_advertising"] = GetFeatureBool(configEntries, "local_advertising", false),
            ["regional_analytics"] = GetFeatureBool(configEntries, "regional_analytics", false),
            ["newsletter"] = GetFeatureBool(configEntries, "newsletter", true),
            ["two_factor_authentication"] = GetFeatureBool(configEntries, "two_factor_authentication", true),
            ["biometric_login"] = GetFeatureBool(configEntries, "biometric_login", true),
            ["identity_verification"] = GetFeatureBool(configEntries, "identity_verification", true),

            // 🔴 maps defaults OFF and must stay OFF. It is a multi-tenant cost
            // and privacy decision, not an oversight -- see the platform note about
            // changing it in BOTH the backend and the client if it ever changes.
            ["maps"] = GetFeatureBool(configEntries, "maps", false),
            ["courses"] = GetFeatureBool(configEntries, "courses", false),
            ["podcasts"] = GetFeatureBool(configEntries, "podcasts", false),
            ["partner_venues"] = GetFeatureBool(configEntries, "partner_venues", false),
            ["public_events"] = GetFeatureBool(configEntries, "public_events", false),
            ["event_attendance_credits"] = GetFeatureBool(configEntries, "event_attendance_credits", false),
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

            // 🔴 Added 2026-08-16: absent while Laravel sends them, and an
            // absent module reads to the client as "switched off" -- the same
            // silent-disable as the feature flags.
            ["events"] = GetConfigBool(configEntries, "module.events", true),
            ["polls"] = GetConfigBool(configEntries, "module.polls", true),
            ["goals"] = GetConfigBool(configEntries, "module.goals", true),
            ["volunteering"] = GetConfigBool(configEntries, "module.volunteering", true),
            ["resources"] = GetConfigBool(configEntries, "module.resources", true),
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

            // 🔴 Added 2026-08-16: Laravel sends this and the client uses it to
            // decide how to render the header mark. "wide" is Laravel's value.
            logo_shape = GetConfigString(configEntries, "branding.logo_shape", "wide"),
        };

        // Build contact info
        // 🔴 Active children only, and DIRECT children only -- not the whole
        // subtree. A grandchild appears in its own parent's switcher, not here,
        // which is what keeps a deep hierarchy from flooding the utility bar.
        var switcherItems = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.ParentId == tenant.Id && t.IsActive)
            .OrderBy(t => t.Name)
            .Select(t => new
            {
                id = t.Id,
                name = t.Name,
                slug = t.Slug,
                url = $"{Request.Scheme}://{Request.Host}/{t.Slug}",
            })
            .ToListAsync();

        var contact = new
        {
            email = GetConfigString(configEntries, "contact.email"),
            phone = GetConfigString(configEntries, "contact.phone"),
            address = GetConfigString(configEntries, "contact.address"),
            location = GetConfigString(configEntries, "contact.location"),

            // Added 2026-08-16; Laravel sends it and the accessible frontend
            // renders it on the community profile.
            service_area = GetConfigString(configEntries, "contact.service_area", "national"),
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

            // 🔴 Added 2026-08-16, all absent while Laravel has always sent
            // them. currency drives every price and time-credit figure the client
            // renders; supported_languages drives the language switcher, so an
            // absent list leaves a member no way to change language at all.
            // 🔴 Flat dotted keys, matching Laravel exactly. The passkey and
            // two-factor numbers drive real client behaviour: trusted_device_days
            // decides how long a second factor is skipped, and
            // max_credentials_per_user caps how many passkeys a member may add.
            authentication_config = ResolveConfigBlock(configEntries, AuthenticationConfigDefaults),
            listing_config = ResolveConfigBlock(configEntries, ListingConfigDefaults),
            volunteering_config = ResolveConfigBlock(configEntries, VolunteeringConfigDefaults),
            job_config = ResolveConfigBlock(configEntries, JobConfigDefaults),
            group_tabs = ResolveConfigBlock(configEntries, GroupTabDefaults),
            currency = GetConfigString(configEntries, "settings.currency", "EUR"),
            default_layout = GetConfigString(configEntries, "settings.default_layout", "modern"),
            default_language = GetConfigString(configEntries, "settings.default_language", "en"),
            supported_languages = SupportedLanguages,
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

                // Laravel repeats the module map under config as well as at the
                // top of data. Duplication in Laravel's own payload, mirrored
                // rather than "tidied": the client may read either.
                modules,
            },

            // 🔴 Laravel sends null when no landing page is configured, and the
            // client distinguishes null from an empty object. Do not substitute {}.
            landing_page_config = (object?)null,

            // The utility-bar community switcher: this community's active direct
            // children, alphabetically. Only possible since the tenant hierarchy
            // landed (R-26) -- before that there were no children to list.
            tenant_switcher = new
            {
                // Laravel hardcodes "children" and the client branches on it, so it
                // is a literal here too rather than a description of what we did.
                source = "children",
                items = switcherItems,
            },

            settings = BuildSettings(configEntries),
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

            // 🔴 meta.base_url is part of Laravel's envelope and was missing.
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" },
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

    /// <summary>
    /// Reads a tenant feature flag for the bootstrap payload.
    ///
    /// 🔴 Goes through <see cref="TenantFeatureKeys"/> rather than reading
    /// "feature.{flag}" directly. All forty flags below used to read only that
    /// spelling, while the gates that actually enforce them read
    /// "features.{flag}" — so bootstrap reported a community's features at their
    /// defaults no matter what the community had actually set.
    /// </summary>
    private static bool GetFeatureBool(Dictionary<string, string> config, string flag, bool defaultValue = false)
        => TenantFeatureKeys.Read(config, flag, defaultValue);

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
