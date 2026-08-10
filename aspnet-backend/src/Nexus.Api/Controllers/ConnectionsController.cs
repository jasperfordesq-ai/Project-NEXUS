// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/connections")]
[Authorize]
public class ConnectionsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<ConnectionsController> _logger;
    private readonly GamificationService _gamification;

    public ConnectionsController(NexusDbContext db, ILogger<ConnectionsController> logger, GamificationService gamification)
    {
        _db = db;
        _logger = logger;
        _gamification = gamification;
    }

    /// <summary>
    /// GET /api/connections - List all connections for the current user
    /// Returns accepted connections and pending requests (both incoming and outgoing)
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetConnections(
        [FromQuery] string? status = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Connections
            .Include(c => c.Requester)
            .Include(c => c.Addressee)
            .Where(c => c.RequesterId == userId || c.AddresseeId == userId);

        // Filter by status if provided
        if (!string.IsNullOrEmpty(status))
        {
            query = query.Where(c => c.Status == status);
        }

        var total = await query.CountAsync();

        var connections = await query
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(c => new
            {
                c.Id,
                c.Status,
                c.CreatedAt,
                c.UpdatedAt,
                // Determine the "other" user (not the current user)
                other_user = c.RequesterId == userId
                    ? new { Id = c.Addressee != null ? c.Addressee.Id : 0, FirstName = c.Addressee != null ? c.Addressee.FirstName : null, LastName = c.Addressee != null ? c.Addressee.LastName : null, Email = c.Addressee != null ? c.Addressee.Email : null }
                    : new { Id = c.Requester != null ? c.Requester.Id : 0, FirstName = c.Requester != null ? c.Requester.FirstName : null, LastName = c.Requester != null ? c.Requester.LastName : null, Email = c.Requester != null ? c.Requester.Email : null },
                // Is current user the requester or addressee?
                is_requester = c.RequesterId == userId,
                requester_id = c.RequesterId,
                addressee_id = c.AddresseeId
            })
            .ToListAsync();

        return Ok(new
        {
            data = connections,
            connections,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// GET /api/connections/pending - Get pending connection requests for current user
    /// </summary>
    [HttpGet("pending")]
    public async Task<IActionResult> GetPendingRequests()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Incoming requests (where current user is the addressee)
        var incoming = await _db.Connections
            .Include(c => c.Requester)
            .Where(c => c.AddresseeId == userId && c.Status == Connection.Statuses.Pending)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                c.Id,
                c.CreatedAt,
                from_user = new { c.Requester.Id, c.Requester.FirstName, c.Requester.LastName, c.Requester.Email }
            })
            .ToListAsync();

        // Outgoing requests (where current user is the requester)
        var outgoing = await _db.Connections
            .Include(c => c.Addressee)
            .Where(c => c.RequesterId == userId && c.Status == Connection.Statuses.Pending)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                c.Id,
                c.CreatedAt,
                to_user = new { c.Addressee.Id, c.Addressee.FirstName, c.Addressee.LastName, c.Addressee.Email }
            })
            .ToListAsync();

        return Ok(new { incoming, outgoing });
    }

    /// <summary>
    /// POST /api/connections - Send a connection request to another user
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> SendConnectionRequest([FromBody] SendConnectionRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantIdRaw = User.GetTenantId();
        if (tenantIdRaw == null) return BadRequest(new { error = "Tenant context not resolved" });
        var tenantId = tenantIdRaw.Value;

        // Validate: cannot connect to yourself
        if (request.UserId == userId)
        {
            return BadRequest(new { error = "Cannot send connection request to yourself" });
        }

        // Check if target user exists (in same tenant due to global filter)
        var targetUser = await _db.Users.FirstOrDefaultAsync(x => x.Id == request.UserId);
        if (targetUser == null)
        {
            return NotFound(new { error = "User not found" });
        }

        // Get current user for notification
        var currentUser = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId.Value);

        // Check for existing connection (in either direction)
        var existingConnection = await _db.Connections
            .FirstOrDefaultAsync(c =>
                (c.RequesterId == userId && c.AddresseeId == request.UserId) ||
                (c.RequesterId == request.UserId && c.AddresseeId == userId));

        if (existingConnection != null)
        {
            if (existingConnection.Status == Connection.Statuses.Accepted)
            {
                return BadRequest(new { error = "Already connected with this user" });
            }
            if (existingConnection.Status == Connection.Statuses.Pending)
            {
                // If the other user already sent a request, auto-accept it
                if (existingConnection.RequesterId == request.UserId)
                {
                    existingConnection.Status = Connection.Statuses.Accepted;
                    existingConnection.UpdatedAt = DateTime.UtcNow;

                    // Notify both users about the mutual connection
                    _db.Notifications.Add(new Notification
                    {
                        TenantId = tenantId,
                        UserId = request.UserId,
                        Type = Notification.Types.ConnectionAccepted,
                        Title = "Connection accepted",
                        Body = $"{currentUser?.FirstName} {currentUser?.LastName} is now connected with you",
                        Data = JsonSerializer.Serialize(new { connection_id = existingConnection.Id, user_id = userId })
                    });
                    _db.Notifications.Add(new Notification
                    {
                        TenantId = tenantId,
                        UserId = userId.Value,
                        Type = Notification.Types.ConnectionAccepted,
                        Title = "Connection accepted",
                        Body = $"You are now connected with {targetUser.FirstName} {targetUser.LastName}",
                        Data = JsonSerializer.Serialize(new { connection_id = existingConnection.Id, user_id = request.UserId })
                    });

                    await _db.SaveChangesAsync();

                    // Award XP and check badges for both users (mutual connection - non-critical)
                    try
                    {
                        await _gamification.AwardXpAsync(userId.Value, XpLog.Amounts.ConnectionMade, XpLog.Sources.ConnectionMade, existingConnection.Id, "Made a connection");
                        await _gamification.AwardXpAsync(request.UserId, XpLog.Amounts.ConnectionMade, XpLog.Sources.ConnectionMade, existingConnection.Id, "Made a connection");
                        await _gamification.CheckAndAwardBadgesAsync(userId.Value, "connection_accepted");
                        await _gamification.CheckAndAwardBadgesAsync(request.UserId, "connection_accepted");
                    }
                    catch (DbUpdateException ex)
                    {
                        _logger.LogWarning(ex, "Failed to award XP/badges for connection {ConnectionId}", existingConnection.Id);
                    }
                    catch (InvalidOperationException ex)
                    {
                        _logger.LogWarning(ex, "Failed to award XP/badges for connection {ConnectionId}", existingConnection.Id);
                    }

                    _logger.LogInformation("Connection auto-accepted between users {UserId} and {TargetUserId}",
                        userId, request.UserId);

                    return Ok(new
                    {
                        success = true,
                        message = "Connection request accepted (mutual request)",
                        connection = new
                        {
                            existingConnection.Id,
                            existingConnection.Status,
                            existingConnection.CreatedAt,
                            existingConnection.UpdatedAt
                        }
                    });
                }

                return BadRequest(new { error = "Connection request already pending" });
            }
            if (existingConnection.Status == Connection.Statuses.Blocked)
            {
                return BadRequest(new { error = "Cannot connect with this user" });
            }
            if (existingConnection.Status == Connection.Statuses.Declined)
            {
                // Allow re-sending after decline - update the existing record
                existingConnection.RequesterId = userId.Value;
                existingConnection.AddresseeId = request.UserId;
                existingConnection.Status = Connection.Statuses.Pending;
                existingConnection.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();

                _logger.LogInformation("Connection request re-sent from user {UserId} to {TargetUserId}",
                    userId, request.UserId);

                return Ok(new
                {
                    success = true,
                    message = "Connection request sent",
                    connection = new
                    {
                        existingConnection.Id,
                        existingConnection.Status,
                        existingConnection.CreatedAt,
                        existingConnection.UpdatedAt
                    }
                });
            }
        }

        // Create new connection request
        var connection = new Connection
        {
            TenantId = tenantId,
            RequesterId = userId.Value,
            AddresseeId = request.UserId,
            Status = Connection.Statuses.Pending
        };

        _db.Connections.Add(connection);
        await _db.SaveChangesAsync();

        // Notify the addressee about the connection request (after save so connection.Id is assigned)
        _db.Notifications.Add(new Notification
        {
            TenantId = tenantId,
            UserId = request.UserId,
            Type = Notification.Types.ConnectionRequest,
            Title = "New connection request",
            Body = $"{currentUser?.FirstName} {currentUser?.LastName} wants to connect with you",
            Data = JsonSerializer.Serialize(new { connection_id = connection.Id, from_user_id = userId })
        });

        await _db.SaveChangesAsync();

        _logger.LogInformation("Connection request sent from user {UserId} to {TargetUserId}",
            userId, request.UserId);

        return CreatedAtAction(nameof(GetConnections), null, new
        {
            success = true,
            message = "Connection request sent",
            connection = new
            {
                connection.Id,
                connection.Status,
                connection.CreatedAt
            }
        });
    }

    /// <summary>
    /// PUT /api/connections/{id}/accept - Accept a pending connection request
    /// </summary>
    [HttpPut("{id:int}/accept")]
    public async Task<IActionResult> AcceptConnection(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantIdRaw = User.GetTenantId();
        if (tenantIdRaw == null) return BadRequest(new { error = "Tenant context not resolved" });
        var tenantId = tenantIdRaw.Value;

        var connection = await _db.Connections.FirstOrDefaultAsync(x => x.Id == id);
        if (connection == null)
        {
            return NotFound(new { error = "Connection request not found" });
        }

        // Only the addressee can accept
        if (connection.AddresseeId != userId)
        {
            return StatusCode(403, new { error = "Only the addressee can accept this connection request" });
        }

        if (connection.Status != Connection.Statuses.Pending)
        {
            return BadRequest(new { error = $"Cannot accept connection with status '{connection.Status}'" });
        }

        // Get current user for notification
        var currentUser = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId.Value);

        connection.Status = Connection.Statuses.Accepted;
        connection.UpdatedAt = DateTime.UtcNow;

        // Notify the requester that their request was accepted
        _db.Notifications.Add(new Notification
        {
            TenantId = tenantId,
            UserId = connection.RequesterId,
            Type = Notification.Types.ConnectionAccepted,
            Title = "Connection accepted",
            Body = $"{currentUser?.FirstName} {currentUser?.LastName} accepted your connection request",
            Data = JsonSerializer.Serialize(new { connection_id = connection.Id, user_id = userId })
        });

        await _db.SaveChangesAsync();

        // Award XP and check badges for both users (non-critical)
        try
        {
            await _gamification.AwardXpAsync(userId.Value, XpLog.Amounts.ConnectionMade, XpLog.Sources.ConnectionMade, connection.Id, "Made a connection");
            await _gamification.AwardXpAsync(connection.RequesterId, XpLog.Amounts.ConnectionMade, XpLog.Sources.ConnectionMade, connection.Id, "Made a connection");
            await _gamification.CheckAndAwardBadgesAsync(userId.Value, "connection_accepted");
            await _gamification.CheckAndAwardBadgesAsync(connection.RequesterId, "connection_accepted");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for connection {ConnectionId}", connection.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for connection {ConnectionId}", connection.Id);
        }

        _logger.LogInformation("Connection {ConnectionId} accepted by user {UserId}", id, userId);

        return Ok(new
        {
            success = true,
            message = "Connection accepted",
            connection = new
            {
                connection.Id,
                connection.Status,
                connection.CreatedAt,
                connection.UpdatedAt
            }
        });
    }

    /// <summary>
    /// PUT /api/connections/{id}/decline - Decline a pending connection request
    /// </summary>
    [HttpPut("{id:int}/decline")]
    public async Task<IActionResult> DeclineConnection(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var connection = await _db.Connections.FirstOrDefaultAsync(x => x.Id == id);
        if (connection == null)
        {
            return NotFound(new { error = "Connection request not found" });
        }

        // Only the addressee can decline
        if (connection.AddresseeId != userId)
        {
            return StatusCode(403, new { error = "Only the addressee can decline this connection request" });
        }

        if (connection.Status != Connection.Statuses.Pending)
        {
            return BadRequest(new { error = $"Cannot decline connection with status '{connection.Status}'" });
        }

        connection.Status = Connection.Statuses.Declined;
        connection.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Connection {ConnectionId} declined by user {UserId}", id, userId);

        return Ok(new
        {
            success = true,
            message = "Connection declined"
        });
    }

    /// <summary>
    /// DELETE /api/connections/{id} - Remove a connection or cancel a pending request
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> RemoveConnection(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var connection = await _db.Connections.FirstOrDefaultAsync(x => x.Id == id);
        if (connection == null)
        {
            return NotFound(new { error = "Connection not found" });
        }

        // Only participants can remove
        if (connection.RequesterId != userId && connection.AddresseeId != userId)
        {
            return StatusCode(403, new { error = "Only participants can remove this connection" });
        }

        // For pending requests, only the requester can cancel
        if (connection.Status == Connection.Statuses.Pending && connection.RequesterId != userId)
        {
            return BadRequest(new { error = "Only the requester can cancel a pending request. Use decline instead." });
        }

        _db.Connections.Remove(connection);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Connection {ConnectionId} removed by user {UserId}", id, userId);

        return Ok(new
        {
            success = true,
            message = "Connection removed"
        });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

public class SendConnectionRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("user_id")]
    public int UserId { get; set; }
}
