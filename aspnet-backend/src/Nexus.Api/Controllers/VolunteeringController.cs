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
/// Volunteering controller - manages volunteer opportunities, shifts, applications, and check-ins.
/// </summary>
[ApiController]
[Route("api/volunteering")]
[Authorize]
public class VolunteeringController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly VolunteerService _volunteerService;
    private readonly ILogger<VolunteeringController> _logger;

    public VolunteeringController(NexusDbContext db, VolunteerService volunteerService, ILogger<VolunteeringController> logger)
    {
        _db = db;
        _volunteerService = volunteerService;
        _logger = logger;
    }

    // === Opportunities ===

    /// <summary>
    /// List volunteer opportunities with pagination and filters.
    /// </summary>
    [HttpGet("opportunities")]
    public async Task<IActionResult> ListOpportunities(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] int? per_page = null,
        [FromQuery] string? cursor = null,
        [FromQuery] string? status = null,
        [FromQuery] int? category_id = null,
        [FromQuery] int? organization_id = null,
        [FromQuery] int? group_id = null,
        [FromQuery] string? search = null,
        [FromQuery] string? is_remote = null,
        [FromQuery] double? near_lat = null,
        [FromQuery] double? near_lng = null,
        [FromQuery] double? radius_km = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        // Laravel reads `per_page` (1-50, default 20) on this route and never
        // reads `limit`; the React volunteering page only ever sends `per_page`
        // plus `cursor`. `limit` is kept as an accepted alias for existing
        // internal callers, but `per_page` wins when both are present —
        // otherwise the page silently gets 20 rows whatever it asks for.
        limit = per_page.HasValue ? Math.Clamp(per_page.Value, 1, 50) : Math.Clamp(limit, 1, 100);

        var query = _db.VolunteerOpportunities.AsQueryable();

        // By default, only show published opportunities (unless filtering by status)
        if (!string.IsNullOrEmpty(status) && Enum.TryParse<OpportunityStatus>(status, true, out var parsedStatus))
        {
            // Draft opportunities are only visible to the organizer
            if (parsedStatus == OpportunityStatus.Draft)
                query = query.Where(o => o.Status == parsedStatus && o.OrganizerId == userId.Value);
            else
                query = query.Where(o => o.Status == parsedStatus);
        }
        else
        {
            query = query.Where(o => o.Status == OpportunityStatus.Published);

            // Laravel's browse listing requires an organisation in an approved or
            // active state (VolunteerService::PUBLIC_ORGANIZATION_STATUSES), so a
            // publicly listed opportunity ALWAYS carries an organisation object.
            // The React volunteering card relies on that: it dereferences
            // `opportunity.organization.id` with no null branch, so listing an
            // unattached opportunity crashes the page rather than degrading it.
            // Draft/own-status views deliberately keep their unattached rows —
            // that is the organiser's own working set, rendered elsewhere.
            query = query.Where(o => o.VolunteerOrganisation != null
                && (o.VolunteerOrganisation.Status == "approved" || o.VolunteerOrganisation.Status == "active"));
        }

        if (category_id.HasValue)
            query = query.Where(o => o.CategoryId == category_id.Value);

        if (organization_id.HasValue)
            query = query.Where(o => o.VolunteerOrganisationId == organization_id.Value);

        if (group_id.HasValue)
            query = query.Where(o => o.GroupId == group_id.Value);

        // Laravel treats any truthy `is_remote` as an inclusive filter and
        // ignores a falsy one (it never filters FOR non-remote rows).
        if (IsTruthyFlag(is_remote))
            query = query.Where(o => o.IsRemote);

        if (!string.IsNullOrWhiteSpace(search))
        {
            // Laravel searches title, description, location, skills_needed, the
            // organisation name and the category name. Matching all six keeps
            // "Riverside" (an organisation) finding its opportunities.
            var searchLower = search.ToLower();
            query = query.Where(o => o.Title.ToLower().Contains(searchLower)
                || (o.Description != null && o.Description.ToLower().Contains(searchLower))
                || (o.Location != null && o.Location.ToLower().Contains(searchLower))
                || (o.SkillsRequired != null && o.SkillsRequired.ToLower().Contains(searchLower))
                || (o.VolunteerOrganisation != null && o.VolunteerOrganisation.Name.ToLower().Contains(searchLower))
                || (o.Category != null && o.Category.Name.ToLower().Contains(searchLower)));
        }

        // Laravel's browse listing is keyset-paginated, newest id first, with an
        // opaque base64 cursor; the React page sends `cursor` and never `page`.
        // Offset paging stays available for callers that send `page`.
        var proximity = near_lat.HasValue && near_lng.HasValue && radius_km.HasValue
            && near_lat.Value >= -90 && near_lat.Value <= 90
            && near_lng.Value >= -180 && near_lng.Value <= 180;

        var withRelations = query
            .Include(o => o.Organizer)
            .Include(o => o.Category)
            .Include(o => o.Group)
            .Include(o => o.VolunteerOrganisation);

        List<VolunteerOpportunity> rows;
        bool hasMore;
        string? nextCursor = null;

        if (proximity)
        {
            // Distance ordering needs a (distance, id) keyset, so the radius has
            // to be applied BEFORE the page is cut — filtering a page after it
            // is taken silently returns a short page. Rows without coordinates
            // cannot satisfy a radius and are excluded, rather than being
            // returned as if the filter had not been asked for.
            var radius = Math.Clamp(radius_km!.Value, 0.1, 500);
            var candidates = await withRelations
                .Where(o => o.Latitude != null && o.Longitude != null)
                .ToListAsync();

            var ranked = candidates
                .Select(o => new { Row = o, Km = HaversineKm(near_lat!.Value, near_lng!.Value, o.Latitude!.Value, o.Longitude!.Value) })
                .Where(x => x.Km <= radius)
                .OrderBy(x => x.Km).ThenBy(x => x.Row.Id)
                .ToList();

            var (lastDistance, lastId) = DecodeDistanceCursor(cursor);
            if (lastDistance.HasValue)
            {
                ranked = ranked
                    .Where(x => x.Km > lastDistance.Value || (x.Km == lastDistance.Value && x.Row.Id > lastId))
                    .ToList();
            }

            hasMore = ranked.Count > limit;
            var pageRanked = ranked.Take(limit).ToList();
            rows = pageRanked.Select(x => x.Row).ToList();
            if (hasMore && pageRanked.Count > 0)
                nextCursor = EncodeDistanceCursor(pageRanked[^1].Km, pageRanked[^1].Row.Id);
        }
        else
        {
            var cursorId = DecodeIdCursor(cursor);
            IQueryable<VolunteerOpportunity> pageQuery = withRelations.OrderByDescending(o => o.Id);
            if (cursorId.HasValue)
                pageQuery = withRelations.Where(o => o.Id < cursorId.Value).OrderByDescending(o => o.Id);
            else if (page > 1)
                pageQuery = pageQuery.Skip((page - 1) * limit);

            // Fetch one extra row: `has_more` is a real look-ahead, as in
            // Laravel, not a count comparison a filter could make disagree with
            // the page it describes.
            rows = await pageQuery.Take(limit + 1).ToListAsync();
            hasMore = rows.Count > limit;
            if (hasMore) rows.RemoveAt(rows.Count - 1);
            if (hasMore && rows.Count > 0)
                nextCursor = EncodeIdCursor(rows[^1].Id);
        }

        var appliedIds = rows.Count == 0
            ? new List<int>()
            : await _db.VolunteerApplications
                .Where(a => a.UserId == userId.Value
                    && (a.Status == ApplicationStatus.Pending || a.Status == ApplicationStatus.Approved)
                    && rows.Select(r => r.Id).Contains(a.OpportunityId))
                .Select(a => a.OpportunityId)
                .Distinct()
                .ToListAsync();

        var opportunities = rows.Select(o => new Dictionary<string, object?>
        {
            ["id"] = o.Id,
            ["tenant_id"] = o.TenantId,
            ["organization_id"] = o.VolunteerOrganisationId,
            ["title"] = o.Title,
            ["description"] = o.Description,
            ["location"] = o.Location,
            ["is_remote"] = o.IsRemote,
            // Laravel's column is `skills_needed`; the React volunteering card
            // reads that name and nothing else.
            ["skills_needed"] = o.SkillsRequired,
            ["start_date"] = LaravelDate(o.StartsAt),
            ["end_date"] = LaravelDate(o.EndsAt),
            // Laravel carries a separate is_active flag; here the publish state
            // is the enum, so a published row is the active row.
            ["is_active"] = o.Status == OpportunityStatus.Published,
            ["created_at"] = LaravelDate(o.CreatedAt),
            ["updated_at"] = LaravelDate(o.UpdatedAt),
            // Volunteering has no federation import path in this backend, so
            // these are structurally constant rather than assumed: a federated
            // opportunity cannot exist here.
            ["is_federated"] = 0,
            ["federated_visibility"] = "none",
            ["external_partner_id"] = null,
            ["external_id"] = null,
            ["source_tenant_id"] = null,
            ["category_id"] = o.CategoryId,
            // Laravel's public statuses are open|active; this backend's
            // published state is the same externally observable state.
            ["status"] = o.Status == OpportunityStatus.Published ? "open" : o.Status.ToString().ToLowerInvariant(),
            ["credits_offered"] = o.CreditReward,
            ["created_by"] = o.OrganizerId,
            ["latitude"] = o.Latitude,
            ["longitude"] = o.Longitude,
            // Laravel strips the creator's internal id from this public listing.
            ["creator"] = o.Organizer == null ? null : new Dictionary<string, object?>
            {
                ["first_name"] = o.Organizer.FirstName,
                ["last_name"] = o.Organizer.LastName,
                ["avatar_url"] = o.Organizer.AvatarUrl,
                // Laravel's User model appends `avatar` and `tagline` to every
                // serialised user, so they are part of this contract even though
                // the browse listing never names them.
                ["avatar"] = o.Organizer.AvatarUrl,
                ["tagline"] = TaglineFallback(o.Organizer.Bio),
            },
            ["organization"] = o.VolunteerOrganisation == null ? null : new
            {
                id = o.VolunteerOrganisation.Id,
                name = o.VolunteerOrganisation.Name,
                logo_url = o.VolunteerOrganisation.LogoUrl,
            },
            // Null when unset, as an absent Eloquent relation serialises —
            // NOT an object with empty fields, which the card would render.
            ["category"] = o.Category == null ? null : new Dictionary<string, object?>
            {
                ["id"] = o.Category.Id,
                ["name"] = o.Category.Name,
                // 🔴 Laravel eager-loads `category:id,name,color` here and this
                // backend's Category entity has no colour column, so the key
                // exists with an honest null rather than a value invented from a
                // palette — the same treatment as ListingContractMapper.cs:62-67.
                // The React volunteering page never reads it.
                ["color"] = null,
            },
            ["has_applied"] = appliedIds.Contains(o.Id),
        }).ToList();

        // Laravel adds `distance_km` only on a proximity query, rounded to 2dp.
        if (proximity)
        {
            foreach (var item in opportunities)
            {
                var lat = (double?)item["latitude"];
                var lng = (double?)item["longitude"];
                if (lat.HasValue && lng.HasValue)
                    item["distance_km"] = HaversineKm(near_lat!.Value, near_lng!.Value, lat.Value, lng.Value);
            }
        }

        var meta = new Dictionary<string, object?>
        {
            ["per_page"] = limit,
            ["has_more"] = hasMore,
        };
        // Laravel emits `cursor` only when another page exists — an always-present
        // cursor makes an infinite scroll re-serve the same page for ever.
        if (nextCursor is not null)
            meta["cursor"] = nextCursor;

        return Ok(new
        {
            data = opportunities,
            // base_url is filled in by LaravelDataEnvelopeFilter.
            meta,
        });
    }

    /// <summary>
    /// Laravel's <c>queryBool</c> semantics: 1/true/on/yes are true, everything
    /// else (including absence) is false.
    /// </summary>
    private static bool IsTruthyFlag(string? value)
        => value is not null
            && (value.Equals("1", StringComparison.Ordinal)
                || value.Equals("true", StringComparison.OrdinalIgnoreCase)
                || value.Equals("on", StringComparison.OrdinalIgnoreCase)
                || value.Equals("yes", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Laravel's <c>tagline</c> accessor returns the tagline column when set and
    /// otherwise the first 120 characters of the bio. This backend has no tagline
    /// column, so the fallback branch is always the correct one — the value is
    /// derived, not invented.
    /// </summary>
    private static string? TaglineFallback(string? bio)
    {
        if (string.IsNullOrWhiteSpace(bio)) return null;
        // Count text elements, not UTF-16 units, so a 120-character cut never
        // splits an emoji or a combining sequence.
        var enumerator = System.Globalization.StringInfo.GetTextElementEnumerator(bio);
        var taken = 0;
        var end = bio.Length;
        while (enumerator.MoveNext())
        {
            if (taken == 120)
            {
                end = enumerator.ElementIndex;
                break;
            }
            taken++;
        }
        return end >= bio.Length ? bio : bio[..end];
    }

    /// <summary>
    /// Laravel serialises model dates with six fractional digits and a Z suffix.
    /// </summary>
    private static string? LaravelDate(DateTime? value)
        => value?.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.ffffffZ", System.Globalization.CultureInfo.InvariantCulture);

    private static string EncodeIdCursor(int id)
        => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(id.ToString(System.Globalization.CultureInfo.InvariantCulture)));

    private static int? DecodeIdCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return null;
        try
        {
            var decoded = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var id) && id > 0
                ? id
                : null;
        }
        catch (FormatException)
        {
            // An unreadable cursor means "first page", exactly as Laravel's
            // base64_decode(strict) failure does. Not an error to the caller.
            return null;
        }
    }

    /// <summary>
    /// Laravel's proximity cursor is <c>base64("D:" + distance + "|" + id)</c>,
    /// with the distance rounded to the same precision the boundary comparison
    /// uses, so a page edge neither skips nor repeats a row.
    /// </summary>
    private static string EncodeDistanceCursor(double km, int id)
        => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(
            "D:" + Math.Round(km, 6).ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + id.ToString(System.Globalization.CultureInfo.InvariantCulture)));

    private static (double? Distance, int Id) DecodeDistanceCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return (null, 0);
        string decoded;
        try
        {
            decoded = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
        }
        catch (FormatException)
        {
            return (null, 0);
        }

        if (!decoded.StartsWith("D:", StringComparison.Ordinal)) return (null, 0);
        var parts = decoded[2..].Split('|', 2);
        if (parts.Length != 2) return (null, 0);
        if (!double.TryParse(parts[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var km)) return (null, 0);
        if (!int.TryParse(parts[1], System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var id)) return (null, 0);
        return (Math.Round(km, 6), id);
    }

    private static double HaversineKm(double lat1, double lng1, double lat2, double lng2)
    {
        const double earthRadiusKm = 6371.0;
        var dLat = (lat2 - lat1) * Math.PI / 180.0;
        var dLng = (lng2 - lng1) * Math.PI / 180.0;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
            + Math.Cos(lat1 * Math.PI / 180.0) * Math.Cos(lat2 * Math.PI / 180.0)
            * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return Math.Round(earthRadiusKm * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a)), 2);
    }

    /// <summary>
    /// Get a single volunteer opportunity by ID.
    /// </summary>
    [HttpGet("opportunities/{id:int}")]
    public async Task<IActionResult> GetOpportunity(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var opportunity = await _db.VolunteerOpportunities
            .Include(o => o.Organizer)
            .Include(o => o.Category)
            .Include(o => o.Group)
            .Include(o => o.Applications)
            .Include(o => o.Shifts).ThenInclude(s => s.CheckIns)
            .FirstOrDefaultAsync(o => o.Id == id);

        if (opportunity == null)
            return NotFound(new { error = "Opportunity not found" });

        var isOrganizer = opportunity.OrganizerId == userId.Value;
        var userApplication = opportunity.Applications.FirstOrDefault(a => a.UserId == userId.Value);

        return Ok(new
        {
            id = opportunity.Id,
            title = opportunity.Title,
            description = opportunity.Description,
            organizer = opportunity.Organizer != null ? new { id = opportunity.Organizer.Id, first_name = opportunity.Organizer.FirstName, last_name = opportunity.Organizer.LastName } : null,
            group = opportunity.Group != null ? new { id = opportunity.Group.Id, name = opportunity.Group.Name } : null,
            category = opportunity.Category != null ? new { id = opportunity.Category.Id, name = opportunity.Category.Name } : null,
            location = opportunity.Location,
            status = opportunity.Status.ToString().ToLowerInvariant(),
            required_volunteers = opportunity.RequiredVolunteers,
            approved_count = opportunity.Applications.Count(a => a.Status == ApplicationStatus.Approved),
            pending_count = isOrganizer ? opportunity.Applications.Count(a => a.Status == ApplicationStatus.Pending) : (int?)null,
            is_recurring = opportunity.IsRecurring,
            starts_at = opportunity.StartsAt,
            ends_at = opportunity.EndsAt,
            application_deadline = opportunity.ApplicationDeadline,
            skills_required = opportunity.SkillsRequired,
            credit_reward = opportunity.CreditReward,
            is_organizer = isOrganizer,
            my_application = userApplication != null ? new
            {
                id = userApplication.Id,
                status = userApplication.Status.ToString().ToLowerInvariant(),
                created_at = userApplication.CreatedAt
            } : null,
            shifts = opportunity.Shifts
                .OrderBy(s => s.StartsAt)
                .Select(s => new
                {
                    id = s.Id,
                    title = s.Title,
                    starts_at = s.StartsAt,
                    ends_at = s.EndsAt,
                    max_volunteers = s.MaxVolunteers,
                    checked_in_count = s.CheckIns != null ? s.CheckIns.Count(c => c.Status == "checked_in") : 0,
                    location = s.Location,
                    status = s.Status.ToString().ToLowerInvariant()
                }),
            created_at = opportunity.CreatedAt,
            updated_at = opportunity.UpdatedAt
        });
    }

    /// <summary>
    /// Create a new volunteer opportunity.
    /// </summary>
    [HttpPost("opportunities")]
    public async Task<IActionResult> CreateOpportunity([FromBody] CreateOpportunityRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (opportunity, error) = await _volunteerService.CreateOpportunityAsync(
            userId.Value, request.Title, request.Description, request.GroupId, request.Location,
            request.CategoryId, request.RequiredVolunteers, request.IsRecurring, request.StartsAt,
            request.EndsAt, request.ApplicationDeadline, request.SkillsRequired, request.CreditReward,
            request.OrganizationId);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(GetOpportunity), new { id = opportunity!.Id }, new
        {
            id = opportunity.Id,
            organization_id = opportunity.VolunteerOrganisationId,
            title = opportunity.Title,
            status = opportunity.Status.ToString().ToLowerInvariant(),
            created_at = opportunity.CreatedAt
        });
    }

    /// <summary>
    /// Update an existing volunteer opportunity.
    /// </summary>
    [HttpPut("opportunities/{id:int}")]
    public async Task<IActionResult> UpdateOpportunity(int id, [FromBody] UpdateOpportunityRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (opportunity, error) = await _volunteerService.UpdateOpportunityAsync(
            id, userId.Value, request.Title, request.Description, request.Location,
            request.CategoryId, request.RequiredVolunteers, request.IsRecurring, request.StartsAt,
            request.EndsAt, request.ApplicationDeadline, request.SkillsRequired, request.CreditReward);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = opportunity!.Id,
            title = opportunity.Title,
            status = opportunity.Status.ToString().ToLowerInvariant(),
            updated_at = opportunity.UpdatedAt
        });
    }

    /// <summary>
    /// Publish a draft opportunity.
    /// </summary>
    [HttpPut("opportunities/{id:int}/publish")]
    public async Task<IActionResult> PublishOpportunity(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (opportunity, error) = await _volunteerService.PublishOpportunityAsync(id, userId.Value);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = opportunity!.Id,
            status = opportunity.Status.ToString().ToLowerInvariant(),
            updated_at = opportunity.UpdatedAt
        });
    }

    /// <summary>
    /// Close a published opportunity.
    /// </summary>
    [HttpPut("opportunities/{id:int}/close")]
    public async Task<IActionResult> CloseOpportunity(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (opportunity, error) = await _volunteerService.CloseOpportunityAsync(id, userId.Value);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = opportunity!.Id,
            status = opportunity.Status.ToString().ToLowerInvariant(),
            updated_at = opportunity.UpdatedAt
        });
    }

    // === Applications ===

    /// <summary>
    /// Apply to a volunteer opportunity.
    /// </summary>
    [HttpPost("opportunities/{id:int}/apply")]
    public async Task<IActionResult> Apply(
        int id,
        [FromBody] ApplyRequest? request = null,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _volunteerService.ApplyToOpportunityAsync(
            id,
            userId.Value,
            request?.Message,
            request?.ShiftId,
            cancellationToken);

        if (!result.Succeeded)
        {
            var error = result.Error!;
            return IsCanonicalV2Request()
                ? ApplyError(error)
                : BadRequest(new { error = error.LegacyMessage });
        }

        var application = result.Application!;
        var data = new
        {
            id = application.Id,
            tenant_id = application.TenantId,
            opportunity_id = application.OpportunityId,
            user_id = application.UserId,
            shift_id = application.ShiftId,
            status = application.Status.ToString().ToLowerInvariant(),
            message = application.Message,
            reviewed_by_id = application.ReviewedById,
            reviewed_at = application.ReviewedAt,
            created_at = application.CreatedAt,
            updated_at = application.UpdatedAt
        };

        if (IsCanonicalV2Request())
        {
            return StatusCode(StatusCodes.Status201Created, new
            {
                data,
                meta = new
                {
                    base_url = $"{Request.Scheme}://{Request.Host}"
                }
            });
        }

        return CreatedAtAction(nameof(GetOpportunity), new { id }, data);
    }

    /// <summary>
    /// List applications for a volunteer opportunity (organizer only).
    /// </summary>
    [HttpGet("opportunities/{id:int}/applications")]
    public async Task<IActionResult> ListApplications(
        int id,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? status = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var opportunity = await _db.VolunteerOpportunities
            .FirstOrDefaultAsync(o => o.Id == id);

        if (opportunity == null)
            return NotFound(new { error = "Opportunity not found" });

        if (opportunity.OrganizerId != userId.Value)
            return Forbid();

        var query = _db.VolunteerApplications
            .Where(a => a.OpportunityId == id);

        if (!string.IsNullOrEmpty(status) && Enum.TryParse<ApplicationStatus>(status, true, out var parsedStatus))
        {
            query = query.Where(a => a.Status == parsedStatus);
        }

        var total = await query.CountAsync();

        var applications = await query
            .OrderByDescending(a => a.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Include(a => a.User)
            .Include(a => a.ReviewedBy)
            .Select(a => new
            {
                id = a.Id,
                user = a.User != null ? new { id = a.User.Id, first_name = a.User.FirstName, last_name = a.User.LastName, email = a.User.Email } : null,
                status = a.Status.ToString().ToLowerInvariant(),
                message = a.Message,
                reviewed_by = a.ReviewedBy != null ? new { id = a.ReviewedBy.Id, first_name = a.ReviewedBy.FirstName, last_name = a.ReviewedBy.LastName } : null,
                reviewed_at = a.ReviewedAt,
                created_at = a.CreatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            data = applications,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }

    /// <summary>
    /// Review (approve or decline) a volunteer application.
    /// </summary>
    [HttpPut("applications/{id:int}/review")]
    public async Task<IActionResult> ReviewApplication(int id, [FromBody] ReviewApplicationRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (application, error) = await _volunteerService.ReviewApplicationAsync(
            id, userId.Value, request.Approved, request.Reason);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = application!.Id,
            opportunity_id = application.OpportunityId,
            user_id = application.UserId,
            status = application.Status.ToString().ToLowerInvariant(),
            reviewed_at = application.ReviewedAt
        });
    }

    /// <summary>
    /// Withdraw a volunteer application.
    /// </summary>
    [HttpDelete("applications/{id:int}")]
    public async Task<IActionResult> WithdrawApplication(
        int id,
        CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _volunteerService.WithdrawApplicationAsync(
            id,
            userId.Value,
            cancellationToken);

        if (!result.Succeeded)
        {
            var error = result.Error!;
            return IsCanonicalV2Request()
                ? ApplyError(error)
                : StatusCode(error.StatusCode, new { error = error.LegacyMessage });
        }

        return NoContent();
    }

    // === Shifts ===

    /// <summary>
    /// List shifts for a volunteer opportunity.
    /// </summary>
    [HttpGet("opportunities/{id:int}/shifts")]
    public async Task<IActionResult> ListShifts(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var opportunity = await _db.VolunteerOpportunities
            .FirstOrDefaultAsync(o => o.Id == id);

        if (opportunity == null)
            return NotFound(new { error = "Opportunity not found" });

        var shifts = await _db.VolunteerShifts
            .Where(s => s.OpportunityId == id)
            .Include(s => s.CheckIns)
            .OrderBy(s => s.StartsAt)
            .Select(s => new
            {
                id = s.Id,
                title = s.Title,
                starts_at = s.StartsAt,
                ends_at = s.EndsAt,
                max_volunteers = s.MaxVolunteers,
                checked_in_count = s.CheckIns.Count(c => c.Status == "checked_in"),
                total_check_ins = s.CheckIns.Count,
                location = s.Location,
                notes = s.Notes,
                status = s.Status.ToString().ToLowerInvariant(),
                my_check_in = s.CheckIns
                    .Where(c => c.UserId == userId.Value)
                    .OrderByDescending(c => c.CheckedInAt)
                    .Select(c => new
                    {
                        id = c.Id,
                        checked_in_at = c.CheckedInAt,
                        checked_out_at = c.CheckedOutAt,
                        hours_logged = c.HoursLogged
                    })
                    .FirstOrDefault(),
                created_at = s.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = shifts });
    }

    /// <summary>
    /// Create a new shift for a volunteer opportunity.
    /// </summary>
    [HttpPost("opportunities/{id:int}/shifts")]
    public async Task<IActionResult> CreateShift(int id, [FromBody] CreateShiftRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (shift, error) = await _volunteerService.CreateShiftAsync(
            id, userId.Value, request.Title, request.StartsAt, request.EndsAt,
            request.MaxVolunteers, request.Location, request.Notes);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(ListShifts), new { id }, new
        {
            id = shift!.Id,
            opportunity_id = shift.OpportunityId,
            title = shift.Title,
            starts_at = shift.StartsAt,
            ends_at = shift.EndsAt,
            max_volunteers = shift.MaxVolunteers,
            status = shift.Status.ToString().ToLowerInvariant(),
            created_at = shift.CreatedAt
        });
    }

    /// <summary>
    /// Check in to a volunteer shift.
    /// </summary>
    [HttpPost("shifts/{id:int}/check-in")]
    public async Task<IActionResult> CheckIn(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (checkIn, error) = await _volunteerService.CheckInAsync(id, userId.Value);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = checkIn!.Id,
            shift_id = checkIn.ShiftId,
            checked_in_at = checkIn.CheckedInAt
        });
    }

    /// <summary>
    /// Check out from a volunteer shift.
    /// </summary>
    [HttpPut("shifts/{id:int}/check-out")]
    public async Task<IActionResult> CheckOut(int id, [FromBody] CheckOutRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (checkIn, error) = await _volunteerService.CheckOutAsync(id, userId.Value, request?.HoursLogged);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = checkIn!.Id,
            shift_id = checkIn.ShiftId,
            checked_in_at = checkIn.CheckedInAt,
            checked_out_at = checkIn.CheckedOutAt,
            hours_logged = checkIn.HoursLogged,
            transaction_id = checkIn.TransactionId
        });
    }

    // === My Volunteering ===

    /// <summary>
    /// Get current user's volunteer applications and active check-ins.
    /// </summary>
    [HttpGet("my")]
    public async Task<IActionResult> MyVolunteering(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        // My applications
        var applicationsQuery = _db.VolunteerApplications
            .Where(a => a.UserId == userId.Value);

        var totalApplications = await applicationsQuery.CountAsync();

        var applications = await applicationsQuery
            .OrderByDescending(a => a.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Include(a => a.Opportunity)
            .Select(a => new
            {
                id = a.Id,
                opportunity = a.Opportunity != null ? new
                {
                    id = a.Opportunity.Id,
                    title = a.Opportunity.Title,
                    status = a.Opportunity.Status.ToString().ToLowerInvariant(),
                    location = a.Opportunity.Location,
                    starts_at = a.Opportunity.StartsAt
                } : null,
                status = a.Status.ToString().ToLowerInvariant(),
                message = a.Message,
                reviewed_at = a.ReviewedAt,
                created_at = a.CreatedAt
            })
            .ToListAsync();

        // Active check-ins
        var activeCheckIns = await _db.VolunteerCheckIns
            .Where(c => c.UserId == userId.Value && c.Status == "checked_in")
            .Include(c => c.Shift)
                .ThenInclude(s => s!.Opportunity)
            .Select(c => new
            {
                id = c.Id,
                shift = c.Shift != null ? new
                {
                    id = c.Shift.Id,
                    title = c.Shift.Title,
                    opportunity_title = c.Shift.Opportunity != null ? c.Shift.Opportunity.Title : null,
                    starts_at = c.Shift.StartsAt,
                    ends_at = c.Shift.EndsAt
                } : null,
                checked_in_at = c.CheckedInAt
            })
            .ToListAsync();

        // Opportunities I organize
        var organizedCount = await _db.VolunteerOpportunities
            .CountAsync(o => o.OrganizerId == userId.Value);

        return Ok(new
        {
            applications = new
            {
                data = applications,
                pagination = new { page, limit, total = totalApplications, pages = (int)Math.Ceiling((double)totalApplications / limit) }
            },
            active_check_ins = activeCheckIns,
            organized_count = organizedCount
        });
    }

    /// <summary>
    /// Get current user's volunteer statistics.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> MyStats()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var stats = await _volunteerService.GetVolunteerStatsAsync(userId.Value);
        return Ok(stats);
    }

    private bool IsCanonicalV2Request() =>
        Request.Path.StartsWithSegments("/api/v2", StringComparison.OrdinalIgnoreCase);

    private ObjectResult ApplyError(VolunteerApplicationApplyError error)
    {
        var item = new Dictionary<string, object?>
        {
            ["code"] = error.Code,
            ["message"] = error.Message
        };

        if (error.Field is not null)
        {
            item["field"] = error.Field;
        }

        return StatusCode(error.StatusCode, new { errors = new[] { item } });
    }
}

