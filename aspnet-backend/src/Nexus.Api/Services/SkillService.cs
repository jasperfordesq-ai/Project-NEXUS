// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing skills, user skill profiles, and endorsements.
/// Phase 23: Endorsements & Skills.
/// </summary>
public class SkillService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamification;
    private readonly ILogger<SkillService> _logger;

    public SkillService(
        NexusDbContext db,
        TenantContext tenantContext,
        GamificationService gamification,
        ILogger<SkillService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _gamification = gamification;
        _logger = logger;
    }

    /// <summary>
    /// Get the skill catalog with optional search and pagination.
    /// </summary>
    public async Task<(List<object> Data, int Total)> GetSkillCatalogAsync(int page, int limit, string? search)
    {
        var query = _db.Set<Skill>().AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(s => s.Name.ToLower().Contains(term)
                || (s.Description != null && s.Description.ToLower().Contains(term)));
        }

        var total = await query.CountAsync();

        var skills = await query
            .OrderBy(s => s.Name)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(s => (object)new
            {
                s.Id,
                s.Name,
                s.Slug,
                s.Description,
                category_id = s.CategoryId,
                category_name = s.Category != null ? s.Category.Name : null,
                is_verifiable = s.IsVerifiable,
                created_at = s.CreatedAt
            })
            .ToListAsync();

        return (skills, total);
    }

    /// <summary>
    /// Get all skills for a specific user with endorsement counts.
    /// </summary>
    public async Task<List<object>> GetUserSkillsAsync(int userId)
    {
        var skills = await _db.Set<UserSkill>()
            .AsNoTracking()
            .Where(us => us.UserId == userId)
            .OrderByDescending(us => us.EndorsementCount)
            .ThenBy(us => us.Skill!.Name)
            .Select(us => (object)new
            {
                skill_id = us.SkillId,
                skill_name = us.Skill!.Name,
                skill_slug = us.Skill.Slug,
                proficiency_level = us.ProficiencyLevel.ToString().ToLower(),
                is_verified = us.IsVerified,
                endorsement_count = us.EndorsementCount,
                created_at = us.CreatedAt,
                updated_at = us.UpdatedAt
            })
            .ToListAsync();

        return skills;
    }

    /// <summary>
    /// Add a skill to the current user's profile.
    /// </summary>
    public async Task<(bool Success, string? Error, object? Data)> AddSkillAsync(int userId, int skillId, SkillLevel proficiencyLevel)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Verify skill exists
        var skill = await _db.Set<Skill>().FirstOrDefaultAsync(s => s.Id == skillId);
        if (skill == null)
        {
            return (false, "Skill not found", null);
        }

        // Check if user already has this skill
        var existing = await _db.Set<UserSkill>()
            .FirstOrDefaultAsync(us => us.UserId == userId && us.SkillId == skillId);
        if (existing != null)
        {
            return (false, "You already have this skill on your profile", null);
        }

        var userSkill = new UserSkill
        {
            TenantId = tenantId,
            UserId = userId,
            SkillId = skillId,
            ProficiencyLevel = proficiencyLevel
        };

        _db.Set<UserSkill>().Add(userSkill);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return (false, "Skill already added to your profile", null);
        }

        // Award XP for adding a skill
        await _gamification.AwardXpAsync(userId, 5, "skill_added", userSkill.Id, $"Added skill: {skill.Name}");

        _logger.LogInformation("User {UserId} added skill {SkillId} ({SkillName})", userId, skillId, skill.Name);

        return (true, null, new
        {
            skill_id = userSkill.SkillId,
            skill_name = skill.Name,
            skill_slug = skill.Slug,
            proficiency_level = userSkill.ProficiencyLevel.ToString().ToLower(),
            is_verified = userSkill.IsVerified,
            endorsement_count = userSkill.EndorsementCount,
            created_at = userSkill.CreatedAt
        });
    }

    /// <summary>
    /// Remove a skill from the current user's profile.
    /// </summary>
    public async Task<(bool Success, string? Error)> RemoveSkillAsync(int userId, int skillId)
    {
        var userSkill = await _db.Set<UserSkill>()
            .Include(us => us.Endorsements)
            .FirstOrDefaultAsync(us => us.UserId == userId && us.SkillId == skillId);

        if (userSkill == null)
        {
            return (false, "Skill not found on your profile");
        }

        // Remove all endorsements for this user skill
        if (userSkill.Endorsements.Count > 0)
        {
            _db.Set<Endorsement>().RemoveRange(userSkill.Endorsements);
        }

        _db.Set<UserSkill>().Remove(userSkill);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} removed skill {SkillId}", userId, skillId);

        return (true, null);
    }

    /// <summary>
    /// Update the proficiency level for a skill on the user's profile.
    /// </summary>
    public async Task<(bool Success, string? Error, object? Data)> UpdateProficiencyAsync(int userId, int skillId, SkillLevel newLevel)
    {
        var userSkill = await _db.Set<UserSkill>()
            .Include(us => us.Skill)
            .FirstOrDefaultAsync(us => us.UserId == userId && us.SkillId == skillId);

        if (userSkill == null)
        {
            return (false, "Skill not found on your profile", null);
        }

        userSkill.ProficiencyLevel = newLevel;
        userSkill.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} updated skill {SkillId} proficiency to {Level}", userId, skillId, newLevel);

        return (true, null, new
        {
            skill_id = userSkill.SkillId,
            skill_name = userSkill.Skill!.Name,
            proficiency_level = userSkill.ProficiencyLevel.ToString().ToLower(),
            is_verified = userSkill.IsVerified,
            endorsement_count = userSkill.EndorsementCount,
            updated_at = userSkill.UpdatedAt
        });
    }

    /// <summary>
    /// Endorse a user's skill. Auto-verifies after 3 endorsements.
    /// </summary>
    public async Task<(bool Success, string? Error, object? Data)> EndorseSkillAsync(int endorserId, int userId, int skillId, string? comment)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Cannot endorse yourself
        if (endorserId == userId)
        {
            return (false, "You cannot endorse your own skill", null);
        }

        // Find the user's skill
        var userSkill = await _db.Set<UserSkill>()
            .Include(us => us.Skill)
            .FirstOrDefaultAsync(us => us.UserId == userId && us.SkillId == skillId);

        if (userSkill == null)
        {
            return (false, "User does not have this skill on their profile", null);
        }

        // Check if already endorsed
        var existing = await _db.Set<Endorsement>()
            .FirstOrDefaultAsync(e => e.UserSkillId == userSkill.Id && e.EndorserId == endorserId);

        if (existing != null)
        {
            return (false, "You have already endorsed this skill", null);
        }

        var endorsement = new Endorsement
        {
            TenantId = tenantId,
            UserSkillId = userSkill.Id,
            EndorserId = endorserId,
            EndorsedUserId = userId,
            Comment = comment
        };

        _db.Set<Endorsement>().Add(endorsement);

        // Increment endorsement count
        userSkill.EndorsementCount += 1;
        userSkill.UpdatedAt = DateTime.UtcNow;

        // Auto-verify after 3 endorsements
        if (userSkill.EndorsementCount >= 3 && !userSkill.IsVerified)
        {
            userSkill.IsVerified = true;
            _logger.LogInformation("User {UserId} skill {SkillId} ({SkillName}) auto-verified with {Count} endorsements",
                userId, skillId, userSkill.Skill!.Name, userSkill.EndorsementCount);
        }

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return (false, "You have already endorsed this skill", null);
        }

        // Award XP to the endorser for endorsing
        await _gamification.AwardXpAsync(endorserId, 5, "endorsement_given", endorsement.Id, $"Endorsed {userSkill.Skill!.Name}");

        // Award XP to the endorsed user
        await _gamification.AwardXpAsync(userId, 10, "endorsement_received", endorsement.Id, $"Received endorsement for {userSkill.Skill.Name}");

        _logger.LogInformation("User {EndorserId} endorsed user {UserId} for skill {SkillId}", endorserId, userId, skillId);

        return (true, null, new
        {
            endorsement_id = endorsement.Id,
            skill_name = userSkill.Skill.Name,
            endorsement_count = userSkill.EndorsementCount,
            is_verified = userSkill.IsVerified,
            created_at = endorsement.CreatedAt
        });
    }

    /// <summary>
    /// Remove an endorsement previously given.
    /// </summary>
    public async Task<(bool Success, string? Error)> RemoveEndorsementAsync(int endorserId, int userId, int skillId)
    {
        var userSkill = await _db.Set<UserSkill>()
            .FirstOrDefaultAsync(us => us.UserId == userId && us.SkillId == skillId);

        if (userSkill == null)
        {
            return (false, "User skill not found");
        }

        var endorsement = await _db.Set<Endorsement>()
            .FirstOrDefaultAsync(e => e.UserSkillId == userSkill.Id && e.EndorserId == endorserId);

        if (endorsement == null)
        {
            return (false, "Endorsement not found");
        }

        _db.Set<Endorsement>().Remove(endorsement);

        // Decrement count
        userSkill.EndorsementCount = Math.Max(0, userSkill.EndorsementCount - 1);
        userSkill.UpdatedAt = DateTime.UtcNow;

        // Re-check verification status if below threshold
        if (userSkill.EndorsementCount < 3)
        {
            userSkill.IsVerified = false;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("User {EndorserId} removed endorsement for user {UserId} skill {SkillId}", endorserId, userId, skillId);

        return (true, null);
    }

    /// <summary>
    /// Get all endorsements for a specific user's skill.
    /// </summary>
    public async Task<(bool Success, string? Error, object? Data)> GetEndorsementsAsync(int userId, int skillId)
    {
        var userSkill = await _db.Set<UserSkill>()
            .AsNoTracking()
            .Include(us => us.Skill)
            .FirstOrDefaultAsync(us => us.UserId == userId && us.SkillId == skillId);

        if (userSkill == null)
        {
            return (false, "User skill not found", null);
        }

        var endorsements = await _db.Set<Endorsement>()
            .AsNoTracking()
            .Where(e => e.UserSkillId == userSkill.Id)
            .OrderByDescending(e => e.CreatedAt)
            .Select(e => new
            {
                e.Id,
                endorser = new
                {
                    id = e.EndorserId,
                    first_name = e.Endorser!.FirstName,
                    last_name = e.Endorser.LastName
                },
                e.Comment,
                created_at = e.CreatedAt
            })
            .ToListAsync();

        return (true, null, new
        {
            skill_name = userSkill.Skill!.Name,
            endorsement_count = userSkill.EndorsementCount,
            is_verified = userSkill.IsVerified,
            endorsements
        });
    }

    /// <summary>
    /// Get users with the most endorsements, optionally filtered by skill.
    /// </summary>
    public async Task<List<object>> GetTopEndorsedUsersAsync(int? skillId, int limit)
    {
        var query = _db.Set<UserSkill>()
            .AsNoTracking()
            .Where(us => us.EndorsementCount > 0);

        if (skillId.HasValue)
        {
            query = query.Where(us => us.SkillId == skillId.Value);
        }

        // Group by user and sum endorsements across all their skills
        var topUsers = await query
            .GroupBy(us => us.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                TotalEndorsements = g.Sum(us => us.EndorsementCount),
                VerifiedSkillCount = g.Count(us => us.IsVerified),
                SkillCount = g.Count()
            })
            .OrderByDescending(x => x.TotalEndorsements)
            .Take(limit)
            .ToListAsync();

        var userIds = topUsers.Select(x => x.UserId).ToList();
        var users = await _db.Users
            .AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        var result = topUsers
            .Select((x, index) => (object)new
            {
                rank = index + 1,
                user = new
                {
                    id = x.UserId,
                    first_name = users.TryGetValue(x.UserId, out var u) ? u.FirstName : "",
                    last_name = users.TryGetValue(x.UserId, out var u2) ? u2.LastName : ""
                },
                total_endorsements = x.TotalEndorsements,
                verified_skills = x.VerifiedSkillCount,
                skill_count = x.SkillCount
            })
            .ToList();

        return result;
    }

    /// <summary>
    /// Suggest skills for a user based on their listing categories.
    /// </summary>
    public async Task<List<object>> SuggestSkillsAsync(int userId)
    {
        // Get category IDs from user's listings
        var userCategoryIds = await _db.Listings
            .AsNoTracking()
            .Where(l => l.UserId == userId && l.CategoryId != null)
            .Select(l => l.CategoryId!.Value)
            .Distinct()
            .ToListAsync();

        // Get skills the user already has
        var existingSkillIds = await _db.Set<UserSkill>()
            .AsNoTracking()
            .Where(us => us.UserId == userId)
            .Select(us => us.SkillId)
            .ToListAsync();

        // Suggest skills in matching categories that user doesn't have yet
        var suggestions = new List<object>();

        if (userCategoryIds.Count > 0)
        {
            var categorySkills = await _db.Set<Skill>()
                .AsNoTracking()
                .Where(s => s.CategoryId != null
                    && userCategoryIds.Contains(s.CategoryId.Value)
                    && !existingSkillIds.Contains(s.Id))
                .OrderBy(s => s.Name)
                .Take(10)
                .Select(s => (object)new
                {
                    s.Id,
                    s.Name,
                    s.Slug,
                    s.Description,
                    category_name = s.Category != null ? s.Category.Name : null,
                    reason = "Based on your listing categories"
                })
                .ToListAsync();

            suggestions.AddRange(categorySkills);
        }

        // If not enough suggestions, add popular skills the user doesn't have
        if (suggestions.Count < 10)
        {
            var remaining = 10 - suggestions.Count;
            var suggestedIds = suggestions.Count > 0
                ? suggestions.Select(s => (int)((dynamic)s).Id).ToList()
                : new List<int>();

            var popularSkills = await _db.Set<UserSkill>()
                .AsNoTracking()
                .Where(us => !existingSkillIds.Contains(us.SkillId)
                    && !suggestedIds.Contains(us.SkillId))
                .GroupBy(us => us.SkillId)
                .Select(g => new { SkillId = g.Key, Count = g.Count() })
                .OrderByDescending(x => x.Count)
                .Take(remaining)
                .ToListAsync();

            var popularSkillIds = popularSkills.Select(x => x.SkillId).ToList();
            var skills = await _db.Set<Skill>()
                .AsNoTracking()
                .Where(s => popularSkillIds.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id);

            foreach (var ps in popularSkills)
            {
                if (skills.TryGetValue(ps.SkillId, out var skill))
                {
                    suggestions.Add(new
                    {
                        skill.Id,
                        skill.Name,
                        skill.Slug,
                        skill.Description,
                        category_name = (string?)null,
                        reason = $"Popular skill ({ps.Count} users)"
                    });
                }
            }
        }

        return suggestions;
    }
}
