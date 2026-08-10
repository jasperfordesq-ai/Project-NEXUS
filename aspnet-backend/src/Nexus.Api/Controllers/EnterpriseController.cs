// Copyright © 2024-2026 Jasper Ford
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
/// Enterprise administration controller for config management, dashboard, and compliance.
/// Phase 57: Enterprise/Governance.
/// </summary>
[ApiController]
[Route("api/admin/enterprise")]
[Authorize(Policy = "AdminOnly")]
public class EnterpriseController : ControllerBase
{
    private readonly EnterpriseService _enterprise;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<EnterpriseController> _logger;

    public EnterpriseController(
        EnterpriseService enterprise,
        TenantContext tenantContext,
        ILogger<EnterpriseController> logger)
    {
        _enterprise = enterprise;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/admin/enterprise/config - List enterprise configs.
    /// </summary>
    [HttpGet("config")]
    public async Task<IActionResult> GetConfigs([FromQuery] string? category = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var configs = await _enterprise.GetConfigsAsync(tenantId, category);

        var response = configs.Select(c => new ConfigResponse
        {
            Id = c.Id,
            Key = c.Key,
            Value = c.Value,
            Category = c.Category,
            Description = c.Description,
            UpdatedAt = c.UpdatedAt
        });

        return Ok(response);
    }

    /// <summary>
    /// PUT /api/admin/enterprise/config - Create or update an enterprise config.
    /// </summary>
    [HttpPut("config")]
    public async Task<IActionResult> SetConfig([FromBody] SetConfigRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Key))
            return BadRequest(new { error = "key is required" });

        if (string.IsNullOrWhiteSpace(request.Value))
            return BadRequest(new { error = "value is required" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var config = await _enterprise.SetConfigAsync(
            tenantId, request.Key, request.Value, request.Category, request.Description);

        return Ok(new ConfigResponse
        {
            Id = config.Id,
            Key = config.Key,
            Value = config.Value,
            Category = config.Category,
            Description = config.Description,
            UpdatedAt = config.UpdatedAt
        });
    }

    /// <summary>
    /// DELETE /api/admin/enterprise/config/{key} - Delete an enterprise config.
    /// </summary>
    [HttpDelete("config/{key}")]
    public async Task<IActionResult> DeleteConfig(string key)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var deleted = await _enterprise.DeleteConfigAsync(tenantId, key);

        if (!deleted)
            return NotFound(new { error = "Config not found" });

        return Ok(new { message = "Config deleted" });
    }

    /// <summary>
    /// GET /api/admin/enterprise/dashboard - Enterprise dashboard metrics.
    /// </summary>
    [HttpGet("dashboard")]
    public async Task<IActionResult> GetDashboard()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var dashboard = await _enterprise.GetDashboardAsync(tenantId);

