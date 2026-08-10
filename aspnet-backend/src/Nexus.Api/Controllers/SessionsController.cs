// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/sessions")]
[Authorize]
public class SessionsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<SessionsController> _logger;

    public SessionsController(NexusDbContext db, ILogger<SessionsController> logger)
    { _db = db; _logger = logger; }

    [HttpGet]
    public async Task<IActionResult> GetSessions()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var currentTokenHash = GetCurrentTokenHash();
        var sessions = await _db.UserSessions.AsNoTracking()
            .Where(s => s.UserId == userId && s.IsActive && s.ExpiresAt > DateTime.UtcNow)
            .OrderByDescending(s => s.LastActivityAt)
            .Select(s => new { s.Id, ip_address = s.IpAddress, user_agent = s.UserAgent, device_info = s.DeviceInfo, is_current = s.SessionToken == currentTokenHash, created_at = s.CreatedAt, last_activity_at = s.LastActivityAt, expires_at = s.ExpiresAt })
            .ToListAsync();
        return Ok(new { data = sessions, total = sessions.Count });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> TerminateSession(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var session = await _db.UserSessions.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId && s.IsActive);
        if (session == null) return NotFound(new { error = "Session not found" });
        var currentTokenHash = GetCurrentTokenHash();
        if (session.SessionToken == currentTokenHash) return BadRequest(new { error = "Cannot terminate your current session. Use logout instead." });
        session.IsActive = false;
        await _db.SaveChangesAsync();
        _logger.LogInformation("User {UserId} terminated session {SessionId}", userId, id);
        return Ok(new { success = true, message = "Session terminated" });
    }

    [HttpDelete]
    public async Task<IActionResult> TerminateAllOtherSessions()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var currentTokenHash = GetCurrentTokenHash();
        var count = await _db.UserSessions
            .Where(s => s.UserId == userId && s.IsActive && s.SessionToken != currentTokenHash)
            .ExecuteUpdateAsync(setters => setters.SetProperty(s => s.IsActive, false));
        _logger.LogInformation("User {UserId} terminated {Count} other sessions", userId, count);
        return Ok(new { success = true, message = $"Terminated {count} other session(s)", terminated_count = count });
    }

    private string? GetCurrentTokenHash()
    {
        var authHeader = HttpContext.Request.Headers.Authorization.FirstOrDefault();
        if (authHeader == null || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        var token = authHeader["Bearer ".Length..].Trim();
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(token));
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }
}
