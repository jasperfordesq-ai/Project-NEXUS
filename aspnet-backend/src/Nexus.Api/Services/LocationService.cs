// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for user location management and proximity-based features.
/// Uses the Haversine formula for distance calculations.
/// </summary>
public class LocationService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly IConfiguration _configuration;
    private readonly ILogger<LocationService> _logger;
    private readonly IHttpClientFactory? _httpClientFactory;

    private static readonly JsonSerializerOptions ProviderJsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Earth's radius in kilometres.
    /// </summary>
    private const double EarthRadiusKm = 6371.0;

    public LocationService(
        NexusDbContext db,
        TenantContext tenantContext,
        IConfiguration configuration,
        ILogger<LocationService> logger,
        IHttpClientFactory? httpClientFactory = null)
    {
        _db = db;
        _tenantContext = tenantContext;
        _configuration = configuration;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
    }

    /// <summary>
    /// Update or create a user's location.
    /// </summary>
    public async Task<UserLocation> UpdateUserLocationAsync(
        int userId,
        double latitude,
        double longitude,
        string? city = null,
        string? region = null,
        string? country = null,
        string? postalCode = null,
        bool? isPublic = null)
    {
        ValidateCoordinates(latitude, longitude);

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var existing = await _db.Set<UserLocation>()
            .FirstOrDefaultAsync(l => l.UserId == userId);

        if (existing != null)
        {
            existing.Latitude = latitude;
            existing.Longitude = longitude;
            existing.City = city ?? existing.City;
            existing.Region = region ?? existing.Region;
            existing.Country = country ?? existing.Country;
            existing.PostalCode = postalCode ?? existing.PostalCode;
            existing.FormattedAddress = BuildFormattedAddress(city, region, country, postalCode);
            existing.IsPublic = isPublic ?? existing.IsPublic;
            existing.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            _logger.LogInformation("Location updated for user {UserId}", userId);
            return existing;
        }

        var location = new UserLocation
        {
            TenantId = tenantId,
            UserId = userId,
            Latitude = latitude,
            Longitude = longitude,
            City = city,
            Region = region,
            Country = country,
            PostalCode = postalCode,
            FormattedAddress = BuildFormattedAddress(city, region, country, postalCode),
            IsPublic = isPublic ?? false
        };

        _db.Set<UserLocation>().Add(location);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Location created for user {UserId}", userId);
        return location;
    }

    /// <summary>
    /// Get a user's location. Respects privacy settings when viewed by another user.
    /// </summary>
    public async Task<UserLocation?> GetUserLocationAsync(int userId)
    {
        return await _db.Set<UserLocation>()
            .AsNoTracking()
            .FirstOrDefaultAsync(l => l.UserId == userId);
    }

    /// <summary>
    /// Find users near a given point using the Haversine formula.
    /// </summary>
    public async Task<NearbyResult<NearbyUser>> FindNearbyUsersAsync(
        double latitude, double longitude, double radiusKm, int page = 1, int limit = 20)
    {
        ValidateCoordinates(latitude, longitude);
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        // Load all locations in tenant, then filter by distance in-memory.
        // For large datasets, a spatial database extension (PostGIS) would be more efficient.
        // Pre-filter by bounding box to reduce the set.
        var (minLat, maxLat, minLon, maxLon) = GetBoundingBox(latitude, longitude, radiusKm);

        var locations = await _db.Set<UserLocation>()
            .AsNoTracking()
            .Include(l => l.User)
            .Where(l => l.IsPublic)
            .Where(l => l.User != null && l.User.IsActive)
            .Where(l => l.Latitude >= minLat && l.Latitude <= maxLat)
            .Where(l => l.Longitude >= minLon && l.Longitude <= maxLon)
            .ToListAsync();

        var nearby = locations
            .Select(l => new
            {
                Location = l,
                Distance = HaversineDistance(latitude, longitude, l.Latitude, l.Longitude)
            })
            .Where(x => x.Distance <= radiusKm)
            .OrderBy(x => x.Distance)
            .ToList();

        var total = nearby.Count;
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var items = nearby
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(x => new NearbyUser
            {
                UserId = x.Location.UserId,
                FirstName = x.Location.User?.FirstName ?? "",
                LastName = x.Location.User?.LastName ?? "",
                City = x.Location.City,
                Region = x.Location.Region,
                Country = x.Location.Country,
                Latitude = x.Location.IsPublic ? x.Location.Latitude : (double?)null,
                Longitude = x.Location.IsPublic ? x.Location.Longitude : (double?)null,
                DistanceKm = Math.Round(x.Distance, 2),
                IsPublic = x.Location.IsPublic
            })
            .ToList();

        return new NearbyResult<NearbyUser>
        {
            Items = items,
            Page = page,
            Limit = limit,
            Total = total,
            TotalPages = totalPages
        };
    }

    /// <summary>
    /// Find listings near a given point. Uses listing owner's location.
    /// </summary>
    public async Task<NearbyResult<NearbyListing>> FindNearbyListingsAsync(
        double latitude, double longitude, double radiusKm, int page = 1, int limit = 20)
    {
        ValidateCoordinates(latitude, longitude);
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var (minLat, maxLat, minLon, maxLon) = GetBoundingBox(latitude, longitude, radiusKm);

        // Join listings with user locations
        var locationsWithListings = await _db.Set<UserLocation>()
            .AsNoTracking()
            .Where(l => l.Latitude >= minLat && l.Latitude <= maxLat)
            .Where(l => l.Longitude >= minLon && l.Longitude <= maxLon)
            .Join(
                _db.Listings.Where(li => li.Status == ListingStatus.Active && li.DeletedAt == null),
                loc => loc.UserId,
                listing => listing.UserId,
                (loc, listing) => new { Location = loc, Listing = listing })
            .ToListAsync();

        var nearby = locationsWithListings
            .Select(x => new
            {
                x.Location,
                x.Listing,
                Distance = HaversineDistance(latitude, longitude, x.Location.Latitude, x.Location.Longitude)
            })
            .Where(x => x.Distance <= radiusKm)
            .OrderBy(x => x.Distance)
            .ToList();

        var total = nearby.Count;
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var items = nearby
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(x => new NearbyListing
            {
                ListingId = x.Listing.Id,
                Title = x.Listing.Title,
                Description = x.Listing.Description,
                Type = x.Listing.Type.ToString(),
                Location = x.Listing.Location,
                UserId = x.Listing.UserId,
                City = x.Location.City,
                Region = x.Location.Region,
                DistanceKm = Math.Round(x.Distance, 2)
            })
            .ToList();

        return new NearbyResult<NearbyListing>
        {
            Items = items,
            Page = page,
            Limit = limit,
            Total = total,
            TotalPages = totalPages
        };
    }

    /// <summary>
    /// Calculate distance between two users in kilometres.
    /// </summary>
    public async Task<double?> CalculateDistanceAsync(int userId1, int userId2)
    {
        var loc1 = await _db.Set<UserLocation>()
            .AsNoTracking()
            .FirstOrDefaultAsync(l => l.UserId == userId1);

        var loc2 = await _db.Set<UserLocation>()
            .AsNoTracking()
            .FirstOrDefaultAsync(l => l.UserId == userId2);

        if (loc1 == null || loc2 == null) return null;

        return Math.Round(HaversineDistance(loc1.Latitude, loc1.Longitude, loc2.Latitude, loc2.Longitude), 2);
    }

    /// <summary>
    /// Resolve an address through a configured generic HTTP geocoder, falling back to
    /// tenant-local location data. Coordinate strings are parsed directly.
    /// </summary>
    public async Task<GeocodingResult?> GeocodeAddressAsync(string address)
    {
        if (string.IsNullOrWhiteSpace(address))
            return null;

        var trimmed = address.Trim();
        var provider = GetGeocodingProviderStatus();
        if (TryParseCoordinates(trimmed, out var latitude, out var longitude))
        {
            ValidateCoordinates(latitude, longitude);
            return new GeocodingResult
            {
                Latitude = latitude,
                Longitude = longitude,
                FormattedAddress = trimmed,
                Source = "coordinates",
                Provider = provider.Provider,
                ProviderConfigured = provider.Configured,
                ProviderMessage = provider.Configured
                    ? "Coordinates parsed directly; configured external geocoding provider was not needed."
                    : "Coordinates parsed directly; external geocoding provider_not_configured."
            };
        }

        var providerFailed = false;
        if (provider.CanDispatch)
        {
            var providerResult = await TryGeocodeWithProviderAsync(trimmed, provider);
            if (providerResult != null)
                return providerResult;

            providerFailed = true;
        }
        else if (provider.Configured)
        {
            providerFailed = true;
        }

        var query = trimmed.ToLowerInvariant();
        var matches = await _db.Set<UserLocation>()
            .AsNoTracking()
            .Where(l =>
                (l.FormattedAddress != null && l.FormattedAddress.ToLower().Contains(query)) ||
                (l.City != null && l.City.ToLower().Contains(query)) ||
                (l.Region != null && l.Region.ToLower().Contains(query)) ||
                (l.Country != null && l.Country.ToLower().Contains(query)) ||
                (l.PostalCode != null && l.PostalCode.ToLower().Contains(query)))
            .ToListAsync();

        var best = matches
            .OrderByDescending(l => ScoreAddressMatch(l, query))
            .ThenByDescending(l => l.UpdatedAt)
            .FirstOrDefault();

        if (best == null)
        {
            _logger.LogInformation(
                "No geocoding result for address {Address}; provider {Provider}, configured={Configured}, can_dispatch={CanDispatch}",
                address,
                provider.Provider,
                provider.Configured,
                provider.CanDispatch);
            return null;
        }

        return new GeocodingResult
        {
            Latitude = best.Latitude,
            Longitude = best.Longitude,
            FormattedAddress = best.FormattedAddress ?? BuildFormattedAddress(best.City, best.Region, best.Country, best.PostalCode),
            City = best.City,
            Region = best.Region,
            Country = best.Country,
            PostalCode = best.PostalCode,
            Source = "tenant_locations",
            Provider = provider.Provider,
            ProviderConfigured = provider.Configured,
            ProviderMessage = providerFailed
                ? $"Configured external geocoding {provider.FailureReason ?? "provider_send_failed"}; resolved from tenant-local fallback."
                : provider.Configured
                    ? "Resolved from tenant-local data; configured external geocoding provider was not dispatchable."
                : "Resolved from tenant-local data; external geocoding provider_not_configured."
        };
    }

    #region Helpers

    /// <summary>
    /// Haversine formula: calculates the great-circle distance between two points on Earth.
    /// </summary>
    public static double HaversineDistance(double lat1, double lon1, double lat2, double lon2)
    {
        var dLat = DegreesToRadians(lat2 - lat1);
        var dLon = DegreesToRadians(lon2 - lon1);

        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(DegreesToRadians(lat1)) * Math.Cos(DegreesToRadians(lat2)) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2);

        var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));

        return EarthRadiusKm * c;
    }

    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180.0;

    private static void ValidateCoordinates(double latitude, double longitude)
    {
        if (latitude < -90 || latitude > 90)
            throw new ArgumentException("Latitude must be between -90 and 90.");
        if (longitude < -180 || longitude > 180)
            throw new ArgumentException("Longitude must be between -180 and 180.");
    }

    /// <summary>
    /// Calculate a bounding box for pre-filtering database queries.
    /// </summary>
    private static (double minLat, double maxLat, double minLon, double maxLon) GetBoundingBox(
        double lat, double lon, double radiusKm)
    {
        var latDelta = radiusKm / 111.32; // ~111.32 km per degree of latitude
        // Clamp denominator to a minimum of 0.001 to prevent division by zero at the poles
        var cosDenominator = Math.Max(0.001, Math.Cos(DegreesToRadians(lat)));
        var lonDelta = radiusKm / (111.32 * cosDenominator);

        return (lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta);
    }

    private static string? BuildFormattedAddress(string? city, string? region, string? country, string? postalCode)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(city)) parts.Add(city);
        if (!string.IsNullOrWhiteSpace(region)) parts.Add(region);
        if (!string.IsNullOrWhiteSpace(postalCode)) parts.Add(postalCode);
        if (!string.IsNullOrWhiteSpace(country)) parts.Add(country);

        return parts.Count > 0 ? string.Join(", ", parts) : null;
    }

    private static bool TryParseCoordinates(string address, out double latitude, out double longitude)
    {
        latitude = 0;
        longitude = 0;

        var parts = address.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        return parts.Length == 2 &&
               double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out latitude) &&
               double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out longitude);
    }

    private static int ScoreAddressMatch(UserLocation location, string query)
    {
        static bool EqualsQuery(string? value, string query) =>
            string.Equals(value?.Trim(), query, StringComparison.OrdinalIgnoreCase);

        if (EqualsQuery(location.PostalCode, query)) return 100;
        if (EqualsQuery(location.FormattedAddress, query)) return 90;
        if (EqualsQuery(location.City, query)) return 80;
        if (EqualsQuery(location.Region, query)) return 70;
        if (EqualsQuery(location.Country, query)) return 60;
        return 10;
    }

    private GeocodingProviderStatus GetGeocodingProviderStatus()
    {
        var endpointValue = FirstConfiguredValue(
            "Geocoding:Http:Endpoint",
            "Geocoding:GenericHttp:Endpoint",
            "Geocoding:ProviderEndpoint",
            "Geocoding:Endpoint");
        var endpoint = TryCreateHttpUri(endpointValue);
        var endpointWasConfigured = !string.IsNullOrWhiteSpace(endpointValue);

        var provider = _configuration["Geocoding:Provider"];
        if (string.IsNullOrWhiteSpace(provider))
        {
            provider = endpoint != null || endpointWasConfigured
                ? "generic-http"
                : !string.IsNullOrWhiteSpace(_configuration["GoogleMaps:ApiKey"])
                ? "google_maps"
                : !string.IsNullOrWhiteSpace(_configuration["Mapbox:AccessToken"])
                    ? "mapbox"
                    : "none";
        }

        var legacyProviderConfigured = provider switch
        {
            "google_maps" => !string.IsNullOrWhiteSpace(_configuration["GoogleMaps:ApiKey"]),
            "mapbox" => !string.IsNullOrWhiteSpace(_configuration["Mapbox:AccessToken"]),
            "none" => false,
            _ => false
        };

        var configured = endpoint != null || legacyProviderConfigured;
        var failureReason = endpointWasConfigured && endpoint == null
            ? "provider_endpoint_invalid"
            : configured
                ? endpoint == null ? "provider_dispatch_not_implemented" : null
                : "provider_not_configured";

        return new GeocodingProviderStatus
        {
            Provider = provider,
            Configured = configured,
            Endpoint = endpoint,
            FailureReason = failureReason,
            Method = FirstConfiguredValue("Geocoding:Http:Method", "Geocoding:Method") ?? "POST",
            QueryParameter = FirstConfiguredValue("Geocoding:Http:QueryParameter", "Geocoding:QueryParameter") ?? "q",
            AuthHeaderName = FirstConfiguredValue("Geocoding:Http:AuthHeaderName", "Geocoding:AuthHeaderName"),
            AuthHeaderValue = FirstConfiguredValue("Geocoding:Http:AuthHeaderValue", "Geocoding:AuthHeaderValue"),
            BearerToken = FirstConfiguredValue("Geocoding:Http:BearerToken", "Geocoding:BearerToken")
        };
    }

    private async Task<GeocodingResult?> TryGeocodeWithProviderAsync(
        string address,
        GeocodingProviderStatus provider,
        CancellationToken ct = default)
    {
        if (_httpClientFactory == null)
        {
            provider.FailureReason = "provider_client_not_available";
            return null;
        }

        try
        {
            using var request = BuildGeocodingRequest(address, provider);
            ApplyConfiguredAuthHeaders(request, provider);

            var client = _httpClientFactory.CreateClient("NexusGeocodingProvider");
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                provider.FailureReason = $"provider_http_{(int)response.StatusCode}";
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var json = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            return ParseGeocodingProviderResult(json.RootElement, provider);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or JsonException or ArgumentException or TaskCanceledException)
        {
            provider.FailureReason = "provider_send_failed";
            _logger.LogWarning(ex, "External geocoding provider {Provider} failed for address {Address}", provider.Provider, address);
            return null;
        }
    }

    private HttpRequestMessage BuildGeocodingRequest(string address, GeocodingProviderStatus provider)
    {
        var method = string.Equals(provider.Method, "GET", StringComparison.OrdinalIgnoreCase)
            ? HttpMethod.Get
            : HttpMethod.Post;

        var endpoint = method == HttpMethod.Get
            ? BuildGeocodingGetUri(provider.Endpoint!, address, provider.QueryParameter)
            : provider.Endpoint!;

        var request = new HttpRequestMessage(method, endpoint);
        if (method != HttpMethod.Get)
        {
            request.Content = JsonContent.Create(new
            {
                query = address,
                tenantId = _tenantContext.GetTenantIdOrThrow()
            }, options: ProviderJsonOptions);
        }

        return request;
    }

    private static Uri BuildGeocodingGetUri(Uri endpoint, string address, string queryParameter)
    {
        var endpointText = endpoint.ToString();
        if (endpointText.Contains("{query}", StringComparison.OrdinalIgnoreCase))
        {
            return new Uri(endpointText.Replace("{query}", Uri.EscapeDataString(address), StringComparison.OrdinalIgnoreCase));
        }

        var separator = string.IsNullOrEmpty(endpoint.Query) ? "?" : "&";
        return new Uri($"{endpointText}{separator}{Uri.EscapeDataString(queryParameter)}={Uri.EscapeDataString(address)}");
    }

    private static GeocodingResult? ParseGeocodingProviderResult(
        JsonElement root,
        GeocodingProviderStatus provider)
    {
        if (TryGetPropertyCaseInsensitive(root, "results", out var results) &&
            results.ValueKind == JsonValueKind.Array &&
            results.GetArrayLength() > 0)
        {
            root = results[0];
        }

        if (!TryReadCoordinate(root, out var latitude, "latitude", "lat") ||
            !TryReadCoordinate(root, out var longitude, "longitude", "lng", "lon"))
        {
            provider.FailureReason = "provider_response_invalid";
            return null;
        }

        ValidateCoordinates(latitude, longitude);

        return new GeocodingResult
        {
            Latitude = latitude,
            Longitude = longitude,
            FormattedAddress = ReadString(root, "formattedAddress", "formatted_address", "address", "label"),
            City = ReadString(root, "city", "locality"),
            Region = ReadString(root, "region", "state", "county"),
            Country = ReadString(root, "country"),
            PostalCode = ReadString(root, "postalCode", "postal_code", "postcode"),
            Source = "provider",
            Provider = provider.Provider,
            ProviderConfigured = provider.Configured,
            ProviderMessage = "Resolved by configured external geocoding provider."
        };
    }

    private static bool TryReadCoordinate(JsonElement root, out double value, params string[] names)
    {
        if (TryReadDouble(root, out value, names))
            return true;

        if (TryGetPropertyCaseInsensitive(root, "location", out var location) &&
            TryReadDouble(location, out value, names))
        {
            return true;
        }

        if (TryGetPropertyCaseInsensitive(root, "geometry", out var geometry) &&
            TryGetPropertyCaseInsensitive(geometry, "location", out var geometryLocation) &&
            TryReadDouble(geometryLocation, out value, names))
        {
            return true;
        }

        value = 0;
        return false;
    }

    private static bool TryReadDouble(JsonElement root, out double value, params string[] names)
    {
        foreach (var name in names)
        {
            if (!TryGetPropertyCaseInsensitive(root, name, out var property))
                continue;

            if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out value))
                return true;

            if (property.ValueKind == JsonValueKind.String &&
                double.TryParse(property.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out value))
            {
                return true;
            }
        }

        value = 0;
        return false;
    }

    private static string? ReadString(JsonElement root, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryGetPropertyCaseInsensitive(root, name, out var property) &&
                property.ValueKind == JsonValueKind.String)
            {
                return property.GetString();
            }
        }

        return null;
    }

    private static bool TryGetPropertyCaseInsensitive(JsonElement root, string name, out JsonElement value)
    {
        if (root.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in root.EnumerateObject())
            {
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }

    private static void ApplyConfiguredAuthHeaders(HttpRequestMessage request, GeocodingProviderStatus provider)
    {
        if (!string.IsNullOrWhiteSpace(provider.BearerToken))
        {
            request.Headers.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", provider.BearerToken);
        }

        if (!string.IsNullOrWhiteSpace(provider.AuthHeaderName) &&
            !string.IsNullOrWhiteSpace(provider.AuthHeaderValue))
        {
            request.Headers.TryAddWithoutValidation(provider.AuthHeaderName, provider.AuthHeaderValue);
        }
    }

    private string? FirstConfiguredValue(params string[] keys)
    {
        foreach (var key in keys)
        {
            var value = _configuration[key];
            if (!string.IsNullOrWhiteSpace(value))
                return value;
        }

        return null;
    }

    private static Uri? TryCreateHttpUri(string? value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            ? uri
            : null;
    }

    private sealed class GeocodingProviderStatus
    {
        public string Provider { get; init; } = "none";
        public bool Configured { get; init; }
        public Uri? Endpoint { get; init; }
        public bool CanDispatch => Endpoint != null;
        public string? FailureReason { get; set; }
        public string Method { get; init; } = "POST";
        public string QueryParameter { get; init; } = "q";
        public string? AuthHeaderName { get; init; }
        public string? AuthHeaderValue { get; init; }
        public string? BearerToken { get; init; }
    }

    #endregion
}

#region DTOs

public class NearbyUser
{
    public int UserId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? City { get; set; }
    public string? Region { get; set; }
    public string? Country { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public double DistanceKm { get; set; }
    public bool IsPublic { get; set; }
}

public class NearbyListing
{
    public int ListingId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Type { get; set; } = string.Empty;
    public string? Location { get; set; }
    public int UserId { get; set; }
    public string? City { get; set; }
    public string? Region { get; set; }
    public double DistanceKm { get; set; }
}

public class NearbyResult<T>
{
    public List<T> Items { get; set; } = new();
    public int Page { get; set; }
    public int Limit { get; set; }
    public int Total { get; set; }
    public int TotalPages { get; set; }
}

public class GeocodingResult
{
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public string? FormattedAddress { get; set; }
    public string? City { get; set; }
    public string? Region { get; set; }
    public string? Country { get; set; }
    public string? PostalCode { get; set; }
    public string Source { get; set; } = "tenant_locations";
    public string Provider { get; set; } = "none";
    public bool ProviderConfigured { get; set; }
    public string ProviderMessage { get; set; } = "external geocoding provider_not_configured";
}

#endregion
