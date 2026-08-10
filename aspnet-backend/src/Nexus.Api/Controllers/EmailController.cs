// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Email notification management: templates, digest preferences, logs.
/// </summary>
[ApiController]
[Authorize]
public class EmailController : ControllerBase
{
    private readonly EmailNotificationService _emailService;
    private readonly ILogger<EmailController> _logger;

    public EmailController(EmailNotificationService emailService, ILogger<EmailController> logger)
    {
        _emailService = emailService;
        _logger = logger;
    }

    // === Digest Preferences (User) ===

    [HttpGet("api/email/digest")]
    public async Task<IActionResult> GetDigestPreference()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var pref = await _emailService.GetDigestPreferenceAsync(userId.Value);

        return Ok(new
        {
            frequency = pref.Frequency.ToString().ToLowerInvariant(),
            include_new_listings = pref.IncludeNewListings,
            include_exchange_updates = pref.IncludeExchangeUpdates,
            include_group_activity = pref.IncludeGroupActivity,
            include_event_reminders = pref.IncludeEventReminders,
            include_community_highlights = pref.IncludeCommunityHighlights,
            last_sent_at = pref.LastSentAt
        });
    }

    [HttpPut("api/email/digest")]
    public async Task<IActionResult> UpdateDigestPreference([FromBody] UpdateDigestRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (!Enum.TryParse<DigestFrequency>(request.Frequency, true, out var frequency))
            return BadRequest(new { error = "Invalid frequency. Use: none, daily, weekly, monthly" });

        var pref = await _emailService.UpdateDigestPreferenceAsync(
            userId.Value, frequency, request.IncludeNewListings, request.IncludeExchangeUpdates,
            request.IncludeGroupActivity, request.IncludeEventReminders, request.IncludeCommunityHighlights);

        return Ok(new
        {
            frequency = pref.Frequency.ToString().ToLowerInvariant(),
            include_new_listings = pref.IncludeNewListings,
            include_exchange_updates = pref.IncludeExchangeUpdates,
            include_group_activity = pref.IncludeGroupActivity,
            include_event_reminders = pref.IncludeEventReminders,
            include_community_highlights = pref.IncludeCommunityHighlights
        });
    }

    // === Admin: Templates ===

    [HttpGet("api/admin/email/templates")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetTemplates()
    {
        var templates = await _emailService.GetTemplatesAsync();

        return Ok(new
        {
            data = templates.Select(t => new
            {
                id = t.Id,
                key = t.Key,
                subject = t.Subject,
                body_html = t.BodyHtml,
                body_text = t.BodyText,
                is_active = t.IsActive,
                updated_at = t.UpdatedAt ?? t.CreatedAt
            })
        });
    }

    [HttpPut("api/admin/email/templates")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> UpsertTemplate([FromBody] UpsertTemplateRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Key))
            return BadRequest(new { error = "Template key is required" });
        if (string.IsNullOrWhiteSpace(request.Subject))
            return BadRequest(new { error = "Subject is required" });
        if (string.IsNullOrWhiteSpace(request.BodyHtml) && string.IsNullOrWhiteSpace(request.BodyText))
            return BadRequest(new { error = "Either body_html or body_text is required" });

        var template = await _emailService.UpsertTemplateAsync(
            request.Key, request.Subject, request.BodyHtml, request.BodyText);

        return Ok(new
        {
            id = template.Id,
            key = template.Key,
            subject = template.Subject
        });
    }

    // === Admin: Logs ===

    [HttpGet("api/admin/email/logs")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetEmailLogs(
        [FromQuery] int? user_id,
        [FromQuery] string? template_key,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var (logs, total) = await _emailService.GetEmailLogsAsync(user_id, template_key, page, limit);

        return Ok(new
        {
            data = logs.Select(l => new
            {
                id = l.Id,
                user_id = l.UserId,
                to_email = l.ToEmail,
                subject = l.Subject,
                template_key = l.TemplateKey,
                status = l.Status.ToString().ToLowerInvariant(),
                error_message = l.ErrorMessage,
                sent_at = l.SentAt,
                created_at = l.CreatedAt
            }),
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }
}

// === Request DTOs ===

public class UpdateDigestRequest
{
    [JsonPropertyName("frequency")]
    public string Frequency { get; set; } = "weekly";

    [JsonPropertyName("include_new_listings")]
    public bool? IncludeNewListings { get; set; }

    [JsonPropertyName("include_exchange_updates")]
    public bool? IncludeExchangeUpdates { get; set; }

    [JsonPropertyName("include_group_activity")]
    public bool? IncludeGroupActivity { get; set; }

    [JsonPropertyName("include_event_reminders")]
    public bool? IncludeEventReminders { get; set; }

    [JsonPropertyName("include_community_highlights")]
    public bool? IncludeCommunityHighlights { get; set; }
}

public class UpsertTemplateRequest
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;

    [JsonPropertyName("subject")]
    public string Subject { get; set; } = string.Empty;

    [JsonPropertyName("body_html")]
    public string BodyHtml { get; set; } = string.Empty;

    [JsonPropertyName("body_text")]
    public string? BodyText { get; set; }
}
