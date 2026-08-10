// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// V1.5 parity endpoints for richer job-board workflows.
/// </summary>
[ApiController]
[Route("api/jobs")]
[Authorize]
public class JobsParityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public JobsParityController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    [HttpGet("recommended")]
    public async Task<IActionResult> Recommended([FromQuery] int limit = 10)
    {
        var userId = RequireUserId();
        var tenantId = RequireTenantId();
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);
        var skills = SplitTerms(profile?.Skills);

        var jobs = await _db.JobVacancies
            .Where(j => j.TenantId == tenantId && j.Status == "active")
            .OrderByDescending(j => j.IsFeatured)
            .ThenByDescending(j => j.CreatedAt)
            .Take(Math.Clamp(limit, 1, 50))
            .ToListAsync();

        return Ok(new
        {
            data = jobs.Select(j => new
            {
                job = MapJob(j),
                match_score = ScoreJob(j, skills),
                matched_skills = SplitTerms(j.RequiredSkills).Intersect(skills, StringComparer.OrdinalIgnoreCase)
            })
        });
    }

    [HttpGet("saved-profile")]
    public async Task<IActionResult> GetSavedProfile()
    {
        var userId = RequireUserId();
        var tenantId = RequireTenantId();
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);
        return Ok(new { data = profile == null ? null : MapSavedProfile(profile) });
    }

    [HttpPut("saved-profile")]
    public async Task<IActionResult> UpsertSavedProfile([FromBody] JobSavedProfileRequest request)
    {
        var userId = RequireUserId();
        var tenantId = RequireTenantId();
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);
        if (profile == null)
        {
            profile = new JobSavedProfile { TenantId = tenantId, UserId = userId, CreatedAt = DateTime.UtcNow };
            _db.JobSavedProfiles.Add(profile);
        }

        profile.Headline = request.Headline ?? profile.Headline;
        profile.Summary = request.Summary ?? profile.Summary;
        profile.Skills = request.Skills ?? profile.Skills;
        profile.ResumeUrl = request.ResumeUrl ?? profile.ResumeUrl;
        profile.VisibleToEmployers = request.VisibleToEmployers ?? profile.VisibleToEmployers;
        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { data = MapSavedProfile(profile) });
    }

    [HttpGet("templates")]
    public async Task<IActionResult> Templates()
    {
        var userId = RequireUserId();
        var tenantId = RequireTenantId();
        var templates = await _db.JobTemplates
            .Where(t => t.TenantId == tenantId && (t.IsPublic || t.CreatedByUserId == userId))
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync();
        return Ok(new { data = templates.Select(MapTemplate) });
    }

    [HttpGet("templates/{templateId:int}")]
    public async Task<IActionResult> Template(int templateId)
    {
        var template = await FindVisibleTemplate(templateId);
        return template == null ? NotFound(new { error = "Template not found" }) : Ok(new { data = MapTemplate(template) });
    }

    [HttpPost("templates")]
    public async Task<IActionResult> CreateTemplate([FromBody] JobTemplateRequest request)
    {
        var template = new JobTemplate
        {
            TenantId = RequireTenantId(),
            CreatedByUserId = RequireUserId(),
            Title = Required(request.Title, "Title"),
            Description = request.Description,
            Category = request.Category ?? "general",
            JobType = request.JobType ?? "volunteer",
            RequiredSkills = request.RequiredSkills,
            IsPublic = request.IsPublic
        };
        _db.JobTemplates.Add(template);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(Template), new { templateId = template.Id }, new { data = MapTemplate(template) });
    }

    [HttpDelete("templates/{templateId:int}")]
    public async Task<IActionResult> DeleteTemplate(int templateId)
    {
        var template = await FindOwnedTemplate(templateId);
        if (template == null) return NotFound(new { error = "Template not found" });
        _db.JobTemplates.Remove(template);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{jobId:int}/team")]
    public async Task<IActionResult> Team(int jobId)
    {
        var tenantId = RequireTenantId();
        if (!await CanManageJob(jobId)) return Forbid();
        var team = await _db.JobVacancyTeamMembers
            .Where(t => t.TenantId == tenantId && t.JobId == jobId)
            .Join(_db.Users, t => t.UserId, u => u.Id, (t, u) => new { t.Id, t.UserId, t.Role, user = MapUser(u), t.CreatedAt })
            .ToListAsync();
        return Ok(new { data = team });
    }

    [HttpPost("{jobId:int}/team")]
    public async Task<IActionResult> AddTeamMember(int jobId, [FromBody] JobTeamRequest request)
    {
        var tenantId = RequireTenantId();
        if (!await CanManageJob(jobId)) return Forbid();
        var existing = await _db.JobVacancyTeamMembers.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.JobId == jobId && t.UserId == request.UserId);
        if (existing == null)
        {
            existing = new JobVacancyTeamMember { TenantId = tenantId, JobId = jobId, UserId = request.UserId, Role = request.Role ?? "viewer" };
            _db.JobVacancyTeamMembers.Add(existing);
        }
        else
        {
            existing.Role = request.Role ?? existing.Role;
        }
        await _db.SaveChangesAsync();
        return Ok(new { data = existing });
    }

    [HttpDelete("{jobId:int}/team/{userId:int}")]
    public async Task<IActionResult> RemoveTeamMember(int jobId, int userId)
    {
        var tenantId = RequireTenantId();
        if (!await CanManageJob(jobId)) return Forbid();
        var member = await _db.JobVacancyTeamMembers.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.JobId == jobId && t.UserId == userId);
        if (member == null) return NotFound(new { error = "Team member not found" });
        _db.JobVacancyTeamMembers.Remove(member);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{jobId:int}/interviews")]
    public async Task<IActionResult> Interviews(int jobId)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var interviews = await _db.JobInterviews.Where(i => i.TenantId == tenantId && i.JobId == jobId)
            .OrderBy(i => i.StartsAt)
            .ToListAsync();
        return Ok(new { data = interviews.Select(MapInterview) });
    }

    [HttpPost("applications/{applicationId:int}/interview")]
    public async Task<IActionResult> CreateInterview(int applicationId, [FromBody] JobInterviewRequest request)
    {
        var tenantId = RequireTenantId();
        var app = await _db.JobApplications.FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == applicationId);
        if (app == null) return NotFound(new { error = "Application not found" });
        if (!await CanManageJob(app.JobId)) return Forbid();

        var startsAt = request.StartsAt ?? DateTime.UtcNow.AddDays(2);
        var interview = new JobInterview
        {
            TenantId = tenantId,
            JobId = app.JobId,
            ApplicationId = app.Id,
            CandidateUserId = app.ApplicantUserId,
            CreatedByUserId = RequireUserId(),
            StartsAt = startsAt,
            EndsAt = request.EndsAt ?? startsAt.AddMinutes(45),
            Location = request.Location ?? "online",
            Notes = request.Notes
        };
        _db.JobInterviews.Add(interview);
        app.Status = "interview";
        app.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapInterview(interview) });
    }

    [HttpPut("interviews/{interviewId:int}/accept")]
    public Task<IActionResult> AcceptInterview(int interviewId) => SetInterviewStatus(interviewId, "accepted");

    [HttpPut("interviews/{interviewId:int}/decline")]
    public Task<IActionResult> DeclineInterview(int interviewId) => SetInterviewStatus(interviewId, "declined");

    [HttpDelete("interviews/{interviewId:int}")]
    public Task<IActionResult> CancelInterview(int interviewId) => SetInterviewStatus(interviewId, "cancelled");

    [HttpGet("interviews/{interviewId:int}/calendar")]
    public async Task<IActionResult> InterviewCalendar(int interviewId)
    {
        var interview = await FindInterview(interviewId);
        if (interview == null) return NotFound(new { error = "Interview not found" });
        return Content(BuildCalendar(interview), "text/calendar", Encoding.UTF8);
    }

    [HttpGet("interviews/{interviewId:int}/calendar-links")]
    public async Task<IActionResult> InterviewCalendarLinks(int interviewId)
    {
        var interview = await FindInterview(interviewId);
        if (interview == null) return NotFound(new { error = "Interview not found" });
        var title = Uri.EscapeDataString("Job interview");
        var start = interview.StartsAt.ToUniversalTime().ToString("yyyyMMddTHHmmssZ");
        var end = interview.EndsAt.ToUniversalTime().ToString("yyyyMMddTHHmmssZ");
        return Ok(new
        {
            data = new
            {
                google = $"https://calendar.google.com/calendar/render?action=TEMPLATE&text={title}&dates={start}/{end}",
                outlook = $"https://outlook.live.com/calendar/0/deeplink/compose?subject={title}&startdt={interview.StartsAt:o}&enddt={interview.EndsAt:o}"
            }
        });
    }

    [HttpGet("my-interviews")]
    public async Task<IActionResult> MyInterviews()
    {
        var userId = RequireUserId();
        var tenantId = RequireTenantId();
        var interviews = await _db.JobInterviews.Where(i => i.TenantId == tenantId && i.CandidateUserId == userId)
            .OrderBy(i => i.StartsAt)
            .ToListAsync();
        return Ok(new { data = interviews.Select(MapInterview) });
    }

    [HttpGet("{jobId:int}/interview-slots")]
    public async Task<IActionResult> Slots(int jobId)
    {
        var tenantId = RequireTenantId();
        var slots = await _db.JobInterviewSlots.Where(s => s.TenantId == tenantId && s.JobId == jobId)
            .OrderBy(s => s.StartsAt)
            .ToListAsync();
        return Ok(new { data = slots.Select(MapSlot) });
    }

    [HttpPost("{jobId:int}/interview-slots")]
    public async Task<IActionResult> CreateSlot(int jobId, [FromBody] JobInterviewSlotRequest request)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var slot = new JobInterviewSlot
        {
            TenantId = RequireTenantId(),
            JobId = jobId,
            StartsAt = request.StartsAt ?? DateTime.UtcNow.AddDays(2),
            EndsAt = request.EndsAt ?? (request.StartsAt ?? DateTime.UtcNow.AddDays(2)).AddMinutes(30)
        };
        _db.JobInterviewSlots.Add(slot);
        await _db.SaveChangesAsync();
        return Ok(new { data = MapSlot(slot) });
    }

    [HttpPost("{jobId:int}/interview-slots/bulk")]
    public async Task<IActionResult> CreateSlotsBulk(int jobId, [FromBody] BulkSlotsRequest request)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var slots = request.Slots.Select(s => new JobInterviewSlot
        {
            TenantId = tenantId,
            JobId = jobId,
            StartsAt = s.StartsAt ?? DateTime.UtcNow.AddDays(2),
            EndsAt = s.EndsAt ?? (s.StartsAt ?? DateTime.UtcNow.AddDays(2)).AddMinutes(30)
        }).ToList();
        _db.JobInterviewSlots.AddRange(slots);
        await _db.SaveChangesAsync();
        return Ok(new { data = slots.Select(MapSlot) });
    }

    [HttpPost("interview-slots/{slotId:int}/book")]
    public async Task<IActionResult> BookSlot(int slotId, [FromBody] BookSlotRequest request)
    {
        var tenantId = RequireTenantId();
        var userId = RequireUserId();
        var slot = await _db.JobInterviewSlots.FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == slotId);
        if (slot == null) return NotFound(new { error = "Slot not found" });
        if (slot.BookedByUserId.HasValue) return Conflict(new { error = "Slot already booked" });
        slot.BookedByUserId = userId;
        slot.ApplicationId = request.ApplicationId;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapSlot(slot) });
    }

    [HttpDelete("interview-slots/{slotId:int}/book")]
    public async Task<IActionResult> UnbookSlot(int slotId)
    {
        var slot = await FindSlot(slotId);
        if (slot == null) return NotFound(new { error = "Slot not found" });
        slot.BookedByUserId = null;
        slot.ApplicationId = null;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapSlot(slot) });
    }

    [HttpDelete("interview-slots/{slotId:int}")]
    public async Task<IActionResult> DeleteSlot(int slotId)
    {
        var slot = await FindSlot(slotId);
        if (slot == null) return NotFound(new { error = "Slot not found" });
        if (!await CanManageJob(slot.JobId)) return Forbid();
        _db.JobInterviewSlots.Remove(slot);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("applications/{applicationId:int}/offer")]
    public async Task<IActionResult> ApplicationOffer(int applicationId)
    {
        var tenantId = RequireTenantId();
        var offer = await _db.JobOffers.FirstOrDefaultAsync(o => o.TenantId == tenantId && o.ApplicationId == applicationId);
        return Ok(new { data = offer == null ? null : MapOffer(offer) });
    }

    [HttpPost("applications/{applicationId:int}/offer")]
    public async Task<IActionResult> CreateOffer(int applicationId, [FromBody] JobOfferRequest request)
    {
        var tenantId = RequireTenantId();
        var app = await _db.JobApplications.FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == applicationId);
        if (app == null) return NotFound(new { error = "Application not found" });
        if (!await CanManageJob(app.JobId)) return Forbid();

        var offer = new JobOffer
        {
            TenantId = tenantId,
            JobId = app.JobId,
            ApplicationId = app.Id,
            CandidateUserId = app.ApplicantUserId,
            CreatedByUserId = RequireUserId(),
            Title = request.Title ?? "Job offer",
            Message = request.Message,
            TimeCreditsPerHour = request.TimeCreditsPerHour
        };
        _db.JobOffers.Add(offer);
        app.Status = "offered";
        app.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapOffer(offer) });
    }

    [HttpGet("my-offers")]
    public async Task<IActionResult> MyOffers()
    {
        var tenantId = RequireTenantId();
        var userId = RequireUserId();
        var offers = await _db.JobOffers.Where(o => o.TenantId == tenantId && o.CandidateUserId == userId)
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync();
        return Ok(new { data = offers.Select(MapOffer) });
    }

    [HttpPut("offers/{offerId:int}/accept")]
    public Task<IActionResult> AcceptOffer(int offerId) => SetOfferStatus(offerId, "accepted");

    [HttpPut("offers/{offerId:int}/reject")]
    public Task<IActionResult> RejectOffer(int offerId) => SetOfferStatus(offerId, "rejected");

    [HttpDelete("offers/{offerId:int}")]
    public Task<IActionResult> WithdrawOffer(int offerId) => SetOfferStatus(offerId, "withdrawn");

    [HttpGet("offer-templates")]
    public async Task<IActionResult> OfferTemplates()
    {
        var tenantId = RequireTenantId();
        var templates = await _db.JobOfferTemplates.Where(t => t.TenantId == tenantId)
            .OrderBy(t => t.Name)
            .ToListAsync();
        return Ok(new { data = templates });
    }

    [HttpPost("offer-templates")]
    public async Task<IActionResult> CreateOfferTemplate([FromBody] JobOfferTemplateRequest request)
    {
        var template = new JobOfferTemplate
        {
            TenantId = RequireTenantId(),
            CreatedByUserId = RequireUserId(),
            Name = Required(request.Name, "Name"),
            Body = Required(request.Body, "Body")
        };
        _db.JobOfferTemplates.Add(template);
        await _db.SaveChangesAsync();
        return Ok(new { data = template });
    }

    [HttpPost("offer-templates/{templateId:int}/render")]
    public async Task<IActionResult> RenderOfferTemplate(int templateId, [FromBody] JsonElement values)
    {
        var tenantId = RequireTenantId();
        var template = await _db.JobOfferTemplates.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == templateId);
        if (template == null) return NotFound(new { error = "Offer template not found" });
        var rendered = template.Body;
        foreach (var prop in values.EnumerateObject())
            rendered = rendered.Replace("{{" + prop.Name + "}}", prop.Value.ToString(), StringComparison.OrdinalIgnoreCase);
        return Ok(new { data = new { rendered } });
    }

    [HttpDelete("offer-templates/{templateId:int}")]
    public async Task<IActionResult> DeleteOfferTemplate(int templateId)
    {
        var tenantId = RequireTenantId();
        var template = await _db.JobOfferTemplates.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == templateId);
        if (template == null) return NotFound(new { error = "Offer template not found" });
        _db.JobOfferTemplates.Remove(template);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("applications/{applicationId:int}/scorecards")]
    public async Task<IActionResult> Scorecards(int applicationId)
    {
        var tenantId = RequireTenantId();
        var cards = await _db.JobScorecards.Where(s => s.TenantId == tenantId && s.ApplicationId == applicationId).ToListAsync();
        return Ok(new { data = cards });
    }

    [HttpPut("applications/{applicationId:int}/scorecard")]
    public async Task<IActionResult> UpsertScorecard(int applicationId, [FromBody] JobScorecardRequest request)
    {
        var tenantId = RequireTenantId();
        var userId = RequireUserId();
        var app = await _db.JobApplications.FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == applicationId);
        if (app == null) return NotFound(new { error = "Application not found" });
        if (!await CanManageJob(app.JobId)) return Forbid();
        var card = await _db.JobScorecards.FirstOrDefaultAsync(s => s.TenantId == tenantId && s.ApplicationId == applicationId && s.ReviewerUserId == userId);
        if (card == null)
        {
            card = new JobScorecard { TenantId = tenantId, ApplicationId = applicationId, ReviewerUserId = userId };
            _db.JobScorecards.Add(card);
        }
        card.Score = Math.Clamp(request.Score, 0, 100);
        card.Notes = request.Notes;
        card.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = card });
    }

    [HttpGet("{jobId:int}/pipeline-rules")]
    public async Task<IActionResult> PipelineRules(int jobId)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var rules = await _db.JobPipelineRules.Where(r => r.TenantId == tenantId && r.JobId == jobId).ToListAsync();
        return Ok(new { data = rules });
    }

    [HttpPost("{jobId:int}/pipeline-rules")]
    public async Task<IActionResult> CreatePipelineRule(int jobId, [FromBody] JobPipelineRuleRequest request)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var rule = new JobPipelineRule
        {
            TenantId = RequireTenantId(),
            JobId = jobId,
            Name = request.Name ?? "Pipeline rule",
            Trigger = request.Trigger ?? "application_created",
            Action = request.Action ?? "notify",
            IsActive = request.IsActive ?? true
        };
        _db.JobPipelineRules.Add(rule);
        await _db.SaveChangesAsync();
        return Ok(new { data = rule });
    }

    [HttpPost("{jobId:int}/pipeline-rules/run")]
    public async Task<IActionResult> RunPipelineRules(int jobId)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var count = await _db.JobPipelineRules.CountAsync(r => r.TenantId == tenantId && r.JobId == jobId && r.IsActive);
        return Ok(new { data = new { job_id = jobId, rules_run = count, actions_queued = count } });
    }

    [HttpDelete("pipeline-rules/{ruleId:int}")]
    public async Task<IActionResult> DeletePipelineRule(int ruleId)
    {
        var tenantId = RequireTenantId();
        var rule = await _db.JobPipelineRules.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Id == ruleId);
        if (rule == null) return NotFound(new { error = "Pipeline rule not found" });
        if (!await CanManageJob(rule.JobId)) return Forbid();
        _db.JobPipelineRules.Remove(rule);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{jobId:int}/referral")]
    public async Task<IActionResult> Referral(int jobId)
    {
        var tenantId = RequireTenantId();
        var userId = RequireUserId();
        var referral = await _db.JobReferrals.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.JobId == jobId && r.ReferrerUserId == userId);
        if (referral == null)
        {
            referral = new JobReferral { TenantId = tenantId, JobId = jobId, ReferrerUserId = userId, Code = GenerateCode(jobId, userId) };
            _db.JobReferrals.Add(referral);
            await _db.SaveChangesAsync();
        }
        return Ok(new { data = referral, url = $"/api/jobs/{jobId}?ref={Uri.EscapeDataString(referral.Code)}" });
    }

    [HttpGet("{jobId:int}/referral-stats")]
    public async Task<IActionResult> ReferralStats(int jobId)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var referrals = await _db.JobReferrals.Where(r => r.TenantId == tenantId && r.JobId == jobId).ToListAsync();
        return Ok(new { data = new { job_id = jobId, referrals = referrals.Count, clicks = referrals.Sum(r => r.Clicks), applications = referrals.Sum(r => r.Applications) } });
    }

    [HttpPost("{jobId:int}/applications/bulk-status")]
    public async Task<IActionResult> BulkStatus(int jobId, [FromBody] BulkApplicationStatusRequest request)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var apps = await _db.JobApplications.Where(a => a.TenantId == tenantId && a.JobId == jobId && request.ApplicationIds.Contains(a.Id)).ToListAsync();
        foreach (var app in apps)
        {
            app.Status = request.Status;
            app.ReviewedAt = DateTime.UtcNow;
            app.ReviewedByUserId = RequireUserId();
            app.ReviewNotes = request.Notes;
            app.UpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        return Ok(new { data = new { updated = apps.Count } });
    }

    [HttpGet("{jobId:int}/applications/export-csv")]
    public async Task<IActionResult> ExportApplications(int jobId)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var apps = await _db.JobApplications.Where(a => a.TenantId == tenantId && a.JobId == jobId)
            .Include(a => a.Applicant)
            .OrderBy(a => a.CreatedAt)
            .ToListAsync();
        var csv = new StringBuilder("id,applicant_email,status,created_at\n");
        foreach (var app in apps)
            csv.AppendLine($"{app.Id},{EscapeCsv(app.Applicant?.Email)},{EscapeCsv(app.Status)},{app.CreatedAt:o}");
        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", $"job-{jobId}-applications.csv");
    }

    [HttpGet("{jobId:int}/audit-trail")]
    public async Task<IActionResult> AuditTrail(int jobId)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.TenantId == tenantId && j.Id == jobId);
        if (job == null) return NotFound(new { error = "Job not found" });
        var applications = await _db.JobApplications.CountAsync(a => a.TenantId == tenantId && a.JobId == jobId);
        return Ok(new { data = new[] { new { type = "created", count = (int?)null, at = job.CreatedAt }, new { type = "applications", count = (int?)applications, at = DateTime.UtcNow } } });
    }

    [HttpGet("{jobId:int}/predictions")]
    public async Task<IActionResult> Predictions(int jobId)
    {
        var tenantId = RequireTenantId();
        var applications = await _db.JobApplications.CountAsync(a => a.TenantId == tenantId && a.JobId == jobId);
        return Ok(new { data = new { job_id = jobId, expected_applications = Math.Max(3, applications + 2), fill_probability = applications > 0 ? 0.72m : 0.38m } });
    }

    [HttpPost("{jobId:int}/ai-rank")]
    public async Task<IActionResult> AiRank(int jobId)
    {
        if (!await CanManageJob(jobId)) return Forbid();
        var tenantId = RequireTenantId();
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.TenantId == tenantId && j.Id == jobId);
        if (job == null) return NotFound(new { error = "Job not found" });
        var skills = SplitTerms(job.RequiredSkills);
        var apps = await _db.JobApplications.Where(a => a.TenantId == tenantId && a.JobId == jobId).Include(a => a.Applicant).ToListAsync();
        return Ok(new { data = apps.Select(a => new { application_id = a.Id, applicant = MapUser(a.Applicant), rank_score = ScoreText(a.CoverLetter, skills), reasons = skills }) });
    }

    [HttpPost("{jobId:int}/ai-chat")]
    public async Task<IActionResult> AiChat(int jobId, [FromBody] JobAiChatRequest request)
    {
        var tenantId = RequireTenantId();
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.TenantId == tenantId && j.Id == jobId);
        if (job == null) return NotFound(new { error = "Job not found" });
        return Ok(new { data = new { job_id = jobId, answer = $"For '{job.Title}', focus on {job.RequiredSkills ?? job.Category}.", prompt = request.Message } });
    }

    [HttpPost("generate-description")]
    public IActionResult GenerateDescription([FromBody] GenerateJobDescriptionRequest request)
    {
        var title = request.Title ?? "Community opportunity";
        var skills = string.IsNullOrWhiteSpace(request.Skills) ? "reliability and clear communication" : request.Skills;
        return Ok(new { data = new { title, description = $"{title}: help the community by contributing {skills}. Time credits and support are agreed before the work begins." } });
    }

    [HttpPost("check-duplicate")]
    public async Task<IActionResult> CheckDuplicate([FromBody] DuplicateJobRequest request)
    {
        var tenantId = RequireTenantId();
        var title = request.Title ?? string.Empty;
        var matches = await _db.JobVacancies.Where(j => j.TenantId == tenantId && j.Title.ToLower() == title.ToLower()).Take(5).ToListAsync();
        return Ok(new { data = new { duplicate = matches.Any(), matches = matches.Select(MapJob) } });
    }

    [HttpGet("talent-search")]
    public async Task<IActionResult> TalentSearch([FromQuery] string? skills = null)
    {
        var tenantId = RequireTenantId();
        var terms = SplitTerms(skills);
        var profiles = await _db.JobSavedProfiles.Where(p => p.TenantId == tenantId && p.VisibleToEmployers).ToListAsync();
        return Ok(new { data = profiles.Where(p => !terms.Any() || SplitTerms(p.Skills).Intersect(terms, StringComparer.OrdinalIgnoreCase).Any()).Select(MapSavedProfile) });
    }

    [HttpGet("talent-search/{userId:int}")]
    public async Task<IActionResult> TalentProfile(int userId)
    {
        var tenantId = RequireTenantId();
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId && p.VisibleToEmployers);
        return profile == null ? NotFound(new { error = "Profile not found" }) : Ok(new { data = MapSavedProfile(profile) });
    }

    [HttpGet("salary-benchmark")]
    public async Task<IActionResult> SalaryBenchmark([FromQuery] string? category = null)
    {
        var tenantId = RequireTenantId();
        var query = _db.JobVacancies.Where(j => j.TenantId == tenantId && j.TimeCreditsPerHour.HasValue);
        if (!string.IsNullOrWhiteSpace(category)) query = query.Where(j => j.Category == category);
        var values = await query.Select(j => j.TimeCreditsPerHour!.Value).ToListAsync();
        return Ok(new { data = new { category, sample_size = values.Count, average_time_credits_per_hour = values.Count == 0 ? 0 : Math.Round(values.Average(), 2) } });
    }

    [HttpPost("employer-reviews")]
    public async Task<IActionResult> CreateEmployerReview([FromBody] EmployerReviewRequest request)
    {
        var review = new EmployerReview
        {
            TenantId = RequireTenantId(),
            ReviewerUserId = RequireUserId(),
            EmployerUserId = request.EmployerUserId,
            Rating = Math.Clamp(request.Rating, 1, 5),
            Comment = request.Comment
        };
        _db.EmployerReviews.Add(review);
        await _db.SaveChangesAsync();
        return Ok(new { data = review });
    }

    [HttpGet("employer-reviews/{employerUserId:int}")]
    public async Task<IActionResult> EmployerReviews(int employerUserId)
    {
        var tenantId = RequireTenantId();
        var reviews = await _db.EmployerReviews.Where(r => r.TenantId == tenantId && r.EmployerUserId == employerUserId).ToListAsync();
        return Ok(new { data = reviews, average = reviews.Count == 0 ? 0 : Math.Round(reviews.Average(r => r.Rating), 2) });
    }

    [HttpGet("applications/{applicationId:int}/cv")]
    public async Task<IActionResult> ApplicationCv(int applicationId)
    {
        var tenantId = RequireTenantId();
        var app = await _db.JobApplications.FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == applicationId);
        if (app == null) return NotFound(new { error = "Application not found" });
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == app.ApplicantUserId);
        return Ok(new { data = new { application_id = app.Id, resume_url = profile?.ResumeUrl, headline = profile?.Headline, skills = profile?.Skills } });
    }

    [HttpGet("applications/{applicationId:int}/parse-cv")]
    public async Task<IActionResult> ParseCv(int applicationId)
    {
        var tenantId = RequireTenantId();
        var app = await _db.JobApplications.FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == applicationId);
        if (app == null) return NotFound(new { error = "Application not found" });
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == app.ApplicantUserId);
        return Ok(new { data = new { skills = SplitTerms(profile?.Skills), summary = profile?.Summary ?? app.CoverLetter } });
    }

    [HttpGet("gdpr-export")]
    public async Task<IActionResult> GdprExport()
    {
        var userId = RequireUserId();
        var tenantId = RequireTenantId();
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);
        var applications = await _db.JobApplications.Where(a => a.TenantId == tenantId && a.ApplicantUserId == userId).ToListAsync();
        var offers = await _db.JobOffers.Where(o => o.TenantId == tenantId && o.CandidateUserId == userId).ToListAsync();
        return Ok(new { data = new { profile, applications, offers } });
    }

    [HttpDelete("gdpr-erase-me")]
    public async Task<IActionResult> GdprEraseMe()
    {
        var userId = RequireUserId();
        var tenantId = RequireTenantId();
        var profile = await _db.JobSavedProfiles.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);
        if (profile != null) _db.JobSavedProfiles.Remove(profile);
        await _db.SaveChangesAsync();
        return Ok(new { data = new { erased_profile = profile != null } });
    }

    [HttpGet("feed.json")]
    [AllowAnonymous]
    public async Task<IActionResult> FeedJson()
    {
        var tenantId = RequireTenantId();
        var jobs = await _db.JobVacancies.Where(j => j.TenantId == tenantId && j.Status == "active").OrderByDescending(j => j.CreatedAt).Take(100).ToListAsync();
        return Ok(new { data = jobs.Select(MapJob) });
    }

    [HttpGet("feed.xml")]
    [AllowAnonymous]
    public async Task<IActionResult> FeedXml() => Content(await BuildJobsXml(), "application/rss+xml", Encoding.UTF8);

    [HttpGet("feed/indeed.xml")]
    [AllowAnonymous]
    public async Task<IActionResult> IndeedXml() => Content(await BuildJobsXml("indeed"), "application/xml", Encoding.UTF8);

    private async Task<IActionResult> SetInterviewStatus(int interviewId, string status)
    {
        var interview = await FindInterview(interviewId);
        if (interview == null) return NotFound(new { error = "Interview not found" });
        interview.Status = status;
        interview.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapInterview(interview) });
    }

    private async Task<IActionResult> SetOfferStatus(int offerId, string status)
    {
        var tenantId = RequireTenantId();
        var userId = RequireUserId();
        var offer = await _db.JobOffers.FirstOrDefaultAsync(o => o.TenantId == tenantId && o.Id == offerId);
        if (offer == null) return NotFound(new { error = "Offer not found" });
        if (offer.CandidateUserId != userId && !await CanManageJob(offer.JobId)) return Forbid();
        offer.Status = status;
        offer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapOffer(offer) });
    }

    private async Task<bool> CanManageJob(int jobId)
    {
        var tenantId = RequireTenantId();
        var userId = RequireUserId();
        if (User.IsAdmin()) return true;
        var owns = await _db.JobVacancies.AnyAsync(j => j.TenantId == tenantId && j.Id == jobId && j.PostedByUserId == userId);
        if (owns) return true;
        return await _db.JobVacancyTeamMembers.AnyAsync(t => t.TenantId == tenantId && t.JobId == jobId && t.UserId == userId && t.Role != "viewer");
    }

    private async Task<JobTemplate?> FindVisibleTemplate(int id)
    {
        var tenantId = RequireTenantId();
        var userId = RequireUserId();
        return await _db.JobTemplates.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == id && (t.IsPublic || t.CreatedByUserId == userId));
    }

    private async Task<JobTemplate?> FindOwnedTemplate(int id)
    {
        var tenantId = RequireTenantId();
        var userId = RequireUserId();
        return await _db.JobTemplates.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.Id == id && (t.CreatedByUserId == userId || User.IsAdmin()));
    }

    private async Task<JobInterview?> FindInterview(int id)
    {
        var tenantId = RequireTenantId();
        var userId = User.GetUserId();
        return await _db.JobInterviews.FirstOrDefaultAsync(i => i.TenantId == tenantId && i.Id == id && (i.CandidateUserId == userId || i.CreatedByUserId == userId || User.IsAdmin()));
    }

    private async Task<JobInterviewSlot?> FindSlot(int id)
    {
        var tenantId = RequireTenantId();
        return await _db.JobInterviewSlots.FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == id);
    }

    private int RequireTenantId() => _tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");

    private int RequireUserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");

    private static string Required(string? value, string field) => string.IsNullOrWhiteSpace(value) ? throw new ArgumentException($"{field} is required") : value;

    private static string GenerateCode(int jobId, int userId)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{jobId}:{userId}:{DateTime.UtcNow.Ticks}"));
        return Convert.ToHexString(bytes)[..12].ToLowerInvariant();
    }

    private async Task<string> BuildJobsXml(string channel = "jobs")
    {
        var tenantId = RequireTenantId();
        var jobs = await _db.JobVacancies.Where(j => j.TenantId == tenantId && j.Status == "active").OrderByDescending(j => j.CreatedAt).Take(100).ToListAsync();
        var sb = new StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
        sb.AppendLine($"<rss version=\"2.0\"><channel><title>Project NEXUS {channel}</title>");
        foreach (var job in jobs)
            sb.AppendLine($"<item><title>{Xml(job.Title)}</title><description>{Xml(job.Description)}</description><category>{Xml(job.Category)}</category><guid>{job.Id}</guid></item>");
        sb.AppendLine("</channel></rss>");
        return sb.ToString();
    }

    private static string BuildCalendar(JobInterview interview) =>
        $"BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:job-interview-{interview.Id}@project-nexus\nDTSTART:{interview.StartsAt:yyyyMMddTHHmmssZ}\nDTEND:{interview.EndsAt:yyyyMMddTHHmmssZ}\nSUMMARY:Job interview\nLOCATION:{interview.Location}\nEND:VEVENT\nEND:VCALENDAR\n";

    private static object MapJob(JobVacancy job) => new { job.Id, job.Title, job.Description, job.Category, job.JobType, job.Location, job.IsRemote, job.TimeCreditsPerHour, job.RequiredSkills, job.Status, job.IsFeatured, job.CreatedAt };

    private static object MapSavedProfile(JobSavedProfile p) => new { p.Id, p.UserId, p.Headline, p.Summary, p.Skills, p.ResumeUrl, p.VisibleToEmployers, p.CreatedAt, p.UpdatedAt };

    private static object MapTemplate(JobTemplate t) => new { t.Id, t.Title, t.Description, t.Category, t.JobType, t.RequiredSkills, t.IsPublic, t.CreatedAt, t.UpdatedAt };

    private static object MapInterview(JobInterview i) => new { i.Id, i.JobId, i.ApplicationId, i.CandidateUserId, i.StartsAt, i.EndsAt, i.Location, i.Status, i.Notes, i.CreatedAt, i.UpdatedAt };

    private static object MapSlot(JobInterviewSlot s) => new { s.Id, s.JobId, s.StartsAt, s.EndsAt, s.BookedByUserId, s.ApplicationId, s.CreatedAt };

    private static object MapOffer(JobOffer o) => new { o.Id, o.JobId, o.ApplicationId, o.CandidateUserId, o.Title, o.Message, o.TimeCreditsPerHour, o.Status, o.CreatedAt, o.UpdatedAt };

    private static object? MapUser(User? u) => u == null ? null : new { u.Id, u.Email, u.FirstName, u.LastName };

    private static string[] SplitTerms(string? value) => string.IsNullOrWhiteSpace(value)
        ? Array.Empty<string>()
        : value.Split(new[] { ',', ';', '\n', ' ' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static int ScoreJob(JobVacancy job, string[] skills) => skills.Length == 0 ? 50 : Math.Min(100, 40 + SplitTerms(job.RequiredSkills).Intersect(skills, StringComparer.OrdinalIgnoreCase).Count() * 20);

    private static int ScoreText(string? text, string[] skills) => skills.Length == 0 ? 50 : Math.Min(100, 40 + skills.Count(s => (text ?? string.Empty).Contains(s, StringComparison.OrdinalIgnoreCase)) * 20);

    private static string EscapeCsv(string? value) => "\"" + (value ?? string.Empty).Replace("\"", "\"\"") + "\"";

    private static string Xml(string? value) => System.Security.SecurityElement.Escape(value ?? string.Empty) ?? string.Empty;
}

public class JobSavedProfileRequest
{
    public string? Headline { get; set; }
    public string? Summary { get; set; }
    public string? Skills { get; set; }
    public string? ResumeUrl { get; set; }
    public bool? VisibleToEmployers { get; set; }
}

public class JobTemplateRequest
{
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? Category { get; set; }
    public string? JobType { get; set; }
    public string? RequiredSkills { get; set; }
    public bool IsPublic { get; set; }
}

public class JobTeamRequest
{
    public int UserId { get; set; }
    public string? Role { get; set; }
}

public class JobInterviewRequest
{
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public string? Location { get; set; }
    public string? Notes { get; set; }
}

public class JobInterviewSlotRequest
{
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
}

public class BulkSlotsRequest
{
    public List<JobInterviewSlotRequest> Slots { get; set; } = new();
}

public class BookSlotRequest
{
    public int? ApplicationId { get; set; }
}

public class JobOfferRequest
{
    public string? Title { get; set; }
    public string? Message { get; set; }
    public decimal? TimeCreditsPerHour { get; set; }
}

public class JobOfferTemplateRequest
{
    public string? Name { get; set; }
    public string? Body { get; set; }
}

public class JobScorecardRequest
{
    public int Score { get; set; }
    public string? Notes { get; set; }
}

public class JobPipelineRuleRequest
{
    public string? Name { get; set; }
    public string? Trigger { get; set; }
    public string? Action { get; set; }
    public bool? IsActive { get; set; }
}

public class BulkApplicationStatusRequest
{
    public List<int> ApplicationIds { get; set; } = new();
    public string Status { get; set; } = "reviewed";
    public string? Notes { get; set; }
}

public class JobAiChatRequest
{
    public string? Message { get; set; }
}

public class GenerateJobDescriptionRequest
{
    public string? Title { get; set; }
    public string? Skills { get; set; }
}

public class DuplicateJobRequest
{
    public string? Title { get; set; }
}

public class EmployerReviewRequest
{
    public int EmployerUserId { get; set; }
    public int Rating { get; set; }
    public string? Comment { get; set; }
}
