// Copyright © 2024–2026 Jasper Ford
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
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Expanded wallet features: categories, limits, donations, alerts, export.
/// Phase 19: Expanded Wallet.
/// </summary>
[ApiController]
[Route("api/wallet/features")]
[Authorize]
public class WalletFeaturesController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly WalletFeatureService _walletFeatures;
    private readonly ILogger<WalletFeaturesController> _logger;

    public WalletFeaturesController(
        NexusDbContext db,
        TenantContext tenantContext,
        WalletFeatureService walletFeatures,
        ILogger<WalletFeaturesController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _walletFeatures = walletFeatures;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/wallet/features/categories - List transaction categories.
    /// </summary>
    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories()
    {
        var categories = await _walletFeatures.GetTransactionCategoriesAsync();

        return Ok(new
        {
            data = categories.Select(c => new
            {
                id = c.Id,
                name = c.Name,
                description = c.Description,
                color = c.Color,
                icon = c.Icon,
                is_default = c.IsDefault,
                created_at = c.CreatedAt
            })
        });
    }

    /// <summary>
    /// GET /api/wallet/features/limits - Get my transaction limits.
    /// </summary>
    [HttpGet("limits")]
    public async Task<IActionResult> GetMyLimits()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Get user-specific limit
        var userLimit = await _db.Set<TransactionLimit>()
            .Where(l => l.UserId == userId && l.IsActive)
            .FirstOrDefaultAsync();

        // Get tenant-wide default
        var tenantLimit = await _db.Set<TransactionLimit>()
            .Where(l => l.UserId == null && l.IsActive)
            .FirstOrDefaultAsync();

        // Merge: user overrides tenant
        return Ok(new
        {
            max_daily_amount = userLimit?.MaxDailyAmount ?? tenantLimit?.MaxDailyAmount,
            max_single_amount = userLimit?.MaxSingleAmount ?? tenantLimit?.MaxSingleAmount,
            max_daily_transactions = userLimit?.MaxDailyTransactions ?? tenantLimit?.MaxDailyTransactions,
            min_balance = userLimit?.MinBalance ?? tenantLimit?.MinBalance,
            source = userLimit != null ? "user" : (tenantLimit != null ? "tenant" : "none")
        });
    }

    /// <summary>
    /// GET /api/wallet/features/summary - Extended balance summary.
    /// </summary>
    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var summary = await _walletFeatures.GetBalanceSummaryAsync(userId.Value);

        return Ok(new
        {
            balance = summary.Balance,
            currency = "hours",
            received_total = summary.ReceivedTotal,
            sent_total = summary.SentTotal,
            pending_total = summary.PendingTotal,
            donated_total = summary.DonatedTotal,
            donations_received_total = summary.DonationsReceivedTotal
        });
    }

    /// <summary>
    /// POST /api/wallet/features/donate - Donate credits.
    /// </summary>
    [HttpPost("donate")]
    public async Task<IActionResult> Donate([FromBody] DonateRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (request.Amount <= 0)
        {
            return BadRequest(new { error = "Amount must be greater than zero." });
        }

        if (request.RecipientId.HasValue && request.RecipientId.Value == userId.Value)
        {
            return BadRequest(new { error = "Cannot donate to yourself." });
        }

        // Validate recipient exists if specified
        if (request.RecipientId.HasValue)
        {
            var recipient = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.RecipientId.Value);
            if (recipient == null)
            {
                return BadRequest(new { error = "Recipient not found." });
            }
        }

        // Check limits
        var (allowed, reason) = await _walletFeatures.CheckTransactionLimitsAsync(userId.Value, request.Amount);
        if (!allowed)
        {
            return BadRequest(new { error = reason });
        }

        try
        {
            var donation = await _walletFeatures.ProcessDonationAsync(
                userId.Value,
                request.RecipientId,
                request.Amount,
                request.Message,
                request.IsAnonymous);

            return CreatedAtAction(nameof(GetDonations), null, new
            {
                id = donation.Id,
                amount = donation.Amount,
                recipient_id = donation.RecipientId,
                message = donation.Message,
                is_anonymous = donation.IsAnonymous,
                transaction_id = donation.TransactionId,
                created_at = donation.CreatedAt
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Donation failed for user {UserId}: {Message}", userId, ex.Message);
            return BadRequest(new { error = "Donation could not be processed. Please check your balance and try again." });
        }
    }

    /// <summary>
    /// GET /api/wallet/features/donations - Donation history.
    /// </summary>
    [HttpGet("donations")]
    public async Task<IActionResult> GetDonations([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1 || limit > 100) limit = 20;

        var (donations, total) = await _walletFeatures.GetDonationHistoryAsync(userId.Value, page, limit);

        return Ok(new
        {
            data = donations.Select(d => new
            {
                id = d.Id,
                amount = d.Amount,
                message = d.Message,
                is_anonymous = d.IsAnonymous,
                type = d.DonorId == userId.Value ? "donated" : "received",
                donor = d.IsAnonymous && d.DonorId != userId.Value ? null : new
                {
                    id = d.Donor?.Id,
                    first_name = d.Donor?.FirstName,
                    last_name = d.Donor?.LastName
                },
                recipient = d.RecipientId.HasValue ? new
                {
                    id = d.Recipient?.Id,
                    first_name = d.Recipient?.FirstName,
                    last_name = d.Recipient?.LastName
                } : null,
                transaction_id = d.TransactionId,
                created_at = d.CreatedAt
            }),
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
    /// POST /api/wallet/features/alerts - Create balance alert.
    /// </summary>
    [HttpPost("alerts")]
    public async Task<IActionResult> CreateAlert([FromBody] CreateAlertRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (request.ThresholdAmount < 0)
        {
            return BadRequest(new { error = "Threshold amount cannot be negative." });
        }

        var alert = await _walletFeatures.CreateBalanceAlertAsync(userId.Value, request.ThresholdAmount);

        return CreatedAtAction(nameof(GetAlerts), null, new
        {
            id = alert.Id,
            threshold_amount = alert.ThresholdAmount,
            is_active = alert.IsActive,
            created_at = alert.CreatedAt
        });
    }

    /// <summary>
    /// GET /api/wallet/features/alerts - List my alerts.
    /// </summary>
    [HttpGet("alerts")]
    public async Task<IActionResult> GetAlerts()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var alerts = await _db.Set<BalanceAlert>()
            .Where(a => a.UserId == userId.Value)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync();

        return Ok(new
        {
            data = alerts.Select(a => new
            {
                id = a.Id,
                threshold_amount = a.ThresholdAmount,
                is_active = a.IsActive,
                last_triggered_at = a.LastTriggeredAt,
                created_at = a.CreatedAt
            })
        });
    }

    /// <summary>
    /// DELETE /api/wallet/features/alerts/{id} - Remove alert.
    /// </summary>
    [HttpDelete("alerts/{id:int}")]
    public async Task<IActionResult> DeleteAlert(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var alert = await _db.Set<BalanceAlert>()
            .FirstOrDefaultAsync(a => a.Id == id && a.UserId == userId.Value);

        if (alert == null)
        {
            return NotFound(new { error = "Alert not found." });
        }

        _db.Set<BalanceAlert>().Remove(alert);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Alert deleted." });
    }

    /// <summary>
    /// GET /api/wallet/features/export - Export transactions as CSV.
    /// </summary>
    [HttpGet("export")]
    public async Task<IActionResult> ExportTransactions(
        [FromQuery] DateTime? start_date,
        [FromQuery] DateTime? end_date,
        [FromQuery] string format = "csv")
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var csv = await _walletFeatures.ExportTransactionsAsync(userId.Value, start_date, end_date, format);

        return File(
            System.Text.Encoding.UTF8.GetBytes(csv),
            "text/csv",
            $"transactions_{DateTime.UtcNow:yyyyMMdd}.csv");
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

/// <summary>
/// Request model for donating credits.
/// </summary>
public class DonateRequest
{
    [JsonPropertyName("recipient_id")]
    public int? RecipientId { get; set; }

    [JsonPropertyName("amount")]
    public decimal Amount { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("is_anonymous")]
    public bool IsAnonymous { get; set; } = false;
}

/// <summary>
/// Request model for creating a balance alert.
/// </summary>
public class CreateAlertRequest
{
    [JsonPropertyName("threshold_amount")]
    public decimal ThresholdAmount { get; set; }
}
