// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Wallet controller - balance, transactions, and transfers.
/// Phase 4: READ operations. Phase 5: WRITE (transfer) operation.
/// </summary>
[ApiController]
[Route("api/wallet")]
[Authorize]
public class WalletController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<WalletController> _logger;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly PersonalWalletTransferEffectsService _transferEffects;

    public WalletController(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<WalletController> logger,
        PersonalWalletLedgerService personalWallet,
        PersonalWalletTransferEffectsService transferEffects)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
        _personalWallet = personalWallet;
        _transferEffects = transferEffects;
    }

    /// <summary>
    /// Get current user's balance.
    /// Balance = sum of received amounts - sum of sent amounts.
    /// </summary>
    [HttpGet("balance")]
    public async Task<IActionResult> GetBalance()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        // Calculate balance from transactions
        var received = await _db.Transactions
            .Where(t => t.ReceiverId == userId.Value && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount);

        var sent = await _db.Transactions
            .Where(t => t.SenderId == userId.Value && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount);

        var visibleReceived = await _db.Transactions
            .Where(t => t.ReceiverId == userId.Value
                && t.Status == TransactionStatus.Completed
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType)
            .SumAsync(t => t.Amount);
        var visibleSent = await _db.Transactions
            .Where(t => t.SenderId == userId.Value
                && t.Status == TransactionStatus.Completed
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType)
            .SumAsync(t => t.Amount);

        var balance = received - sent;

        // Compute pending amounts from Pending transactions
        var pendingIn = await _db.Transactions
            .Where(t => t.ReceiverId == userId.Value && t.Status == TransactionStatus.Pending)
            .SumAsync(t => t.Amount);

        var pendingOut = await _db.Transactions
            .Where(t => t.SenderId == userId.Value && t.Status == TransactionStatus.Pending)
            .SumAsync(t => t.Amount);

        _logger.LogDebug("User {UserId} balance: {Balance} (received: {Received}, sent: {Sent})",
            userId, balance, received, sent);

        return Ok(new
        {
            balance,
            currency = "hours",
            received_total = visibleReceived,
            sent_total = visibleSent,
            total_earned = visibleReceived,
            total_spent = visibleSent,
            pending_in = pendingIn,
            pending_out = pendingOut
        });
    }

    /// <summary>
    /// Get transaction history for the current user.
    /// Returns transactions where user is sender or receiver.
    /// </summary>
    [HttpGet("transactions")]
    public async Task<IActionResult> GetTransactions(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? type = null) // "sent", "received", or null for all
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        var skip = (page - 1) * limit;

        // Build query
        var query = _db.Transactions
            .Where(t => t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType
                && ((t.SenderId == userId.Value && !t.DeletedForSender)
                    || (t.ReceiverId == userId.Value && !t.DeletedForReceiver)));

        // Filter by type if specified (accept both old and new naming)
        if (!string.IsNullOrEmpty(type))
        {
            query = type.ToLowerInvariant() switch
            {
                "sent" or "debit" => query.Where(t => t.SenderId == userId.Value),
                "received" or "credit" => query.Where(t => t.ReceiverId == userId.Value),
                _ => query
            };
        }

        // Get total count
        var total = await query.CountAsync();

        // Get paginated results
        var transactions = await query
            .OrderByDescending(t => t.CreatedAt)
            .Skip(skip)
            .Take(limit)
            .Include(t => t.Sender)
            .Include(t => t.Receiver)
            .Include(t => t.Listing)
            .Select(t => new
            {
                id = t.Id,
                amount = t.Amount,
                description = t.Description,
                status = t.Status.ToString().ToLowerInvariant(),
                type = t.SenderId == userId.Value ? "sent" : "received",
                sender = t.Sender == null ? null : new
                {
                    id = t.Sender.Id,
                    first_name = t.Sender.FirstName,
                    last_name = t.Sender.LastName
                },
                receiver = t.Receiver == null ? null : new
                {
                    id = t.Receiver.Id,
                    first_name = t.Receiver.FirstName,
                    last_name = t.Receiver.LastName
                },
                other_user = t.SenderId == userId.Value
                    ? (t.Receiver == null ? null : new
                    {
                        id = t.Receiver.Id,
                        name = t.Receiver.FirstName + " " + t.Receiver.LastName,
                        avatar_url = (string?)null
                    })
                    : (t.Sender == null ? null : new
                    {
                        id = t.Sender.Id,
                        name = t.Sender.FirstName + " " + t.Sender.LastName,
                        avatar_url = (string?)null
                    }),
                listing = t.Listing == null ? null : new
                {
                    id = t.Listing.Id,
                    title = t.Listing.Title
                },
                listing_title = t.Listing == null ? null : t.Listing.Title,
                created_at = t.CreatedAt,
                updated_at = t.UpdatedAt
            })
            .ToListAsync();

        _logger.LogDebug("User {UserId} retrieved {Count} transactions", userId, transactions.Count);

        return Ok(new
        {
            data = transactions,
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
    /// Get a single transaction by ID.
    /// User must be sender or receiver to view.
    /// </summary>
    [HttpGet("transactions/{id:int}")]
    public async Task<IActionResult> GetTransaction(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var transaction = await _db.Transactions
            .Include(t => t.Sender)
            .Include(t => t.Receiver)
            .Include(t => t.Listing)
            .FirstOrDefaultAsync(t => t.Id == id
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType);

        if (transaction == null)
        {
            return NotFound(new { error = "Transaction not found" });
        }

        // Check if user is participant
        if (transaction.SenderId != userId.Value && transaction.ReceiverId != userId.Value)
        {
            return NotFound(new { error = "Transaction not found" });
        }

        var isSender = transaction.SenderId == userId.Value;
        var otherParty = isSender ? transaction.Receiver : transaction.Sender;

        return Ok(new
        {
            id = transaction.Id,
            amount = transaction.Amount,
            description = transaction.Description,
            status = transaction.Status.ToString().ToLowerInvariant(),
            type = isSender ? "sent" : "received",
            sender = transaction.Sender == null ? null : new
            {
                id = transaction.Sender.Id,
                first_name = transaction.Sender.FirstName,
                last_name = transaction.Sender.LastName
            },
            receiver = transaction.Receiver == null ? null : new
            {
                id = transaction.Receiver.Id,
                first_name = transaction.Receiver.FirstName,
                last_name = transaction.Receiver.LastName
            },
            other_user = otherParty == null ? null : new
            {
                id = otherParty.Id,
                name = otherParty.FirstName + " " + otherParty.LastName,
                avatar_url = (string?)null
            },
            listing = transaction.Listing == null ? null : new
            {
                id = transaction.Listing.Id,
                title = transaction.Listing.Title
            },
            listing_title = transaction.Listing?.Title,
            created_at = transaction.CreatedAt,
            updated_at = transaction.UpdatedAt
        });
    }

    /// <summary>
    /// Get count of pending transactions for the current user.
    /// </summary>
    [HttpGet("pending-count")]
    public async Task<IActionResult> GetPendingCount()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var count = await _db.Transactions
            .Where(t => (t.SenderId == userId.Value || t.ReceiverId == userId.Value)
                && t.Status == TransactionStatus.Pending)
            .CountAsync();

        return Ok(new { count });
    }

    /// <summary>
    /// Transfer time credits to another user.
    /// Creates a completed transaction atomically.
    /// </summary>
    [HttpPost("transfer")]
    [EnableRateLimiting(RateLimitingExtensions.PersonalWalletTransferPolicy)]
    public async Task<IActionResult> Transfer(
        [FromBody] TransferRequest request,
        CancellationToken cancellationToken = default)
    {
        var senderId = GetCurrentUserId();
        if (senderId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        if (!_tenantContext.TenantId.HasValue)
        {
            return BadRequest(new { error = "Tenant context not resolved" });
        }

        var bodyIdempotencyKey = request.IdempotencyKey?.Trim();
        var idempotencyKey = string.IsNullOrWhiteSpace(bodyIdempotencyKey)
            ? Request.Headers["Idempotency-Key"].FirstOrDefault()
            : bodyIdempotencyKey;
        var result = await _personalWallet.TransferAsync(
            _tenantContext.TenantId.Value,
            senderId.Value,
            request.ReceiverId.ToString(),
            request.Amount,
            request.Description,
            idempotencyKey,
            cancellationToken);
        if (!result.Success)
        {
            if (result.ErrorCode == "DUPLICATE_TRANSACTION")
            {
                return Conflict(new { error = result.ErrorMessage, code = result.ErrorCode });
            }

            if (result.ErrorCode == "SERVER_ERROR")
            {
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new { error = result.ErrorMessage, code = result.ErrorCode });
            }

            return BadRequest(new { error = result.ErrorMessage, code = result.ErrorCode });
        }

        await _transferEffects.RunAsync(_tenantContext.TenantId.Value, result);

        return CreatedAtAction(nameof(GetTransaction), new { id = result.TransactionId }, new
        {
            id = result.TransactionId,
            amount = result.Amount,
            description = result.Description,
            status = "completed",
            type = "sent",
            sender = new
            {
                id = result.SenderId,
                first_name = result.SenderFirstName,
                last_name = result.SenderLastName
            },
            receiver = new
            {
                id = result.ReceiverId,
                first_name = result.ReceiverFirstName,
                last_name = result.ReceiverLastName
            },
            listing_id = (int?)null,
            created_at = result.CreatedAt,
            new_balance = result.NewBalance
        });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

/// <summary>
/// Request model for transferring time credits.
/// </summary>
public class TransferRequest
{
    [JsonPropertyName("receiver_id")]
    public int ReceiverId { get; set; }

    [JsonPropertyName("amount")]
    public decimal Amount { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("listing_id")]
    public int? ListingId { get; set; }

    [JsonPropertyName("idempotency_key")]
    public string? IdempotencyKey { get; set; }
}
