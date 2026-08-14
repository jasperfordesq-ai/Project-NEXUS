// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Member pass issuing/rotation and staff-scanned visit recording — Laravel
/// parity for App\Services\PartnerVenueVisitService. The recordVisit rule
/// ladder is reproduced in the exact Laravel order, including the database
/// unique key treating a same-day rescan as already_recorded_today rather
/// than an error, and the self-attestation block.
/// </summary>
public class PartnerVenueVisitService
{
    public const string EngagementAction = "venue_visit";

    private readonly NexusDbContext _db;
    private readonly PartnerVenueService _venues;
    private readonly GamificationService _gamification;
    private readonly ChallengeService _challenges;
    private readonly ILogger<PartnerVenueVisitService> _logger;

    public PartnerVenueVisitService(
        NexusDbContext db,
        PartnerVenueService venues,
        GamificationService gamification,
        ChallengeService challenges,
        ILogger<PartnerVenueVisitService> logger)
    {
        _db = db;
        _venues = venues;
        _gamification = gamification;
        _challenges = challenges;
        _logger = logger;
    }

    public sealed record PassView(string Token, string QrUrl, string Status, string? LastUsedAt);

    /// <summary>
    /// One pass per (tenant, user), created lazily. A non-active pass found by
    /// its owner is flipped back to active. The unique index on
    /// (tenant_id, user_id) serialises the check-then-insert race: a losing
    /// writer re-reads the winner's row.
    /// </summary>
    public async Task<PassView> GetOrCreatePassAsync(
        int tenantId, int userId, string checkinBaseUrl, CancellationToken ct)
    {
        var pass = await FindPassAsync(tenantId, userId, ct);
        if (pass is null)
        {
            pass = new PartnerMemberPass
            {
                TenantId = tenantId,
                UserId = userId,
                Token = NewToken(),
                Status = PartnerMemberPass.StatusActive,
                CreatedAt = DateTime.UtcNow
            };
            _db.PartnerMemberPasses.Add(pass);
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                _db.Entry(pass).State = EntityState.Detached;
                pass = await FindPassAsync(tenantId, userId, ct)
                    ?? throw new InvalidOperationException("Pass row vanished after unique-key race.");
            }
        }

        if (pass.Status != PartnerMemberPass.StatusActive)
        {
            pass.Status = PartnerMemberPass.StatusActive;
            pass.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        return ToPassView(pass, checkinBaseUrl);
    }

    /// <summary>
    /// Rotates the token in place — same row, fresh 64-hex token, status
    /// forced active. The old token stops resolving immediately;
    /// last_used_at is deliberately NOT reset.
    /// </summary>
    public async Task<PassView> RotatePassAsync(
        int tenantId, int userId, string checkinBaseUrl, CancellationToken ct)
    {
        await GetOrCreatePassAsync(tenantId, userId, checkinBaseUrl, ct);
        var pass = await FindPassAsync(tenantId, userId, ct)
            ?? throw new InvalidOperationException("Pass row missing after get-or-create.");
        pass.Token = NewToken();
        pass.Status = PartnerMemberPass.StatusActive;
        pass.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return ToPassView(pass, checkinBaseUrl);
    }

    public async Task<List<object>> MyVisitsAsync(int userId, int limit, CancellationToken ct)
    {
        limit = Math.Max(1, Math.Min(limit, 200));
        var rows = await _db.PartnerVenueVisits
            .AsNoTracking()
            .Where(v => v.UserId == userId)
            .Join(_db.PartnerVenues.IgnoreQueryFilters(), v => v.VenueId, venue => venue.Id,
                (v, venue) => new
                {
                    v.Id,
                    v.VenueId,
                    VenueName = venue.Name,
                    venue.Category,
                    v.VisitedOn,
                    v.VisitedAt
                })
            .OrderByDescending(row => row.VisitedAt)
            .Take(limit)
            .ToListAsync(ct);

        return rows.Select(row => (object)new
        {
            id = row.Id,
            venue_id = row.VenueId,
            venue_name = row.VenueName,
            category = row.Category,
            visited_on = row.VisitedOn.ToString("yyyy-MM-dd"),
            visited_at = row.VisitedAt
        }).ToList();
    }

    public sealed record RecordVisitResult(string Status, object? Payload);

