// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringInviteCodeService
{
    private const int CodeLength = 6;
    private const int MaxRetries = 10;
    private const int ListLimit = 20;
    private const string CodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private readonly NexusDbContext _db;

    public CaringInviteCodeService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<IReadOnlyList<CaringInviteCodeListRow>> ListAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.CaringInviteCodes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .OrderByDescending(c => c.CreatedAt)
            .Take(ListLimit)
            .ToListAsync(ct);

        var users = await LoadUsedByUsersAsync(tenantId, rows.Select(row => row.UsedByUserId), ct);
        var tenant = await LoadTenantAsync(tenantId, ct);
        var inviteBase = BuildInviteUrlBase(tenant);

        return rows.Select(row => MapListRow(row, users, inviteBase)).ToArray();
    }

    public async Task<CaringInviteCodeGenerateResult> GenerateAsync(
        int tenantId,
        int createdByUserId,
        CaringInviteCodeGenerateRequest request,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var expiresDays = Math.Max(1, Math.Min(365, request.ExpiresDays ?? 30));
        var code = await GenerateUniqueCodeAsync(tenantId, ct);
        var row = new CaringInviteCode
        {
            TenantId = tenantId,
            Code = code,
            Label = TrimToNull(request.Label, 200),
            CreatedByUserId = createdByUserId,
            ExpiresAt = now.AddDays(expiresDays),
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringInviteCodes.Add(row);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new CaringInviteCodeGenerateResult(false, null);
        }

        var tenant = await LoadTenantAsync(tenantId, ct);
        return new CaringInviteCodeGenerateResult(
            true,
            new CaringInviteCodeCreatedRow(
                row.Id,
                row.Code,
                row.Label,
                FormatRequiredDate(row.ExpiresAt),
                BuildInviteUrl(tenant, row.Code)));
    }

    public async Task<CaringInviteCodeLookupRow> LookupAsync(
        int tenantId,
        string code,
        CancellationToken ct)
    {
        var normalized = code.Trim().ToUpperInvariant();
        var tenant = await LoadTenantAsync(tenantId, ct);
        var tenantName = tenant?.Name ?? string.Empty;
        var enabled = await IsFeatureEnabledAsync(tenantId, ct);

        if (normalized.Length == 0)
        {
            return InvalidLookup(tenantName, enabled);
        }

        var row = await _db.CaringInviteCodes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Code == normalized, ct);

        if (row is null)
        {
            return InvalidLookup(tenantName, enabled);
        }

        var now = DateTime.UtcNow;
        var isUsed = row.UsedAt is not null;
        var isExpired = row.ExpiresAt <= now;

        return new CaringInviteCodeLookupRow(
            Valid: !isUsed && !isExpired,
            Expired: isExpired && !isUsed,
            AlreadyUsed: isUsed,
            TenantName: tenantName,
            CaringCommunityEnabled: enabled);
    }

    private async Task<string> GenerateUniqueCodeAsync(int tenantId, CancellationToken ct)
    {
        for (var attempt = 0; attempt < MaxRetries; attempt++)
        {
            var candidate = GenerateCode(CodeLength);
            var exists = await _db.CaringInviteCodes
                .IgnoreQueryFilters()
                .AnyAsync(c => c.TenantId == tenantId && c.Code == candidate, ct);

            if (!exists)
            {
                return candidate;
            }
        }

        return Convert.ToHexString(RandomNumberGenerator.GetBytes(5));
    }

    private static string GenerateCode(int length)
    {
        var chars = new char[length];
        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = CodeChars[RandomNumberGenerator.GetInt32(CodeChars.Length)];
        }

        return new string(chars);
    }

    private async Task<IReadOnlyDictionary<int, User>> LoadUsedByUsersAsync(
        int tenantId,
        IEnumerable<int?> userIds,
        CancellationToken ct)
    {
        var ids = userIds
            .Where(id => id is > 0)
            .Select(id => id!.Value)
            .Distinct()
            .ToArray();

        if (ids.Length == 0)
        {
            return new Dictionary<int, User>();
        }

        return await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);
    }

    private async Task<Tenant?> LoadTenantAsync(int tenantId, CancellationToken ct)
    {
        return await _db.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
    }

    private static CaringInviteCodeListRow MapListRow(
        CaringInviteCode row,
        IReadOnlyDictionary<int, User> users,
        string inviteBase)
    {
        User? usedBy = null;
        if (row.UsedByUserId.HasValue)
        {
            users.TryGetValue(row.UsedByUserId.Value, out usedBy);
        }

        var status = row.UsedAt is not null
            ? "used"
            : row.ExpiresAt <= DateTime.UtcNow
                ? "expired"
                : "active";

        return new CaringInviteCodeListRow(
            row.Id,
            row.Code,
            TrimToNull(row.Label, 200),
            FormatRequiredDate(row.ExpiresAt),
            FormatDate(row.UsedAt),
            DisplayName(usedBy),
            status,
            FormatRequiredDate(row.CreatedAt),
            inviteBase + row.Code);
    }

    private static string BuildInviteUrl(Tenant? tenant, string code)
    {
        return BuildInviteUrlBase(tenant) + code;
    }

    private static string BuildInviteUrlBase(Tenant? tenant)
    {
        if (!string.IsNullOrWhiteSpace(tenant?.Domain))
        {
            var domain = tenant.Domain.Trim().TrimEnd('/');
            var baseUrl = domain.Contains("://", StringComparison.Ordinal)
                ? domain
                : $"https://{domain}";
            return $"{baseUrl}/join/";
        }

        if (!string.IsNullOrWhiteSpace(tenant?.Slug))
        {
            return $"/{tenant.Slug.Trim().Trim('/')}/join/";
        }

        return "/join/";
    }

    private static CaringInviteCodeLookupRow InvalidLookup(string tenantName, bool enabled)
    {
        return new CaringInviteCodeLookupRow(
            Valid: false,
            Expired: false,
            AlreadyUsed: false,
            TenantName: tenantName,
            CaringCommunityEnabled: enabled);
    }

    private static string? DisplayName(User? user)
    {
        if (user is null)
        {
            return null;
        }

        var fullName = $"{user.FirstName} {user.LastName}".Trim();
        return fullName.Length > 0 ? fullName : null;
    }

    private static string? TrimToNull(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private static string? FormatDate(DateTime? value)
    {
        return value?.ToUniversalTime().ToString("O");
    }

    private static string FormatRequiredDate(DateTime value)
    {
        return value.ToUniversalTime().ToString("O");
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }
}

public sealed class CaringInviteCodeGenerateRequest
{
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("expires_days")] public int? ExpiresDays { get; set; }
}

public sealed record CaringInviteCodeCreatedRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("label")] string? Label,
    [property: JsonPropertyName("expires_at")] string ExpiresAt,
    [property: JsonPropertyName("invite_url")] string InviteUrl);

public sealed record CaringInviteCodeListRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("label")] string? Label,
    [property: JsonPropertyName("expires_at")] string ExpiresAt,
    [property: JsonPropertyName("used_at")] string? UsedAt,
    [property: JsonPropertyName("used_by")] string? UsedBy,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("created_at")] string CreatedAt,
    [property: JsonPropertyName("invite_url")] string InviteUrl);

public sealed record CaringInviteCodeLookupRow(
    [property: JsonPropertyName("valid")] bool Valid,
    [property: JsonPropertyName("expired")] bool Expired,
    [property: JsonPropertyName("already_used")] bool AlreadyUsed,
    [property: JsonPropertyName("tenant_name")] string TenantName,
    [property: JsonPropertyName("caring_community_enabled")] bool CaringCommunityEnabled);

public sealed record CaringInviteCodeGenerateResult(
    bool Success,
    CaringInviteCodeCreatedRow? Code);