        return Ok(new EnterpriseDashboardResponse
        {
            TenantId = dashboard.TenantId,
            TotalUsers = dashboard.TotalUsers,
            ActiveUsers = dashboard.ActiveUsers,
            ExchangesThisMonth = dashboard.ExchangesThisMonth,
            CompletedExchangesThisMonth = dashboard.CompletedExchangesThisMonth,
            TotalCreditsTransferredThisMonth = dashboard.TotalCreditsTransferredThisMonth,
            PendingDataExportRequests = dashboard.PendingDataExportRequests,
            PendingDataDeletionRequests = dashboard.PendingDataDeletionRequests,
            GeneratedAt = dashboard.GeneratedAt
        });
    }

    /// <summary>
    /// GET /api/admin/enterprise/compliance - Compliance overview (GDPR consent stats, data requests).
    /// </summary>
    [HttpGet("compliance")]
    public async Task<IActionResult> GetCompliance()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var compliance = await _enterprise.GetComplianceOverviewAsync(tenantId);

        return Ok(new ComplianceResponse
        {
            TenantId = compliance.TenantId,
            TotalConsentRecords = compliance.TotalConsentRecords,
            GrantedConsents = compliance.GrantedConsents,
            RevokedConsents = compliance.RevokedConsents,
            ConsentTypesTracked = compliance.ConsentTypesTracked,
            TotalDataExportRequests = compliance.TotalDataExportRequests,
            PendingDataExportRequests = compliance.PendingDataExportRequests,
            TotalDataDeletionRequests = compliance.TotalDataDeletionRequests,
            PendingDataDeletionRequests = compliance.PendingDataDeletionRequests,
            CompletedDeletions = compliance.CompletedDeletions,
            GeneratedAt = compliance.GeneratedAt
        });
    }

    /// <summary>
    /// GET /api/admin/enterprise/governance - Governance dashboard metrics.
    /// </summary>
    [HttpGet("governance")]
    public async Task<IActionResult> GetGovernanceDashboard()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var dashboard = await _enterprise.GetGovernanceDashboardAsync(tenantId);
        return Ok(dashboard);
    }

    /// <summary>
    /// GET /api/admin/enterprise/security-posture - Security posture assessment.
    /// </summary>
    [HttpGet("security-posture")]
    public async Task<IActionResult> GetSecurityPosture()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var posture = await _enterprise.GetSecurityPostureAsync(tenantId);
        return Ok(posture);
    }

    #region Request/Response DTOs

    public class SetConfigRequest
    {
        [JsonPropertyName("key")]
        public string Key { get; set; } = string.Empty;

        [JsonPropertyName("value")]
        public string Value { get; set; } = string.Empty;

        [JsonPropertyName("category")]
        public string? Category { get; set; }

        [JsonPropertyName("description")]
        public string? Description { get; set; }
    }

    public class ConfigResponse
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("key")]
        public string Key { get; set; } = string.Empty;

        [JsonPropertyName("value")]
        public string Value { get; set; } = string.Empty;

        [JsonPropertyName("category")]
        public string? Category { get; set; }

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("updated_at")]
        public DateTime UpdatedAt { get; set; }
    }

    public class EnterpriseDashboardResponse
    {
        [JsonPropertyName("tenant_id")]
        public int TenantId { get; set; }

        [JsonPropertyName("total_users")]
        public int TotalUsers { get; set; }

        [JsonPropertyName("active_users")]
        public int ActiveUsers { get; set; }

        [JsonPropertyName("exchanges_this_month")]
        public int ExchangesThisMonth { get; set; }

        [JsonPropertyName("completed_exchanges_this_month")]
        public int CompletedExchangesThisMonth { get; set; }

        [JsonPropertyName("total_credits_transferred_this_month")]
        public decimal TotalCreditsTransferredThisMonth { get; set; }

        [JsonPropertyName("pending_data_export_requests")]
        public int PendingDataExportRequests { get; set; }

        [JsonPropertyName("pending_data_deletion_requests")]
        public int PendingDataDeletionRequests { get; set; }

        [JsonPropertyName("generated_at")]
        public DateTime GeneratedAt { get; set; }
    }

    public class ComplianceResponse
    {
        [JsonPropertyName("tenant_id")]
        public int TenantId { get; set; }

        [JsonPropertyName("total_consent_records")]
        public int TotalConsentRecords { get; set; }

        [JsonPropertyName("granted_consents")]
        public int GrantedConsents { get; set; }

        [JsonPropertyName("revoked_consents")]
        public int RevokedConsents { get; set; }

        [JsonPropertyName("consent_types_tracked")]
        public int ConsentTypesTracked { get; set; }

        [JsonPropertyName("total_data_export_requests")]
        public int TotalDataExportRequests { get; set; }

        [JsonPropertyName("pending_data_export_requests")]
        public int PendingDataExportRequests { get; set; }

        [JsonPropertyName("total_data_deletion_requests")]
        public int TotalDataDeletionRequests { get; set; }

        [JsonPropertyName("pending_data_deletion_requests")]
        public int PendingDataDeletionRequests { get; set; }

        [JsonPropertyName("completed_deletions")]
        public int CompletedDeletions { get; set; }

        [JsonPropertyName("generated_at")]
        public DateTime GeneratedAt { get; set; }
    }

    #endregion
}
