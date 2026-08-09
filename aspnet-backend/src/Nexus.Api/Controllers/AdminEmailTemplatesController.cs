// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Phase 64 — admin endpoints for email template versioning + render preview.
/// Replaces V1's Mailchimp template flow. Routes intentionally do not collide
/// with the existing /api/admin/email-templates endpoints in
/// AdminCompatibility3Controller (those operate on a single un-versioned row);
/// these live under /api/admin/email-templates/v2 to opt in to the new model.
/// </summary>
[ApiController]
[Route("api/admin/email-templates/v2")]
[Authorize(Policy = "AdminOnly")]
public class AdminEmailTemplatesController : ControllerBase
{
    private readonly EmailTemplateService _service;

    public AdminEmailTemplatesController(EmailTemplateService service)
    {
        _service = service;
    }

    /// <summary>List all versions of all templates (most-recent first per key).</summary>
    [HttpGet]
    public async Task<IActionResult> ListAll([FromQuery] string? key = null)
    {
        var rows = await _service.ListAllVersionsAsync(key);
        return Ok(new { data = rows.Select(MapTemplate), total = rows.Count });
    }

    /// <summary>List only the currently-active version of each template.</summary>
    [HttpGet("active")]
    public async Task<IActionResult> ListActive()
    {
        var rows = await _service.ListActiveAsync();
        return Ok(new { data = rows.Select(MapTemplate), total = rows.Count });
    }

    /// <summary>Get a single version by id.</summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetVersion(int id)
    {
        var row = await _service.GetByIdAsync(id);
        return row == null ? NotFound() : Ok(new { data = MapTemplate(row) });
    }

    /// <summary>Create a new version of a template (optionally activate).</summary>
    [HttpPost]
    public async Task<IActionResult> CreateVersion([FromBody] CreateVersionRequest req)
    {
        try
        {
            var entity = await _service.CreateVersionAsync(
                req.Key, req.Subject, req.BodyHtml, req.BodyText,
                req.ChangeNote, User.GetUserId(), req.Activate ?? true);
            return Created($"/api/admin/email-templates/v2/{entity.Id}", new { data = MapTemplate(entity) });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Activate a non-active version (atomically deactivates siblings).</summary>
    [HttpPost("{id:int}/activate")]
    public async Task<IActionResult> Activate(int id)
    {
        var entity = await _service.ActivateVersionAsync(id);
        return entity == null
            ? NotFound()
            : Ok(new { success = true, data = MapTemplate(entity) });
    }

    /// <summary>Delete a non-active version. Active versions cannot be deleted.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var (deleted, error) = await _service.DeleteVersionAsync(id);
        if (deleted) return Ok(new { success = true });
        return error == "not_found" ? NotFound() : BadRequest(new { error });
    }

    /// <summary>
    /// Render the active version of a template against a variables dictionary.
    /// Useful for the admin "preview" UI without actually sending email.
    /// </summary>
    [HttpPost("render")]
    public async Task<IActionResult> Render([FromBody] RenderRequest req)
    {
        var rendered = await _service.RenderActiveAsync(req.Key, req.Variables ?? new Dictionary<string, string?>());
        return rendered == null
            ? NotFound(new { error = "no_active_version" })
            : Ok(new
            {
                data = new
                {
                    subject = rendered.Value.Subject,
                    body_html = rendered.Value.BodyHtml,
                    body_text = rendered.Value.BodyText
                }
            });
    }

    private static object MapTemplate(Entities.EmailTemplate t) => new
    {
        t.Id,
        t.Key,
        t.Version,
        is_active = t.IsActive,
        t.Subject,
        body_html = t.BodyHtml,
        body_text = t.BodyText,
        change_note = t.ChangeNote,
        created_by_user_id = t.CreatedByUserId,
        created_at = t.CreatedAt,
        updated_at = t.UpdatedAt
    };

    public class CreateVersionRequest
    {
        [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
        [JsonPropertyName("subject")] public string Subject { get; set; } = string.Empty;
        [JsonPropertyName("body_html")] public string BodyHtml { get; set; } = string.Empty;
        [JsonPropertyName("body_text")] public string? BodyText { get; set; }
        [JsonPropertyName("change_note")] public string? ChangeNote { get; set; }
        [JsonPropertyName("activate")] public bool? Activate { get; set; }
    }

    public class RenderRequest
    {
        [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
        [JsonPropertyName("variables")] public Dictionary<string, string?>? Variables { get; set; }
    }
}
