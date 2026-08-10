// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class IsolatedNodeReadinessService
{
    public const string KeyPrefix = "caring.isolated_node.";

    private static readonly string[] AllowedStatuses =
    [
        "pending",
        "in_progress",
        "decided",
        "blocked"
    ];

    private static readonly IsolatedNodeItemMeta[] SchemaRows =
    [
        new("deployment_mode", "Deployment mode", "enum",
            ["hosted_tenant", "hosted_custom_domain", "canton_isolated_node"],
            "How this deployment is hosted: shared tenant, custom domain on the shared platform, or fully isolated canton-controlled node."),
        new("hosting_owner", "Hosting owner", "text", null,
            "Organisation that runs the infrastructure (server, domain, TLS) for the node."),
        new("smtp_owner", "SMTP / outbound email owner", "text", null,
            "Who operates outbound email delivery (e.g. own SMTP relay, Postmark account, Mailjet)."),
        new("storage_owner", "Storage owner", "text", null,
            "Who owns and operates file uploads, attachments, and persistent object storage."),
        new("backup_owner", "Backup owner", "text", null,
            "Who runs daily backups, retention windows, and has restore-tested the database."),
        new("update_cadence", "Update cadence", "choice",
            ["weekly", "monthly", "quarterly", "on_demand"],
            "How often the node receives upstream NEXUS source updates."),
        new("source_release_workflow", "Source release workflow", "text", null,
            "How AGPL source updates flow into the isolated node (mirror repo, signed tags, manual review)."),
        new("telemetry_default", "Telemetry default", "choice",
            ["enabled", "disabled"],
            "Default state for outbound telemetry / error reporting on this node."),
        new("federation_key_exchange", "Federation key exchange", "text", null,
            "Whether and how this node federates with other regional nodes (key custody, exchange protocol)."),
        new("dpo_appointed", "Data-protection officer", "text", null,
            "Named DPO with contact details (FADP requirement at scale for canton-level deployments)."),
        new("incident_runbook_url", "Incident runbook URL", "url", null,
            "Link to the operational runbook for incidents (downtime, breach, key compromise, restore drill).")
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly NexusDbContext _db;

    public IsolatedNodeReadinessService(NexusDbContext db)
    {
        _db = db;
    }

    public IReadOnlyList<IsolatedNodeItemMeta> Schema => SchemaRows;

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<IsolatedNodeState> GetAsync(int tenantId, CancellationToken ct)
    {
        var stored = await LoadStoredItemsAsync(tenantId, ct);
        var items = SchemaRows
            .Select(meta => MapItem(meta, stored.GetValueOrDefault(meta.Key)))
            .ToArray();

        return new IsolatedNodeState(
            Items: items,
            Gate: BuildGate(items),
            LastUpdatedAt: items
                .Select(item => item.UpdatedAt)
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .OrderByDescending(value => value, StringComparer.Ordinal)
                .FirstOrDefault());
    }

    public async Task<IsolatedNodeMutationResult> UpdateAsync(
        int tenantId,
        string itemKey,
        IReadOnlyDictionary<string, JsonElement> payload,
        CancellationToken ct)
    {
        var meta = SchemaRows.FirstOrDefault(row => row.Key == itemKey);
        if (meta is null)
        {
            return SingleError("INVALID_ITEM_KEY", $"Unknown decision-gate item: {itemKey}", "item_key");
        }

        var stored = await LoadStoredItemsAsync(tenantId, ct);
        var existing = stored.GetValueOrDefault(itemKey);
        var next = new IsolatedNodeStoredEnvelope(
            Value: existing?.Value,
            Owner: existing?.Owner,
            Status: existing?.Status ?? "pending",
            Notes: existing?.Notes,
            UpdatedAt: existing?.UpdatedAt);

        var errors = new List<LaravelErrorRow>();

        if (payload.TryGetValue("value", out var valueElement))
        {
            var value = ValidateValue(meta, valueElement, errors);
            if (errors.Count == 0)
            {
                next = next with { Value = value };
            }
        }

        if (payload.TryGetValue("owner", out var ownerElement))
        {
            var owner = ValidateNullableString(ownerElement, "owner", 255, "INVALID_OWNER", "OWNER_TOO_LONG", errors);
            if (errors.Count == 0)
            {
                next = next with { Owner = owner };
            }
        }

        if (payload.TryGetValue("status", out var statusElement))
        {
            var status = ReadNullableString(statusElement);
            if (status is null || !AllowedStatuses.Contains(status, StringComparer.Ordinal))
            {
                errors.Add(new LaravelErrorRow(
                    "INVALID_STATUS",
                    $"Status must be one of: {string.Join(", ", AllowedStatuses)}",
                    "status"));
            }
            else
            {
                next = next with { Status = status };
            }
        }

        if (payload.TryGetValue("notes", out var notesElement))
        {
            var notes = ValidateNullableString(notesElement, "notes", 2000, "INVALID_NOTES", "NOTES_TOO_LONG", errors);
            if (errors.Count == 0)
            {
                next = next with { Notes = notes };
            }
        }

        if (errors.Count > 0)
        {
            return new IsolatedNodeMutationResult(Errors: errors);
        }

        var now = DateTime.UtcNow;
        next = next with { UpdatedAt = FormatDate(now) };
        var config = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == KeyPrefix + itemKey, ct);

        if (config is null)
        {
            config = new TenantConfig
            {
                TenantId = tenantId,
                Key = KeyPrefix + itemKey,
                CreatedAt = now
            };
            _db.TenantConfigs.Add(config);
        }

        config.Value = JsonSerializer.Serialize(next, JsonOptions);
        config.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);

        var state = await GetAsync(tenantId, ct);
        return new IsolatedNodeMutationResult(
            Item: state.Items.FirstOrDefault(item => item.Key == itemKey),
            Gate: state.Gate);
    }

    private async Task<IReadOnlyDictionary<string, IsolatedNodeStoredEnvelope>> LoadStoredItemsAsync(
        int tenantId,
        CancellationToken ct)
    {
        var configs = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(KeyPrefix))
            .ToListAsync(ct);

        var output = new Dictionary<string, IsolatedNodeStoredEnvelope>(StringComparer.Ordinal);
        foreach (var config in configs)
        {
            var key = config.Key[KeyPrefix.Length..];
            var envelope = ParseEnvelope(config.Value);
            var updatedAt = envelope.UpdatedAt ?? FormatDate(config.UpdatedAt);
            output[key] = envelope with { UpdatedAt = updatedAt };
        }

        return output;
    }

    private static IsolatedNodeItemRow MapItem(
        IsolatedNodeItemMeta meta,
        IsolatedNodeStoredEnvelope? stored)
    {
        var status = AllowedStatuses.Contains(stored?.Status, StringComparer.Ordinal)
            ? stored!.Status
            : "pending";

        return new IsolatedNodeItemRow(
            Key: meta.Key,
            Label: meta.Label,
            Type: meta.Type,
            Choices: meta.Choices,
            Help: meta.Help,
            Value: stored?.Value,
            Owner: stored?.Owner,
            Status: status,
            Notes: stored?.Notes,
            UpdatedAt: stored?.UpdatedAt);
    }

    private static IsolatedNodeGate BuildGate(IReadOnlyCollection<IsolatedNodeItemRow> items)
    {
        var counts = AllowedStatuses.ToDictionary(status => status, _ => 0, StringComparer.Ordinal);
        var blockers = new List<string>();
        var decided = 0;

        foreach (var item in items)
        {
            var status = AllowedStatuses.Contains(item.Status, StringComparer.Ordinal)
                ? item.Status
                : "pending";
            counts[status]++;

            if (status == "decided")
            {
                decided++;
            }
            else if (status == "blocked")
            {
                blockers.Add(item.Key);
            }
        }

        return new IsolatedNodeGate(
            Closed: decided == items.Count,
            DecidedCount: decided,
            TotalCount: items.Count,
            Blockers: blockers,
            StatusCounts: counts);
    }

    private static IsolatedNodeStoredEnvelope ParseEnvelope(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new IsolatedNodeStoredEnvelope(null, null, "pending", null, null);
        }

        try
        {
            return JsonSerializer.Deserialize<IsolatedNodeStoredEnvelope>(raw, JsonOptions)
                ?? new IsolatedNodeStoredEnvelope(null, null, "pending", null, null);
        }
        catch (JsonException)
        {
            return new IsolatedNodeStoredEnvelope(null, null, "pending", null, null);
        }
    }

    private static string? ValidateValue(
        IsolatedNodeItemMeta meta,
        JsonElement raw,
        List<LaravelErrorRow> errors)
    {
        if (raw.ValueKind is JsonValueKind.Null)
        {
            return null;
        }

        var value = ReadNullableString(raw);
        if (value is null)
        {
            errors.Add(new LaravelErrorRow("INVALID_VALUE", "Value must be a string.", "value"));
            return null;
        }

        if (value == string.Empty)
        {
            return null;
        }

        if (meta.Type is "enum" or "choice")
        {
            var choices = meta.Choices ?? [];
            if (!choices.Contains(value, StringComparer.Ordinal))
            {
                errors.Add(new LaravelErrorRow(
                    "INVALID_CHOICE",
                    $"Value must be one of: {string.Join(", ", choices)}",
                    "value"));
                return null;
            }

            return value;
        }

        if (meta.Type == "url")
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out _))
            {
                errors.Add(new LaravelErrorRow("INVALID_URL", "Value must be a valid URL.", "value"));
                return null;
            }

            if (value.Length > 1000)
            {
                errors.Add(new LaravelErrorRow("URL_TOO_LONG", "Value is too long.", "value"));
                return null;
            }

            return value;
        }

        if (value.Length > 1000)
        {
            errors.Add(new LaravelErrorRow("VALUE_TOO_LONG", "Value is too long.", "value"));
            return null;
        }

        return value;
    }

    private static string? ValidateNullableString(
        JsonElement raw,
        string field,
        int maxLength,
        string invalidCode,
        string tooLongCode,
        List<LaravelErrorRow> errors)
    {
        if (raw.ValueKind is JsonValueKind.Null)
        {
            return null;
        }

        var value = ReadNullableString(raw);
        if (value is null)
        {
            errors.Add(new LaravelErrorRow(invalidCode, $"{field} must be a string.", field));
            return null;
        }

        if (value.Length > maxLength)
        {
            errors.Add(new LaravelErrorRow(tooLongCode, $"{field} is too long.", field));
            return null;
        }

        return value == string.Empty ? null : value;
    }

    private static string? ReadNullableString(JsonElement element)
    {
        return element.ValueKind == JsonValueKind.String
            ? element.GetString()?.Trim()
            : null;
    }

    private static IsolatedNodeMutationResult SingleError(string code, string message, string? field)
    {
        return new IsolatedNodeMutationResult(Errors: [new LaravelErrorRow(code, message, field)]);
    }

    private static string? FormatDate(DateTime? value)
    {
        return value?.ToUniversalTime().ToString("O");
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

public sealed record IsolatedNodeItemMeta(
    string Key,
    string Label,
    string Type,
    IReadOnlyList<string>? Choices,
    string Help);

public sealed record IsolatedNodeStoredEnvelope(
    [property: JsonPropertyName("value")] string? Value,
    [property: JsonPropertyName("owner")] string? Owner,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("updated_at")] string? UpdatedAt);

public sealed record IsolatedNodeState(
    [property: JsonPropertyName("items")] IReadOnlyList<IsolatedNodeItemRow> Items,
    [property: JsonPropertyName("gate")] IsolatedNodeGate Gate,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt);

public sealed record IsolatedNodeItemRow(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("choices")] IReadOnlyList<string>? Choices,
    [property: JsonPropertyName("help")] string Help,
    [property: JsonPropertyName("value")] string? Value,
    [property: JsonPropertyName("owner")] string? Owner,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("updated_at")] string? UpdatedAt);

public sealed record IsolatedNodeGate(
    [property: JsonPropertyName("closed")] bool Closed,
    [property: JsonPropertyName("decided_count")] int DecidedCount,
    [property: JsonPropertyName("total_count")] int TotalCount,
    [property: JsonPropertyName("blockers")] IReadOnlyList<string> Blockers,
    [property: JsonPropertyName("status_counts")] IReadOnlyDictionary<string, int> StatusCounts);

public sealed record IsolatedNodeMutationResult(
    IsolatedNodeItemRow? Item = null,
    IsolatedNodeGate? Gate = null,
    IReadOnlyList<LaravelErrorRow>? Errors = null);
