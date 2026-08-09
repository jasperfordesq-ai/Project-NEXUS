// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Push notification controller - device registration and notification preferences.
/// Phase 33: Push Notifications.
/// </summary>
[ApiController]
[Route("api/notifications/push")]
[Authorize]
public class PushNotificationController : ControllerBase
{
    private readonly PushNotificationService _pushService;
    private readonly ILogger<PushNotificationController> _logger;

    public PushNotificationController(
        PushNotificationService pushService,
        ILogger<PushNotificationController> logger)
    {
        _pushService = pushService;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/notifications/push/register - Register a device for push notifications.
    /// </summary>
    [HttpPost("register")]
    public async Task<IActionResult> RegisterDevice([FromBody] RegisterDeviceRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.DeviceToken))
        {
            return BadRequest(new { error = "device_token is required" });
        }

        if (string.IsNullOrWhiteSpace(request.Platform))
        {
            return BadRequest(new { error = "platform is required" });
        }

        var validPlatforms = new[] { "web", "android", "ios" };
        if (!validPlatforms.Contains(request.Platform.ToLowerInvariant()))
        {
            return BadRequest(new { error = "platform must be one of: web, android, ios" });
        }

        var subscription = await _pushService.RegisterDeviceAsync(
            userId.Value,
            request.DeviceToken,
            request.Platform.ToLowerInvariant(),
            request.DeviceName);

        _logger.LogInformation("Device registered for user {UserId}, platform {Platform}", userId, request.Platform);

        return Ok(new
        {
            success = true,
            message = "Device registered for push notifications",
            device = new
            {
                id = subscription.Id,
                platform = subscription.Platform,
                device_name = subscription.DeviceName,
                is_active = subscription.IsActive,
                created_at = subscription.CreatedAt
            }
        });
    }

    /// <summary>
    /// DELETE /api/notifications/push/register?device_token=... - Unregister a device.
    /// </summary>
    [HttpDelete("register")]
    public async Task<IActionResult> UnregisterDevice([FromQuery(Name = "device_token")] string? deviceToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(deviceToken))
        {
            return BadRequest(new { error = "device_token is required" });
        }

        var result = await _pushService.UnregisterDeviceAsync(userId.Value, deviceToken);

        if (!result)
        {
            return NotFound(new { error = "Device not found" });
        }

        return Ok(new
        {
            success = true,
            message = "Device unregistered"
        });
    }

    /// <summary>
    /// GET /api/notifications/push/devices - List my registered devices.
    /// </summary>
    [HttpGet("devices")]
    public async Task<IActionResult> GetDevices()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var devices = await _pushService.GetUserDevicesAsync(userId.Value);

        return Ok(new
        {
            data = devices.Select(d => new
            {
                id = d.Id,
                platform = d.Platform,
                device_name = d.DeviceName,
                is_active = d.IsActive,
                last_used_at = d.LastUsedAt,
                created_at = d.CreatedAt
            })
        });
    }

    /// <summary>
    /// GET /api/notifications/preferences - Get my notification preferences.
    /// </summary>
    [HttpGet("/api/notifications/preferences")]
    public async Task<IActionResult> GetPreferences()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var preferences = await _pushService.GetPreferencesAsync(userId.Value);

        return Ok(new
        {
            data = preferences.Select(p => new
            {
                notification_type = p.NotificationType,
                enable_in_app = p.EnableInApp,
                enable_push = p.EnablePush,
                enable_email = p.EnableEmail,
                updated_at = p.UpdatedAt
            })
        });
    }

    /// <summary>
    /// PUT /api/notifications/preferences - Update notification preferences.
    /// </summary>
    [HttpPut("/api/notifications/preferences")]
    public async Task<IActionResult> UpdatePreferences([FromBody] UpdateNotificationPreferencesRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.NotificationType))
        {
            return BadRequest(new { error = "notification_type is required" });
        }

        var pref = await _pushService.UpdatePreferenceAsync(
            userId.Value,
            request.NotificationType,
            request.EnableInApp,
            request.EnablePush,
            request.EnableEmail);

        return Ok(new
        {
            success = true,
            message = "Notification preference updated",
            preference = new
            {
                notification_type = pref.NotificationType,
                enable_in_app = pref.EnableInApp,
                enable_push = pref.EnablePush,
                enable_email = pref.EnableEmail,
                updated_at = pref.UpdatedAt
            }
        });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

#region Request DTOs

public class RegisterDeviceRequest
{
    [JsonPropertyName("device_token")]
    public string DeviceToken { get; set; } = string.Empty;

    [JsonPropertyName("platform")]
    public string Platform { get; set; } = "web";

    [JsonPropertyName("device_name")]
    public string? DeviceName { get; set; }
}

public class UnregisterDeviceRequest
{
    [JsonPropertyName("device_token")]
    public string DeviceToken { get; set; } = string.Empty;
}

public class UpdateNotificationPreferencesRequest
{
    [JsonPropertyName("notification_type")]
    public string NotificationType { get; set; } = string.Empty;

    [JsonPropertyName("enable_in_app")]
    public bool? EnableInApp { get; set; }

    [JsonPropertyName("enable_push")]
    public bool? EnablePush { get; set; }

    [JsonPropertyName("enable_email")]
    public bool? EnableEmail { get; set; }
}

#endregion
