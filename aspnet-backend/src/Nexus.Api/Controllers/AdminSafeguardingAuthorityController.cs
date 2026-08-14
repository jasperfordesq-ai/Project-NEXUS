// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Authority attestations — Laravel parity for AdminSafeguardingController's
/// authorityAttestations / attestAuthority / revokeAuthorityAttestation.
/// Two gates, exactly as Laravel: broker-or-admin first (403 lowercase
/// "forbidden" body), then safeguarding-staff (admins pass; a broker without
/// the safeguarding permission gets 403 AUTH_INSUFFICIENT_PERMISSIONS).
/// The evidence refusal runs before anything else: document details are
/// refused on KEY PRESENCE, not value — staff record only that they sighted
/// the authority, never what it says.
/// </summary>
[ApiController]
[Authorize]
public class AdminSafeguardingAuthorityController : ControllerBase
{
    private static readonly string[] BrokerOrAdminRoles =
        ["broker", "coordinator", "admin", "tenant_admin", "super_admin", "god"];
    private static readonly string[] AdminRoles =
        ["admin", "tenant_admin", "super_admin", "god"];

    /// <summary>Refused on key presence — see api.authority_evidence_refused.</summary>
    private static readonly string[] ProhibitedInputFields =
    [
        "document", "file", "document_url", "upload", "attachment",
        "reference_number", "certificate_number", "order_number", "case_number",
        "court_name", "issue_date", "expiry_date", "renewal_date",
    ];

    private readonly NexusDbContext _db;
    private readonly SupportAuthorityAttestationService _attestations;

    public AdminSafeguardingAuthorityController(
        NexusDbContext db, SupportAuthorityAttestationService attestations)
    {
        _db = db;
        _attestations = attestations;
    }

    [HttpGet("api/v2/admin/safeguarding/authority-attestations")]
    public async Task<IActionResult> List()
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        return LaravelData(new
        {
            relationships = await _attestations.ListRepresentRelationshipsAsync(HttpContext.RequestAborted)
        });
    }

    [HttpPost("api/v2/admin/safeguarding/authority-attestations")]
    public async Task<IActionResult> Attest([FromBody] JsonElement body)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        if (body.ValueKind == JsonValueKind.Object)
        {
            foreach (var field in ProhibitedInputFields)
            {
                if (body.TryGetProperty(field, out _))
                {
                    return LaravelError(422, "VALIDATION_ERROR",
                        "Do not enter document details. Record only that you have sighted the authority",
                        field);
                }
            }
        }

        var relationshipId = ReadInt(body, "relationship_id");
        var authorityType = ReadString(body, "authority_type") ?? "";
        var acknowledged = body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("acknowledged_sighted", out var ack)
            && ack.ValueKind == JsonValueKind.True;

        var result = await _attestations.AttestAsync(
            User.GetUserId()!.Value, relationshipId, authorityType, acknowledged,
            ReadString(body, "scope_summary"), ReadString(body, "private_notes"),
            HttpContext.RequestAborted);
        if (result is null)
        {
            // Laravel returns every attest failure — including NOT_FOUND — as 422.
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                new { errors = _attestations.Errors });
        }

        return LaravelData(result);
    }

    [HttpPost("api/v2/admin/safeguarding/authority-attestations/{id:long}/revoke")]
    public async Task<IActionResult> Revoke(long id, [FromBody] JsonElement? body)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var reasonCode = body is { ValueKind: JsonValueKind.Object } payload
            ? ReadString(payload, "reason_code") ?? "" : "";
        if (!await _attestations.RevokeAsync(
                User.GetUserId()!.Value, id, reasonCode, HttpContext.RequestAborted))
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                new { errors = _attestations.Errors });
        }

        return LaravelData(new { status = "revoked" });
    }

    /// <summary>
    /// broker-or-admin then safeguarding-staff. Admin tiers pass both; a
    /// broker/coordinator passes the first but — with no granular
    /// safeguarding permission grant modelled here yet — is refused by the
    /// second, exactly the Laravel default for an ungranted broker.
    /// </summary>
    private async Task<IActionResult?> GateAsync()
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null)
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status401Unauthorized, new
            {
                errors = new[] { new { code = "auth_required", message = "Authentication required" } },
                success = false
            });
        }

        var user = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == userId.Value && u.TenantId == tenantId.Value,
                HttpContext.RequestAborted);
        var isAdmin = user is not null
            && (AdminRoles.Contains(user.Role)
                || user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod);
        var isBrokerOrAdmin = isAdmin || (user is not null && BrokerOrAdminRoles.Contains(user.Role));

        if (!isBrokerOrAdmin)
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[] { new
                {
                    code = "forbidden",
                    message = "Broker or admin access is required"
                } },
                success = false
            });
        }

        if (!isAdmin)
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[] { new
                {
                    code = "AUTH_INSUFFICIENT_PERMISSIONS",
                    message = "Safeguarding staff access is required."
                } }
            });
        }

        return null;
    }

    private static int ReadInt(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var value)) return 0;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var parsed)) return parsed;
        return value.ValueKind == JsonValueKind.String
            && int.TryParse(value.GetString(), out var fromString) ? fromString : 0;
    }

    private static string? ReadString(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object
        && body.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private IActionResult LaravelData(object data)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = (User.GetTenantId() ?? 0).ToString();
        return Ok(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelError(int status, string code, string message, string? field)
    {
        Response.Headers["API-Version"] = "2.0";
        if (field is null)
            return StatusCode(status, new { errors = new[] { new { code, message } } });
        return StatusCode(status, new { errors = new[] { new { code, message, field } } });
    }
}
