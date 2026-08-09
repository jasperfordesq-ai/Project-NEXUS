// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class OperatingPolicyService
{
    public const string KeyPrefix = "caring.operating_policy.";

    private static readonly IReadOnlyDictionary<string, OperatingPolicyFieldDefinition> FieldDefinitions =
        new Dictionary<string, OperatingPolicyFieldDefinition>(StringComparer.Ordinal)
        {
            ["approval_authority"] = OperatingPolicyFieldDefinition.Enum(
                "admin",
                ["admin", "coordinator", "mutual"]),
            ["trusted_reviewer_threshold"] = OperatingPolicyFieldDefinition.Int(5, 1, 200),
            ["sla_first_response_hours"] = OperatingPolicyFieldDefinition.Int(24, 1, 168),
            ["sla_help_request_hours"] = OperatingPolicyFieldDefinition.Int(72, 1, 336),
            ["legacy_hour_settlement"] = OperatingPolicyFieldDefinition.Enum(
                "transfer_to_beneficiary",
                ["transfer_to_beneficiary", "donate_to_solidarity", "expire"]),
            ["reciprocal_balance_threshold_hours"] = OperatingPolicyFieldDefinition.Int(40, 0, 500),
            ["safeguarding_escalation_user_id"] = OperatingPolicyFieldDefinition.IntNullable(null, 1, null),
            ["chf_hourly_rate"] = OperatingPolicyFieldDefinition.Float(35m, 0m, 500m),
            ["chf_prevention_multiplier"] = OperatingPolicyFieldDefinition.Float(2m, 1m, 10m),
            ["statement_cadence"] = OperatingPolicyFieldDefinition.Enum(
                "quarterly",
                ["monthly", "quarterly", "annual"]),
            ["policy_appendix_url"] = OperatingPolicyFieldDefinition.UrlNullable()
        };

    private readonly NexusDbContext _db;

    public OperatingPolicyService(NexusDbContext db)
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

    public async Task<OperatingPolicyView> GetAsync(int tenantId, CancellationToken ct)
    {
        var stored = await LoadStoredValuesAsync(tenantId, ct);
        var policy = new Dictionary<string, object?>(StringComparer.Ordinal);

        foreach (var (field, definition) in FieldDefinitions)
        {
            policy[field] = Cast(stored.GetValueOrDefault(field), definition);
        }

        return new OperatingPolicyView(
            Policy: policy,
            Schema: FieldDefinitions.ToDictionary(
                pair => pair.Key,
                pair => pair.Value.ToSchema(),
                StringComparer.Ordinal),
            LastUpdatedAt: await LatestUpdatedAtAsync(tenantId, ct));
    }

    public async Task<OperatingPolicyUpdateResult> UpdateAsync(
        int tenantId,
        JsonElement payload,
        CancellationToken ct)
    {
        var errors = new List<LaravelErrorRow>();
        var sanitized = new Dictionary<string, object?>(StringComparer.Ordinal);

        if (payload.ValueKind != JsonValueKind.Object)
        {
            return new OperatingPolicyUpdateResult(
                Errors: [new LaravelErrorRow("VALIDATION_ERROR", "Payload must be an object.")]);
        }

        foreach (var property in payload.EnumerateObject())
        {
            if (!FieldDefinitions.TryGetValue(property.Name, out var definition))
            {
                continue;
            }

            var valid = Validate(property.Name, property.Value, definition, errors);
            if (valid.Accepted)
            {
                sanitized[property.Name] = valid.Value;
            }
        }

        if (errors.Count > 0)
        {
            return new OperatingPolicyUpdateResult(Errors: errors);
        }

        var now = DateTime.UtcNow;
        foreach (var (field, value) in sanitized)
        {
            await UpsertSettingAsync(tenantId, KeyPrefix + field, Serialize(value, FieldDefinitions[field]), now, ct);
        }

        var view = await GetAsync(tenantId, ct);
        return new OperatingPolicyUpdateResult(Policy: view.Policy);
    }

    private async Task<IReadOnlyDictionary<string, string?>> LoadStoredValuesAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(KeyPrefix))
            .ToListAsync(ct);

        return rows.ToDictionary(
            row => row.Key[KeyPrefix.Length..],
            row => string.IsNullOrEmpty(row.Value) ? null : row.Value,
            StringComparer.Ordinal);
    }

    private async Task<string?> LatestUpdatedAtAsync(int tenantId, CancellationToken ct)
    {
        var latest = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(KeyPrefix))
            .OrderByDescending(c => c.UpdatedAt)
            .Select(c => c.UpdatedAt)
            .FirstOrDefaultAsync(ct);

        return latest?.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    }

    private async Task UpsertSettingAsync(
        int tenantId,
        string key,
        string value,
        DateTime now,
        CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key, ct);

        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                CreatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }

        row.Value = value;
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private static object? Cast(string? stored, OperatingPolicyFieldDefinition definition)
    {
        if (string.IsNullOrWhiteSpace(stored))
        {
            return definition.DefaultValue;
        }

        return definition.Type switch
        {
            "int" or "int_nullable" => int.TryParse(stored, NumberStyles.Integer, CultureInfo.InvariantCulture, out var intValue)
                ? intValue
                : definition.DefaultValue,
            "float" => decimal.TryParse(stored, NumberStyles.Number, CultureInfo.InvariantCulture, out var decimalValue)
                ? decimalValue
                : definition.DefaultValue,
            "enum" => definition.Choices.Contains(stored, StringComparer.Ordinal)
                ? stored
                : definition.DefaultValue,
            "url_nullable" => stored,
            _ => stored
        };
    }

    private static OperatingPolicyValidatedValue Validate(
        string field,
        JsonElement raw,
        OperatingPolicyFieldDefinition definition,
        List<LaravelErrorRow> errors)
    {
        if ((definition.Type == "int_nullable" || definition.Type == "url_nullable") && IsNullish(raw))
        {
            return new OperatingPolicyValidatedValue(true, null);
        }

        switch (definition.Type)
        {
            case "int":
            case "int_nullable":
                if (!TryReadInt(raw, out var intValue))
                {
                    errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "must be an integer", field));
                    return OperatingPolicyValidatedValue.Rejected;
                }

                if (definition.Min is not null && intValue < definition.Min.Value)
                {
                    errors.Add(new LaravelErrorRow("VALIDATION_ERROR", $"must be >= {definition.Min.Value}", field));
                    return OperatingPolicyValidatedValue.Rejected;
                }

                if (definition.Max is not null && intValue > definition.Max.Value)
                {
                    errors.Add(new LaravelErrorRow("VALIDATION_ERROR", $"must be <= {definition.Max.Value}", field));
                    return OperatingPolicyValidatedValue.Rejected;
                }

                return new OperatingPolicyValidatedValue(true, intValue);

            case "float":
                if (!TryReadDecimal(raw, out var decimalValue))
                {
                    errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "must be numeric", field));
                    return OperatingPolicyValidatedValue.Rejected;
                }

                if (definition.Min is not null && decimalValue < definition.Min.Value)
                {
                    errors.Add(new LaravelErrorRow("VALIDATION_ERROR", $"must be >= {definition.Min.Value}", field));
                    return OperatingPolicyValidatedValue.Rejected;
                }

                if (definition.Max is not null && decimalValue > definition.Max.Value)
                {
                    errors.Add(new LaravelErrorRow("VALIDATION_ERROR", $"must be <= {definition.Max.Value}", field));
                    return OperatingPolicyValidatedValue.Rejected;
                }

                return new OperatingPolicyValidatedValue(true, decimalValue);

            case "enum":
                var text = ElementToString(raw);
                if (text is null || !definition.Choices.Contains(text, StringComparer.Ordinal))
                {
                    errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "invalid choice", field));
                    return OperatingPolicyValidatedValue.Rejected;
                }

                return new OperatingPolicyValidatedValue(true, text);

            case "url_nullable":
                var url = ElementToString(raw)?.Trim() ?? string.Empty;
                if (!Uri.TryCreate(url, UriKind.Absolute, out _))
                {
                    errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "must be a valid URL", field));
                    return OperatingPolicyValidatedValue.Rejected;
                }

                return new OperatingPolicyValidatedValue(true, url);
        }

        return OperatingPolicyValidatedValue.Rejected;
    }

    private static string Serialize(object? value, OperatingPolicyFieldDefinition definition)
    {
        if (value is null)
        {
            return string.Empty;
        }

        return definition.Type switch
        {
            "int" or "int_nullable" => Convert.ToInt32(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture),
            "float" => Convert.ToDecimal(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture),
            _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty
        };
    }

    private static bool IsNullish(JsonElement element)
    {
        return element.ValueKind == JsonValueKind.Null
            || (element.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(element.GetString()));
    }

    private static bool TryReadInt(JsonElement element, out int value)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out value))
        {
            return true;
        }

        if (element.ValueKind == JsonValueKind.String
            && int.TryParse(element.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
        {
            return true;
        }

        value = 0;
        return false;
    }

    private static bool TryReadDecimal(JsonElement element, out decimal value)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetDecimal(out value))
        {
            return true;
        }

        if (element.ValueKind == JsonValueKind.String
            && decimal.TryParse(element.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out value))
        {
            return true;
        }

        value = 0;
        return false;
    }

    private static string? ElementToString(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => null,
            _ => element.GetRawText()
        };
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

