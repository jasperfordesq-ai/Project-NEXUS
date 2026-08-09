// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
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
/// Admin route aliases for the React frontend — Part 2.
/// Covers Newsletters, Broker (extended), Groups (extended), Volunteering, and Federation.
/// Routes here complement (not duplicate) existing AdminBrokerController, AdminGroupsController,
/// and AdminFederationController.
/// </summary>
[ApiController]
[Route("api/admin")]
[Route("api/v2/admin")]
[Authorize(Policy = "AdminOnly")]
public class AdminCompatibility2Controller : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly NewsletterService _newsletter;
    private readonly LocationService _location;
    private readonly FederationService? _federation;
    private readonly AdminVolunteerApprovalService? _volunteerApprovals;
    private readonly ILogger<AdminCompatibility2Controller> _logger;

    public AdminCompatibility2Controller(
        NexusDbContext db,
        TenantContext tenantContext,
        NewsletterService newsletter,
        LocationService location,
        ILogger<AdminCompatibility2Controller> logger,
        FederationService? federation = null,
        AdminVolunteerApprovalService? volunteerApprovals = null)
    {
        _db = db;
        _tenantContext = tenantContext;
        _newsletter = newsletter;
        _location = location;
        _federation = federation;
        _volunteerApprovals = volunteerApprovals;
        _logger = logger;
    }

    // =====================================================================
    // NEWSLETTERS — Core CRUD (wired to NewsletterService)
    // =====================================================================

    /// <summary>GET /api/admin/newsletters - List newsletters.</summary>
    [HttpGet("newsletters")]
    public async Task<IActionResult> ListNewsletters(
        [FromQuery] string? status = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        NewsletterStatus? parsed = null;
        if (!string.IsNullOrEmpty(status) && Enum.TryParse<NewsletterStatus>(status, true, out var s))
            parsed = s;

        var (items, total) = await _newsletter.GetNewslettersAsync(parsed, Math.Max(1, page), Math.Clamp(limit, 1, 100));
        return Ok(new
        {
            data = items.Select(n => MapNewsletter(n)),
            meta = new { page, limit, total }
        });
    }

    /// <summary>GET /api/admin/newsletters/{id} - Get newsletter.</summary>
    [HttpGet("newsletters/{id:int}")]
    public async Task<IActionResult> GetNewsletter(int id)
    {
        var n = await _newsletter.GetNewsletterAsync(id);
        if (n == null) return NotFound(new { error = "Newsletter not found" });
        return Ok(new { data = MapNewsletter(n) });
    }

    /// <summary>POST /api/admin/newsletters - Create newsletter.</summary>
    [HttpPost("newsletters")]
    public async Task<IActionResult> CreateNewsletter([FromBody] CreateNewsletterRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var n = await _newsletter.CreateNewsletterAsync(
            userId.Value, request.Subject, request.ContentHtml, request.ContentText, request.ScheduledAt);
        return Created($"/api/admin/newsletters/{n.Id}", new { data = MapNewsletter(n) });
    }

    /// <summary>PUT /api/admin/newsletters/{id} - Update newsletter.</summary>
    [HttpPut("newsletters/{id:int}")]
    public async Task<IActionResult> UpdateNewsletter(int id, [FromBody] UpdateNewsletterRequest request)
    {
        try
        {
            var n = await _newsletter.UpdateNewsletterAsync(id, request.Subject, request.ContentHtml, request.ContentText, request.ScheduledAt);
            if (n == null) return NotFound(new { error = "Newsletter not found" });
            return Ok(new { data = MapNewsletter(n) });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>DELETE /api/admin/newsletters/{id} - Delete newsletter.</summary>
    [HttpDelete("newsletters/{id:int}")]
    public async Task<IActionResult> DeleteNewsletter(int id)
    {
        var n = await _db.Set<Newsletter>().FirstOrDefaultAsync(x => x.Id == id);
        if (n == null) return NotFound(new { error = "Newsletter not found" });

        _db.Set<Newsletter>().Remove(n);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Newsletter deleted" });
    }

    /// <summary>POST /api/admin/newsletters/{id}/send - Send newsletter.</summary>
    [HttpPost("newsletters/{id:int}/send")]
    public async Task<IActionResult> SendNewsletter(int id)
    {
        try
        {
            var n = await _newsletter.SendNewsletterAsync(id);
            if (n == null) return NotFound(new { error = "Newsletter not found" });
            return Ok(new { data = MapNewsletter(n), message = "Newsletter queued for sending" });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    // =====================================================================
    // NEWSLETTERS — Subscribers
    // =====================================================================

    /// <summary>GET /api/admin/newsletters/subscribers - List subscribers.</summary>
    [HttpGet("newsletters/subscribers")]
    public async Task<IActionResult> ListSubscribers([FromQuery] int page = 1, [FromQuery] int limit = 20, [FromQuery] bool? subscribed = null)
    {
        var (items, total) = await _newsletter.GetSubscribersAsync(Math.Max(1, page), Math.Clamp(limit, 1, 100), subscribed);
        return Ok(new
        {
            data = items.Select(s => new
            {
                s.Id, s.Email, s.UserId, is_subscribed = s.IsSubscribed, s.Source,
                subscribed_at = s.SubscribedAt, unsubscribed_at = s.UnsubscribedAt
            }),
            meta = new { page, limit, total }
        });
    }

    /// <summary>POST /api/admin/newsletters/subscribers - Add subscriber.</summary>
    [HttpPost("newsletters/subscribers")]
    public async Task<IActionResult> AddSubscriber([FromBody] AddSubscriberRequest request)
    {
        var sub = await _newsletter.SubscribeAsync(request.Email, request.UserId, "admin");
        return Created("/api/admin/newsletters/subscribers", new { data = new { sub.Id, sub.Email, is_subscribed = sub.IsSubscribed } });
    }

    /// <summary>DELETE /api/admin/newsletters/subscribers/{id} - Remove subscriber.</summary>
    [HttpDelete("newsletters/subscribers/{id:int}")]
    public async Task<IActionResult> RemoveSubscriber(int id)
    {
        var sub = await _db.Set<NewsletterSubscription>().FirstOrDefaultAsync(s => s.Id == id);
        if (sub == null) return NotFound(new { error = "Subscriber not found" });

        sub.IsSubscribed = false;
        sub.UnsubscribedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { message = "Subscriber removed" });
    }

    /// <summary>POST /api/admin/newsletters/subscribers/import - Import subscribers.</summary>
    [HttpPost("newsletters/subscribers/import")]
    public async Task<IActionResult> ImportSubscribers([FromBody] ImportSubscribersRequest? request)
    {
        request ??= new ImportSubscribersRequest();
        var inputs = new List<ImportSubscriberInput>();

        if (request.Subscribers != null)
        {
            inputs.AddRange(request.Subscribers.Select(s => new ImportSubscriberInput
            {
                Email = s.Email,
                UserId = s.UserId,
                Source = s.Source ?? "import"
            }));
        }

        if (!string.IsNullOrWhiteSpace(request.Csv))
        {
            inputs.AddRange(ParseSubscriberCsv(request.Csv));
        }

        if (inputs.Count == 0)
            return BadRequest(new { error = "Provide subscribers or csv rows to import." });

        var result = await _newsletter.ImportSubscribersAsync(inputs);
        return Ok(new
        {
            message = "Subscribers imported",
            imported = result.Imported,
            updated = result.Updated,
            skipped = result.Skipped
        });
    }

    /// <summary>GET /api/admin/newsletters/subscribers/export - Export subscribers.</summary>
    [HttpGet("newsletters/subscribers/export")]
    public async Task<IActionResult> ExportSubscribers([FromQuery] bool? subscribed = null, [FromQuery] string format = "json")
    {
        var subscribers = await _newsletter.ExportSubscribersAsync(subscribed);

        if (string.Equals(format, "csv", StringComparison.OrdinalIgnoreCase))
        {
            var csv = new StringBuilder();
            csv.AppendLine("id,email,user_id,is_subscribed,source,subscribed_at,unsubscribed_at");
            foreach (var s in subscribers)
            {
                csv.Append(s.Id).Append(',')
                    .Append(EscapeCsv(s.Email)).Append(',')
                    .Append(s.UserId?.ToString() ?? "").Append(',')
                    .Append(s.IsSubscribed).Append(',')
                    .Append(EscapeCsv(s.Source ?? "")).Append(',')
                    .Append(s.SubscribedAt.ToString("O")).Append(',')
                    .Append(s.UnsubscribedAt?.ToString("O") ?? "")
                    .AppendLine();
            }

            return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "newsletter-subscribers.csv");
        }

        return Ok(new
        {
            data = subscribers.Select(s => new
            {
                s.Id,
                s.Email,
                user_id = s.UserId,
                is_subscribed = s.IsSubscribed,
                s.Source,
                subscribed_at = s.SubscribedAt,
                unsubscribed_at = s.UnsubscribedAt
            }),
            meta = new { total = subscribers.Count }
        });
    }

    /// <summary>POST /api/admin/newsletters/subscribers/sync - Sync members as subscribers.</summary>
    [HttpPost("newsletters/subscribers/sync")]
    public async Task<IActionResult> SyncSubscribers()
    {
        var result = await _newsletter.SyncMembersAsSubscribersAsync();
        return Ok(new
        {
            message = "Active members synced as newsletter subscribers",
            eligible_members = result.EligibleMembers,
            created = result.Created,
            updated = result.Updated,
            synced = result.Created + result.Updated
        });
    }

    // =====================================================================
    // NEWSLETTERS — Segments
    // =====================================================================

    /// <summary>GET /api/admin/newsletters/segments - List segments.</summary>
    [HttpGet("newsletters/segments")]
    public IActionResult ListSegments()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>GET /api/admin/newsletters/segments/{id} - Get segment.</summary>
    [HttpGet("newsletters/segments/{id:int}")]
    public IActionResult GetSegment(int id)
        => Ok(new { data = new { id, name = $"Segment {id}", conditions = Array.Empty<object>(), subscriber_count = 0 } });

    /// <summary>POST /api/admin/newsletters/segments - Create segment.</summary>
    [HttpPost("newsletters/segments")]
    public IActionResult CreateSegment([FromBody] object body)
        => Created("/api/admin/newsletters/segments/0", new { data = new { id = 0, name = "New Segment", conditions = Array.Empty<object>(), subscriber_count = 0 } });

    /// <summary>PUT /api/admin/newsletters/segments/{id} - Update segment.</summary>
    [HttpPut("newsletters/segments/{id:int}")]
    public IActionResult UpdateSegment(int id, [FromBody] object body)
        => Ok(new { data = new { id, name = "Updated Segment", conditions = Array.Empty<object>(), subscriber_count = 0 } });

    /// <summary>DELETE /api/admin/newsletters/segments/{id} - Delete segment.</summary>
    [HttpDelete("newsletters/segments/{id:int}")]
    public IActionResult DeleteSegment(int id)
        => Ok(new { message = "Segment deleted" });

    /// <summary>POST /api/admin/newsletters/segments/preview - Preview segment members.</summary>
    [HttpPost("newsletters/segments/preview")]
    public IActionResult PreviewSegment([FromBody] object body)
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>GET /api/admin/newsletters/segments/suggestions - Smart segment suggestions.</summary>
    [HttpGet("newsletters/segments/suggestions")]
    public IActionResult SegmentSuggestions()
        => Ok(new { data = Array.Empty<object>() });

    // =====================================================================
    // NEWSLETTERS — Templates
    // =====================================================================

    /// <summary>GET /api/admin/newsletters/templates - List templates.</summary>
    [HttpGet("newsletters/templates")]
    public IActionResult ListTemplates()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>GET /api/admin/newsletters/templates/{id} - Get template.</summary>
    [HttpGet("newsletters/templates/{id:int}")]
    public IActionResult GetTemplate(int id)
        => Ok(new { data = new { id, name = $"Template {id}", content_html = "", content_text = "", created_at = DateTime.UtcNow } });

    /// <summary>POST /api/admin/newsletters/templates - Create template.</summary>
    [HttpPost("newsletters/templates")]
    public IActionResult CreateTemplate([FromBody] object body)
        => Created("/api/admin/newsletters/templates/0", new { data = new { id = 0, name = "New Template", content_html = "", created_at = DateTime.UtcNow } });

    /// <summary>PUT /api/admin/newsletters/templates/{id} - Update template.</summary>
    [HttpPut("newsletters/templates/{id:int}")]
    public IActionResult UpdateTemplate(int id, [FromBody] object body)
        => Ok(new { data = new { id, name = "Updated Template", content_html = "", updated_at = DateTime.UtcNow } });

    /// <summary>DELETE /api/admin/newsletters/templates/{id} - Delete template.</summary>
    [HttpDelete("newsletters/templates/{id:int}")]
    public IActionResult DeleteTemplate(int id)
        => Ok(new { message = "Template deleted" });

    /// <summary>POST /api/admin/newsletters/templates/{id}/duplicate - Duplicate template.</summary>
    [HttpPost("newsletters/templates/{id:int}/duplicate")]
    public IActionResult DuplicateTemplate(int id)
        => Created($"/api/admin/newsletters/templates/{id}", new { data = new { id = 0, name = $"Copy of Template {id}", created_at = DateTime.UtcNow } });

    /// <summary>GET /api/admin/newsletters/templates/{id}/preview - Preview template.</summary>
    [HttpGet("newsletters/templates/{id:int}/preview")]
    public IActionResult PreviewTemplate(int id)
        => Ok(new { data = new { id, rendered_html = $"<p>Preview of template {id}</p>" } });

    // =====================================================================
    // NEWSLETTERS — Analytics & Diagnostics
    // =====================================================================

    /// <summary>GET /api/admin/newsletters/analytics - Overall newsletter analytics.</summary>
    [HttpGet("newsletters/analytics")]
    public IActionResult NewsletterAnalytics()
        => Ok(new { data = new { total_sent = 0, total_opens = 0, total_clicks = 0, avg_open_rate = 0.0, avg_click_rate = 0.0 } });

    /// <summary>GET /api/admin/newsletters/bounces - Bounce list.</summary>
    [HttpGet("newsletters/bounces")]
    public IActionResult NewsletterBounces()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>GET /api/admin/newsletters/suppression-list - Suppressed emails.</summary>
    [HttpGet("newsletters/suppression-list")]
    public IActionResult SuppressionList()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>POST /api/admin/newsletters/suppression-list/{email}/unsuppress - Unsuppress email.</summary>
    [HttpPost("newsletters/suppression-list/{email}/unsuppress")]
    public IActionResult Unsuppress(string email)
        => Ok(new { message = $"{email} unsuppressed" });

    /// <summary>POST /api/admin/newsletters/suppression-list/{email}/suppress - Suppress email.</summary>
    [HttpPost("newsletters/suppression-list/{email}/suppress")]
    public IActionResult Suppress(string email)
        => Ok(new { message = $"{email} suppressed" });

    /// <summary>GET /api/admin/newsletters/{id}/resend-info - Resend info.</summary>
    [HttpGet("newsletters/{id:int}/resend-info")]
    public async Task<IActionResult> ResendInfo(int id)
    {
        var status = await _newsletter.GetDispatchStatusAsync(id);
        if (status == null) return NotFound(new { error = "Newsletter not found" });

        var canResend = status.Status is NewsletterStatus.Queued or NewsletterStatus.Sending or NewsletterStatus.Sent;
        return Ok(new
        {
            data = new
            {
                newsletter_id = id,
                can_resend = canResend,
                status = status.Status.ToString(),
                recipient_count = status.RecipientCount,
                provider_configured = status.ProviderConfigured,
                provider = status.Provider,
                reason = canResend ? "Newsletter can be re-queued locally." : "Only queued, sending, or sent newsletters can be resent."
            }
        });
    }

    /// <summary>POST /api/admin/newsletters/{id}/resend - Resend newsletter.</summary>
    [HttpPost("newsletters/{id:int}/resend")]
    public async Task<IActionResult> Resend(int id)
    {
        try
        {
            var newsletter = await _newsletter.ResendNewsletterAsync(id);
            if (newsletter == null) return NotFound(new { error = "Newsletter not found" });
            return Ok(new { message = "Newsletter re-queued for dispatch", data = MapNewsletter(newsletter) });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>GET /api/admin/newsletters/send-time-optimizer - Send time optimization data.</summary>
    [HttpGet("newsletters/send-time-optimizer")]
    public IActionResult SendTimeOptimizer()
        => Ok(new { data = new { best_day = "Tuesday", best_hour = 10, timezone = "UTC", confidence = 0.0 } });

    /// <summary>GET /api/admin/newsletters/diagnostics - Newsletter diagnostics.</summary>
    [HttpGet("newsletters/diagnostics")]
    public async Task<IActionResult> NewsletterDiagnostics()
    {
        var queued = await _db.Set<Newsletter>().CountAsync(n => n.Status == NewsletterStatus.Queued);
        var sending = await _db.Set<Newsletter>().CountAsync(n => n.Status == NewsletterStatus.Sending);
        var sent = await _db.Set<Newsletter>().CountAsync(n => n.Status == NewsletterStatus.Sent);
        var activeSubscribers = await _newsletter.CountRecipientsAsync(true);

        return Ok(new
        {
            data = new
            {
                email_provider = "not_configured",
                provider_configured = false,
                active_subscribers = activeSubscribers,
                queued,
                sending,
                sent,
                delivery_rate = sent + queued + sending == 0 ? 0.0 : Math.Round(sent / (double)(sent + queued + sending), 4),
                issues = new[] { "Newsletter dispatch provider/background worker is not configured; sends are queued locally." }
            }
        });
    }

    /// <summary>GET /api/admin/newsletters/bounce-trends - Bounce trends.</summary>
    [HttpGet("newsletters/bounce-trends")]
    public IActionResult BounceTrends()
        => Ok(new { data = Array.Empty<object>() });

    /// <summary>GET /api/admin/newsletters/{id}/stats - Per-newsletter stats.</summary>
    [HttpGet("newsletters/{id:int}/stats")]
    public async Task<IActionResult> NewsletterStats(int id)
    {
        var newsletter = await _newsletter.GetNewsletterAsync(id);
        if (newsletter == null) return NotFound(new { error = "Newsletter not found" });

        return Ok(new
        {
            data = new
            {
                newsletter_id = id,
                status = newsletter.Status.ToString(),
                sent = newsletter.Status == NewsletterStatus.Sent ? newsletter.RecipientCount : 0,
                queued = newsletter.Status == NewsletterStatus.Queued ? newsletter.RecipientCount : 0,
                opens = newsletter.OpenCount,
                clicks = newsletter.ClickCount,
                bounces = 0,
                unsubscribes = await _db.Set<NewsletterSubscription>().CountAsync(s => !s.IsSubscribed),
                open_rate = newsletter.RecipientCount == 0 ? 0.0 : Math.Round(newsletter.OpenCount / (double)newsletter.RecipientCount, 4),
                click_rate = newsletter.RecipientCount == 0 ? 0.0 : Math.Round(newsletter.ClickCount / (double)newsletter.RecipientCount, 4)
            }
        });
    }

    /// <summary>POST /api/admin/newsletters/{id}/ab-winner - Select A/B winner.</summary>
    [HttpPost("newsletters/{id:int}/ab-winner")]
    public async Task<IActionResult> SelectAbWinner(int id, [FromBody] JsonElement body)
    {
        var newsletter = await _newsletter.GetNewsletterAsync(id);
        if (newsletter == null) return NotFound(new { error = "Newsletter not found" });

        return Conflict(new
        {
            error = "No persisted A/B test variants exist for this newsletter.",
            newsletter_id = id,
            status = newsletter.Status.ToString(),
            supported = false
        });
    }

    /// <summary>POST /api/admin/newsletters/{id}/send-test - Send test email.</summary>
    [HttpPost("newsletters/{id:int}/send-test")]
    public async Task<IActionResult> SendTestEmail(int id, [FromBody] SendTestEmailRequest? request)
    {
        if (string.IsNullOrWhiteSpace(request?.Email) || !request.Email.Contains('@'))
            return BadRequest(new { error = "A valid email is required." });

        var userId = User.GetUserId();
        var log = await _newsletter.QueueTestEmailLogAsync(id, request.Email, userId);
        if (log == null) return NotFound(new { error = "Newsletter not found" });

        return Ok(new
        {
            message = "Test email queued locally",
            newsletter_id = id,
            email_log_id = log.Id,
            status = log.Status.ToString(),
            provider_configured = false
        });
    }

    /// <summary>POST /api/admin/newsletters/recipient-count - Get recipient count for criteria.</summary>
    [HttpPost("newsletters/recipient-count")]
    public async Task<IActionResult> RecipientCount([FromBody] JsonElement body)
        => Ok(new { count = await _newsletter.CountRecipientsAsync(true), criteria_supported = new[] { "active_subscribers" } });

    /// <summary>POST /api/admin/newsletters/preview - Render an unsaved draft preview.</summary>
    [HttpPost("newsletters/preview")]
    public async Task<IActionResult> PreviewNewsletter([FromBody] PreviewNewsletterRequest request, CancellationToken ct)
    {
        try
        {
            var preview = await _newsletter.RenderPreviewAsync(
                User.GetUserId(),
                request.Subject ?? string.Empty,
                request.PreviewText ?? string.Empty,
                request.Content ?? string.Empty,
                string.IsNullOrWhiteSpace(request.ContentFormat) ? "richtext" : request.ContentFormat!,
                ct);

            return Ok(new
            {
                data = new
                {
                    html = preview.Html,
                    text = preview.Text,
                    subject = preview.Subject
                }
            });
        }
        catch (ArgumentException ex) when (ex.ParamName == "contentFormat")
        {
            return BadRequest(new { error = "VALIDATION_ERROR", message = "Invalid content format.", field = "content_format" });
        }
        catch (ArgumentException ex) when (ex.ParamName == "content")
        {
            return BadRequest(new { error = "VALIDATION_ERROR", message = "Newsletter content is too large.", field = "content" });
        }
    }

    /// <summary>POST /api/admin/newsletters/{id}/duplicate - Duplicate newsletter.</summary>
    [HttpPost("newsletters/{id:int}/duplicate")]
    public IActionResult DuplicateNewsletter(int id)
        => Created($"/api/admin/newsletters/{id}", new { data = new { id = 0, subject = $"Copy of newsletter {id}", status = "Draft", created_at = DateTime.UtcNow } });

    /// <summary>GET /api/admin/newsletters/{id}/activity - Newsletter activity log.</summary>
    [HttpGet("newsletters/{id:int}/activity")]
    public IActionResult NewsletterActivity(int id)
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0, newsletter_id = id } });

    /// <summary>GET /api/admin/newsletters/{id}/openers - List openers.</summary>
    [HttpGet("newsletters/{id:int}/openers")]
    public IActionResult NewsletterOpeners(int id)
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0, newsletter_id = id } });

    /// <summary>GET /api/admin/newsletters/{id}/clickers - List clickers.</summary>
    [HttpGet("newsletters/{id:int}/clickers")]
    public IActionResult NewsletterClickers(int id)
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0, newsletter_id = id } });

    /// <summary>GET /api/admin/newsletters/{id}/non-openers - List non-openers.</summary>
    [HttpGet("newsletters/{id:int}/non-openers")]
    public IActionResult NewsletterNonOpeners(int id)
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0, newsletter_id = id } });

    /// <summary>GET /api/admin/newsletters/{id}/openers-no-click - Openers who did not click.</summary>
    [HttpGet("newsletters/{id:int}/openers-no-click")]
    public IActionResult NewsletterOpenersNoClick(int id)
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0, newsletter_id = id } });

    /// <summary>GET /api/admin/newsletters/{id}/email-clients - Email client stats.</summary>
    [HttpGet("newsletters/{id:int}/email-clients")]
    public IActionResult NewsletterEmailClients(int id)
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0, newsletter_id = id } });

    // =====================================================================
    // BROKER — Legacy compatibility routes not owned by AdminBrokerController.
    // =====================================================================

    /// <summary>GET /api/admin/broker/archives - List archived exchanges.</summary>
    [HttpGet("broker/archives")]
    public IActionResult BrokerArchives([FromQuery] int page = 1, [FromQuery] int limit = 20)
        => Ok(new { data = Array.Empty<object>(), meta = new { page, limit, total = 0 } });

    /// <summary>GET /api/admin/broker/archives/{id} - Archive detail.</summary>
    [HttpGet("broker/archives/{id:int}")]
    public IActionResult BrokerArchiveDetail(int id)
        => Ok(new { data = new { id, status = "archived", archived_at = DateTime.UtcNow } });

    // =====================================================================
    // GROUPS — Extended (no conflicts with AdminGroupsController)
    // AdminGroupsController owns: GET (list), GET stats, DELETE {id}
    // These routes are NEW sub-paths under /api/admin/groups/
    // =====================================================================

    /// <summary>GET /api/admin/groups/analytics - Group analytics.</summary>
    [HttpGet("groups/analytics")]
    public IActionResult GroupAnalytics()
        => Ok(new { data = new { total_groups = 0, active_groups = 0, total_members = 0, avg_members_per_group = 0.0, growth_rate = 0.0 } });

    /// <summary>GET /api/admin/groups/approvals - Pending group approvals.</summary>
    [HttpGet("groups/approvals")]
    public IActionResult GroupApprovals()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>POST /api/admin/groups/approvals/{id}/approve - Approve group.</summary>
    [HttpPost("groups/approvals/{id:int}/approve")]
    public IActionResult ApproveGroup(int id)
        => Ok(new { message = "Group approved", group_id = id });

    /// <summary>POST /api/admin/groups/approvals/{id}/reject - Reject group.</summary>
    [HttpPost("groups/approvals/{id:int}/reject")]
    public IActionResult RejectGroup(int id)
        => Ok(new { message = "Group rejected", group_id = id });

    /// <summary>GET /api/admin/groups/moderation - Flagged group content.</summary>
    [HttpGet("groups/moderation")]
    public IActionResult GroupModeration()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>PUT /api/admin/groups/{id}/status - Update group status.</summary>
    [HttpPut("groups/{id:int}/status")]
    public IActionResult UpdateGroupStatus(int id, [FromBody] object body)
        => Ok(new { message = "Group status updated", group_id = id });

    /// <summary>GET /api/admin/groups/types - List group types.</summary>
    [HttpGet("groups/types")]
    public IActionResult ListGroupTypes()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>POST /api/admin/groups/types - Create group type.</summary>
    [HttpPost("groups/types")]
    public IActionResult CreateGroupType([FromBody] object body)
        => Created("/api/admin/groups/types/0", new { data = new { id = 0, name = "New Type" } });

    /// <summary>PUT /api/admin/groups/types/{id} - Update group type.</summary>
    [HttpPut("groups/types/{id:int}")]
    public IActionResult UpdateGroupType(int id, [FromBody] object body)
        => Ok(new { data = new { id, name = "Updated Type" } });

    /// <summary>DELETE /api/admin/groups/types/{id} - Delete group type.</summary>
    [HttpDelete("groups/types/{id:int}")]
    public IActionResult DeleteGroupType(int id)
        => Ok(new { message = "Group type deleted" });

    /// <summary>GET /api/admin/groups/types/{typeId}/policies - Get type policies.</summary>
    [HttpGet("groups/types/{typeId}/policies")]
    public IActionResult GetGroupTypePolicies(int typeId)
        => Ok(new { data = new { type_id = typeId, max_members = 0, requires_approval = false, allow_public = true } });

    /// <summary>PUT /api/admin/groups/types/{typeId}/policies - Set type policies.</summary>
    [HttpPut("groups/types/{typeId}/policies")]
    public IActionResult SetGroupTypePolicies(int typeId, [FromBody] object body)
        => Ok(new { message = "Policies updated", type_id = typeId });

    /// <summary>GET /api/admin/groups/{groupId}/members - List group members.</summary>
    [HttpGet("groups/{groupId}/members")]
    public IActionResult ListGroupMembers(int groupId, [FromQuery] int page = 1, [FromQuery] int limit = 20)
        => Ok(new { data = Array.Empty<object>(), meta = new { page, limit, total = 0, group_id = groupId } });

    /// <summary>POST /api/admin/groups/{groupId}/members/{userId}/promote - Promote member.</summary>
    [HttpPost("groups/{groupId}/members/{userId}/promote")]
    public IActionResult PromoteMember(int groupId, int userId)
        => Ok(new { message = "Member promoted", group_id = groupId, user_id = userId });

    /// <summary>POST /api/admin/groups/{groupId}/members/{userId}/demote - Demote member.</summary>
    [HttpPost("groups/{groupId}/members/{userId}/demote")]
    public IActionResult DemoteMember(int groupId, int userId)
        => Ok(new { message = "Member demoted", group_id = groupId, user_id = userId });

    /// <summary>DELETE /api/admin/groups/{groupId}/members/{userId} - Kick member.</summary>
    [HttpDelete("groups/{groupId}/members/{userId}")]
    public IActionResult KickMember(int groupId, int userId)
        => Ok(new { message = "Member removed", group_id = groupId, user_id = userId });

    /// <summary>POST /api/admin/groups/{groupId}/geocode - Geocode group location.</summary>
    [HttpPost("groups/{groupId}/geocode")]
    public async Task<IActionResult> GeocodeGroup(int groupId, [FromBody] GeocodeGroupRequest? request = null)
    {
        var group = await _db.Set<Group>().AsNoTracking().FirstOrDefaultAsync(g => g.Id == groupId);
        if (group == null) return NotFound(new { error = "Group not found" });

        var query = request?.Address;
        if (string.IsNullOrWhiteSpace(query))
            query = group.Name;

        var result = await _location.GeocodeAddressAsync(query);
        return Ok(new
        {
            group_id = groupId,
            query,
            matched = result != null,
            persisted = false,
            message = result == null
                ? "No tenant-local geocode match found."
                : "Geocode resolved from tenant-local location data; group coordinates are not persisted by the current group model.",
            result = result == null ? null : new
            {
                latitude = result.Latitude,
                longitude = result.Longitude,
                formatted_address = result.FormattedAddress,
                city = result.City,
                region = result.Region,
                country = result.Country,
                postal_code = result.PostalCode
            }
        });
    }

    /// <summary>POST /api/admin/groups/batch-geocode - Batch geocode groups.</summary>
    [HttpPost("groups/batch-geocode")]
    public async Task<IActionResult> BatchGeocodeGroups([FromBody] BatchGeocodeGroupsRequest? request = null)
    {
        var limit = Math.Clamp(request?.Limit ?? 50, 1, 200);
        var query = _db.Set<Group>().AsNoTracking().OrderBy(g => g.Id).AsQueryable();
        if (request?.GroupIds is { Count: > 0 })
            query = query.Where(g => request.GroupIds.Contains(g.Id));

        var groups = await query.Take(limit).ToListAsync();
        var rows = new List<object>();
        var matched = 0;

        foreach (var group in groups)
        {
            var result = await _location.GeocodeAddressAsync(group.Name);
            if (result != null) matched++;
            rows.Add(new
            {
                group_id = group.Id,
                query = group.Name,
                matched = result != null,
                persisted = false,
                latitude = result?.Latitude,
                longitude = result?.Longitude,
                formatted_address = result?.FormattedAddress
            });
        }

        return Ok(new
        {
            message = "Batch geocode completed against tenant-local location data; group coordinates are not persisted by the current group model.",
            processed = groups.Count,
            matched,
            persisted = 0,
            data = rows
        });
    }

    /// <summary>GET /api/admin/groups/recommendations - Recommendation engine data.</summary>
    [HttpGet("groups/recommendations")]
    public IActionResult GroupRecommendations()
        => Ok(new { data = Array.Empty<object>() });

    /// <summary>GET /api/admin/groups/featured - Featured groups.</summary>
    [HttpGet("groups/featured")]
    public IActionResult FeaturedGroups()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>POST /api/admin/groups/featured/update - Update featured groups list.</summary>
    [HttpPost("groups/featured/update")]
    public IActionResult UpdateFeaturedGroups([FromBody] object body)
        => Ok(new { message = "Featured groups updated" });

    /// <summary>PUT /api/admin/groups/{groupId}/toggle-featured - Toggle featured status.</summary>
    [HttpPut("groups/{groupId}/toggle-featured")]
    public IActionResult ToggleFeatured(int groupId)
        => Ok(new { message = "Featured status toggled", group_id = groupId });

    // =====================================================================
    // VOLUNTEERING
    // =====================================================================

    /// <summary>GET /api/admin/volunteering - Volunteering overview.</summary>
    [HttpGet("volunteering")]
    public IActionResult VolunteeringOverview()
        => Ok(new { data = new { total_volunteers = 0, active_opportunities = 0, pending_approvals = 0, total_hours = 0 } });

    /// <summary>GET /api/admin/volunteering/opportunities - List admin volunteering opportunities.</summary>
    [HttpGet("volunteering/opportunities")]
    public async Task<IActionResult> VolunteeringOpportunities(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? status = null,
        [FromQuery] int? category_id = null,
        [FromQuery] int? group_id = null,
        [FromQuery] string? search = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.VolunteerOpportunities
            .AsNoTracking()
            .Where(o => o.TenantId == tenantId);

        if (!string.IsNullOrWhiteSpace(status) && TryParseOpportunityStatus(status, out var parsedStatus))
        {
            query = query.Where(o => o.Status == parsedStatus);
        }

        if (category_id.HasValue)
        {
            query = query.Where(o => o.CategoryId == category_id.Value);
        }

        if (group_id.HasValue)
        {
            query = query.Where(o => o.GroupId == group_id.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(o =>
                o.Title.Contains(search) ||
                (o.Description != null && o.Description.Contains(search)));
        }

        var total = await query.CountAsync();
        var totalPages = total > 0 ? (int)Math.Ceiling((double)total / limit) : 0;
        var opportunities = await query
            .Include(o => o.Organizer)
            .Include(o => o.Category)
            .Include(o => o.Group)
            .Include(o => o.Applications)
            .Include(o => o.Shifts)
            .OrderByDescending(o => o.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(o => new
            {
                id = o.Id,
                title = o.Title,
                description = o.Description,
                organizer = o.Organizer != null ? new { id = o.Organizer.Id, first_name = o.Organizer.FirstName, last_name = o.Organizer.LastName } : null,
                group = o.Group != null ? new { id = o.Group.Id, name = o.Group.Name } : null,
                category = o.Category != null ? new { id = o.Category.Id, name = o.Category.Name } : null,
                location = o.Location,
                status = MapOpportunityStatus(o.Status),
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
            meta = new
            {
                current_page = page,
                per_page = limit,
                total,
                total_pages = totalPages,
                has_more = page < totalPages
            }
        });
    }

    /// <summary>GET /api/admin/volunteering/approvals - Current volunteering applications, pending first.</summary>
    [HttpGet("volunteering/approvals")]
    public async Task<IActionResult> VolunteeringApprovals(CancellationToken cancellationToken = default)
    {
        if (_volunteerApprovals is null)
            return VolunteeringError(StatusCodes.Status500InternalServerError, "SERVER_ERROR", "Volunteering approval service is unavailable.");

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        try
        {
            if (!await _volunteerApprovals.IsFeatureEnabledAsync(tenantId, cancellationToken))
                return VolunteeringError(StatusCodes.Status403Forbidden, "FEATURE_DISABLED", "Service unavailable");

            var rows = await _volunteerApprovals.ListAsync(tenantId, cancellationToken);
            return Ok(new
            {
                data = rows,
                meta = new
                {
                    base_url = $"{Request.Scheme}://{Request.Host}"
                }
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Failed to list volunteer applications for tenant {TenantId}", tenantId);
            return VolunteeringError(StatusCodes.Status500InternalServerError, "SERVER_ERROR", "Failed to load volunteer applications.");
        }
    }

    /// <summary>POST /api/admin/volunteering/approvals/{id}/approve - Approve volunteering.</summary>
    [HttpPost("volunteering/approvals/{id:int}/approve")]
    public Task<IActionResult> ApproveVolunteering(int id, CancellationToken cancellationToken = default)
        => DecideVolunteering(id, approved: true, cancellationToken: cancellationToken);

    /// <summary>POST /api/admin/volunteering/approvals/{id}/decline - Decline volunteering.</summary>
    [HttpPost("volunteering/approvals/{id:int}/decline")]
    public Task<IActionResult> DeclineVolunteering(int id, CancellationToken cancellationToken = default)
        => DecideVolunteering(id, approved: false, cancellationToken: cancellationToken);

    // =====================================================================
    // FEDERATION (at /api/admin/federation/... — no conflict with AdminFederationController at /api/admin/system/federation/...)
    // =====================================================================

    /// <summary>GET /api/admin/federation/settings - Federation settings.</summary>
    [HttpGet("federation/settings")]
    public async Task<IActionResult> FederationSettings()
    {
        var (enabled, settings) = await LoadFederationSettingsAsync();
        return Ok(new
        {
            data = new
            {
                federation_enabled = enabled,
                tenant_id = _tenantContext.GetTenantIdOrThrow(),
                settings
            }
        });
    }

    /// <summary>PUT /api/admin/federation/settings - Update federation settings.</summary>
    [HttpPut("federation/settings")]
    public async Task<IActionResult> UpdateFederationSettings([FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (currentEnabled, currentSettings) = await LoadFederationSettingsAsync();

        var enabled = body.TryGetProperty("federation_enabled", out var enabledEl)
            ? ReadBool(enabledEl) ?? currentEnabled
            : currentEnabled;

        var settings = currentSettings;
        if (body.TryGetProperty("settings", out var settingsEl) && settingsEl.ValueKind == JsonValueKind.Object)
        {
            if (settingsEl.TryGetProperty("allow_inbound_partnerships", out var aip))
                settings.allow_inbound_partnerships = ReadBool(aip) ?? settings.allow_inbound_partnerships;
            if (settingsEl.TryGetProperty("auto_approve_partners", out var aap))
                settings.auto_approve_partners = ReadBool(aap) ?? settings.auto_approve_partners;
            if (settingsEl.TryGetProperty("max_partnerships", out var mp) && mp.TryGetInt32(out var mpi))
                settings.max_partnerships = Math.Clamp(mpi, 1, 100);
            if (settingsEl.TryGetProperty("shared_categories", out var sc) && sc.ValueKind == JsonValueKind.Array)
                settings.shared_categories = sc.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString()!)
                    .ToArray();
        }

        var payload = JsonSerializer.Serialize(new
        {
            federation_enabled = enabled,
            settings.allow_inbound_partnerships,
            settings.auto_approve_partners,
            settings.max_partnerships,
            settings.shared_categories
        });

        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == FederationConfigKey);
        if (existing != null)
        {
            existing.Value = payload;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = FederationConfigKey,
                Value = payload,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
        }
        await _db.SaveChangesAsync();

        _logger.LogInformation("Tenant {TenantId} federation settings updated (enabled={Enabled})", tenantId, enabled);

        return Ok(new
        {
            success = true,
            message = "Federation settings updated",
            data = new
            {
                federation_enabled = enabled,
                tenant_id = tenantId,
                settings
            }
        });
    }

    private const string FederationConfigKey = "config.federation";

    private async Task<(bool Enabled, FederationSettingsDto Settings)> LoadFederationSettingsAsync()
    {
        var defaults = new FederationSettingsDto
        {
            allow_inbound_partnerships = true,
            auto_approve_partners = false,
            max_partnerships = 10,
            shared_categories = Array.Empty<string>()
        };
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == FederationConfigKey);
        if (existing == null || string.IsNullOrWhiteSpace(existing.Value))
            return (false, defaults);
        try
        {
            using var doc = JsonDocument.Parse(existing.Value);
            var root = doc.RootElement;
            var enabled = root.TryGetProperty("federation_enabled", out var fe) && (ReadBool(fe) ?? false);
            if (root.TryGetProperty("allow_inbound_partnerships", out var aip))
                defaults.allow_inbound_partnerships = ReadBool(aip) ?? defaults.allow_inbound_partnerships;
            if (root.TryGetProperty("auto_approve_partners", out var aap))
                defaults.auto_approve_partners = ReadBool(aap) ?? defaults.auto_approve_partners;
            if (root.TryGetProperty("max_partnerships", out var mp) && mp.TryGetInt32(out var mpi))
                defaults.max_partnerships = mpi;
            if (root.TryGetProperty("shared_categories", out var sc) && sc.ValueKind == JsonValueKind.Array)
                defaults.shared_categories = sc.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString()!)
                    .ToArray();
            return (enabled, defaults);
        }
        catch (JsonException)
        {
            return (false, defaults);
        }
    }

    private static bool? ReadBool(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String when bool.TryParse(el.GetString(), out var b) => b,
        _ => null
    };

    private class FederationSettingsDto
    {
        public bool allow_inbound_partnerships { get; set; }
        public bool auto_approve_partners { get; set; }
        public int max_partnerships { get; set; }
        public string[] shared_categories { get; set; } = Array.Empty<string>();
    }

    /// <summary>GET /api/admin/federation/partnerships - List partnerships.</summary>
    [HttpGet("federation/partnerships")]
    public async Task<IActionResult> ListPartnerships(
        [FromQuery] string? status = null,
        CancellationToken cancellationToken = default)
    {
        if (_federation == null)
            return FederationError(StatusCodes.Status500InternalServerError, "SERVER_ERROR", "Federation service is unavailable");

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        IEnumerable<FederationPartner> partners = await _federation.GetAllPartnershipsForTenantAsync(
            tenantId,
            cancellationToken);

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<PartnerStatus>(status, ignoreCase: true, out var parsedStatus))
                partners = Array.Empty<FederationPartner>();
            else
                partners = partners.Where(partner => partner.Status == parsedStatus);
        }

        var data = partners.Select(partner =>
        {
            var isInitiator = partner.TenantId == tenantId;
            var otherTenant = isInitiator ? partner.PartnerTenant : partner.Tenant;
            return new
            {
                id = partner.Id,
                tenant_id = partner.TenantId,
                partner_tenant_id = partner.PartnerTenantId,
                partner_name = otherTenant?.Name ?? string.Empty,
                partner_slug = otherTenant?.Slug ?? string.Empty,
                status = partner.Status.ToString().ToLowerInvariant(),
                shared_listings = partner.SharedListings,
                shared_events = partner.SharedEvents,
                shared_members = partner.SharedMembers,
                requested_by = partner.RequestedById,
                approved_by = partner.ApprovedById,
                approved_at = partner.ApprovedAt,
                requested_at = partner.CreatedAt,
                created_at = partner.CreatedAt,
                updated_at = partner.UpdatedAt,
                is_initiator = isInitiator,
                direction = isInitiator ? "outgoing" : "incoming"
            };
        }).ToList();

        return Ok(new
        {
            data,
            meta = FederationMeta()
        });
    }

    /// <summary>POST /api/admin/federation/partnerships/{id}/approve - Approve partnership.</summary>
    [HttpPost("federation/partnerships/{id:int}/approve")]
    public async Task<IActionResult> ApprovePartnership(int id, CancellationToken cancellationToken = default)
    {
        if (_federation == null)
            return FederationError(StatusCodes.Status500InternalServerError, "SERVER_ERROR", "Federation service is unavailable");

        var adminId = User.GetUserId();
        if (!adminId.HasValue)
            return FederationError(StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Invalid token");

        var result = await _federation.ApprovePartnershipForTenantAsync(
            id,
            _tenantContext.GetTenantIdOrThrow(),
            adminId.Value,
            cancellationToken);

        if (result.NotFound)
            return FederationError(StatusCodes.Status404NotFound, "APPROVE_FAILED", result.Error ?? "Partnership not found");
        if (!result.Succeeded)
            return FederationError(StatusCodes.Status409Conflict, "APPROVE_FAILED", result.Error ?? "Failed to approve partnership");

        return Ok(new
        {
            data = new { message = "Partnership approved" },
            meta = FederationMeta()
        });
    }

    /// <summary>POST /api/admin/federation/partnerships/{id}/reject - Reject partnership.</summary>
    [HttpPost("federation/partnerships/{id:int}/reject")]
    public async Task<IActionResult> RejectPartnership(
        int id,
        [FromBody] RejectFederationPartnershipRequest? request,
        CancellationToken cancellationToken = default)
    {
        if (_federation == null)
            return FederationError(StatusCodes.Status500InternalServerError, "SERVER_ERROR", "Federation service is unavailable");

        var adminId = User.GetUserId();
        if (!adminId.HasValue)
            return FederationError(StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Invalid token");

        var result = await _federation.RejectPartnershipForTenantAsync(
            id,
            _tenantContext.GetTenantIdOrThrow(),
            adminId.Value,
            request?.Reason,
            cancellationToken);

        if (result.NotFound)
            return FederationError(StatusCodes.Status404NotFound, "REJECT_FAILED", result.Error ?? "Partnership not found");
        if (!result.Succeeded)
            return FederationError(StatusCodes.Status409Conflict, "REJECT_FAILED", result.Error ?? "Failed to reject partnership");

        return Ok(new
        {
            data = new { message = "Partnership rejected" },
            meta = FederationMeta()
        });
    }

    /// <summary>POST /api/admin/federation/partnerships/{id}/terminate - Terminate partnership.</summary>
    [HttpPost("federation/partnerships/{id:int}/terminate")]
    public IActionResult TerminatePartnership(int id)
        => Ok(new { message = "Partnership terminated", partnership_id = id });

    /// <summary>GET /api/admin/federation/directory - Federation directory.</summary>
    [HttpGet("federation/directory")]
    public IActionResult FederationDirectory()
        => Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });

    /// <summary>POST /api/admin/federation/partnerships/request - Request partnership.</summary>
    [HttpPost("federation/partnerships/request")]
    public IActionResult RequestPartnership([FromBody] object body)
        => Created("/api/admin/federation/partnerships/0", new { message = "Partnership request sent", partnership_id = 0 });

    /// <summary>GET /api/admin/federation/directory/profile - Get own directory profile.</summary>
    [HttpGet("federation/directory/profile")]
    public IActionResult GetDirectoryProfile()
        => Ok(new { data = new { name = "", description = "", public_contact = "", visible = false } });

    /// <summary>PUT /api/admin/federation/directory/profile - Update directory profile.</summary>
    [HttpPut("federation/directory/profile")]
    public IActionResult UpdateDirectoryProfile([FromBody] object body)
        => Ok(new { message = "Directory profile updated" });

    /// <summary>GET /api/admin/federation/analytics - Federation analytics.</summary>
    [HttpGet("federation/analytics")]
    public async Task<IActionResult> FederationAnalytics()
    {
        var totalPartners = await _db.FederationPartners.CountAsync();
        var activePartners = await _db.FederationPartners.CountAsync(p => p.Status == PartnerStatus.Active);
        var sharedListings = await _db.FederatedListings.CountAsync();
        var crossTenantExchanges = await _db.FederatedExchanges.CountAsync();
        var thirtyDaysAgo = DateTime.UtcNow.AddDays(-30);
        var recentExchanges = await _db.FederatedExchanges.CountAsync(e => e.CreatedAt >= thirtyDaysAgo);
        var apiCalls30d = await _db.FederationApiLogs.CountAsync(l => l.CreatedAt >= thirtyDaysAgo);
        var auditEvents30d = await _db.FederationAuditLogs.CountAsync(l => l.CreatedAt >= thirtyDaysAgo);

        return Ok(new
        {
            data = new
            {
                total_partners = totalPartners,
                active_partners = activePartners,
                shared_listings = sharedListings,
                shared_events = 0,
                cross_tenant_exchanges = crossTenantExchanges,
                recent_exchanges_30d = recentExchanges,
                api_calls_30d = apiCalls30d,
                audit_events_30d = auditEvents30d
            }
        });
    }

    /// <summary>GET /api/admin/federation/data - Federation data management.</summary>
    [HttpGet("federation/data")]
    public async Task<IActionResult> FederationData()
    {
        var syncedListings = await _db.FederatedListings.CountAsync();
        var syncedExchanges = await _db.FederatedExchanges.CountAsync();
        var lastListingSync = await _db.FederatedListings.MaxAsync(l => (DateTime?)l.CreatedAt);
        var lastExchangeSync = await _db.FederatedExchanges
            .Select(e => e.UpdatedAt ?? e.CreatedAt)
            .Cast<DateTime?>()
            .MaxAsync();
        DateTime? lastSync = (lastListingSync, lastExchangeSync) switch
        {
            (null, null) => null,
            (DateTime a, null) => a,
            (null, DateTime b) => b,
            (DateTime a, DateTime b) => a > b ? a : b
        };

        return Ok(new
        {
            data = new
            {
                synced_listings = syncedListings,
                synced_events = 0,
                synced_exchanges = syncedExchanges,
                synced_members = 0,
                last_sync_at = lastSync
            }
        });
    }

    // =====================================================================
    // Helpers & DTOs
    // =====================================================================

    private async Task<IActionResult> DecideVolunteering(
        int applicationId,
        bool approved,
        CancellationToken cancellationToken)
    {
        if (_volunteerApprovals is null)
            return VolunteeringError(StatusCodes.Status500InternalServerError, "SERVER_ERROR", "Volunteering approval service is unavailable.");

        var reviewerId = User.GetUserId();
        if (!reviewerId.HasValue)
            return VolunteeringError(StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Invalid token.");

        try
        {
            var result = await _volunteerApprovals.DecideAsync(
                applicationId,
                _tenantContext.GetTenantIdOrThrow(),
                reviewerId.Value,
                approved,
                cancellationToken);

            if (!result.Succeeded)
            {
                return result.Failure switch
                {
                    AdminVolunteerDecisionFailure.FeatureDisabled => VolunteeringError(
                        StatusCodes.Status403Forbidden,
                        "FEATURE_DISABLED",
                        result.Message ?? "Service unavailable",
                        result.Field),
                    AdminVolunteerDecisionFailure.NotFound => VolunteeringError(
                        StatusCodes.Status404NotFound,
                        "NOT_FOUND",
                        result.Message ?? "Application not found.",
                        result.Field),
                    _ => VolunteeringError(
                        StatusCodes.Status422UnprocessableEntity,
                        "VALIDATION_ERROR",
                        result.Message ?? "The application could not be updated.",
                        result.Field)
                };
            }

            return Ok(new
            {
                data = new
                {
                    message = approved
                        ? "Application approved"
                        : "Application declined"
                },
                meta = new
                {
                    base_url = $"{Request.Scheme}://{Request.Host}"
                }
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(
                ex,
                "Failed to {Decision} volunteer application {ApplicationId}",
                approved ? "approve" : "decline",
                applicationId);
            return VolunteeringError(
                StatusCodes.Status500InternalServerError,
                "SERVER_ERROR",
                approved
                    ? "Failed to approve application"
                    : "Failed to reject application");
        }
    }

    private ObjectResult VolunteeringError(int statusCode, string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };

        if (field is not null)
            error["field"] = field;

        return StatusCode(statusCode, new { errors = new[] { error } });
    }

    private object FederationMeta() => new
    {
        base_url = $"{Request.Scheme}://{Request.Host}"
    };

    private ObjectResult FederationError(int statusCode, string code, string message)
        => StatusCode(statusCode, new
        {
            errors = new[] { new { code, message } }
        });

    private static object MapNewsletter(Newsletter n) => new
    {
        n.Id,
        n.Subject,
        content_html = n.ContentHtml,
        content_text = n.ContentText,
        status = n.Status.ToString(),
        scheduled_at = n.ScheduledAt,
        sent_at = n.SentAt,
        recipient_count = n.RecipientCount,
        open_count = n.OpenCount,
        click_count = n.ClickCount,
        created_at = n.CreatedAt,
        updated_at = n.UpdatedAt,
        created_by_id = n.CreatedById,
        created_by = n.CreatedBy != null ? new { n.CreatedBy.Id, n.CreatedBy.FirstName, n.CreatedBy.LastName } : null
    };

    public class CreateNewsletterRequest
    {
        [JsonPropertyName("subject")] public string Subject { get; set; } = string.Empty;
        [JsonPropertyName("content_html")] public string ContentHtml { get; set; } = string.Empty;
        [JsonPropertyName("content_text")] public string? ContentText { get; set; }
        [JsonPropertyName("scheduled_at")] public DateTime? ScheduledAt { get; set; }
    }

    public class UpdateNewsletterRequest
    {
        [JsonPropertyName("subject")] public string? Subject { get; set; }
        [JsonPropertyName("content_html")] public string? ContentHtml { get; set; }
        [JsonPropertyName("content_text")] public string? ContentText { get; set; }
        [JsonPropertyName("scheduled_at")] public DateTime? ScheduledAt { get; set; }
    }

    public class AddSubscriberRequest
    {
        [JsonPropertyName("email")] public string Email { get; set; } = string.Empty;
        [JsonPropertyName("user_id")] public int? UserId { get; set; }
    }

    public class ImportSubscribersRequest
    {
        [JsonPropertyName("subscribers")] public List<SubscriberImportRow>? Subscribers { get; set; }
        [JsonPropertyName("csv")] public string? Csv { get; set; }
    }

    public class SubscriberImportRow
    {
        [JsonPropertyName("email")] public string? Email { get; set; }
        [JsonPropertyName("user_id")] public int? UserId { get; set; }
        [JsonPropertyName("source")] public string? Source { get; set; }
    }

    public class SendTestEmailRequest
    {
        [JsonPropertyName("email")] public string Email { get; set; } = string.Empty;
    }

    public class PreviewNewsletterRequest
    {
        [JsonPropertyName("subject")] public string? Subject { get; set; }
        [JsonPropertyName("preview_text")] public string? PreviewText { get; set; }
        [JsonPropertyName("content")] public string? Content { get; set; }
        [JsonPropertyName("content_format")] public string? ContentFormat { get; set; }
    }

    public class GeocodeGroupRequest
    {
        [JsonPropertyName("address")] public string? Address { get; set; }
    }

    public class BatchGeocodeGroupsRequest
    {
        [JsonPropertyName("group_ids")] public List<int>? GroupIds { get; set; }
        [JsonPropertyName("limit")] public int? Limit { get; set; }
    }

    public class RejectFederationPartnershipRequest
    {
        [JsonPropertyName("reason")] public string? Reason { get; set; }
    }

    private static bool TryParseOpportunityStatus(string? value, out OpportunityStatus status)
    {
        status = OpportunityStatus.Draft;
        switch ((value ?? "").Trim().ToLowerInvariant())
        {
            case "draft":
                status = OpportunityStatus.Draft;
                return true;
            case "published":
            case "open":
            case "active":
                status = OpportunityStatus.Published;
                return true;
            case "closed":
                status = OpportunityStatus.Closed;
                return true;
            case "cancelled":
            case "canceled":
                status = OpportunityStatus.Cancelled;
                return true;
            default:
                return false;
        }
    }

    private static string MapOpportunityStatus(OpportunityStatus status) => status switch
    {
        OpportunityStatus.Published => "published",
        OpportunityStatus.Closed => "closed",
        OpportunityStatus.Cancelled => "cancelled",
        _ => "draft"
    };

    private static IEnumerable<ImportSubscriberInput> ParseSubscriberCsv(string csv)
    {
        foreach (var line in csv.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (line.StartsWith("email", StringComparison.OrdinalIgnoreCase))
                continue;

            var parts = line.Split(',', StringSplitOptions.TrimEntries);
            if (parts.Length == 0) continue;

            int? userId = null;
            if (parts.Length > 1 && int.TryParse(parts[1], out var parsedUserId))
                userId = parsedUserId;

            yield return new ImportSubscriberInput
            {
                Email = parts[0],
                UserId = userId,
                Source = parts.Length > 2 && !string.IsNullOrWhiteSpace(parts[2]) ? parts[2] : "import"
            };
        }
    }

    private static string EscapeCsv(string value)
    {
        if (!value.Contains(',') && !value.Contains('"') && !value.Contains('\n'))
            return value;

        return $"\"{value.Replace("\"", "\"\"")}\"";
    }
}
