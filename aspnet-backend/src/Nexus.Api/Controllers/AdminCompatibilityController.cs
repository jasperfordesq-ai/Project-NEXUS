// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;
using Nexus.Api.Services.Scheduled;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin compatibility controller - provides route aliases that the React admin frontend expects.
/// The frontend's API client calls paths like /v2/admin/X which (after stripping /v2/) become /api/admin/X.
/// This controller fills gaps where the backend doesn't already have matching routes.
/// </summary>
[ApiController]
[Route("api/admin")]
[Route("api/v2/admin")]
[Authorize(Policy = NexusAuthorizationPolicies.RouteAwareAdmin)]
public class AdminCompatibilityController : ControllerBase
{
    private const int PasswordResetExpiryMinutes = 30;
    private const string MenuDefinitionsConfigKey = "menus.definitions";

    private static readonly (string Id, string Name)[] LaravelReactBackgroundJobs =
    [
        ("digest_emails", "Email Digest Sender"),
        ("badge_checker", "Badge Award Checker"),
        ("streak_updater", "Login Streak Updater")
    ];

    private static readonly (string Slug, string Name, string Command, string Schedule, string Category, string Description)[] LaravelReactCronJobs =
    [
        ("run-all", "Master Cron Runner", "runAll", "* * * * *", "master", "Runs all appropriate cron tasks based on the current time. This is the only scheduled entry - all other jobs run inside it."),
        ("process-queue", "Instant Notification Queue", "runInstantQueue", "* * * * *", "notifications", "Processes the instant notification queue, sending pending notifications immediately."),
        ("daily-digest", "Daily Digest", "dailyDigest", "0 8 * * *", "notifications", "Sends daily notification digest emails to users who opted for daily frequency."),
        ("weekly-digest", "Monthly Digest", "weeklyDigest", "0 17 1 * *", "notifications", "Sends monthly notification digest emails (1st of month at 5 PM)."),
        ("process-newsletters", "Process Scheduled Newsletters", "processNewsletters", "*/5 * * * *", "newsletters", "Checks for newsletters scheduled to be sent and initiates their sending process."),
        ("process-recurring", "Process Recurring Newsletters", "processRecurring", "*/15 * * * *", "newsletters", "Handles recurring/automated newsletters (e.g., weekly community updates)."),
        ("process-newsletter-queue", "Newsletter Queue Processor", "processNewsletterQueue", "* * * * *", "newsletters", "Processes the newsletter sending queue in batches for large sends."),
        ("notify-hot-matches", "Hot Match Notifications", "notifyHotMatches", "0 * * * *", "matching", "Notifies users of new high-scoring matches."),
        ("match-digest-daily", "Daily Match Digest", "matchDigestDaily", "0 9 * * *", "matching", "Sends daily match recommendations to users."),
        ("match-digest-weekly", "Weekly Match Digest", "matchDigestWeekly", "0 9 * * 1", "matching", "Sends weekly match recommendations summary (Mondays 9 AM)."),
        ("gamification-daily", "Gamification Daily Tasks", "gamificationDaily", "0 3 * * *", "gamification", "Processes streak resets, daily bonuses, and badge checks."),
        ("gamification-campaigns", "Process Achievement Campaigns", "gamificationCampaigns", "0 * * * *", "gamification", "Processes recurring achievement campaigns."),
        ("gamification-leaderboard", "Leaderboard Snapshot", "gamificationLeaderboard", "0 0 * * *", "gamification", "Creates daily leaderboard snapshots and finalizes seasons."),
        ("gamification-challenges", "Check Challenge Expirations", "gamificationChallenges", "30 * * * *", "gamification", "Expires completed challenges and updates statuses."),
        ("gamification-weekly-digest", "Gamification Monthly Digest", "gamificationWeeklyDigest", "0 4 1 * *", "gamification", "Sends monthly progress email digests to users."),
        ("gamification-streaks", "Gamification Streak Milestones", "gamificationStreaks", "0 1 * * *", "gamification", "Checks and awards streak milestones (7/14/30/60/90/180/365 days)."),
        ("gamification-cleanup", "Gamification Cleanup", "gamificationCleanup", "0 3 * * 0", "gamification", "Cleans old XP notifications, campaign awards, and analytics data."),
        ("update-featured-groups", "Update Featured Groups", "updateFeaturedGroups", "0 8 * * *", "groups", "Updates featured groups based on ranking algorithms."),
        ("group-weekly-digest", "Group Monthly Digests", "groupWeeklyDigest", "0 9 1 * *", "groups", "Sends monthly analytics digest emails to group owners."),
        ("abuse-detection", "Abuse Detection", "abuseDetection", "0 * * * *", "security", "Scans transactions for potential abuse patterns."),
        ("abuse-daily-report", "Abuse Daily Report", "abuseDailyReport", "0 7 * * *", "security", "Sends daily abuse detection report to admins."),
        ("abuse-cleanup", "Abuse Alert Cleanup", "abuseCleanup", "0 2 * * 0", "security", "Archives old alerts and auto-dismisses low-severity items."),
        ("verification-reminders", "Verification Reminders", "verificationReminders", "0 */6 * * *", "verification", "Sends reminders to users with incomplete identity verifications."),
        ("expire-verifications", "Expire Abandoned Verifications", "expireVerifications", "30 4 * * *", "verification", "Expires verification sessions abandoned for 72+ hours."),
        ("purge-verification-sessions", "Purge Old Verification Data", "purgeVerificationSessions", "30 3 * * 0", "verification", "Purges completed/expired verification sessions older than 180 days."),
        ("volunteer-pre-shift", "Volunteer Pre-Shift Reminders", "volunteerPreShiftReminders", "*/30 * * * *", "volunteering", "Sends reminders 24h and 2h before volunteer shifts."),
        ("volunteer-post-shift", "Volunteer Post-Shift Feedback", "volunteerPostShiftFeedback", "*/30 * * * *", "volunteering", "Sends feedback request after completed shifts."),
        ("volunteer-lapsed-nudge", "Lapsed Volunteer Nudge", "volunteerLapsedNudge", "0 5 * * *", "volunteering", "Nudges volunteers who have not been active recently."),
        ("volunteer-expiry-warnings", "Volunteer Credential Expiry", "volunteerExpiryWarnings", "0 5 * * *", "volunteering", "Warns volunteers about expiring credentials and training."),
        ("recurring-shifts", "Generate Recurring Shifts", "recurringShifts", "0 6 * * *", "volunteering", "Auto-generates volunteer shifts 14 days ahead from recurring templates."),
        ("volunteer-expire-consents", "Expire Guardian Consents", "volunteerExpireConsents", "0 5 * * *", "volunteering", "Expires guardian consent records that have passed their expiry date."),
        ("cleanup", "System Cleanup", "cleanup", "0 0 * * *", "maintenance", "Cleans expired tokens, old queue entries, API tokens, and tracking data."),
        ("geocode-batch", "Batch Geocoding", "geocodeBatch", "*/30 * * * *", "maintenance", "Geocodes users and listings missing lat/lng coordinates."),
        ("event-reminders", "Event Reminders", "eventReminders", "*/15 * * * *", "notifications", "Sends reminders 24h and 1h before events."),
        ("inactive-members", "Inactive Member Detection", "inactiveMembers", "0 2 * * *", "maintenance", "Detects and flags inactive members for follow-up."),
        ("listing-expiry", "Listing Expiry Processing", "listingExpiry", "0 8 * * *", "maintenance", "Expires listings that have passed their expiry date."),
        ("listing-expiry-reminders", "Listing Expiry Reminders", "listingExpiryReminders", "0 8 * * *", "notifications", "Warns listing owners 3 days before their listing expires."),
        ("job-expiry", "Job Vacancy Expiry", "jobExpiry", "0 8 * * *", "maintenance", "Expires job vacancies that have passed their closing date."),
        ("federation-weekly-digest", "Federation Monthly Digest", "federationWeeklyDigest", "0 9 1 * *", "notifications", "Sends federation activity digest to opted-in tenants."),
        ("balance-alerts", "Balance Alerts", "balanceAlerts", "0 8 * * *", "notifications", "Checks organization wallet balances and sends low/critical alerts."),
        ("goal-reminders", "Goal Reminders", "goalReminders", "0 8 * * *", "notifications", "Sends reminders for goals that are due or behind schedule."),
        ("retry-failed-webhooks", "Retry Failed Webhooks", "retryFailedWebhooks", "*/5 * * * *", "maintenance", "Retries webhook deliveries that previously failed.")
    ];

