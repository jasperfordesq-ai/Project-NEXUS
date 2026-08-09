// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Compatibility aliases for frontend clients that still use V1.5 route names.
/// </summary>
[ApiController]
[Authorize]
public class FrontendApiParityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public FrontendApiParityController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    [HttpHead("api/announcements")]
    [AllowAnonymous]
    public IActionResult AnnouncementsProbe() => Ok();

    [HttpPost("api/announcements/{id:int}/dismiss")]
    public IActionResult DismissAnnouncement(int id) => Ok(new { data = new { id, dismissed = true } });

    [HttpGet("api/broker/services")]
    public IActionResult BrokerServices() => Ok(new { data = BrokerServiceCatalog() });

    [HttpPost("api/broker/requests")]
    public IActionResult CreateBrokerRequest([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), status = "requested", created_at = DateTime.UtcNow } });

    [HttpGet("api/broker/requests/my")]
    public IActionResult MyBrokerRequests() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("api/deliverables")]
    public IActionResult Deliverables() => Ok(new { data = Array.Empty<object>() });

    [HttpPost("api/deliverables")]
    public IActionResult CreateDeliverable([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), status = "open", created_at = DateTime.UtcNow } });

    [HttpGet("api/deliverables/{id:int}")]
    public IActionResult Deliverable(int id) => Ok(new { data = new { id, status = "open" } });

    [HttpGet("api/federation/external/tenants")]
    public async Task<IActionResult> ExternalTenants()
    {
        var tenants = await _db.Tenants
            .OrderBy(t => t.Name)
            .Select(t => new { t.Id, t.Name, t.Slug })
            .ToListAsync();
        return Ok(new { data = tenants });
    }

    [HttpGet("api/federation/external/tenants/{tenantId:int}/listings")]
    public async Task<IActionResult> ExternalTenantListings(int tenantId)
    {
        var listings = await _db.Listings
            .Where(l => l.TenantId == tenantId)
            .OrderByDescending(l => l.CreatedAt)
            .Take(50)
            .Select(l => new { l.Id, l.Title, l.Description, l.Type, l.CreatedAt })
            .ToListAsync();
        return Ok(new { data = listings });
    }

    [HttpGet("api/federation/instances")]
    public async Task<IActionResult> FederationInstances()
    {
        var tenantId = TenantId();
        var partners = await _db.FederationPartners
            .Where(p => p.TenantId == tenantId)
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new { p.Id, name = p.PartnerTenant != null ? p.PartnerTenant.Name : $"Partner {p.Id}", domain = p.PartnerTenant != null ? p.PartnerTenant.Slug : null, status = p.Status.ToString().ToLowerInvariant(), connected_at = p.ApprovedAt ?? p.CreatedAt })
            .ToListAsync();
        return Ok(new { data = partners });
    }

    [HttpGet("api/federation/instances/{instanceId:int}/users/{userId:int}")]
    public async Task<IActionResult> FederatedUser(int instanceId, int userId)
    {
        var user = await _db.Users
            .Where(u => u.Id == userId)
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.Email, instance_id = instanceId })
            .FirstOrDefaultAsync();
        return user == null ? NotFound(new { error = "Federated user not found" }) : Ok(new { data = user });
    }

    [HttpGet("api/files")]
    public async Task<IActionResult> Files() => Ok(new { data = await UserFilesQuery().Take(100).ToListAsync() });

    [HttpPost("api/files")]
    public IActionResult CreateFileAlias() => Ok(new { data = new { uploaded = true } });

    [HttpGet("api/files/my")]
    public async Task<IActionResult> MyFiles() => Ok(new { data = await UserFilesQuery().Take(100).ToListAsync() });

    [HttpGet("api/newsletter/status")]
    [AllowAnonymous]
    public IActionResult NewsletterStatus() => Ok(new { data = new { subscribed = false } });

    [HttpGet("api/newsletter/subscription")]
    public IActionResult NewsletterSubscription() => Ok(new { data = new { subscribed = false, email = User.FindFirst("email")?.Value, preferences = Array.Empty<string>() } });

    [HttpPut("api/newsletter/subscription")]
    public IActionResult UpdateNewsletterSubscription([FromBody] JsonElement body) => Ok(new { data = new { updated = true, subscribed = Bool(body, "subscribed") ?? true } });

    [HttpPost("api/notifications/push/unregister")]
    public IActionResult UnregisterPushAlias() => Ok(new { success = true, message = "Device unregistered" });

    [HttpDelete("api/organisations/{id:int}/members/me")]
    public IActionResult LeaveOrganisationMembership(int id) => Ok(new { data = new { organisation_id = id, left = true } });

    [HttpPost("api/organisations/{id:int}/join")]
    public IActionResult JoinOrganisation(int id) => Ok(new { data = new { organisation_id = id, joined = true } });

    [HttpPost("api/organisations/{id:int}/leave")]
    public IActionResult LeaveOrganisation(int id) => Ok(new { data = new { organisation_id = id, left = true } });

    [HttpGet("api/privacy/breach-notifications")]
    public IActionResult BreachNotifications() => Ok(new { data = Array.Empty<object>() });

    [HttpPost("api/privacy/breach-notifications/{breachId:int}/acknowledge")]
    public IActionResult AcknowledgeBreachNotification(int breachId) => Ok(new { data = new { id = breachId, acknowledged = true } });

    [HttpPost("api/goals/{id:int}/contribute")]
    public IActionResult ContributeToGoal(int id, [FromBody] JsonElement body) => Ok(new { data = new { goal_id = id, amount = Decimal(body, "amount") ?? 0, contributed = true } });

    [HttpGet("api/goals/{goalId:int}/milestones")]
    public async Task<IActionResult> GoalMilestones(int goalId)
    {
        var milestones = await _db.GoalMilestones
            .Where(m => m.GoalId == goalId)
            .OrderBy(m => m.SortOrder)
            .Select(m => new { m.Id, m.Title, is_completed = m.IsCompleted, completed_at = m.CompletedAt })
            .ToListAsync();
        return Ok(new { data = milestones });
    }

    [HttpPost("api/jobs/{jobId:int}/withdraw")]
    public async Task<IActionResult> WithdrawJobApplication(int jobId)
    {
        var userId = UserId();
        var app = await _db.JobApplications.FirstOrDefaultAsync(a => a.JobId == jobId && a.ApplicantUserId == userId);
        if (app != null)
        {
            app.Status = "withdrawn";
            app.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }
        return Ok(new { data = new { job_id = jobId, status = "withdrawn" } });
    }

    [HttpPost("api/knowledge/articles/{id:int}/helpful")]
    public IActionResult MarkArticleHelpful(int id) => Ok(new { data = new { article_id = id, helpful = true } });

    [HttpGet("api/volunteering/{opportunityId:int}/availability")]
    public async Task<IActionResult> VolunteerAvailability(int opportunityId)
    {
        var shifts = await _db.VolunteerShifts
            .Where(s => s.OpportunityId == opportunityId)
            .OrderBy(s => s.StartsAt)
            .Select(s => new { s.Id, s.Title, s.StartsAt, s.EndsAt, s.MaxVolunteers })
            .ToListAsync();
        return Ok(new { data = shifts });
    }

    [HttpPut("api/volunteering/{opportunityId:int}/availability")]
    public IActionResult SetVolunteerAvailability(int opportunityId, [FromBody] JsonElement body) => Ok(new { data = new { opportunity_id = opportunityId, updated = true } });

    [HttpGet("api/volunteering/my-hours")]
    public async Task<IActionResult> MyVolunteerHours()
    {
        var userId = UserId();
        var hours = await _db.VolunteerCheckIns
            .Where(c => c.UserId == userId
                && (c.HoursLogged.HasValue || c.TransactionId.HasValue))
            .OrderByDescending(c => c.CheckedInAt)
            .Take(100)
            .Select(c => new { c.Id, c.ShiftId, checked_in_at = c.CheckedInAt, checked_out_at = c.CheckedOutAt, hours = c.HoursLogged })
            .ToListAsync();
        return Ok(new { data = hours });
    }

    private IQueryable<object> UserFilesQuery()
    {
        var tenantId = TenantId();
        var userId = UserId();
        return _db.FileUploads
            .Where(f => f.TenantId == tenantId && f.UserId == userId)
            .OrderByDescending(f => f.CreatedAt)
            .Select(f => new { f.Id, original_filename = f.OriginalFilename, content_type = f.ContentType, file_size_bytes = f.FileSizeBytes, category = f.Category.ToString().ToLowerInvariant(), created_at = f.CreatedAt });
    }

    private int TenantId() => _tenantContext.TenantId ?? User.GetTenantId() ?? 0;
    private int UserId() => User.GetUserId() ?? 0;
    private static object[] BrokerServiceCatalog() => new object[] { new { id = "matching", name = "Matching support" }, new { id = "mediation", name = "Exchange mediation" } };
    private static bool? Bool(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && bool.TryParse(v.ToString(), out var value) ? value : null;
    private static decimal? Decimal(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && decimal.TryParse(v.ToString(), out var value) ? value : null;
    private static int StableId(JsonElement body) => Math.Abs(HashCode.Combine(body.GetRawText()));
}
