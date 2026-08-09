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

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin email template and log management.
/// </summary>
[ApiController]
[Route("api/admin/emails")]
[Authorize(Policy = "AdminOnly")]
public class AdminEmailController : ControllerBase
{
    private readonly NexusDbContext _db;

    public AdminEmailController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("templates")]
    public async Task<IActionResult> ListTemplates()
    {
        var templates = await _db.EmailTemplates
            .OrderBy(t => t.Key)
            .ToListAsync();

        return Ok(new
        {
            data = templates.Select(t => new
            {
                t.Id, t.Key, t.Subject, t.IsActive, t.CreatedAt, t.UpdatedAt
            })
        });
    }

    [HttpGet("templates/{id:int}")]
    public async Task<IActionResult> GetTemplate(int id)
    {
        var template = await _db.EmailTemplates.FirstOrDefaultAsync(x => x.Id == id);
        if (template == null) return NotFound(new { error = "Template not found" });
        return Ok(new
        {
            data = new
            {
                template.Id, template.Key, template.Subject,
                body_html = template.BodyHtml, body_text = template.BodyText,
                template.IsActive, template.CreatedAt, template.UpdatedAt
            }
        });
    }

    [HttpPost("templates")]
    public async Task<IActionResult> CreateTemplate([FromBody] CreateEmailTemplateRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Key))
            return BadRequest(new { error = "Key is required" });
        if (string.IsNullOrWhiteSpace(request.Subject))
            return BadRequest(new { error = "Subject is required" });
        if (string.IsNullOrWhiteSpace(request.BodyHtml))
            return BadRequest(new { error = "Body HTML is required" });

        var template = new EmailTemplate
        {
            Key = request.Key,
            Subject = request.Subject,
            BodyHtml = request.BodyHtml,
            BodyText = request.BodyText,
            IsActive = true
        };

        _db.EmailTemplates.Add(template);
        await _db.SaveChangesAsync();
        return Created($"/api/admin/emails/templates/{template.Id}", new { data = new { template.Id, template.Key } });
    }

    [HttpPut("templates/{id:int}")]
    public async Task<IActionResult> UpdateTemplate(int id, [FromBody] UpdateEmailTemplateRequest request)
    {
        var template = await _db.EmailTemplates.FirstOrDefaultAsync(x => x.Id == id);
        if (template == null) return NotFound(new { error = "Template not found" });

        if (request.Key != null) template.Key = request.Key;
        if (request.Subject != null) template.Subject = request.Subject;
        if (request.BodyHtml != null) template.BodyHtml = request.BodyHtml;
        if (request.BodyText != null) template.BodyText = request.BodyText;
        if (request.IsActive.HasValue) template.IsActive = request.IsActive.Value;
        template.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(new { data = new { template.Id, template.Key } });
    }

    [HttpDelete("templates/{id:int}")]
    public async Task<IActionResult> DeleteTemplate(int id)
    {
        var template = await _db.EmailTemplates.FirstOrDefaultAsync(x => x.Id == id);
        if (template == null) return NotFound(new { error = "Template not found" });

        _db.EmailTemplates.Remove(template);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Template deleted" });
    }

    [HttpGet("logs")]
    public async Task<IActionResult> GetLogs([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var logs = await _db.EmailLogs
            .OrderByDescending(l => l.SentAt)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();

        var total = await _db.EmailLogs.CountAsync();

        return Ok(new
        {
            data = logs.Select(l => new
            {
                l.Id, to_email = l.ToEmail, l.Subject, status = l.Status.ToString().ToLower(),
                sent_at = l.SentAt, error_message = l.ErrorMessage
            }),
            meta = new { page, limit, total }
        });
    }

    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var total = await _db.EmailLogs.CountAsync();
        var sent = await _db.EmailLogs.CountAsync(l => l.Status == EmailSendStatus.Sent);
        var failed = await _db.EmailLogs.CountAsync(l => l.Status == EmailSendStatus.Failed);
        var today = await _db.EmailLogs.CountAsync(l => l.SentAt >= DateTime.UtcNow.Date);

        return Ok(new { data = new { total, sent, failed, sent_today = today } });
    }
}

public class CreateEmailTemplateRequest
{
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("subject")] public string Subject { get; set; } = string.Empty;
    [JsonPropertyName("body_html")] public string BodyHtml { get; set; } = string.Empty;
    [JsonPropertyName("body_text")] public string? BodyText { get; set; }
}

public class UpdateEmailTemplateRequest
{
    [JsonPropertyName("key")] public string? Key { get; set; }
    [JsonPropertyName("subject")] public string? Subject { get; set; }
    [JsonPropertyName("body_html")] public string? BodyHtml { get; set; }
    [JsonPropertyName("body_text")] public string? BodyText { get; set; }
    [JsonPropertyName("is_active")] public bool? IsActive { get; set; }
}
