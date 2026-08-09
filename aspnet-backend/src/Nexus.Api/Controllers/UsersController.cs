// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Users controller - tenant-isolated read/write operations.
/// Phase 2: Added profile update for current user.
/// </summary>
[ApiController]
[Route("api/users")]
[Route("api/v2/users")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly FileUploadService _fileService;
    private readonly GdprService _gdprService;
    private readonly ILogger<UsersController> _logger;

    public UsersController(NexusDbContext db, TenantContext tenantContext, FileUploadService fileService, GdprService gdprService, ILogger<UsersController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _fileService = fileService;
        _gdprService = gdprService;
        _logger = logger;
    }

    /// <summary>
    /// Get current user's profile.
    /// Demonstrates: Tenant filter automatically applied.
    /// </summary>
    [HttpGet("me")]
    public async Task<IActionResult> GetMe()
    {
        var userId = User.GetUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        // Tenant filter is automatically applied via FirstOrDefaultAsync (FindAsync bypasses query filters)
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);

        if (user == null)
        {
            // User exists but in different tenant = not found (correct behavior)
            return NotFound(new { error = "User not found" });
        }

        return Ok(new
        {
            success = true,
            data = await BuildEnrichedUserResponse(user)
        });
    }

    /// <summary>
    /// List users in the current tenant.
    /// Demonstrates: Tenant filter automatically applied to queries.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        var skip = (page - 1) * limit;

        // Global query filter ensures only current tenant's users are returned
        var users = await _db.Users
            .OrderBy(u => u.Id)
            .Skip(skip)
            .Take(limit)
            .Select(u => new
            {
                id = u.Id,
                email = u.Email,
                first_name = u.FirstName,
                last_name = u.LastName,
                role = u.Role,
                is_active = u.IsActive,
                created_at = u.CreatedAt
            })
            .ToListAsync();

        var total = await _db.Users.CountAsync();

        _logger.LogDebug("Listed {Count} users for tenant {TenantId}", users.Count, _tenantContext.TenantId);

        return Ok(new
        {
            data = users,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// Get a specific user by ID.
    /// Demonstrates: Tenant filter prevents cross-tenant access.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        // Use FirstOrDefaultAsync so global tenant query filter is applied (FindAsync bypasses filters)
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id);

        if (user == null)
        {
            return NotFound(new { error = "User not found" });
        }

        return Ok(new
        {
            id = user.Id,
            email = user.Email,
            first_name = user.FirstName,
            last_name = user.LastName,
            role = user.Role,
            is_active = user.IsActive,
            created_at = user.CreatedAt
        });
    }

    /// <summary>
    /// Update current user's profile (PUT variant — delegates to PATCH logic).
    /// </summary>
    [HttpPut("me")]
    public Task<IActionResult> UpdateMePut([FromBody] UpdateProfileRequest request)
        => UpdateMe(request);

    /// <summary>
    /// Update current user's profile.
    /// Only allows updating first_name and last_name.
    /// </summary>
    [HttpPatch("me")]
    public async Task<IActionResult> UpdateMe([FromBody] UpdateProfileRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        // Validate request
        var errors = new List<string>();

        if (request.FirstName != null)
        {
            if (string.IsNullOrWhiteSpace(request.FirstName))
            {
                errors.Add("first_name cannot be empty");
            }
            else if (request.FirstName.Length > 100)
            {
                errors.Add("first_name must be 100 characters or less");
            }
        }

        if (request.LastName != null)
        {
            if (string.IsNullOrWhiteSpace(request.LastName))
            {
                errors.Add("last_name cannot be empty");
            }
            else if (request.LastName.Length > 100)
            {
                errors.Add("last_name must be 100 characters or less");
            }
        }

        if (errors.Count > 0)
        {
            return BadRequest(new { error = "Validation failed", details = errors });
        }

        // Find user (tenant filter applied via FirstOrDefaultAsync)
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);

        if (user == null)
        {
            return NotFound(new { error = "User not found" });
        }

        // Apply updates
        bool updated = false;

        if (request.FirstName != null)
        {
            user.FirstName = request.FirstName.Trim();
            updated = true;
        }

        if (request.LastName != null)
        {
            user.LastName = request.LastName.Trim();
            updated = true;
        }

        if (request.Bio != null)
        {
            user.Bio = request.Bio.Trim();
            updated = true;
        }

        var profileBag = ParseProfileBag(user.NotificationPreferences);
        if (request.Phone != null)
        {
            profileBag["profile_phone"] = request.Phone.Trim();
            updated = true;
        }
        if (request.Tagline != null)
        {
            profileBag["profile_tagline"] = request.Tagline.Trim();
            updated = true;
        }
        if (request.Location != null)
        {
            profileBag["profile_location"] = request.Location.Trim();
            updated = true;
        }
        if (request.Latitude.HasValue)
        {
            profileBag["profile_latitude"] = request.Latitude.Value;
            updated = true;
        }
        if (request.Longitude.HasValue)
        {
            profileBag["profile_longitude"] = request.Longitude.Value;
            updated = true;
        }
        if (request.ProfileType != null)
        {
            if (request.ProfileType is not ("individual" or "organisation"))
            {
                return UnprocessableEntity(new
                {
                    success = false,
                    errors = new[] { new { code = "VALIDATION_ERROR", message = "Profile type must be individual or organisation", field = "profile_type" } }
                });
            }

            profileBag["profile_type"] = request.ProfileType;
            updated = true;
        }
        if (request.OrganizationName != null)
        {
            profileBag["organization_name"] = request.OrganizationName.Trim();
            updated = true;
        }
        if (request.DateOfBirth != null)
        {
            profileBag["date_of_birth"] = request.DateOfBirth;
            updated = true;
        }

        if (updated)
        {
            user.NotificationPreferences = profileBag.ToJsonString(new JsonSerializerOptions(JsonSerializerDefaults.Web));
            user.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            _logger.LogInformation("User {UserId} updated their profile", userId);
        }

        // Return same shape as GET /api/users/me
        return Ok(new
        {
            success = true,
            data = await BuildEnrichedUserResponse(user)
        });
    }

    /// <summary>
    /// Delete the current user's account after password re-authentication.
    /// DELETE /api/v2/users/me
    /// </summary>
    [HttpDelete("me")]
    public async Task<IActionResult> DeleteMe([FromBody] DeleteAccountRequest? request)
    {
        var userId = User.GetUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var password = request?.Password ?? string.Empty;
        if (string.IsNullOrWhiteSpace(password))
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", message = "Password is required.", field = "password" }
                }
            });
        }

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
        if (user == null)
        {
            return NotFound(new { error = "User not found" });
        }

        if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[]
                {
                    new { code = "INVALID_PASSWORD", message = "Invalid password.", field = "password" }
                }
            });
        }

        var deletionRequest = new DataDeletionRequest
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = user.Id,
            Status = DeletionStatus.Approved,
            Reason = "Self-service account deletion",
            ReviewedAt = DateTime.UtcNow
        };

        _db.Set<DataDeletionRequest>().Add(deletionRequest);
        await _db.SaveChangesAsync();
        await _gdprService.ProcessDataDeletionAsync(deletionRequest.Id);

        var baseUrl = $"{Request.Scheme}://{Request.Host}".TrimEnd('/');
        return Ok(new
        {
            data = new { message = "Account deleted." },
            meta = new { base_url = baseUrl }
        });
    }

    /// <summary>
    /// Upload/update profile photo for the current user.
    /// POST /api/users/me/avatar
    /// Accepts multipart form with field "avatar" or "file".
    /// </summary>
    [HttpPost("me/avatar")]
    [RequestSizeLimit(5 * 1024 * 1024)] // 5 MB
    public async Task<IActionResult> UploadAvatar(IFormFile? avatar, IFormFile? file)
    {
        var uploadedFile = avatar ?? file;
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId == null || tenantId == null) return Unauthorized(new { error = "Invalid token" });

        if (uploadedFile == null || uploadedFile.Length == 0)
            return BadRequest(new { error = "No file provided" });

        await using var stream = uploadedFile.OpenReadStream();
        var (upload, error) = await _fileService.UploadAsync(
            stream, uploadedFile.FileName, uploadedFile.ContentType, uploadedFile.Length,
            userId.Value, tenantId.Value, FileCategory.Avatar, userId.Value, "user");

        if (error != null)
            return BadRequest(new { error });

        // Update user's avatar URL
        var savedUpload = upload!;
        var avatarUrl = _fileService.GetDownloadUrl(savedUpload);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
        if (user != null)
        {
            user.AvatarUrl = avatarUrl;
            user.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        return Ok(new { avatar_url = avatarUrl, url = avatarUrl, id = savedUpload.Id });
    }

    /// <summary>
    /// Build the enriched user response expected by frontends.
    /// Includes onboarding status, preferred language, XP, level, etc.
    /// </summary>
    private async Task<object> BuildEnrichedUserResponse(User user)
    {
        var profileBag = ParseProfileBag(user.NotificationPreferences);
        var profileType = ProfileString(profileBag, "profile_type", "individual") ?? "individual";
        var organizationName = ProfileString(profileBag, "organization_name", null);
        var displayName = profileType == "organisation" && !string.IsNullOrWhiteSpace(organizationName)
            ? organizationName
            : $"{user.FirstName} {user.LastName}".Trim();

        // Check onboarding completion: user has completed all required steps
        var totalRequired = await _db.Set<OnboardingStep>()
            .Where(s => s.TenantId == user.TenantId && s.IsRequired)
            .CountAsync();
        var completedRequired = totalRequired > 0
            ? await _db.Set<OnboardingProgress>()
                .Where(p => p.UserId == user.Id && p.TenantId == user.TenantId && p.IsCompleted)
                .Join(_db.Set<OnboardingStep>().Where(s => s.TenantId == user.TenantId && s.IsRequired),
                    p => p.StepId, s => s.Id, (p, s) => p)
                .CountAsync()
            : 0;
        var onboardingCompleted = totalRequired == 0 || completedRequired >= totalRequired;

        var preferences = await _db.Set<UserPreference>()
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.TenantId == user.TenantId && p.UserId == user.Id);
        var preferredLanguage = preferences?.Language ?? "en";
        var preferredTheme = preferences?.Theme ?? "system";
        var themePreferences = ThemePreferencesPayload(profileBag);

        // Map registration status to frontend-friendly string
        var status = user.RegistrationStatus == RegistrationStatus.Active
            ? "active"
            : user.RegistrationStatus.ToString().ToLower();

        return new
        {
            id = user.Id,
            email = user.Email,
            first_name = user.FirstName,
            last_name = user.LastName,
            name = displayName,
            role = user.Role,
            is_admin = NexusUserAccessEvaluator.HasProfileAdminIndicator(user),
            is_super_admin = user.IsSuperAdmin,
            is_tenant_super_admin = user.IsTenantSuperAdmin,
            is_god = user.IsGod,
            tenant_id = user.TenantId,
            avatar_url = user.AvatarUrl,
            bio = user.Bio,
            tagline = ProfileString(profileBag, "profile_tagline", user.Bio?.Length > 120 ? user.Bio[..120] : user.Bio),
            location = ProfileString(profileBag, "profile_location", null),
            latitude = ProfileDecimal(profileBag, "profile_latitude"),
            longitude = ProfileDecimal(profileBag, "profile_longitude"),
            phone = ProfileString(profileBag, "profile_phone", null),
            date_of_birth = ProfileString(profileBag, "date_of_birth", null),
            profile_type = profileType,
            organization_name = organizationName,
            is_active = user.IsActive,
            status,
            created_at = user.CreatedAt,
            updated_at = user.UpdatedAt,
            last_login_at = user.LastLoginAt,
            email_verified_at = user.EmailVerifiedAt,
            has_2fa_enabled = user.TwoFactorEnabled,
            xp = user.TotalXp,
            level = user.Level,
            onboarding_completed = onboardingCompleted,
            preferred_language = preferredLanguage,
            preferred_theme = preferredTheme,
            theme_preferences = themePreferences,
            balance = 0,
            total_earned = 0,
            total_spent = 0,
            groups_count = 0,
            rating = (double?)null,
            skills = Array.Empty<string>()
        };
    }

    private static JsonObject ThemePreferencesPayload(JsonObject bag)
    {
        var existing = bag.TryGetPropertyValue("theme_preferences", out var node) && node is JsonObject obj
            ? obj
            : new JsonObject();

        existing["accent_color"] ??= "#6366f1";
        existing["font_size"] ??= "medium";
        existing["density"] ??= "comfortable";
        existing["large_text"] ??= false;
        existing["high_contrast"] ??= false;
        existing["reduced_motion"] ??= false;
        existing["simplified_layout"] ??= false;
        return existing;
    }

    private static JsonObject ParseProfileBag(string? raw)
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

    private static string? ProfileString(JsonObject bag, string key, string? defaultValue)
    {
        if (!bag.TryGetPropertyValue(key, out var node) || node is not JsonValue value)
        {
            return defaultValue;
        }

        try
        {
            return value.TryGetValue<string>(out var text) ? text : defaultValue;
        }
        catch (InvalidOperationException)
        {
            return defaultValue;
        }
    }

    private static decimal? ProfileDecimal(JsonObject bag, string key)
    {
        if (!bag.TryGetPropertyValue(key, out var node) || node is not JsonValue value)
        {
            return null;
        }

        try
        {
            if (value.TryGetValue<decimal>(out var number)) return number;
            return value.TryGetValue<string>(out var text) && decimal.TryParse(text, out var parsed) ? parsed : null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }
}

/// <summary>
/// Request model for updating user profile.
/// </summary>
public class UpdateProfileRequest
{
    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; set; }

    [JsonPropertyName("bio")]
    public string? Bio { get; set; }

    [JsonPropertyName("phone")]
    public string? Phone { get; set; }

    [JsonPropertyName("tagline")]
    public string? Tagline { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("latitude")]
    public decimal? Latitude { get; set; }

    [JsonPropertyName("longitude")]
    public decimal? Longitude { get; set; }

    [JsonPropertyName("profile_type")]
    public string? ProfileType { get; set; }

    [JsonPropertyName("organization_name")]
    public string? OrganizationName { get; set; }

    [JsonPropertyName("date_of_birth")]
    public string? DateOfBirth { get; set; }
}

public class DeleteAccountRequest
{
    [JsonPropertyName("password")]
    public string? Password { get; set; }
}
