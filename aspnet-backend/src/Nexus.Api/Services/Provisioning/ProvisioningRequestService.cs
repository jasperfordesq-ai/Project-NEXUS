// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Provisioning;

/// <summary>
/// Service for the new-tenant provisioning queue. The state machine is:
/// Pending -> Approved -> Provisioning -> Ready
///                              \-> Failed -> (retry -> Approved)
/// Pending -> Rejected (terminal).
///
/// MarkReadyAsync does NOT create the Tenant row itself — orchestration is
/// the caller's responsibility. This service tracks the workflow.
/// </summary>
public class ProvisioningRequestService
{
    private static readonly Regex SubdomainRegex = new(
        "^[a-z0-9](-?[a-z0-9])*$", RegexOptions.Compiled);

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<ProvisioningRequestService> _logger;

    public ProvisioningRequestService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<ProvisioningRequestService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    public async Task<List<ProvisioningRequest>> ListAsync(
        string? status, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.ProvisioningRequests.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<ProvisioningRequestStatus>(status, true, out var s))
        {
            query = query.Where(r => r.Status == s);
        }

        return await query
            .OrderByDescending(r => r.RequestedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);
    }

    public Task<ProvisioningRequest?> GetAsync(Guid id, CancellationToken ct) =>
        _db.ProvisioningRequests.FirstOrDefaultAsync(r => r.Id == id, ct);

    public async Task<ProvisioningRequest> CreateAsync(
        CreateProvisioningRequestDto dto, int? tenantIdOverride, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.OrgName))
            throw new InvalidOperationException("OrgName is required");
        if (string.IsNullOrWhiteSpace(dto.ContactName))
            throw new InvalidOperationException("ContactName is required");
        if (string.IsNullOrWhiteSpace(dto.ContactEmail))
            throw new InvalidOperationException("ContactEmail is required");

        var subdomain = (dto.RequestedSubdomain ?? string.Empty).Trim().ToLowerInvariant();
        if (subdomain.Length < 3 || subdomain.Length > 32)
            throw new InvalidOperationException("Subdomain must be 3-32 characters");
        if (!SubdomainRegex.IsMatch(subdomain))
            throw new InvalidOperationException("Subdomain must be lowercase a-z, 0-9 and hyphens");

        // Uniqueness check — against existing tenants AND existing non-terminal requests.
        var subdomainTaken = await _db.Tenants
            .IgnoreQueryFilters()
            .AnyAsync(t => t.Slug == subdomain, ct);
        if (subdomainTaken)
            throw new InvalidOperationException("Subdomain already in use by an existing tenant");

        var pendingConflict = await _db.ProvisioningRequests
            .IgnoreQueryFilters()
            .AnyAsync(r => r.RequestedSubdomain == subdomain
                && r.Status != ProvisioningRequestStatus.Rejected
                && r.Status != ProvisioningRequestStatus.Failed, ct);
        if (pendingConflict)
            throw new InvalidOperationException("Subdomain already requested by a pending provisioning request");

        // tenantIdOverride is for public submissions where there is no tenant context;
        // fall back to resolved tenant or tenant 1 (the platform tenant).
        var tenantId = tenantIdOverride
            ?? (_tenantContext.IsResolved ? _tenantContext.TenantId ?? 1 : 1);

        var req = new ProvisioningRequest
        {
            TenantId = tenantId,
            OrgName = dto.OrgName.Trim(),
            RequestedSubdomain = subdomain,
            ContactName = dto.ContactName.Trim(),
            ContactEmail = dto.ContactEmail.Trim(),
            ContactPhone = dto.ContactPhone?.Trim(),
            Plan = dto.Plan?.Trim(),
            Country = dto.Country?.Trim()?.ToUpperInvariant(),
            Notes = dto.Notes?.Trim(),
            Status = ProvisioningRequestStatus.Pending
        };

        _db.ProvisioningRequests.Add(req);
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("Provisioning request created: {Id} {Subdomain}", req.Id, subdomain);
        return req;
    }

    public async Task<ProvisioningRequest> ApproveAsync(Guid id, int approverUserId, CancellationToken ct)
    {
        var req = await RequireAsync(id, ct);
        if (req.Status != ProvisioningRequestStatus.Pending)
            throw new InvalidOperationException($"Cannot approve from status {req.Status}");
        req.Status = ProvisioningRequestStatus.Approved;
        req.ApprovedAt = DateTime.UtcNow;
        req.ApprovedBy = approverUserId;
        req.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return req;
    }

    public async Task<ProvisioningRequest> RejectAsync(Guid id, int approverUserId, string reason, CancellationToken ct)
    {
        var req = await RequireAsync(id, ct);
        if (req.Status != ProvisioningRequestStatus.Pending)
            throw new InvalidOperationException($"Cannot reject from status {req.Status}");
        req.Status = ProvisioningRequestStatus.Rejected;
        req.ApprovedBy = approverUserId;
        req.FailureReason = string.IsNullOrWhiteSpace(reason) ? "Rejected" : reason.Trim();
        req.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return req;
    }

    public async Task<ProvisioningRequest> MarkProvisioningAsync(Guid id, CancellationToken ct)
    {
        var req = await RequireAsync(id, ct);
        if (req.Status != ProvisioningRequestStatus.Approved)
            throw new InvalidOperationException($"Cannot mark provisioning from status {req.Status}");
        req.Status = ProvisioningRequestStatus.Provisioning;
        req.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return req;
    }

    public async Task<ProvisioningRequest> MarkReadyAsync(Guid id, int createdTenantId, CancellationToken ct)
    {
        var req = await RequireAsync(id, ct);
        if (req.Status != ProvisioningRequestStatus.Provisioning)
            throw new InvalidOperationException($"Cannot mark ready from status {req.Status}");
        if (createdTenantId <= 0)
            throw new InvalidOperationException("createdTenantId must be a positive id");
        req.Status = ProvisioningRequestStatus.Ready;
        req.ProvisionedAt = DateTime.UtcNow;
        req.CreatedTenantId = createdTenantId;
        req.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return req;
    }

    public async Task<ProvisioningRequest> MarkFailedAsync(Guid id, string reason, CancellationToken ct)
    {
        var req = await RequireAsync(id, ct);
        if (req.Status != ProvisioningRequestStatus.Provisioning)
            throw new InvalidOperationException($"Cannot mark failed from status {req.Status}");
        req.Status = ProvisioningRequestStatus.Failed;
        req.FailedAt = DateTime.UtcNow;
        req.FailureReason = string.IsNullOrWhiteSpace(reason) ? "Provisioning failed" : reason.Trim();
        req.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return req;
    }

    public async Task<ProvisioningRequest> RetryAsync(Guid id, CancellationToken ct)
    {
        var req = await RequireAsync(id, ct);
        if (req.Status != ProvisioningRequestStatus.Failed)
            throw new InvalidOperationException($"Cannot retry from status {req.Status}");
        req.Status = ProvisioningRequestStatus.Approved;
        req.ProvisionedAt = null;
        req.FailedAt = null;
        req.FailureReason = null;
        req.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return req;
    }

    private async Task<ProvisioningRequest> RequireAsync(Guid id, CancellationToken ct)
    {
        var req = await _db.ProvisioningRequests.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (req == null) throw new KeyNotFoundException($"ProvisioningRequest {id} not found");
        return req;
    }
}

public class CreateProvisioningRequestDto
{
    [JsonPropertyName("org_name")] public string OrgName { get; set; } = string.Empty;
    [JsonPropertyName("requested_subdomain")] public string RequestedSubdomain { get; set; } = string.Empty;
    [JsonPropertyName("contact_name")] public string ContactName { get; set; } = string.Empty;
    [JsonPropertyName("contact_email")] public string ContactEmail { get; set; } = string.Empty;
    [JsonPropertyName("contact_phone")] public string? ContactPhone { get; set; }
    [JsonPropertyName("plan")] public string? Plan { get; set; }
    [JsonPropertyName("country")] public string? Country { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}