    /// <summary>
    /// The Laravel rule ladder, in order: invalid pass → 404; scanner with no
    /// eligible venues, wrong venue, inactive venue, or self-scan → forbidden;
    /// several eligible venues and none chosen → needs_venue; then insert with
    /// the daily unique key deciding recorded vs already_recorded_today.
    /// XP and challenge progress move only on a genuinely new visit.
    /// </summary>
    public async Task<RecordVisitResult> RecordVisitAsync(
        int tenantId, string token, int staffUserId, int? venueId, CancellationToken ct)
    {
        var pass = await _db.PartnerMemberPasses
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId
                && p.Token == token
                && p.Status == PartnerMemberPass.StatusActive, ct);
        if (pass is null) return new RecordVisitResult("invalid_pass", null);

        var memberId = pass.UserId;
        var eligible = await _venues.VenuesForStaffAsync(tenantId, staffUserId, ct);
        if (eligible.Count == 0) return new RecordVisitResult("forbidden", null);

        if (venueId.HasValue)
        {
            if (!eligible.Contains(venueId.Value)) return new RecordVisitResult("forbidden", null);
        }
        else if (eligible.Count == 1)
        {
            venueId = eligible[0];
        }
        else
        {
            var choices = await _db.PartnerVenues
                .AsNoTracking()
                .Where(v => eligible.Contains(v.Id))
                .OrderBy(v => v.Name)
                .Select(v => new { id = v.Id, name = v.Name })
                .ToListAsync(ct);
            return new RecordVisitResult("needs_venue", new
            {
                status = "needs_venue",
                venues = choices
            });
        }

        var venue = await _db.PartnerVenues
            .AsNoTracking()
            .FirstOrDefaultAsync(v => v.Id == venueId.Value, ct);
        if (venue is null || venue.Status != PartnerVenue.StatusActive)
        {
            return new RecordVisitResult("forbidden", null);
        }

