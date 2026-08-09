// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Insurance certificate tracking endpoints.
/// </summary>
[ApiController]
[Route("api/insurance")]
[Authorize]
public class InsuranceController : ControllerBase
{
    private readonly InsuranceService _insurance;
    private readonly FileUploadService _fileUploadService;
    private readonly TenantContext _tenantContext;

    public InsuranceController(
        InsuranceService insurance,
        FileUploadService fileUploadService,
        TenantContext tenantContext)
    {
        _insurance = insurance;
        _fileUploadService = fileUploadService;
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// GET /api/insurance - Get my certificates.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetMyCertificates()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var certs = await _insurance.GetUserCertificatesAsync(userId.Value);
        return Ok(new { data = certs.Select(c => MapCert(c)) });
    }

    /// <summary>
    /// GET /api/v2/users/me/insurance - Laravel React certificate list.
    /// </summary>
    [HttpGet("/api/v2/users/me/insurance")]
    public async Task<IActionResult> GetMyCertificatesV2()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, errors = new[] { new { code = "UNAUTHENTICATED", message = "Invalid token" } } });

        var certs = await _insurance.GetUserCertificatesAsync(userId.Value);
        return Ok(new { success = true, data = certs.Select(MapLaravelCert) });
    }

    /// <summary>
    /// GET /api/insurance/{id} - Get certificate details.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetCertificate(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var cert = await _insurance.GetByIdAsync(id);
        if (cert == null) return NotFound(new { error = "Certificate not found" });
        if (cert.UserId != userId) return NotFound(new { error = "Certificate not found" });
        return Ok(new { data = MapCert(cert) });
    }

    /// <summary>
    /// POST /api/insurance - Upload a certificate.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateInsuranceRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (cert, error) = await _insurance.CreateAsync(
            userId.Value, request.Type, request.Provider, request.PolicyNumber,
            request.CoverAmount, request.StartDate, request.ExpiryDate, request.DocumentUrl);

        if (error != null) return BadRequest(new { error });
        return Created($"/api/insurance/{cert!.Id}", new { data = new { cert.Id, cert.Type, cert.Status } });
    }

    /// <summary>
    /// POST /api/v2/users/me/insurance - Laravel React multipart certificate upload.
    /// </summary>
    [HttpPost("/api/v2/users/me/insurance")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> CreateV2(CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, errors = new[] { new { code = "UNAUTHENTICATED", message = "Invalid token" } } });
        if (!Request.HasFormContentType)
        {
            return StatusCode(StatusCodes.Status415UnsupportedMediaType, new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Expected multipart form-data.", field = "certificate_file" } }
            });
        }

        var form = await Request.ReadFormAsync(cancellationToken);
        var insuranceType = (form["insurance_type"].FirstOrDefault() ?? "public_liability").Trim();
        if (!AllowedLaravelInsuranceTypes.Contains(insuranceType))
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Invalid insurance type.", field = "insurance_type" } }
            });
        }

        var file = form.Files.GetFile("certificate_file");
        string? documentUrl = null;
        if (file is { Length: > 0 })
        {
            if (!AllowedLaravelInsuranceMimeTypes.Contains(file.ContentType))
            {
                return UnprocessableEntity(new
                {
                    success = false,
                    errors = new[] { new { code = "VALIDATION_ERROR", message = "Insurance certificates must be PDF, JPEG, or PNG files.", field = "certificate_file" } }
                });
            }

            if (file.Length > 10 * 1024 * 1024)
            {
                return UnprocessableEntity(new
                {
                    success = false,
                    errors = new[] { new { code = "VALIDATION_ERROR", message = "File exceeds the 10 MB limit.", field = "certificate_file" } }
                });
            }

            await using var stream = file.OpenReadStream();
            var (upload, uploadError) = await _fileUploadService.UploadAsync(
                stream,
                file.FileName,
                file.ContentType,
                file.Length,
                userId.Value,
                _tenantContext.GetTenantIdOrThrow(),
                FileCategory.Document,
                entityType: "insurance_certificate");

            if (uploadError != null || upload == null)
            {
                return UnprocessableEntity(new
                {
                    success = false,
                    errors = new[] { new { code = "VALIDATION_ERROR", message = uploadError ?? "Upload failed.", field = "certificate_file" } }
                });
            }

            documentUrl = _fileUploadService.GetDownloadUrl(upload);
        }

        var startDate = Date(form["start_date"].FirstOrDefault()) ?? DateTime.UtcNow.Date;
        var expiryDate = Date(form["expiry_date"].FirstOrDefault()) ?? startDate.AddYears(1);
        var coverageAmount = Decimal(form["coverage_amount"].FirstOrDefault());

        var (cert, error) = await _insurance.CreateAsync(
            userId.Value,
            insuranceType,
            form["provider_name"].FirstOrDefault(),
            form["policy_number"].FirstOrDefault(),
            coverageAmount,
            startDate,
            expiryDate,
            documentUrl,
            status: "submitted");

        if (error != null)
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = error, field = "expiry_date" } }
            });
        }

        return Created($"/api/v2/users/me/insurance/{cert!.Id}", new { success = true, data = MapLaravelCert(cert) });
    }

    /// <summary>
    /// PUT /api/insurance/{id} - Update a certificate.
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateInsuranceRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (cert, error) = await _insurance.UpdateAsync(
            id, userId.Value, request.Type, request.Provider, request.PolicyNumber,
            request.CoverAmount, request.StartDate, request.ExpiryDate, request.DocumentUrl);

        if (error != null) return BadRequest(new { error });
        return Ok(new { data = new { cert!.Id, cert.Type, cert.Status } });
    }

    /// <summary>
    /// DELETE /api/insurance/{id} - Delete a certificate.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _insurance.DeleteAsync(id, userId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Certificate deleted" });
    }

    // Admin endpoints
    /// <summary>
    /// GET /api/insurance/admin/pending - Pending certificates.
    /// </summary>
    [HttpGet("admin/pending")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminPending()
    {
        var certs = await _insurance.AdminListPendingAsync();
        return Ok(new { data = certs.Select(c => MapCert(c)) });
    }

    /// <summary>
    /// GET /api/insurance/admin/expiring - Expiring soon.
    /// </summary>
    [HttpGet("admin/expiring")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminExpiring([FromQuery] int days = 30)
    {
        var certs = await _insurance.AdminListExpiringAsync(days);
        return Ok(new { data = certs.Select(c => MapCert(c)) });
    }

    /// <summary>
    /// PUT /api/insurance/admin/{id}/verify - Verify a certificate.
    /// </summary>
    [HttpPut("admin/{id:int}/verify")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminVerify(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (cert, error) = await _insurance.AdminVerifyAsync(id, userId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { cert!.Id, cert.Status, verified_at = cert.VerifiedAt } });
    }

    /// <summary>
    /// PUT /api/insurance/admin/{id}/reject - Reject a certificate.
    /// </summary>
    [HttpPut("admin/{id:int}/reject")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminReject(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (cert, error) = await _insurance.AdminRejectAsync(id, userId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { cert!.Id, cert.Status } });
    }

    private static object MapCert(Entities.InsuranceCertificate c) => new
    {
        c.Id, c.Type, c.Provider, policy_number = c.PolicyNumber,
        cover_amount = c.CoverAmount, start_date = c.StartDate, expiry_date = c.ExpiryDate,
        document_url = c.DocumentUrl, c.Status, verified_at = c.VerifiedAt,
        created_at = c.CreatedAt, updated_at = c.UpdatedAt,
        user = c.User != null ? new { c.User.Id, c.User.FirstName, c.User.LastName } : null,
        verified_by = c.VerifiedBy != null ? new { c.VerifiedBy.Id, c.VerifiedBy.FirstName, c.VerifiedBy.LastName } : null
    };

    private static readonly HashSet<string> AllowedLaravelInsuranceTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "public_liability",
        "professional_indemnity",
        "employers_liability",
        "product_liability",
        "personal_accident",
        "other"
    };

    private static readonly HashSet<string> AllowedLaravelInsuranceMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/pdf",
        "image/jpeg",
        "image/png"
    };

    private static object MapLaravelCert(Entities.InsuranceCertificate c) => new
    {
        id = c.Id,
        tenant_id = c.TenantId,
        user_id = c.UserId,
        insurance_type = c.Type,
        provider_name = c.Provider,
        policy_number = c.PolicyNumber,
        coverage_amount = c.CoverAmount,
        start_date = c.StartDate,
        expiry_date = c.ExpiryDate,
        certificate_file_path = c.DocumentUrl,
        status = c.Status,
        notes = (string?)null,
        verified_by = c.VerifiedById,
        verified_at = c.VerifiedAt,
        created_at = c.CreatedAt,
        updated_at = c.UpdatedAt
    };

    private static DateTime? Date(string? value)
        => DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            ? DateTime.SpecifyKind(parsed.Date, DateTimeKind.Utc)
            : null;

    private static decimal? Decimal(string? value)
        => decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
}

public class CreateInsuranceRequest
{
    [JsonPropertyName("type")] public string Type { get; set; } = "other";
    [JsonPropertyName("provider")] public string? Provider { get; set; }
    [JsonPropertyName("policy_number")] public string? PolicyNumber { get; set; }
    [JsonPropertyName("cover_amount")] public decimal? CoverAmount { get; set; }
    [JsonPropertyName("start_date")] public DateTime StartDate { get; set; }
    [JsonPropertyName("expiry_date")] public DateTime ExpiryDate { get; set; }
    [JsonPropertyName("document_url")] public string? DocumentUrl { get; set; }
}

public class UpdateInsuranceRequest
{
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("provider")] public string? Provider { get; set; }
    [JsonPropertyName("policy_number")] public string? PolicyNumber { get; set; }
    [JsonPropertyName("cover_amount")] public decimal? CoverAmount { get; set; }
    [JsonPropertyName("start_date")] public DateTime? StartDate { get; set; }
    [JsonPropertyName("expiry_date")] public DateTime? ExpiryDate { get; set; }
    [JsonPropertyName("document_url")] public string? DocumentUrl { get; set; }
}
