// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Legal document management — Terms of Service, Privacy Policy, etc.
/// Public endpoints for viewing documents, authenticated endpoints for accepting them.
/// </summary>
[ApiController]
[Route("api/legal")]
public class LegalDocumentsController : ControllerBase
{
    private readonly LegalDocumentService _legalDocumentService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<LegalDocumentsController> _logger;

    public LegalDocumentsController(
        LegalDocumentService legalDocumentService,
        TenantContext tenantContext,
        ILogger<LegalDocumentsController> logger)
    {
        _legalDocumentService = legalDocumentService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    /// <summary>
    /// GET /api/legal/documents — List active legal documents for this tenant.
    /// </summary>
    [HttpGet("documents")]
    [AllowAnonymous]
    public async Task<IActionResult> GetDocuments()
    {
        if (!_tenantContext.IsResolved)
        {
            return BadRequest(new { error = "Tenant context is required." });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var documents = await _legalDocumentService.GetActiveDocumentsAsync(tenantId);

        return Ok(new
        {
            data = documents.Select(d => new
            {
                d.Id,
                d.Title,
                d.Slug,
                d.Version,
                requires_acceptance = d.RequiresAcceptance,
                created_at = d.CreatedAt,
                updated_at = d.UpdatedAt
            }),
            total = documents.Count
        });
    }

    /// <summary>
    /// GET /api/legal/documents/{slug} — Get a specific legal document by slug (full content).
    /// </summary>
    [HttpGet("documents/{slug}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetDocumentBySlug(string slug)
    {
        if (!_tenantContext.IsResolved)
        {
            return BadRequest(new { error = "Tenant context is required." });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var document = await _legalDocumentService.GetDocumentBySlugAsync(tenantId, slug);

        if (document == null)
        {
            return NotFound(new { error = "Document not found." });
        }

        return Ok(new
        {
            document.Id,
            document.Title,
            document.Slug,
            document.Content,
            document.Version,
            requires_acceptance = document.RequiresAcceptance,
            is_active = document.IsActive,
            created_at = document.CreatedAt,
            updated_at = document.UpdatedAt
        });
    }

    /// <summary>
    /// POST /api/legal/documents/{id}/accept — Accept a legal document.
    /// </summary>
    [HttpPost("documents/{id:int}/accept")]
    [Authorize]
    public async Task<IActionResult> AcceptDocument(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var ipAddress = HttpContext.Connection.RemoteIpAddress?.ToString();
        var userAgent = HttpContext.Request.Headers.UserAgent.ToString();

        try
        {
            var acceptance = await _legalDocumentService.AcceptDocumentAsync(
                tenantId, userId.Value, id, ipAddress, userAgent);

            return Ok(new
            {
                acceptance.Id,
                document_id = acceptance.LegalDocumentId,
                accepted_at = acceptance.AcceptedAt,
                message = "Document accepted successfully."
            });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/legal/acceptances — Get the current user's document acceptances.
    /// </summary>
    [HttpGet("acceptances")]
    [Authorize]
    public async Task<IActionResult> GetAcceptances()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var acceptances = await _legalDocumentService.GetUserAcceptancesAsync(tenantId, userId.Value);

        return Ok(new
        {
            data = acceptances.Select(a => new
            {
                a.Id,
                document_id = a.LegalDocumentId,
                document_title = a.LegalDocument?.Title,
                document_slug = a.LegalDocument?.Slug,
                document_version = a.LegalDocument?.Version,
                accepted_at = a.AcceptedAt
            }),
            total = acceptances.Count
        });
    }

    /// <summary>
    /// GET /api/legal/pending — Get documents the user hasn't accepted yet.
    /// </summary>
    [HttpGet("pending")]
    [Authorize]
    public async Task<IActionResult> GetPendingDocuments()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var pending = await _legalDocumentService.GetPendingDocumentsAsync(tenantId, userId.Value);

        return Ok(new
        {
            data = pending.Select(d => new
            {
                d.Id,
                d.Title,
                d.Slug,
                d.Version,
                requires_acceptance = d.RequiresAcceptance,
                created_at = d.CreatedAt
            }),
            total = pending.Count
        });
    }
}

/// <summary>
/// Admin endpoints for legal document management.
/// </summary>
[ApiController]
[Route("api/admin/legal")]
[Authorize(Policy = "AdminOnly")]
public class AdminLegalDocumentsController : ControllerBase
{
    private readonly LegalDocumentService _legalDocumentService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<AdminLegalDocumentsController> _logger;

    public AdminLegalDocumentsController(
        LegalDocumentService legalDocumentService,
        TenantContext tenantContext,
        ILogger<AdminLegalDocumentsController> logger)
    {
        _legalDocumentService = legalDocumentService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/admin/legal/documents — Create or update a legal document.
    /// When a new version is created, previous versions of the same slug are deactivated.
    /// </summary>
    [HttpPost("documents")]
    public async Task<IActionResult> CreateOrUpdateDocument([FromBody] CreateLegalDocumentRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "title is required." });

        if (string.IsNullOrWhiteSpace(request.Slug))
            return BadRequest(new { error = "slug is required." });

        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { error = "content is required." });

        if (string.IsNullOrWhiteSpace(request.Version))
            return BadRequest(new { error = "version is required." });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var document = await _legalDocumentService.CreateOrUpdateDocumentAsync(
            tenantId, request.Title, request.Slug, request.Content,
            request.Version, request.RequiresAcceptance);

        return Created($"/api/legal/documents/{document.Slug}", new
        {
            document.Id,
            document.Title,
            document.Slug,
            document.Content,
            document.Version,
            is_active = document.IsActive,
            requires_acceptance = document.RequiresAcceptance,
            created_at = document.CreatedAt,
            message = "Legal document created successfully."
        });
    }
}

#region Request DTOs

public class CreateLegalDocumentRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("slug")]
    public string Slug { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("version")]
    public string Version { get; set; } = string.Empty;

    [JsonPropertyName("requires_acceptance")]
    public bool RequiresAcceptance { get; set; } = true;
}

#endregion