        // A self-recorded visit would make the ledger self-attested.
        if (memberId == staffUserId) return new RecordVisitResult("forbidden", null);

        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var created = true;
        var visit = new PartnerVenueVisit
        {
            TenantId = tenantId,
            VenueId = venue.Id,
            UserId = memberId,
            RecordedByUserId = staffUserId,
            Source = PartnerVenueVisit.SourceMemberPass,
            VisitedOn = today,
            VisitedAt = now,
            CreatedAt = now
        };
        _db.PartnerVenueVisits.Add(visit);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The daily unique key fired: same member, venue, and day.
            _db.Entry(visit).State = EntityState.Detached;
            created = false;
        }

        pass.LastUsedAt = now;
        pass.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        var xpAwarded = 0;
        var completedChallenges = new List<object>();
        if (created)
        {
            try
            {
                var award = await _gamification.AwardXpAsync(
                    memberId, XpLog.Amounts.VenueVisit, XpLog.Sources.VenueVisit,
                    venue.Id, $"Visited {venue.Name}");
                if (award.Success) xpAwarded = XpLog.Amounts.VenueVisit;
                var completions = await _challenges.UpdateProgressAsync(memberId, EngagementAction);
                completedChallenges = completions
                    .Select(c => (object)new { id = c.Id, title = c.Title, xp_reward = c.XpReward })
                    .ToList();
            }
            catch (Exception ex)
            {
                // Engagement side effects must never fail the recorded visit.
                _logger.LogWarning(ex, "[PartnerVenues] engagement update failed for user {UserId}", memberId);
            }
        }

        var member = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.Id == memberId && u.TenantId == tenantId)
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.AvatarUrl })
            .FirstOrDefaultAsync(ct);

        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var visitsThisMonth = await _db.PartnerVenueVisits
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(v => v.TenantId == tenantId
                && v.UserId == memberId
                && v.VisitedOn >= monthStart, ct);

        return new RecordVisitResult(created ? "recorded" : "already_recorded_today", new
        {
            status = created ? "recorded" : "already_recorded_today",
            member = member is null ? null : new
            {
                id = member.Id,
                name = $"{member.FirstName} {member.LastName}".Trim(),
                avatar_url = member.AvatarUrl
            },
            venue = new { id = venue.Id, name = venue.Name },
            visits_this_month = visitsThisMonth,
            xp_awarded = xpAwarded,
            completed_challenges = completedChallenges
        });
    }

    /// <summary>
    /// Laravel summary(): total_visits and unique_members are LIFETIME; only
    /// recent_visits honours the window. window_days echoes the raw request
    /// value while the SQL clamps to 1..365. Ordered by total_visits desc.
    /// </summary>
    public async Task<object> SummaryAsync(int days, CancellationToken ct)
    {
        var clamped = Math.Max(1, Math.Min(days, 365));
        var since = DateTime.UtcNow.Date.AddDays(-clamped);

        var perVenue = await _db.PartnerVenueVisits
            .AsNoTracking()
            .GroupBy(v => v.VenueId)
            .Select(g => new
            {
                VenueId = g.Key,
                TotalVisits = g.Count(),
                UniqueMembers = g.Select(v => v.UserId).Distinct().Count(),
                RecentVisits = g.Count(v => v.VisitedAt >= since)
            })
            .ToListAsync(ct);

        var names = await _db.PartnerVenues
            .AsNoTracking()
            .Where(v => perVenue.Select(p => p.VenueId).Contains(v.Id))
            .ToDictionaryAsync(v => v.Id, v => v.Name, ct);

        var venues = perVenue
            .OrderByDescending(p => p.TotalVisits)
            .Select(p => new
            {
                venue_id = p.VenueId,
                venue_name = names.TryGetValue(p.VenueId, out var name) ? name : string.Empty,
                total_visits = p.TotalVisits,
                unique_members = p.UniqueMembers,
                recent_visits = p.RecentVisits
            })
            .ToList();

        return new
        {
            window_days = days,
            total_visits = venues.Sum(v => v.total_visits),
            venues
        };
    }

    public sealed record VisitRow(
        long Id, string VisitedOn, string VisitedAt, string VenueName,
        int MemberId, string MemberName, string RecordedBy, string Source);

    public async Task<List<VisitRow>> VisitRowsAsync(
        int? venueId, DateOnly? from, DateOnly? to, CancellationToken ct, int limit = 5000)
    {
        limit = Math.Max(1, Math.Min(limit, 20000));
        var query = _db.PartnerVenueVisits.AsNoTracking();
        if (venueId.HasValue) query = query.Where(v => v.VenueId == venueId.Value);
        if (from.HasValue) query = query.Where(v => v.VisitedOn >= from.Value);
        if (to.HasValue) query = query.Where(v => v.VisitedOn <= to.Value);

        var rows = await query
            .OrderByDescending(v => v.VisitedAt)
            .Take(limit)
            .Select(v => new
            {
                v.Id,
                v.VisitedOn,
                v.VisitedAt,
                VenueName = _db.PartnerVenues.IgnoreQueryFilters()
                    .Where(venue => venue.Id == v.VenueId)
                    .Select(venue => venue.Name)
                    .FirstOrDefault(),
                v.UserId,
                MemberFirst = _db.Users.IgnoreQueryFilters()
                    .Where(u => u.Id == v.UserId && u.TenantId == v.TenantId)
                    .Select(u => u.FirstName).FirstOrDefault(),
                MemberLast = _db.Users.IgnoreQueryFilters()
                    .Where(u => u.Id == v.UserId && u.TenantId == v.TenantId)
                    .Select(u => u.LastName).FirstOrDefault(),
                RecorderFirst = _db.Users.IgnoreQueryFilters()
                    .Where(u => u.Id == v.RecordedByUserId && u.TenantId == v.TenantId)
                    .Select(u => u.FirstName).FirstOrDefault(),
                RecorderLast = _db.Users.IgnoreQueryFilters()
                    .Where(u => u.Id == v.RecordedByUserId && u.TenantId == v.TenantId)
                    .Select(u => u.LastName).FirstOrDefault(),
                v.Source
            })
            .ToListAsync(ct);

        return rows.Select(r => new VisitRow(
            r.Id,
            r.VisitedOn.ToString("yyyy-MM-dd"),
            r.VisitedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty,
            r.VenueName ?? string.Empty,
            r.UserId,
            $"{r.MemberFirst} {r.MemberLast}".Trim(),
            $"{r.RecorderFirst} {r.RecorderLast}".Trim(),
            r.Source)).ToList();
    }

    private async Task<PartnerMemberPass?> FindPassAsync(int tenantId, int userId, CancellationToken ct)
    {
        return await _db.PartnerMemberPasses
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId, ct);
    }

    private static PassView ToPassView(PartnerMemberPass pass, string checkinBaseUrl) => new(
        pass.Token,
        checkinBaseUrl.TrimEnd('/') + "/" + pass.Token,
        pass.Status,
        pass.LastUsedAt?.ToString("yyyy-MM-dd'T'HH:mm:ssK"));

    /// <summary>64 lowercase hex chars — bin2hex(random_bytes(32)) parity.</summary>
    private static string NewToken() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
}
