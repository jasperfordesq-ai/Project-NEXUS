// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringCommunityMarktService
{
    private readonly NexusDbContext _db;

    public CaringCommunityMarktService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _ = tenantContext;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "features.caring_community")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<CaringCommunityMarktResult> ListAsync(
        int tenantId,
        CaringCommunityMarktQuery query,
        CancellationToken ct)
    {
        var type = NormalizeType(query.Type);
        var page = Math.Max(1, query.Page);
        var perPage = Math.Clamp(query.PerPage, 1, 50);
        var sourceLimit = (int)Math.Ceiling(perPage / 2.0);
        var proximity = await ResolveProximityAsync(tenantId, query, ct);
        var marketplaceAvailable = await IsMarketplaceAvailableAsync(tenantId, ct);

        var items = new List<CaringCommunityMarktItem>();

        if (type is "all" or "listings")
        {
            var limit = type == "all" ? sourceLimit : perPage;
            items.AddRange(await ListLegacyListingsAsync(tenantId, limit, proximity, ct));
        }

        if (type is "all" or "marketplace" && marketplaceAvailable)
        {
            var limit = type == "all" ? sourceLimit : perPage;
            items.AddRange(await ListMarketplaceAsync(tenantId, limit, proximity, ct));
        }

        var sorted = items
            .OrderByDescending(item => item.CreatedAtSort)
            .ToArray();

        var offset = (page - 1) * perPage;
        var sliced = sorted
            .Skip(offset)
            .Take(perPage)
            .ToArray();

        return new CaringCommunityMarktResult(
            Items: sliced,
            Meta: new CaringCommunityMarktMeta(
                Total: sorted.Length,
                Page: page,
                PerPage: perPage,
                HasMore: offset + perPage < sorted.Length,
                MarketplaceAvailable: marketplaceAvailable));
    }

    private async Task<IReadOnlyList<CaringCommunityMarktItem>> ListLegacyListingsAsync(
        int tenantId,
        int limit,
        ResolvedProximity proximity,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var rows = await _db.Listings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(listing => listing.User)
            .Include(listing => listing.Category)
            .Where(listing => listing.TenantId == tenantId
                && listing.Status == ListingStatus.Active
                && (listing.DeletedAt == null || listing.DeletedAt > now))
            .ToListAsync(ct);

        var imageUrls = await LoadListingUploadUrlsAsync(
            tenantId,
            rows.Select(row => row.Id),
            ct);

        return rows
            .Select(row => new
            {
                Row = row,
                Distance = proximity.UseProximity && row.Latitude.HasValue && row.Longitude.HasValue
                    ? DistanceKm(proximity.Latitude!.Value, proximity.Longitude!.Value, row.Latitude.Value, row.Longitude.Value)
                    : (double?)null
            })
            .Where(item => !proximity.UseProximity || (item.Distance.HasValue && item.Distance <= proximity.RadiusKm))
            .OrderBy(item => proximity.UseProximity ? item.Distance ?? double.MaxValue : 0)
            .ThenByDescending(item => item.Row.CreatedAt)
            .Take(limit)
            .Select(item => MapListing(item.Row, imageUrls))
            .ToArray();
    }

    private async Task<IReadOnlyList<CaringCommunityMarktItem>> ListMarketplaceAsync(
        int tenantId,
        int limit,
        ResolvedProximity proximity,
        CancellationToken ct)
    {
        var rows = await _db.MarketplaceListings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(listing => listing.User)
            .Include(listing => listing.Category)
            .Include(listing => listing.Images)
            .Where(listing => listing.TenantId == tenantId
                && listing.Status == "active"
                && listing.ModerationStatus == "approved")
            .ToListAsync(ct);

        return rows
            .Select(row => new
            {
                Row = row,
                Distance = proximity.UseProximity && row.Latitude.HasValue && row.Longitude.HasValue
                    ? DistanceKm(proximity.Latitude!.Value, proximity.Longitude!.Value, row.Latitude.Value, row.Longitude.Value)
                    : (double?)null
            })
            .Where(item => !proximity.UseProximity || (item.Distance.HasValue && item.Distance <= proximity.RadiusKm))
            .OrderBy(item => proximity.UseProximity ? item.Distance ?? double.MaxValue : 0)
            .ThenByDescending(item => item.Row.CreatedAt)
            .Take(limit)
            .Select(item => MapMarketplace(item.Row))
            .ToArray();
    }

    private async Task<IReadOnlyDictionary<int, string>> LoadListingUploadUrlsAsync(
        int tenantId,
        IEnumerable<int> listingIds,
        CancellationToken ct)
    {
        var ids = listingIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return new Dictionary<int, string>();
        }

        var uploads = await _db.FileUploads
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(file => file.TenantId == tenantId
                && file.EntityType == "listing"
                && file.EntityId.HasValue
                && ids.Contains(file.EntityId.Value)
                && file.Category == FileCategory.Listing)
            .OrderByDescending(file => file.CreatedAt)
            .ToListAsync(ct);

        return uploads
            .GroupBy(file => file.EntityId!.Value)
            .ToDictionary(group => group.Key, group => $"/api/files/{group.First().Id}/download");
    }

    private async Task<bool> IsMarketplaceAvailableAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "features.marketplace")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    private async Task<ResolvedProximity> ResolveProximityAsync(
        int tenantId,
        CaringCommunityMarktQuery query,
        CancellationToken ct)
    {
        var latitude = query.Latitude;
        var longitude = query.Longitude;
        var radiusKm = query.RadiusKm;

        if (query.SubRegionId is > 0)
        {
            var subRegion = await _db.CaringSubRegions
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstOrDefaultAsync(row => row.TenantId == tenantId
                    && row.Id == query.SubRegionId.Value
                    && row.Status == "active", ct);

            if (subRegion is not null
                && subRegion.CenterLatitude.HasValue
                && subRegion.CenterLongitude.HasValue)
            {
                latitude ??= (double)subRegion.CenterLatitude.Value;
                longitude ??= (double)subRegion.CenterLongitude.Value;
                if (radiusKm is null or <= 0)
                {
                    radiusKm = DefaultRadiusKm(subRegion.Type);
                }
            }
        }

        var use = latitude.HasValue
            && longitude.HasValue
            && radiusKm.HasValue
            && radiusKm.Value > 0;

        return new ResolvedProximity(use, latitude, longitude, radiusKm);
    }

    private static CaringCommunityMarktItem MapListing(
        Listing row,
        IReadOnlyDictionary<int, string> uploadUrls)
    {
        uploadUrls.TryGetValue(row.Id, out var uploadUrl);
        return new CaringCommunityMarktItem(
            Source: "listing",
            Id: row.Id,
            Title: row.Title,
            Description: Truncate(row.Description, 200),
            ListingType: row.Type.ToString().ToLowerInvariant(),
            ImageUrl: row.ImageUrl ?? uploadUrl,
            HoursEstimate: RoundOne(row.EstimatedHours),
            PriceCash: null,
            PriceCredits: null,
            PriceType: null,
            PriceCurrency: null,
            Category: row.Category?.Name,
            UserName: DisplayName(row.User),
            UserAvatar: row.User?.AvatarUrl,
            CreatedAt: row.CreatedAt,
            DetailPath: $"/listings/{row.Id}");
    }

    private static CaringCommunityMarktItem MapMarketplace(MarketplaceListing row)
    {
        var priceCash = row.Price;
        if (row.PriceType == "free")
        {
            priceCash = 0m;
        }

        var primaryImage = row.Images
            .OrderBy(image => image.SortOrder)
            .ThenBy(image => image.Id)
            .FirstOrDefault()
            ?.Url;

        return new CaringCommunityMarktItem(
            Source: "marketplace",
            Id: row.Id,
            Title: row.Title,
            Description: Truncate(row.Description, 200),
            ListingType: null,
            ImageUrl: primaryImage,
            HoursEstimate: null,
            PriceCash: priceCash,
            PriceCredits: RoundOne(row.TimeCreditPrice),
            PriceType: row.PriceType,
            PriceCurrency: row.PriceCurrency,
            Category: row.Category?.Name,
            UserName: DisplayName(row.User),
            UserAvatar: row.User?.AvatarUrl,
            CreatedAt: row.CreatedAt,
            DetailPath: $"/marketplace/{row.Id}");
    }

    private static string NormalizeType(string? type)
    {
        return type?.Trim().ToLowerInvariant() switch
        {
            "listings" => "listings",
            "marketplace" => "marketplace",
            _ => "all"
        };
    }

    private static string? DisplayName(User? user)
    {
        if (user is null)
        {
            return null;
        }

        return $"{user.FirstName} {user.LastName}".Trim();
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrEmpty(value) || value.Length <= maxLength)
        {
            return value;
        }

        return value[..maxLength];
    }

    private static decimal? RoundOne(decimal? value)
    {
        return value.HasValue
            ? Math.Round(value.Value, 1, MidpointRounding.AwayFromZero)
            : null;
    }

    private static double DefaultRadiusKm(string? type)
    {
        return type switch
        {
            "quartier" => 2.0,
            "ortsteil" => 5.0,
            "municipality" => 10.0,
            "canton" => 50.0,
            _ => 5.0
        };
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

    private static double DistanceKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double earthRadiusKm = 6371;
        var dLat = DegreesToRadians(lat2 - lat1);
        var dLon = DegreesToRadians(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
            + Math.Cos(DegreesToRadians(lat1))
            * Math.Cos(DegreesToRadians(lat2))
            * Math.Sin(dLon / 2)
            * Math.Sin(dLon / 2);

        return earthRadiusKm * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static double DegreesToRadians(double degrees)
    {
        return degrees * Math.PI / 180;
    }

    private sealed record ResolvedProximity(
        bool UseProximity,
        double? Latitude,
        double? Longitude,
        double? RadiusKm);
}

public sealed record CaringCommunityMarktQuery(
    string? Type,
    int Page,
    int PerPage,
    double? Latitude,
    double? Longitude,
    double? RadiusKm,
    int? SubRegionId);

public sealed record CaringCommunityMarktResult(
    IReadOnlyList<CaringCommunityMarktItem> Items,
    CaringCommunityMarktMeta Meta);

public sealed record CaringCommunityMarktMeta(
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("page")] int Page,
    [property: JsonPropertyName("per_page")] int PerPage,
    [property: JsonPropertyName("has_more")] bool HasMore,
    [property: JsonPropertyName("marketplace_available")] bool MarketplaceAvailable);

public sealed record CaringCommunityMarktItem(
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("listing_type")] string? ListingType,
    [property: JsonPropertyName("image_url")] string? ImageUrl,
    [property: JsonPropertyName("hours_estimate")] decimal? HoursEstimate,
    [property: JsonPropertyName("price_cash")] decimal? PriceCash,
    [property: JsonPropertyName("price_credits")] decimal? PriceCredits,
    [property: JsonPropertyName("price_type")] string? PriceType,
    [property: JsonPropertyName("price_currency")] string? PriceCurrency,
    [property: JsonPropertyName("category")] string? Category,
    [property: JsonPropertyName("user_name")] string? UserName,
    [property: JsonPropertyName("user_avatar")] string? UserAvatar,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("detail_path")] string DetailPath)
{
    [JsonIgnore]
    public DateTime CreatedAtSort => CreatedAt;
}
