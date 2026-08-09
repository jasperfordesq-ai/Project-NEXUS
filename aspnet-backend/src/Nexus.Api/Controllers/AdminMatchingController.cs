// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin algorithm health dashboard endpoints.
/// </summary>
[ApiController]
[Route("api/admin/matching")]
[Authorize(Policy = "AdminOnly")]
public class AdminMatchingController : ControllerBase
{
    private readonly NexusDbContext _db;

    public AdminMatchingController(NexusDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// GET /api/admin/matching/stats - Matching algorithm statistics.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var totalMatches = await _db.Set<Entities.MatchResult>().CountAsync();
        var acceptedMatches = await _db.Set<Entities.MatchResult>()
            .CountAsync(m => m.Status == MatchStatus.Accepted);
        var avgScore = totalMatches > 0
            ? await _db.Set<Entities.MatchResult>().AverageAsync(m => m.Score)
            : 0;

        var totalPreferences = await _db.Set<Entities.MatchPreference>().CountAsync();

        return Ok(new
        {
            data = new
            {
                total_matches = totalMatches,
                accepted_matches = acceptedMatches,
                acceptance_rate = totalMatches > 0 ? Math.Round((double)acceptedMatches / totalMatches * 100, 1) : 0,
                average_score = Math.Round(avgScore, 2),
                users_with_preferences = totalPreferences
            }
        });
    }

    /// <summary>
    /// GET /api/admin/matching/health - Algorithm health dashboard.
    /// </summary>
    [HttpGet("health")]
    public async Task<IActionResult> GetHealth()
    {
        var last7Days = DateTime.UtcNow.AddDays(-7);
        var recentMatches = await _db.Set<Entities.MatchResult>()
            .CountAsync(m => m.CreatedAt >= last7Days);
        var recentAccepted = await _db.Set<Entities.MatchResult>()
            .CountAsync(m => m.CreatedAt >= last7Days && m.Status == MatchStatus.Accepted);

        var totalSkills = await _db.Set<Entities.UserSkill>().CountAsync();
        var totalListings = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Active);
        var totalExchanges = await _db.Set<Entities.Exchange>()
            .CountAsync(e => e.Status == Entities.ExchangeStatus.Completed);

        return Ok(new
        {
            data = new
            {
                matches_last_7_days = recentMatches,
                acceptance_rate_7d = recentMatches > 0 ? Math.Round((double)recentAccepted / recentMatches * 100, 1) : 0,
                active_listings = totalListings,
                total_skills_registered = totalSkills,
                completed_exchanges = totalExchanges,
                health_status = recentMatches > 0 ? "healthy" : "inactive"
            }
        });
    }
}
