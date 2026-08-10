// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class AuthenticationConfigurationService
{
    public const string TwoFactorAllowTrustedDevices = "two_factor.allow_trusted_devices";
    public const string TwoFactorTrustedDeviceDays = "two_factor.trusted_device_days";
    public const string TwoFactorBackupCodeCount = "two_factor.backup_code_count";
    public const string PasskeysConditionalAutofill = "passkeys.conditional_autofill";
    public const string PasskeysEnrollmentEnabled = "passkeys.enrollment_enabled";
    public const string PasskeysMaxCredentials = "passkeys.max_credentials_per_user";

    private const string StoreKey = "authentication_config";
    private readonly NexusDbContext _db;

    public static readonly IReadOnlyDictionary<string, object> Defaults =
        new Dictionary<string, object>(StringComparer.Ordinal)
        {
            [TwoFactorAllowTrustedDevices] = true,
            [TwoFactorTrustedDeviceDays] = 30,
            [TwoFactorBackupCodeCount] = 10,
            [PasskeysConditionalAutofill] = true,
            [PasskeysEnrollmentEnabled] = true,
            [PasskeysMaxCredentials] = 10
        };

    public AuthenticationConfigurationService(NexusDbContext db) => _db = db;

    public async Task<Dictionary<string, object>> GetAllAsync(int tenantId, CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<string, object>(Defaults, StringComparer.Ordinal);
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key == StoreKey)
            .Select(config => config.Value)
            .SingleOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(raw))
            return result;

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                return result;

            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (Defaults.ContainsKey(property.Name) && TryReadValidValue(property.Name, property.Value, out var value))
                    result[property.Name] = value!;
            }
        }
        catch (JsonException)
        {
            // A malformed legacy value must fail back to the secure typed defaults.
        }

        return result;
    }

    public async Task UpdateAsync(
        int tenantId,
        IReadOnlyDictionary<string, object> updates,
        CancellationToken cancellationToken = default)
    {
        var settings = await GetAllAsync(tenantId, cancellationToken);
        foreach (var (key, value) in updates)
            settings[key] = value;

        var serialized = JsonSerializer.Serialize(settings);
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(config => config.TenantId == tenantId && config.Key == StoreKey, cancellationToken);
        if (row is null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = StoreKey,
                Value = serialized,
                CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            row.Value = serialized;
            row.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> GetBooleanAsync(string key, int tenantId, CancellationToken cancellationToken = default) =>
        (bool)(await GetAllAsync(tenantId, cancellationToken))[key];

    public async Task<int> GetIntegerAsync(string key, int tenantId, CancellationToken cancellationToken = default) =>
        (int)(await GetAllAsync(tenantId, cancellationToken))[key];

    public static bool TryReadValidValue(string key, JsonElement element, out object? value)
    {
        value = null;
        if (!Defaults.ContainsKey(key))
            return false;

        if (key is TwoFactorAllowTrustedDevices or PasskeysConditionalAutofill or PasskeysEnrollmentEnabled)
        {
            if (element.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return false;
            value = element.GetBoolean();
            return true;
        }

        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var integer))
            return false;

        var valid = key switch
        {
            TwoFactorTrustedDeviceDays => integer is >= 1 and <= 365,
            TwoFactorBackupCodeCount => integer is >= 1 and <= 100,
            PasskeysMaxCredentials => integer is >= 1 and <= 20,
            _ => false
        };
        if (valid)
            value = integer;
        return valid;
    }
}
