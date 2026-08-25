// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Onboarding wizard endpoints.
/// </summary>
[ApiController]
[Route("api/onboarding")]
[Authorize]
public class OnboardingController : ControllerBase
{
    private readonly OnboardingService _onboarding;
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public OnboardingController(OnboardingService onboarding, NexusDbContext db, TenantContext tenantContext)
    {
        _onboarding = onboarding;
        _db = db;
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// GET /api/onboarding/steps - Get onboarding steps.
    /// </summary>
    [HttpGet("steps")]
    public async Task<IActionResult> GetSteps()
    {
        var steps = await _onboarding.GetStepsAsync();
        return Ok(new
        {
            data = steps.Select(s => new
            {
                s.Id, s.Key, s.Title, s.Description, sort_order = s.SortOrder,
                is_required = s.IsRequired, xp_reward = s.XpReward
            })
        });
    }

    /// <summary>
    /// GET /api/onboarding/progress - Get my onboarding progress.
    /// </summary>
    [HttpGet("progress")]
    public async Task<IActionResult> GetProgress()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var progress = await _onboarding.GetProgressAsync(userId.Value);
        return Ok(new { data = progress });
    }

    /// <summary>
    /// GET /api/onboarding/config - Return the tenant's effective wizard configuration.
    /// </summary>
    [HttpGet("config")]
    public async Task<IActionResult> GetConfig()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var stored = await _db.TenantConfigs
            .Where(setting => setting.TenantId == tenantId && setting.Key.StartsWith("onboarding."))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value);

        var config = EffectiveConfig(stored);
        var steps = WizardSteps
            .Where(step => Bool(config[$"step_{step.Slug}_enabled"]))
            .Select(step => new
            {
                slug = step.Slug,
                label_code = step.Slug,
                required = config.TryGetValue($"step_{step.Slug}_required", out var required) && Bool(required)
            });

        return Ok(new { data = new { config, steps } });
    }

    /// <summary>
    /// GET /api/onboarding/status - Return persisted profile and onboarding state.
    /// </summary>
    [HttpGet("status")]
    public async Task<IActionResult> GetStatus()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var user = await _db.Users.FirstOrDefaultAsync(candidate => candidate.Id == userId && candidate.TenantId == tenantId);
        if (user == null) return Unauthorized(new { error = "Invalid token" });

        var requiredStepIds = await _db.OnboardingSteps
            .Where(step => step.TenantId == tenantId && step.IsRequired)
            .Select(step => step.Id)
            .ToListAsync();
        var completedRequired = requiredStepIds.Count == 0 || await _db.Set<OnboardingProgress>()
            .CountAsync(progress => progress.UserId == userId && progress.IsCompleted && requiredStepIds.Contains(progress.StepId))
            == requiredStepIds.Count;

        var preferences = await _db.MatchPreferences
            .FirstOrDefaultAsync(preference => preference.UserId == userId && preference.TenantId == tenantId);
        var interests = await StatusInterestsAsync(preferences, tenantId);

        return Ok(new
        {
            data = new
            {
                onboarding_completed = completedRequired,
                has_avatar = !string.IsNullOrWhiteSpace(user.AvatarUrl),
                has_bio = !string.IsNullOrWhiteSpace(user.Bio),
                interests
            }
        });
    }

    /// <summary>
    /// POST /api/onboarding/complete - Mark a step as complete.
    /// </summary>
    [HttpPost("complete")]
    public async Task<IActionResult> CompleteStep([FromBody] CompleteStepRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.StepKey))
        {
            return await CompleteWizardAsync(userId.Value, request);
        }

        var (success, error) = await _onboarding.CompleteStepAsync(userId.Value, request.StepKey);
        if (!success) return BadRequest(new { error });
        return Ok(new { message = "Step completed" });
    }

    private async Task<IActionResult> CompleteWizardAsync(int userId, CompleteStepRequest request)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
        if (user == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(user.AvatarUrl))
        {
            return BadRequest(new { error = "Profile photo is required before completing onboarding." });
        }

        if (string.IsNullOrWhiteSpace(user.Bio) || user.Bio.Trim().Length < 10)
        {
            return BadRequest(new { error = "Bio must be at least 10 characters before completing onboarding." });
        }

        var categoryIds = request.AllCategoryIds().Distinct().ToList();
        var categories = categoryIds.Count == 0
            ? new List<Category>()
            : await _db.Categories
                .Where(c => categoryIds.Contains(c.Id) && c.IsActive)
                .ToListAsync();

        var validCategoryIds = categories.Select(c => c.Id).ToHashSet();
        if (categoryIds.Any(id => !validCategoryIds.Contains(id)))
        {
            return BadRequest(new { error = "One or more selected categories are invalid." });
        }

        await UpsertMatchPreferencesAsync(userId, tenantId, request, categories);
        var listingsCreated = await CreateStarterListingsAsync(userId, tenantId, request, categories);
        await CompleteRequiredStepsAsync(userId, tenantId);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            message = "Onboarding completed",
            listings_created = listingsCreated
        });
    }

    private async Task UpsertMatchPreferencesAsync(
        int userId,
        int tenantId,
        CompleteStepRequest request,
        List<Category> categories)
    {
        var preferences = await _db.MatchPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.TenantId == tenantId);

        if (preferences == null)
        {
            preferences = new MatchPreference
            {
                TenantId = tenantId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow
            };
            _db.MatchPreferences.Add(preferences);
        }

        preferences.PreferredCategories = System.Text.Json.JsonSerializer.Serialize(request.Interests.Distinct().ToArray());
        preferences.SkillsOffered = string.Join(",", CategoryNames(request.Offers, categories));
        preferences.SkillsWanted = string.Join(",", CategoryNames(request.Needs, categories));
        preferences.IsActive = true;
        preferences.UpdatedAt = DateTime.UtcNow;
    }

    private async Task<int> CreateStarterListingsAsync(
        int userId,
        int tenantId,
        CompleteStepRequest request,
        List<Category> categories)
    {
        var byId = categories.ToDictionary(c => c.Id);
        var created = 0;

        foreach (var categoryId in request.Offers.Distinct())
        {
            if (!byId.TryGetValue(categoryId, out var category)) continue;
            if (await HasListingAsync(userId, categoryId, ListingType.Offer)) continue;

            _db.Listings.Add(new Listing
            {
                TenantId = tenantId,
                UserId = userId,
                CategoryId = category.Id,
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                Title = $"Offering {category.Name}",
                Description = $"I can help with {category.Name}.",
                EstimatedHours = 1,
                CreatedAt = DateTime.UtcNow
            });
            created++;
        }

        foreach (var categoryId in request.Needs.Distinct())
        {
            if (!byId.TryGetValue(categoryId, out var category)) continue;
            if (await HasListingAsync(userId, categoryId, ListingType.Request)) continue;

            _db.Listings.Add(new Listing
            {
                TenantId = tenantId,
                UserId = userId,
                CategoryId = category.Id,
                Type = ListingType.Request,
                Status = ListingStatus.Active,
                Title = $"Need help with {category.Name}",
                Description = $"I would like help with {category.Name}.",
                EstimatedHours = 1,
                CreatedAt = DateTime.UtcNow
            });
            created++;
        }

        return created;
    }

    private Task<bool> HasListingAsync(int userId, int categoryId, ListingType type)
    {
        return _db.Listings.AnyAsync(l =>
            l.UserId == userId &&
            l.CategoryId == categoryId &&
            l.Type == type &&
            l.DeletedAt == null &&
            l.Status != ListingStatus.Cancelled &&
            l.Status != ListingStatus.Rejected);
    }

    private async Task CompleteRequiredStepsAsync(int userId, int tenantId)
    {
        var requiredSteps = await _db.OnboardingSteps
            .Where(s => s.TenantId == tenantId && s.IsRequired)
            .ToListAsync();

        foreach (var step in requiredSteps)
        {
            var progress = await _db.Set<OnboardingProgress>()
                .FirstOrDefaultAsync(p => p.UserId == userId && p.StepId == step.Id && p.TenantId == tenantId);

            if (progress == null)
            {
                _db.Set<OnboardingProgress>().Add(new OnboardingProgress
                {
                    TenantId = tenantId,
                    UserId = userId,
                    StepId = step.Id,
                    IsCompleted = true,
                    CompletedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                });
            }
            else
            {
                progress.IsCompleted = true;
                progress.CompletedAt = DateTime.UtcNow;
            }
        }
    }

    private static IEnumerable<string> CategoryNames(IEnumerable<int> ids, List<Category> categories)
    {
        var byId = categories.ToDictionary(c => c.Id);
        foreach (var id in ids.Distinct())
        {
            if (byId.TryGetValue(id, out var category))
            {
                yield return category.Name;
            }
        }
    }

    private static readonly (string Slug, bool Required)[] WizardSteps =
    [
        ("welcome", false),
        ("profile", true),
        ("interests", false),
        ("skills", false),
        ("safeguarding", false),
        ("confirm", true)
    ];

    private static Dictionary<string, object?> EffectiveConfig(IReadOnlyDictionary<string, string> stored)
    {
        var config = new Dictionary<string, object?>
        {
            ["enabled"] = true,
            ["mandatory"] = true,
            ["step_welcome_enabled"] = true,
            ["step_profile_enabled"] = true,
            ["step_profile_required"] = true,
            ["step_interests_enabled"] = true,
            ["step_interests_required"] = false,
            ["step_skills_enabled"] = true,
            ["step_skills_required"] = false,
            ["step_safeguarding_enabled"] = true,
            ["step_safeguarding_required"] = false,
            ["step_confirm_enabled"] = true,
            ["avatar_required"] = true,
            ["bio_required"] = true,
            ["bio_min_length"] = 10,
            ["listing_creation_mode"] = "disabled",
            ["listing_max_auto"] = 3,
            ["require_completion_for_visibility"] = false,
            ["require_avatar_for_visibility"] = false,
            ["require_bio_for_visibility"] = false,
            ["welcome_text"] = null,
            ["help_text"] = null,
            ["safeguarding_intro_text"] = null,
            ["country_preset"] = "custom"
        };

        foreach (var (fullKey, raw) in stored)
        {
            var key = fullKey["onboarding.".Length..];
            if (!config.TryGetValue(key, out var fallback)) continue;
            config[key] = fallback switch
            {
                bool => raw is "1" or "true" or "True",
                int => int.TryParse(raw, out var number) ? number : fallback,
                _ => raw
            };
        }

        return config;
    }

    private static bool Bool(object? value) => value is true;

    private async Task<List<object>> StatusInterestsAsync(MatchPreference? preferences, int tenantId)
    {
        var result = new List<object>();
        if (preferences == null) return result;

        try
        {
            foreach (var categoryId in System.Text.Json.JsonSerializer.Deserialize<int[]>(preferences.PreferredCategories ?? "[]") ?? [])
            {
                result.Add(new { category_id = categoryId, interest_type = "interest" });
            }
        }
        catch (System.Text.Json.JsonException)
        {
            // Corrupt preference JSON must not prevent onboarding recovery.
        }

        var categoryNames = new[] { preferences.SkillsOffered, preferences.SkillsWanted }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .SelectMany(value => value!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (categoryNames.Count == 0) return result;

        var categories = await _db.Categories
            .Where(category => category.TenantId == tenantId && categoryNames.Contains(category.Name))
            .ToDictionaryAsync(category => category.Name, category => category.Id);
        foreach (var name in (preferences.SkillsOffered ?? string.Empty).Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (categories.TryGetValue(name, out var id)) result.Add(new { category_id = id, interest_type = "skill_offer" });
        }
        foreach (var name in (preferences.SkillsWanted ?? string.Empty).Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (categories.TryGetValue(name, out var id)) result.Add(new { category_id = id, interest_type = "skill_need" });
        }
        return result;
    }

    /// <summary>
    /// POST /api/onboarding/reset - Reset onboarding progress.
    /// </summary>
    [HttpPost("reset")]
    public async Task<IActionResult> ResetProgress()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        await _onboarding.ResetProgressAsync(userId.Value);
        return Ok(new { message = "Progress reset" });
    }

    // Admin endpoints
    /// <summary>
    /// POST /api/onboarding/admin/steps - Create onboarding step.
    /// </summary>
    [HttpPost("admin/steps")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> CreateStep([FromBody] CreateOnboardingStepRequest request)
    {
        var (step, error) = await _onboarding.CreateStepAsync(
            request.Key, request.Title, request.Description,
            request.SortOrder, request.IsRequired, request.XpReward);
        if (error != null) return BadRequest(new { error });
        return Created($"/api/onboarding/steps", new { data = new { step!.Id, step.Key, step.Title } });
    }

    /// <summary>
    /// PUT /api/onboarding/admin/steps/{id} - Update step.
    /// </summary>
    [HttpPut("admin/steps/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> UpdateStep(int id, [FromBody] UpdateOnboardingStepRequest request)
    {
        var (step, error) = await _onboarding.UpdateStepAsync(
            id, request.Title, request.Description, request.SortOrder, request.IsRequired, request.XpReward);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { step!.Id, step.Key, step.Title } });
    }

    /// <summary>
    /// DELETE /api/onboarding/admin/steps/{id} - Delete step.
    /// </summary>
    [HttpDelete("admin/steps/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> DeleteStep(int id)
    {
        var error = await _onboarding.DeleteStepAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { message = "Step deleted" });
    }
}

public class CompleteStepRequest
{
    [JsonPropertyName("step_key")] public string StepKey { get; set; } = string.Empty;
    [JsonPropertyName("interests")] public List<int> Interests { get; set; } = new();
    [JsonPropertyName("offers")] public List<int> Offers { get; set; } = new();
    [JsonPropertyName("needs")] public List<int> Needs { get; set; } = new();

    public IEnumerable<int> AllCategoryIds() => Interests.Concat(Offers).Concat(Needs);
}

public class CreateOnboardingStepRequest
{
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("sort_order")] public int SortOrder { get; set; } = 0;
    [JsonPropertyName("is_required")] public bool IsRequired { get; set; } = false;
    [JsonPropertyName("xp_reward")] public int XpReward { get; set; } = 0;
}

public class UpdateOnboardingStepRequest
{
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("sort_order")] public int? SortOrder { get; set; }
    [JsonPropertyName("is_required")] public bool? IsRequired { get; set; }
    [JsonPropertyName("xp_reward")] public int? XpReward { get; set; }
}
