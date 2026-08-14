// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Partner venue directory, admin CRUD, and staff roster — Laravel parity for
/// App\Services\PartnerVenueService. The staff model, quoting the Laravel
/// docblock: "ANY active pivot row grants the right to record visits (till
/// staff need it), while 'owner'/'admin' additionally signal who the council
/// should contact. Roster management stays with tenant admins, so no
/// privilege escalation rides on the role value itself."
/// </summary>
public class PartnerVenueService
{
    public const string FeatureConfigKey = "features.partner_venues";
    public static readonly string[] PublicStatuses = [PartnerVenue.StatusActive];

    /// <summary>
    /// The role strings Laravel's PartnerVenueService::isTenantAdmin accepts —
    /// deliberately DIFFERENT from AdminTier: it includes tenant_super_admin,
    /// excludes god, and reads only the role string (never the boolean flags).
    /// Reproduced exactly so the same accounts may record visits on both
    /// backends.
    /// </summary>
    private static readonly string[] VisitRecorderAdminRoles =
        ["admin", "tenant_admin", "tenant_super_admin", "super_admin"];

    private readonly NexusDbContext _db;

    public PartnerVenueService(NexusDbContext db)
    {
        _db = db;
    }

    /// <summary>Default OFF: a missing tenant_configs row means disabled.</summary>
    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key == FeatureConfigKey)
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return raw is not null
            && raw.Trim().Trim('"').ToLowerInvariant() is "1" or "true" or "yes" or "on" or "enabled";
    }

    /// <summary>Member directory: active venues only, ordered by name.</summary>
    public async Task<List<object>> DirectoryAsync(CancellationToken ct)
    {
        var venues = await _db.PartnerVenues
            .AsNoTracking()
            .Where(v => v.Status == PartnerVenue.StatusActive)
            .OrderBy(v => v.Name)
            .ToListAsync(ct);
        return venues.Select(ToPublicObject).ToList();
    }

    /// <summary>
    /// Admin list: optional status filter, ordered by name, each row the
    /// public shape plus status, contact_email, and lifetime aggregates.
    /// </summary>
    public async Task<List<object>> AdminListAsync(string? status, CancellationToken ct)
    {
        var query = _db.PartnerVenues.AsNoTracking();
        if (status is not null && PartnerVenue.AllowedStatuses.Contains(status))
        {
            query = query.Where(v => v.Status == status);
        }

        var venues = await query.OrderBy(v => v.Name).ToListAsync(ct);
        var venueIds = venues.Select(v => v.Id).ToArray();

        var visitAggregates = await _db.PartnerVenueVisits
            .AsNoTracking()
            .Where(v => venueIds.Contains(v.VenueId))
            .GroupBy(v => v.VenueId)
            .Select(g => new
            {
                VenueId = g.Key,
                VisitCount = g.Count(),
                MemberCount = g.Select(v => v.UserId).Distinct().Count()
            })
            .ToDictionaryAsync(g => g.VenueId, ct);

        var staffCounts = await _db.PartnerVenueStaff
            .AsNoTracking()
            .Where(s => venueIds.Contains(s.VenueId) && s.Status == "active")
            .GroupBy(s => s.VenueId)
            .Select(g => new { VenueId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.VenueId, g => g.Count, ct);

        return venues.Select(v => (object)new
        {
            id = v.Id,
            name = v.Name,
            slug = v.Slug,
            description = v.Description,
            category = v.Category,
            offer_summary = v.OfferSummary,
            address_line = v.AddressLine,
            city = v.City,
            postcode = v.Postcode,
            latitude = ToNullableDouble(v.Latitude),
            longitude = ToNullableDouble(v.Longitude),
            website = v.Website,
            logo_url = v.LogoUrl,
            status = v.Status,
            contact_email = v.ContactEmail,
            visit_count = visitAggregates.TryGetValue(v.Id, out var agg) ? agg.VisitCount : 0,
            member_count = visitAggregates.TryGetValue(v.Id, out var agg2) ? agg2.MemberCount : 0,
            staff_count = staffCounts.TryGetValue(v.Id, out var staff) ? staff : 0
        }).ToList();
    }

    /// <summary>
    /// Laravel toPublicArray(): exactly these thirteen keys in this order —
    /// no status, no contact_email, no timestamps, no poster_token.
    /// </summary>
    public static object ToPublicObject(PartnerVenue v) => new
    {
        id = v.Id,
        name = v.Name,
        slug = v.Slug,
        description = v.Description,
        category = v.Category,
        offer_summary = v.OfferSummary,
        address_line = v.AddressLine,
        city = v.City,
        postcode = v.Postcode,
        latitude = ToNullableDouble(v.Latitude),
        longitude = ToNullableDouble(v.Longitude),
        website = v.Website,
        logo_url = v.LogoUrl
    };

    public async Task<PartnerVenue> CreateAsync(
        int tenantId, int actorId, PartnerVenue values, CancellationToken ct)
    {
        values.TenantId = tenantId;
        values.CreatedBy = actorId;
        values.Slug = await UniqueSlugAsync(tenantId, values.Name, null, ct);
        values.CreatedAt = DateTime.UtcNow;
        _db.PartnerVenues.Add(values);
        await _db.SaveChangesAsync(ct);
        return values;
    }

    public async Task<string> UniqueSlugAsync(
        int tenantId, string name, int? ignoreId, CancellationToken ct)
    {
        var baseSlug = Slugify(name);
        if (baseSlug.Length == 0) baseSlug = "venue";

        var slug = baseSlug;
        // Laravel's uniqueSlug ignores $ignoreId in its query too; the counter
        // walks -2, -3, ... until the tenant has no venue with that slug.
        for (var i = 2; await _db.PartnerVenues
                 .IgnoreQueryFilters()
                 .AnyAsync(v => v.TenantId == tenantId && v.Slug == slug, ct); i++)
        {
            slug = $"{baseSlug}-{i}";
        }

        return slug;
    }

    public static string Slugify(string value)
    {
        var chars = value.Trim().ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : '-')
            .ToArray();
        var collapsed = string.Join('-',
            new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
        return collapsed;
    }

    /// <summary>
    /// True when the user may record visits at this venue: any active staff
    /// row, or the Laravel visit-recorder admin role list.
    /// </summary>
    public async Task<bool> IsStaffOfAsync(int tenantId, int venueId, int userId, CancellationToken ct)
    {
        var isStaff = await _db.PartnerVenueStaff
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(s => s.TenantId == tenantId
                && s.VenueId == venueId
                && s.UserId == userId
                && s.Status == "active", ct);
        if (isStaff) return true;
        return await IsVisitRecorderAdminAsync(tenantId, userId, ct);
    }

    public async Task<bool> IsVisitRecorderAdminAsync(int tenantId, int userId, CancellationToken ct)
    {
        var role = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.Id == userId && u.TenantId == tenantId)
            .Select(u => u.Role)
            .FirstOrDefaultAsync(ct) ?? string.Empty;
        return VisitRecorderAdminRoles.Contains(role);
    }

    /// <summary>Ids of ACTIVE venues where this user may record visits.</summary>
    public async Task<List<int>> VenuesForStaffAsync(int tenantId, int userId, CancellationToken ct)
    {
        if (await IsVisitRecorderAdminAsync(tenantId, userId, ct))
        {
            return await _db.PartnerVenues
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(v => v.TenantId == tenantId && PublicStatuses.Contains(v.Status))
                .Select(v => v.Id)
                .ToListAsync(ct);
        }

        return await _db.PartnerVenueStaff
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId
                && s.UserId == userId
                && s.Status == "active"
                && _db.PartnerVenues
                    .IgnoreQueryFilters()
                    .Any(v => v.Id == s.VenueId
                        && v.TenantId == tenantId
                        && PublicStatuses.Contains(v.Status)))
            .Select(s => s.VenueId)
            .ToListAsync(ct);
    }

    /// <summary>
    /// Full roster including non-active rows, ordered by first name; row id is
    /// the roster row's own id (Laravel returns the pivot id).
    /// </summary>
    public async Task<List<object>> StaffListAsync(int venueId, CancellationToken ct)
    {
        var rows = await _db.PartnerVenueStaff
            .AsNoTracking()
            .Where(s => s.VenueId == venueId)
            .Join(_db.Users, s => s.UserId, u => u.Id, (s, u) => new
            {
                s.Id,
                s.UserId,
                u.FirstName,
                u.LastName,
                u.AvatarUrl,
                s.Role,
                s.Status
            })
            .OrderBy(row => row.FirstName)
            .ToListAsync(ct);

        return rows.Select(row => (object)new
        {
            id = row.Id,
            user_id = row.UserId,
            name = $"{row.FirstName} {row.LastName}".Trim(),
            avatar_url = row.AvatarUrl,
            role = row.Role,
            status = row.Status
        }).ToList();
    }

    /// <summary>
    /// Idempotent upsert: re-adding reactivates and updates the role. Returns
    /// false when the user does not belong to the tenant.
    /// </summary>
    public async Task<bool> AddStaffAsync(
        int tenantId, int venueId, int userId, string role, CancellationToken ct)
    {
        if (!PartnerVenueStaffMember.AllowedRoles.Contains(role)) role = "member";

        var userInTenant = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(u => u.Id == userId && u.TenantId == tenantId, ct);
        if (!userInTenant) return false;

        var existing = await _db.PartnerVenueStaff
            .FirstOrDefaultAsync(s => s.VenueId == venueId && s.UserId == userId, ct);
        if (existing is null)
        {
            _db.PartnerVenueStaff.Add(new PartnerVenueStaffMember
            {
                TenantId = tenantId,
                VenueId = venueId,
                UserId = userId,
                Role = role,
                Status = "active",
                CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.Role = role;
            existing.Status = "active";
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task RemoveStaffAsync(int venueId, int userId, CancellationToken ct)
    {
        await _db.PartnerVenueStaff
            .Where(s => s.VenueId == venueId && s.UserId == userId)
            .ExecuteDeleteAsync(ct);
    }

    private static double? ToNullableDouble(decimal? value) =>
        value.HasValue ? (double)value.Value : null;
}
