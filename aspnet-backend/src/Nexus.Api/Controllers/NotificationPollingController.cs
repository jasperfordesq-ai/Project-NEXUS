// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Notification polling and realtime config endpoints.
/// Provides long-polling fallback for clients that cannot use SignalR.
/// </summary>
[ApiController]
[Authorize]
public class NotificationPollingController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<NotificationPollingController> _logger;
    private readonly IConfiguration _configuration;

    public NotificationPollingController(
        NexusDbContext db,
        ILogger<NotificationPollingController> logger,
        IConfiguration configuration)
    {
        _db = db;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>
    /// GET /api/notifications/poll?since={timestamp} - Poll for new notifications since a given timestamp.
    /// Returns all notifications created after the specified timestamp.
    /// </summary>
    [HttpGet("api/notifications/poll")]
    public async Task<IActionResult> PollNotifications([FromQuery] DateTime? since = null)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var sinceUtc = since?.ToUniversalTime() ?? DateTime.UtcNow.AddMinutes(-5);

        var notifications = await _db.Notifications
            .AsNoTracking()
            .Where(n => n.UserId == userId && n.CreatedAt > sinceUtc)
            .OrderByDescending(n => n.CreatedAt)
            .Take(100)
            .Select(n => new
            {
                n.Id,
                n.Type,
                n.Title,
                n.Body,
                n.Data,
                n.IsRead,
                n.CreatedAt,
                n.ReadAt
            })
            .ToListAsync();

        var unreadCount = await _db.Notifications
            .Where(n => n.UserId == userId && !n.IsRead)
            .CountAsync();

        return Ok(new
        {
            data = notifications,
            count = notifications.Count,
            unread_count = unreadCount,
            polled_at = DateTime.UtcNow
        });
    }

    /// <summary>
    /// GET /api/realtime/config - Get realtime configuration for the client.
    /// Returns SignalR hub URL, polling interval, and feature flags.
    /// </summary>
    /// 🔴 Authenticated, matching Laravel (401). This was anonymous and
    /// handed out the realtime hub URL, Pusher key and cluster to any caller.
    /// Those are connection details for the live-updates channel, not public
    /// configuration, and Laravel keeps the endpoint behind auth
    /// (routes/api.php:919, inside the auth:sanctum group).
    [HttpGet("api/realtime/config")]
    [HttpGet("api/v2/realtime/config")]
    [Authorize]
    public IActionResult GetRealtimeConfig()
    {
        var pusherKey = PusherConfigValue("PUSHER_APP_KEY", "Pusher:Key", "Pusher:AppKey");
        var pusherCluster = PusherConfigValue("PUSHER_APP_CLUSTER", "Pusher:Cluster") ?? "eu";
        var wsHost = PusherConfigValue("PUSHER_HOST", "Pusher:Host") ?? string.Empty;
        var wsPort = int.TryParse(PusherConfigValue("PUSHER_PORT", "Pusher:Port"), out var parsedPort) ? parsedPort : 443;
        var enabled = !string.IsNullOrWhiteSpace(pusherKey)
            && !string.IsNullOrWhiteSpace(PusherConfigValue("PUSHER_APP_SECRET", "Pusher:Secret", "Pusher:AppSecret"))
            && !string.IsNullOrWhiteSpace(PusherConfigValue("PUSHER_APP_ID", "Pusher:AppId"));

        // 🔴 Laravel sends SIX keys under `data` and nothing at the root:
        // driver, key, cluster, ws_host, ws_port, force_tls
        // (RealtimeController::config:21-36). This response repeated hub_url,
        // polling_interval_ms, realtime_enabled and transports at BOTH the root
        // and inside `data`. Nothing in react-frontend or web-uk reads any of the
        // eight, so the duplicates are removed.
        //
        // 🔴 `authEndpoint` and `enabled` are KEPT, and that is a deliberate,
        // documented divergence rather than an oversight. The canonical React
        // client requires them: PusherContext.tsx:152 stores the config only when
        // `response.data.enabled` is truthy, and :168 refuses to construct the
        // client without it. Removing `enabled` to match Laravel exactly would
        // stop realtime working on THIS backend, which is the one thing the
        // parity rule forbids — never fix a difference by breaking the client.
        //
        // 🔴 The same reading says Laravel has a live defect here, reported
        // separately and NOT changed from this workstream: because Laravel omits
        // `enabled`, `response.data.enabled` is undefined against the production
        // backend, so PusherContext never stores a config and never constructs a
        // client — and PusherContext.tsx:186 is the only place in the frontend
        // that constructs one. Whether Laravel should send `enabled` or the client
        // should stop requiring it is an owner decision, not a parity edit.
        return Ok(new
        {
            success = true,
            data = new
            {
                driver = "pusher",
                key = pusherKey ?? string.Empty,
                cluster = pusherCluster,
                ws_host = wsHost,
                ws_port = wsPort,
                force_tls = true,
                authEndpoint = "/api/pusher/auth",
                enabled,
            }
        });
    }

    private string? PusherConfigValue(string environmentName, params string[] configurationKeys)
    {
        var value = Environment.GetEnvironmentVariable(environmentName);
        if (!string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        foreach (var key in configurationKeys)
        {
            value = _configuration[key];
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }

    private int? GetCurrentUserId() => User.GetUserId();
}
