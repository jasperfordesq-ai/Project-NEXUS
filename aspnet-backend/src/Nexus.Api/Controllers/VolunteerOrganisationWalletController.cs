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
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Canonical Laravel-compatible volunteer-organisation wallet surface.
/// Explicit ownership prevents the V2 alias convention from routing these
/// money-critical requests to historical compatibility placeholders.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v2/volunteering/organisations/{organisationId:int}/wallet")]
public sealed class VolunteerOrganisationWalletController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly VolunteerOrganisationService _organisations;
    private readonly VolunteerOrganisationWalletService _wallet;

    public VolunteerOrganisationWalletController(
        NexusDbContext db,
        VolunteerOrganisationService organisations,
        VolunteerOrganisationWalletService wallet)
    {
        _db = db;
        _organisations = organisations;
        _wallet = wallet;
    }

    [HttpGet]
    [HttpGet("/api/volunteering/organisations/{organisationId:int}/wallet")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerOrganisationWalletReadPolicy)]
    public async Task<IActionResult> GetWallet(
        int organisationId,
        CancellationToken cancellationToken = default)
    {
        var gate = await RequireAccessAsync(organisationId, cancellationToken);
        if (gate is not null)
            return gate;

        var tenantId = User.GetTenantId()!.Value;
        var summary = await _wallet.GetSummaryAsync(tenantId, organisationId, cancellationToken);
        return Ok(new
        {
            data = summary,
            meta = new { base_url = await BaseUrlAsync(tenantId, cancellationToken) }
        });
    }

    [HttpGet("transactions")]
    [HttpGet("/api/volunteering/organisations/{organisationId:int}/wallet/transactions")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerOrganisationWalletReadPolicy)]
    public async Task<IActionResult> GetTransactions(
        int organisationId,
        [FromQuery(Name = "per_page")] int perPage = 20,
        [FromQuery] string? cursor = null,
        [FromQuery] string? type = null,
        CancellationToken cancellationToken = default)
    {
        var gate = await RequireAccessAsync(organisationId, cancellationToken);
        if (gate is not null)
            return gate;

        var tenantId = User.GetTenantId()!.Value;
        var page = await _wallet.GetTransactionsAsync(
            tenantId,
            organisationId,
            perPage,
            cursor,
            type,
            cancellationToken);
        return Ok(new
        {
            data = page.Items,
            meta = new
            {
                base_url = await BaseUrlAsync(tenantId, cancellationToken),
                cursor = page.Cursor,
                per_page = page.PerPage,
                has_more = page.HasMore
            }
        });
    }

    [HttpPost("deposit")]
    [HttpPost("/api/volunteering/organisations/{organisationId:int}/wallet/deposit")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerOrganisationWalletDepositPolicy)]
    public async Task<IActionResult> Deposit(
        int organisationId,
        [FromBody] JsonElement body,
        CancellationToken cancellationToken = default)
    {
        var gate = await RequireAccessAsync(organisationId, cancellationToken);
        if (gate is not null)
            return gate;

        var tenantId = User.GetTenantId()!.Value;
        var userId = User.GetUserId()!.Value;
        var result = await _wallet.DepositAsync(
            tenantId,
            userId,
            organisationId,
            Decimal(body, "amount") ?? 0m,
            String(body, "note"),
            cancellationToken);
        if (!result.Success)
        {
            var status = result.ErrorCode switch
            {
                "ORG_NOT_ACTIVE" => StatusCodes.Status403Forbidden,
                "NOT_FOUND" => StatusCodes.Status404NotFound,
                "SERVER_ERROR" => StatusCodes.Status500InternalServerError,
                _ => StatusCodes.Status400BadRequest
            };
            return Error(status, result.ErrorCode!, result.ErrorMessage!, result.ErrorField);
        }

        return Ok(new
        {
            data = new
            {
                message = result.Message,
                new_balance = result.NewBalance
            },
            meta = new { base_url = await BaseUrlAsync(tenantId, cancellationToken) }
        });
    }

    private async Task<IActionResult?> RequireAccessAsync(
        int organisationId,
        CancellationToken cancellationToken)
    {
        var tenantId = User.GetTenantId();
        var userId = User.GetUserId();
        if (!tenantId.HasValue || !userId.HasValue)
            return Error(401, "UNAUTHORIZED", "Authentication required");

        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.Value.ToString(CultureInfo.InvariantCulture);
        if (!await _organisations.IsFeatureEnabledAsync(tenantId.Value, cancellationToken))
            return Error(403, "FEATURE_DISABLED", "Volunteering module is not enabled for this community");

        if (!await _organisations.CanManageDashboardAsync(
            organisationId,
            userId.Value,
            tenantId.Value,
            cancellationToken))
        {
            return Error(403, "FORBIDDEN", "Access denied");
        }

        return null;
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
        StatusCode(status, new
        {
            errors = new[] { new { code, message, field } }
        });

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
