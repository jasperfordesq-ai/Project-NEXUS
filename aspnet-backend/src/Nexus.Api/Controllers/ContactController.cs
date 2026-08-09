// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api")]
public class ContactController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<ContactController> _logger;
    private readonly Services.ITurnstileVerifier _turnstile;

    public ContactController(NexusDbContext db, TenantContext tenant, ILogger<ContactController> logger, Services.ITurnstileVerifier turnstile)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
        _turnstile = turnstile;
    }

    private string? GetClientIp() => HttpContext?.Connection?.RemoteIpAddress?.ToString();

    /// <summary>POST /api/contact - Submit a contact form (public or authenticated).</summary>
    [HttpPost("contact")]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> Submit([FromBody] ContactRequest request)
    {
        // Cloudflare Turnstile — bot challenge on contact submissions.
        var token = request.CfTurnstileResponse ?? request.TurnstileToken;
        if (!await _turnstile.VerifyAsync(token, GetClientIp()))
        {
            return BadRequest(new
            {
                error = "Bot verification failed. Please retry the challenge and submit again.",
                error_code = "turnstile_failed",
            });
        }

        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Email) ||
            string.IsNullOrWhiteSpace(request.Subject) || string.IsNullOrWhiteSpace(request.Message))
            return BadRequest(new { error = "Name, email, subject, and message are required" });

        if (request.Name.Length > 200)
            return BadRequest(new { error = "Name must be 200 characters or less" });
        if (request.Email.Length > 320 || !request.Email.Contains('@'))
            return BadRequest(new { error = "Invalid email address" });
        if (request.Subject.Length > 500)
            return BadRequest(new { error = "Subject must be 500 characters or less" });
        if (request.Message.Length > 5000)
            return BadRequest(new { error = "Message must be 5000 characters or less" });

        var tenantId = _tenant.GetTenantIdOrThrow();
        var userId = User.GetUserId();

        var submission = new ContactSubmission
        {
            TenantId = tenantId,
            Name = request.Name.Trim(),
            Email = request.Email.Trim().ToLower(),
            Subject = request.Subject.Trim(),
            Message = request.Message.Trim(),
            Category = request.Category,
            UserId = userId
        };

        _db.ContactSubmissions.Add(submission);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Contact form submitted: {Subject} from {Email}", submission.Subject, submission.Email);
        return Ok(new { success = true, message = "Your message has been received. We will respond shortly.", id = submission.Id });
    }

    /// <summary>GET /api/admin/contact - List contact submissions (admin).</summary>
    [HttpGet("admin/contact")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> List(
        [FromQuery] int page = 1, [FromQuery] int limit = 20,
        [FromQuery] bool unresolved_only = false,
        [FromQuery] string? category = null)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var tenantId = _tenant.GetTenantIdOrThrow();
        var query = _db.ContactSubmissions.AsNoTracking().Where(c => c.TenantId == tenantId);

        if (unresolved_only) query = query.Where(c => !c.IsResolved);
        if (!string.IsNullOrEmpty(category)) query = query.Where(c => c.Category == category);

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(c => c.CreatedAt)
            .Skip((page - 1) * limit).Take(limit)
            .Select(c => new
            {
                c.Id, c.Name, c.Email, c.Subject, c.Category,
                c.IsResolved, c.ResolvedAt, c.CreatedAt,
                user_id = c.UserId,
                message_preview = c.Message.Length > 100 ? c.Message.Substring(0, 100) + "..." : c.Message
            })
            .ToListAsync();

        return Ok(new { data = items, total, page, limit });
    }

    /// <summary>GET /api/admin/contact/{id} - Get full contact submission (admin).</summary>
    [HttpGet("admin/contact/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Get(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var item = await _db.ContactSubmissions.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId);
        if (item == null) return NotFound(new { error = "Not found" });
        return Ok(item);
    }

    /// <summary>PUT /api/admin/contact/{id}/resolve - Mark as resolved (admin).</summary>
    [HttpPut("admin/contact/{id:int}/resolve")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Resolve(int id, [FromBody] ResolveContactRequest request)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var item = await _db.ContactSubmissions.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId);
        if (item == null) return NotFound(new { error = "Not found" });

        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        item.IsResolved = true;
        item.ResolvedAt = DateTime.UtcNow;
        item.ResolvedById = adminId.Value;
        item.ResolvedNote = request.Note;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Marked as resolved" });
    }

    /// <summary>DELETE /api/admin/contact/{id} - Delete submission (admin).</summary>
    [HttpDelete("admin/contact/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Delete(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var item = await _db.ContactSubmissions.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId);
        if (item == null) return NotFound(new { error = "Not found" });

        _db.ContactSubmissions.Remove(item);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }
}

public class ContactRequest
{
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? Category { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("cf-turnstile-response")]
    public string? CfTurnstileResponse { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("turnstile_token")]
    public string? TurnstileToken { get; set; }
}

public class ResolveContactRequest
{
    public string? Note { get; set; }
}
