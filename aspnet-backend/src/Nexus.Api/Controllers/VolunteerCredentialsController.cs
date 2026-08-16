// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// A volunteer's own credentials — first aid, safeguarding training and the
/// like (R-27).
///
/// 🔴 What was here before. There was no table, so nothing could be listed and
/// nothing could be deleted: the only handler was a POST that stored the file
/// and recorded nothing about it. A volunteer uploaded their certificate, was
/// told it worked, and saw an empty list for ever after — with no way to tell
/// "you have none" from "this did not load".
///
/// 🔴 The upload rule is enforced HERE, not only in the browser. The React
/// screen refuses police-check and vetting documents (DBS, Garda vetting,
/// AccessNI, PVG) because those must never be uploaded to the platform, but a
/// rule that lives only in the client is a suggestion — anything can post to
/// this endpoint. The server refuses the same list.
/// </summary>
[ApiController]
[Authorize]
public class VolunteerCredentialsController : ControllerBase
{
    /// <summary>
    /// Document types that must never be uploaded here. Mirrors
    /// PROHIBITED_VETTING_CREDENTIAL_TYPES in CredentialVerificationTab.tsx.
    /// Vetting is evidenced through the vetting workflow, which records an
    /// attestation rather than storing the certificate itself.
    /// </summary>
    private static readonly HashSet<string> ProhibitedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "police_check", "background_check",
        "dbs", "dbs_basic", "dbs_standard", "dbs_enhanced",
        "garda_vetting", "access_ni", "pvg_scotland",
    };

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly FileUploadService _fileService;
    private readonly ILogger<VolunteerCredentialsController> _logger;

    public VolunteerCredentialsController(
        NexusDbContext db,
        TenantContext tenantContext,
        FileUploadService fileService,
        ILogger<VolunteerCredentialsController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _fileService = fileService;
        _logger = logger;
    }

    /// <summary>GET /api/v2/volunteering/credentials — my credentials.</summary>
    [HttpGet("api/v2/volunteering/credentials")]
    [HttpGet("api/volunteering/credentials")]
    public async Task<IActionResult> List()
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var ct = HttpContext.RequestAborted;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var rows = await _db.VolunteerCredentials.AsNoTracking()
            .Where(c => c.UserId == userId.Value)
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(ct);

        var credentials = rows.Select(c => new
        {
            id = c.Id,
            type = c.CredentialType,
            type_label = LabelFor(c.CredentialType),
            document_name = c.FileName ?? string.Empty,
            upload_date = c.CreatedAt,

            // The client expects a plain date string; a full timestamp would
            // render as an expiry time that does not exist.
            expiry_date = c.ExpiresAt?.ToString("yyyy-MM-dd"),

            // 🔴 Expiry is derived at read time rather than trusted from the
            // stored status. Nothing sweeps this table nightly, so a credential
            // that lapsed yesterday would otherwise still read "verified" —
            // and "verified" is what a coordinator relies on when deciding who
            // may work with children and at-risk adults.
            status = c.ExpiresAt.HasValue && c.ExpiresAt.Value < today
                ? VolunteerCredential.Statuses.Expired
                : c.Status,

            rejection_reason = c.Status == VolunteerCredential.Statuses.Rejected ? c.Notes : null,
        }).ToList();

        return Ok(new { credentials });
    }

    /// <summary>POST /api/v2/volunteering/credentials — upload one.</summary>
    [HttpPost("api/v2/volunteering/credentials")]
    [HttpPost("api/volunteering/credentials")]
    public async Task<IActionResult> Upload(
        [FromForm] string? credential_type,
        [FromForm] string? expires_at,
        IFormFile? file = null)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var type = credential_type?.Trim();
        if (string.IsNullOrWhiteSpace(type))
        {
            return BadRequest(new { error = "credential_type is required" });
        }

        if (ProhibitedTypes.Contains(type))
        {
            _logger.LogWarning(
                "Refused a prohibited credential type {Type} from user {UserId}", type, userId.Value);
            return BadRequest(new
            {
                error = "This document type cannot be uploaded. "
                    + "Vetting is recorded through the vetting workflow, not by uploading the certificate.",
                code = "CREDENTIAL_TYPE_PROHIBITED",
            });
        }

        if (file is null || file.Length == 0)
        {
            return BadRequest(new { error = "No file provided" });
        }

        DateOnly? expiresAt = null;
        if (!string.IsNullOrWhiteSpace(expires_at))
        {
            if (!DateOnly.TryParse(expires_at, out var parsed))
            {
                return BadRequest(new { error = "expires_at must be a date (YYYY-MM-DD)" });
            }
            expiresAt = parsed;
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (upload, error) = await _fileService.UploadAsync(
            file.OpenReadStream(), file.FileName, file.ContentType, file.Length,
            userId.Value, tenantId, FileCategory.Document);
        if (error != null) return BadRequest(new { error });

        var credential = new VolunteerCredential
        {
            TenantId = tenantId,
            UserId = userId.Value,
            CredentialType = type,
            FileUrl = upload is null ? null : _fileService.GetDownloadUrl(upload),
            FileName = file.FileName,
            Status = VolunteerCredential.Statuses.Pending,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow,
        };

        _db.VolunteerCredentials.Add(credential);
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        return Ok(new
        {
            success = true,
            data = new { id = credential.Id, status = credential.Status },
        });
    }

    /// <summary>DELETE /api/v2/volunteering/credentials/{id} — remove mine.</summary>
    [HttpDelete("api/v2/volunteering/credentials/{id:int}")]
    [HttpDelete("api/volunteering/credentials/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var ct = HttpContext.RequestAborted;

        // 🔴 Scoped to the owner. Deleting by id alone would let one member
        // remove another's safeguarding evidence, and 404 (not 403) so the
        // response does not confirm that someone else's credential exists.
        var credential = await _db.VolunteerCredentials
            .FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId.Value, ct);

        if (credential is null)
        {
            return NotFound(new { error = "Credential not found" });
        }

        _db.VolunteerCredentials.Remove(credential);
        await _db.SaveChangesAsync(ct);

        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    private static string LabelFor(string type) => type switch
    {
        "first_aid" => "First Aid",
        "safeguarding" => "Safeguarding",
        "manual_handling" => "Manual Handling",
        "food_hygiene" => "Food Hygiene",
        "driving_licence" => "Driving Licence",
        "professional_registration" => "Professional Registration",
        "other" => "Other",
        _ => type.Replace('_', ' '),
    };
}
