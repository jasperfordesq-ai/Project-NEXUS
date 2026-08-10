// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services.Provisioning;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin endpoints for the new-tenant provisioning queue.
/// </summary>
[ApiController]
[Route("api/admin/provisioning/requests")]
[Authorize(Policy = NexusAuthorizationPolicies.RouteAwareAdmin)]
public class AdminProvisioningController : ControllerBase
{
    private readonly ProvisioningRequestService _service;
    private readonly NexusDbContext _db;

    public AdminProvisioningController(ProvisioningRequestService service, NexusDbContext db)
    {
        _service = service;
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery(Name = "page")] int page = 1,
        [FromQuery(Name = "page_size")] int pageSize = 50,
        CancellationToken ct = default)
    {
        var rows = await _service.ListAsync(status, page, pageSize, ct);
        return Ok(new { data = rows.Select(Project), page, page_size = pageSize });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var req = await _service.GetAsync(id, ct);
        return req == null ? NotFound() : Ok(Project(req));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateProvisioningRequestDto dto, CancellationToken ct)
    {
        try
        {
            var req = await _service.CreateAsync(dto, tenantIdOverride: null, ct);
            return CreatedAtAction(nameof(Get), new { id = req.Id }, Project(req));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/approve")]
    public async Task<IActionResult> Approve(Guid id, CancellationToken ct)
    {
        var userId = User.GetUserId() ?? 0;
        try { return Ok(Project(await _service.ApproveAsync(id, userId, ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/reject")]
    public async Task<IActionResult> Reject(Guid id, [FromBody] ReasonBody body, CancellationToken ct)
    {
        var userId = User.GetUserId() ?? 0;
        try { return Ok(Project(await _service.RejectAsync(id, userId, body?.Reason ?? "", ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/mark-provisioning")]
    public async Task<IActionResult> MarkProvisioning(Guid id, CancellationToken ct)
    {
        try { return Ok(Project(await _service.MarkProvisioningAsync(id, ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/mark-ready")]
    public async Task<IActionResult> MarkReady(Guid id, [FromBody] MarkReadyBody body, CancellationToken ct)
    {
        if (body == null || body.CreatedTenantId <= 0)
            return BadRequest(new { error = "created_tenant_id required" });
        try { return Ok(Project(await _service.MarkReadyAsync(id, body.CreatedTenantId, ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/mark-failed")]
    public async Task<IActionResult> MarkFailed(Guid id, [FromBody] ReasonBody body, CancellationToken ct)
    {
        try { return Ok(Project(await _service.MarkFailedAsync(id, body?.Reason ?? "", ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/retry")]
    public async Task<IActionResult> Retry(Guid id, CancellationToken ct)
    {
        try { return Ok(Project(await _service.RetryAsync(id, ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("/api/v2/super-admin/provisioning-requests")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> LaravelList(
        [FromQuery] string? status,
        [FromQuery(Name = "page")] int page = 1,
        [FromQuery(Name = "page_size")] int pageSize = 50,
        CancellationToken ct = default)
    {
        var rows = await _service.ListAsync(MapLaravelStatusFilter(status), page, pageSize, ct);
        return Ok(new { data = rows.Select(ProjectLaravel) });
    }

    [HttpGet("/api/v2/super-admin/provisioning-requests/{id:int}")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> LaravelGet(int id, CancellationToken ct)
    {
        var req = await FindByCompatIdAsync(id, ct);
        return req == null ? NotFound() : Ok(new { data = ProjectLaravel(req) });
    }

    [HttpPost("/api/v2/super-admin/provisioning-requests/{id:int}/approve")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> LaravelApprove(int id, CancellationToken ct)
    {
        var req = await FindByCompatIdAsync(id, ct);
        if (req == null) return NotFound();

        var userId = User.GetUserId() ?? 0;
        try
        {
            await _service.ApproveAsync(req.Id, userId, ct);
            return Ok(new { data = new { queued = true, request_id = id } });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("/api/v2/super-admin/provisioning-requests/{id:int}/reject")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> LaravelReject(int id, [FromBody] ReasonBody? body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body?.Reason))
            return UnprocessableEntity(new { message = "The reason field is required.", errors = new { reason = new[] { "The reason field is required." } } });

        var req = await FindByCompatIdAsync(id, ct);
        if (req == null) return NotFound();

        var userId = User.GetUserId() ?? 0;
        try
        {
            var rejected = await _service.RejectAsync(req.Id, userId, body.Reason, ct);
            return Ok(new { data = ProjectLaravel(rejected) });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("/api/v2/super-admin/provisioning-requests/{id:int}/retry")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> LaravelRetry(int id, CancellationToken ct)
    {
        var req = await FindByCompatIdAsync(id, ct);
        if (req == null) return NotFound();

        if (req.Status == ProvisioningRequestStatus.Failed)
            await _service.RetryAsync(req.Id, ct);

        return Ok(new { data = new { queued = true, request_id = id } });
    }

    internal static object Project(ProvisioningRequest r) => new
    {
        id = r.Id,
        tenant_id = r.TenantId,
        org_name = r.OrgName,
        requested_subdomain = r.RequestedSubdomain,
        contact_name = r.ContactName,
        contact_email = r.ContactEmail,
        contact_phone = r.ContactPhone,
        plan = r.Plan,
        country = r.Country,
        notes = r.Notes,
        status = r.Status.ToString().ToLowerInvariant(),
        requested_at = r.RequestedAt,
        approved_at = r.ApprovedAt,
        provisioned_at = r.ProvisionedAt,
        failed_at = r.FailedAt,
        approved_by = r.ApprovedBy,
        provisioned_by = r.ProvisionedBy,
        failure_reason = r.FailureReason,
        created_tenant_id = r.CreatedTenantId,
        created_at = r.CreatedAt,
        updated_at = r.UpdatedAt
    };

    internal static object ProjectLaravel(ProvisioningRequest r)
    {
        var extras = ReadLaravelExtras(r);
        return new
        {
            id = CompatId(r.Id),
            applicant_name = r.ContactName,
            applicant_email = r.ContactEmail,
            applicant_phone = r.ContactPhone,
            org_name = r.OrgName,
            country_code = r.Country,
            region_or_canton = ExtraString(extras, "region_or_canton"),
            requested_slug = r.RequestedSubdomain,
            requested_subdomain = r.RequestedSubdomain,
            tenant_category = r.Plan,
            languages = ExtraRaw(extras, "languages") ?? "[]",
            default_language = ExtraString(extras, "default_language") ?? "en",
            expected_member_count_bucket = ExtraString(extras, "expected_member_count_bucket"),
            intended_use = ExtraString(extras, "intended_use") ?? r.Notes,
            status = MapStatus(r.Status),
            reviewed_by = r.ApprovedBy,
            reviewed_at = r.ApprovedAt,
            rejection_reason = r.Status == ProvisioningRequestStatus.Rejected ? r.FailureReason : null,
            provisioned_tenant_id = r.CreatedTenantId,
            provisioning_log = ExtraRaw(extras, "provisioning_log"),
            created_at = r.CreatedAt,
            updated_at = r.UpdatedAt
        };
    }

    internal static object ProjectLaravelStatus(ProvisioningRequest r) => new
    {
        org_name = r.OrgName,
        requested_slug = r.RequestedSubdomain,
        status = MapStatus(r.Status),
        provisioned_tenant_id = r.CreatedTenantId,
        created_at = r.CreatedAt,
        reviewed_at = r.ApprovedAt
    };

    internal static int CompatId(Guid id)
    {
        var value = BitConverter.ToInt32(id.ToByteArray(), 0) & int.MaxValue;
        return value == 0 ? 1 : value;
    }

    internal static string MapStatus(ProvisioningRequestStatus status) => status switch
    {
        ProvisioningRequestStatus.Pending => "pending",
        ProvisioningRequestStatus.Approved => "approved",
        ProvisioningRequestStatus.Provisioning => "under_review",
        ProvisioningRequestStatus.Ready => "provisioned",
        ProvisioningRequestStatus.Failed => "failed",
        ProvisioningRequestStatus.Rejected => "rejected",
        _ => status.ToString().ToLowerInvariant()
    };

    internal static string? MapLaravelStatusFilter(string? status) => status?.Trim().ToLowerInvariant() switch
    {
        "pending" => nameof(ProvisioningRequestStatus.Pending),
        "approved" => nameof(ProvisioningRequestStatus.Approved),
        "under_review" => nameof(ProvisioningRequestStatus.Provisioning),
        "provisioned" => nameof(ProvisioningRequestStatus.Ready),
        "failed" => nameof(ProvisioningRequestStatus.Failed),
        "rejected" => nameof(ProvisioningRequestStatus.Rejected),
        _ => status
    };

    private async Task<ProvisioningRequest?> FindByCompatIdAsync(int id, CancellationToken ct)
    {
        var rows = await _db.ProvisioningRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .OrderByDescending(r => r.RequestedAt)
            .Take(1000)
            .ToListAsync(ct);

        return rows.FirstOrDefault(r => CompatId(r.Id) == id);
    }

    private static Dictionary<string, JsonElement> ReadLaravelExtras(ProvisioningRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Notes)) return new Dictionary<string, JsonElement>();

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(r.Notes) ?? new Dictionary<string, JsonElement>();
        }
        catch (JsonException)
        {
            return new Dictionary<string, JsonElement>();
        }
    }

    private static string? ExtraString(Dictionary<string, JsonElement> extras, string key)
    {
        if (!extras.TryGetValue(key, out var value)) return null;
        return value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText();
    }

    private static string? ExtraRaw(Dictionary<string, JsonElement> extras, string key) =>
        extras.TryGetValue(key, out var value) ? value.GetRawText() : null;

    public class ReasonBody
    {
        [JsonPropertyName("reason")] public string? Reason { get; set; }
    }

    public class MarkReadyBody
    {
        [JsonPropertyName("created_tenant_id")] public int CreatedTenantId { get; set; }
    }
}

/// <summary>
/// Public submission endpoint for new-tenant provisioning requests.
/// Anonymous (no JWT) so prospective tenants can self-serve via the marketing site.
/// Should be rate-limited at the gateway / nginx layer.
/// </summary>
[ApiController]
[Route("api/provisioning/requests")]
[AllowAnonymous]
public class PublicProvisioningController : ControllerBase
{
    private static readonly Regex SlugRegex = new("^[a-z0-9](-?[a-z0-9])*$", RegexOptions.Compiled);
    private readonly ProvisioningRequestService _service;
    private readonly NexusDbContext _db;

    public PublicProvisioningController(ProvisioningRequestService service, NexusDbContext db)
    {
        _service = service;
        _db = db;
    }

    [HttpPost]
    public async Task<IActionResult> Submit([FromBody] CreateProvisioningRequestDto dto, CancellationToken ct)
    {
        try
        {
            // Public submissions default to the platform tenant (id=1).
            // The full provisioning workflow runs in admin context.
            var req = await _service.CreateAsync(dto, tenantIdOverride: 1, ct);
            return Accepted(new { id = req.Id, status = "pending" });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("/api/v2/provisioning-requests")]
    public async Task<IActionResult> LaravelSubmit([FromBody] LaravelProvisioningRequestDto dto, CancellationToken ct)
    {
        var slug = dto.RequestedSlug ?? dto.RequestedSubdomain ?? string.Empty;
        var create = new CreateProvisioningRequestDto
        {
            OrgName = dto.OrgName,
            RequestedSubdomain = slug,
            ContactName = dto.ApplicantName,
            ContactEmail = dto.ApplicantEmail,
            ContactPhone = dto.ApplicantPhone,
            Plan = dto.TenantCategory,
            Country = dto.CountryCode,
            Notes = JsonSerializer.Serialize(new
            {
                dto.RegionOrCanton,
                requested_slug = slug,
                dto.Languages,
                dto.DefaultLanguage,
                dto.ExpectedMemberCountBucket,
                dto.IntendedUse
            }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower })
        };

        try
        {
            var req = await _service.CreateAsync(create, tenantIdOverride: 1, ct);
            return StatusCode(StatusCodes.Status201Created, new
            {
                data = new
                {
                    id = AdminProvisioningController.CompatId(req.Id),
                    status = AdminProvisioningController.MapStatus(req.Status),
                    status_token = req.Id.ToString("N")
                }
            });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message, error = ex.Message });
        }
    }

    [HttpGet("/api/v2/provisioning-requests/check-slug/{slug}")]
    public async Task<IActionResult> LaravelCheckSlug(string slug, CancellationToken ct)
    {
        slug = (slug ?? string.Empty).Trim().ToLowerInvariant();
        if (slug.Length < 3 || slug.Length > 32 || !SlugRegex.IsMatch(slug))
        {
            return Ok(new { data = new { available = false, reason = "invalid_format" } });
        }

        var tenantTaken = await _db.Tenants
            .IgnoreQueryFilters()
            .AnyAsync(t => t.Slug == slug, ct);
        var requestTaken = await _db.ProvisioningRequests
            .IgnoreQueryFilters()
            .AnyAsync(r => r.RequestedSubdomain == slug
                && r.Status != ProvisioningRequestStatus.Rejected
                && r.Status != ProvisioningRequestStatus.Failed, ct);

        return Ok(new { data = new { available = !(tenantTaken || requestTaken), reason = tenantTaken || requestTaken ? "taken" : null } });
    }

    [HttpGet("/api/v2/provisioning-requests/status/{token}")]
    public async Task<IActionResult> LaravelStatus(string token, CancellationToken ct)
    {
        if (!Guid.TryParse(token, out var id)
            && (token.Length != 32 || !Guid.TryParseExact(token, "N", out id)))
        {
            return NotFound();
        }

        var req = await _db.ProvisioningRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id, ct);

        return req == null ? NotFound() : Ok(new { data = AdminProvisioningController.ProjectLaravelStatus(req) });
    }

    public class LaravelProvisioningRequestDto
    {
        [JsonPropertyName("applicant_name")] public string ApplicantName { get; set; } = string.Empty;
        [JsonPropertyName("applicant_email")] public string ApplicantEmail { get; set; } = string.Empty;
        [JsonPropertyName("applicant_phone")] public string? ApplicantPhone { get; set; }
        [JsonPropertyName("org_name")] public string OrgName { get; set; } = string.Empty;
        [JsonPropertyName("country_code")] public string? CountryCode { get; set; }
        [JsonPropertyName("region_or_canton")] public string? RegionOrCanton { get; set; }
        [JsonPropertyName("requested_slug")] public string? RequestedSlug { get; set; }
        [JsonPropertyName("requested_subdomain")] public string? RequestedSubdomain { get; set; }
        [JsonPropertyName("tenant_category")] public string? TenantCategory { get; set; }
        [JsonPropertyName("languages")] public string[] Languages { get; set; } = Array.Empty<string>();
        [JsonPropertyName("default_language")] public string? DefaultLanguage { get; set; }
        [JsonPropertyName("expected_member_count_bucket")] public string? ExpectedMemberCountBucket { get; set; }
        [JsonPropertyName("intended_use")] public string? IntendedUse { get; set; }
        [JsonPropertyName("captcha_token")] public string? CaptchaToken { get; set; }
    }
}
