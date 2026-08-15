// Copyright (c) 2024-2026 Jasper Ford
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
/// Sidebar badge counts — Laravel parity for AdminDashboardController::
/// badgeCounts. Every key is best-effort (Laravel returns 0 per counter on
/// failure and the React hook types every field optional); counts whose
/// source tables have no ASP.NET counterpart yet are honestly 0.
/// pending_users deliberately counts is_approved=false, matching the admin
/// users list's pending filter rather than a status string.
/// </summary>
[ApiController]
[Authorize]
public class AdminBadgeCountsController : ControllerBase
{
    private static readonly string[] AdminRoles = ["admin", "tenant_admin", "super_admin", "god"];
    private static readonly string[] OperationalRoles = ["broker", "coordinator"];

    private readonly NexusDbContext _db;

    public AdminBadgeCountsController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("api/v2/admin/badge-counts")]
    public async Task<IActionResult> BadgeCounts()
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null)
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status401Unauthorized, new
            {
                errors = new[] { new { code = "auth_required", message = "Authentication required" } },
                success = false
            });
        }

        var user = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == userId.Value && u.TenantId == tenantId.Value,
                HttpContext.RequestAborted);
        var allowed = user is not null
            && !OperationalRoles.Contains(user.Role)
            && (AdminRoles.Contains(user.Role)
                || user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod);
        if (!allowed)
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[] { new { code = "forbidden", message = "Admin access required" } },
                success = false
            });
        }

        var ct = HttpContext.RequestAborted;
        var counts = new Dictionary<string, int>
        {
            ["pending_users"] = await CountSafe(() =>
                _db.Users.CountAsync(u => !u.IsApproved, ct)),
            ["pending_listings"] = await CountSafe(() =>
                _db.Listings.CountAsync(l => l.Status == ListingStatus.Pending, ct)),
            ["pending_orgs"] = await CountSafe(() =>
                _db.Set<VolunteerOrganisation>().CountAsync(o => o.Status == "pending", ct)),
            // 🔴 These five were ALL hardcoded 0 until 2026-08-15, and the
            // comment claimed none of them had an ASP.NET counterpart. Two of
            // them did. A zero here is not harmless: this drives the admin
            // sidebar badges, so an admin sees "nothing waiting" and moves on
            // while exchanges sit unapproved and flagged messages sit
            // unreviewed. It is the exact regression Laravel's endpoint was
            // built to fix (the Minehead "no badge alert" report).
            // "Pending" for an admin badge means awaiting the listing owner's
            // answer — ExchangeStatus.Requested, the state before Accepted.
            ["pending_exchanges"] = await CountSafe(() =>
                _db.Exchanges.CountAsync(e => e.Status == ExchangeStatus.Requested, ct)),
            ["unreviewed_messages"] = await CountSafe(() =>
                _db.SafeguardingMessageReviews.CountAsync(r => r.IsFlagged && r.ReviewedAt == null, ct)),

            // These three genuinely have no source table in this backend —
            // there is no fraud-alert, GDPR-request or 404-log entity. They stay
            // 0, which is also what Laravel returns when a counter fails, but
            // the reason is "no data source" and not "not implemented".
            // Verified 2026-08-15: no FraudAlert / GdprRequest / DataRequest
            // entity exists anywhere in Entities/.
            ["fraud_alerts"] = 0,
            ["gdpr_requests"] = 0,
            ["404_errors"] = 0,
        };

        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.Value.ToString();
        return Ok(new
        {
            data = counts,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private static async Task<int> CountSafe(Func<Task<int>> counter)
    {
        try
        {
            return await counter();
        }
        catch
        {
            return 0;
        }
    }
}
