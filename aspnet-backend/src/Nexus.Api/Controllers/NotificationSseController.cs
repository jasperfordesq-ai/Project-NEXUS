// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Server-Sent Events endpoint as a WebSocket fallback for real-time notifications.
/// </summary>
[ApiController]
[Route("api/notifications/stream")]
[Authorize]
public class NotificationSseController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<NotificationSseController> _logger;

    public NotificationSseController(
        NexusDbContext db,
        TenantContext tenant,
        ILogger<NotificationSseController> logger)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/notifications/stream — SSE stream of new notifications.
    /// Falls back from SignalR WebSocket for clients that don't support it.
    /// </summary>
    [HttpGet]
    public async Task StreamNotifications(CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        if (userId == null)
        {
            Response.StatusCode = 401;
            return;
        }

        Response.Headers["Content-Type"] = "text/event-stream";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["Connection"] = "keep-alive";

        var lastCheck = DateTime.UtcNow;

        _logger.LogDebug("SSE stream opened for user {UserId}", userId.Value);

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var notifications = await _db.Set<Notification>()
                    .Where(n => n.UserId == userId.Value && n.CreatedAt > lastCheck && !n.IsRead)
                    .OrderByDescending(n => n.CreatedAt)
                    .Take(10)
                    .ToListAsync(cancellationToken);

                if (notifications.Any())
                {
                    foreach (var n in notifications)
                    {
                        var json = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            id = n.Id,
                            type = n.Type,
                            title = n.Title,
                            message = n.Body,
                            created_at = n.CreatedAt
                        });
                        await Response.WriteAsync($"data: {json}\n\n", cancellationToken);
                    }
                    await Response.Body.FlushAsync(cancellationToken);
                    lastCheck = DateTime.UtcNow;
                }

                await Task.Delay(5000, cancellationToken); // 5-second polling interval
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Client disconnected — normal
        }

        _logger.LogDebug("SSE stream closed for user {UserId}", userId.Value);
    }
}
