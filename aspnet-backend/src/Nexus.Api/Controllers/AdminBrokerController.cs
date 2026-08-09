// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
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
/// Admin broker management - assignments, notes, and statistics.
/// </summary>
[ApiController]
[Route("api/admin/broker")]
[Route("api/v2/admin/broker")]
[Authorize(Policy = "BrokerOrAdmin")]
public class AdminBrokerController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly Dictionary<string, object> DefaultBrokerConfiguration = new()
    {
        ["broker_messaging_enabled"] = true,
        ["broker_copy_all_messages"] = false,
        ["broker_copy_threshold_hours"] = 5,
        ["new_member_monitoring_days"] = 30,
        ["require_exchange_for_listings"] = false,
        ["risk_tagging_enabled"] = true,
        ["auto_flag_high_risk"] = true,
        ["require_approval_high_risk"] = false,
        ["notify_on_high_risk_match"] = true,
        ["broker_approval_required"] = true,
        ["auto_approve_low_risk"] = false,
        ["exchange_timeout_days"] = 7,
        ["max_hours_without_approval"] = 5,
        ["confirmation_deadline_hours"] = 48,
        ["allow_hour_adjustment"] = false,
        ["max_hour_variance_percent"] = 20,
        ["expiry_hours"] = 168,
        ["broker_visible_to_members"] = false,
        ["show_broker_name"] = false,
        ["broker_contact_email"] = "",
        ["copy_first_contact"] = true,
        ["copy_new_member_messages"] = true,
        ["copy_high_risk_listing_messages"] = true,
        ["random_sample_percentage"] = 0,
        ["retention_days"] = 90,
        ["vetting_enabled"] = false,
        ["insurance_enabled"] = false,
        ["enforce_vetting_on_exchanges"] = false,
        ["enforce_insurance_on_exchanges"] = false,
        ["vetting_expiry_warning_days"] = 30,
        ["insurance_expiry_warning_days"] = 30
    };
    private readonly BrokerService _broker;
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;

    public AdminBrokerController(BrokerService broker, NexusDbContext db, TenantContext tenant)
    {
        _broker = broker;
        _db = db;
        _tenant = tenant;
    }

    /// <summary>
    /// GET /api/admin/broker/assignments - List all broker assignments.
    /// </summary>
    [HttpGet("assignments")]
    public async Task<IActionResult> ListAssignments(
        [FromQuery] int? brokerId = null,
        [FromQuery] int? memberId = null,
        [FromQuery] string? status = null)
    {
        var assignments = await _broker.GetAssignmentsAsync(brokerId, status);

        if (memberId.HasValue)
            assignments = assignments.Where(a => a.MemberId == memberId.Value).ToList();

        return Ok(new
        {
            data = assignments.Select(a => MapAssignment(a)),
            meta = new { total = assignments.Count }
        });
    }

    /// <summary>
    /// GET /api/admin/broker/assignments/{id} - Get assignment details.
    /// </summary>
    [HttpGet("assignments/{id:int}")]
    public async Task<IActionResult> GetAssignment(int id)
    {
        var assignment = await _broker.GetAssignmentAsync(id);
        if (assignment == null) return NotFound(new { error = "Assignment not found" });
        return Ok(new { data = MapAssignment(assignment) });
    }

    /// <summary>
    /// POST /api/admin/broker/assignments - Create a broker assignment.
    /// </summary>
    [HttpPost("assignments")]
    public async Task<IActionResult> CreateAssignment([FromBody] CreateAssignmentRequest request)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var (assignment, error) = await _broker.CreateAssignmentAsync(
            tenantId, request.BrokerId, request.MemberId, request.Notes);

        if (error != null) return BadRequest(new { error });
        return Created("/api/admin/broker/assignments/" + assignment!.Id,
            new { data = new { assignment.Id, assignment.BrokerId, assignment.MemberId, assignment.Status } });
    }

    /// <summary>
    /// PUT /api/admin/broker/assignments/{id} - Update an assignment.
    /// </summary>
    [HttpPut("assignments/{id:int}")]
    public async Task<IActionResult> UpdateAssignment(int id, [FromBody] UpdateAssignmentRequest request)
    {
        var (assignment, error) = await _broker.UpdateAssignmentAsync(id, request.Status, request.Notes);
        if (error != null) return BadRequest(new { error });
        return Ok(new { data = MapAssignment(assignment!) });
    }

    /// <summary>
    /// PUT /api/admin/broker/assignments/{id}/complete - Mark assignment as completed.
    /// </summary>
    [HttpPut("assignments/{id:int}/complete")]
    public async Task<IActionResult> CompleteAssignment(int id)
    {
        var (assignment, error) = await _broker.CompleteAssignmentAsync(id);
        if (error != null) return BadRequest(new { error });
        return Ok(new { data = new { assignment!.Id, assignment.Status, completed_at = assignment.CompletedAt } });
    }

    /// <summary>
    /// DELETE /api/admin/broker/assignments/{id} - Remove an assignment.
    /// </summary>
    [HttpDelete("assignments/{id:int}")]
    public async Task<IActionResult> DeleteAssignment(int id)
    {
        var error = await _broker.DeleteAssignmentAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { message = "Assignment deleted" });
    }

    /// <summary>
    /// PUT /api/admin/broker/assignments/{id}/reassign - Reassign to a different broker.
    /// </summary>
    [HttpPut("assignments/{id:int}/reassign")]
    public async Task<IActionResult> ReassignAssignment(int id, [FromBody] ReassignRequest request)
    {
        var (assignment, error) = await _broker.ReassignAsync(id, request.BrokerId);
        if (error != null) return BadRequest(new { error });
        return Ok(new { data = MapAssignment(assignment!) });
    }

    /// <summary>
    /// GET /api/admin/broker/members/{memberId}/notes - Get notes for a member.
    /// </summary>
    [HttpGet("members/{memberId}/notes")]
    public async Task<IActionResult> GetMemberNotes(int memberId)
    {
        var notes = await _broker.GetNotesAsync(memberId: memberId);
        return Ok(new
        {
            data = notes.Select(n => MapNote(n)),
            meta = new { total = notes.Count }
        });
    }

    /// <summary>
    /// GET /api/admin/broker/exchanges/{exchangeId}/notes - Get notes for an exchange.
    /// </summary>
    [HttpGet("exchanges/{exchangeId}/notes")]
    public async Task<IActionResult> GetExchangeNotes(int exchangeId)
    {
        var notes = await _broker.GetNotesAsync(exchangeId: exchangeId);
        return Ok(new
        {
            data = notes.Select(n => MapNote(n)),
            meta = new { total = notes.Count }
        });
    }

    /// <summary>
    /// POST /api/admin/broker/notes - Create a broker note.
    /// </summary>
    [HttpPost("notes")]
    public async Task<IActionResult> CreateNote([FromBody] CreateNoteRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();
        var (note, error) = await _broker.CreateNoteAsync(
            tenantId, userId.Value, request.MemberId, request.ExchangeId,
            request.Content, request.IsPrivate);

        if (error != null) return BadRequest(new { error });
        return Created("/api/admin/broker/notes", new { data = MapNote(note!) });
    }

    /// <summary>
    /// GET /api/admin/broker/stats - Overall broker statistics.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetOverallStats()
    {
        var stats = await BuildBrokerDashboardAsync();
        return Ok(new { data = stats });
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard()
    {
        return Ok(new { data = await BuildBrokerDashboardAsync() });
    }

    /// <summary>
    /// GET /api/admin/broker/stats/{brokerId} - Statistics for a specific broker.
    /// </summary>
    [HttpGet("stats/{brokerId}")]
    public async Task<IActionResult> GetBrokerStats(int brokerId)
    {
        var stats = await _broker.GetBrokerStatsAsync(brokerId);
        return Ok(new { data = stats });
    }

    /// <summary>
    /// GET /api/admin/broker/brokers - List all users with broker role.
    /// </summary>
    [HttpGet("brokers")]
    public async Task<IActionResult> ListBrokers()
    {
        var brokers = await _db.Users
            .Where(u => u.Role == "broker" || u.Role == "admin" || u.Role == "super_admin")
            .OrderBy(u => u.LastName)
            .ThenBy(u => u.FirstName)
            .Select(u => new
            {
                u.Id,
                u.FirstName,
                u.LastName,
                u.Email,
                u.Role,
                created_at = u.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = brokers, meta = new { total = brokers.Count } });
    }

    [HttpGet("exchanges")]
    public async Task<IActionResult> Exchanges(
        [FromQuery] string? status = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 200);

        var query = _db.Exchanges
            .Include(e => e.Listing)
            .Include(e => e.Initiator)
            .Include(e => e.ListingOwner)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<ExchangeStatus>(status, true, out var parsed))
            query = query.Where(e => e.Status == parsed);

        var total = await query.CountAsync();
        var rows = await query
            .OrderByDescending(e => e.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            data = rows.Select(MapExchange),
            pagination = new { page, limit, total, total_pages = (int)Math.Ceiling(total / (double)limit) }
        });
    }

    [HttpGet("exchanges/{id:int}")]
    public async Task<IActionResult> ShowExchange(int id)
    {
        var exchange = await _db.Exchanges
            .Include(e => e.Listing)
            .Include(e => e.Initiator)
            .Include(e => e.ListingOwner)
            .Include(e => e.Provider)
            .Include(e => e.Receiver)
            .FirstOrDefaultAsync(e => e.Id == id);
        return exchange == null ? NotFound(new { error = "Exchange not found" }) : Ok(new { data = MapExchange(exchange) });
    }

    [HttpPost("exchanges/{id:int}/approve")]
    public async Task<IActionResult> ApproveExchange(int id)
    {
        var exchange = await _db.Exchanges.FirstOrDefaultAsync(e => e.Id == id);
        if (exchange == null) return NotFound(new { error = "Exchange not found" });
        exchange.Status = ExchangeStatus.Accepted;
        exchange.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapExchange(exchange) });
    }

    [HttpPost("exchanges/{id:int}/reject")]
    public async Task<IActionResult> RejectExchange(int id, [FromBody] BrokerRejectRequest request)
    {
        var exchange = await _db.Exchanges.FirstOrDefaultAsync(e => e.Id == id);
        if (exchange == null) return NotFound(new { error = "Exchange not found" });
        exchange.Status = ExchangeStatus.Declined;
        exchange.DeclineReason = request.Reason;
        exchange.CancelledAt = DateTime.UtcNow;
        exchange.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapExchange(exchange) });
    }

    [HttpGet("messages")]
    public async Task<IActionResult> Messages(
        [FromQuery] string? status = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 200);

        var query = _db.Messages
            .Include(m => m.Sender)
            .Include(m => m.Conversation).ThenInclude(c => c!.Participant1)
            .Include(m => m.Conversation).ThenInclude(c => c!.Participant2)
            .GroupJoin(_db.SafeguardingMessageReviews,
                m => m.Id,
                r => r.MessageId,
                (message, reviews) => new { message, review = reviews.FirstOrDefault() })
            .AsQueryable();

        if (status == "unreviewed") query = query.Where(x => x.review == null || x.review.ReviewedAt == null);
        if (status == "flagged") query = query.Where(x => x.review != null && x.review.IsFlagged);
        if (status == "reviewed") query = query.Where(x => x.review != null && x.review.ReviewedAt != null);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(x => x.message.Content.ToLower().Contains(term) || x.message.Sender!.Email.ToLower().Contains(term));
        }

        var total = await query.CountAsync();
        var rows = await query
            .OrderByDescending(x => x.review != null && x.review.IsFlagged)
            .ThenByDescending(x => x.message.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            data = rows.Select(x => MapBrokerMessage(x.message, x.review)),
            pagination = new { page, limit, total, total_pages = (int)Math.Ceiling(total / (double)limit) }
        });
    }

    [HttpGet("messages/{id:int}")]
    public async Task<IActionResult> ShowMessage(int id)
    {
        var message = await _db.Messages
            .Include(m => m.Sender)
            .Include(m => m.Conversation).ThenInclude(c => c!.Participant1)
            .Include(m => m.Conversation).ThenInclude(c => c!.Participant2)
            .FirstOrDefaultAsync(m => m.Id == id);
        if (message == null) return NotFound(new { error = "Message not found" });
        var review = await _db.SafeguardingMessageReviews.FirstOrDefaultAsync(r => r.MessageId == id);
        return Ok(new { data = MapBrokerMessage(message, review) });
    }

    [HttpPost("messages/{id:int}/review")]
    [HttpPost("messages/{id:int}/approve")]
    public async Task<IActionResult> ReviewMessage(int id, [FromBody] BrokerReviewRequest request)
    {
        var review = await EnsureMessageReviewAsync(id, false, "low", "reviewed");
        if (review == null) return NotFound(new { error = "Message not found" });
        review.IsFlagged = false;
        review.Severity = request.Severity ?? review.Severity;
        review.FlagReason = request.Reason ?? review.FlagReason;
        review.ReviewNotes = request.Notes;
        review.ReviewedAt = DateTime.UtcNow;
        review.ReviewedByUserId = User.GetUserId();
        review.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = review });
    }

    [HttpPost("messages/{id:int}/flag")]
    public async Task<IActionResult> FlagMessage(int id, [FromBody] BrokerReviewRequest request)
    {
        var review = await EnsureMessageReviewAsync(id, true, request.Severity ?? "high", request.Reason ?? "manual_flag");
        if (review == null) return NotFound(new { error = "Message not found" });
        review.IsFlagged = true;
        review.Severity = request.Severity ?? "high";
        review.FlagReason = request.Reason ?? "manual_flag";
        review.ReviewNotes = request.Notes;
        review.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = review });
    }

    [HttpGet("risk-tags")]
    public async Task<IActionResult> RiskTags([FromQuery] string? riskLevel = null)
    {
        var query = _db.BrokerRiskTags
            .Include(t => t.Listing)
            .Include(t => t.CreatedBy)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(riskLevel))
            query = query.Where(t => t.RiskLevel == riskLevel);

        var rows = await query.OrderByDescending(t => t.CreatedAt).Take(250).ToListAsync();
        return Ok(new { data = rows.Select(MapRiskTag), meta = new { total = rows.Count } });
    }

    [HttpPost("listings/{listingId:int}/risk-tag")]
    [HttpPost("risk-tags/{listingId}")]
    public async Task<IActionResult> SaveRiskTag(int listingId, [FromBody] SaveRiskTagRequest request)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var userId = User.GetUserId() ?? 0;
        var listingExists = await _db.Listings.AnyAsync(l => l.Id == listingId);
        if (!listingExists) return NotFound(new { error = "Listing not found" });

        var tag = await _db.BrokerRiskTags.FirstOrDefaultAsync(t => t.ListingId == listingId);
        if (tag == null)
        {
            tag = new BrokerRiskTag { TenantId = tenantId, ListingId = listingId, CreatedByUserId = userId };
            _db.BrokerRiskTags.Add(tag);
        }

        tag.RiskLevel = request.RiskLevel;
        tag.RiskType = request.RiskCategory ?? request.RiskType;
        tag.Notes = request.RiskNotes ?? request.Notes;
        tag.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapRiskTag(tag) });
    }

    [HttpDelete("listings/{listingId:int}/risk-tag")]
    [HttpDelete("risk-tags/{listingId}")]
    public async Task<IActionResult> RemoveRiskTag(int listingId)
    {
        var tag = await _db.BrokerRiskTags.FirstOrDefaultAsync(t => t.ListingId == listingId);
        if (tag == null) return NotFound(new { error = "Risk tag not found" });
        _db.BrokerRiskTags.Remove(tag);
        await _db.SaveChangesAsync();
        return Ok(new { data = new { listing_id = listingId, removed = true } });
    }

    [HttpGet("monitoring")]
    public async Task<IActionResult> Monitoring()
    {
        var now = DateTime.UtcNow;
        var rows = await _db.UserMonitoringRestrictions
            .Include(m => m.User)
            .Include(m => m.SetBy)
            .Include(m => m.Tenant)
            .Where(m => m.UnderMonitoring
                && (!m.MonitoringExpiresAt.HasValue || m.MonitoringExpiresAt > now))
            .OrderByDescending(m => m.UpdatedAt ?? m.CreatedAt)
            .Take(250)
            .ToListAsync();
        return Ok(new
        {
            data = rows.Select(MapMonitoring),
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpPost("users/{userId:int}/monitoring")]
    [HttpPost("monitoring/{userId}")]
    public async Task<IActionResult> SetMonitoring(int userId, [FromBody] SetMonitoringRequest request)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var user = await _db.Users.SingleOrDefaultAsync(u => u.TenantId == tenantId && u.Id == userId);
        if (user == null)
        {
            return NotFound(new
            {
                errors = new[] { new { code = "NOT_FOUND", message = "User not found" } }
            });
        }

        var reason = request.Reason?.Trim() ?? string.Empty;
        if (request.UnderMonitoring && string.IsNullOrEmpty(reason))
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new
                    {
                        code = "VALIDATION_ERROR",
                        message = "A reason is required to set monitoring",
                        field = "reason"
                    }
                }
            });
        }

        var row = await _db.UserMonitoringRestrictions.FirstOrDefaultAsync(m => m.UserId == userId);
        if (request.UnderMonitoring && row == null)
        {
            row = new UserMonitoringRestriction { TenantId = tenantId, UserId = userId };
            _db.UserMonitoringRestrictions.Add(row);
        }

        var actorId = User.GetUserId();
        var now = DateTime.UtcNow;
        if (request.UnderMonitoring)
        {
            // Created above when absent.
            var activeRow = row!;
            activeRow.UnderMonitoring = true;
            activeRow.MessagingDisabled = request.MessagingDisabled;
            activeRow.MonitoringExpiresAt = request.ExpiresDays is > 0
                ? now.AddDays(request.ExpiresDays.Value)
                : null;
            activeRow.Reason = reason;
            activeRow.SetByUserId = actorId;
        }
        else
        {
            if (row != null)
            {
                var wasSafeguardingCreated = row.Reason?.StartsWith("Safeguarding:", StringComparison.Ordinal) == true;
                row.UnderMonitoring = false;
                row.MessagingDisabled = false;
                row.MonitoringExpiresAt = null;
                if (wasSafeguardingCreated)
                {
                    row.RequiresBrokerApproval = false;
                }
            }
        }

        if (row != null)
        {
            row.UpdatedAt = now;
        }
        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = actorId,
            Action = request.UnderMonitoring ? "user_monitoring_added" : "user_monitoring_removed",
            EntityType = "user",
            EntityId = userId,
            Metadata = JsonSerializer.Serialize(new
            {
                user_id = userId,
                user_name = $"{user.FirstName} {user.LastName}".Trim(),
                reason = request.UnderMonitoring ? reason : null,
                messaging_disabled = request.UnderMonitoring ? request.MessagingDisabled : false,
                expires_days = request.UnderMonitoring && request.ExpiresDays is > 0
                    ? request.ExpiresDays
                    : null,
                expires_at = row?.MonitoringExpiresAt
            }),
            CreatedAt = now
        });
        _db.Notifications.Add(new Notification
        {
            TenantId = tenantId,
            UserId = userId,
            Type = Notification.Types.System,
            Title = request.UnderMonitoring
                ? request.MessagingDisabled
                    ? "Your messaging has been temporarily restricted by your timebank coordinator."
                    : "Your account has been placed under review by your timebank coordinator."
                : "Your messaging restrictions have been lifted.",
            Link = "/messages",
            IsRead = false,
            CreatedAt = now
        });
        await _db.SaveChangesAsync();

        return Ok(new
        {
            data = new { user_id = userId, under_monitoring = request.UnderMonitoring },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpGet("configuration")]
    public async Task<IActionResult> GetConfiguration()
    {
        return Ok(new { data = await LoadBrokerConfigurationAsync() });
    }

    [HttpPut("configuration")]
    [HttpPost("configuration")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> SaveConfiguration([FromBody] JsonElement request)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var config = await LoadBrokerConfigurationAsync();

        foreach (var property in request.EnumerateObject())
        {
            config[property.Name] = JsonSerializer.Deserialize<object>(property.Value.GetRawText(), JsonOptions) ?? "";
        }

        var row = await _db.EnterpriseConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == "broker.configuration");
        if (row == null)
        {
            row = new EnterpriseConfig { TenantId = tenantId, Key = "broker.configuration", Category = "broker" };
            _db.EnterpriseConfigs.Add(row);
        }

        row.Value = JsonSerializer.Serialize(config, JsonOptions);
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = config });
    }

    [HttpGet("unreviewed-count")]
    [HttpGet("messages/unreviewed-count")]
    public async Task<IActionResult> UnreviewedCount()
    {
        var count = await _db.SafeguardingMessageReviews.CountAsync(r => r.IsFlagged && r.ReviewedAt == null);
        return Ok(new { data = new { count } });
    }

    // --- Mapping helpers ---

    private async Task<object> BuildBrokerDashboardAsync()
    {
        var baseStats = await _broker.GetOverallStatsAsync();
        var pendingExchanges = await _db.Exchanges.CountAsync(e => e.Status == ExchangeStatus.Requested || e.Status == ExchangeStatus.Disputed);
        var unreviewedMessages = await _db.SafeguardingMessageReviews.CountAsync(r => r.IsFlagged && r.ReviewedAt == null);
        var highRiskListings = await _db.BrokerRiskTags.CountAsync(t => t.RiskLevel == "high" || t.RiskLevel == "critical");
        var monitoredUsers = await _db.UserMonitoringRestrictions.CountAsync(m => m.UnderMonitoring && (m.MonitoringExpiresAt == null || m.MonitoringExpiresAt > DateTime.UtcNow));
        // Legacy vetting_records are document-era evidence and never represent
        // an authoritative contact decision. Broker workload comes exclusively
        // from the current metadata-only review queue.
        var vettingPending = await _db.SafeguardingVettingReviewRequests.CountAsync(review =>
            review.Status == SafeguardingVettingReviewRequest.PendingStatus);
        return new
        {
            baseStats,
            pending_exchanges = pendingExchanges,
            unreviewed_messages = unreviewedMessages,
            high_risk_listings = highRiskListings,
            monitored_users = monitoredUsers,
            vetting_pending = vettingPending,
            active_brokers = await _db.BrokerAssignments.Where(a => a.Status == "active").Select(a => a.BrokerId).Distinct().CountAsync(),
            total_assignments = await _db.BrokerAssignments.CountAsync(),
            active_assignments = await _db.BrokerAssignments.CountAsync(a => a.Status == "active"),
            completed_assignments = await _db.BrokerAssignments.CountAsync(a => a.Status == "completed")
        };
    }

    private async Task<Dictionary<string, object>> LoadBrokerConfigurationAsync()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var config = new Dictionary<string, object>(DefaultBrokerConfiguration);
        var row = await _db.EnterpriseConfigs.AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == "broker.configuration");
        if (row == null || string.IsNullOrWhiteSpace(row.Value)) return config;

        try
        {
            var saved = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(row.Value, JsonOptions) ?? [];
            foreach (var (key, value) in saved)
                config[key] = JsonSerializer.Deserialize<object>(value.GetRawText(), JsonOptions) ?? "";
        }
        catch
        {
            return config;
        }
        return config;
    }

    private async Task<SafeguardingMessageReview?> EnsureMessageReviewAsync(int messageId, bool flagged, string severity, string reason)
    {
        var message = await _db.Messages.Include(m => m.Conversation).FirstOrDefaultAsync(m => m.Id == messageId);
        if (message == null) return null;

        var review = await _db.SafeguardingMessageReviews.FirstOrDefaultAsync(r => r.MessageId == messageId);
        if (review != null) return review;

        var recipientId = message.Conversation?.Participant1Id == message.SenderId
            ? message.Conversation?.Participant2Id
            : message.Conversation?.Participant1Id;

        review = new SafeguardingMessageReview
        {
            TenantId = message.TenantId,
            MessageId = message.Id,
            SenderId = message.SenderId,
            RecipientId = recipientId,
            IsFlagged = flagged,
            Severity = severity,
            FlagReason = reason
        };
        _db.SafeguardingMessageReviews.Add(review);
        return review;
    }

    private static object MapAssignment(Entities.BrokerAssignment a) => new
    {
        a.Id,
        broker_id = a.BrokerId,
        member_id = a.MemberId,
        a.Status,
        a.Notes,
        assigned_at = a.AssignedAt,
        completed_at = a.CompletedAt,
        created_at = a.CreatedAt,
        updated_at = a.UpdatedAt,
        broker = a.Broker != null ? new { a.Broker.Id, a.Broker.FirstName, a.Broker.LastName, a.Broker.Email } : null,
        member = a.Member != null ? new { a.Member.Id, a.Member.FirstName, a.Member.LastName, a.Member.Email } : null
    };

    private static object MapNote(Entities.BrokerNote n) => new
    {
        n.Id,
        broker_id = n.BrokerId,
        member_id = n.MemberId,
        exchange_id = n.ExchangeId,
        n.Content,
        is_private = n.IsPrivate,
        created_at = n.CreatedAt,
        broker = n.Broker != null ? new { n.Broker.Id, n.Broker.FirstName, n.Broker.LastName } : null,
        member = n.Member != null ? new { n.Member.Id, n.Member.FirstName, n.Member.LastName } : null
    };

    private static object MapExchange(Exchange e) => new
    {
        e.Id,
        status = e.Status.ToString().ToLowerInvariant(),
        listing_id = e.ListingId,
        listing_title = e.Listing?.Title,
        initiator = MapBrokerUser(e.Initiator, e.InitiatorId),
        listing_owner = MapBrokerUser(e.ListingOwner, e.ListingOwnerId),
        provider = MapBrokerUser(e.Provider, e.ProviderId),
        receiver = MapBrokerUser(e.Receiver, e.ReceiverId),
        agreed_hours = e.AgreedHours,
        actual_hours = e.ActualHours,
        request_message = e.RequestMessage,
        decline_reason = e.DeclineReason,
        scheduled_at = e.ScheduledAt,
        created_at = e.CreatedAt,
        updated_at = e.UpdatedAt
    };

    private static object MapBrokerMessage(Message m, SafeguardingMessageReview? r)
    {
        var recipient = m.Conversation?.Participant1Id == m.SenderId ? m.Conversation?.Participant2 : m.Conversation?.Participant1;
        return new
        {
            m.Id,
            message_id = m.Id,
            conversation_id = m.ConversationId,
            message_content = m.Content,
            sender = MapBrokerUser(m.Sender, m.SenderId),
            recipient = MapBrokerUser(recipient, recipient?.Id),
            severity = r?.Severity ?? "low",
            flag_reason = r?.FlagReason,
            is_flagged = r?.IsFlagged ?? false,
            is_reviewed = r?.ReviewedAt != null,
            review_notes = r?.ReviewNotes,
            reviewed_at = r?.ReviewedAt,
            created_at = m.CreatedAt
        };
    }

    private static object MapRiskTag(BrokerRiskTag t) => new
    {
        t.Id,
        listing_id = t.ListingId,
        listing_title = t.Listing?.Title,
        risk_level = t.RiskLevel,
        risk_category = t.RiskType,
        risk_notes = t.Notes,
        risk_type = t.RiskType,
        notes = t.Notes,
        created_by = MapBrokerUser(t.CreatedBy, t.CreatedByUserId),
        created_at = t.CreatedAt,
        updated_at = t.UpdatedAt
    };

    private static object MapMonitoring(UserMonitoringRestriction m) => new
    {
        m.Id,
        user_id = m.UserId,
        tenant_id = m.TenantId,
        user_name = m.User == null ? string.Empty : $"{m.User.FirstName} {m.User.LastName}".Trim(),
        tenant_name = m.Tenant?.Name ?? "Unknown",
        under_monitoring = m.UnderMonitoring,
        requires_broker_approval = m.RequiresBrokerApproval,
        messaging_disabled = m.MessagingDisabled,
        monitoring_reason = m.Reason,
        restriction_reason = m.Reason,
        monitoring_started_at = m.UpdatedAt ?? m.CreatedAt,
        monitoring_expires_at = m.MonitoringExpiresAt,
        restricted_by = m.SetByUserId,
        created_at = m.CreatedAt,
        updated_at = m.UpdatedAt
    };

    private static object MapBrokerUser(User? user, int? id) => new
    {
        id = user?.Id ?? id,
        first_name = user?.FirstName,
        last_name = user?.LastName,
        email = user?.Email,
        name = user == null ? null : $"{user.FirstName} {user.LastName}".Trim()
    };

    // --- Request DTOs ---

    public class CreateAssignmentRequest
    {
        [JsonPropertyName("broker_id")] public int BrokerId { get; set; }
        [JsonPropertyName("member_id")] public int MemberId { get; set; }
        [JsonPropertyName("notes"), MaxLength(2000)] public string? Notes { get; set; }
    }

    public class UpdateAssignmentRequest
    {
        [JsonPropertyName("status"), MaxLength(50)] public string Status { get; set; } = "active";
        [JsonPropertyName("notes"), MaxLength(2000)] public string? Notes { get; set; }
    }

    public class ReassignRequest
    {
        [JsonPropertyName("broker_id")] public int BrokerId { get; set; }
    }

    public class CreateNoteRequest
    {
        [JsonPropertyName("member_id")] public int? MemberId { get; set; }
        [JsonPropertyName("exchange_id")] public int? ExchangeId { get; set; }
        [JsonPropertyName("content"), MaxLength(5000)] public string Content { get; set; } = string.Empty;
        [JsonPropertyName("is_private")] public bool IsPrivate { get; set; } = true;
    }

    public class BrokerRejectRequest
    {
        [JsonPropertyName("reason"), MaxLength(1000)] public string? Reason { get; set; }
    }

    public class BrokerReviewRequest
    {
        [JsonPropertyName("notes"), MaxLength(4000)] public string? Notes { get; set; }
        [JsonPropertyName("severity"), MaxLength(30)] public string? Severity { get; set; }
        [JsonPropertyName("reason"), MaxLength(120)] public string? Reason { get; set; }
    }

    public class SaveRiskTagRequest
    {
        [JsonPropertyName("risk_level"), MaxLength(30)] public string RiskLevel { get; set; } = "low";
        [JsonPropertyName("risk_category"), MaxLength(120)] public string? RiskCategory { get; set; }
        [JsonPropertyName("risk_notes"), MaxLength(2000)] public string? RiskNotes { get; set; }
        [JsonPropertyName("risk_type"), MaxLength(120)] public string RiskType { get; set; } = "manual";
        [JsonPropertyName("notes"), MaxLength(2000)] public string? Notes { get; set; }
    }

    public class SetMonitoringRequest
    {
        [JsonPropertyName("under_monitoring")] public bool UnderMonitoring { get; set; } = true;
        [JsonPropertyName("requires_broker_approval")] public bool? RequiresBrokerApproval { get; set; }
        [JsonPropertyName("messaging_disabled")] public bool MessagingDisabled { get; set; }
        [JsonPropertyName("expires_at")] public DateTime? ExpiresAt { get; set; }
        [JsonPropertyName("expires_days")] public int? ExpiresDays { get; set; }
        [JsonPropertyName("reason"), MaxLength(2000)] public string? Reason { get; set; }
    }
}
