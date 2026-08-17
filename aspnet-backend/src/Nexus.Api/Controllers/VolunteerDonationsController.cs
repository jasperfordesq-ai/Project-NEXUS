// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// A member's volunteering donations (R-27).
///
/// 🔴 What was here before. The POST wrote the donation as an opaque blob into
/// tenant config under <c>compat:vol-donation:</c> and the member's list
/// returned a hardcoded empty array — while the ADMIN donations screen read a
/// different store entirely (<c>money_donations</c>). So a member recorded a
/// donation, was told it worked, never saw it again, and no member donation
/// ever appeared for staff. Both ends now use the one store.
///
/// 🔴 This records a donation; it does NOT take a payment. Nothing here talks
/// to a payment provider, and every donation is created as <b>pending</b> —
/// the existing admin "complete" and "refund" paths, and the Stripe webhook,
/// are what move it on. Recording a payment as received without one having been
/// received is the money-shaped version of the fake-success problem this
/// backlog exists to remove.
/// </summary>
[ApiController]
[Authorize]
public class VolunteerDonationsController : ControllerBase
{
    /// <summary>Two decimal places, in minor units, as the store holds them.</summary>
    private const decimal MinorUnitsPerUnit = 100m;

    /// <summary>
    /// A ceiling on a single recorded donation. Not a policy about generosity —
    /// a guard against a typo or a crafted request writing an absurd figure into
    /// a financial record that staff then have to reconcile.
    /// </summary>
    private const decimal MaximumAmount = 100_000m;

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public VolunteerDonationsController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    /// <summary>GET /api/v2/volunteering/donations — mine.</summary>
    [HttpGet("api/v2/volunteering/donations")]
    [HttpGet("api/volunteering/donations")]
    public async Task<IActionResult> Mine()
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var rows = await _db.Set<MoneyDonation>().AsNoTracking()
            .Where(d => d.DonorUserId == userId.Value)
            .OrderByDescending(d => d.CreatedAt)
            .Take(200)
            .ToListAsync(HttpContext.RequestAborted);

        var donations = rows.Select(d => new
        {
            id = d.Id,
            amount = d.AmountMinorUnits / MinorUnitsPerUnit,
            currency = d.Currency,
            payment_method = d.PaymentMethod ?? string.Empty,
            message = d.Message,
            is_anonymous = d.IsAnonymous,
            anonymous = d.IsAnonymous,
            giving_day_id = d.GivingDayId,
            status = ClientStatus(d.Status),
            created_at = d.CreatedAt,
        });

        // 🔴 Laravel wraps these in `data.items` with `next_cursor` beside them,
        // not a bare list under `data` — read live:
        // {"data":{"items":[…],"next_cursor":null}}. A client doing data.map()
        // gets nothing from the production backend.
        //
        // Note this one says `next_cursor` where jobs/my-applications and
        // volunteering/training say `cursor` + `has_more`. Not a rule to
        // generalise — each of the five wrappers was read live.
        return Ok(new { data = new { items = donations, next_cursor = (string?)null } });
    }

    /// <summary>POST /api/v2/volunteering/donations — record one.</summary>
    [HttpPost("api/v2/volunteering/donations")]
    [HttpPost("api/volunteering/donations")]
    public async Task<IActionResult> Record([FromBody] DonationRequest? request)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        if (request is null || request.Amount is null)
        {
            return BadRequest(new { error = "amount is required", code = "VALIDATION_ERROR" });
        }

        var amount = request.Amount.Value;
        if (amount <= 0)
        {
            return BadRequest(new { error = "amount must be greater than zero", code = "VALIDATION_ERROR" });
        }

        if (amount > MaximumAmount)
        {
            return BadRequest(new
            {
                error = $"amount must be {MaximumAmount:N0} or less",
                code = "VALIDATION_ERROR",
            });
        }

        // Rounded once, here, rather than left to drift: a fraction of a cent
        // stored as a decimal is a reconciliation problem later.
        var minorUnits = (long)Math.Round(amount * MinorUnitsPerUnit, MidpointRounding.AwayFromZero);
        if (minorUnits <= 0)
        {
            return BadRequest(new { error = "amount is too small to record", code = "VALIDATION_ERROR" });
        }

        var donation = new MoneyDonation
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            DonorUserId = userId.Value,
            AmountMinorUnits = minorUnits,
            Currency = string.IsNullOrWhiteSpace(request.Currency) ? "EUR" : request.Currency.Trim().ToUpperInvariant(),
            Message = string.IsNullOrWhiteSpace(request.Message) ? null : request.Message.Trim(),
            PaymentMethod = string.IsNullOrWhiteSpace(request.PaymentMethod) ? null : request.PaymentMethod.Trim(),
            IsAnonymous = request.IsAnonymous ?? false,
            GivingDayId = request.GivingDayId,

            // 🔴 Always pending. No payment has been taken by this endpoint.
            Status = MoneyDonationStatus.Pending,
            CreatedAt = DateTime.UtcNow,
        };

        _db.Set<MoneyDonation>().Add(donation);
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        return Ok(new
        {
            success = true,
            data = new
            {
                id = donation.Id,
                status = ClientStatus(donation.Status),
                amount = donation.AmountMinorUnits / MinorUnitsPerUnit,
            },
        });
    }

    /// <summary>
    /// The client knows four states; the store has five. Cancelled is shown as
    /// failed rather than invented as a fifth chip the screen cannot render.
    /// </summary>
    private static string ClientStatus(MoneyDonationStatus status) => status switch
    {
        MoneyDonationStatus.Succeeded => "completed",
        MoneyDonationStatus.Refunded => "refunded",
        MoneyDonationStatus.Failed or MoneyDonationStatus.Cancelled => "failed",
        _ => "pending",
    };

    public sealed class DonationRequest
    {
        [JsonPropertyName("amount")] public decimal? Amount { get; set; }
        [JsonPropertyName("currency")] public string? Currency { get; set; }
        [JsonPropertyName("payment_method")] public string? PaymentMethod { get; set; }
        [JsonPropertyName("message")] public string? Message { get; set; }
        [JsonPropertyName("is_anonymous")] public bool? IsAnonymous { get; set; }
        [JsonPropertyName("giving_day_id")] public int? GivingDayId { get; set; }
    }
}
