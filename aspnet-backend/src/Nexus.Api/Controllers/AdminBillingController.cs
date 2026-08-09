// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * AdminBillingController — first-class billing/Stripe admin debug surface.
 *
 * The AdminCheckoutReturnPage admin UI previously had to proxy through
 * /api/admin/donations to inspect Stripe Checkout sessions. That endpoint
 * is donation-shaped (drops StripeCheckoutSessionId / StripePaymentIntentId
 * / UpdatedAt), so the UI couldn't surface the values it actually needed
 * for debugging.
 *
 * This controller serves checkout-session metadata sourced from
 * MoneyDonation rows (the only place we persist Stripe Checkout sessions
 * for now — once subscriptions land they'll surface here too).
 */

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/billing")]
[Authorize(Policy = "AdminOnly")]
public class AdminBillingController : ControllerBase
{
    private readonly NexusDbContext _db;

    public AdminBillingController(NexusDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// GET /api/admin/billing/checkout-sessions — paginated list of recent
    /// Stripe Checkout sessions sourced from MoneyDonation rows.
    ///
    /// Query params:
    ///   status  — Pending | Succeeded | Failed | Refunded | Cancelled (optional)
    ///   since   — ISO-8601 timestamp; filters UpdatedAt &gt;= since (optional)
    ///   email   — substring match on donor email, case-insensitive (optional)
    ///   page    — 1-based (default 1)
    ///   pageSize — default 50, capped at 200
    ///
    /// Response shape: { data: [...], total: int, page: int, page_size: int }
    /// Each row includes a computed <c>is_stuck</c> bool: true when status is
    /// Pending AND CreatedAt is more than 30 minutes old. The admin UI uses
    /// this to highlight Pending sessions that probably need manual
    /// reconciliation (Stripe Checkout abandoned, webhook missed, etc.).
    /// </summary>
    [HttpGet("checkout-sessions")]
    public async Task<IActionResult> ListCheckoutSessions(
        [FromQuery] string? status = null,
        [FromQuery] DateTime? since = null,
        [FromQuery] string? email = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 50;
        if (pageSize > 200) pageSize = 200;

        IQueryable<MoneyDonation> q = _db.MoneyDonations.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<MoneyDonationStatus>(status, ignoreCase: true, out var parsedStatus))
        {
            q = q.Where(d => d.Status == parsedStatus);
        }

        if (since.HasValue)
        {
            var sinceUtc = since.Value.Kind == DateTimeKind.Utc
                ? since.Value
                : since.Value.ToUniversalTime();
            q = q.Where(d => (d.UpdatedAt ?? d.CreatedAt) >= sinceUtc);
        }

        if (!string.IsNullOrWhiteSpace(email))
        {
            var needle = email.Trim().ToLower();
            q = q.Where(d => d.DonorEmail != null && d.DonorEmail.ToLower().Contains(needle));
        }

        var total = await q.CountAsync(ct);

        var rows = await q
            .OrderByDescending(d => d.UpdatedAt ?? d.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        // Computed in-memory so we don't have to translate "now" into the DB
        // query — DateTime.UtcNow inside an EF expression is provider-dependent.
        var stuckThreshold = DateTime.UtcNow.AddMinutes(-30);

        var data = rows.Select(d => new
        {
            id = d.Id,
            stripe_checkout_session_id = d.StripeCheckoutSessionId,
            stripe_payment_intent_id = d.StripePaymentIntentId,
            status = d.Status.ToString(),
            amount_minor_units = d.AmountMinorUnits,
            currency = d.Currency,
            donor_email = d.DonorEmail,
            donor_display_name = d.DonorDisplayName,
            failure_reason = d.FailureReason,
            created_at = d.CreatedAt,
            updated_at = d.UpdatedAt,
            completed_at = d.CompletedAt,
            is_stuck = d.Status == MoneyDonationStatus.Pending && d.CreatedAt < stuckThreshold
        }).ToList();

        return Ok(new
        {
            data,
            total,
            page,
            page_size = pageSize
        });
    }
}
