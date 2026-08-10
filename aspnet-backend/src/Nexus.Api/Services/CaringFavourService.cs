// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringFavourService
{
    private static readonly HashSet<string> AllowedCategories = new(StringComparer.Ordinal)
    {
        "companionship",
        "shopping",
        "transport",
        "home_help",
        "gardening",
        "meals",
        "other"
    };

    private readonly NexusDbContext _db;

    public CaringFavourService(NexusDbContext db)
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

    public async Task<CaringFavourOfferOutcome> OfferFavourAsync(
        int tenantId,
        int userId,
        string? description,
        string? category,
        string? favourDate,
        bool isAnonymous,
        CancellationToken ct)
    {
        var errors = new List<CaringFavourValidationError>();
        var normalizedDescription = (description ?? string.Empty).Trim();
        if (normalizedDescription.Length == 0)
        {
            errors.Add(new CaringFavourValidationError("VALIDATION_ERROR", "Field is required.", "description"));
        }
        else if (normalizedDescription.Length > 500)
        {
            errors.Add(new CaringFavourValidationError("VALIDATION_ERROR", "Field is too long.", "description"));
        }

        DateOnly parsedDate;
        var normalizedDate = (favourDate ?? string.Empty).Trim();
        if (normalizedDate.Length == 0)
        {
            parsedDate = DateOnly.FromDateTime(DateTime.UtcNow);
        }
        else if (!DateOnly.TryParseExact(
            normalizedDate,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out parsedDate))
        {
            errors.Add(new CaringFavourValidationError("VALIDATION_ERROR", "Invalid date.", "favour_date"));
            parsedDate = DateOnly.FromDateTime(DateTime.UtcNow);
        }

        if (errors.Count > 0)
        {
            return CaringFavourOfferOutcome.Invalid(errors);
        }

        var normalizedCategory = (category ?? string.Empty).Trim();
        if (normalizedCategory.Length > 0 && !AllowedCategories.Contains(normalizedCategory))
        {
            normalizedCategory = "other";
        }

        var now = DateTime.UtcNow;
        _db.CaringFavours.Add(new CaringFavour
        {
            TenantId = tenantId,
            OfferedByUserId = userId,
            ReceivedByUserId = null,
            Category = normalizedCategory.Length == 0 ? null : normalizedCategory,
            Description = normalizedDescription,
            FavourDate = parsedDate,
            IsAnonymous = isAnonymous,
            CreatedAt = now,
            UpdatedAt = now
        });

        await _db.SaveChangesAsync(ct);

        return CaringFavourOfferOutcome.Created(new CaringFavourOfferResponse(
            Success: true,
            Message: "Favour recorded."));
    }

    public async Task<CaringFavourList> ListAdminFavoursAsync(int tenantId, CancellationToken ct)
    {
        var total = await _db.CaringFavours
            .IgnoreQueryFilters()
            .Where(f => f.TenantId == tenantId)
            .CountAsync(ct);

        var rows = await _db.CaringFavours
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(f => f.OfferedByUser)
            .Where(f => f.TenantId == tenantId)
            .OrderByDescending(f => f.CreatedAt)
            .Take(50)
            .Select(f => new
            {
                f.Id,
                f.Category,
                f.Description,
                f.FavourDate,
                f.IsAnonymous,
                f.CreatedAt,
                OffererFirstName = f.OfferedByUser == null ? "" : f.OfferedByUser.FirstName,
                OffererLastName = f.OfferedByUser == null ? "" : f.OfferedByUser.LastName
            })
            .ToListAsync(ct);

        var items = rows.Select(row =>
        {
            var offererName = string.Join(" ", new[] { row.OffererFirstName, row.OffererLastName }
                .Where(part => !string.IsNullOrWhiteSpace(part))).Trim();

            return new CaringFavourAdminRow(
                Id: row.Id,
                Category: row.Category,
                Description: row.Description,
                FavourDate: row.FavourDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                IsAnonymous: row.IsAnonymous,
                OffererName: row.IsAnonymous ? null : offererName,
                CreatedAt: row.CreatedAt.ToString("O", CultureInfo.InvariantCulture));
        }).ToArray();

        return new CaringFavourList(total, items);
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
}

public sealed record CaringFavourList(
    [property: JsonPropertyName("count")]
    int Count,
    [property: JsonPropertyName("items")]
    IReadOnlyList<CaringFavourAdminRow> Items);

public sealed record CaringFavourAdminRow(
    [property: JsonPropertyName("id")]
    int Id,
    [property: JsonPropertyName("category")]
    string? Category,
    [property: JsonPropertyName("description")]
    string Description,
    [property: JsonPropertyName("favour_date")]
    string FavourDate,
    [property: JsonPropertyName("is_anonymous")]
    bool IsAnonymous,
    [property: JsonPropertyName("offerer_name")]
    string? OffererName,
    [property: JsonPropertyName("created_at")]
    string CreatedAt);

public sealed record CaringFavourOfferOutcome(
    bool Succeeded,
    IReadOnlyList<CaringFavourValidationError> Errors,
    CaringFavourOfferResponse? Data)
{
    public static CaringFavourOfferOutcome Created(CaringFavourOfferResponse data) => new(true, [], data);

    public static CaringFavourOfferOutcome Invalid(IReadOnlyList<CaringFavourValidationError> errors) => new(false, errors, null);
}

public sealed record CaringFavourOfferResponse(
    [property: JsonPropertyName("success")] bool Success,
    [property: JsonPropertyName("message")] string Message);

public sealed record CaringFavourValidationError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("field")] string Field);
