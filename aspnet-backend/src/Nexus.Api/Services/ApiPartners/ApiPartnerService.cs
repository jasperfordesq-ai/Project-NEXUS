// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.ApiPartners;

/// <summary>
/// Service for third-party API consumers. Distinct from
/// FederationApiKeyService (which is for peer timebanks). Keys are stored
/// as SHA-256 hashes; raw key returned only at registration / rotation.
/// </summary>
public class ApiPartnerService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<ApiPartnerService> _logger;

    public ApiPartnerService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<ApiPartnerService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    public async Task<List<ApiPartner>> ListAsync(string? status, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var query = _db.ApiPartners.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<ApiPartnerStatus>(status, true, out var s))
        {
            query = query.Where(p => p.Status == s);
        }
        return await query
            .OrderByDescending(p => p.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);
    }

    public Task<ApiPartner?> GetAsync(Guid id, CancellationToken ct) =>
        _db.ApiPartners.FirstOrDefaultAsync(p => p.Id == id, ct);

    public async Task<(ApiPartner Partner, string PlaintextKey)> RegisterAsync(
        RegisterApiPartnerDto dto, int? createdByUserId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Name))
            throw new InvalidOperationException("Name is required");
        if (string.IsNullOrWhiteSpace(dto.ContactEmail))
            throw new InvalidOperationException("ContactEmail is required");

        var tenantId = _tenantContext.IsResolved ? _tenantContext.TenantId ?? 1 : 1;
        var (raw, hash, prefix) = GenerateKey();

        var partner = new ApiPartner
        {
            TenantId = tenantId,
            Name = dto.Name.Trim(),
            ContactEmail = dto.ContactEmail.Trim(),
            Description = dto.Description?.Trim(),
            ApiKeyHash = hash,
            ApiKeyPrefix = prefix,
            Scopes = NormalizeScopes(dto.Scopes),
            RateLimitPerMinute = dto.RateLimitPerMinute is > 0 ? dto.RateLimitPerMinute.Value : 60,
            IsSandbox = dto.IsSandbox ?? true,
            AllowedIpCidrs = SerializeCidrs(dto.AllowedIpCidrs),
            Status = ApiPartnerStatus.Pending,
            CreatedBy = createdByUserId
        };

        _db.ApiPartners.Add(partner);
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("ApiPartner registered: {Id} ({Prefix}...)", partner.Id, prefix);
        return (partner, raw);
    }

    public async Task<(ApiPartner Partner, string NewPlaintextKey)> RotateKeyAsync(Guid id, CancellationToken ct)
    {
        var partner = await RequireAsync(id, ct);
        var (raw, hash, prefix) = GenerateKey();
        var now = DateTime.UtcNow;
        partner.ApiKeyHash = hash;
        partner.ApiKeyPrefix = prefix;
        partner.UpdatedAt = now;
        var activeTokens = await _db.ApiPartnerAccessTokens
            .IgnoreQueryFilters()
            .Where(token => token.TenantId == partner.TenantId
                && token.PartnerId == partner.Id
                && token.RevokedAt == null)
            .ToListAsync(ct);
        foreach (var token in activeTokens)
        {
            token.RevokedAt = now;
        }
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation(
            "ApiPartner key rotated and {TokenCount} active OAuth tokens revoked: {Id}",
            activeTokens.Count,
            id);
        return (partner, raw);
    }

    public async Task<ApiPartner> SuspendAsync(Guid id, CancellationToken ct)
    {
        var partner = await RequireAsync(id, ct);
        if (partner.Status == ApiPartnerStatus.Revoked)
            throw new InvalidOperationException("Cannot suspend a revoked partner");
        partner.Status = ApiPartnerStatus.Suspended;
        partner.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return partner;
    }

    public async Task<ApiPartner> ReactivateAsync(Guid id, CancellationToken ct)
    {
        var partner = await RequireAsync(id, ct);
        if (partner.Status == ApiPartnerStatus.Revoked)
            throw new InvalidOperationException("Cannot reactivate a revoked partner");
        partner.Status = ApiPartnerStatus.Active;
        partner.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return partner;
    }

    public async Task<ApiPartner> RevokeAsync(Guid id, string reason, CancellationToken ct)
    {
        var partner = await RequireAsync(id, ct);
        partner.Status = ApiPartnerStatus.Revoked;
        partner.RevokedAt = DateTime.UtcNow;
        partner.RevokedReason = string.IsNullOrWhiteSpace(reason) ? "Revoked" : reason.Trim();
        partner.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return partner;
    }

    public async Task<ApiPartner> UpdateAsync(Guid id, UpdateApiPartnerDto dto, CancellationToken ct)
    {
        var partner = await RequireAsync(id, ct);
        if (!string.IsNullOrWhiteSpace(dto.Name)) partner.Name = dto.Name.Trim();
        if (!string.IsNullOrWhiteSpace(dto.ContactEmail)) partner.ContactEmail = dto.ContactEmail.Trim();
        if (dto.Description != null) partner.Description = dto.Description.Trim();
        if (!string.IsNullOrWhiteSpace(dto.Scopes)) partner.Scopes = NormalizeScopes(dto.Scopes);
        if (dto.RateLimitPerMinute is > 0) partner.RateLimitPerMinute = dto.RateLimitPerMinute.Value;
        if (dto.IsSandbox.HasValue) partner.IsSandbox = dto.IsSandbox.Value;
        if (dto.AllowedIpCidrs is not null) partner.AllowedIpCidrs = SerializeCidrs(dto.AllowedIpCidrs);
        partner.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return partner;
    }

    /// <summary>Validate a raw plaintext key. Returns the partner if valid + active.</summary>
    public async Task<ApiPartner?> ValidateKeyAsync(string rawKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(rawKey)) return null;
        var hash = HashKey(rawKey);
        var partner = await _db.ApiPartners
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.ApiKeyHash == hash, ct);
        if (partner == null || partner.Status != ApiPartnerStatus.Active) return null;
        partner.LastUsedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return partner;
    }

    private async Task<ApiPartner> RequireAsync(Guid id, CancellationToken ct)
    {
        var partner = await _db.ApiPartners.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (partner == null) throw new KeyNotFoundException($"ApiPartner {id} not found");
        return partner;
    }

    private static (string Raw, string Hash, string Prefix) GenerateKey()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        var raw = "nxp_" + Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');
        return (raw, HashKey(raw), raw[..8]);
    }

    private static string HashKey(string raw)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string NormalizeScopes(string? scopes)
    {
        if (string.IsNullOrWhiteSpace(scopes)) return "read";
        var parts = scopes.Split(new[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.ToLowerInvariant())
            .Distinct()
            .ToArray();
        return parts.Length == 0 ? "read" : string.Join(",", parts);
    }

    private static string? SerializeCidrs(IReadOnlyCollection<string>? cidrs)
    {
        if (cidrs is null)
            return null;

        var normalized = cidrs
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return normalized.Length == 0 ? null : JsonSerializer.Serialize(normalized);
    }
}

public class RegisterApiPartnerDto
{
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("contact_email")] public string ContactEmail { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("scopes")] public string? Scopes { get; set; }
    [JsonPropertyName("rate_limit_per_minute")] public int? RateLimitPerMinute { get; set; }
    [JsonPropertyName("is_sandbox")] public bool? IsSandbox { get; set; }
    [JsonPropertyName("allowed_ip_cidrs")] public string[]? AllowedIpCidrs { get; set; }
}

public class UpdateApiPartnerDto
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("contact_email")] public string? ContactEmail { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("scopes")] public string? Scopes { get; set; }
    [JsonPropertyName("rate_limit_per_minute")] public int? RateLimitPerMinute { get; set; }
    [JsonPropertyName("is_sandbox")] public bool? IsSandbox { get; set; }
    [JsonPropertyName("allowed_ip_cidrs")] public string[]? AllowedIpCidrs { get; set; }
}
