// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Organisation wallet endpoints.
/// </summary>
[ApiController]
[Route("api/organisations/{orgId}/wallet")]
[Authorize]
public class OrgWalletController : ControllerBase
{
    private readonly OrgWalletService _walletService;
    private readonly OrganisationService _organisationService;

    public OrgWalletController(
        OrgWalletService walletService,
        OrganisationService organisationService)
    {
        _walletService = walletService;
        _organisationService = organisationService;
    }

    /// <summary>
    /// GET /api/organisations/{orgId}/wallet - Get org wallet balance.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetBalance(int orgId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var access = await _organisationService.GetWalletAccessAsync(orgId, userId.Value);
        if (!access.Exists) return NotFound(new { error = "Organisation not found" });
        if (!access.Allowed)
            return StatusCode(403, new { error = "You must be a member of this organisation" });

        var wallet = await _walletService.GetWalletAsync(orgId);
        if (wallet == null) return NotFound(new { error = "Wallet not found" });

        return Ok(new
        {
            data = new
            {
                wallet.Id,
                organisation_id = wallet.OrganisationId,
                wallet.Balance,
                total_received = wallet.TotalReceived,
                total_spent = wallet.TotalSpent,
                created_at = wallet.CreatedAt
            }
        });
    }

    /// <summary>
    /// GET /api/organisations/{orgId}/wallet/transactions - List transactions.
    /// </summary>
    [HttpGet("transactions")]
    public async Task<IActionResult> GetTransactions(int orgId, [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var access = await _organisationService.GetWalletAccessAsync(orgId, userId.Value);
        if (!access.Exists) return NotFound(new { error = "Organisation not found" });
        if (!access.Allowed)
            return StatusCode(403, new { error = "You must be a member of this organisation" });

        var txs = await _walletService.GetTransactionsAsync(orgId, page, limit);
        return Ok(new
        {
            data = txs.Select(t => new
            {
                t.Id, t.Type, t.Amount, balance_after = t.BalanceAfter,
                t.Category, t.Description, created_at = t.CreatedAt,
                initiated_by = t.InitiatedBy != null ? new { t.InitiatedBy.Id, t.InitiatedBy.FirstName, t.InitiatedBy.LastName } : null,
                from_user = t.FromUser != null ? new { t.FromUser.Id, t.FromUser.FirstName, t.FromUser.LastName } : null,
                to_user = t.ToUser != null ? new { t.ToUser.Id, t.ToUser.FirstName, t.ToUser.LastName } : null
            })
        });
    }

    /// <summary>
    /// POST /api/organisations/{orgId}/wallet/donate - Donate from personal wallet.
    /// </summary>
    [HttpPost("donate")]
    public async Task<IActionResult> Donate(int orgId, [FromBody] OrgWalletDonateRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (tx, error) = await _walletService.DonateAsync(orgId, userId.Value, request.Amount, request.Description);
        if (error != null) return BadRequest(new { error });

        return Ok(new { data = new { tx!.Id, tx.Amount, balance_after = tx.BalanceAfter, tx.Category } });
    }

    /// <summary>
    /// POST /api/organisations/{orgId}/wallet/transfer - Transfer to a user (org admin/owner).
    /// </summary>
    [HttpPost("transfer")]
    public async Task<IActionResult> TransferToUser(int orgId, [FromBody] OrgWalletTransferRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (tx, error) = await _walletService.TransferToUserAsync(
            orgId, request.ToUserId, userId.Value, request.Amount, request.Description);
        if (error != null) return BadRequest(new { error });

        return Ok(new { data = new { tx!.Id, tx.Amount, balance_after = tx.BalanceAfter, tx.Category } });
    }

    /// <summary>
    /// POST /api/organisations/{orgId}/wallet/grant - Admin grant credits (admin only).
    /// </summary>
    [HttpPost("grant")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminGrant(int orgId, [FromBody] OrgWalletGrantRequest request)
    {
        var (tx, error) = await _walletService.AdminGrantAsync(orgId, request.Amount, request.Description);
        if (error != null) return BadRequest(new { error });

        return Ok(new { data = new { tx!.Id, tx.Amount, balance_after = tx.BalanceAfter, tx.Category } });
    }
}

public class OrgWalletDonateRequest
{
    [JsonPropertyName("amount")] public decimal Amount { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
}

public class OrgWalletTransferRequest
{
    [JsonPropertyName("to_user_id")] public int ToUserId { get; set; }
    [JsonPropertyName("amount")] public decimal Amount { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
}

public class OrgWalletGrantRequest
{
    [JsonPropertyName("amount")] public decimal Amount { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
}
