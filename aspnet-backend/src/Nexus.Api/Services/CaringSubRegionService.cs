// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed partial class CaringSubRegionService
{
    private const int PerPage = 50;

    private static readonly string[] ValidTypes = ["quartier", "ortsteil", "municipality", "canton", "other"];
    private static readonly string[] ValidStatuses = ["active", "inactive"];
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public CaringSubRegionService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
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

    public async Task<CaringSubRegionPage> ListAsync(
        int tenantId,
        string? type,
        string? search,
        int page,
        bool admin,
        CancellationToken ct)
    {
        page = Math.Max(1, page);
        var query = _db.CaringSubRegions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(region => region.TenantId == tenantId);

        if (!admin)
        {
            query = query.Where(region => region.Status == "active");
        }

        if (!string.IsNullOrWhiteSpace(type))
        {
            var typeFilter = type.Trim();
            query = query.Where(region => region.Type == typeFilter);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchTerm = search.Trim().ToLowerInvariant();
            var slugTerm = Slugify(search);
            query = query.Where(region =>
                region.Name.ToLower().Contains(searchTerm)
                || (region.Description != null && region.Description.ToLower().Contains(searchTerm))
                || region.Slug.Contains(slugTerm));
        }

        var total = await query.CountAsync(ct);
        var rows = await query
            .OrderBy(region => region.Name)
            .Skip((page - 1) * PerPage)
            .Take(PerPage)
            .ToListAsync(ct);

        return new CaringSubRegionPage(
            rows.Select(Map).ToArray(),
            total,
            PerPage,
            page);
    }

    public async Task<CaringSubRegionRow?> GetAsync(int tenantId, int id, CancellationToken ct)
    {
        var row = await _db.CaringSubRegions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(region => region.TenantId == tenantId && region.Id == id, ct);

        return row is null ? null : Map(row);
    }

    public async Task<CaringSubRegionMutationResult> CreateAsync(
        int tenantId,
        CaringSubRegionRequest request,
        int adminUserId,
        CancellationToken ct)
    {
        var validationError = Validate(request, create: true);
        if (validationError is not null)
        {
            return new CaringSubRegionMutationResult(ErrorCode: "VALIDATION_ERROR", ErrorMessage: validationError);
        }

        var slug = Slugify(request.Slug ?? request.Name ?? string.Empty);
        if (slug.Length == 0)
        {
            return new CaringSubRegionMutationResult(
                ErrorCode: "SUB_REGION_INVALID",
                ErrorMessage: "Invalid sub-region slug.");
        }

        if (await SlugExistsAsync(tenantId, slug, ignoreId: null, ct))
        {
            return new CaringSubRegionMutationResult(
                ErrorCode: "SUB_REGION_INVALID",
                ErrorMessage: "Sub-region slug already exists for this tenant.");
        }

        var now = DateTime.UtcNow;
        var row = new CaringSubRegion
        {
            TenantId = tenantId,
            Name = request.Name!.Trim(),
            Slug = slug,
            Type = IsValidType(request.Type) ? request.Type!.Trim() : "quartier",
            Description = request.Description,
            PostalCodes = EncodeJsonArray(request.PostalCodes),
            BoundaryGeoJson = EncodeJson(request.BoundaryGeoJson),
            CenterLatitude = request.CenterLatitude,
            CenterLongitude = request.CenterLongitude,
            Status = IsValidStatus(request.Status) ? request.Status!.Trim() : "active",
            CreatedBy = adminUserId,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringSubRegions.Add(row);
        await _db.SaveChangesAsync(ct);
        return new CaringSubRegionMutationResult(Row: Map(row));
    }

    public async Task<CaringSubRegionMutationResult> UpdateAsync(
        int tenantId,
        int id,
        CaringSubRegionRequest request,
        CancellationToken ct)
    {
        var validationError = Validate(request, create: false);
        if (validationError is not null)
        {
            return new CaringSubRegionMutationResult(ErrorCode: "VALIDATION_ERROR", ErrorMessage: validationError);
        }

        var row = await _db.CaringSubRegions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(region => region.TenantId == tenantId && region.Id == id, ct);
        if (row is null)
        {
            return new CaringSubRegionMutationResult(NotFound: true);
        }

        if (request.Slug is not null)
        {
            var slug = Slugify(request.Slug);
            if (slug.Length == 0)
            {
                return new CaringSubRegionMutationResult(
                    ErrorCode: "SUB_REGION_INVALID",
                    ErrorMessage: "Invalid sub-region slug.");
            }

            if (await SlugExistsAsync(tenantId, slug, id, ct))
            {
                return new CaringSubRegionMutationResult(
                    ErrorCode: "SUB_REGION_INVALID",
                    ErrorMessage: "Sub-region slug already exists for this tenant.");
            }

            row.Slug = slug;
        }

        if (request.Name is not null) row.Name = request.Name.Trim();
        if (request.Type is not null) row.Type = request.Type.Trim();
        if (request.Description is not null) row.Description = request.Description;
        if (request.Status is not null) row.Status = request.Status.Trim();
        if (request.CenterLatitude.HasValue) row.CenterLatitude = request.CenterLatitude;
        if (request.CenterLongitude.HasValue) row.CenterLongitude = request.CenterLongitude;
        if (request.PostalCodes is not null) row.PostalCodes = EncodeJsonArray(request.PostalCodes);
        if (request.BoundaryGeoJson is not null) row.BoundaryGeoJson = EncodeJson(request.BoundaryGeoJson);
        row.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return new CaringSubRegionMutationResult(Row: Map(row));
    }

    public async Task<CaringSubRegionMutationResult> DeleteAsync(int tenantId, int id, CancellationToken ct)
    {
        var row = await _db.CaringSubRegions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(region => region.TenantId == tenantId && region.Id == id, ct);
        if (row is null)
        {
            return new CaringSubRegionMutationResult(NotFound: true);
        }

        row.Status = "inactive";
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return new CaringSubRegionMutationResult(Row: Map(row));
    }

    private async Task<bool> SlugExistsAsync(int tenantId, string slug, int? ignoreId, CancellationToken ct)
    {
        var query = _db.CaringSubRegions
            .IgnoreQueryFilters()
            .Where(region => region.TenantId == tenantId && region.Slug == slug);

        if (ignoreId is not null)
        {
            query = query.Where(region => region.Id != ignoreId.Value);
        }

        return await query.AnyAsync(ct);
    }

    private static CaringSubRegionRow Map(CaringSubRegion region)
    {
        return new CaringSubRegionRow(
            region.Id,
            region.TenantId,
            region.Name,
            region.Slug,
            region.Type,
            region.Description,
            DecodeJson(region.PostalCodes),
            DecodeJson(region.BoundaryGeoJson),
            region.CenterLatitude,
            region.CenterLongitude,
            region.Status,
            region.CreatedBy,
            region.CreatedAt,
            region.UpdatedAt);
    }

    private static string? Validate(CaringSubRegionRequest request, bool create)
    {
        if (create && string.IsNullOrWhiteSpace(request.Name))
        {
            return "name is required.";
        }

        if (request.Name is not null && (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 255))
        {
            return "name must be a non-empty string with at most 255 characters.";
        }

        if (request.Slug is { Length: > 255 })
        {
            return "slug must be at most 255 characters.";
        }

        if (request.Type is not null && !IsValidType(request.Type))
        {
            return "type must be one of quartier, ortsteil, municipality, canton, or other.";
        }

        if (request.Status is not null && !IsValidStatus(request.Status))
        {
            return "status must be active or inactive.";
        }

        if (request.CenterLatitude is < -90m or > 90m)
        {
            return "center_latitude must be between -90 and 90.";
        }

        if (request.CenterLongitude is < -180m or > 180m)
        {
            return "center_longitude must be between -180 and 180.";
        }

        return null;
    }

    private static bool IsValidType(string? type)
    {
        return !string.IsNullOrWhiteSpace(type)
            && ValidTypes.Contains(type.Trim(), StringComparer.Ordinal);
    }

    private static bool IsValidStatus(string? status)
    {
        return !string.IsNullOrWhiteSpace(status)
            && ValidStatuses.Contains(status.Trim(), StringComparer.Ordinal);
    }

    private static string Slugify(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var normalized = value.Trim().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);
        foreach (var character in normalized)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(character);
            if (category == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(character);
            builder.Append(char.IsLetterOrDigit(lower) ? lower : '-');
        }

        return DuplicateHyphensRegex().Replace(builder.ToString(), "-").Trim('-');
    }

    private static string? EncodeJsonArray(object? value)
    {
        if (value is null)
        {
            return null;
        }

        if (value is JsonElement element)
        {
            if (element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                return null;
            }

            if (element.ValueKind == JsonValueKind.String)
            {
                return EncodeJsonArray(element.GetString());
            }

            if (element.ValueKind == JsonValueKind.Array)
            {
                return element.GetRawText();
            }

            return JsonSerializer.Serialize(new[] { element.ToString() }, JsonOptions);
        }

        if (value is string raw)
        {
            var values = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return values.Length == 0 ? null : JsonSerializer.Serialize(values, JsonOptions);
        }

        if (value is IEnumerable<string> strings)
        {
            var values = strings
                .Select(item => item.Trim())
                .Where(item => item.Length > 0)
                .ToArray();
            return values.Length == 0 ? null : JsonSerializer.Serialize(values, JsonOptions);
        }

        if (value is System.Collections.IEnumerable enumerable)
        {
            var values = enumerable
                .Cast<object?>()
                .Where(item => item is not null)
                .Select(item => item!.ToString())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .ToArray();
            return values.Length == 0 ? null : JsonSerializer.Serialize(values, JsonOptions);
        }

        return JsonSerializer.Serialize(new[] { value.ToString() }, JsonOptions);
    }

    private static string? EncodeJson(object? value)
    {
        if (value is null)
        {
            return null;
        }

        if (value is JsonElement element)
        {
            return element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
                ? null
                : element.GetRawText();
        }

        return JsonSerializer.Serialize(value, JsonOptions);
    }

    private static object? DecodeJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<JsonElement>(raw);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    [GeneratedRegex("-+", RegexOptions.CultureInvariant)]
    private static partial Regex DuplicateHyphensRegex();
}

public sealed class CaringSubRegionRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("postal_codes")] public object? PostalCodes { get; set; }
    [JsonPropertyName("boundary_geojson")] public object? BoundaryGeoJson { get; set; }
    [JsonPropertyName("center_latitude")] public decimal? CenterLatitude { get; set; }
    [JsonPropertyName("center_longitude")] public decimal? CenterLongitude { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
}

public sealed record CaringSubRegionPage(
    [property: JsonPropertyName("data")] IReadOnlyList<CaringSubRegionRow> Data,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("per_page")] int PerPage,
    [property: JsonPropertyName("current_page")] int CurrentPage);

public sealed record CaringSubRegionRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("postal_codes")] object? PostalCodes,
    [property: JsonPropertyName("boundary_geojson")] object? BoundaryGeoJson,
    [property: JsonPropertyName("center_latitude")] decimal? CenterLatitude,
    [property: JsonPropertyName("center_longitude")] decimal? CenterLongitude,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("created_by")] int? CreatedBy,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);

public sealed record CaringSubRegionMutationResult(
    CaringSubRegionRow? Row = null,
    string? ErrorCode = null,
    string? ErrorMessage = null,
    bool NotFound = false);