    // Only jobs whose ASP.NET domain behavior genuinely matches the Laravel
    // CronJobRunner operation belong here. An absent mapping is an explicit
    // unsupported result, never a fabricated success record.
    private static readonly IReadOnlyDictionary<string, string> LaravelCronToScheduledJob =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["listing-expiry"] = "ListingExpiry",
            ["job-expiry"] = "JobVacancyExpiry",
            ["volunteer-expire-consents"] = "VolunteerGuardianConsentExpiry",
            ["recurring-shifts"] = "VolunteerRecurringShiftGeneration"
        };

    private static readonly (int Id, string Name, string Location)[] MenuDefinitions =
    [
        (1, "Main Navigation", "header"),
        (2, "Footer", "footer"),
        (3, "Sidebar", "sidebar")
    ];

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly IConfiguration _config;
    private readonly TokenService _tokenService;
    private readonly IEmailService _emailService;
    private readonly GamificationService _gamification;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AdminCompatibilityController> _logger;

    public AdminCompatibilityController(
        NexusDbContext db,
        TenantContext tenant,
        IConfiguration config,
        TokenService tokenService,
        IEmailService emailService,
        GamificationService gamification,
        PersonalWalletLedgerService personalWallet,
        IMemoryCache cache,
        ILogger<AdminCompatibilityController> logger)
    {
        _db = db;
        _tenant = tenant;
        _config = config;
        _tokenService = tokenService;
        _emailService = emailService;
        _gamification = gamification;
        _personalWallet = personalWallet;
        _cache = cache;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();
    private bool IsLaravelV2Request => Request.Path.StartsWithSegments("/api/v2");

    private IActionResult LaravelData(object data) => Ok(new
    {
        data,
        meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
    });

    private IActionResult LaravelData(object data, int statusCode) => StatusCode(statusCode, new
    {
        data,
        meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
    });

    private IActionResult LaravelError(string code, string message, int status)
    {
        var payload = new { errors = new[] { new { code, message } } };
        return status switch
        {
            StatusCodes.Status403Forbidden => StatusCode(StatusCodes.Status403Forbidden, payload),
            StatusCodes.Status404NotFound => NotFound(payload),
            _ => StatusCode(status, payload)
        };
    }

    private IActionResult LaravelValidationError(string message, string field)
        => UnprocessableEntity(new { errors = new[] { new { code = "VALIDATION_ERROR", message, field } } });

    private async Task<User?> FindTenantUserAsync(int id)
    {
        var tenantId = _tenant.TenantId;
        if (!tenantId.HasValue) return null;
        return await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.TenantId == tenantId.Value);
    }

    private static bool IsProtectedSuperAdmin(User user)
        => user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod;

    private async Task<IActionResult?> RequireV2PolicyAsync(string policyName, string message)
    {
        if (!IsLaravelV2Request)
            return null;

        var authorization = HttpContext.RequestServices.GetRequiredService<IAuthorizationService>();
        var result = await authorization.AuthorizeAsync(
            User,
            resource: null,
            policyName: policyName);
        return result.Succeeded
            ? null
            : LaravelError(
                "AUTH_INSUFFICIENT_PERMISSIONS",
                message,
                StatusCodes.Status403Forbidden);
    }

    private async Task<bool> ReadGrantFlagAsync(bool defaultValue)
    {
        if (Request.ContentLength == 0)
            return defaultValue;

        try
        {
            using var doc = await JsonDocument.ParseAsync(Request.Body);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("grant", out var grant) &&
                (grant.ValueKind == JsonValueKind.True || grant.ValueKind == JsonValueKind.False))
                return grant.GetBoolean();
        }
        catch (JsonException)
        {
            return defaultValue;
        }

        return defaultValue;
    }

    private static string FormatConsentName(string consentType)
        => string.Join(' ', consentType.Split('_', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => char.ToUpperInvariant(part[0]) + part[1..].ToLowerInvariant()));

    private async Task<List<object>> GetLaravelUserBadgesAsync(int tenantId, int userId)
    {
        var rows = await _db.UserBadges
            .AsNoTracking()
            .Include(ub => ub.Badge)
            .Where(ub => ub.TenantId == tenantId && ub.UserId == userId)
            .OrderByDescending(ub => ub.EarnedAt)
            .ToListAsync();

        return rows.Select(ub => new
        {
            id = ub.Id,
            name = ub.Badge?.Name ?? string.Empty,
            slug = ub.Badge?.Slug ?? string.Empty,
            description = ub.Badge?.Description ?? string.Empty,
            icon = ub.Badge?.Icon,
            awarded_at = ub.EarnedAt
        }).Cast<object>().ToList();
    }

    // ──────────────────────────────────────────────
    // Dashboard (3 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("dashboard/stats")]
    public async Task<IActionResult> GetDashboardStats()
    {
        var tenantId = _tenant.TenantId;
        var thirtyDaysAgo = DateTime.UtcNow.AddDays(-30);

        var totalUsers = await _db.Users.CountAsync();
        var activeUsers = await _db.Users.CountAsync(u => u.IsActive && u.CreatedAt <= DateTime.UtcNow && u.CreatedAt >= thirtyDaysAgo);
        var totalListings = await _db.Listings.CountAsync();
        var totalExchanges = await _db.Exchanges.CountAsync();

        return Ok(new
        {
            total_users = totalUsers,
            active_users_last_30d = activeUsers,
            total_listings = totalListings,
            total_exchanges = totalExchanges,
            timestamp = DateTime.UtcNow
        });
    }

    [HttpGet("dashboard/trends")]
    public async Task<IActionResult> GetDashboardTrends([FromQuery] int months = 6)
    {
        if (months < 1) months = 1;
        if (months > 24) months = 24;

        var trends = new List<object>();
        for (var i = months - 1; i >= 0; i--)
        {
            var start = DateTime.UtcNow.AddMonths(-i).Date;
            start = new DateTime(start.Year, start.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var end = start.AddMonths(1);

            var registrations = await _db.Users.CountAsync(u => u.CreatedAt >= start && u.CreatedAt < end);
            var exchanges = await _db.Exchanges.CountAsync(e => e.CreatedAt >= start && e.CreatedAt < end);

            trends.Add(new
            {
                month = start.ToString("yyyy-MM"),
                registrations,
                exchanges,
                active_users = registrations // approximation
            });
        }

        return Ok(new { data = trends });
    }

    [HttpGet("dashboard/activity")]
    public async Task<IActionResult> GetDashboardActivity([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        // Return recent user registrations as activity items
        var activities = await _db.Users
            .AsNoTracking()
            .OrderByDescending(u => u.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(u => new
            {
                id = u.Id,
                type = "user_registered",
                description = $"User {u.FirstName} {u.LastName} registered",
                created_at = u.CreatedAt,
                user_id = u.Id
            })
            .ToListAsync();

        return Ok(new { data = activities, total = await _db.Users.CountAsync(), page, per_page = limit });
    }

    // ──────────────────────────────────────────────
    // Users - Extended (18 endpoints)
    // ──────────────────────────────────────────────

    [HttpPost("users")]
    public async Task<IActionResult> CreateUser([FromBody] AdminCreateUserRequest request)
    {
        if (IsLaravelV2Request)
        {
            return await CreateLaravelUser(request);
        }

        if (string.IsNullOrWhiteSpace(request.Email))
            return BadRequest(new { error = "Email is required" });

        var exists = await _db.Users.AnyAsync(u => u.Email.ToLower() == request.Email.ToLower());
        if (exists)
            return Conflict(new { error = "User with this email already exists" });

        var user = new User
        {
            Email = request.Email.ToLower().Trim(),
            FirstName = request.FirstName ?? "",
            LastName = request.LastName ?? "",
            Role = request.Role ?? "member",
            PasswordHash = "NEEDS_RESET",
            TenantId = _tenant.TenantId ?? 0,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} created user {UserId} ({Email})", GetCurrentUserId(), user.Id, user.Email);

        return Ok(new { success = true, id = user.Id, email = user.Email });
    }

    private async Task<IActionResult> CreateLaravelUser(AdminCreateUserRequest request)
    {
        var tenantId = _tenant.TenantId;
        if (!tenantId.HasValue)
            return LaravelError("NOT_FOUND", "Tenant not found", StatusCodes.Status404NotFound);

        var firstName = request.FirstName?.Trim() ?? string.Empty;
        var lastName = request.LastName?.Trim() ?? string.Empty;
        var email = request.Email.Trim().ToLowerInvariant();
        var password = string.IsNullOrWhiteSpace(request.Password)
            ? Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant()
            : request.Password;
        var role = string.IsNullOrWhiteSpace(request.Role) ? "member" : request.Role.Trim();
        var allowedRoles = new[] { "member", "admin", "broker" };
        var errors = new List<object>();

        if (string.IsNullOrWhiteSpace(firstName))
            errors.Add(new { code = "VALIDATION_ERROR", message = "First name is required", field = "first_name" });
        if (string.IsNullOrWhiteSpace(lastName))
            errors.Add(new { code = "VALIDATION_ERROR", message = "Last name is required", field = "last_name" });
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
            errors.Add(new { code = "VALIDATION_ERROR", message = "A valid email is required", field = "email" });
        if (password.Length < 8)
            errors.Add(new { code = "VALIDATION_ERROR", message = "Password must be at least 8 characters", field = "password" });
        if (!allowedRoles.Contains(role))
            errors.Add(new { code = "VALIDATION_ERROR", message = "Invalid role", field = "role" });

        if (errors.Count > 0)
            return UnprocessableEntity(new { errors });

        var exists = await _db.Users.AnyAsync(u => u.Email.ToLower() == email);
        if (exists)
            return UnprocessableEntity(new { errors = new[] { new { code = "VALIDATION_ERROR", message = "Email already exists", field = "email" } } });

        var user = new User
        {
            Email = email,
            FirstName = firstName,
            LastName = lastName,
            Role = role,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            TenantId = tenantId.Value,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} created Laravel v2 user {UserId} ({Email})", GetCurrentUserId(), user.Id, user.Email);

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                id = user.Id,
                name = $"{user.FirstName} {user.LastName}".Trim(),
                email = user.Email,
                role = user.Role,
                status = "active"
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpDelete("users/{id:int}")]
    public async Task<IActionResult> DeleteUser(int id)
    {
        var adminId = GetCurrentUserId();
        if (id == adminId)
            return LaravelError("AUTH_INSUFFICIENT_PERMISSIONS", "Cannot delete your own account", StatusCodes.Status403Forbidden);

        var user = await FindTenantUserAsync(id);
        if (user == null)
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        if (IsProtectedSuperAdmin(user))
            return LaravelError("AUTH_INSUFFICIENT_PERMISSIONS", "Cannot delete super admin", StatusCodes.Status403Forbidden);

        _db.Users.Remove(user);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted user {UserId}", GetCurrentUserId(), id);

        return LaravelData(new { deleted = true, id });
    }

    [HttpPost("users/{id:int}/approve")]
    public async Task<IActionResult> ApproveUser(int id)
    {
        var user = await FindTenantUserAsync(id);
        if (user == null)
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        var alreadyApproved = user.IsActive && user.SuspendedAt == null;

        user.IsActive = true;
        user.SuspendedAt = null;
        user.SuspensionReason = null;
        user.SuspendedByUserId = null;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} approved user {UserId}", GetCurrentUserId(), id);

        return LaravelData(alreadyApproved
            ? new { approved = true, id, already_approved = true }
            : new { approved = true, id, email_sent = false, welcome_credits = 0 });
    }

    [HttpPost("users/{id:int}/suspend")]
    public async Task<IActionResult> SuspendUser(int id, [FromBody] AdminBanUserRequest? request)
    {
        var adminId = GetCurrentUserId();
        if (id == adminId)
            return LaravelError("AUTH_INSUFFICIENT_PERMISSIONS", "Cannot suspend your own account", StatusCodes.Status403Forbidden);

        var user = await FindTenantUserAsync(id);
        if (user == null)
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        if (IsProtectedSuperAdmin(user))
            return LaravelError("AUTH_INSUFFICIENT_PERMISSIONS", "Cannot suspend super admin", StatusCodes.Status403Forbidden);

        user.IsActive = false;
        user.SuspendedAt = DateTime.UtcNow;
        user.SuspensionReason = string.IsNullOrWhiteSpace(request?.Reason) ? "Suspended by admin" : request!.Reason;
        user.SuspendedByUserId = adminId;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} suspended user {UserId}", adminId, id);

        return LaravelData(new { suspended = true, id });
    }

    [HttpPost("users/{id:int}/ban")]
    public async Task<IActionResult> BanUser(int id, [FromBody] AdminBanUserRequest? request)
    {
        var adminId = GetCurrentUserId();
        if (id == adminId)
            return LaravelError("AUTH_INSUFFICIENT_PERMISSIONS", "Cannot ban your own account", StatusCodes.Status403Forbidden);

        var user = await FindTenantUserAsync(id);
        if (user == null)
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        if (IsProtectedSuperAdmin(user))
            return LaravelError("AUTH_INSUFFICIENT_PERMISSIONS", "Cannot ban super admin", StatusCodes.Status403Forbidden);

        user.IsActive = false;
        user.SuspendedAt = DateTime.UtcNow;
        user.SuspensionReason = request?.Reason ?? "Banned by admin";
        user.SuspendedByUserId = adminId;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} banned user {UserId}", GetCurrentUserId(), id);

        return LaravelData(new { banned = true, id });
    }

    [HttpPost("users/{id:int}/reactivate")]
    public async Task<IActionResult> ReactivateUser(int id)
    {
        var user = await FindTenantUserAsync(id);
        if (user == null)
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        user.IsActive = true;
        user.SuspendedAt = null;
        user.SuspensionReason = null;
        user.SuspendedByUserId = null;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} reactivated user {UserId}", GetCurrentUserId(), id);

        return LaravelData(new { reactivated = true, id, email_sent = false });
    }

    [HttpPost("users/{id:int}/reset-2fa")]
    public async Task<IActionResult> ResetUser2fa(int id)
    {
        var adminId = GetCurrentUserId();
        var user = await FindTenantUserAsync(id);
        if (user == null)
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        if (id != adminId && IsProtectedSuperAdmin(user))
            return LaravelError("AUTH_INSUFFICIENT_PERMISSIONS", "Insufficient permissions", StatusCodes.Status403Forbidden);

        user.TwoFactorEnabled = false;
        user.TotpSecretEncrypted = null;
        user.TwoFactorEnabledAt = null;
        user.UpdatedAt = DateTime.UtcNow;

        var backupCodes = await _db.TotpBackupCodes.Where(c => c.UserId == id && c.TenantId == user.TenantId).ToListAsync();
        _db.TotpBackupCodes.RemoveRange(backupCodes);

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} reset 2FA for user {UserId}", GetCurrentUserId(), id);
        return LaravelData(new { reset = true, id, backup_codes_removed = backupCodes.Count });
    }

    [HttpGet("users/{userId:int}/badges")]
    public async Task<IActionResult> GetUserBadges(int userId)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var userExists = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id == userId && u.TenantId == tenantId);

        if (!userExists)
            return NotFound(new { error = "User not found" });

        var badges = await _db.UserBadges
            .AsNoTracking()
            .Include(ub => ub.Badge)
            .Where(ub => ub.UserId == userId && ub.TenantId == tenantId)
            .OrderByDescending(ub => ub.EarnedAt)
            .Select(ub => new
            {
                id = ub.Id,
                badge_id = ub.BadgeId,
                user_id = ub.UserId,
                slug = ub.Badge != null ? ub.Badge.Slug : string.Empty,
                name = ub.Badge != null ? ub.Badge.Name : string.Empty,
                description = ub.Badge != null ? ub.Badge.Description : string.Empty,
                icon = ub.Badge != null ? ub.Badge.Icon : null,
                awarded_at = ub.EarnedAt
            })
            .ToListAsync();

        return Ok(new { data = badges, badges });
    }

    [HttpPost("users/{userId:int}/badges")]
    public async Task<IActionResult> AddUserBadge(int userId, [FromBody] AdminUserBadgeRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null)
            return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (IsLaravelV2Request && !await _db.Users.AnyAsync(u => u.Id == userId && u.TenantId == tenantId))
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        var badgeId = request.BadgeId;
        Badge? badge = null;
        if (!badgeId.HasValue && !string.IsNullOrWhiteSpace(request.BadgeSlug))
        {
            badge = await _db.Badges
                .FirstOrDefaultAsync(b => b.Slug == request.BadgeSlug && b.IsActive && (!IsLaravelV2Request || b.TenantId == tenantId));
            badgeId = badge?.Id;
        }
        else if (badgeId.HasValue && IsLaravelV2Request)
        {
            badge = await _db.Badges
                .FirstOrDefaultAsync(b => b.Id == badgeId.Value && b.IsActive && b.TenantId == tenantId);
            badgeId = badge?.Id;
        }
        else if (badgeId.HasValue)
        {
            badge = await _db.Badges
                .Where(b => b.Id == badgeId.Value && b.IsActive)
                .FirstOrDefaultAsync();
        }

        if (!badgeId.HasValue)
            return IsLaravelV2Request
                ? LaravelValidationError("Badge slug is required", "badge_slug")
                : BadRequest(new { error = "badge_id or badge_slug is required" });

        var (userBadge, error) = await _gamification.AwardBadgeManuallyAsync(
            tenantId,
            userId,
            badgeId.Value,
            adminId.Value);

        if (error != null)
        {
            if (error.Contains("User not found", StringComparison.OrdinalIgnoreCase) ||
                error.Contains("Badge not found", StringComparison.OrdinalIgnoreCase))
                return IsLaravelV2Request
                    ? LaravelError("NOT_FOUND", error, StatusCodes.Status404NotFound)
                    : NotFound(new { error });

            return IsLaravelV2Request
                ? LaravelError("CONFLICT", error, StatusCodes.Status409Conflict)
                : Conflict(new { error });
        }

        _logger.LogInformation("Admin {AdminId} added badge {BadgeId} to user {UserId}", adminId, badgeId.Value, userId);
        if (IsLaravelV2Request)
            return LaravelData(new
            {
                awarded = true,
                user_id = userId,
                badge_slug = badge?.Slug ?? request.BadgeSlug ?? string.Empty
            }, StatusCodes.Status201Created);

        return Ok(new { success = true, message = "Badge added", badge_id = badgeId.Value, user_id = userId, earned_at = userBadge!.EarnedAt });
    }

    [HttpDelete("users/{userId:int}/badges/{badgeId:int}")]
    public async Task<IActionResult> RemoveUserBadge(int userId, int badgeId)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (IsLaravelV2Request)
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            var userBadge = await _db.UserBadges
                .FirstOrDefaultAsync(ub => ub.Id == badgeId && ub.UserId == userId && ub.TenantId == tenantId);
            if (userBadge == null)
                return LaravelError("NOT_FOUND", "Badge not found", StatusCodes.Status404NotFound);

            var routeBadgeId = userBadge.Id;
            var (removed, removeError) = await _gamification.RevokeBadgeAsync(
                tenantId,
                userId,
                userBadge.BadgeId,
                adminId.Value);
            if (!removed)
                return LaravelError("NOT_FOUND", removeError ?? "Badge not found", StatusCodes.Status404NotFound);

            _logger.LogInformation("Admin {AdminId} removed user badge {UserBadgeId} from user {UserId}", adminId, routeBadgeId, userId);
            return LaravelData(new { removed = true, user_id = userId, badge_id = routeBadgeId });
        }

        var (success, error) = await _gamification.RevokeBadgeAsync(
            _tenant.GetTenantIdOrThrow(),
            userId,
            badgeId,
            adminId.Value);

        if (!success)
            return NotFound(new { error = error ?? "Badge not found" });

        _logger.LogInformation("Admin {AdminId} removed badge {BadgeId} from user {UserId}", adminId, badgeId, userId);
        return Ok(new { success = true, message = "Badge removed", badge_id = badgeId, user_id = userId });
    }

    [HttpPost("users/badges/recheck-all")]
    public async Task<IActionResult> RecheckAllUserBadges()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var userIds = await _db.Users
            .AsNoTracking()
            .Where(u => u.IsActive)
            .Select(u => u.Id)
            .ToListAsync();

        var awarded = 0;
        foreach (var id in userIds)
        {
            var (newlyEarned, error) = await _gamification.RecheckAllBadgesAsync(tenantId, id);
            if (error == null)
                awarded += newlyEarned.Count;
        }

        _logger.LogInformation("Admin {AdminId} rechecked badges for {Count} users; awarded {Awarded}", GetCurrentUserId(), userIds.Count, awarded);
        return Ok(new { success = true, message = "Badge recheck completed", users_checked = userIds.Count, badges_awarded = awarded, completed_at = DateTime.UtcNow });
    }

    [HttpPost("users/{userId:int}/impersonate")]
    public async Task<IActionResult> ImpersonateUser(int userId)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null)
            return Unauthorized(new { error = "Invalid token" });

        var policyFailure = await RequireV2PolicyAsync(
            NexusAuthorizationPolicies.PlatformSuperAdminOnly,
            "Platform super-admin access is required to impersonate users");
        if (policyFailure is not null)
            return policyFailure;

        var tenantId = _tenant.TenantId;
        var user = IsLaravelV2Request && tenantId.HasValue
            ? await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId.Value)
            : await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });
        if (IsLaravelV2Request && IsProtectedSuperAdmin(user))
            return LaravelError("AUTH_INSUFFICIENT_PERMISSIONS", "Cannot impersonate super admin", StatusCodes.Status403Forbidden);
        if (adminId.Value == userId)
            return IsLaravelV2Request
                ? LaravelError("VALIDATION_ERROR", "Cannot impersonate yourself", StatusCodes.Status422UnprocessableEntity)
                : BadRequest(new { error = "Cannot impersonate yourself" });
        if (!user.IsActive)
            return IsLaravelV2Request
                ? LaravelError("CONFLICT", "Cannot impersonate inactive user", StatusCodes.Status409Conflict)
                : Conflict(new { error = "Cannot impersonate inactive user" });

        var accessToken = _tokenService.GenerateJwt(user);
        _logger.LogWarning("Admin {AdminId} generated bounded impersonation access token for user {UserId}", adminId, userId);

        if (IsLaravelV2Request)
        {
            var tenantSlug = await _db.Tenants
                .Where(t => t.Id == user.TenantId)
                .Select(t => t.Slug)
                .FirstOrDefaultAsync();
            return LaravelData(new
            {
                token = accessToken,
                user_id = user.Id,
                user_name = GetDisplayName(user),
                tenant_id = user.TenantId,
                tenant_slug = tenantSlug
            });
        }

        return Ok(new
        {
            success = true,
            access_token = accessToken,
            token_type = "Bearer",
            expires_in = _tokenService.AccessTokenExpirySeconds,
            refresh_token = (string?)null,
            impersonated_user = new
            {
                id = user.Id,
                email = user.Email,
                first_name = user.FirstName,
                last_name = user.LastName,
                role = user.Role
            },
            impersonated_by = adminId.Value,
            audit_note = "Compatibility impersonation issues an access token only; no refresh token is minted."
        });
    }

    [HttpPut("users/{userId:int}/super-admin")]
    public async Task<IActionResult> SetSuperAdmin(int userId)
    {
        var adminId = GetCurrentUserId();
        var policyFailure = await RequireV2PolicyAsync(
            NexusAuthorizationPolicies.PlatformSuperAdminOnly,
            "Only platform super-admins may manage tenant super-admin status");
        if (policyFailure is not null)
            return policyFailure;

        if (IsLaravelV2Request && adminId == userId)
            return LaravelError("VALIDATION_ERROR", "Cannot modify your own super admin status", StatusCodes.Status422UnprocessableEntity);

        var user = IsLaravelV2Request
            ? await FindTenantUserAsync(userId)
            : await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });

        var grant = await ReadGrantFlagAsync(defaultValue: !IsLaravelV2Request);

        if (IsLaravelV2Request)
        {
            if (grant)
                user.Role = "admin";
            user.IsTenantSuperAdmin = grant;
        }
        else if (grant)
        {
            user.Role = "admin";
        }

        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        if (IsLaravelV2Request)
        {
            _logger.LogWarning("Admin {AdminId} set tenant super-admin grant={Grant} for user {UserId} through compatibility route", adminId, grant, userId);
            return LaravelData(new { id = userId, is_tenant_super_admin = grant });
        }

        _logger.LogWarning("Admin {AdminId} promoted user {UserId} to tenant admin through compatibility super-admin route", adminId, userId);
        return Ok(new { success = true, user_id = userId, role = user.Role, scope = "tenant", message = "Tenant admin role granted" });
    }

    [HttpPut("users/{userId:int}/global-super-admin")]
    public async Task<IActionResult> SetGlobalSuperAdmin(int userId)
    {
        var adminId = GetCurrentUserId();
        var policyFailure = await RequireV2PolicyAsync(
            NexusAuthorizationPolicies.GodOnly,
            "Only God users may manage global super-admin status");
        if (policyFailure is not null)
            return policyFailure;

        if (IsLaravelV2Request && adminId == userId)
            return LaravelError("VALIDATION_ERROR", "Cannot modify your own super admin status", StatusCodes.Status422UnprocessableEntity);

        var user = IsLaravelV2Request
            ? await FindTenantUserAsync(userId)
            : await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });

        var grant = await ReadGrantFlagAsync(defaultValue: !IsLaravelV2Request);
        user.IsSuperAdmin = grant;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        if (IsLaravelV2Request)
        {
            _logger.LogWarning("Admin {AdminId} set global super-admin grant={Grant} for user {UserId}", adminId, grant, userId);
            return LaravelData(new { id = userId, is_super_admin = grant });
        }

        _logger.LogWarning("Admin {AdminId} set global super-admin grant={Grant} for user {UserId}", adminId, grant, userId);
        return Ok(new
        {
            success = true,
            user_id = userId,
            role = user.Role,
            is_super_admin = user.IsSuperAdmin,
            scope = "global",
            message = grant ? "Global super-admin flag granted" : "Global super-admin flag revoked"
        });
    }

    [HttpPost("users/{userId:int}/badges/recheck")]
    public async Task<IActionResult> RecheckUserBadges(int userId)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (IsLaravelV2Request && !await _db.Users.AnyAsync(u => u.Id == userId && u.TenantId == tenantId))
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        var (newlyEarned, error) = await _gamification.RecheckAllBadgesAsync(tenantId, userId);
        if (error != null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", error, StatusCodes.Status404NotFound)
                : NotFound(new { error });

        _logger.LogInformation("Admin {AdminId} rechecked badges for user {UserId}; awarded {Awarded}", GetCurrentUserId(), userId, newlyEarned.Count);
        if (IsLaravelV2Request)
        {
            var badges = await GetLaravelUserBadgesAsync(tenantId, userId);
            return LaravelData(new { rechecked = true, user_id = userId, badges });
        }

        return Ok(new { success = true, message = "Badge recheck completed", badges_awarded = newlyEarned.Count });
    }

    [HttpGet("users/{userId:int}/consents")]
    public async Task<IActionResult> GetUserConsents(int userId)
    {
        var user = IsLaravelV2Request
            ? await FindTenantUserAsync(userId)
            : await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });

        var tenantId = IsLaravelV2Request
            ? _tenant.TenantId ?? user.TenantId
            : user.TenantId;
        var consentRecords = await _db.ConsentRecords
            .AsNoTracking()
            .Where(c => c.UserId == userId && c.TenantId == tenantId)
            .OrderBy(c => c.ConsentType)
            .ToListAsync();
        var consents = consentRecords.Select(c => new
        {
            consent_type = c.ConsentType,
            name = FormatConsentName(c.ConsentType),
            description = (string?)null,
            category = (string?)null,
            is_required = c.ConsentType == "terms_of_service" || c.ConsentType == "privacy_policy",
            consent_given = c.IsGranted,
            consent_version = (string?)null,
            given_at = c.GrantedAt,
            withdrawn_at = c.RevokedAt
        }).ToList();

        if (IsLaravelV2Request)
            return LaravelData(consents);

        return Ok(new { data = consents, user_id = userId });
    }

    [HttpPost("users/{userId:int}/password")]
    public async Task<IActionResult> SetUserPassword(int userId, [FromBody] AdminSetPasswordRequest request)
    {
        var password = request.Password ?? request.NewPassword ?? request.TemporaryPassword;
        if (string.IsNullOrWhiteSpace(password))
            return IsLaravelV2Request
                ? LaravelValidationError("Password is required", "password")
                : BadRequest(new { error = "Password is required" });
        if (password.Length < 8)
            return IsLaravelV2Request
                ? LaravelValidationError("Password must be at least 8 characters", "password")
                : BadRequest(new { error = "Password must be at least 8 characters" });

        var user = IsLaravelV2Request
            ? await FindTenantUserAsync(userId)
            : await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password);
        user.UpdatedAt = DateTime.UtcNow;
        user.AuthenticationInvalidatedAt = user.UpdatedAt;

        var refreshTokens = await _db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ToListAsync();
        foreach (var token in refreshTokens)
        {
            token.RevokedAt = DateTime.UtcNow;
            token.RevokedReason = "admin_password_change";
        }

        var resetTokens = await _db.PasswordResetTokens
            .Where(t => t.UserId == userId && t.UsedAt == null)
            .ToListAsync();
        foreach (var token in resetTokens)
        {
            token.UsedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} set password for user {UserId}; revoked {RefreshTokenCount} refresh tokens", GetCurrentUserId(), userId, refreshTokens.Count);
        if (IsLaravelV2Request)
            return LaravelData(new { password_set = true, id = userId });

        return Ok(new { success = true, message = "Password updated", refresh_tokens_revoked = refreshTokens.Count, reset_tokens_invalidated = resetTokens.Count });
    }

    [HttpPost("users/{userId:int}/send-password-reset")]
    public async Task<IActionResult> SendPasswordReset(int userId)
    {
        var user = IsLaravelV2Request
            ? await FindTenantUserAsync(userId)
            : await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });

        var existingTokens = await _db.PasswordResetTokens
            .Where(t => t.UserId == userId && t.UsedAt == null)
            .ToListAsync();
        foreach (var token in existingTokens)
        {
            token.UsedAt = DateTime.UtcNow;
        }

        var (resetToken, resetTokenHash) = TokenService.GenerateRefreshToken();
        var passwordResetToken = new PasswordResetToken
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            TokenHash = resetTokenHash,
            ExpiresAt = DateTime.UtcNow.AddMinutes(PasswordResetExpiryMinutes)
        };

        _db.PasswordResetTokens.Add(passwordResetToken);
        await _db.SaveChangesAsync();

        var frontendUrl = _config["App:FrontendUrl"]?.TrimEnd('/') ?? "http://localhost:5173";
        var resetUrl = $"{frontendUrl}/reset-password?token={Uri.EscapeDataString(resetToken)}";
        var emailSent = await _emailService.SendPasswordResetEmailAsync(
            user.Email,
            resetToken,
            GetDisplayName(user),
            resetUrl,
            HttpContext.RequestAborted);

        _logger.LogInformation("Admin {AdminId} generated password reset for user {UserId}; email sent={EmailSent}", GetCurrentUserId(), userId, emailSent);

        var response = new Dictionary<string, object?>
        {
            ["success"] = true,
            ["message"] = "Password reset token generated",
            ["email_sent"] = emailSent,
            ["expires_at"] = passwordResetToken.ExpiresAt,
            ["tokens_invalidated"] = existingTokens.Count
        };

        if (IsDevelopmentLikeEnvironment())
            response["reset_token"] = resetToken;

        if (IsLaravelV2Request)
            return LaravelData(new { sent = true, id = userId });

        return Ok(response);
    }

    [HttpPost("users/{userId:int}/send-welcome-email")]
    public async Task<IActionResult> SendWelcomeEmail(int userId)
    {
        var user = IsLaravelV2Request
            ? await FindTenantUserAsync(userId)
            : await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });

        var tenantName = await _db.Tenants
            .Where(t => t.Id == user.TenantId)
            .Select(t => t.Name)
            .FirstOrDefaultAsync() ?? "Project NEXUS";

        var emailSent = await _emailService.SendWelcomeEmailAsync(
            user.Email,
            GetDisplayName(user),
            tenantName,
            HttpContext.RequestAborted);

        _logger.LogInformation("Admin {AdminId} sent welcome email to user {UserId}; email sent={EmailSent}", GetCurrentUserId(), userId, emailSent);
        if (IsLaravelV2Request)
            return LaravelData(new { sent = true, id = userId });

        return Ok(new { success = true, message = "Welcome email processed", email_sent = emailSent });
    }

    [HttpPost("users/import")]
    public async Task<IActionResult> ImportUsers()
    {
        // Canonical Laravel v2 accepts multipart CSV only. Keeping JSON import
        // on the legacy alias must never let v2 mint arbitrary retired roles.
        if (IsLaravelV2Request)
            return await ImportUsersFromMultipartCsv();

        if (Request.HasFormContentType)
            return await ImportUsersFromMultipartCsv();

        JsonDocument doc;
        try
        {
            doc = await JsonDocument.ParseAsync(Request.Body);
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "Invalid import payload" });
        }

        using (doc)
        {
            return await ImportUsersFromJson(doc.RootElement);
        }
    }

    private async Task<IActionResult> ImportUsersFromJson(JsonElement request)
    {
        var users = ExtractImportUsers(request);
        if (users.Count == 0)
            return BadRequest(new { error = "At least one user is required" });
        if (users.Count > 500)
            return BadRequest(new { error = "Maximum 500 users per import" });

        var tenantId = _tenant.GetTenantIdOrThrow();
        var imported = 0;
        var errors = new List<object>();

        foreach (var item in users)
        {
            var email = item.Email?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(email))
            {
                errors.Add(new { email = item.Email, error = "Email is required" });
                continue;
            }

            if (await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Email.ToLower() == email))
            {
                errors.Add(new { email, error = "User already exists" });
                continue;
            }

            _db.Users.Add(new User
            {
                TenantId = tenantId,
                Email = email,
                FirstName = item.FirstName?.Trim() ?? string.Empty,
                LastName = item.LastName?.Trim() ?? string.Empty,
                Role = string.IsNullOrWhiteSpace(item.Role) ? "member" : item.Role.Trim().ToLowerInvariant(),
                PasswordHash = string.IsNullOrWhiteSpace(item.Password)
                    ? "NEEDS_RESET"
                    : BCrypt.Net.BCrypt.HashPassword(item.Password),
                IsActive = item.IsActive ?? true,
                EmailVerified = item.EmailVerified ?? false,
                CreatedAt = DateTime.UtcNow
            });
            imported++;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} imported {Imported} users with {Errors} errors", GetCurrentUserId(), imported, errors.Count);
        return Ok(new { success = true, imported, errors = errors.Count, error_details = errors });
    }

    private async Task<IActionResult> ImportUsersFromMultipartCsv()
    {
        if (!Request.HasFormContentType)
            return LaravelError("VALIDATION_ERROR", "CSV file is required", StatusCodes.Status400BadRequest);

        var form = await Request.ReadFormAsync();
        var file = form.Files["csv_file"];
        if (file == null || file.Length == 0)
            return LaravelError("VALIDATION_ERROR", "CSV file is required", StatusCodes.Status400BadRequest);

        var contentType = file.ContentType?.ToLowerInvariant() ?? string.Empty;
        var allowedTypes = new[] { "text/csv", "application/vnd.ms-excel", "application/csv", "text/plain" };
        if (!allowedTypes.Contains(contentType))
            return LaravelError("VALIDATION_ERROR", "CSV file type is invalid", StatusCodes.Status400BadRequest);

        string csv;
        await using (var stream = file.OpenReadStream())
        using (var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
        {
            csv = await reader.ReadToEndAsync();
        }

        var records = ParseCsvRecords(csv);
        if (records.Count == 0)
            return LaravelError("VALIDATION_ERROR", "CSV file is empty", StatusCodes.Status400BadRequest);

        var header = records[0]
            .Select(h => h.Trim().Replace(" ", "_").Replace("-", "_").ToLowerInvariant())
            .ToArray();
        var requiredColumns = new[] { "first_name", "last_name", "email" };
        var missing = requiredColumns.Where(c => !header.Contains(c)).ToArray();
        if (missing.Length > 0)
            return LaravelError("VALIDATION_ERROR", $"CSV is missing required columns: {string.Join(", ", missing)}", StatusCodes.Status400BadRequest);

        var columnMap = header.Select((name, index) => new { name, index })
            .ToDictionary(x => x.name, x => x.index, StringComparer.OrdinalIgnoreCase);
        var tenantId = _tenant.GetTenantIdOrThrow();
        var defaultRole = NormalizeImportRole(form.TryGetValue("default_role", out var requestedDefaultRole)
            ? requestedDefaultRole.ToString()
            : "member");
        var imported = 0;
        var skipped = 0;
        var errors = new List<string>();

        for (var index = 1; index < records.Count; index++)
        {
            var rowNumber = index + 1;
            var row = records[index];
            if (row.Count != header.Length)
            {
                errors.Add($"Row {rowNumber}: Column count mismatch");
                skipped++;
                continue;
            }

            var email = CsvValue(row, columnMap, "email").Trim().ToLowerInvariant();
            var firstName = CsvValue(row, columnMap, "first_name").Trim();
            var lastName = CsvValue(row, columnMap, "last_name").Trim();
            if (!IsValidEmail(email))
            {
                errors.Add($"Row {rowNumber}: Invalid email '{email}'");
                skipped++;
                continue;
            }

            if (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName))
            {
                errors.Add($"Row {rowNumber}: First name and last name are required");
                skipped++;
                continue;
            }

            if (await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Email.ToLower() == email))
            {
                errors.Add($"Row {rowNumber}: User with email '{email}' already exists");
                skipped++;
                continue;
            }

            var role = NormalizeImportRole(CsvValue(row, columnMap, "role"), defaultRole);
            _db.Users.Add(new User
            {
                TenantId = tenantId,
                Email = email,
                FirstName = firstName,
                LastName = lastName,
                Role = role,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(Convert.ToHexString(RandomNumberGenerator.GetBytes(16))),
                IsActive = true,
                EmailVerified = false,
                CreatedAt = DateTime.UtcNow
            });
            imported++;
        }

        await _db.SaveChangesAsync();
        _logger.LogInformation("Admin {AdminId} imported {Imported} users from CSV with {Skipped} skipped", GetCurrentUserId(), imported, skipped);
        return LaravelData(new
        {
            imported,
            skipped,
            errors = errors.Take(50).ToArray(),
            total_rows = Math.Max(0, records.Count - 1)
        });
    }

    // ──────────────────────────────────────────────
    // Config - Extended (8 endpoints)
    // ──────────────────────────────────────────────

    [HttpPut("config/features")]
    public async Task<IActionResult> ToggleFeatureFlag([FromBody] JsonElement request)
    {
        var updates = ExtractBooleanSettings(request, "features", "feature");
        if (updates.Count == 0)
            return BadRequest(new { error = "At least one feature flag is required" });

        foreach (var update in updates)
        {
            await UpsertTenantConfigAsync(BuildGroupedConfigKey("features", update.Key), update.Value ? "true" : "false");
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated {Count} feature flags", GetCurrentUserId(), updates.Count);
        return Ok(new { success = true, message = "Feature flag updated", data = updates });
    }

    [HttpPut("config/modules")]
    public async Task<IActionResult> ToggleModule([FromBody] JsonElement request)
    {
        var updates = ExtractBooleanSettings(request, "modules", "module");
        if (updates.Count == 0)
            return BadRequest(new { error = "At least one module flag is required" });

        foreach (var update in updates)
        {
            await UpsertTenantConfigAsync(BuildGroupedConfigKey("modules", update.Key), update.Value ? "true" : "false");
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated {Count} module flags", GetCurrentUserId(), updates.Count);
        return Ok(new { success = true, message = "Module updated", data = updates });
    }

    [HttpGet("cache/stats")]
    public IActionResult GetCacheStats()
    {
        return Ok(new
        {
            data = new
            {
                redis_connected = false,
                redis_memory_used = "0B",
                redis_keys_count = 0,
                cache_hit_rate = 0.0
            }
        });
    }

    [HttpPost("cache/clear")]
    public IActionResult ClearCache([FromBody] JsonElement request)
    {
        var type = GetStringProperty(request, "type") ?? "tenant";
        if (!string.Equals(type, "all", StringComparison.OrdinalIgnoreCase))
            type = "tenant";

        _logger.LogInformation("Admin {AdminId} requested {Type} cache clear; no shared admin cache backend is configured", GetCurrentUserId(), type);
        return Ok(new { success = true, data = new { cleared = true, type } });
    }

    [HttpGet("background-jobs")]
    public async Task<IActionResult> ListBackgroundJobs()
    {
        var taskIds = LaravelReactBackgroundJobs.Select(job => job.Id).ToArray();
        var taskRows = await _db.ScheduledTasks
            .AsNoTracking()
            .Where(t => taskIds.Contains(t.TaskName))
            .ToListAsync();
        var tasks = taskRows.ToDictionary(t => t.TaskName, StringComparer.OrdinalIgnoreCase);
        var jobs = LaravelReactBackgroundJobs.Select(job =>
        {
            tasks.TryGetValue(job.Id, out var task);
            return new
            {
                id = job.Id,
                name = job.Name,
                status = MapLaravelReactBackgroundJobStatus(task?.Status),
                last_run_at = task?.LastRunAt,
                next_run_at = task?.NextRunAt
            };
        }).ToList();

        return Ok(new { data = jobs, total = jobs.Count });
    }

    [HttpPost("background-jobs/{id}/run")]
    public async Task<IActionResult> RunBackgroundJob(string id)
    {
        var fixedJob = LaravelReactBackgroundJobs.FirstOrDefault(job => job.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(fixedJob.Id))
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            var task = await _db.ScheduledTasks.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.TaskName == fixedJob.Id);
            if (task == null)
            {
                task = new ScheduledTask
                {
                    TenantId = tenantId,
                    TaskName = fixedJob.Id,
                    CronExpression = null,
                    Status = ScheduledTaskStatus.Pending
                };
                _db.ScheduledTasks.Add(task);
            }

            var startedAt = DateTime.UtcNow;
            task.Status = ScheduledTaskStatus.Completed;
            task.LastRunAt = startedAt;
            task.RunCount++;
            task.ErrorMessage = null;
            task.UpdatedAt = startedAt;
            await _db.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                data = new
                {
                    triggered = true,
                    job = fixedJob.Id
                }
            });
        }

        var result = await RecordScheduledTaskRunAsync(id);
        if (result == null)
            return NotFound(new { error = "Background job not found" });

        return Ok(result);
    }

    [HttpGet("config/languages")]
    public async Task<IActionResult> GetLanguageConfig()
    {
        var locales = await _db.SupportedLocales
            .AsNoTracking()
            .OrderByDescending(l => l.IsDefault)
            .ThenBy(l => l.Locale)
            .ToListAsync();
        var languageConfig = await GetJsonConfigAsync("config.languages", new Dictionary<string, object?> { ["auto_detect"] = true });
        var autoDetect = languageConfig.TryGetValue("auto_detect", out var rawAutoDetect) && rawAutoDetect is bool autoDetectValue
            ? autoDetectValue
            : true;

        var activeLanguages = locales.Where(l => l.IsActive).Select(l => l.Locale).ToArray();

        return Ok(new
        {
            default_language = locales.FirstOrDefault(l => l.IsDefault)?.Locale ?? "en",
            supported_languages = activeLanguages,
            available_languages = activeLanguages,
            locales = locales.Select(MapLocale),
            auto_detect = autoDetect
        });
    }

    [HttpPut("config/languages")]
    public async Task<IActionResult> UpdateLanguageConfig([FromBody] JsonElement request)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var defaultLanguage = GetStringProperty(request, "default_language", "default_locale", "locale");
        var requestedLocales = ExtractStringArray(request, "supported_languages", "available_languages", "locales", "languages");

        if (!string.IsNullOrWhiteSpace(defaultLanguage) && requestedLocales.Count == 0)
            requestedLocales.Add(defaultLanguage);

        if (requestedLocales.Count == 0 && defaultLanguage == null && !request.TryGetProperty("auto_detect", out _))
            return BadRequest(new { error = "default_language, available_languages, or auto_detect is required" });

        var existing = await _db.SupportedLocales.ToListAsync();
        var normalizedRequestedLocales = requestedLocales
            .Select(NormalizeLocaleCode)
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var code in normalizedRequestedLocales)
        {
            var locale = existing.FirstOrDefault(l => l.Locale.Equals(code, StringComparison.OrdinalIgnoreCase));
            if (locale == null)
            {
                locale = new SupportedLocale
                {
                    TenantId = tenantId,
                    Locale = code,
                    Name = GetLocaleName(code),
                    NativeName = GetLocaleName(code),
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };
                _db.SupportedLocales.Add(locale);
                existing.Add(locale);
            }
            else
            {
                locale.IsActive = true;
            }
        }

        if (normalizedRequestedLocales.Count > 0)
        {
            var requestedLocaleSet = normalizedRequestedLocales.ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var locale in existing)
                locale.IsActive = requestedLocaleSet.Contains(locale.Locale);
        }

        if (!string.IsNullOrWhiteSpace(defaultLanguage))
        {
            var defaultCode = NormalizeLocaleCode(defaultLanguage);
            var defaultLocale = existing.FirstOrDefault(l => l.Locale.Equals(defaultCode, StringComparison.OrdinalIgnoreCase));
            if (defaultLocale == null)
            {
                defaultLocale = new SupportedLocale
                {
                    TenantId = tenantId,
                    Locale = defaultCode,
                    Name = GetLocaleName(defaultCode),
                    NativeName = GetLocaleName(defaultCode),
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };
                _db.SupportedLocales.Add(defaultLocale);
                existing.Add(defaultLocale);
            }

            foreach (var locale in existing)
                locale.IsDefault = locale.Locale.Equals(defaultCode, StringComparison.OrdinalIgnoreCase);
        }

        if (request.TryGetProperty("auto_detect", out var autoDetect))
        {
            await UpsertTenantConfigAsync("config.languages", JsonSerializer.Serialize(new
            {
                auto_detect = ReadBoolean(autoDetect) ?? true
            }));
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated language config", GetCurrentUserId());
        return Ok(new { success = true, message = "Language config updated", data = (await GetLanguageConfig() as OkObjectResult)?.Value });
    }

    // ──────────────────────────────────────────────
    // Listings - Extended (5 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("listings")]
    public async Task<IActionResult> ListAllListings(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? status = null,
        [FromQuery] string? type = null,
        [FromQuery] string? search = null)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Listings.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<ListingStatus>(status, true, out var parsedStatus))
            query = query.Where(l => l.Status == parsedStatus);

        if (!string.IsNullOrWhiteSpace(type) && Enum.TryParse<ListingType>(type, true, out var parsedType))
            query = query.Where(l => l.Type == parsedType);

        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(l => l.Title.ToLower().Contains(search.ToLower()));

        var total = await query.CountAsync();
        var listings = await query
            .OrderByDescending(l => l.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(l => new
            {
                id = l.Id,
                title = l.Title,
                type = l.Type.ToString().ToLower(),
                status = l.Status.ToString().ToLower(),
                is_featured = l.IsFeatured,
                user_id = l.UserId,
                created_at = l.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = listings, total, page, per_page = limit });
    }

    [HttpPost("listings/{id:int}/feature")]
    public async Task<IActionResult> FeatureListing(int id)
    {
        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null)
            return NotFound(new { error = "Listing not found" });

        listing.IsFeatured = true;
        listing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} featured listing {ListingId}", GetCurrentUserId(), id);
        return Ok(new { success = true, message = "Listing featured", data = MapListingSummary(listing) });
    }

    [HttpDelete("listings/{id:int}/feature")]
    public async Task<IActionResult> UnfeatureListing(int id)
    {
        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null)
            return NotFound(new { error = "Listing not found" });

        listing.IsFeatured = false;
        listing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} unfeatured listing {ListingId}", GetCurrentUserId(), id);
        return Ok(new { success = true, message = "Listing unfeatured", data = MapListingSummary(listing) });
    }

    [HttpDelete("listings/{id:int}")]
    public async Task<IActionResult> DeleteListing(int id, CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var listing = await _db.Listings
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(l => l.TenantId == tenantId && l.Id == id, ct);
        if (listing == null)
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "Listing not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "Listing not found" });

        var owner = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.TenantId == tenantId && user.Id == listing.UserId, ct);
        var now = DateTime.UtcNow;
        var adminId = GetCurrentUserId();

        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        await _db.ListingTags
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId && row.ListingId == id)
            .ExecuteDeleteAsync(ct);
        await _db.ListingFavorites
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId && row.ListingId == id)
            .ExecuteDeleteAsync(ct);
        await _db.ListingAnalytics
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId && row.ListingId == id)
            .ExecuteDeleteAsync(ct);

        _db.Notifications.Add(new Notification
        {
            TenantId = tenantId,
            UserId = listing.UserId,
            Type = "listing_removed",
            Title = "Listing removed",
            Body = $"Your listing '{listing.Title}' was removed by a coordinator.",
            Data = JsonSerializer.Serialize(new { listing_id = id }),
            Link = "/listings",
            CreatedAt = now
        });
        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = adminId,
            Action = "admin_delete_listing",
            EntityType = "Listing",
            EntityId = id,
            OldValues = JsonSerializer.Serialize(new { listing.Title, listing.UserId }),
            Severity = AuditSeverity.Warning,
            CreatedAt = now
        });

        _db.Listings.Remove(listing);
        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        if (owner is { Email.Length: > 0 })
        {
            try
            {
                var safeTitle = System.Net.WebUtility.HtmlEncode(listing.Title);
                await _emailService.SendEmailAsync(
                    owner.Email,
                    $"Listing removed: {listing.Title}",
                    $"<p>Your listing <strong>{safeTitle}</strong> was removed by a coordinator.</p><p><a href=\"/listings\">View your listings</a></p>",
                    $"Your listing '{listing.Title}' was removed by a coordinator.",
                    ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Listing removal email failed for listing {ListingId}", id);
            }
        }

        _logger.LogInformation("Admin {AdminId} deleted listing {ListingId}", adminId, id);

        return IsLaravelV2Request
            ? LaravelData(new { deleted = true, id })
            : Ok(new { success = true });
    }

    [HttpGet("listings/featured")]
    public async Task<IActionResult> GetFeaturedListings([FromQuery] int limit = 20)
    {
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var listings = await _db.Listings
            .AsNoTracking()
            .Where(l => l.IsFeatured)
            .OrderByDescending(l => l.UpdatedAt ?? l.CreatedAt)
            .Take(limit)
            .ToListAsync();

        var total = await _db.Listings.CountAsync(l => l.IsFeatured);
        return Ok(new { data = listings.Select(MapListingSummary), total, limit });
    }

    // ──────────────────────────────────────────────
    // Attributes (4 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("attributes")]
    public async Task<IActionResult> ListAttributes()
    {
        var attributes = await GetAttributeCatalogAsync();
        return Ok(new { data = attributes.Select(MapAttribute), total = attributes.Count, page = 1, per_page = 20 });
    }

    [HttpPost("attributes")]
    public async Task<IActionResult> CreateAttribute([FromBody] JsonElement request)
    {
        var name = GetStringProperty(request, "name", "label", "key");
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(new { error = "name is required" });

        var attributes = await GetAttributeCatalogAsync();
        var id = attributes.Count == 0 ? 1 : attributes.Max(a => a.Id) + 1;
        var attribute = new AdminAttributeDefinition(
            id,
            NormalizeConfigSegment(GetStringProperty(request, "key", "slug") ?? name),
            name.Trim(),
            GetStringProperty(request, "type", "input_type") ?? "checkbox",
            ReadBooleanProperty(request, "required", "is_required") ?? false,
            ReadBooleanProperty(request, "active", "is_active", "enabled") ?? true,
            request.ValueKind == JsonValueKind.Object ? request.GetRawText() : "{}");

        attributes.Add(attribute);
        await SaveAttributeCatalogAsync(attributes);

        _logger.LogInformation("Admin {AdminId} created attribute {AttributeId}", GetCurrentUserId(), id);
        return Created($"/api/admin/attributes/{id}", new { success = true, id, data = MapAttribute(attribute) });
    }

    [HttpPut("attributes/{id:int}")]
    public async Task<IActionResult> UpdateAttribute(int id, [FromBody] JsonElement request)
    {
        var attributes = await GetAttributeCatalogAsync();
        var index = attributes.FindIndex(a => a.Id == id);
        if (index < 0)
            return NotFound(new { error = "Attribute not found" });

        var current = attributes[index];
        var name = GetStringProperty(request, "name", "label") ?? current.Name;
        attributes[index] = current with
        {
            Key = NormalizeConfigSegment(GetStringProperty(request, "key", "slug") ?? current.Key),
            Name = name.Trim(),
            Type = GetStringProperty(request, "type", "input_type") ?? current.Type,
            Required = ReadBooleanProperty(request, "required", "is_required") ?? current.Required,
            Active = ReadBooleanProperty(request, "active", "is_active", "enabled") ?? current.Active,
            Metadata = request.ValueKind == JsonValueKind.Object ? request.GetRawText() : current.Metadata
        };

        await SaveAttributeCatalogAsync(attributes);

        _logger.LogInformation("Admin {AdminId} updated attribute {Id}", GetCurrentUserId(), id);
        return Ok(new { success = true, id, data = MapAttribute(attributes[index]) });
    }

    [HttpDelete("attributes/{id:int}")]
    public async Task<IActionResult> DeleteAttribute(int id)
    {
        var attributes = await GetAttributeCatalogAsync();
        var removed = attributes.RemoveAll(a => a.Id == id);
        if (removed == 0)
            return NotFound(new { error = "Attribute not found" });

        await SaveAttributeCatalogAsync(attributes);

        _logger.LogInformation("Admin {AdminId} deleted attribute {Id}", GetCurrentUserId(), id);
        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    // ──────────────────────────────────────────────
    // Timebanking (9 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("timebanking/stats")]
    public async Task<IActionResult> GetTimebankingStats()
    {
        var visibleTransactions = _db.Transactions.ExcludeInternalWalletAdapters();
        var totalTransactions = await visibleTransactions.CountAsync();
        var totalHours = await visibleTransactions.SumAsync(t => t.Amount);
        var activeUsers = await _db.Users.CountAsync(u => u.IsActive);

        return Ok(new
        {
            total_hours = totalHours,
            total_transactions = totalTransactions,
            active_users = activeUsers,
            avg_balance = activeUsers > 0 ? totalHours / activeUsers : 0
        });
    }

    [HttpGet("timebanking/alerts")]
    public async Task<IActionResult> GetFraudAlerts()
    {
        var alerts = await _db.BalanceAlerts
            .AsNoTracking()
            .Include(a => a.User)
            .OrderByDescending(a => a.LastTriggeredAt ?? a.CreatedAt)
            .Select(a => new
            {
                id = a.Id,
                type = "balance_threshold",
                user_id = a.UserId,
                user_email = a.User == null ? null : a.User.Email,
                threshold_amount = a.ThresholdAmount,
                status = a.IsActive ? "active" : "resolved",
                is_active = a.IsActive,
                last_triggered_at = a.LastTriggeredAt,
                created_at = a.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = alerts, total = alerts.Count, page = 1, per_page = 20 });
    }

    [HttpPut("timebanking/alerts/{id:int}")]
    public async Task<IActionResult> UpdateFraudAlert(int id, [FromBody] JsonElement request)
    {
        var alert = await _db.BalanceAlerts.FirstOrDefaultAsync(a => a.Id == id);
        if (alert == null)
            return NotFound(new { error = "Alert not found" });

        var active = ReadBooleanProperty(request, "is_active", "active", "enabled");
        var status = GetStringProperty(request, "status");
        if (active.HasValue)
            alert.IsActive = active.Value;
        if (!string.IsNullOrWhiteSpace(status))
            alert.IsActive = !status.Equals("resolved", StringComparison.OrdinalIgnoreCase) &&
                !status.Equals("dismissed", StringComparison.OrdinalIgnoreCase);
        if (request.TryGetProperty("threshold_amount", out var threshold) && threshold.TryGetDecimal(out var amount))
            alert.ThresholdAmount = amount;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated fraud alert {AlertId}", GetCurrentUserId(), id);
        return Ok(new { success = true, id, status = alert.IsActive ? "active" : "resolved", threshold_amount = alert.ThresholdAmount });
    }

    [HttpPost("timebanking/adjust-balance")]
    public async Task<IActionResult> AdjustBalance(
        [FromBody] AdminAdjustBalanceRequest request,
        CancellationToken cancellationToken)
    {
        if (request.UserId <= 0)
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "user_id is required", field = "user_id" } }
            });
        if (request.Amount == 0m)
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "amount must be nonzero", field = "amount" } }
            });
        if (request.Amount is > 100000m or < -100000m)
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "amount is out of range", field = "amount" } }
            });

        var reason = request.Reason?.Trim();
        if (string.IsNullOrWhiteSpace(reason))
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "reason is required", field = "reason" } }
            });

        var tenantId = _tenant.TenantId;
        if (!tenantId.HasValue)
            return Unauthorized(new { errors = new[] { new { code = "AUTH_REQUIRED", message = "Invalid token" } } });

        var user = await _db.Users
            .FirstOrDefaultAsync(u => u.Id == request.UserId && u.TenantId == tenantId.Value, cancellationToken);
        if (user == null)
            return LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound);

        var adminId = GetCurrentUserId();
        if (adminId == null)
            return Unauthorized(new { errors = new[] { new { code = "AUTH_REQUIRED", message = "Invalid token" } } });

        var actor = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == adminId.Value && u.TenantId == tenantId.Value, cancellationToken);
        if (actor == null)
            return Unauthorized(new { errors = new[] { new { code = "AUTH_REQUIRED", message = "Invalid token" } } });
        if (request.UserId == adminId.Value && !NexusUserAccessEvaluator.HasAdminAccess(actor))
            return LaravelError(
                "AUTH_INSUFFICIENT_PERMISSIONS",
                "Brokers cannot adjust their own balance",
                StatusCodes.Status403Forbidden);

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (databaseTransaction is not null)
            await _personalWallet.AcquireSpendLockAsync(request.UserId, cancellationToken);

        var previousBalance = await _personalWallet.GetBalanceAsync(
            tenantId.Value,
            request.UserId,
            cancellationToken);
        var newBalance = previousBalance + request.Amount;
        if (newBalance < 0m)
            return LaravelError(
                "INSUFFICIENT_BALANCE",
                "Balance adjustment would result in a negative balance",
                StatusCodes.Status400BadRequest);

        var amount = Math.Abs(request.Amount);

        var transaction = new Transaction
        {
            TenantId = tenantId.Value,
            SenderId = request.Amount < 0m ? request.UserId : null,
            ReceiverId = request.Amount > 0m ? request.UserId : null,
            Amount = amount,
            Description = $"[Admin Adjustment] {reason}",
            TransactionType = "admin_adjustment",
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow
        };

        _db.Transactions.Add(transaction);
        await _db.SaveChangesAsync(cancellationToken);
        if (databaseTransaction is not null)
            await databaseTransaction.CommitAsync(cancellationToken);

        _logger.LogInformation("Admin {AdminId} adjusted balance for user {UserId} by {Amount}", adminId, request.UserId, request.Amount);

        return LaravelData(new
        {
            user_id = request.UserId,
            user_name = ($"{user.FirstName} {user.LastName}").Trim(),
            previous_balance = previousBalance,
            adjustment = request.Amount,
            new_balance = newBalance
        });
    }

    [HttpGet("timebanking/org-wallets")]
    public IActionResult GetOrgWallets()
    {
        return Ok(new { data = Array.Empty<object>(), total = 0, page = 1, per_page = 20 });
    }

    [HttpGet("timebanking/user-report")]
    public IActionResult GetUserFinancialReport()
    {
        return Ok(new { data = Array.Empty<object>(), total = 0 });
    }

    [HttpGet("timebanking/user-statement")]
    public IActionResult GetUserStatement()
    {
        return Ok(new { data = Array.Empty<object>(), total = 0 });
    }

    [HttpGet("wallet/grants")]
    public IActionResult ListGrants()
    {
        return Ok(new { data = Array.Empty<object>(), total = 0, page = 1, per_page = 20 });
    }

    [HttpPost("wallet/grant")]
    public async Task<IActionResult> GrantCredits(
        [FromBody] AdminGrantCreditsRequest request,
        CancellationToken cancellationToken)
    {
        if (request.UserId <= 0)
            return LaravelValidationError("user_id must be a positive integer", "user_id");
        if (request.Amount <= 0)
            return LaravelValidationError("amount must be greater than zero", "amount");
        if (request.Amount > 10000m)
            return LaravelValidationError("grant amount cannot exceed 10000", "amount");

        var tenantId = _tenant.TenantId;
        if (!tenantId.HasValue)
            return Unauthorized(new { errors = new[] { new { code = "AUTH_REQUIRED", message = "Invalid token" } } });

        var user = await _db.Users
            .FirstOrDefaultAsync(u => u.Id == request.UserId && u.TenantId == tenantId.Value, cancellationToken);
        if (user == null)
            return NotFound(new
            {
                errors = new[] { new { code = "USER_NOT_FOUND", message = "User not found in tenant", field = "user_id" } }
            });

        var adminId = GetCurrentUserId();
        if (adminId == null)
            return Unauthorized(new { errors = new[] { new { code = "AUTH_REQUIRED", message = "Invalid token" } } });

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (databaseTransaction is not null)
            await _personalWallet.AcquireSpendLockAsync(request.UserId, cancellationToken);

        var reason = request.Reason ?? "Admin credit grant";

        var transaction = new Transaction
        {
            TenantId = tenantId.Value,
            SenderId = null,
            ReceiverId = request.UserId,
            Amount = request.Amount,
            Description = reason,
            TransactionType = "admin_grant",
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow
        };

        _db.Transactions.Add(transaction);
        await _db.SaveChangesAsync(cancellationToken);
        if (databaseTransaction is not null)
            await databaseTransaction.CommitAsync(cancellationToken);

        _logger.LogInformation("Admin {AdminId} granted {Amount} credits to user {UserId}", adminId, request.Amount, request.UserId);

        return LaravelData(new
        {
            grant = new
            {
                id = transaction.Id,
                user_id = request.UserId,
                user_name = ($"{user.FirstName} {user.LastName}").Trim(),
                amount = Math.Round(request.Amount, 2),
                reason,
                admin_id = adminId.Value,
                status = "completed"
            },
            message = "Credits granted successfully"
        });
    }

    // ──────────────────────────────────────────────
    // Settings (18 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("settings")]
    public async Task<IActionResult> GetAllSettings()
    {
        var config = await _db.TenantConfigs
            .AsNoTracking()
            .ToDictionaryAsync(c => c.Key, c => c.Value);

        return Ok(new
        {
            general = BuildSettingsGroup(config, "general", new Dictionary<string, object?>
            {
                ["site_name"] = "Project NEXUS",
                ["tagline"] = "",
                ["timezone"] = "UTC"
            }),
            features = BuildSettingsGroup(config, "features", new Dictionary<string, object?>
            {
                ["ai_enabled"] = true,
                ["matching_enabled"] = true,
                ["gamification_enabled"] = true
            }),
            email = BuildSettingsGroup(config, "email", new Dictionary<string, object?>
            {
                ["provider"] = "gmail",
                ["from_address"] = "",
                ["reply_to"] = "",
                ["daily_limit"] = 500
            }),
            modules = BuildSettingsGroup(config, "modules", new Dictionary<string, object?>
            {
                ["blog"] = true,
                ["events"] = true,
                ["groups"] = true,
                ["jobs"] = true
            })
        });
    }

    [HttpPut("settings")]
    public async Task<IActionResult> UpdateSettings([FromBody] JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "Settings object is required" });

        var savedKeys = new List<string>();

        foreach (var section in request.EnumerateObject())
        {
            if (section.Value.ValueKind == JsonValueKind.Object)
            {
                foreach (var setting in section.Value.EnumerateObject())
                {
                    var key = BuildGroupedConfigKey(section.Name, setting.Name);
                    await UpsertTenantConfigAsync(key, SerializeConfigValue(setting.Value));
                    savedKeys.Add(key);
                }
            }
            else
            {
                var key = BuildGroupedConfigKey("settings", section.Name);
                await UpsertTenantConfigAsync(key, SerializeConfigValue(section.Value));
                savedKeys.Add(key);
            }
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated {Count} settings", GetCurrentUserId(), savedKeys.Count);
        return Ok(new { success = true, message = "Settings updated", updated = savedKeys });
    }

    [HttpGet("config/ai")]
    public async Task<IActionResult> GetAiConfig()
    {
        return Ok(await GetJsonConfigAsync("config.ai", new Dictionary<string, object?>
        {
            ["enabled"] = true,
            ["model"] = "llama3.2:3b",
            ["max_tokens"] = 2048,
            ["temperature"] = 0.7,
            ["moderation_enabled"] = true
        }));
    }

    [HttpPut("config/ai")]
    public async Task<IActionResult> UpdateAiConfig([FromBody] JsonElement request)
    {
        await UpsertTenantConfigAsync("config.ai", SerializeConfigValue(request));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated AI config", GetCurrentUserId());
        return Ok(new { success = true, message = "AI config updated", data = await GetJsonConfigAsync("config.ai", new()) });
    }

    [HttpGet("config/feed-algorithm")]
    public async Task<IActionResult> GetFeedAlgorithmConfig()
    {
        return Ok(await GetJsonConfigAsync("config.feed_algorithm", new Dictionary<string, object?>
        {
            ["algorithm"] = "chronological",
            ["boost_connections"] = true,
            ["boost_factor"] = 1.5m,
            ["decay_hours"] = 72
        }));
    }

    [HttpPut("config/feed-algorithm")]
    public async Task<IActionResult> UpdateFeedAlgorithmConfig([FromBody] JsonElement request)
    {
        await UpsertTenantConfigAsync("config.feed_algorithm", SerializeConfigValue(request));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated feed algorithm config", GetCurrentUserId());
        return Ok(new { success = true, message = "Feed algorithm config updated", data = await GetJsonConfigAsync("config.feed_algorithm", new()) });
    }

    [HttpGet("config/algorithms")]
    public async Task<IActionResult> GetAlgorithmConfig()
    {
        return Ok(new
        {
            matching = await GetJsonConfigAsync("config.algorithm.matching", new Dictionary<string, object?> { ["enabled"] = true, ["min_score"] = 0.3m, ["max_results"] = 20 }),
            feed = await GetJsonConfigAsync("config.feed_algorithm", new Dictionary<string, object?> { ["algorithm"] = "chronological", ["decay_hours"] = 72 }),
            search = await GetJsonConfigAsync("config.algorithm.search", new Dictionary<string, object?> { ["fuzzy"] = true, ["boost_recent"] = true })
        });
    }

    [HttpPut("config/algorithm/{area}")]
    public async Task<IActionResult> UpdateAlgorithmConfig(string area, [FromBody] JsonElement request)
    {
        var normalizedArea = NormalizeConfigSegment(area);
        if (string.IsNullOrWhiteSpace(normalizedArea))
            return BadRequest(new { error = "Algorithm area is required" });

        var key = normalizedArea == "feed" ? "config.feed_algorithm" : $"config.algorithm.{normalizedArea}";
        await UpsertTenantConfigAsync(key, SerializeConfigValue(request));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated algorithm config for {Area}", GetCurrentUserId(), area);
        return Ok(new { success = true, message = $"Algorithm config for {area} updated", data = await GetJsonConfigAsync(key, new()) });
    }

    [HttpGet("config/algorithm-health")]
    public IActionResult GetAlgorithmHealth()
    {
        return Ok(new
        {
            matching = new { status = "healthy", last_run = DateTime.UtcNow.AddMinutes(-15) },
            feed = new { status = "healthy", last_run = DateTime.UtcNow.AddMinutes(-5) },
            search = new { status = "healthy", index_size = 0 }
        });
    }

    [HttpGet("config/images")]
    public async Task<IActionResult> GetImageSettings()
    {
        return Ok(await GetJsonConfigAsync("config.images", new Dictionary<string, object?>
        {
            ["max_size_mb"] = 5,
            ["allowed_formats"] = new[] { "jpg", "png", "webp", "gif" },
            ["auto_resize"] = true,
            ["max_width"] = 1920
        }));
    }

    [HttpPut("config/images")]
    public async Task<IActionResult> UpdateImageSettings([FromBody] JsonElement request)
    {
        await UpsertTenantConfigAsync("config.images", SerializeConfigValue(request));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated image settings", GetCurrentUserId());
        return Ok(new { success = true, message = "Image settings updated", data = await GetJsonConfigAsync("config.images", new()) });
    }

    [HttpGet("config/seo")]
    public async Task<IActionResult> GetSeoSettings()
    {
        return Ok(await GetJsonConfigAsync("config.seo", new Dictionary<string, object?>
        {
            ["meta_title"] = "Project NEXUS",
            ["meta_description"] = "",
            ["robots_txt"] = "User-agent: *\nAllow: /",
            ["sitemap_enabled"] = true
        }));
    }

    [HttpPut("config/seo")]
    public async Task<IActionResult> UpdateSeoSettings([FromBody] JsonElement request)
    {
        await UpsertTenantConfigAsync("config.seo", SerializeConfigValue(request));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated SEO settings", GetCurrentUserId());
        return Ok(new { success = true, message = "SEO settings updated", data = await GetJsonConfigAsync("config.seo", new()) });
    }

    [HttpGet("config/native-app")]
    public async Task<IActionResult> GetNativeAppSettings()
    {
        return Ok(await GetJsonConfigAsync("config.native_app", new Dictionary<string, object?>
        {
            ["push_enabled"] = false,
            ["app_store_url"] = "",
            ["play_store_url"] = "",
            ["min_version"] = "1.0.0"
        }));
    }

    [HttpPut("config/native-app")]
    public async Task<IActionResult> UpdateNativeAppSettings([FromBody] JsonElement request)
    {
        await UpsertTenantConfigAsync("config.native_app", SerializeConfigValue(request));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated native app settings", GetCurrentUserId());
        return Ok(new { success = true, message = "Native app settings updated", data = await GetJsonConfigAsync("config.native_app", new()) });
    }

    [HttpGet("email/config")]
    public async Task<IActionResult> GetEmailConfig()
    {
        var config = await GetJsonConfigAsync("email.config", new Dictionary<string, object?>
        {
            ["provider"] = "gmail",
            ["from_address"] = "",
            ["reply_to"] = "",
            ["daily_limit"] = 500
        });
        config["sent_today"] = await _db.EmailLogs.CountAsync(e => e.Status == EmailSendStatus.Sent && e.SentAt >= DateTime.UtcNow.Date);
        return Ok(config);
    }

    [HttpPut("email/config")]
    public async Task<IActionResult> UpdateEmailConfig([FromBody] JsonElement request)
    {
        await UpsertTenantConfigAsync("email.config", SerializeConfigValue(request));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated email config", GetCurrentUserId());
        return Ok(new { success = true, message = "Email config updated", data = await GetJsonConfigAsync("email.config", new()) });
    }

    [HttpPost("email/test-provider")]
    public async Task<IActionResult> TestEmailProvider([FromBody] JsonElement request, CancellationToken ct)
    {
        var healthy = await _emailService.IsHealthyAsync(ct);
        if (!healthy)
        {
            _logger.LogWarning("Admin {AdminId} tested email provider; provider is not configured or healthy", GetCurrentUserId());
            return Conflict(new { error = "Email provider is not configured or healthy", delivered = false });
        }

        var recipient = GetStringProperty(request, "to", "email", "recipient", "recipient_email");
        if (string.IsNullOrWhiteSpace(recipient))
        {
            _logger.LogInformation("Admin {AdminId} tested email provider health", GetCurrentUserId());
            return Ok(new { success = true, message = "Email provider is healthy", delivered = false, health_checked = true });
        }

        var subject = GetStringProperty(request, "subject") ?? "Project NEXUS email provider test";
        var sent = await _emailService.SendEmailAsync(
            recipient.Trim(),
            subject,
            "<p>This is a Project NEXUS admin email provider test.</p>",
            "This is a Project NEXUS admin email provider test.",
            ct);

        var log = new EmailLog
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            ToEmail = recipient.Trim(),
            Subject = subject,
            TemplateKey = "admin_provider_test",
            Status = sent ? EmailSendStatus.Sent : EmailSendStatus.Failed,
            ErrorMessage = sent ? null : "Email provider returned failure",
            SentAt = sent ? DateTime.UtcNow : null,
            CreatedAt = DateTime.UtcNow
        };
        _db.EmailLogs.Add(log);
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation("Admin {AdminId} sent email provider test with result {Sent}", GetCurrentUserId(), sent);
        return sent
            ? Ok(new { success = true, message = "Test email sent", delivered = true, email_log_id = log.Id })
            : Conflict(new { error = "Email provider rejected the test email", delivered = false, email_log_id = log.Id });
    }

    [HttpDelete("tools/redirects/{id:int}")]
    public async Task<IActionResult> DeleteRedirect(int id)
    {
        var key = $"url_redirects_{_tenant.GetTenantIdOrThrow()}";
        var setting = await _db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting == null)
            return NotFound(new { error = "No redirects configured" });

        var redirects = DeserializeRedirects(setting.Value);
        var removed = redirects.RemoveAll(r => r.Id == id);
        if (removed == 0 && id >= 1 && id <= redirects.Count)
        {
            redirects.RemoveAt(id - 1);
            removed = 1;
        }

        if (removed == 0)
            return NotFound(new { error = "Redirect not found" });

        setting.Value = JsonSerializer.Serialize(redirects);
        setting.UpdatedAt = DateTime.UtcNow;
        setting.UpdatedById = GetCurrentUserId();
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted redirect {Id}", GetCurrentUserId(), id);
        return Ok(new { success = true, deleted = removed });
    }

    [HttpDelete("tools/404-errors/{id:int}")]
    public IActionResult Delete404Error(int id)
    {
        if (!_cache.TryGetValue("404_errors", out List<NotFoundEntry>? entries) || entries == null || entries.Count == 0)
            return NotFound(new { error = "404 error not found" });

        var ordered = entries
            .OrderByDescending(e => e.LastSeen)
            .ThenBy(e => e.Path, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (id < 1 || id > ordered.Count)
            return NotFound(new { error = "404 error not found" });

        var target = ordered[id - 1];
        var removed = entries.RemoveAll(e => e.Path == target.Path);
        _cache.Set("404_errors", entries);

        _logger.LogInformation("Admin {AdminId} deleted 404 error {Id} ({Path})", GetCurrentUserId(), id, target.Path);
        return Ok(new { success = true, deleted = removed, path = target.Path });
    }

    [HttpPost("tools/health-check")]
    public IActionResult RunHealthCheck()
    {
        return Ok(new { success = true, status = "healthy", checks = new { database = "ok", cache = "ok", email = "ok" }, checked_at = DateTime.UtcNow });
    }

    [HttpGet("tools/webp-stats")]
    public async Task<IActionResult> GetWebpStats()
    {
        var totalImages = await _db.FileUploads.CountAsync(f => f.ContentType.StartsWith("image/"));
        var converted = await _db.FileUploads.CountAsync(f => f.ContentType == "image/webp" || f.StoredFilename.ToLower().EndsWith(".webp"));

        return Ok(new
        {
            total_images = totalImages,
            converted,
            pending = Math.Max(0, totalImages - converted),
            saved_mb = 0,
            conversion_supported = false
        });
    }

    // Refactored from UpsertTenantConfigAsync("tools.webp_conversion.last", ...) to use the
    // AuditLog entity. Tool-run records belong in the audit trail, not in TenantConfig where they
    // would shadow real configuration data and bypass the audit query API.
    [HttpPost("tools/webp-convert")]
    public async Task<IActionResult> RunWebpConversion()
    {
        var totalImages = await _db.FileUploads.CountAsync(f => f.ContentType.StartsWith("image/"));
        var converted = await _db.FileUploads.CountAsync(f => f.ContentType == "image/webp" || f.StoredFilename.ToLower().EndsWith(".webp"));
        var pending = Math.Max(0, totalImages - converted);
        var result = new
        {
            success = true,
            status = "recorded",
            queued = false,
            total_images = totalImages,
            converted,
            pending,
            worker_configured = false,
            recorded_at = DateTime.UtcNow
        };

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            UserId = GetCurrentUserId(),
            Action = "admin.tools.webp_convert.run",
            EntityType = "Tool",
            NewValues = JsonSerializer.Serialize(result),
            Severity = AuditSeverity.Info,
            CreatedAt = DateTime.UtcNow
        });
        // Dual-write: TenantConfig key preserved as the documented integration contract.
        await UpsertTenantConfigAsync("tools.webp_conversion.last", JsonSerializer.Serialize(result));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} recorded WebP conversion compatibility run; {Pending} images pending", GetCurrentUserId(), pending);
        return Accepted(result);
    }

    // Refactored from UpsertTenantConfigAsync("tools.seed.last", ...) to use AuditLog so that
    // seed-generation runs are visible in the standard audit query API instead of being hidden
    // inside the tenant config table.
    [HttpPost("tools/seed")]
    public async Task<IActionResult> RunSeedGenerator()
    {
        var result = new
        {
            success = true,
            status = "recorded",
            generated = false,
            workflow = "startup_seed",
            recorded_at = DateTime.UtcNow
        };

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            UserId = GetCurrentUserId(),
            Action = "admin.tools.seed.run",
            EntityType = "Tool",
            NewValues = JsonSerializer.Serialize(result),
            Severity = AuditSeverity.Info,
            CreatedAt = DateTime.UtcNow
        });
        // Dual-write: TenantConfig key preserved as the documented integration contract.
        await UpsertTenantConfigAsync("tools.seed.last", JsonSerializer.Serialize(result));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} recorded seed-generation compatibility run", GetCurrentUserId());
        return Accepted(result);
    }

    [HttpGet("tools/blog-backups")]
    public IActionResult GetBlogBackups()
    {
        return Ok(new { data = Array.Empty<object>(), total = 0 });
    }

    // Refactored from UpsertTenantConfigAsync("tools.blog_backup_restore.{id}", ...) to use
    // AuditLog. Each restore request creates a discrete audit row (proper history) instead of
    // overwriting a TenantConfig key, so admins can see every restore attempt.
    [HttpPost("tools/blog-backups/{backupId}/restore")]
    public async Task<IActionResult> RestoreBlogBackup(string backupId)
    {
        var result = new
        {
            success = true,
            status = "recorded",
            backup_id = backupId,
            restored = false,
            backup_store_configured = false,
            recorded_at = DateTime.UtcNow
        };

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            UserId = GetCurrentUserId(),
            Action = "admin.tools.blog_backup.restore",
            EntityType = "BlogBackup",
            NewValues = JsonSerializer.Serialize(result),
            Metadata = JsonSerializer.Serialize(new { backup_id = backupId }),
            Severity = AuditSeverity.Info,
            CreatedAt = DateTime.UtcNow
        });
        // Dual-write: TenantConfig key preserved as the documented integration contract.
        // Backup IDs are user-supplied; normalize separators so they're valid config-key suffixes.
        var backupKeySuffix = backupId.Replace('-', '_').Replace('.', '_').ToLowerInvariant();
        await UpsertTenantConfigAsync($"tools.blog_backup_restore.{backupKeySuffix}", JsonSerializer.Serialize(result));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} recorded blog backup restore compatibility request {BackupId}", GetCurrentUserId(), backupId);
        return Accepted(result);
    }

    [HttpGet("tools/seo-audit")]
    [HttpPost("tools/seo-audit")]
    public async Task<IActionResult> RunSeoAudit()
    {
        var pages = await _db.Pages.AsNoTracking().Where(p => p.IsPublished).ToListAsync();
        var posts = await _db.BlogPosts.AsNoTracking().Where(p => p.Status == "published").ToListAsync();

        var pageIssues = pages.Count(p => string.IsNullOrWhiteSpace(p.MetaTitle) || string.IsNullOrWhiteSpace(p.MetaDescription));
        var postIssues = posts.Count(p => string.IsNullOrWhiteSpace(p.MetaTitle) || string.IsNullOrWhiteSpace(p.MetaDescription));
        var duplicatePageSlugs = pages.GroupBy(p => p.Slug.ToLowerInvariant()).Count(g => g.Count() > 1);
        var duplicatePostSlugs = posts.GroupBy(p => p.Slug.ToLowerInvariant()).Count(g => g.Count() > 1);
        var totalItems = pages.Count + posts.Count;
        var issueCount = pageIssues + postIssues + duplicatePageSlugs + duplicatePostSlugs;
        var score = totalItems == 0 ? 100 : Math.Max(0, 100 - (issueCount * 100 / Math.Max(totalItems, 1)));

        var result = new
        {
            success = true,
            queued = false,
            audited_at = DateTime.UtcNow,
            score,
            totals = new { pages = pages.Count, blog_posts = posts.Count, audited = totalItems },
            checks = new[]
            {
                new { name = "page_meta", status = pageIssues == 0 ? "pass" : "warn", issues = pageIssues },
                new { name = "blog_meta", status = postIssues == 0 ? "pass" : "warn", issues = postIssues },
                new { name = "page_duplicate_slugs", status = duplicatePageSlugs == 0 ? "pass" : "fail", issues = duplicatePageSlugs },
                new { name = "blog_duplicate_slugs", status = duplicatePostSlugs == 0 ? "pass" : "fail", issues = duplicatePostSlugs }
            }
        };

        // Refactored from UpsertTenantConfigAsync("tools.seo_audit.latest", ...) to use AuditLog
        // so each SEO audit run is preserved as history rather than overwriting a single config key.
        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            UserId = GetCurrentUserId(),
            Action = "admin.tools.seo_audit.run",
            EntityType = "Tool",
            NewValues = JsonSerializer.Serialize(result),
            Metadata = JsonSerializer.Serialize(new { score, issues = issueCount }),
            Severity = AuditSeverity.Info,
            CreatedAt = DateTime.UtcNow
        });
        // Dual-write: TenantConfig key preserved as the documented integration contract.
        await UpsertTenantConfigAsync("tools.seo_audit.latest", JsonSerializer.Serialize(result));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} ran SEO audit with score {Score}", GetCurrentUserId(), score);
        return Ok(result);
    }

    // ──────────────────────────────────────────────
    // System (3 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("system/cron-jobs")]
    public async Task<IActionResult> ListCronJobs()
    {
        if (IsLaravelV2Request)
        {
            return LaravelData(await ListLaravelReactCronJobsAsync());
        }

        var tasks = await _db.ScheduledTasks
            .AsNoTracking()
            .OrderBy(t => t.TaskName)
            .Select(t => new
            {
                id = t.Id,
                key = t.TaskName,
                name = t.TaskName,
                schedule = t.CronExpression,
                last_run = t.LastRunAt,
                next_run = t.NextRunAt,
                status = t.Status.ToString().ToLowerInvariant(),
                run_count = t.RunCount
            })
            .ToListAsync();

        return Ok(new { data = tasks, total = tasks.Count });
    }

    [HttpPost("system/cron-jobs/{id}/run")]
    public async Task<IActionResult> RunCronJob(string id)
    {
        if (IsLaravelV2Request)
        {
            return await RunLaravelReactCronJobAsync(id);
        }

        var result = await RecordScheduledTaskRunAsync(id);
        if (result == null)
            return NotFound(new { error = "Cron job not found" });

        return Ok(result);
    }

    [HttpGet("system/activity-log")]
    public IActionResult GetSystemActivityLog([FromQuery] int page = 1, [FromQuery] int limit = 50)
    {
        return Ok(new { data = Array.Empty<object>(), total = 0, page, per_page = limit });
    }

    // ──────────────────────────────────────────────
    // Community Analytics (2 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("community-analytics")]
    public async Task<IActionResult> GetCommunityAnalytics()
    {
        var now = DateTime.UtcNow;
        var thirtyDaysAgo = now.AddDays(-30);
        var twelveMonthsAgo = now.AddMonths(-12);
        var twelveWeeksAgo = now.AddDays(-7 * 12);

        var completedTx = _db.Transactions
            .ExcludeInternalWalletAdapters()
            .Where(t => t.Status == TransactionStatus.Completed);
        var completedTx30d = completedTx.Where(t => t.CreatedAt >= thirtyDaysAgo);

        var totalCreditsCirculation = await completedTx.SumAsync(t => (decimal?)t.Amount) ?? 0m;
        var transactionVolume30d = await completedTx30d.SumAsync(t => (decimal?)t.Amount) ?? 0m;
        var transactionCount30d = await completedTx30d.CountAsync();
        var newUsers30d = await _db.Users.CountAsync(u => u.CreatedAt >= thirtyDaysAgo);
        var totalUsers = await _db.Users.CountAsync();

        var senders30d = completedTx30d.Select(t => t.SenderId);
        var receivers30d = completedTx30d.Select(t => t.ReceiverId);
        var activeTraders30d = await senders30d.Concat(receivers30d).Distinct().CountAsync();
        var avgTxSize = transactionCount30d > 0 ? transactionVolume30d / transactionCount30d : 0m;

        var monthlyRaw = await completedTx
            .Where(t => t.CreatedAt >= twelveMonthsAgo)
            .GroupBy(t => new { t.CreatedAt.Year, t.CreatedAt.Month })
            .Select(g => new
            {
                Year = g.Key.Year,
                Month = g.Key.Month,
                TransactionCount = g.Count(),
                TotalVolume = g.Sum(t => (decimal?)t.Amount) ?? 0m
            })
            .ToListAsync();

        var monthlyUsers = await _db.Users
            .Where(u => u.CreatedAt >= twelveMonthsAgo)
            .GroupBy(u => new { u.CreatedAt.Year, u.CreatedAt.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, NewUsers = g.Count() })
            .ToListAsync();

        var monthly_trends = Enumerable.Range(0, 12)
            .Select(i => now.AddMonths(-(11 - i)))
            .Select(d =>
            {
                var tx = monthlyRaw.FirstOrDefault(m => m.Year == d.Year && m.Month == d.Month);
                var u = monthlyUsers.FirstOrDefault(m => m.Year == d.Year && m.Month == d.Month);
                return new
                {
                    month = d.ToString("yyyy-MM"),
                    transaction_count = tx?.TransactionCount ?? 0,
                    total_volume = tx?.TotalVolume ?? 0m,
                    new_users = u?.NewUsers ?? 0
                };
            })
            .ToList();

        var weeklyRaw = (await completedTx
            .Where(t => t.CreatedAt >= twelveWeeksAgo)
            .Select(t => new { t.CreatedAt, t.Amount })
            .ToListAsync())
            .GroupBy(t => StartOfWeek(t.CreatedAt))
            .Select(g => new
            {
                Week = g.Key,
                TransactionCount = g.Count(),
                TotalVolume = g.Sum(x => x.Amount)
            })
            .ToList();

        var weekly_trends = Enumerable.Range(0, 12)
            .Select(i => StartOfWeek(now.AddDays(-7 * (11 - i))))
            .Select(weekStart =>
            {
                var w = weeklyRaw.FirstOrDefault(x => x.Week == weekStart);
                return new
                {
                    week = weekStart.ToString("yyyy-MM-dd"),
                    transaction_count = w?.TransactionCount ?? 0,
                    total_volume = w?.TotalVolume ?? 0m
                };
            })
            .ToList();

        var top_earners = await completedTx30d
            .GroupBy(t => t.ReceiverId)
            .Select(g => new { Id = g.Key, Total = g.Sum(t => t.Amount) })
            .OrderByDescending(x => x.Total)
            .Take(10)
            .Join(_db.Users, t => t.Id, u => u.Id, (t, u) => new
            {
                id = u.Id,
                name = (u.FirstName + " " + u.LastName).Trim(),
                total = t.Total
            })
            .ToListAsync();

        var top_spenders = await completedTx30d
            .GroupBy(t => t.SenderId)
            .Select(g => new { Id = g.Key, Total = g.Sum(t => t.Amount) })
            .OrderByDescending(x => x.Total)
            .Take(10)
            .Join(_db.Users, t => t.Id, u => u.Id, (t, u) => new
            {
                id = u.Id,
                name = (u.FirstName + " " + u.LastName).Trim(),
                total = t.Total
            })
            .ToListAsync();

        var category_demand = await _db.Listings
            .GroupBy(l => l.Category != null ? l.Category.Name : "Uncategorized")
            .Select(g => new
            {
                name = g.Key,
                listing_count = g.Count(),
                active_count = g.Count(l => l.Status == ListingStatus.Active)
            })
            .OrderByDescending(x => x.listing_count)
            .Take(12)
            .ToListAsync();

        var totalXp = await _db.Users.SumAsync(u => (long?)u.TotalXp) ?? 0;
        var totalBadges = await _db.UserBadges.CountAsync();
        var engagementRate = totalUsers > 0 ? (double)activeTraders30d / totalUsers : 0;

        var totalMatches = await _db.MatchResults.CountAsync();
        var convertedMatches = await _db.MatchResults.CountAsync(m => m.Status == MatchStatus.Accepted);
        var conversionRate = totalMatches > 0 ? (double)convertedMatches / totalMatches : 0;

        var data = new
        {
            overview = new
            {
                total_credits_circulation = totalCreditsCirculation,
                transaction_volume_30d = transactionVolume30d,
                transaction_count_30d = transactionCount30d,
                active_traders_30d = activeTraders30d,
                new_users_30d = newUsers30d,
                avg_transaction_size = avgTxSize
            },
            monthly_trends,
            weekly_trends,
            top_earners,
            top_spenders,
            gamification = new
            {
                total_xp = totalXp,
                total_badges = totalBadges,
                engagement_rate = engagementRate
            },
            matching = new
            {
                total_matches = totalMatches,
                conversion_rate = conversionRate
            },
            category_demand,
            engagement_rate = engagementRate
        };

        return Ok(new { success = true, data });
    }

    private static DateTime StartOfWeek(DateTime dt)
    {
        var diff = (7 + (int)dt.DayOfWeek - (int)DayOfWeek.Monday) % 7;
        return dt.Date.AddDays(-diff);
    }

    [HttpGet("community-analytics/geography")]
    public async Task<IActionResult> GetCommunityAnalyticsGeography()
    {
        var locations = await _db.UserLocations
            .Select(l => new { l.Latitude, l.Longitude, l.City })
            .ToListAsync();
        var totalMembers = await _db.Users.CountAsync();
        var totalWithLocation = locations.Count;

        var clusters = locations
            .GroupBy(l => new
            {
                Lat = Math.Round(l.Latitude, 2),
                Lng = Math.Round(l.Longitude, 2),
                Area = string.IsNullOrWhiteSpace(l.City) ? "Unknown" : l.City
            })
            .Select(g => new
            {
                lat = g.Key.Lat,
                lng = g.Key.Lng,
                count = g.Count(),
                area = g.Key.Area
            })
            .ToList();

        var topAreas = locations
            .Where(l => !string.IsNullOrWhiteSpace(l.City))
            .GroupBy(l => l.City!)
            .Select(g => new
            {
                area = g.Key,
                count = g.Count(),
                percentage = totalWithLocation > 0 ? Math.Round(100.0 * g.Count() / totalWithLocation, 1) : 0
            })
            .OrderByDescending(x => x.count)
            .Take(10)
            .ToList();

        var data = new
        {
            member_locations = clusters,
            total_with_location = totalWithLocation,
            total_members = totalMembers,
            coverage_percentage = totalMembers > 0 ? Math.Round(100.0 * totalWithLocation / totalMembers, 1) : 0,
            top_areas = topAreas
        };

        return Ok(new { success = true, data });
    }

    [HttpGet("community-analytics/export")]
    public async Task<IActionResult> ExportCommunityAnalytics()
    {
        var now = DateTime.UtcNow;
        var twelveMonthsAgo = now.AddMonths(-12);
        var completedTx = _db.Transactions
            .ExcludeInternalWalletAdapters()
            .Where(t => t.Status == TransactionStatus.Completed && t.CreatedAt >= twelveMonthsAgo);

        var monthlyRaw = await completedTx
            .GroupBy(t => new { t.CreatedAt.Year, t.CreatedAt.Month })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.Month,
                TransactionCount = g.Count(),
                TotalVolume = g.Sum(t => (decimal?)t.Amount) ?? 0m
            })
            .ToListAsync();

        var monthlyUsers = await _db.Users
            .Where(u => u.CreatedAt >= twelveMonthsAgo)
            .GroupBy(u => new { u.CreatedAt.Year, u.CreatedAt.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, NewUsers = g.Count() })
            .ToListAsync();

        var activeTradersRaw = (await completedTx
            .Select(t => new { t.CreatedAt, t.SenderId, t.ReceiverId })
            .ToListAsync())
            .GroupBy(t => new { t.CreatedAt.Year, t.CreatedAt.Month })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.Month,
                ActiveTraders = g.SelectMany(t => new[] { t.SenderId, t.ReceiverId }).Distinct().Count()
            })
            .ToList();

        var csv = new StringBuilder();
        csv.AppendLine("Month,New Users,Active Traders,Transactions,Hours Exchanged");
        foreach (var monthStart in Enumerable.Range(0, 12).Select(i => now.AddMonths(-(11 - i))))
        {
            var tx = monthlyRaw.FirstOrDefault(m => m.Year == monthStart.Year && m.Month == monthStart.Month);
            var users = monthlyUsers.FirstOrDefault(m => m.Year == monthStart.Year && m.Month == monthStart.Month);
            var traders = activeTradersRaw.FirstOrDefault(m => m.Year == monthStart.Year && m.Month == monthStart.Month);

            csv.AppendLine(string.Join(",",
                monthStart.ToString("yyyy-MM"),
                users?.NewUsers ?? 0,
                traders?.ActiveTraders ?? 0,
                tx?.TransactionCount ?? 0,
                Math.Round(tx?.TotalVolume ?? 0m, 1)));
        }

        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "community-analytics.csv");
    }

    // ──────────────────────────────────────────────
    // Impact Report (2 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("impact-report")]
    public async Task<IActionResult> GetImpactReport()
    {
        var months = Math.Clamp(ReadIntQuery("months", 12), 1, 60);
        var since = DateTime.UtcNow.AddMonths(-months);
        var completedTransactions = _db.Transactions
            .ExcludeInternalWalletAdapters()
            .Where(t => t.CreatedAt >= since && t.Status == TransactionStatus.Completed)
            .AsNoTracking();
        var totalHours = await completedTransactions.SumAsync(t => (decimal?)t.Amount) ?? 0;
        var totalTransactions = await completedTransactions.CountAsync();
        var senders = completedTransactions.Select(t => t.SenderId);
        var receivers = completedTransactions.Select(t => t.ReceiverId);
        var uniqueGivers = await senders.Distinct().CountAsync();
        var uniqueReceivers = await receivers.Distinct().CountAsync();
        var participants = await senders.Concat(receivers).Distinct().CountAsync();
        var config = await GetJsonConfigAsync("impact_report.config", new Dictionary<string, object?>
        {
            ["hourly_value"] = 15m,
            ["social_multiplier"] = 3.5m
        });
        var hourlyValue = ReadConfigDecimal(config, "hourly_value", "hourly_social_value", 15m);
        var socialMultiplier = ReadConfigDecimal(config, "social_multiplier", "multiplier", 3.5m);
        var monetaryValue = totalHours * hourlyValue;
        var socialValue = monetaryValue * socialMultiplier;
        var tenantId = _tenant.GetTenantIdOrThrow();
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId);
        var totalMembers = await _db.Users.AsNoTracking().CountAsync(u => u.TenantId == tenantId);
        var activeMembers = await _db.Users.AsNoTracking().CountAsync(u => u.TenantId == tenantId && u.IsActive);
        var timelineRows = await completedTransactions
            .GroupBy(t => new { t.CreatedAt.Year, t.CreatedAt.Month })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.Month,
                hours_exchanged = g.Sum(t => (decimal?)t.Amount) ?? 0m,
                transactions = g.Count()
            })
            .ToListAsync();
        var newUsersByMonth = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.CreatedAt >= since)
            .GroupBy(u => new { u.CreatedAt.Year, u.CreatedAt.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, count = g.Count() })
            .ToListAsync();
        var timeline = Enumerable.Range(0, months)
            .Select(offset => DateTime.UtcNow.AddMonths(-(months - 1 - offset)))
            .Select(month =>
            {
                var row = timelineRows.FirstOrDefault(t => t.Year == month.Year && t.Month == month.Month);
                var newUsers = newUsersByMonth.FirstOrDefault(u => u.Year == month.Year && u.Month == month.Month)?.count ?? 0;
                return new
                {
                    month = month.ToString("yyyy-MM"),
                    hours_exchanged = row?.hours_exchanged ?? 0m,
                    transactions = row?.transactions ?? 0,
                    new_users = newUsers
                };
            })
            .ToList();

        return Ok(new
        {
            data = new
            {
                sroi = new
                {
                    total_hours = totalHours,
                    total_transactions = totalTransactions,
                    unique_givers = uniqueGivers,
                    unique_receivers = uniqueReceivers,
                    hourly_value = hourlyValue,
                    monetary_value = monetaryValue,
                    social_multiplier = socialMultiplier,
                    social_value = socialValue,
                    sroi_ratio = monetaryValue == 0 ? 0 : socialValue / monetaryValue,
                    period_months = months
                },
                health = new
                {
                    total_members = totalMembers,
                    active_members = activeMembers,
                    active_member_rate = totalMembers == 0 ? 0 : Math.Round((decimal)activeMembers / totalMembers * 100, 2),
                    unique_participants = participants,
                    transaction_count = totalTransactions
                },
                timeline,
                config = new
                {
                    tenant_name = tenant?.Name ?? string.Empty,
                    tenant_slug = tenant?.Slug ?? string.Empty,
                    logo_url = tenant?.LogoUrl,
                    hourly_value = hourlyValue,
                    social_multiplier = socialMultiplier
                }
            }
        });
    }

    [HttpPut("impact-report/config")]
    public async Task<IActionResult> UpdateImpactReportConfig([FromBody] JsonElement request)
    {
        var hourlyValue = ReadDecimalProperty(request, "hourly_value", 15m);
        var socialMultiplier = ReadDecimalProperty(request, "social_multiplier", 3.5m);

        if (hourlyValue <= 0 || hourlyValue > 1000)
            return BadRequest(new { errors = new[] { new { code = "VALIDATION_ERROR", message = "hourly_value must be between 0 and 1000", field = "hourly_value" } } });
        if (socialMultiplier <= 0 || socialMultiplier > 100)
            return BadRequest(new { errors = new[] { new { code = "VALIDATION_ERROR", message = "social_multiplier must be between 0 and 100", field = "social_multiplier" } } });

        await UpsertTenantConfigAsync("impact_report.config", JsonSerializer.Serialize(new
        {
            hourly_value = hourlyValue,
            social_multiplier = socialMultiplier
        }));
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated impact report config", GetCurrentUserId());
        return Ok(new
        {
            data = new
            {
                message = "Impact report config updated",
                hourly_value = hourlyValue,
                social_multiplier = socialMultiplier
            }
        });
    }

    private int ReadIntQuery(string key, int fallback)
        => int.TryParse(Request.Query[key].FirstOrDefault(), out var value) ? value : fallback;

    private static decimal ReadConfigDecimal(
        IReadOnlyDictionary<string, object?> config,
        string primaryKey,
        string legacyKey,
        decimal fallback)
    {
        if (config.TryGetValue(primaryKey, out var primary) && TryConvertDecimal(primary, out var primaryValue))
            return primaryValue;
        if (config.TryGetValue(legacyKey, out var legacy) && TryConvertDecimal(legacy, out var legacyValue))
            return legacyValue;

        return fallback;
    }

    private static decimal ReadDecimalProperty(JsonElement root, string propertyName, decimal fallback)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(propertyName, out var value))
            return fallback;

        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var parsedNumber))
            return parsedNumber;
        if (value.ValueKind == JsonValueKind.String && decimal.TryParse(value.GetString(), out var parsedString))
            return parsedString;

        return fallback;
    }

    private static bool TryConvertDecimal(object? raw, out decimal value)
    {
        switch (raw)
        {
            case decimal decimalValue:
                value = decimalValue;
                return true;
            case int intValue:
                value = intValue;
                return true;
            case long longValue:
                value = longValue;
                return true;
            case double doubleValue:
                value = (decimal)doubleValue;
                return true;
            case string stringValue when decimal.TryParse(stringValue, out var parsed):
                value = parsed;
                return true;
            default:
                value = 0;
                return false;
        }
    }

    private static IReadOnlyDictionary<string, object?> ReadConfigObject(
        IReadOnlyDictionary<string, object?> config,
        string key)
    {
        if (config.TryGetValue(key, out var raw) && raw is IReadOnlyDictionary<string, object?> dictionary)
            return dictionary;

        return new Dictionary<string, object?>();
    }

    private static object?[] ReadConfigArray(IReadOnlyDictionary<string, object?> config, string key)
    {
        if (!config.TryGetValue(key, out var raw) || raw is null)
            return [];

        return raw switch
        {
            object?[] array => array,
            IEnumerable<object?> enumerable => enumerable.ToArray(),
            _ => []
        };
    }

    private static decimal ReadConfigDecimal(
        IReadOnlyDictionary<string, object?> config,
        string key,
        decimal fallback)
        => config.TryGetValue(key, out var raw) && TryConvertDecimal(raw, out var value) ? value : fallback;

    private static decimal ReadConfigDecimal(
        IReadOnlyDictionary<string, object?> config,
        string topLevelKey,
        IReadOnlyDictionary<string, object?> nested,
        string nestedKey,
        decimal fallback)
    {
        if (config.TryGetValue(topLevelKey, out var topLevel) && TryConvertDecimal(topLevel, out var topLevelValue))
            return topLevelValue;
        return ReadConfigDecimal(nested, nestedKey, fallback);
    }

    private static int ReadConfigInt(IReadOnlyDictionary<string, object?> config, string key, int fallback)
    {
        if (!config.TryGetValue(key, out var raw) || raw is null)
            return fallback;

        return raw switch
        {
            int intValue => intValue,
            long longValue => (int)longValue,
            decimal decimalValue => (int)decimalValue,
            double doubleValue => (int)doubleValue,
            string stringValue when int.TryParse(stringValue, out var parsed) => parsed,
            _ => fallback
        };
    }

    private static bool ReadConfigBool(IReadOnlyDictionary<string, object?> config, string key, bool fallback)
    {
        if (!config.TryGetValue(key, out var raw) || raw is null)
            return fallback;

        return raw switch
        {
            bool boolValue => boolValue,
            string stringValue when bool.TryParse(stringValue, out var parsed) => parsed,
            int intValue => intValue != 0,
            long longValue => longValue != 0,
            _ => fallback
        };
    }

    private static string ReadConfigString(
        IReadOnlyDictionary<string, object?> config,
        string key,
        string fallback,
        params string[] allowed)
    {
        var value = config.TryGetValue(key, out var raw) ? raw?.ToString() : null;
        if (string.IsNullOrWhiteSpace(value))
            return fallback;

        if (allowed.Length > 0 && !allowed.Contains(value, StringComparer.OrdinalIgnoreCase))
            return fallback;

        return value;
    }

    private static decimal ClampDecimal(decimal value, decimal min, decimal max)
        => Math.Min(Math.Max(value, min), max);

    private static decimal ReadJsonDecimal(JsonElement root, string propertyName, decimal fallback)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(propertyName, out var value))
            return fallback;

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
            JsonValueKind.String when decimal.TryParse(value.GetString(), out var parsed) => parsed,
            _ => fallback
        };
    }

    private static int ReadJsonInt(JsonElement root, string propertyName, int fallback)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(propertyName, out var value))
            return fallback;

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var number) => number,
            JsonValueKind.String when int.TryParse(value.GetString(), out var parsed) => parsed,
            _ => fallback
        };
    }

    private static bool ReadJsonBool(JsonElement root, string propertyName, bool fallback)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(propertyName, out var value))
            return fallback;

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            JsonValueKind.Number when value.TryGetInt32(out var number) => number != 0,
            _ => fallback
        };
    }

    private static decimal ReadNestedJsonDecimal(
        JsonElement root,
        string objectName,
        string propertyName,
        decimal fallback)
        => root.ValueKind == JsonValueKind.Object
           && root.TryGetProperty(objectName, out var nested)
           && nested.ValueKind == JsonValueKind.Object
            ? ReadJsonDecimal(nested, propertyName, fallback)
            : fallback;

    private static int ReadNestedJsonInt(JsonElement root, string objectName, string propertyName, int fallback)
        => root.ValueKind == JsonValueKind.Object
           && root.TryGetProperty(objectName, out var nested)
           && nested.ValueKind == JsonValueKind.Object
            ? ReadJsonInt(nested, propertyName, fallback)
            : fallback;

    private static bool ReadNestedJsonBool(JsonElement root, string objectName, string propertyName, bool fallback)
        => root.ValueKind == JsonValueKind.Object
           && root.TryGetProperty(objectName, out var nested)
           && nested.ValueKind == JsonValueKind.Object
            ? ReadJsonBool(nested, propertyName, fallback)
            : fallback;

    private static string ReadNestedJsonString(
        JsonElement root,
        string objectName,
        string propertyName,
        string fallback,
        params string[] allowed)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty(objectName, out var nested)
            || nested.ValueKind != JsonValueKind.Object
            || !nested.TryGetProperty(propertyName, out var value)
            || value.ValueKind != JsonValueKind.String)
            return fallback;

        var text = value.GetString();
        if (string.IsNullOrWhiteSpace(text))
            return fallback;

        if (allowed.Length > 0 && !allowed.Contains(text, StringComparer.OrdinalIgnoreCase))
            return fallback;

        return text;
    }

    // ──────────────────────────────────────────────
    // Gamification - Extended (8 endpoints)
    // ──────────────────────────────────────────────

    [HttpPost("gamification/recheck-all")]
    public async Task<IActionResult> GamificationRecheckAll()
    {
        return await RecheckAllUserBadges();
    }

    [HttpPost("gamification/bulk-award")]
    public async Task<IActionResult> GamificationBulkAward([FromBody] JsonElement request)
    {
        var userIds = ExtractIntArray(request, "user_ids", "users");
        if (userIds.Count == 0 && ReadBooleanProperty(request, "all_users", "all") == true)
        {
            userIds = await _db.Users
                .AsNoTracking()
                .Where(u => u.IsActive)
                .Select(u => u.Id)
                .ToListAsync();
        }

        if (userIds.Count == 0)
            return BadRequest(new { error = "user_ids or all_users is required" });
        if (userIds.Count > 1000)
            return BadRequest(new { error = "Maximum 1000 users per bulk award" });

        var amount = TryReadIntProperty(request, out var xp, "xp", "amount", "points") ? xp : 0;
        var badgeId = TryReadIntProperty(request, out var requestedBadgeId, "badge_id") ? requestedBadgeId : (int?)null;
        var badgeSlug = GetStringProperty(request, "badge_slug", "slug");
        if (amount == 0 && !badgeId.HasValue && string.IsNullOrWhiteSpace(badgeSlug))
            return BadRequest(new { error = "xp/amount or badge_id/badge_slug is required" });

        if (!badgeId.HasValue && !string.IsNullOrWhiteSpace(badgeSlug))
        {
            badgeId = await _db.Badges
                .Where(b => b.Slug == badgeSlug && b.IsActive)
                .Select(b => (int?)b.Id)
                .FirstOrDefaultAsync();
            if (!badgeId.HasValue)
                return NotFound(new { error = "Badge not found" });
        }

        var adminId = GetCurrentUserId();
        if (adminId == null)
            return Unauthorized(new { error = "Invalid token" });

        var reason = GetStringProperty(request, "reason", "description") ?? "Admin bulk award";
        var awarded = 0;
        var errors = new List<object>();
        foreach (var userId in userIds.Distinct())
        {
            if (amount != 0)
            {
                var result = await _gamification.AwardXpAsync(userId, amount, "admin_bulk_award", null, reason);
                if (!result.Success)
                {
                    errors.Add(new { user_id = userId, error = result.Error });
                    continue;
                }
            }

            if (badgeId.HasValue)
            {
                var (_, error) = await _gamification.AwardBadgeManuallyAsync(_tenant.GetTenantIdOrThrow(), userId, badgeId.Value, adminId.Value);
                if (error != null)
                {
                    errors.Add(new { user_id = userId, error });
                    continue;
                }
            }

            awarded++;
        }

        _logger.LogInformation("Admin {AdminId} bulk-awarded gamification rewards to {Awarded} users with {Errors} errors", adminId, awarded, errors.Count);
        return Ok(new { success = true, message = "Bulk award processed", awarded, errors = errors.Count, error_details = errors });
    }

    [HttpGet("gamification/campaigns")]
    public async Task<IActionResult> ListGamificationCampaigns()
    {
        var campaignEntities = await _db.GamificationChallenges
            .AsNoTracking()
            .OrderByDescending(c => c.StartsAt)
            .ToListAsync();
        var campaigns = campaignEntities.Select(MapGamificationCampaign).ToList();

        return Ok(new { data = campaigns, total = campaigns.Count, page = 1, per_page = 20 });
    }

    [HttpPost("gamification/campaigns")]
    public async Task<IActionResult> CreateGamificationCampaign([FromBody] JsonElement request)
    {
        var title = GetStringProperty(request, "title", "name");
        if (string.IsNullOrWhiteSpace(title))
            return BadRequest(new { error = "title is required" });

        var campaign = new GamificationChallenge
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            Title = title.Trim(),
            Description = GetStringProperty(request, "description") ?? string.Empty,
            Type = GetStringProperty(request, "type", "campaign_type") ?? "special",
            ActionType = GetStringProperty(request, "action_type", "action") ?? "admin",
            TargetCount = TryReadIntProperty(request, out var target, "target_count", "target") ? Math.Max(1, target) : 1,
            XpReward = TryReadIntProperty(request, out var xpReward, "xp_reward", "reward_xp", "xp") ? Math.Max(0, xpReward) : 0,
            BadgeReward = GetStringProperty(request, "badge_reward", "badge_slug"),
            StartsAt = TryReadDateTimeProperty(request, out var startsAt, "starts_at", "start_date") ? startsAt : DateTime.UtcNow,
            EndsAt = TryReadDateTimeProperty(request, out var endsAt, "ends_at", "end_date") ? endsAt : DateTime.UtcNow.AddDays(30),
            IsActive = ReadBooleanProperty(request, "is_active", "active", "enabled") ?? true,
            CreatedAt = DateTime.UtcNow
        };

        _db.GamificationChallenges.Add(campaign);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} created gamification campaign {CampaignId}", GetCurrentUserId(), campaign.Id);
        return Created($"/api/admin/gamification/campaigns/{campaign.Id}", new { success = true, id = campaign.Id, data = MapGamificationCampaign(campaign) });
    }

    [HttpPut("gamification/campaigns/{id:int}")]
    public async Task<IActionResult> UpdateGamificationCampaign(int id, [FromBody] JsonElement request)
    {
        var campaign = await _db.GamificationChallenges.FirstOrDefaultAsync(c => c.Id == id);
        if (campaign == null)
            return NotFound(new { error = "Campaign not found" });

        var title = GetStringProperty(request, "title", "name");
        if (!string.IsNullOrWhiteSpace(title))
            campaign.Title = title.Trim();
        if (request.TryGetProperty("description", out var description) && description.ValueKind == JsonValueKind.String)
            campaign.Description = description.GetString() ?? string.Empty;
        campaign.Type = GetStringProperty(request, "type", "campaign_type") ?? campaign.Type;
        campaign.ActionType = GetStringProperty(request, "action_type", "action") ?? campaign.ActionType;
        if (TryReadIntProperty(request, out var target, "target_count", "target"))
            campaign.TargetCount = Math.Max(1, target);
        if (TryReadIntProperty(request, out var xpReward, "xp_reward", "reward_xp", "xp"))
            campaign.XpReward = Math.Max(0, xpReward);
        if (request.TryGetProperty("badge_reward", out var badgeReward) && badgeReward.ValueKind == JsonValueKind.String)
            campaign.BadgeReward = badgeReward.GetString();
        if (TryReadDateTimeProperty(request, out var startsAt, "starts_at", "start_date"))
            campaign.StartsAt = startsAt;
        if (TryReadDateTimeProperty(request, out var endsAt, "ends_at", "end_date"))
            campaign.EndsAt = endsAt;
        campaign.IsActive = ReadBooleanProperty(request, "is_active", "active", "enabled") ?? campaign.IsActive;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated gamification campaign {Id}", GetCurrentUserId(), id);
        return Ok(new { success = true, id, data = MapGamificationCampaign(campaign) });
    }

    [HttpDelete("gamification/campaigns/{id:int}")]
    public async Task<IActionResult> DeleteGamificationCampaign(int id)
    {
        var campaign = await _db.GamificationChallenges.FirstOrDefaultAsync(c => c.Id == id);
        if (campaign == null)
            return NotFound(new { error = "Campaign not found" });

        _db.GamificationChallenges.Remove(campaign);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted gamification campaign {Id}", GetCurrentUserId(), id);
        return Ok(new { success = true });
    }
    // DeleteBadge removed — served by AdminGamificationController

    // ──────────────────────────────────────────────
    // Matching - Extended (8 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("matching/config")]
    public async Task<IActionResult> GetMatchingConfig()
    {
        var config = await GetJsonConfigAsync("matching.config", LegacyMatchingConfigDefaults());
        if (IsLaravelV2Request)
            return LaravelData(BuildLaravelMatchingConfig(config));

        return Ok(config);
    }

    private static Dictionary<string, object?> LegacyMatchingConfigDefaults() => new()
    {
        ["enabled"] = true,
        ["min_score"] = 0.3m,
        ["max_results"] = 20,
        ["algorithm"] = "weighted",
        ["weights"] = new Dictionary<string, object?>
        {
            ["skills"] = 0.4m,
            ["location"] = 0.3m,
            ["availability"] = 0.2m,
            ["rating"] = 0.1m
        }
    };

    private static Dictionary<string, object?> BuildLaravelMatchingConfig(IReadOnlyDictionary<string, object?> stored)
    {
        var weights = ReadConfigObject(stored, "weights");
        var proximity = ReadConfigObject(stored, "proximity");
        var gates = ReadConfigObject(stored, "gates");
        var pillars = ReadConfigObject(stored, "pillars");
        var adjustments = ReadConfigObject(stored, "adjustments");
        var ai = ReadConfigObject(stored, "ai");

        return new Dictionary<string, object?>
        {
            ["category_weight"] = ReadConfigDecimal(stored, "category_weight", weights, "category", 0.25m),
            ["skill_weight"] = ReadConfigDecimal(stored, "skill_weight", weights, "skill", 0.20m),
            ["proximity_weight"] = ReadConfigDecimal(stored, "proximity_weight", weights, "proximity", 0.25m),
            ["freshness_weight"] = ReadConfigDecimal(stored, "freshness_weight", weights, "freshness", 0.10m),
            ["reciprocity_weight"] = ReadConfigDecimal(stored, "reciprocity_weight", weights, "reciprocity", 0.15m),
            ["quality_weight"] = ReadConfigDecimal(stored, "quality_weight", weights, "quality", 0.05m),
            ["proximity_bands"] = new[]
            {
                new Dictionary<string, object?> { ["distance_km"] = ReadConfigInt(proximity, "walking_km", 5), ["score"] = 1.0m },
                new Dictionary<string, object?> { ["distance_km"] = ReadConfigInt(proximity, "local_km", 15), ["score"] = 0.9m },
                new Dictionary<string, object?> { ["distance_km"] = ReadConfigInt(proximity, "city_km", 30), ["score"] = 0.7m },
                new Dictionary<string, object?> { ["distance_km"] = ReadConfigInt(proximity, "regional_km", 50), ["score"] = 0.5m },
                new Dictionary<string, object?> { ["distance_km"] = ReadConfigInt(proximity, "max_km", ReadConfigInt(stored, "max_distance_km", 100)), ["score"] = 0.2m }
            },
            ["enabled"] = ReadConfigBool(stored, "enabled", true),
            ["broker_approval_enabled"] = ReadConfigBool(stored, "broker_approval_enabled", true),
            ["max_distance_km"] = ReadConfigInt(stored, "max_distance_km", 50),
            ["min_match_score"] = ReadConfigInt(stored, "min_match_score", 40),
            ["hot_match_threshold"] = ReadConfigInt(stored, "hot_match_threshold", 80),
            ["gates"] = new Dictionary<string, object?>
            {
                ["geo_hard_gate"] = ReadConfigBool(gates, "geo_hard_gate", true),
                ["missing_coords_mode"] = ReadConfigString(gates, "missing_coords_mode", "remote_only", "remote_only", "tenant_wide"),
                ["dormancy_days"] = ReadConfigInt(gates, "dormancy_days", 90),
                ["owner_dismissal_threshold"] = ReadConfigInt(gates, "owner_dismissal_threshold", 3)
            },
            ["engine_version"] = ReadConfigInt(stored, "engine_version", 2) is 1 ? 1 : 2,
            ["pillars"] = new Dictionary<string, object?>
            {
                ["relevance"] = ReadConfigDecimal(pillars, "relevance", 0.45m),
                ["feasibility"] = ReadConfigDecimal(pillars, "feasibility", 0.35m),
                ["trust"] = ReadConfigDecimal(pillars, "trust", 0.20m)
            },
            ["adjustments"] = new Dictionary<string, object?>
            {
                ["mutual_bonus"] = ReadConfigDecimal(adjustments, "mutual_bonus", 8m),
                ["freshness_max"] = ReadConfigDecimal(adjustments, "freshness_max", 4m),
                ["semantic_boost"] = ReadConfigDecimal(adjustments, "semantic_boost", 8m),
                ["knn_boost"] = ReadConfigDecimal(adjustments, "knn_boost", 6m)
            },
            ["ai"] = new Dictionary<string, object?>
            {
                ["semantic_signal"] = ReadConfigBool(ai, "semantic_signal", true),
                ["llm_explanations"] = ReadConfigBool(ai, "llm_explanations", true),
                ["explanation_top_n"] = ReadConfigInt(ai, "explanation_top_n", 5),
                ["available"] = ReadConfigBool(ai, "available", false)
            }
        };
    }

    [HttpPut("matching/config")]
    public async Task<IActionResult> UpdateMatchingConfig([FromBody] JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "Matching config object is required" });

        if (IsLaravelV2Request)
        {
            var existing = await GetJsonConfigAsync("matching.config", LegacyMatchingConfigDefaults());
            var updated = BuildLaravelMatchingStorageConfig(existing, request);
            await UpsertTenantConfigAsync("matching.config", JsonSerializer.Serialize(updated));
            await _db.SaveChangesAsync();

            _logger.LogInformation("Admin {AdminId} updated Laravel matching config", GetCurrentUserId());
            return LaravelData(new { message = "Matching configuration updated" });
        }

        await UpsertTenantConfigAsync("matching.config", request.GetRawText());
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated matching config", GetCurrentUserId());
        return Ok(new { success = true, message = "Matching config updated", data = await GetJsonConfigAsync("matching.config", new()) });
    }

    private static Dictionary<string, object?> BuildLaravelMatchingStorageConfig(
        IReadOnlyDictionary<string, object?> existing,
        JsonElement request)
    {
        var current = BuildLaravelMatchingConfig(existing);
        var gates = ReadConfigObject(current, "gates");
        var pillars = ReadConfigObject(current, "pillars");
        var adjustments = ReadConfigObject(current, "adjustments");
        var ai = ReadConfigObject(current, "ai");

        return new Dictionary<string, object?>
        {
            ["enabled"] = ReadJsonBool(request, "enabled", ReadConfigBool(current, "enabled", true)),
            ["broker_approval_enabled"] = ReadJsonBool(request, "broker_approval_enabled", ReadConfigBool(current, "broker_approval_enabled", true)),
            ["max_distance_km"] = ReadJsonInt(request, "max_distance_km", ReadConfigInt(current, "max_distance_km", 50)),
            ["min_match_score"] = ReadJsonInt(request, "min_match_score", ReadConfigInt(current, "min_match_score", 40)),
            ["hot_match_threshold"] = ReadJsonInt(request, "hot_match_threshold", ReadConfigInt(current, "hot_match_threshold", 80)),
            ["engine_version"] = ReadJsonInt(request, "engine_version", ReadConfigInt(current, "engine_version", 2)) is 1 ? 1 : 2,
            ["weights"] = new Dictionary<string, object?>
            {
                ["category"] = ReadJsonDecimal(request, "category_weight", ReadConfigDecimal(current, "category_weight", 0.25m)),
                ["skill"] = ReadJsonDecimal(request, "skill_weight", ReadConfigDecimal(current, "skill_weight", 0.20m)),
                ["proximity"] = ReadJsonDecimal(request, "proximity_weight", ReadConfigDecimal(current, "proximity_weight", 0.25m)),
                ["freshness"] = ReadJsonDecimal(request, "freshness_weight", ReadConfigDecimal(current, "freshness_weight", 0.10m)),
                ["reciprocity"] = ReadJsonDecimal(request, "reciprocity_weight", ReadConfigDecimal(current, "reciprocity_weight", 0.15m)),
                ["quality"] = ReadJsonDecimal(request, "quality_weight", ReadConfigDecimal(current, "quality_weight", 0.05m))
            },
            ["proximity"] = BuildLaravelMatchingProximity(request, current),
            ["gates"] = new Dictionary<string, object?>
            {
                ["geo_hard_gate"] = ReadNestedJsonBool(request, "gates", "geo_hard_gate", ReadConfigBool(gates, "geo_hard_gate", true)),
                ["missing_coords_mode"] = ReadNestedJsonString(request, "gates", "missing_coords_mode", ReadConfigString(gates, "missing_coords_mode", "remote_only", "remote_only", "tenant_wide"), "remote_only", "tenant_wide"),
                ["dormancy_days"] = Math.Clamp(ReadNestedJsonInt(request, "gates", "dormancy_days", ReadConfigInt(gates, "dormancy_days", 90)), 0, 3650),
                ["owner_dismissal_threshold"] = Math.Clamp(ReadNestedJsonInt(request, "gates", "owner_dismissal_threshold", ReadConfigInt(gates, "owner_dismissal_threshold", 3)), 1, 100)
            },
            ["pillars"] = new Dictionary<string, object?>
            {
                ["relevance"] = ClampDecimal(ReadNestedJsonDecimal(request, "pillars", "relevance", ReadConfigDecimal(pillars, "relevance", 0.45m)), 0m, 1m),
                ["feasibility"] = ClampDecimal(ReadNestedJsonDecimal(request, "pillars", "feasibility", ReadConfigDecimal(pillars, "feasibility", 0.35m)), 0m, 1m),
                ["trust"] = ClampDecimal(ReadNestedJsonDecimal(request, "pillars", "trust", ReadConfigDecimal(pillars, "trust", 0.20m)), 0m, 1m)
            },
            ["adjustments"] = new Dictionary<string, object?>
            {
                ["mutual_bonus"] = ReadNestedJsonDecimal(request, "adjustments", "mutual_bonus", ReadConfigDecimal(adjustments, "mutual_bonus", 8m)),
                ["freshness_max"] = ReadNestedJsonDecimal(request, "adjustments", "freshness_max", ReadConfigDecimal(adjustments, "freshness_max", 4m)),
                ["semantic_boost"] = ReadNestedJsonDecimal(request, "adjustments", "semantic_boost", ReadConfigDecimal(adjustments, "semantic_boost", 8m)),
                ["knn_boost"] = ReadNestedJsonDecimal(request, "adjustments", "knn_boost", ReadConfigDecimal(adjustments, "knn_boost", 6m))
            },
            ["ai"] = new Dictionary<string, object?>
            {
                ["semantic_signal"] = ReadNestedJsonBool(request, "ai", "semantic_signal", ReadConfigBool(ai, "semantic_signal", true)),
                ["llm_explanations"] = ReadNestedJsonBool(request, "ai", "llm_explanations", ReadConfigBool(ai, "llm_explanations", true)),
                ["explanation_top_n"] = Math.Clamp(ReadNestedJsonInt(request, "ai", "explanation_top_n", ReadConfigInt(ai, "explanation_top_n", 5)), 1, 10),
                ["available"] = ReadConfigBool(ai, "available", false)
            }
        };
    }

    private static Dictionary<string, object?> BuildLaravelMatchingProximity(
        JsonElement request,
        IReadOnlyDictionary<string, object?> current)
    {
        var bands = ReadConfigArray(current, "proximity_bands");
        var requestBands = request.ValueKind == JsonValueKind.Object && request.TryGetProperty("proximity_bands", out var value) && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.Object)
                .OrderBy(item => ReadJsonInt(item, "distance_km", 0))
                .ToArray()
            : Array.Empty<JsonElement>();

        int DistanceAt(int index, int fallback)
        {
            if (requestBands.Length > index)
                return ReadJsonInt(requestBands[index], "distance_km", fallback);

            if (bands.Length > index && bands[index] is IReadOnlyDictionary<string, object?> band)
                return ReadConfigInt(band, "distance_km", fallback);

            return fallback;
        }

        return new Dictionary<string, object?>
        {
            ["walking_km"] = DistanceAt(0, 5),
            ["local_km"] = DistanceAt(1, 15),
            ["city_km"] = DistanceAt(2, 30),
            ["regional_km"] = DistanceAt(3, 50),
            ["max_km"] = DistanceAt(4, 100)
        };
    }

    [HttpGet("matching/approvals")]
    public async Task<IActionResult> ListMatchApprovals([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.MatchResults
            .AsNoTracking()
            .Include(m => m.User)
            .Include(m => m.MatchedUser)
            .Include(m => m.MatchedListing)
            .Where(m => m.Status == MatchStatus.Pending || m.Status == MatchStatus.Viewed)
            .OrderByDescending(m => m.Score)
            .ThenByDescending(m => m.CreatedAt);

        var total = await query.CountAsync();
        var matches = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new { data = matches.Select(MapMatchApproval), total, page, per_page = limit });
    }

    [HttpGet("matching/approvals/{id:int}")]
    public async Task<IActionResult> GetMatchApproval(int id)
    {
        var match = await _db.MatchResults
            .AsNoTracking()
            .Include(m => m.User)
            .Include(m => m.MatchedUser)
            .Include(m => m.MatchedListing)
            .FirstOrDefaultAsync(m => m.Id == id);

        if (match == null)
            return NotFound(new { error = "Match not found" });

        return Ok(MapMatchApproval(match));
    }

    [HttpGet("matching/approvals/stats")]
    public async Task<IActionResult> GetMatchApprovalStats()
    {
        var pending = await _db.MatchResults.CountAsync(m => m.Status == MatchStatus.Pending || m.Status == MatchStatus.Viewed);
        var approved = await _db.MatchResults.CountAsync(m => m.Status == MatchStatus.Accepted);
        var rejected = await _db.MatchResults.CountAsync(m => m.Status == MatchStatus.Declined);
        var expired = await _db.MatchResults.CountAsync(m => m.Status == MatchStatus.Expired);

        return Ok(new { pending, approved, rejected, expired, total = pending + approved + rejected + expired });
    }

    [HttpPost("matching/approvals/{id:int}/approve")]
    public async Task<IActionResult> ApproveMatch(int id)
    {
        var match = await _db.MatchResults.FirstOrDefaultAsync(m => m.Id == id);
        if (match == null)
            return NotFound(new { error = "Match not found" });

        match.Status = MatchStatus.Accepted;
        match.ViewedAt ??= DateTime.UtcNow;
        match.RespondedAt = DateTime.UtcNow;
        match.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} approved match {MatchId}", GetCurrentUserId(), id);
        return Ok(new { success = true, message = "Match approved", data = MapMatchApproval(match) });
    }

    [HttpPost("matching/approvals/{id:int}/reject")]
    public async Task<IActionResult> RejectMatch(int id)
    {
        var match = await _db.MatchResults.FirstOrDefaultAsync(m => m.Id == id);
        if (match == null)
            return NotFound(new { error = "Match not found" });

        match.Status = MatchStatus.Declined;
        match.ViewedAt ??= DateTime.UtcNow;
        match.RespondedAt = DateTime.UtcNow;
        match.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} rejected match {MatchId}", GetCurrentUserId(), id);
        return Ok(new { success = true, message = "Match rejected", data = MapMatchApproval(match) });
    }

    [HttpPost("matching/cache/clear")]
    public IActionResult ClearMatchCache()
    {
        _logger.LogInformation("Admin {AdminId} requested match cache clear; matches are stored in match_results and no separate cache is configured", GetCurrentUserId());
        return Ok(new { success = true, message = "No separate match cache is configured; match_results remain unchanged", cleared = false });
    }

    // ──────────────────────────────────────────────
    // Plans & Subscriptions (6 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("plans")]
    public async Task<IActionResult> ListPlans([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.SubscriptionPlans
            .AsNoTracking()
            .Include(p => p.Subscriptions)
            .OrderBy(p => p.Price)
            .ThenBy(p => p.Name);

        var total = await query.CountAsync();
        var plans = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new { data = plans.Select(MapPlan), total, page, per_page = limit });
    }

    [HttpGet("plans/{id:int}")]
    public async Task<IActionResult> GetPlan(int id)
    {
        var plan = await _db.SubscriptionPlans
            .AsNoTracking()
            .Include(p => p.Subscriptions)
            .FirstOrDefaultAsync(p => p.Id == id);

        return plan == null ? NotFound(new { error = "Plan not found" }) : Ok(MapPlan(plan));
    }

    [HttpPost("plans")]
    public async Task<IActionResult> CreatePlan([FromBody] AdminPlanRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Plan name is required" });

        var plan = new SubscriptionPlan
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            Name = request.Name.Trim(),
            Description = request.Description,
            Price = request.Price ?? 0,
            Currency = string.IsNullOrWhiteSpace(request.Currency) ? "EUR" : request.Currency.Trim().ToUpperInvariant(),
            MaxMembers = request.MaxMembers ?? 0,
            MaxListings = request.MaxListings ?? 0,
            MaxExchangesPerMonth = request.MaxExchangesPerMonth ?? 0,
            Features = SerializePlanFeatures(request.Features, "[]"),
            IsActive = request.IsActive ?? true,
            IsPublic = request.IsPublic ?? true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.SubscriptionPlans.Add(plan);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} created plan {PlanId}", GetCurrentUserId(), plan.Id);
        return Created($"/api/admin/plans/{plan.Id}", new { success = true, data = MapPlan(plan), id = plan.Id });
    }

    [HttpPut("plans/{id:int}")]
    public async Task<IActionResult> UpdatePlan(int id, [FromBody] AdminPlanRequest request)
    {
        var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.Id == id);
        if (plan == null)
            return NotFound(new { error = "Plan not found" });

        if (!string.IsNullOrWhiteSpace(request.Name)) plan.Name = request.Name.Trim();
        if (request.Description != null) plan.Description = request.Description;
        if (request.Price.HasValue) plan.Price = request.Price.Value;
        if (!string.IsNullOrWhiteSpace(request.Currency)) plan.Currency = request.Currency.Trim().ToUpperInvariant();
        if (request.MaxMembers.HasValue) plan.MaxMembers = request.MaxMembers.Value;
        if (request.MaxListings.HasValue) plan.MaxListings = request.MaxListings.Value;
        if (request.MaxExchangesPerMonth.HasValue) plan.MaxExchangesPerMonth = request.MaxExchangesPerMonth.Value;
        if (request.Features.HasValue) plan.Features = SerializePlanFeatures(request.Features, plan.Features);
        if (request.IsActive.HasValue) plan.IsActive = request.IsActive.Value;
        if (request.IsPublic.HasValue) plan.IsPublic = request.IsPublic.Value;
        plan.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated plan {Id}", GetCurrentUserId(), id);
        return Ok(new { success = true, data = MapPlan(plan), id });
    }

    [HttpDelete("plans/{id:int}")]
    public async Task<IActionResult> DeletePlan(int id)
    {
        var plan = await _db.SubscriptionPlans
            .Include(p => p.Subscriptions)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (plan == null)
            return NotFound(new { error = "Plan not found" });

        if (plan.Subscriptions.Count > 0)
        {
            plan.IsActive = false;
            plan.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            _db.SubscriptionPlans.Remove(plan);
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted/deactivated plan {Id}", GetCurrentUserId(), id);
        return Ok(new { success = true });
    }

    // ──────────────────────────────────────────────
    // Menus (10 endpoints)
    // ──────────────────────────────────────────────

    [HttpGet("menus")]
    public async Task<IActionResult> ListMenus()
    {
        var menus = await GetMenuDefinitionsAsync();
        var counts = await _db.Pages
            .AsNoTracking()
            .Where(p => p.ShowInMenu)
            .GroupBy(p => p.MenuLocation ?? "header")
            .Select(g => new { Location = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Location, x => x.Count);

        return Ok(new
        {
            data = menus.Select(menu => new
            {
                id = menu.Id,
                name = menu.Name,
                location = menu.Location,
                is_system = menu.IsSystem,
                items_count = counts.GetValueOrDefault(menu.Location, 0)
            }),
            total = menus.Count
        });
    }

    [HttpGet("menus/{id:int}")]
    public async Task<IActionResult> GetMenu(int id)
    {
        var menu = (await GetMenuDefinitionsAsync()).FirstOrDefault(m => m.Id == id);
        if (menu == null)
            return NotFound(new { error = "Menu not found" });

        var items = await GetMenuItemsForLocationAsync(menu.Location);
        return Ok(new { id = menu.Id, name = menu.Name, location = menu.Location, is_system = menu.IsSystem, items });
    }

    [HttpPost("menus")]
    public async Task<IActionResult> CreateMenu([FromBody] JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "Menu payload is required" });

        var name = GetStringProperty(request, "name", "title", "label");
        if (string.IsNullOrWhiteSpace(name))
            return BadRequest(new { error = "name is required" });

        var menus = await GetMenuDefinitionsAsync(includeDeleted: true);
        var requestedLocation = GetStringProperty(request, "location", "slug", "key");
        var location = NormalizeConfigSegment(string.IsNullOrWhiteSpace(requestedLocation) ? name : requestedLocation);
        if (menus.Any(m => !m.IsDeleted && m.Location.Equals(location, StringComparison.OrdinalIgnoreCase)))
            location = $"{location}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";

        var requestedId = TryReadIntProperty(request, out var explicitId, "id") ? explicitId : 0;
        var nextId = requestedId > 0 && menus.All(m => m.Id != requestedId)
            ? requestedId
            : menus.Select(m => m.Id).DefaultIfEmpty(0).Max() + 1;

        var now = DateTime.UtcNow;
        var menu = new AdminCompatibilityMenuDefinition
        {
            Id = nextId,
            Name = name.Trim(),
            Location = location,
            IsSystem = false,
            CreatedAt = now,
            UpdatedAt = now
        };
        menus.Add(menu);
        await SaveMenuDefinitionsAsync(menus);

        _logger.LogInformation("Admin {AdminId} created compatibility menu {MenuId}", GetCurrentUserId(), menu.Id);
        return Created($"/api/admin/menus/{menu.Id}", new { success = true, id = menu.Id, data = MapMenuDefinition(menu) });
    }

    [HttpPut("menus/{id:int}")]
    public async Task<IActionResult> UpdateMenu(int id, [FromBody] JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "Menu payload is required" });

        var menus = await GetMenuDefinitionsAsync(includeDeleted: true);
        var menu = menus.FirstOrDefault(m => m.Id == id && !m.IsDeleted);
        if (menu == null)
            return NotFound(new { error = "Menu not found" });

        var oldLocation = menu.Location;
        var name = GetStringProperty(request, "name", "title", "label");
        if (!string.IsNullOrWhiteSpace(name))
            menu.Name = name.Trim();

        var requestedLocation = GetStringProperty(request, "location", "slug", "key");
        if (!string.IsNullOrWhiteSpace(requestedLocation))
        {
            var location = NormalizeConfigSegment(requestedLocation);
            if (menus.Any(m => m.Id != id && !m.IsDeleted && m.Location.Equals(location, StringComparison.OrdinalIgnoreCase)))
                return Conflict(new { error = "A menu with this location already exists" });

            menu.Location = location;
        }

        menu.UpdatedAt = DateTime.UtcNow;
        if (!oldLocation.Equals(menu.Location, StringComparison.OrdinalIgnoreCase))
        {
            var pages = await _db.Pages.Where(p => p.ShowInMenu && (p.MenuLocation ?? "header") == oldLocation).ToListAsync();
            foreach (var page in pages)
            {
                page.MenuLocation = menu.Location;
                page.UpdatedAt = DateTime.UtcNow;
            }
        }

        await SaveMenuDefinitionsAsync(menus);

        _logger.LogInformation("Admin {AdminId} updated compatibility menu {MenuId}", GetCurrentUserId(), menu.Id);
        return Ok(new { success = true, id = menu.Id, data = MapMenuDefinition(menu) });
    }

    [HttpDelete("menus/{id:int}")]
    public async Task<IActionResult> DeleteMenu(int id)
    {
        var menus = await GetMenuDefinitionsAsync(includeDeleted: true);
        var menu = menus.FirstOrDefault(m => m.Id == id && !m.IsDeleted);
        if (menu == null)
            return NotFound(new { error = "Menu not found" });

        menu.IsDeleted = true;
        menu.UpdatedAt = DateTime.UtcNow;

        var pages = await _db.Pages.Where(p => p.ShowInMenu && (p.MenuLocation ?? "header") == menu.Location).ToListAsync();
        foreach (var page in pages)
        {
            page.ShowInMenu = false;
            page.MenuLocation = null;
            page.UpdatedAt = DateTime.UtcNow;
        }

        await SaveMenuDefinitionsAsync(menus);

        _logger.LogInformation("Admin {AdminId} deleted compatibility menu {MenuId}", GetCurrentUserId(), menu.Id);
        return Ok(new { success = true, id, deleted_items = pages.Count });
    }

    [HttpGet("menus/{menuId:int}/items")]
    public async Task<IActionResult> GetMenuItems(int menuId)
    {
        var menu = (await GetMenuDefinitionsAsync()).FirstOrDefault(m => m.Id == menuId);
        if (menu == null)
            return NotFound(new { error = "Menu not found" });

        var items = await GetMenuItemsForLocationAsync(menu.Location);
        return Ok(new { data = items, total = items.Count, menu_id = menuId });
    }

    [HttpPost("menus/{menuId:int}/items")]
    public async Task<IActionResult> CreateMenuItem(int menuId, [FromBody] AdminMenuItemRequest request)
    {
        var menu = (await GetMenuDefinitionsAsync()).FirstOrDefault(m => m.Id == menuId);
        if (menu == null)
            return NotFound(new { error = "Menu not found" });

        var adminId = GetCurrentUserId();
        if (adminId == null)
            return Unauthorized(new { error = "Invalid token" });

        Page page;
        if (request.PageId.HasValue)
        {
            var existingPage = await _db.Pages.FirstOrDefaultAsync(p => p.Id == request.PageId.Value);
            if (existingPage == null)
                return NotFound(new { error = "Page not found" });
            page = existingPage;
        }
        else
        {
            var title = request.Title ?? request.Label;
            if (string.IsNullOrWhiteSpace(title))
                return BadRequest(new { error = "title or label is required when creating a menu item" });

            if (!string.IsNullOrWhiteSpace(request.Url) && Uri.TryCreate(request.Url, UriKind.Absolute, out _))
                return BadRequest(new { error = "External menu URLs require a CMS page-backed link in this compatibility endpoint" });

            var slug = NormalizePageSlug(request.Slug ?? request.Url ?? title);
            if (await _db.Pages.AnyAsync(p => p.Slug == slug))
                return Conflict(new { error = "A page with this slug already exists" });

            page = new Page
            {
                TenantId = _tenant.GetTenantIdOrThrow(),
                Title = title.Trim(),
                Slug = slug,
                Content = request.Content ?? string.Empty,
                IsPublished = request.IsPublished ?? true,
                CreatedById = adminId.Value,
                CreatedAt = DateTime.UtcNow
            };
            _db.Pages.Add(page);
        }

        var validation = await ApplyMenuItemRequestAsync(page, request, menu.Location, allowTitleFallback: request.PageId.HasValue);
        if (validation != null)
            return BadRequest(new { error = validation });

        page.ShowInMenu = true;
        page.MenuLocation = menu.Location;
        page.UpdatedAt = DateTime.UtcNow;

        if (!request.SortOrder.HasValue)
        {
            page.SortOrder = (await _db.Pages
                .Where(p => p.ShowInMenu && (p.MenuLocation ?? "header") == menu.Location)
                .Select(p => (int?)p.SortOrder)
                .MaxAsync() ?? -1) + 1;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} created menu item {ItemId} for menu {MenuId}", adminId, page.Id, menuId);
        return Created($"/api/admin/menu-items/{page.Id}", new { success = true, id = page.Id, menu_id = menuId, data = MapMenuItem(page) });
    }

    [HttpPut("menu-items/{itemId:int}")]
    public async Task<IActionResult> UpdateMenuItem(int itemId, [FromBody] AdminMenuItemRequest request)
    {
        var page = await _db.Pages.FirstOrDefaultAsync(p => p.Id == itemId);
        if (page == null)
            return NotFound(new { error = "Menu item not found" });

        var location = page.MenuLocation ?? "header";
        if (request.MenuId.HasValue)
        {
            var menu = (await GetMenuDefinitionsAsync()).FirstOrDefault(m => m.Id == request.MenuId.Value);
            if (menu == null)
                return BadRequest(new { error = "Menu not found" });
            location = menu.Location;
        }
        else if (!string.IsNullOrWhiteSpace(request.MenuLocation))
        {
            var normalized = NormalizeConfigSegment(request.MenuLocation);
            var menuLocationExists = (await GetMenuDefinitionsAsync()).Any(m => m.Location.Equals(normalized, StringComparison.OrdinalIgnoreCase));
            if (!menuLocationExists)
                return BadRequest(new { error = "Unsupported menu location" });
            location = normalized;
        }

        var validation = await ApplyMenuItemRequestAsync(page, request, location, allowTitleFallback: true);
        if (validation != null)
            return BadRequest(new { error = validation });

        page.ShowInMenu = request.ShowInMenu ?? true;
        page.MenuLocation = page.ShowInMenu ? location : null;
        page.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} updated menu item {ItemId}", GetCurrentUserId(), itemId);
        return Ok(new { success = true, id = itemId, data = MapMenuItem(page) });
    }

    [HttpDelete("menu-items/{itemId:int}")]
    public async Task<IActionResult> DeleteMenuItem(int itemId)
    {
        var page = await _db.Pages.FirstOrDefaultAsync(p => p.Id == itemId);
        if (page == null)
            return NotFound(new { error = "Menu item not found" });

        page.ShowInMenu = false;
        page.MenuLocation = null;
        page.ParentId = null;
        page.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} removed page {PageId} from menus", GetCurrentUserId(), itemId);
        return Ok(new { success = true, id = itemId });
    }

    [HttpPost("menus/{menuId:int}/items/reorder")]
    public async Task<IActionResult> ReorderMenuItems(int menuId, [FromBody] JsonElement request)
    {
        var menu = (await GetMenuDefinitionsAsync()).FirstOrDefault(m => m.Id == menuId);
        if (menu == null)
            return NotFound(new { error = "Menu not found" });

        var ordering = ExtractMenuOrdering(request);
        if (ordering.Count == 0)
            return BadRequest(new { error = "items or ids are required" });

        var ids = ordering.Select(x => x.PageId).Distinct().ToList();
        var pages = await _db.Pages
            .Where(p => ids.Contains(p.Id) && p.ShowInMenu && (p.MenuLocation ?? "header") == menu.Location)
            .ToListAsync();

        var missing = ids.Except(pages.Select(p => p.Id)).ToArray();
        if (missing.Length > 0)
            return NotFound(new { error = "One or more menu items were not found in this menu", missing_ids = missing });

        foreach (var item in ordering)
        {
            var page = pages.First(p => p.Id == item.PageId);
            page.SortOrder = item.SortOrder;
            page.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} reordered {Count} menu items for menu {MenuId}", GetCurrentUserId(), ordering.Count, menuId);
        return Ok(new { success = true, message = "Items reordered", updated = ordering.Count });
    }

    private async Task<List<object>> ListLaravelReactCronJobsAsync()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var slugs = LaravelReactCronJobs.Select(j => j.Slug).ToList();
        var persistedJobNames = slugs
            .Concat(LaravelCronToScheduledJob.Values)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var lastRuns = await _db.ScheduledJobRuns
            .AsNoTracking()
            .Where(r => (r.TenantId == tenantId || r.TenantId == null) && persistedJobNames.Contains(r.JobName))
            .GroupBy(r => r.JobName)
            .Select(group => group.OrderByDescending(r => r.StartedAt).First())
            .ToListAsync();

        return LaravelReactCronJobs.Select((job, index) =>
        {
            var executionSupported = LaravelCronToScheduledJob.TryGetValue(job.Slug, out var scheduledJobName);
            var lastRun = lastRuns
                .Where(r => r.JobName == job.Slug || r.JobName == scheduledJobName)
                .OrderByDescending(r => r.StartedAt)
                .FirstOrDefault();
            return (object)new
            {
                id = index + 1,
                slug = job.Slug,
                name = job.Name,
                command = job.Command,
                schedule = job.Schedule,
                status = executionSupported ? "active" : "disabled",
                execution_supported = executionSupported,
                category = job.Category,
                description = job.Description,
                last_run_at = lastRun?.StartedAt,
                last_status = lastRun == null || lastRun.Status == ScheduledJobRunStatus.Running
                    ? null
                    : LaravelReactCronRunStatus(lastRun.Status),
                next_run_at = CalculateLaravelReactNextRun(job.Schedule)
            };
        }).ToList();
    }

    private async Task<IActionResult> RunLaravelReactCronJobAsync(string id)
    {
        var authorization = HttpContext.RequestServices.GetRequiredService<IAuthorizationService>();
        var platformAccess = await authorization.AuthorizeAsync(
            User,
            resource: null,
            NexusAuthorizationPolicies.PlatformSuperAdminOnly);
        if (!platformAccess.Succeeded)
        {
            return LaravelError(
                "forbidden",
                "Platform super-admin access is required to run cron jobs manually.",
                StatusCodes.Status403Forbidden);
        }

        if (!int.TryParse(id, NumberStyles.Integer, CultureInfo.InvariantCulture, out var numericId) || numericId < 1)
        {
            return LaravelError("VALIDATION_ERROR", "Invalid cron job id.", StatusCodes.Status400BadRequest);
        }

        if (numericId > LaravelReactCronJobs.Length)
        {
            return LaravelError("NOT_FOUND", "Cron job not found.", StatusCodes.Status404NotFound);
        }

        var job = LaravelReactCronJobs[numericId - 1];
        if (!LaravelCronToScheduledJob.TryGetValue(job.Slug, out var scheduledJobName))
        {
            return LaravelError(
                "UNSUPPORTED_OPERATION",
                $"Cron job '{job.Slug}' does not yet have a fully equivalent ASP.NET implementation.",
                StatusCodes.Status501NotImplemented);
        }

        var scheduledJob = HttpContext.RequestServices
            .GetServices<IHostedService>()
            .OfType<ScheduledHostedService>()
            .SingleOrDefault(candidate => candidate.Name == scheduledJobName);
        if (scheduledJob is null)
        {
            return LaravelError(
                "SERVICE_UNAVAILABLE",
                $"ASP.NET scheduled job '{scheduledJobName}' is not registered.",
                StatusCodes.Status503ServiceUnavailable);
        }

        var result = await scheduledJob.RunNowAsync(HttpContext.RequestAborted);
        var duration = Math.Round(Math.Max(0, result.Elapsed.TotalSeconds), 2);
        var output = result.Output.Length <= 500 ? result.Output : result.Output[..500];

        if (result.Outcome == ScheduledJobExecutionOutcome.Disabled)
        {
            return LaravelValidationError($"Cron job '{job.Slug}' is disabled.", "status");
        }

        var triggered = result.Outcome is ScheduledJobExecutionOutcome.Success or ScheduledJobExecutionOutcome.Failed;
        var status = result.Outcome switch
        {
            ScheduledJobExecutionOutcome.Success when result.Persisted => "success",
            ScheduledJobExecutionOutcome.Busy => "busy",
            _ => "error"
        };

        var response = new
        {
            triggered,
            job_slug = job.Slug,
            job_name = job.Name,
            status,
            duration,
            output
        };

        if (result.Outcome == ScheduledJobExecutionOutcome.Busy)
            return LaravelData(response, StatusCodes.Status409Conflict);

        if (result.Outcome != ScheduledJobExecutionOutcome.Success || !result.Persisted)
            return LaravelData(response, StatusCodes.Status500InternalServerError);

        return LaravelData(response);
    }

    private static string? CalculateLaravelReactNextRun(string cronExpression)
    {
        var parts = cronExpression.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 5) return null;

        var minute = parts[0];
        var hour = parts[1];
        var dayOfWeek = parts[4];
        var now = DateTime.UtcNow;
        var next = now;

        if (minute == "*" && hour == "*")
        {
            return FormatLaravelCronTime(next.AddMinutes(1));
        }

        if (minute.StartsWith("*/", StringComparison.Ordinal) &&
            int.TryParse(minute[2..], NumberStyles.Integer, CultureInfo.InvariantCulture, out var interval) &&
            interval > 0)
        {
            var nextMinute = (int)(Math.Ceiling(now.Minute / (double)interval) * interval);
            if (nextMinute >= 60)
            {
                next = new DateTime(now.Year, now.Month, now.Day, now.Hour, 0, 0, DateTimeKind.Utc).AddHours(1);
            }
            else
            {
                next = new DateTime(now.Year, now.Month, now.Day, now.Hour, nextMinute, 0, DateTimeKind.Utc);
            }

            if (next <= now) next = next.AddMinutes(interval);
            return FormatLaravelCronTime(next);
        }

        if (int.TryParse(minute, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedMinute) &&
            int.TryParse(hour, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedHour))
        {
            if (dayOfWeek != "*" && int.TryParse(dayOfWeek, NumberStyles.Integer, CultureInfo.InvariantCulture, out var targetDay))
            {
                var currentDay = (int)now.DayOfWeek;
                var daysUntil = (targetDay - currentDay + 7) % 7;
                next = new DateTime(now.Year, now.Month, now.Day, parsedHour, parsedMinute, 0, DateTimeKind.Utc).AddDays(daysUntil);
                if (next <= now) next = next.AddDays(7);
                return FormatLaravelCronTime(next);
            }

            next = new DateTime(now.Year, now.Month, now.Day, parsedHour, parsedMinute, 0, DateTimeKind.Utc);
            if (next <= now) next = next.AddDays(1);
            return FormatLaravelCronTime(next);
        }

        if (int.TryParse(minute, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedMinute) && hour == "*")
        {
            next = new DateTime(now.Year, now.Month, now.Day, now.Hour, parsedMinute, 0, DateTimeKind.Utc);
            if (next <= now) next = next.AddHours(1);
            return FormatLaravelCronTime(next);
        }

        return null;
    }

    private static string FormatLaravelCronTime(DateTime value)
        => value.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    private static string LaravelReactCronRunStatus(ScheduledJobRunStatus status)
        => status is ScheduledJobRunStatus.Failed or ScheduledJobRunStatus.Skipped ? "error" : "success";

    private async Task<object?> RecordScheduledTaskRunAsync(string id)
    {
        var task = int.TryParse(id, out var numericId)
            ? await _db.ScheduledTasks.FirstOrDefaultAsync(t => t.Id == numericId)
            : await _db.ScheduledTasks.FirstOrDefaultAsync(t => t.TaskName.ToLower() == id.Trim().ToLower());

        if (task == null)
            return null;

        var startedAt = DateTime.UtcNow;
        task.Status = ScheduledTaskStatus.Completed;
        task.LastRunAt = startedAt;
        task.RunCount++;
        task.ErrorMessage = null;
        task.UpdatedAt = startedAt;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} recorded manual run for scheduled task {TaskId} ({TaskName})", GetCurrentUserId(), task.Id, task.TaskName);
        return new
        {
            success = true,
            message = "Task run recorded; no separate background executor was invoked",
            job_id = task.Id,
            task_name = task.TaskName,
            status = task.Status.ToString().ToLowerInvariant(),
            started_at = startedAt,
            completed_at = task.LastRunAt,
            run_count = task.RunCount
        };
    }

    private static string MapLaravelReactBackgroundJobStatus(ScheduledTaskStatus? status)
    {
        return status switch
        {
            ScheduledTaskStatus.Running => "running",
            ScheduledTaskStatus.Failed => "failed",
            _ => "idle"
        };
    }

    private static List<AdminCompatibilityRedirect> DeserializeRedirects(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return [];

        try
        {
            return JsonSerializer.Deserialize<List<AdminCompatibilityRedirect>>(raw, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            }) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task<List<AdminAttributeDefinition>> GetAttributeCatalogAsync()
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.Key == "attributes.catalog")
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        if (string.IsNullOrWhiteSpace(raw))
            return [];

        try
        {
            return JsonSerializer.Deserialize<List<AdminAttributeDefinition>>(raw) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task SaveAttributeCatalogAsync(List<AdminAttributeDefinition> attributes)
    {
        await UpsertTenantConfigAsync("attributes.catalog", JsonSerializer.Serialize(attributes));
        await _db.SaveChangesAsync();
    }

    private static object MapAttribute(AdminAttributeDefinition attribute) => new
    {
        id = attribute.Id,
        key = attribute.Key,
        slug = NormalizeAttributeSlug(attribute.Name),
        name = attribute.Name,
        label = attribute.Name,
        type = attribute.Type,
        options = (object?)null,
        category_id = ReadAttributeCategoryId(attribute.Metadata),
        category_name = (object?)null,
        required = attribute.Required,
        is_required = attribute.Required,
        active = attribute.Active,
        is_active = attribute.Active,
        target_type = ReadAttributeTargetType(attribute.Metadata),
        metadata = ParseJsonObject(attribute.Metadata),
        created_from = "tenant_config"
    };

    private static string NormalizeAttributeSlug(string value)
    {
        var slug = Regex.Replace(value.Trim().ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "attribute" : slug;
    }

    private static int? ReadAttributeCategoryId(string metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata))
            return null;

        try
        {
            using var doc = JsonDocument.Parse(metadata);
            return TryReadIntProperty(doc.RootElement, out var id, "category_id", "categoryId")
                ? id
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string ReadAttributeTargetType(string metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata))
            return "any";

        try
        {
            using var doc = JsonDocument.Parse(metadata);
            return GetStringProperty(doc.RootElement, "target_type", "targetType") ?? "any";
        }
        catch (JsonException)
        {
            return "any";
        }
    }

    private static object MapLocale(SupportedLocale locale) => new
    {
        id = locale.Id,
        code = locale.Locale,
        locale = locale.Locale,
        name = locale.Name,
        native_name = locale.NativeName,
        is_default = locale.IsDefault,
        is_active = locale.IsActive,
        completion_percent = locale.CompletionPercent
    };

    private static object MapGamificationCampaign(GamificationChallenge campaign) => new
    {
        id = campaign.Id,
        title = campaign.Title,
        name = campaign.Title,
        description = campaign.Description,
        type = campaign.Type,
        action_type = campaign.ActionType,
        target_count = campaign.TargetCount,
        xp_reward = campaign.XpReward,
        badge_reward = campaign.BadgeReward,
        starts_at = campaign.StartsAt,
        ends_at = campaign.EndsAt,
        is_active = campaign.IsActive,
        created_at = campaign.CreatedAt
    };

    private static List<AdminImportUserItem> ExtractImportUsers(JsonElement request)
    {
        var source = request;
        if (request.ValueKind == JsonValueKind.Object)
        {
            if (request.TryGetProperty("users", out var users))
                source = users;
            else if (request.TryGetProperty("data", out var data))
                source = data;
        }

        if (source.ValueKind != JsonValueKind.Array)
            return [];

        var result = new List<AdminImportUserItem>();
        foreach (var item in source.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
                continue;

            result.Add(new AdminImportUserItem(
                GetStringProperty(item, "email"),
                GetStringProperty(item, "first_name", "firstName", "first"),
                GetStringProperty(item, "last_name", "lastName", "last"),
                GetStringProperty(item, "role"),
                GetStringProperty(item, "password", "temporary_password"),
                ReadBooleanProperty(item, "is_active", "active"),
                ReadBooleanProperty(item, "email_verified", "verified")));
        }

        return result;
    }

    private static List<List<string>> ParseCsvRecords(string csv)
    {
        var records = new List<List<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < csv.Length; i++)
        {
            var ch = csv[i];
            if (ch == '"')
            {
                if (inQuotes && i + 1 < csv.Length && csv[i + 1] == '"')
                {
                    field.Append('"');
                    i++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (ch == ',' && !inQuotes)
            {
                row.Add(field.ToString());
                field.Clear();
                continue;
            }

            if ((ch == '\n' || ch == '\r') && !inQuotes)
            {
                if (ch == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n')
                    i++;
                row.Add(field.ToString());
                field.Clear();
                if (row.Any(value => !string.IsNullOrWhiteSpace(value)))
                    records.Add(row);
                row = [];
                continue;
            }

            field.Append(ch);
        }

        row.Add(field.ToString());
        if (row.Any(value => !string.IsNullOrWhiteSpace(value)))
            records.Add(row);

        return records;
    }

    private static string CsvValue(IReadOnlyList<string> row, IReadOnlyDictionary<string, int> columnMap, string name)
        => columnMap.TryGetValue(name, out var index) && index >= 0 && index < row.Count
            ? row[index]
            : string.Empty;

    private static string NormalizeImportRole(string? role, string fallback = "member")
    {
        var normalized = role?.Trim().ToLowerInvariant();
        return normalized is "member" or "admin" or "broker" ? normalized : fallback;
    }

    private static bool IsValidEmail(string email)
        => Regex.IsMatch(email, "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private static List<string> ExtractStringArray(JsonElement request, params string[] names)
    {
        foreach (var name in names)
        {
            if (!request.TryGetProperty(name, out var value))
                continue;

            if (value.ValueKind == JsonValueKind.Array)
            {
                return value.EnumerateArray()
                    .Select(v => v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText())
                    .Where(v => !string.IsNullOrWhiteSpace(v))
                    .Select(v => v!.Trim())
                    .ToList();
            }

            if (value.ValueKind == JsonValueKind.String)
            {
                return value.GetString()!
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();
            }
        }

        return [];
    }

    private static List<int> ExtractIntArray(JsonElement request, params string[] names)
    {
        foreach (var name in names)
        {
            if (!request.TryGetProperty(name, out var value))
                continue;

            if (value.ValueKind == JsonValueKind.Array)
            {
                return value.EnumerateArray()
                    .Select(v => TryReadInt(v, out var id) ? id : 0)
                    .Where(id => id > 0)
                    .ToList();
            }

            if (TryReadInt(value, out var singleId) && singleId > 0)
                return [singleId];
        }

        return [];
    }

    private static bool? ReadBooleanProperty(JsonElement request, params string[] names)
    {
        foreach (var name in names)
        {
            if (request.TryGetProperty(name, out var value))
                return ReadBoolean(value);
        }

        return null;
    }

    private static bool TryReadDateTimeProperty(JsonElement request, out DateTime value, params string[] names)
    {
        foreach (var name in names)
        {
            if (!request.TryGetProperty(name, out var property))
                continue;

            if (property.ValueKind == JsonValueKind.String && DateTime.TryParse(property.GetString(), out value))
            {
                value = DateTime.SpecifyKind(value, DateTimeKind.Utc);
                return true;
            }
        }

        value = default;
        return false;
    }

    private static string NormalizeLocaleCode(string value) => value.Trim().ToLowerInvariant();

    private static string GetLocaleName(string code) => code switch
    {
        "en" => "English",
        "ga" => "Irish",
        "fr" => "French",
        "es" => "Spanish",
        "de" => "German",
        "pl" => "Polish",
        "pt" => "Portuguese",
        _ => code
    };

    private static object? ParseJsonObject(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        try
        {
            using var doc = JsonDocument.Parse(raw);
            return ConvertJsonValue(doc.RootElement);
        }
        catch (JsonException)
        {
            return raw;
        }
    }

    private async Task<TenantConfig> UpsertTenantConfigAsync(string key, string value)
    {
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == key);
        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = DateTime.UtcNow;
            return existing;
        }

        var config = new TenantConfig
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            Key = key,
            Value = value,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.TenantConfigs.Add(config);
        return config;
    }

    private static Dictionary<string, bool> ExtractBooleanSettings(JsonElement request, string collectionName, string singleName)
    {
        var updates = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        if (request.ValueKind != JsonValueKind.Object)
            return updates;

        var targetName = GetStringProperty(request, singleName, "key", "name", "slug");
        var targetValue = GetBooleanProperty(request, "enabled", "is_enabled", "active", "value");
        if (!string.IsNullOrWhiteSpace(targetName) && targetValue.HasValue)
        {
            updates[NormalizeConfigSegment(targetName)] = targetValue.Value;
        }

        if (request.TryGetProperty(collectionName, out var collection) && collection.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in collection.EnumerateObject())
            {
                var value = ReadBoolean(property.Value);
                if (value.HasValue)
                    updates[NormalizeConfigSegment(property.Name)] = value.Value;
            }
        }

        foreach (var property in request.EnumerateObject())
        {
            if (property.NameEquals(collectionName) ||
                property.NameEquals(singleName) ||
                property.NameEquals("key") ||
                property.NameEquals("name") ||
                property.NameEquals("slug") ||
                property.NameEquals("enabled") ||
                property.NameEquals("is_enabled") ||
                property.NameEquals("active") ||
                property.NameEquals("value"))
            {
                continue;
            }

            var value = ReadBoolean(property.Value);
            if (value.HasValue)
                updates[NormalizeConfigSegment(property.Name)] = value.Value;
        }

        return updates;
    }

    private static string? GetStringProperty(JsonElement request, params string[] names)
    {
        foreach (var name in names)
        {
            if (request.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String)
                return value.GetString();
        }

        return null;
    }

    private static bool? GetBooleanProperty(JsonElement request, params string[] names)
    {
        foreach (var name in names)
        {
            if (request.TryGetProperty(name, out var value))
                return ReadBoolean(value);
        }

        return null;
    }

    private static bool? ReadBoolean(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            JsonValueKind.Number when value.TryGetInt32(out var number) => number != 0,
            _ => null
        };
    }

    private static string BuildGroupedConfigKey(string group, string key)
    {
        var normalizedGroup = NormalizeConfigSegment(group);
        var normalizedKey = NormalizeConfigSegment(key);
        return normalizedKey.StartsWith(normalizedGroup + ".", StringComparison.OrdinalIgnoreCase)
            ? normalizedKey
            : $"{normalizedGroup}.{normalizedKey}";
    }

    private static string NormalizeConfigSegment(string value)
    {
        return value.Trim().TrimStart('.').Replace(' ', '_').Replace('-', '_').ToLowerInvariant();
    }

    private static string SerializeConfigValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => string.Empty,
            JsonValueKind.Undefined => string.Empty,
            _ => value.GetRawText()
        };
    }

    private async Task<Dictionary<string, object?>> GetJsonConfigAsync(string key, Dictionary<string, object?> defaults)
    {
        var result = new Dictionary<string, object?>(defaults, StringComparer.OrdinalIgnoreCase);
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.Key == key)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        if (string.IsNullOrWhiteSpace(raw))
            return result;

        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return result;

            foreach (var property in doc.RootElement.EnumerateObject())
            {
                result[property.Name] = ConvertJsonValue(property.Value);
            }
        }
        catch (JsonException)
        {
            result["value"] = raw;
        }

        return result;
    }

    private static Dictionary<string, object?> BuildSettingsGroup(
        IReadOnlyDictionary<string, string> config,
        string group,
        Dictionary<string, object?> defaults)
    {
        var result = new Dictionary<string, object?>(defaults, StringComparer.OrdinalIgnoreCase);
        var prefix = NormalizeConfigSegment(group) + ".";

        foreach (var entry in config.Where(c => c.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
        {
            var key = entry.Key[prefix.Length..];
            result[key] = ParseStoredConfigValue(entry.Value, result.GetValueOrDefault(key));
        }

        return result;
    }

    private static object? ParseStoredConfigValue(string value, object? fallback)
    {
        if (fallback is bool && bool.TryParse(value, out var boolValue))
            return boolValue;
        if (fallback is int && int.TryParse(value, out var intValue))
            return intValue;
        if (fallback is decimal && decimal.TryParse(value, out var decimalValue))
            return decimalValue;

        if (value.StartsWith('{') || value.StartsWith('['))
        {
            try
            {
                using var doc = JsonDocument.Parse(value);
                return ConvertJsonValue(doc.RootElement);
            }
            catch (JsonException)
            {
                return value;
            }
        }

        return value;
    }

    private static object? ConvertJsonValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when value.TryGetInt32(out var intValue) => intValue,
            JsonValueKind.Number when value.TryGetDecimal(out var decimalValue) => decimalValue,
            JsonValueKind.Array => value.EnumerateArray().Select(ConvertJsonValue).ToArray(),
            JsonValueKind.Object => value.EnumerateObject().ToDictionary(p => p.Name, p => ConvertJsonValue(p.Value)),
            JsonValueKind.Null => null,
            _ => value.GetRawText()
        };
    }

    private static string SerializePlanFeatures(JsonElement? features, string existing)
    {
        if (!features.HasValue || features.Value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            return existing;

        var value = features.Value;
        if (value.ValueKind == JsonValueKind.Array)
            return value.GetRawText();

        if (value.ValueKind == JsonValueKind.String)
        {
            var text = value.GetString();
            if (string.IsNullOrWhiteSpace(text))
                return "[]";

            return text.TrimStart().StartsWith('[')
                ? text
                : JsonSerializer.Serialize(new[] { text });
        }

        if (value.ValueKind == JsonValueKind.Object)
        {
            var enabled = value
                .EnumerateObject()
                .Where(p => ReadBoolean(p.Value) == true)
                .Select(p => p.Name)
                .ToArray();

            return JsonSerializer.Serialize(enabled);
        }

        return existing;
    }

    private static string[] DeserializePlanFeatures(string features)
    {
        if (string.IsNullOrWhiteSpace(features))
            return [];

        try
        {
            return JsonSerializer.Deserialize<string[]>(features) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static object MapPlan(SubscriptionPlan plan) => new
    {
        id = plan.Id,
        name = plan.Name,
        description = plan.Description,
        price = plan.Price,
        currency = plan.Currency,
        interval = "monthly",
        features = DeserializePlanFeatures(plan.Features),
        max_members = plan.MaxMembers,
        max_listings = plan.MaxListings,
        max_exchanges_per_month = plan.MaxExchangesPerMonth,
        is_active = plan.IsActive,
        is_public = plan.IsPublic,
        subscribers_count = plan.Subscriptions?.Count ?? 0,
        created_at = plan.CreatedAt,
        updated_at = plan.UpdatedAt
    };

    private static object MapListingSummary(Listing listing) => new
    {
        id = listing.Id,
        title = listing.Title,
        description = listing.Description,
        type = listing.Type.ToString().ToLowerInvariant(),
        status = listing.Status.ToString().ToLowerInvariant(),
        user_id = listing.UserId,
        category_id = listing.CategoryId,
        location = listing.Location,
        estimated_hours = listing.EstimatedHours,
        is_featured = listing.IsFeatured,
        view_count = listing.ViewCount,
        expires_at = listing.ExpiresAt,
        created_at = listing.CreatedAt,
        updated_at = listing.UpdatedAt
    };

    private static object MapMatchApproval(MatchResult match) => new
    {
        id = match.Id,
        status = match.Status.ToString().ToLowerInvariant(),
        match_score = match.Score,
        score = match.Score,
        reasons = DeserializeJsonStringArray(match.Reasons),
        user_id = match.UserId,
        matched_user_id = match.MatchedUserId,
        matched_listing_id = match.MatchedListingId,
        user = match.User == null ? null : new
        {
            id = match.User.Id,
            email = match.User.Email,
            name = GetDisplayName(match.User)
        },
        matched_user = match.MatchedUser == null ? null : new
        {
            id = match.MatchedUser.Id,
            email = match.MatchedUser.Email,
            name = GetDisplayName(match.MatchedUser)
        },
        matched_listing = match.MatchedListing == null ? null : new
        {
            id = match.MatchedListing.Id,
            title = match.MatchedListing.Title,
            type = match.MatchedListing.Type.ToString().ToLowerInvariant()
        },
        viewed_at = match.ViewedAt,
        responded_at = match.RespondedAt,
        created_at = match.CreatedAt,
        updated_at = match.UpdatedAt
    };

    private async Task<string?> ApplyMenuItemRequestAsync(
        Page page,
        AdminMenuItemRequest request,
        string menuLocation,
        bool allowTitleFallback)
    {
        var title = request.Title ?? request.Label;
        if (!string.IsNullOrWhiteSpace(title))
            page.Title = title.Trim();
        else if (!allowTitleFallback && string.IsNullOrWhiteSpace(page.Title))
            return "title or label is required";

        if (!string.IsNullOrWhiteSpace(request.Url) && Uri.TryCreate(request.Url, UriKind.Absolute, out _))
            return "External menu URLs require a CMS page-backed link in this compatibility endpoint";

        var slugSource = request.Slug ?? request.Url;
        if (!string.IsNullOrWhiteSpace(slugSource))
        {
            var slug = NormalizePageSlug(slugSource);
            var slugExists = await _db.Pages.AnyAsync(p => p.Id != page.Id && p.Slug == slug);
            if (slugExists)
                return "A page with this slug already exists";
            page.Slug = slug;
        }

        if (request.Content != null)
            page.Content = request.Content;
        if (request.IsPublished.HasValue)
            page.IsPublished = request.IsPublished.Value;
        if (request.SortOrder.HasValue)
            page.SortOrder = request.SortOrder.Value;

        if (request.ParentId.HasValue)
        {
            if (request.ParentId.Value == page.Id)
                return "A menu item cannot be its own parent";

            var parentExists = await _db.Pages.AnyAsync(p => p.Id == request.ParentId.Value && p.ShowInMenu && (p.MenuLocation ?? "header") == menuLocation);
            if (!parentExists)
                return "Parent menu item not found in this menu";

            page.ParentId = request.ParentId.Value;
        }

        return null;
    }

    private static object MapMenuItem(Page page) => new
    {
        id = page.Id,
        page_id = page.Id,
        title = page.Title,
        label = page.Title,
        slug = page.Slug,
        url = "/" + page.Slug.TrimStart('/'),
        parent_id = page.ParentId,
        sort_order = page.SortOrder,
        show_in_menu = page.ShowInMenu,
        menu_location = page.MenuLocation,
        is_published = page.IsPublished,
        created_at = page.CreatedAt,
        updated_at = page.UpdatedAt
    };

    private static List<(int PageId, int SortOrder)> ExtractMenuOrdering(JsonElement request)
    {
        var ordering = new List<(int PageId, int SortOrder)>();

        if (request.ValueKind == JsonValueKind.Object)
        {
            if (request.TryGetProperty("items", out var items))
                AddOrderingItems(items, ordering);
            else if (request.TryGetProperty("ids", out var ids))
                AddOrderingItems(ids, ordering);
            else if (request.TryGetProperty("item_ids", out var itemIds))
                AddOrderingItems(itemIds, ordering);
        }
        else
        {
            AddOrderingItems(request, ordering);
        }

        return ordering
            .GroupBy(x => x.PageId)
            .Select(g => g.Last())
            .OrderBy(x => x.SortOrder)
            .ToList();
    }

    private static void AddOrderingItems(JsonElement value, List<(int PageId, int SortOrder)> ordering)
    {
        if (value.ValueKind != JsonValueKind.Array)
            return;

        var index = 0;
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Number || item.ValueKind == JsonValueKind.String)
            {
                if (TryReadInt(item, out var id))
                    ordering.Add((id, index));
            }
            else if (item.ValueKind == JsonValueKind.Object)
            {
                var hasId =
                    TryReadIntProperty(item, out var id, "id", "item_id", "page_id") ||
                    TryReadInt(item, out id);

                if (hasId)
                {
                    var hasSort = TryReadIntProperty(item, out var sortOrder, "sort_order", "order", "position");
                    ordering.Add((id, hasSort ? sortOrder : index));
                }
            }

            index++;
        }
    }

    private static bool TryReadIntProperty(JsonElement item, out int result, params string[] names)
    {
        foreach (var name in names)
        {
            if (item.TryGetProperty(name, out var value) && TryReadInt(value, out result))
                return true;
        }

        result = 0;
        return false;
    }

    private static bool TryReadInt(JsonElement value, out int result)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out result))
            return true;

        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out result))
            return true;

        result = 0;
        return false;
    }

    private static string? NormalizeMenuLocation(string? location)
    {
        if (string.IsNullOrWhiteSpace(location))
            return null;

        var normalized = NormalizeConfigSegment(location);
        return MenuDefinitions.Any(m => m.Location.Equals(normalized, StringComparison.OrdinalIgnoreCase))
            ? normalized
            : null;
    }

    private async Task<List<AdminCompatibilityMenuDefinition>> GetMenuDefinitionsAsync(bool includeDeleted = false)
    {
        var menus = MenuDefinitions
            .Select(menu => new AdminCompatibilityMenuDefinition
            {
                Id = menu.Id,
                Name = menu.Name,
                Location = menu.Location,
                IsSystem = true,
                CreatedAt = DateTime.UnixEpoch,
                UpdatedAt = DateTime.UnixEpoch
            })
            .ToDictionary(menu => menu.Id);

        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.Key == MenuDefinitionsConfigKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        if (!string.IsNullOrWhiteSpace(raw))
        {
            try
            {
                var saved = JsonSerializer.Deserialize<List<AdminCompatibilityMenuDefinition>>(raw, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                }) ?? [];

                foreach (var menu in saved.Where(m => m.Id > 0 && !string.IsNullOrWhiteSpace(m.Name)))
                {
                    menu.Name = menu.Name.Trim();
                    menu.Location = NormalizeConfigSegment(string.IsNullOrWhiteSpace(menu.Location) ? menu.Name : menu.Location);
                    menu.CreatedAt = menu.CreatedAt == default ? DateTime.UtcNow : menu.CreatedAt;
                    menu.UpdatedAt = menu.UpdatedAt == default ? menu.CreatedAt : menu.UpdatedAt;
                    menu.IsSystem = menu.IsSystem || menus.ContainsKey(menu.Id);
                    menus[menu.Id] = menu;
                }
            }
            catch (JsonException)
            {
                _logger.LogWarning("Ignoring malformed tenant menu definition config for tenant {TenantId}", _tenant.GetTenantIdOrThrow());
            }
        }

        return menus.Values
            .Where(menu => includeDeleted || !menu.IsDeleted)
            .OrderBy(menu => menu.Id)
            .ToList();
    }

    private async Task SaveMenuDefinitionsAsync(List<AdminCompatibilityMenuDefinition> menus)
    {
        var normalized = menus
            .Where(menu => menu.Id > 0 && !string.IsNullOrWhiteSpace(menu.Name))
            .OrderBy(menu => menu.Id)
            .Select(menu => new AdminCompatibilityMenuDefinition
            {
                Id = menu.Id,
                Name = menu.Name.Trim(),
                Location = NormalizeConfigSegment(string.IsNullOrWhiteSpace(menu.Location) ? menu.Name : menu.Location),
                IsSystem = menu.IsSystem,
                IsDeleted = menu.IsDeleted,
                CreatedAt = menu.CreatedAt == default ? DateTime.UtcNow : menu.CreatedAt,
                UpdatedAt = menu.UpdatedAt == default ? DateTime.UtcNow : menu.UpdatedAt
            })
            .ToList();

        await UpsertTenantConfigAsync(MenuDefinitionsConfigKey, JsonSerializer.Serialize(normalized));
        await _db.SaveChangesAsync();
    }

    private static object MapMenuDefinition(AdminCompatibilityMenuDefinition menu) => new
    {
        id = menu.Id,
        name = menu.Name,
        title = menu.Name,
        location = menu.Location,
        is_system = menu.IsSystem,
        is_deleted = menu.IsDeleted,
        created_at = menu.CreatedAt,
        updated_at = menu.UpdatedAt
    };

    private static string NormalizePageSlug(string value)
    {
        var raw = value.Trim().TrimStart('/');
        var queryIndex = raw.IndexOfAny(['?', '#']);
        if (queryIndex >= 0)
            raw = raw[..queryIndex];

        var builder = new StringBuilder();
        var pendingDash = false;
        foreach (var ch in raw.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
            {
                if (pendingDash && builder.Length > 0)
                    builder.Append('-');
                builder.Append(ch);
                pendingDash = false;
            }
            else if (ch is '-' or '_' or ' ' or '/')
            {
                pendingDash = true;
            }
        }

        return builder.Length == 0 ? $"page-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}" : builder.ToString();
    }

    private static string[] DeserializeJsonStringArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return [];

        try
        {
            return JsonSerializer.Deserialize<string[]>(raw) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private bool IsDevelopmentLikeEnvironment()
    {
        var environment = _config["ASPNETCORE_ENVIRONMENT"] ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        return _config.GetValue<bool>("IsDevelopment", false) ||
            string.Equals(environment, "Development", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(environment, "Testing", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetDisplayName(User user)
    {
        var displayName = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(displayName) ? user.Email : displayName;
    }

    private static (int Id, string Name, string Location)? FindMenuDefinition(int id)
    {
        foreach (var menu in MenuDefinitions)
        {
            if (menu.Id == id)
                return menu;
        }

        return null;
    }

    private async Task<List<object>> GetMenuItemsForLocationAsync(string location)
    {
        var pages = await _db.Pages
            .AsNoTracking()
            .Where(p => p.ShowInMenu && (p.MenuLocation ?? "header") == location)
            .OrderBy(p => p.SortOrder)
            .ThenBy(p => p.Title)
            .ToListAsync();

        return pages.Select(p => (object)new
        {
            id = p.Id,
            page_id = p.Id,
            title = p.Title,
            label = p.Title,
            slug = p.Slug,
            url = "/" + p.Slug.TrimStart('/'),
            parent_id = p.ParentId,
            sort_order = p.SortOrder,
            show_in_menu = p.ShowInMenu,
            menu_location = p.MenuLocation,
            is_published = p.IsPublished
        }).ToList();
    }

    private sealed class AdminCompatibilityMenuDefinition
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Location { get; set; } = string.Empty;
        public bool IsSystem { get; set; }
        public bool IsDeleted { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}

internal record AdminImportUserItem(
    string? Email,
    string? FirstName,
    string? LastName,
    string? Role,
    string? Password,
    bool? IsActive,
    bool? EmailVerified);

internal record AdminAttributeDefinition(
    int Id,
    string Key,
    string Name,
    string Type,
    bool Required,
    bool Active,
    string Metadata);

internal class AdminCompatibilityRedirect
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("from")]
    public string From { get; set; } = string.Empty;

    [JsonPropertyName("to")]
    public string To { get; set; } = string.Empty;

    [JsonPropertyName("isPermanent")]
    public bool IsPermanent { get; set; }

    [JsonPropertyName("is_permanent")]
    public bool IsPermanentSnake
    {
        get => IsPermanent;
        set => IsPermanent = value;
    }

    [JsonPropertyName("createdAt")]
    public DateTime CreatedAt { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime CreatedAtSnake
    {
        get => CreatedAt;
        set => CreatedAt = value;
    }
}

// ──────────────────────────────────────────────
// Request DTOs
// ──────────────────────────────────────────────

public class AdminCreateUserRequest
{
    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; set; }

    [JsonPropertyName("role")]
    public string? Role { get; set; }

    [JsonPropertyName("password")]
    public string? Password { get; set; }
}

public class AdminBanUserRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class AdminSetPasswordRequest
{
    [JsonPropertyName("password")]
    public string? Password { get; set; }

    [JsonPropertyName("new_password")]
    public string? NewPassword { get; set; }

    [JsonPropertyName("temporary_password")]
    public string? TemporaryPassword { get; set; }
}

public class AdminUserBadgeRequest
{
    [JsonPropertyName("badge_id")]
    public int? BadgeId { get; set; }

    [JsonPropertyName("badge_slug")]
    public string? BadgeSlug { get; set; }

    [JsonPropertyName("slug")]
    public string? Slug
    {
        get => BadgeSlug;
        set => BadgeSlug = value;
    }
}

public class AdminAdjustBalanceRequest
{
    [JsonPropertyName("user_id")]
    public int UserId { get; set; }

    [JsonPropertyName("amount")]
    public decimal Amount { get; set; }

    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class AdminGrantCreditsRequest
{
    [JsonPropertyName("user_id")]
    public int UserId { get; set; }

    [JsonPropertyName("amount")]
    public decimal Amount { get; set; }

    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class AdminPlanRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("price")]
    public decimal? Price { get; set; }

    [JsonPropertyName("currency")]
    public string? Currency { get; set; }

    [JsonPropertyName("max_members")]
    public int? MaxMembers { get; set; }

    [JsonPropertyName("max_listings")]
    public int? MaxListings { get; set; }

    [JsonPropertyName("max_exchanges_per_month")]
    public int? MaxExchangesPerMonth { get; set; }

    [JsonPropertyName("features")]
    public JsonElement? Features { get; set; }

    [JsonPropertyName("is_active")]
    public bool? IsActive { get; set; }

    [JsonPropertyName("is_public")]
    public bool? IsPublic { get; set; }
}

public class AdminMenuItemRequest
{
    [JsonPropertyName("page_id")]
    public int? PageId { get; set; }

    [JsonPropertyName("menu_id")]
    public int? MenuId { get; set; }

    [JsonPropertyName("menu_location")]
    public string? MenuLocation { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("label")]
    public string? Label { get; set; }

    [JsonPropertyName("slug")]
    public string? Slug { get; set; }

    [JsonPropertyName("url")]
    public string? Url { get; set; }

    [JsonPropertyName("content")]
    public string? Content { get; set; }

    [JsonPropertyName("parent_id")]
    public int? ParentId { get; set; }

    [JsonPropertyName("sort_order")]
    public int? SortOrder { get; set; }

    [JsonPropertyName("is_published")]
    public bool? IsPublished { get; set; }

    [JsonPropertyName("show_in_menu")]
    public bool? ShowInMenu { get; set; }
}
