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
        [FromQuery] string? status = null,
        [FromQuery] int? category_id = null,
        [FromQuery] int? group_id = null,
        [FromQuery] string? search = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

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
        }

        if (category_id.HasValue)
            query = query.Where(o => o.CategoryId == category_id.Value);

        if (group_id.HasValue)
            query = query.Where(o => o.GroupId == group_id.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchLower = search.ToLower();
            query = query.Where(o => o.Title.ToLower().Contains(searchLower)
                || (o.Description != null && o.Description.ToLower().Contains(searchLower)));
        }

        var total = await query.CountAsync();

        var opportunities = await query
            .OrderByDescending(o => o.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Include(o => o.Organizer)
            .Include(o => o.Category)
            .Include(o => o.Group)
            .Include(o => o.Applications)
            .Include(o => o.Shifts)
            .Select(o => new
            {
                id = o.Id,
                title = o.Title,
                description = o.Description,
                organizer = o.Organizer != null ? new { id = o.Organizer.Id, first_name = o.Organizer.FirstName, last_name = o.Organizer.LastName } : null,
                group = o.Group != null ? new { id = o.Group.Id, name = o.Group.Name } : null,
                category = o.Category != null ? new { id = o.Category.Id, name = o.Category.Name } : null,
                location = o.Location,
                status = o.Status.ToString().ToLowerInvariant(),
                required_volunteers = o.RequiredVolunteers,
                approved_count = o.Applications.Count(a => a.Status == ApplicationStatus.Approved),
                shift_count = o.Shifts.Count,
                is_recurring = o.IsRecurring,
                starts_at = o.StartsAt,
                ends_at = o.EndsAt,
                application_deadline = o.ApplicationDeadline,
                skills_required = o.SkillsRequired,
                credit_reward = o.CreditReward,
                created_at = o.CreatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            data = opportunities,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
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
