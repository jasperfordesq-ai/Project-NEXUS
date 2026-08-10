// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Sub-accounts controller - family/managed account profiles with permission controls.
/// </summary>
[ApiController]
[Route("api/sub-accounts")]
[Authorize]
public class SubAccountsController : ControllerBase
{
    private readonly SubAccountService _subAccountService;
    private readonly TenantContext _tenant;
    private readonly ILogger<SubAccountsController> _logger;

    public SubAccountsController(
        SubAccountService subAccountService,
        TenantContext tenant,
        ILogger<SubAccountsController> logger)
    {
        _subAccountService = subAccountService;
        _tenant = tenant;
        _logger = logger;
    }

    // --- DTOs ---

    public class CreateSubAccountRequest
    {
        [JsonPropertyName("sub_user_id")]
        public int SubUserId { get; set; }

        [JsonPropertyName("relationship")]
        public string Relationship { get; set; } = string.Empty;

        [JsonPropertyName("display_name")]
        public string? DisplayName { get; set; }
    }

    public class UpdateSubAccountRequest
    {
        [JsonPropertyName("display_name")]
        public string? DisplayName { get; set; }

        [JsonPropertyName("can_transact")]
        public bool? CanTransact { get; set; }

        [JsonPropertyName("can_message")]
        public bool? CanMessage { get; set; }

        [JsonPropertyName("can_join_groups")]
        public bool? CanJoinGroups { get; set; }
    }

    // --- Endpoints ---

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var subAccounts = await _subAccountService.GetSubAccountsAsync(userId.Value);
        var data = subAccounts.Select(s => new
        {
            id = s.Id, sub_user_id = s.SubUserId, relationship = s.Relationship,
            display_name = s.DisplayName, can_transact = s.CanTransact,
            can_message = s.CanMessage, can_join_groups = s.CanJoinGroups,
            is_active = s.IsActive, created_at = s.CreatedAt
        });
        return Ok(new { data });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var (subAccount, error) = await _subAccountService.GetSubAccountAsync(id, userId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new
        {
            id = subAccount!.Id, sub_user_id = subAccount.SubUserId,
            relationship = subAccount.Relationship, display_name = subAccount.DisplayName,
            can_transact = subAccount.CanTransact, can_message = subAccount.CanMessage,
            can_join_groups = subAccount.CanJoinGroups, is_active = subAccount.IsActive,
            created_at = subAccount.CreatedAt, updated_at = subAccount.UpdatedAt
        });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateSubAccountRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (string.IsNullOrWhiteSpace(request.Relationship))
            return BadRequest(new { error = "relationship is required" });
        var (subAccount, error) = await _subAccountService.CreateSubAccountAsync(
            tenantId, userId.Value, request.SubUserId, request.Relationship, request.DisplayName);
        if (error != null) return BadRequest(new { error });
        return Ok(new
        {
            id = subAccount!.Id, sub_user_id = subAccount.SubUserId,
            relationship = subAccount.Relationship, display_name = subAccount.DisplayName,
            can_transact = subAccount.CanTransact, can_message = subAccount.CanMessage,
            can_join_groups = subAccount.CanJoinGroups, is_active = subAccount.IsActive,
            created_at = subAccount.CreatedAt
        });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateSubAccountRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var (subAccount, error) = await _subAccountService.UpdateSubAccountAsync(
            id, userId.Value, request.DisplayName,
            request.CanTransact, request.CanMessage, request.CanJoinGroups);
        if (error != null) return NotFound(new { error });
        return Ok(new
        {
            id = subAccount!.Id, sub_user_id = subAccount.SubUserId,
            relationship = subAccount.Relationship, display_name = subAccount.DisplayName,
            can_transact = subAccount.CanTransact, can_message = subAccount.CanMessage,
            can_join_groups = subAccount.CanJoinGroups, is_active = subAccount.IsActive,
            updated_at = subAccount.UpdatedAt
        });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Deactivate(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var (success, error) = await _subAccountService.RemoveSubAccountAsync(id, userId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new { message = "Sub-account deactivated" });
    }

    [HttpGet("primary")]
    public async Task<IActionResult> GetPrimaryAccount()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var (primary, error) = await _subAccountService.GetPrimaryAccountAsync(userId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new
        {
            id = primary!.Id, primary_user_id = primary.PrimaryUserId,
            relationship = primary.Relationship, display_name = primary.DisplayName
        });
    }

    [HttpGet("status")]
    public async Task<IActionResult> GetManagedStatus()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var isManaged = await _subAccountService.IsManagedAccountAsync(userId.Value);
        return Ok(new { is_managed = isManaged });
    }

    [HttpGet("pooled-balance")]
    public async Task<IActionResult> GetPooledBalance()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var (pooledBalance, breakdown, error) = await _subAccountService.GetPooledBalanceAsync(userId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new
        {
            pooled_balance = pooledBalance,
            accounts = breakdown.Select(b => new
            {
                user_id = b.UserId, name = b.Name,
                relationship = b.Relationship, balance = b.Balance
            })
        });
    }

    [HttpPost("pool-transfer")]
    public async Task<IActionResult> PoolTransfer([FromBody] PoolTransferRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var (success, error) = await _subAccountService.PoolTransferAsync(
            tenantId, userId.Value, request.FromUserId, request.ToUserId, request.Amount, request.Description);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Pool transfer completed" });
    }

    public class PoolTransferRequest
    {
        [JsonPropertyName("from_user_id")] public int FromUserId { get; set; }
        [JsonPropertyName("to_user_id")] public int ToUserId { get; set; }
        [JsonPropertyName("amount")] public decimal Amount { get; set; }
        [JsonPropertyName("description")] public string? Description { get; set; }
    }
}
