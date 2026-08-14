// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
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
/// Tenant-admin partner-venue management — Laravel parity for
/// AdminPartnerVenueController. Gate order matches Laravel: the feature gate
/// fires before the admin check; cross-tenant venues are 404 (tenant scope),
/// never 403; update checks existence BEFORE validation.
/// </summary>
[ApiController]
[Authorize]
public class AdminPartnerVenuesController : ControllerBase
{
    private static readonly string[] AdminRoles = ["admin", "tenant_admin", "super_admin", "god"];
    private static readonly string[] OperationalRoles = ["broker", "coordinator"];

    private readonly NexusDbContext _db;
    private readonly PartnerVenueService _venues;
    private readonly PartnerVenueVisitService _visits;

    public AdminPartnerVenuesController(
        NexusDbContext db, PartnerVenueService venues, PartnerVenueVisitService visits)
    {
        _db = db;
        _venues = venues;
        _visits = visits;
    }

    public sealed class VenueWriteRequest
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("category")] public string? Category { get; set; }
        [JsonPropertyName("offer_summary")] public string? OfferSummary { get; set; }
        [JsonPropertyName("address_line")] public string? AddressLine { get; set; }
        [JsonPropertyName("city")] public string? City { get; set; }
        [JsonPropertyName("postcode")] public string? Postcode { get; set; }
        [JsonPropertyName("latitude")] public decimal? Latitude { get; set; }
        [JsonPropertyName("longitude")] public decimal? Longitude { get; set; }
        [JsonPropertyName("website")] public string? Website { get; set; }
        [JsonPropertyName("contact_email")] public string? ContactEmail { get; set; }
        [JsonPropertyName("logo_url")] public string? LogoUrl { get; set; }
        [JsonPropertyName("status")] public string? Status { get; set; }
    }

    public sealed class AddStaffRequest
    {
        [JsonPropertyName("user_id")] public int? UserId { get; set; }
        [JsonPropertyName("role")] public string? Role { get; set; }
    }

    [HttpGet("api/v2/admin/partner-venues")]
    public async Task<IActionResult> Index([FromQuery] string? status)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var venues = await _venues.AdminListAsync(status, HttpContext.RequestAborted);
        return LaravelData(new { venues });
    }

    [HttpPost("api/v2/admin/partner-venues")]
    public async Task<IActionResult> Store([FromBody] VenueWriteRequest request)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var errors = Validate(request, requireName: true);
        if (errors.Count > 0) return ValidationFailed(errors);

        var venue = await _venues.CreateAsync(TenantId, UserId, new PartnerVenue
        {
            Name = request.Name!.Trim(),
            Description = request.Description,
            Category = request.Category,
            OfferSummary = request.OfferSummary,
            AddressLine = request.AddressLine,
            City = request.City,
            Postcode = request.Postcode,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            Website = request.Website,
            ContactEmail = request.ContactEmail,
            LogoUrl = request.LogoUrl,
            Status = request.Status is not null && PartnerVenue.AllowedStatuses.Contains(request.Status)
                ? request.Status
                : PartnerVenue.StatusActive
        }, HttpContext.RequestAborted);

        // Laravel store(): 201 with the bare thirteen-key public shape.
        return LaravelData(PartnerVenueService.ToPublicObject(venue), StatusCodes.Status201Created);
    }

    [HttpPut("api/v2/admin/partner-venues/{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] VenueWriteRequest request)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        // Existence first — a bad payload on a missing venue is 404, not 422.
        var venue = await _db.PartnerVenues
            .FirstOrDefaultAsync(v => v.Id == id, HttpContext.RequestAborted);
        if (venue is null) return LaravelError(404, "NOT_FOUND", "Partner venue not found");

        var errors = Validate(request, requireName: false);
        if (errors.Count > 0) return ValidationFailed(errors);

        var nameChanged = request.Name is not null && request.Name.Trim() != venue.Name;
        if (request.Name is not null) venue.Name = request.Name.Trim();
        if (request.Description is not null) venue.Description = request.Description;
        if (request.Category is not null) venue.Category = request.Category;
        if (request.OfferSummary is not null) venue.OfferSummary = request.OfferSummary;
        if (request.AddressLine is not null) venue.AddressLine = request.AddressLine;
        if (request.City is not null) venue.City = request.City;
        if (request.Postcode is not null) venue.Postcode = request.Postcode;
        if (request.Latitude is not null) venue.Latitude = request.Latitude;
        if (request.Longitude is not null) venue.Longitude = request.Longitude;
        if (request.Website is not null) venue.Website = request.Website;
        if (request.ContactEmail is not null) venue.ContactEmail = request.ContactEmail;
        if (request.LogoUrl is not null) venue.LogoUrl = request.LogoUrl;
        if (request.Status is not null && PartnerVenue.AllowedStatuses.Contains(request.Status))
            venue.Status = request.Status;
        if (nameChanged)
            venue.Slug = await _venues.UniqueSlugAsync(TenantId, venue.Name, venue.Id, HttpContext.RequestAborted);
        venue.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        return LaravelData(PartnerVenueService.ToPublicObject(venue));
    }

    [HttpPost("api/v2/admin/partner-venues/{id:int}/archive")]
    public async Task<IActionResult> Archive(int id)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var venue = await _db.PartnerVenues
            .FirstOrDefaultAsync(v => v.Id == id, HttpContext.RequestAborted);
        if (venue is null) return LaravelError(404, "NOT_FOUND", "Partner venue not found");

        venue.Status = PartnerVenue.StatusArchived;
        venue.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(HttpContext.RequestAborted);
        return LaravelData(new { message = "Partner venue archived" });
    }

    [HttpGet("api/v2/admin/partner-venues/{id:int}/staff")]
    public async Task<IActionResult> Staff(int id)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        if (!await VenueExistsAsync(id)) return LaravelError(404, "NOT_FOUND", "Partner venue not found");
        return LaravelData(new { staff = await _venues.StaffListAsync(id, HttpContext.RequestAborted) });
    }

    [HttpPost("api/v2/admin/partner-venues/{id:int}/staff")]
    public async Task<IActionResult> AddStaff(int id, [FromBody] AddStaffRequest request)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        if (!await VenueExistsAsync(id)) return LaravelError(404, "NOT_FOUND", "Partner venue not found");

        var errors = new Dictionary<string, List<string>>();
        if (request.UserId is null or < 1)
            AddError(errors, "user_id", "The user id field is required.");
        if (request.Role is not null && !PartnerVenueStaffMember.AllowedRoles.Contains(request.Role))
            AddError(errors, "role", "The selected role is invalid.");
        if (errors.Count > 0) return ValidationFailed(errors);

        var added = await _venues.AddStaffAsync(
            TenantId, id, request.UserId!.Value, request.Role ?? "member", HttpContext.RequestAborted);
        if (!added)
        {
            return LaravelError(404, "NOT_FOUND", "Member not found in this community", field: "user_id");
        }

        return LaravelData(new { staff = await _venues.StaffListAsync(id, HttpContext.RequestAborted) });
    }

    [HttpDelete("api/v2/admin/partner-venues/{id:int}/staff/{userId:int}")]
    public async Task<IActionResult> RemoveStaff(int id, int userId)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        if (!await VenueExistsAsync(id)) return LaravelError(404, "NOT_FOUND", "Partner venue not found");

        // Laravel does not check whether the user was staff: the delete is
        // idempotent and 200 either way.
        await _venues.RemoveStaffAsync(id, userId, HttpContext.RequestAborted);
        return LaravelData(new { staff = await _venues.StaffListAsync(id, HttpContext.RequestAborted) });
    }

    [HttpGet("api/v2/admin/partner-venues/reports/summary")]
    public async Task<IActionResult> Summary([FromQuery] int days = 30)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        return LaravelData(await _visits.SummaryAsync(days, HttpContext.RequestAborted));
    }

    [HttpGet("api/v2/admin/partner-venues/visits/export.csv")]
    public async Task<IActionResult> ExportCsv(
        [FromQuery(Name = "venue_id")] string? venueId,
        [FromQuery] string? from,
        [FromQuery] string? to)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var rows = await _visits.VisitRowsAsync(
            int.TryParse(venueId, out var parsedVenue) ? parsedVenue : null,
            DateParam(from),
            DateParam(to),
            HttpContext.RequestAborted);

        var csv = new StringBuilder();
        AppendCsvRow(csv, ["Date", "Time", "Venue", "Member ID", "Member", "Recorded by", "Source"]);
        foreach (var row in rows)
        {
            AppendCsvRow(csv,
            [
                row.VisitedOn, row.VisitedAt, row.VenueName,
                row.MemberId.ToString(), row.MemberName, row.RecordedBy, row.Source
            ]);
        }

        Response.Headers["API-Version"] = "2.0";
        return File(
            Encoding.UTF8.GetBytes(csv.ToString()),
            "text/csv; charset=utf-8",
            $"partner-venue-visits-{DateTime.UtcNow:yyyy-MM-dd}.csv");
    }

    private int TenantId => User.GetTenantId() ?? 0;
    private int UserId => User.GetUserId() ?? 0;

    /// <summary>
    /// Laravel gate order: feature middleware first (generic service_unavailable
    /// body), then requireAdmin — AdminTier semantics read from the database
    /// row: operational roles (broker/coordinator) fail closed even with stale
    /// flags, then role strings or any admin boolean flag allow.
    /// </summary>
    private async Task<IActionResult?> GateAsync()
    {
        if (TenantId == 0 || UserId == 0)
        {
            return StatusCode(StatusCodes.Status401Unauthorized,
                new { success = false, error = "Authentication required", code = "AUTH_REQUIRED" });
        }

        if (!await _venues.IsFeatureEnabledAsync(TenantId, HttpContext.RequestAborted))
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[] { new { code = "FEATURE_DISABLED", message = "Service unavailable" } },
                success = false
            });
        }

        var user = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == UserId && u.TenantId == TenantId,
                HttpContext.RequestAborted);
        var allowed = user is not null
            && !OperationalRoles.Contains(user.Role)
            && (AdminRoles.Contains(user.Role)
                || user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod);
        if (!allowed)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                error = "Admin access required",
                code = "AUTH_INSUFFICIENT_PERMISSIONS"
            });
        }

        return null;
    }

    private async Task<bool> VenueExistsAsync(int id) =>
        await _db.PartnerVenues.AnyAsync(v => v.Id == id, HttpContext.RequestAborted);

    private Dictionary<string, List<string>> Validate(VenueWriteRequest request, bool requireName)
    {
        var errors = new Dictionary<string, List<string>>();
        if (requireName && string.IsNullOrWhiteSpace(request.Name))
            AddError(errors, "name", "The name field is required.");
        if (request.Name is { Length: > 255 })
            AddError(errors, "name", "The name field must not be greater than 255 characters.");
        if (request.Description is { Length: > 5000 })
            AddError(errors, "description", "The description field must not be greater than 5000 characters.");
        if (request.Category is not null && !PartnerVenue.AllowedCategories.Contains(request.Category))
            AddError(errors, "category", "The selected category is invalid.");
        if (request.OfferSummary is { Length: > 255 })
            AddError(errors, "offer_summary", "The offer summary field must not be greater than 255 characters.");
        if (request.AddressLine is { Length: > 255 })
            AddError(errors, "address_line", "The address line field must not be greater than 255 characters.");
        if (request.City is { Length: > 100 })
            AddError(errors, "city", "The city field must not be greater than 100 characters.");
        if (request.Postcode is { Length: > 20 })
            AddError(errors, "postcode", "The postcode field must not be greater than 20 characters.");
        if (request.Latitude is < -90 or > 90)
            AddError(errors, "latitude", "The latitude field must be between -90 and 90.");
        if (request.Longitude is < -180 or > 180)
            AddError(errors, "longitude", "The longitude field must be between -180 and 180.");
        if (request.Website is not null
            && (request.Website.Length > 255
                || !Uri.TryCreate(request.Website, UriKind.Absolute, out var uri)
                || uri.Scheme is not ("http" or "https")))
            AddError(errors, "website", "The website field must be a valid URL.");
        if (request.ContactEmail is not null
            && (request.ContactEmail.Length > 255 || !System.Net.Mail.MailAddress.TryCreate(request.ContactEmail, out _)))
            AddError(errors, "contact_email", "The contact email field must be a valid email address.");
        if (request.LogoUrl is { Length: > 255 })
            AddError(errors, "logo_url", "The logo url field must not be greater than 255 characters.");
        if (request.Status is not null && !PartnerVenue.AllowedStatuses.Contains(request.Status))
            AddError(errors, "status", "The selected status is invalid.");
        return errors;
    }

    private static void AddError(Dictionary<string, List<string>> errors, string field, string message)
    {
        if (!errors.TryGetValue(field, out var list))
        {
            list = [];
            errors[field] = list;
        }
        list.Add(message);
    }

    /// <summary>Laravel $request->validate failure shape: 422 {message, errors:{field:[…]}}.</summary>
    private IActionResult ValidationFailed(Dictionary<string, List<string>> errors)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(StatusCodes.Status422UnprocessableEntity, new
        {
            message = errors.Values.First().First(),
            errors = errors.ToDictionary(pair => pair.Key, pair => pair.Value.ToArray())
        });
    }

    private IActionResult LaravelData(object data, int status = StatusCodes.Status200OK)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = TenantId.ToString();
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelError(int status, string code, string message, string? field = null)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = TenantId.ToString();
        if (field is null)
            return StatusCode(status, new { errors = new[] { new { code, message } } });
        return StatusCode(status, new { errors = new[] { new { code, message, field } } });
    }

    /// <summary>Only strict yyyy-MM-dd is accepted; anything else is ignored.</summary>
    private static DateOnly? DateParam(string? value)
    {
        if (value is null || value.Length != 10) return null;
        return DateOnly.TryParseExact(value, "yyyy-MM-dd", out var parsed) ? parsed : null;
    }

    /// <summary>
    /// fputcsv-style quoting plus the Laravel CsvExportSanitizer rule: any
    /// cell whose first non-control character is = + - @ gets a leading
    /// apostrophe so spreadsheets never execute it as a formula.
    /// </summary>
    private static void AppendCsvRow(StringBuilder builder, IReadOnlyList<string> cells)
    {
        for (var i = 0; i < cells.Count; i++)
        {
            if (i > 0) builder.Append(',');
            builder.Append(EscapeCsvCell(SanitizeCsvCell(cells[i])));
        }
        builder.Append('\n');
    }

    private static string SanitizeCsvCell(string raw)
    {
        foreach (var ch in raw)
        {
            if (char.IsWhiteSpace(ch) || char.IsControl(ch)) continue;
            return "=+-@".Contains(ch, StringComparison.Ordinal) ? "'" + raw : raw;
        }
        return raw;
    }

    private static string EscapeCsvCell(string cell)
    {
        if (cell.Contains(',') || cell.Contains('"') || cell.Contains('\n') || cell.Contains('\r'))
        {
            return '"' + cell.Replace("\"", "\"\"") + '"';
        }
        return cell;
    }
}
