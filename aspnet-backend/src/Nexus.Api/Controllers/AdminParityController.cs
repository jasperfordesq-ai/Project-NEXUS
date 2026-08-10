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

        return NotImplemented(path, "read");
    }

    [HttpPost("{**path}", Order = 1000)]
    public IActionResult Post(string path) => NotImplemented(path, "create");

    [HttpPut("{**path}", Order = 1000)]
    public IActionResult Put(string path) => NotImplemented(path, "update");

    [HttpPatch("{**path}", Order = 1000)]
    public IActionResult Patch(string path) => NotImplemented(path, "patch");

    [HttpDelete("{**path}", Order = 1000)]
    public IActionResult Delete(string path) => NotImplemented(path, "delete");

    /// <summary>
    /// Honest answer for an admin route this backend has not implemented.
    /// </summary>
    /// <remarks>
    /// 🔴 Changed 2026-08-10. This catch-all previously answered HTTP 200 with
    /// <c>success = true</c> for EVERY unmatched admin write, and a fabricated
    /// empty collection for every unmatched admin read, while doing nothing.
    ///
    /// Two consequences, both bad:
    ///
    ///   * A real administrator could click "suspend member" on an
    ///     unimplemented endpoint, be told it succeeded, and nothing would
    ///     happen. Every log and monitor would show a healthy 200.
    ///   * Any parity or smoke test of the form "did it respond successfully?"
    ///     passed across the WHOLE admin surface without proving anything. The
    ///     contract work is measured against exactly that kind of evidence, so
    ///     this handler could bank false progress at scale.
    ///
    /// 501 is the correct code: the request is understood, the functionality is
    /// simply not implemented here. It is deliberately distinguishable from 404
    /// (route genuinely unknown) so parity tooling can count what is missing.
    ///
    /// Do NOT restore a success-shaped response to make a test or a client go
    /// green. Implement the endpoint, or let it report honestly.
    /// </remarks>
    private IActionResult NotImplemented(string path, string operation)
    {
        var normalized = NormalizePath(path);
        var route = $"/api/admin/{normalized}";

        return StatusCode(StatusCodes.Status501NotImplemented, new
        {
            success = false,
            error = "not_implemented",
            message =
                $"The admin {operation} endpoint '{route}' is not implemented by the ASP.NET " +
                "backend. Nothing was changed. This backend is not contract-complete against " +
                "Laravel; use the Laravel backend for this operation.",
            route,
            operation,
            parity = "v1.5-admin"
        });
    }

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