// === Request DTOs ===

public class CreateOpportunityRequest
{
    [JsonPropertyName("organization_id")]
    public int? OrganizationId { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("group_id")]
    public int? GroupId { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("category_id")]
    public int? CategoryId { get; set; }

    [JsonPropertyName("required_volunteers")]
    public int RequiredVolunteers { get; set; } = 1;

    [JsonPropertyName("is_recurring")]
    public bool IsRecurring { get; set; } = false;

    [JsonPropertyName("starts_at")]
    public DateTime? StartsAt { get; set; }

    [JsonPropertyName("ends_at")]
    public DateTime? EndsAt { get; set; }

    [JsonPropertyName("application_deadline")]
    public DateTime? ApplicationDeadline { get; set; }

    [JsonPropertyName("skills_required")]
    public string? SkillsRequired { get; set; }

    [JsonPropertyName("credit_reward")]
    public decimal? CreditReward { get; set; }
}

public class UpdateOpportunityRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("category_id")]
    public int? CategoryId { get; set; }

    [JsonPropertyName("required_volunteers")]
    public int? RequiredVolunteers { get; set; }

    [JsonPropertyName("is_recurring")]
    public bool? IsRecurring { get; set; }

    [JsonPropertyName("starts_at")]
    public DateTime? StartsAt { get; set; }

    [JsonPropertyName("ends_at")]
    public DateTime? EndsAt { get; set; }

    [JsonPropertyName("application_deadline")]
    public DateTime? ApplicationDeadline { get; set; }

    [JsonPropertyName("skills_required")]
    public string? SkillsRequired { get; set; }

    [JsonPropertyName("credit_reward")]
    public decimal? CreditReward { get; set; }
}

public class ApplyRequest
{
    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("shift_id")]
    public int? ShiftId { get; set; }
}

public class ReviewApplicationRequest
{
    [JsonPropertyName("approved")]
    public bool Approved { get; set; }

    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class CreateShiftRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("starts_at")]
    public DateTime StartsAt { get; set; }

    [JsonPropertyName("ends_at")]
    public DateTime EndsAt { get; set; }

    [JsonPropertyName("max_volunteers")]
    public int MaxVolunteers { get; set; } = 1;

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}

public class CheckOutRequest
{
    [JsonPropertyName("hours_logged")]
    public decimal? HoursLogged { get; set; }
}
