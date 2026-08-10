// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing verification badges.
/// Verification badges are admin-awarded trust indicators (e.g., ID verified, DBS checked).
/// Distinct from gamification badges which are earned through activity.
/// </summary>
public class VerificationBadgeService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<VerificationBadgeService> _logger;

    public VerificationBadgeService(NexusDbContext db, ILogger<VerificationBadgeService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Get all available verification badge types.
    /// </summary>
    public async Task<List<VerificationBadgeType>> GetBadgeTypesAsync()
    {
        return await _db.VerificationBadgeTypes
            .Where(t => t.IsActive)
            .OrderBy(t => t.SortOrder)
            .ToListAsync();
    }

    /// <summary>
    /// Get verification badges earned by a user.
    /// </summary>
    public async Task<List<UserVerificationBadge>> GetUserBadgesAsync(int userId)
    {
        return await _db.UserVerificationBadges
            .Include(b => b.BadgeType)
            .Include(b => b.AwardedBy)
            .Where(b => b.UserId == userId)
            .OrderByDescending(b => b.AwardedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Award a verification badge to a user.
    /// </summary>
    public async Task<(UserVerificationBadge? Badge, string? Error)> AwardBadgeAsync(
        int tenantId, int userId, int badgeTypeId, int? awardedById, string? notes, DateTime? expiresAt)
    {
        // Verify badge type exists
        var badgeType = await _db.VerificationBadgeTypes.FirstOrDefaultAsync(t => t.Id == badgeTypeId && t.IsActive);
        if (badgeType == null)
            return (null, "Badge type not found");

        // Verify user exists
        var userExists = await _db.Users.AnyAsync(u => u.Id == userId);
        if (!userExists)
            return (null, "User not found");

        // Check if user already has this badge type (active, non-expired)
        var existing = await _db.UserVerificationBadges
            .AnyAsync(b => b.UserId == userId && b.BadgeTypeId == badgeTypeId
                        && (b.ExpiresAt == null || b.ExpiresAt > DateTime.UtcNow));
        if (existing)
            return (null, "User already has this verification badge");

        var badge = new UserVerificationBadge
        {
            TenantId = tenantId,
            UserId = userId,
            BadgeTypeId = badgeTypeId,
            AwardedById = awardedById,
            Notes = notes,
            ExpiresAt = expiresAt,
            AwardedAt = DateTime.UtcNow
        };

        _db.UserVerificationBadges.Add(badge);
        await _db.SaveChangesAsync();

        // Load navigation properties for response
        await _db.Entry(badge).Reference(b => b.BadgeType).LoadAsync();
        await _db.Entry(badge).Reference(b => b.AwardedBy).LoadAsync();

        _logger.LogInformation(
            "Verification badge {BadgeTypeId} ({BadgeName}) awarded to user {UserId} by {AwardedById}",
            badgeTypeId, badgeType.Name, userId, awardedById);

        return (badge, null);
    }

    /// <summary>
    /// Revoke a verification badge from a user.
    /// </summary>
    public async Task<(bool Success, string? Error)> RevokeBadgeAsync(int id, int userId)
    {
        var badge = await _db.UserVerificationBadges
            .FirstOrDefaultAsync(b => b.Id == id && b.UserId == userId);

        if (badge == null)
            return (false, "Badge not found");

        _db.UserVerificationBadges.Remove(badge);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Verification badge {BadgeId} revoked from user {UserId}", id, userId);

        return (true, null);
    }
}
