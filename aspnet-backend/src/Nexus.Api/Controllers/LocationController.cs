// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Location controller - user geolocation and proximity-based features.
/// Phase 28: Geocoding.
/// </summary>
[ApiController]
[Route("api/location")]
[Authorize]
public class LocationController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly LocationService _locationService;
    private readonly ILogger<LocationController> _logger;

    public LocationController(NexusDbContext db, LocationService locationService, ILogger<LocationController> logger)
    {
        _db = db;
        _locationService = locationService;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    /// <summary>
    /// PUT /api/location/me - Update my location.
    /// </summary>
    [HttpPut("me")]
    public async Task<IActionResult> UpdateMyLocation([FromBody] UpdateLocationRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        try
        {
            var location = await _locationService.UpdateUserLocationAsync(
                userId.Value,
                request.Latitude,
                request.Longitude,
                request.City,
                request.Region,
                request.Country,
                request.PostalCode,
                request.IsPublic);

            return Ok(new
            {
                id = location.Id,
                latitude = location.Latitude,
                longitude = location.Longitude,
                city = location.City,
                region = location.Region,
                country = location.Country,
                postal_code = location.PostalCode,
                formatted_address = location.FormattedAddress,
                is_public = location.IsPublic,
                updated_at = location.UpdatedAt
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/location/me - Get my location.
    /// </summary>
    [HttpGet("me")]
    public async Task<IActionResult> GetMyLocation()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var location = await _locationService.GetUserLocationAsync(userId.Value);
        if (location == null)
        {
            return NotFound(new { error = "Location not set. Use PUT /api/location/me to set your location." });
        }

        return Ok(new
        {
            id = location.Id,
            latitude = location.Latitude,
            longitude = location.Longitude,
            city = location.City,
            region = location.Region,
            country = location.Country,
            postal_code = location.PostalCode,
            formatted_address = location.FormattedAddress,
            is_public = location.IsPublic,
            updated_at = location.UpdatedAt
        });
    }

    /// <summary>
    /// GET /api/location/users/{userId} - Get a user's location (respects privacy).
    /// </summary>
    [HttpGet("users/{userId}")]
    public async Task<IActionResult> GetUserLocation(int userId)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var location = await _locationService.GetUserLocationAsync(userId);
        if (location == null)
        {
            return NotFound(new { error = "User location not found" });
        }

        // If the location is not public and it's not the user's own, hide exact coordinates
        var isOwn = currentUserId == userId;

        return Ok(new
        {
            user_id = location.UserId,
            latitude = (location.IsPublic || isOwn) ? location.Latitude : (double?)null,
            longitude = (location.IsPublic || isOwn) ? location.Longitude : (double?)null,
            city = location.City,
            region = location.Region,
            country = location.Country,
            postal_code = (location.IsPublic || isOwn) ? location.PostalCode : null,
            formatted_address = (location.IsPublic || isOwn) ? location.FormattedAddress : location.City,
            is_public = location.IsPublic,
            updated_at = location.UpdatedAt
        });
    }

    /// <summary>
    /// GET /api/location/nearby/users - Find nearby users.
    /// </summary>
    [HttpGet("nearby/users")]
    public async Task<IActionResult> FindNearbyUsers(
        [FromQuery] double latitude,
        [FromQuery] double longitude,
        [FromQuery] double radius_km = 25,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        try
        {
            var result = await _locationService.FindNearbyUsersAsync(latitude, longitude, radius_km, page, limit);

            // Exclude current user from results
            result.Items = result.Items.Where(u => u.UserId != userId.Value).ToList();

            return Ok(new
            {
                data = result.Items.Select(u => new
                {
                    user_id = u.UserId,
                    first_name = u.FirstName,
                    last_name = u.LastName,
                    city = u.City,
                    region = u.Region,
                    country = u.Country,
                    latitude = u.Latitude,
                    longitude = u.Longitude,
                    distance_km = u.DistanceKm,
                    is_public = u.IsPublic
                }),
                search = new
                {
                    latitude,
                    longitude,
                    radius_km
                },
                pagination = new
                {
                    page = result.Page,
                    limit = result.Limit,
                    total = result.Total,
                    pages = result.TotalPages
                }
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/location/nearby/listings - Find nearby listings.
    /// </summary>
    [HttpGet("nearby/listings")]
    public async Task<IActionResult> FindNearbyListings(
        [FromQuery] double latitude,
        [FromQuery] double longitude,
        [FromQuery] double radius_km = 25,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        try
        {
            var result = await _locationService.FindNearbyListingsAsync(latitude, longitude, radius_km, page, limit);

            return Ok(new
            {
                data = result.Items.Select(l => new
                {
                    listing_id = l.ListingId,
                    title = l.Title,
                    description = l.Description,
                    type = l.Type,
                    location = l.Location,
                    user_id = l.UserId,
                    city = l.City,
                    region = l.Region,
                    distance_km = l.DistanceKm
                }),
                search = new
                {
                    latitude,
                    longitude,
                    radius_km
                },
                pagination = new
                {
                    page = result.Page,
                    limit = result.Limit,
                    total = result.Total,
                    pages = result.TotalPages
                }
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/location/distance/{userId} - Calculate distance to another user.
    /// </summary>
    [HttpGet("distance/{userId}")]
    public async Task<IActionResult> GetDistance(int userId)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var distance = await _locationService.CalculateDistanceAsync(currentUserId.Value, userId);
        if (distance == null)
        {
            return NotFound(new { error = "Location data not available for one or both users." });
        }

        return Ok(new
        {
            from_user_id = currentUserId.Value,
            to_user_id = userId,
            distance_km = distance.Value,
            distance_miles = Math.Round(distance.Value * 0.621371, 2)
        });
    }

    /// <summary>
    /// GET /api/location/geocode - Resolve an address from tenant-local location data.
    /// </summary>
    [HttpGet("geocode")]
    public async Task<IActionResult> Geocode([FromQuery] string? address)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(address))
            return BadRequest(new { error = "address is required" });

        try
        {
            var result = await _locationService.GeocodeAddressAsync(address);
            if (result == null)
                return NotFound(new { error = "Address not found in tenant location data" });

            return Ok(new
            {
                latitude = result.Latitude,
                longitude = result.Longitude,
                formatted_address = result.FormattedAddress,
                city = result.City,
                region = result.Region,
                country = result.Country,
                postal_code = result.PostalCode,
                source = "tenant_locations"
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}

#region Request DTOs

public class UpdateLocationRequest
{
    [JsonPropertyName("latitude")]
    public double Latitude { get; set; }

    [JsonPropertyName("longitude")]
    public double Longitude { get; set; }

    [JsonPropertyName("city")]
    public string? City { get; set; }

    [JsonPropertyName("region")]
    public string? Region { get; set; }

    [JsonPropertyName("country")]
    public string? Country { get; set; }

    [JsonPropertyName("postal_code")]
    public string? PostalCode { get; set; }

    [JsonPropertyName("is_public")]
    public bool? IsPublic { get; set; }
}

#endregion
