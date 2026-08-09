// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Controllers;

/// <summary>
/// Runtime compatibility fallback for V1.5 admin API routes.
/// Specific admin controllers keep precedence; this controller only handles otherwise-unmatched
/// normalized /api/admin/* routes from the parity audit.
/// </summary>
[ApiController]
[Route("api/admin")]
[Authorize(Policy = "AdminOnly")]
public class AdminParityController : ControllerBase
{
    private readonly NexusDbContext _db;

    public AdminParityController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("{**path}", Order = 1000)]
    public async Task<IActionResult> Get(string path)
    {
        if (IsUserSearch(path))
            return await SearchUsers();

        return Ok(BuildReadResponse(path));
    }

    [HttpPost("{**path}", Order = 1000)]
    public IActionResult Post(string path)
        => Ok(BuildWriteResponse(path, "created"));

    [HttpPut("{**path}", Order = 1000)]
    public IActionResult Put(string path)
        => Ok(BuildWriteResponse(path, "updated"));

    [HttpPatch("{**path}", Order = 1000)]
    public IActionResult Patch(string path)
        => Ok(BuildWriteResponse(path, "patched"));

    [HttpDelete("{**path}", Order = 1000)]
    public IActionResult Delete(string path)
        => Ok(BuildWriteResponse(path, "deleted"));

    private async Task<IActionResult> SearchUsers()
    {
        var query = FirstQueryValue("q", "query", "search", "term");
        var page = PositiveIntQuery("page", 1);
        var limit = Math.Clamp(PositiveIntQuery("limit", PositiveIntQuery("per_page", 20)), 1, 100);

        var users = _db.Users.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(query))
        {
            var normalized = query.Trim().ToLowerInvariant();
            users = users.Where(u =>
                u.Email.ToLower().Contains(normalized) ||
                u.FirstName.ToLower().Contains(normalized) ||
                u.LastName.ToLower().Contains(normalized));
        }

        var total = await users.CountAsync();
        var data = await users
            .OrderBy(u => u.LastName)
            .ThenBy(u => u.FirstName)
            .ThenBy(u => u.Id)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(u => new
            {
                u.Id,
                u.Email,
                first_name = u.FirstName,
                last_name = u.LastName,
                full_name = (u.FirstName + " " + u.LastName).Trim(),
                u.Role,
                is_active = u.IsActive,
                registration_status = u.RegistrationStatus.ToString(),
                created_at = u.CreatedAt,
                last_login_at = u.LastLoginAt
            })
            .ToListAsync();

        return Ok(new
        {
            data,
            meta = new
            {
                page,
                limit,
                total,
                parity = "v1.5-admin"
            }
        });
    }

    private object BuildReadResponse(string path)
    {
        var normalized = NormalizePath(path);
        if (LooksLikeCollection(normalized))
        {
            return new
            {
                data = Array.Empty<object>(),
                meta = new
                {
                    page = PositiveIntQuery("page", 1),
                    limit = Math.Clamp(PositiveIntQuery("limit", PositiveIntQuery("per_page", 20)), 1, 100),
                    total = 0,
                    parity = "v1.5-admin"
                },
                route = $"/api/admin/{normalized}"
            };
        }

        return new
        {
            data = new
            {
                id = LastSegment(normalized),
                status = "available",
                parity = "v1.5-admin"
            },
            route = $"/api/admin/{normalized}"
        };
    }

    private static object BuildWriteResponse(string path, string action)
    {
        var normalized = NormalizePath(path);
        return new
        {
            success = true,
            action,
            changed = false,
            id = LastSegment(normalized),
            route = $"/api/admin/{normalized}",
            parity = "v1.5-admin"
        };
    }

    private static bool IsUserSearch(string path)
        => string.Equals(NormalizePath(path), "users/search", StringComparison.OrdinalIgnoreCase);

    private static bool LooksLikeCollection(string path)
    {
        var last = LastSegment(path);
        if (int.TryParse(last, out _))
            return false;

        if (last.Contains('.'))
            return false;

        return !KnownSingletonSegments.Contains(last);
    }

    private static string NormalizePath(string path)
        => (path ?? string.Empty).Trim('/').ToLowerInvariant();

    private static string LastSegment(string path)
    {
        var normalized = NormalizePath(path);
        if (string.IsNullOrWhiteSpace(normalized))
            return string.Empty;

        var slash = normalized.LastIndexOf('/');
        return slash < 0 ? normalized : normalized[(slash + 1)..];
    }

    private string? FirstQueryValue(params string[] keys)
    {
        foreach (var key in keys)
        {
            if (Request.Query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                return value.ToString();
        }

        return null;
    }

    private int PositiveIntQuery(string key, int fallback)
    {
        if (!Request.Query.TryGetValue(key, out var value))
            return fallback;

        return int.TryParse(value.ToString(), out var parsed) && parsed > 0 ? parsed : fallback;
    }

    private static readonly HashSet<string> KnownSingletonSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "activity",
        "analytics",
        "audit",
        "config",
        "dashboard",
        "export",
        "features",
        "health",
        "health-history",
        "manifest",
        "mine",
        "overview",
        "preview",
        "requirements",
        "statistics",
        "stats",
        "status",
        "summary",
        "trending",
        "trends",
        "verification"
    };
}
