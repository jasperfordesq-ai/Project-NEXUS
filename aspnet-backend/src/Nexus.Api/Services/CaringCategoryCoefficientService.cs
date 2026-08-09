// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringCategoryCoefficientService
{
    public const string CategoriesSourceTable = "categories";

    private readonly NexusDbContext _db;

    public CaringCategoryCoefficientService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<CategoryCoefficientListRow> ListAsync(int tenantId, CancellationToken ct)
    {
        var categories = await _db.Categories
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(category => category.TenantId == tenantId && category.IsActive)
            .OrderBy(category => category.SortOrder)
            .ThenBy(category => category.Name)
            .Select(category => new CategoryCoefficientRow(
                category.Id,
                category.Name,
                category.SubstitutionCoefficient,
                CategoriesSourceTable))
            .ToArrayAsync(ct);

        return new CategoryCoefficientListRow(categories, MigrationPending: false);
    }

    public async Task<CategoryCoefficientMutationResult> UpdateAsync(
        int tenantId,
        int id,
        decimal coefficient,
        CancellationToken ct)
    {
        var category = await _db.Categories
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == id, ct);

        if (category is null)
        {
            return new CategoryCoefficientMutationResult(NotFound: true);
        }

        category.SubstitutionCoefficient = coefficient;
        category.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return new CategoryCoefficientMutationResult(
            Row: new CategoryCoefficientUpdateRow(
                category.Id,
                category.SubstitutionCoefficient,
                CategoriesSourceTable));
    }

    public static bool IsAllowedSourceTable(string? sourceTable)
    {
        return string.Equals(sourceTable, CategoriesSourceTable, StringComparison.Ordinal);
    }

    public static bool TryNormalizeCoefficient(object? raw, out decimal coefficient)
    {
        coefficient = 0m;
        if (raw is null)
        {
            return false;
        }

        switch (raw)
        {
            case decimal value:
                coefficient = value;
                return true;
            case double value:
                coefficient = Convert.ToDecimal(value);
                return true;
            case float value:
                coefficient = Convert.ToDecimal(value);
                return true;
            case int value:
                coefficient = value;
                return true;
            case long value:
                coefficient = value;
                return true;
            case JsonElement { ValueKind: JsonValueKind.Number } element:
                return element.TryGetDecimal(out coefficient);
            case JsonElement { ValueKind: JsonValueKind.String } element:
                return decimal.TryParse(element.GetString(), out coefficient);
            case string value:
                return decimal.TryParse(value, out coefficient);
            default:
                return false;
        }
    }

    public static decimal RoundCoefficient(decimal coefficient)
    {
        return Math.Round(coefficient, 2, MidpointRounding.AwayFromZero);
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }
}

public sealed class CategoryCoefficientRequest
{
    [JsonPropertyName("source_table")] public string? SourceTable { get; set; }
    [JsonPropertyName("substitution_coefficient")] public object? SubstitutionCoefficient { get; set; }
}

public sealed record CategoryCoefficientListRow(
    [property: JsonPropertyName("categories")] IReadOnlyList<CategoryCoefficientRow> Categories,
    [property: JsonPropertyName("migration_pending")] bool MigrationPending);

public sealed record CategoryCoefficientRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("substitution_coefficient")] decimal SubstitutionCoefficient,
    [property: JsonPropertyName("source_table")] string SourceTable);

public sealed record CategoryCoefficientUpdateRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("substitution_coefficient")] decimal SubstitutionCoefficient,
    [property: JsonPropertyName("source_table")] string SourceTable);

public sealed record CategoryCoefficientMutationResult(
    CategoryCoefficientUpdateRow? Row = null,
    bool NotFound = false);