public sealed record OperatingPolicyView(
    [property: JsonPropertyName("policy")] IReadOnlyDictionary<string, object?> Policy,
    [property: JsonPropertyName("schema")] IReadOnlyDictionary<string, OperatingPolicySchemaField> Schema,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt);

public sealed record OperatingPolicyUpdateResult(
    IReadOnlyDictionary<string, object?>? Policy = null,
    IReadOnlyList<LaravelErrorRow>? Errors = null);

public sealed record OperatingPolicySchemaField(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("default")] object? Default,
    [property: JsonPropertyName("choices")] IReadOnlyList<string>? Choices = null,
    [property: JsonPropertyName("min")] decimal? Min = null,
    [property: JsonPropertyName("max")] decimal? Max = null);

internal sealed record OperatingPolicyFieldDefinition(
    string Type,
    object? DefaultValue,
    IReadOnlyList<string> Choices,
    decimal? Min,
    decimal? Max)
{
    public static OperatingPolicyFieldDefinition Enum(string defaultValue, IReadOnlyList<string> choices) =>
        new("enum", defaultValue, choices, null, null);

    public static OperatingPolicyFieldDefinition Int(int defaultValue, int min, int max) =>
        new("int", defaultValue, [], min, max);

    public static OperatingPolicyFieldDefinition IntNullable(int? defaultValue, int? min, int? max) =>
        new("int_nullable", defaultValue, [], min, max);

    public static OperatingPolicyFieldDefinition Float(decimal defaultValue, decimal min, decimal max) =>
        new("float", defaultValue, [], min, max);

    public static OperatingPolicyFieldDefinition UrlNullable() =>
        new("url_nullable", null, [], null, null);

    public OperatingPolicySchemaField ToSchema()
    {
        return new OperatingPolicySchemaField(
            Type,
            DefaultValue,
            Choices.Count > 0 ? Choices : null,
            Min,
            Max);
    }
}

internal sealed record OperatingPolicyValidatedValue(bool Accepted, object? Value)
{
    public static readonly OperatingPolicyValidatedValue Rejected = new(false, null);
}
