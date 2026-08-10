// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/category-coefficients")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityCategoryCoefficientsController : ControllerBase
{
    private readonly CaringCategoryCoefficientService _coefficients;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityCategoryCoefficientsController(
        CaringCategoryCoefficientService coefficients,
        TenantContext tenant)
    {
        _coefficients = coefficients;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _coefficients.ListAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(
        int id,
        [FromBody] CategoryCoefficientRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (!CaringCategoryCoefficientService.IsAllowedSourceTable(request.SourceTable))
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_INVALID_FIELD",
                "Source table is invalid.",
                "source_table"));
        }

        if (request.SubstitutionCoefficient is null)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_REQUIRED_FIELD",
                "Substitution coefficient is required.",
                "substitution_coefficient"));
        }

        if (!CaringCategoryCoefficientService.TryNormalizeCoefficient(
            request.SubstitutionCoefficient,
            out var coefficient))
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_INVALID_FIELD",
                "Substitution coefficient must be numeric.",
                "substitution_coefficient"));
        }

        coefficient = CaringCategoryCoefficientService.RoundCoefficient(coefficient);
        if (coefficient < 0.00m || coefficient > 9.99m)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_OUT_OF_RANGE",
                "Substitution coefficient is out of range.",
                "substitution_coefficient"));
        }

        var result = await _coefficients.UpdateAsync(_tenant.GetTenantIdOrThrow(), id, coefficient, ct);
        if (result.NotFound)
        {
            return NotFound(LaravelError("NOT_FOUND", "Category not found."));
        }

        return Ok(new { data = result.Row });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _coefficients.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };

        if (field is not null)
        {
            error["field"] = field;
        }

        return new { errors = new[] { error } };
    }
}
