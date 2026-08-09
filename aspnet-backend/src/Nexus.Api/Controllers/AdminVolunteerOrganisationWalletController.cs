// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Focused owner for the money-critical admin volunteer wallet routes.
/// </summary>
[ApiController]
[Authorize(Policy = NexusAuthorizationPolicies.RouteAwareAdmin)]
[Route("api/v2/admin/volunteering/organizations/{organisationId:int}/wallet")]
public sealed class AdminVolunteerOrganisationWalletController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly VolunteerOrganisationService _organisations;
    private readonly VolunteerOrganisationWalletService _wallet;

    public AdminVolunteerOrganisationWalletController(
        NexusDbContext db,
        VolunteerOrganisationService organisations,
        VolunteerOrganisationWalletService wallet)
    {
        _db = db;
        _organisations = organisations;
        _wallet = wallet;
    }

    [HttpGet("transactions")]
    public async Task<IActionResult> GetTransactions(
        int organisationId,
        [FromQuery(Name = "per_page")] int perPage = 20,
        [FromQuery] string? cursor = null,
        CancellationToken cancellationToken = default)
    {
        var tenantId = User.GetTenantId();
        if (!tenantId.HasValue)
            return Error(400, "TENANT_CONTEXT_REQUIRED", "Authentication required with valid tenant context.");
        SetHeaders(tenantId.Value);
        if (!await _organisations.IsFeatureEnabledAsync(tenantId.Value, cancellationToken))
            return Error(403, "FEATURE_DISABLED", "Service unavailable");

        var page = await _wallet.GetTransactionsAsync(
            tenantId.Value,
            organisationId,
            perPage,
            cursor,
            type: null,
            cancellationToken);
        return Ok(new
        {
            data = page.Items,
            meta = new
            {
                base_url = await BaseUrlAsync(tenantId.Value, cancellationToken),
                cursor = page.Cursor,
                per_page = page.PerPage,
                has_more = page.HasMore
            }
        });
    }

    [HttpPut("adjust")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerOrganisationWalletAdminAdjustPolicy)]
    public async Task<IActionResult> Adjust(
        int organisationId,
        [FromBody] JsonElement body,
        CancellationToken cancellationToken = default)
    {
        var tenantId = User.GetTenantId();
        var adminUserId = User.GetUserId();
        if (!tenantId.HasValue || !adminUserId.HasValue)
            return Error(400, "TENANT_CONTEXT_REQUIRED", "Authentication required with valid tenant context.");
        SetHeaders(tenantId.Value);
        if (!await _organisations.IsFeatureEnabledAsync(tenantId.Value, cancellationToken))
            return Error(403, "FEATURE_DISABLED", "Service unavailable");

        var result = await _wallet.AdminAdjustmentAsync(
            tenantId.Value,
            adminUserId.Value,
            organisationId,
            Decimal(body, "amount") ?? 0m,
            String(body, "reason"),
            cancellationToken);
        if (!result.Success)
        {
            return Error(
                result.ErrorCode == "SERVER_ERROR" ? 500 : 400,
                result.ErrorCode!,
                result.ErrorMessage!,
                result.ErrorField);
        }

        return Ok(new
        {
            data = new { message = result.Message, new_balance = result.NewBalance },
            meta = new { base_url = await BaseUrlAsync(tenantId.Value, cancellationToken) }
        });
    }

    private void SetHeaders(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString(CultureInfo.InvariantCulture);
    }

    private async Task<string> BaseUrlAsync(int tenantId, CancellationToken cancellationToken)
    {
        var domain = await _db.Tenants
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Domain)
            .SingleOrDefaultAsync(cancellationToken);
        return string.IsNullOrWhiteSpace(domain)
            ? $"{Request.Scheme}://{Request.Host}".TrimEnd('/')
            : domain.TrimEnd('/');
    }

    private ObjectResult Error(int status, string code, string message, string? field = null) =>
        StatusCode(status, new { errors = new[] { new { code, message, field } } });

    private static string? String(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object
        && body.TryGetProperty(name, out var value)
        && value.ValueKind != JsonValueKind.Null
            ? value.ToString()
            : null;

    private static decimal? Decimal(JsonElement body, string name) =>
        decimal.TryParse(
            String(body, name),
            NumberStyles.Number,
            CultureInfo.InvariantCulture,
            out var value)
                ? value
                : null;
}
