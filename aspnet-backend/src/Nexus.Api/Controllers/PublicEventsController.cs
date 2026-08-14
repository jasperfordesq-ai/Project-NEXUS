// Copyright (c) 2024-2026 Jasper Ford
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
/// Anonymous public events — Laravel parity for EventPublicController.
/// Double feature gate exactly as Laravel: 'events' (default ON) AND
/// 'public_events' (default OFF, opt-in per community) — either missing
/// yields the middleware-shaped 403. The projection is an ALLOWLIST: sixteen
/// keys on the list, plus description and the accessibility object on
/// detail — never links, RSVP state, counts, capacity, or the organiser's
/// surname. A missing, draft, private-group, or foreign-tenant event is an
/// indistinguishable 404.
/// </summary>
[ApiController]
[AllowAnonymous]
public class PublicEventsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;

    public PublicEventsController(NexusDbContext db, TenantContext tenant)
    {
        _db = db;
        _tenant = tenant;
    }

    [HttpGet("api/v2/public/events")]
    public async Task<IActionResult> Index(
        [FromQuery] string? when,
        [FromQuery(Name = "per_page")] int perPage = 20,
        [FromQuery(Name = "category_id")] int? categoryId = null,
        [FromQuery] string? q = null)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var window = when is "past" or "all" ? when : "upcoming";
        perPage = Math.Min(Math.Max(perPage, 1), 50);
        var now = DateTime.UtcNow;

        var query = PublicEvents();
        if (categoryId.HasValue) query = query.Where(e => e.CategoryId == categoryId.Value);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var needle = q.Trim().ToLower();
            query = query.Where(e => e.Title.ToLower().Contains(needle));
        }

        query = window switch
        {
            "past" => query.Where(e => e.StartsAt < now)
                .OrderByDescending(e => e.StartsAt).ThenByDescending(e => e.Id),
            "all" => query.OrderByDescending(e => e.StartsAt).ThenByDescending(e => e.Id),
            _ => query.Where(e => e.StartsAt >= now)
                .OrderBy(e => e.StartsAt).ThenBy(e => e.Id),
        };

        var rows = await query.Take(perPage + 1).ToListAsync(HttpContext.RequestAborted);
        var hasMore = rows.Count > perPage;
        if (hasMore) rows = rows.Take(perPage).ToList();
        var context = await ProjectionContextAsync(rows);

        Response.Headers["API-Version"] = "2.0";
        return Ok(new
        {
            data = rows.Select(e => ProjectListItem(e, context)).ToList(),
            meta = new
            {
                base_url = $"{Request.Scheme}://{Request.Host}",
                per_page = perPage,
                has_more = hasMore
            }
        });
    }

    [HttpGet("api/v2/public/events/{id:int}")]
    public async Task<IActionResult> Show(int id)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var eventRow = await PublicEvents()
            .FirstOrDefaultAsync(e => e.Id == id, HttpContext.RequestAborted);
        if (eventRow is null)
        {
            Response.Headers["API-Version"] = "2.0";
            return NotFound(new
            {
                errors = new[] { new { code = "NOT_FOUND", message = "Event not found" } }
            });
        }

        var context = await ProjectionContextAsync([eventRow]);
        var baseProjection = (Dictionary<string, object?>)ProjectListItem(eventRow, context);
        baseProjection["description"] = eventRow.Description;
        baseProjection["accessibility"] = new
        {
            step_free = eventRow.AccessibilityStepFree,
            accessible_toilet = eventRow.AccessibilityToilet,
            hearing_loop = eventRow.AccessibilityHearingLoop,
            quiet_space = eventRow.AccessibilityQuietSpace,
            seating = eventRow.AccessibilitySeating,
            parking = eventRow.AccessibilityParking,
            notes = eventRow.AccessibilityParkingDetails
        };

        Response.Headers["API-Version"] = "2.0";
        return Ok(new
        {
            data = baseProjection,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    /// <summary>
    /// Public visibility, as Laravel: active status, published (legacy null
    /// treated as published), and no group or a public active group.
    /// </summary>
    private IQueryable<Event> PublicEvents() =>
        _db.Events.AsNoTracking()
            .Where(e => e.Status == "active")
            .Where(e => e.PublicationStatus == "published")
            .Where(e => e.GroupId == null
                || _db.Groups.Any(g => g.Id == e.GroupId
                    && g.Status == "active"
                    && g.Visibility == "public"));

    private sealed record ProjectionContext(
        Dictionary<int, (string Name, string Slug, string? Color)> Categories,
        Dictionary<int, string?> OrganizerNames);

    private async Task<ProjectionContext> ProjectionContextAsync(IReadOnlyCollection<Event> rows)
    {
        var categoryIds = rows.Where(e => e.CategoryId.HasValue)
            .Select(e => e.CategoryId!.Value).Distinct().ToArray();
        // The ASP.NET Category entity carries no color column; the projection
        // key stays present with null, which the React types allow.
        var categories = categoryIds.Length == 0
            ? []
            : await _db.Categories.AsNoTracking()
                .Where(c => categoryIds.Contains(c.Id))
                .ToDictionaryAsync(c => c.Id,
                    c => (c.Name, c.Slug, (string?)null), HttpContext.RequestAborted);

        var organizerIds = rows.Select(e => e.CreatedById).Distinct().ToArray();
        // Individuals surface FIRST NAME ONLY — the public page never leaks a
        // surname.
        var organizers = organizerIds.Length == 0
            ? []
            : await _db.Users.IgnoreQueryFilters().AsNoTracking()
                .Where(u => organizerIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id,
                    u => string.IsNullOrWhiteSpace(u.FirstName) ? null : u.FirstName,
                    HttpContext.RequestAborted);

        return new ProjectionContext(categories, organizers);
    }

    private static object ProjectListItem(Event e, ProjectionContext context)
    {
        var location = string.IsNullOrWhiteSpace(e.Location) ? null : e.Location.Trim();
        var isOnline = e.IsOnline || e.AllowRemoteAttendance
            || !string.IsNullOrWhiteSpace(e.OnlineLink) || !string.IsNullOrWhiteSpace(e.VideoUrl);
        var operationalStatus = e.OperationalStatus is "scheduled" or "postponed" or "cancelled" or "completed"
            ? e.OperationalStatus : "scheduled";

        return new Dictionary<string, object?>
        {
            ["id"] = e.Id,
            ["title"] = e.Title,
            ["start_time"] = e.StartsAt.ToString("yyyy-MM-dd'T'HH:mm:ssK"),
            ["end_time"] = e.EndsAt?.ToString("yyyy-MM-dd'T'HH:mm:ssK"),
            ["timezone"] = e.Timezone,
            ["all_day"] = e.AllDay,
            ["location"] = location,
            ["latitude"] = e.Latitude,
            ["longitude"] = e.Longitude,
            ["is_online"] = isOnline,
            ["attendance_mode"] = isOnline
                ? (location is not null ? "hybrid" : "online")
                : "in_person",
            ["operational_status"] = operationalStatus,
            ["image_url"] = e.ImageUrl,
            ["category"] = e.CategoryId is { } categoryId
                && context.Categories.TryGetValue(categoryId, out var category)
                ? new { id = categoryId, name = category.Name, slug = category.Slug, color = category.Color }
                : null,
            ["organizer_name"] = context.OrganizerNames.TryGetValue(e.CreatedById, out var name)
                ? name : null
        };
    }

    /// <summary>
    /// Laravel gates with feature:events AND feature:public_events —
    /// events defaults ON, public_events defaults OFF (opt-in per community).
    /// </summary>
    private async Task<IActionResult?> GateAsync()
    {
        var tenantId = _tenant.IsResolved ? _tenant.TenantId : null;
        if (tenantId is null) return FeatureDisabled();

        var flags = await _db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.TenantId == tenantId.Value
                && (c.Key == "features.events" || c.Key == "features.public_events"))
            .ToDictionaryAsync(c => c.Key, c => c.Value, HttpContext.RequestAborted);

        var eventsEnabled = !flags.TryGetValue("features.events", out var eventsRaw)
            || !IsFalse(eventsRaw);
        var publicEnabled = flags.TryGetValue("features.public_events", out var publicRaw)
            && IsTrue(publicRaw);
        return eventsEnabled && publicEnabled ? null : FeatureDisabled();
    }

    private IActionResult FeatureDisabled()
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(StatusCodes.Status403Forbidden, new
        {
            errors = new[] { new { code = "FEATURE_DISABLED", message = "Service unavailable" } },
            success = false
        });
    }

    private static bool IsTrue(string value) =>
        value.Trim().Trim('"').ToLowerInvariant() is "1" or "true" or "yes" or "on" or "enabled";

    private static bool IsFalse(string value) =>
        value.Trim().Trim('"').ToLowerInvariant() is "0" or "false" or "no" or "off" or "disabled";
}
