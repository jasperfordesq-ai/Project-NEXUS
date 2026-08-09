// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net.Mail;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class PilotDisclosurePackService
{
    public const string SettingKey = "caring.disclosure_pack";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly NexusDbContext _db;

    public PilotDisclosurePackService(NexusDbContext db, TenantContext tenantContext)
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

    public async Task<DisclosurePackView> GetAsync(int tenantId, CancellationToken ct)
    {
        var stored = await LoadStoredAsync(tenantId, ct);
        var pack = MergeDeep(Defaults(), stored);

        return new DisclosurePackView(
            Pack: pack,
            LastUpdatedAt: await LatestUpdatedAtAsync(tenantId, ct),
            IsCustomised: stored.Count > 0);
    }

    public async Task<DisclosurePackUpdateResult> UpdateAsync(
        int tenantId,
        DisclosurePackUpdateRequest? request,
        CancellationToken ct)
    {
        var payload = request?.ToPayload() ?? new JsonObject();
        var errors = Validate(payload);
        if (errors.Count > 0)
        {
            return new DisclosurePackUpdateResult(Errors: errors);
        }

        var merged = MergeDeep(Defaults(), MergeDeep(await LoadStoredAsync(tenantId, ct), payload));
        await SaveAsync(tenantId, merged, ct);

        return new DisclosurePackUpdateResult(Pack: merged);
    }

    public async Task<string> RenderMarkdownAsync(int tenantId, CancellationToken ct)
    {
        var view = await GetAsync(tenantId, ct);
        var pack = view.Pack;
        var lines = new List<string>
        {
            "# Swiss FADP / nDSG Disclosure Pack",
            "_Pilot disclosure document - review with counsel before publishing._",
            "",
            "## 1. Controller",
            Kv(pack["controller"] as JsonObject),
            "",
            "## 2. Processor",
            Kv(WithoutKeys(pack["processor"] as JsonObject, "sub_processors")),
            "",
            "### Sub-processors"
        };

        foreach (var item in AsList(pack["processor"]?["sub_processors"]))
        {
            lines.Add("- " + item);
        }

        lines.AddRange(
        [
            "",
            "## 3. Data categories"
        ]);
        if (pack["data_categories"] is JsonObject categories)
        {
            foreach (var (key, value) in categories)
            {
                lines.Add($"- **{key}**: {string.Join(", ", AsList(value))}");
            }
        }

        lines.AddRange(
        [
            "",
            "## 4. Lawful basis",
            Kv(pack["lawful_basis"] as JsonObject),
            "",
            "## 5. Retention defaults",
            Kv(pack["retention_defaults"] as JsonObject),
            "",
            "## 6. Data subject rights",
            Kv(pack["data_subject_rights"] as JsonObject),
            "",
            "## 7. Federation policy",
            Kv(pack["federation"] as JsonObject),
            "",
            "## 8. Isolated-node deployment option",
            Kv(pack["isolated_node"] as JsonObject),
            "",
            "## 9. Incident response",
            Kv(pack["incident_response"] as JsonObject),
            "",
            "## 10. Cross-border transfers",
            Kv(WithoutKeys(pack["cross_border_transfers"] as JsonObject, "destinations", "safeguards")),
            "### Destinations"
        ]);

        foreach (var item in AsList(pack["cross_border_transfers"]?["destinations"]))
        {
            lines.Add("- " + item);
        }

        lines.Add("### Safeguards");
        foreach (var item in AsList(pack["cross_border_transfers"]?["safeguards"]))
        {
            lines.Add("- " + item);
        }

        lines.AddRange(
        [
            "",
            "## 11. Amendments",
            Kv(pack["amendments"] as JsonObject),
            "",
            $"_Generated {DateTime.UtcNow:O} from tenant ID {tenantId}. Review with FADP/nDSG counsel before publication._"
        ]);

        return string.Join("\n", lines);
    }

    private static List<DisclosurePackValidationError> Validate(JsonObject payload)
    {
        var errors = new List<DisclosurePackValidationError>();

        var incidentEmail = StringAt(payload, "incident_response", "contact_email");
        if (!string.IsNullOrEmpty(incidentEmail) && !IsValidEmail(incidentEmail))
        {
            errors.Add(new DisclosurePackValidationError(
                "incident_response.contact_email",
                "must be a valid email"));
        }

        if (TryGetNode(payload, "incident_response", "notification_window_hours", out var windowNode))
        {
            var window = NumericValue(windowNode);
            if (window is null || window < 1 || window > 720)
            {
                errors.Add(new DisclosurePackValidationError(
                    "incident_response.notification_window_hours",
                    "must be 1-720"));
            }
        }

        var controllerEmail = StringAt(payload, "controller", "contact_email");
        if (!string.IsNullOrEmpty(controllerEmail) && !IsValidEmail(controllerEmail))
        {
            errors.Add(new DisclosurePackValidationError(
                "controller.contact_email",
                "must be a valid email"));
        }

        return errors;
    }

    private async Task<JsonObject> LoadStoredAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == SettingKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrWhiteSpace(raw))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(raw) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private async Task<string?> LatestUpdatedAtAsync(int tenantId, CancellationToken ct)
    {
        var updatedAt = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == SettingKey)
            .Select(c => c.UpdatedAt)
            .FirstOrDefaultAsync(ct);

        return updatedAt?.ToString("O", CultureInfo.InvariantCulture);
    }

    private async Task SaveAsync(int tenantId, JsonObject pack, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (existing is null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = SettingKey,
                Value = pack.ToJsonString(JsonOptions),
                CreatedAt = now,
                UpdatedAt = now
            });
            await _db.SaveChangesAsync(ct);
            return;
        }

        existing.Value = pack.ToJsonString(JsonOptions);
        existing.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private static JsonObject Defaults()
    {
        return Obj(
            ("controller", Obj(
                ("name", ""),
                ("address", ""),
                ("contact_email", ""),
                ("data_protection_officer", ""))),
            ("processor", Obj(
                ("name", "Project NEXUS / Jasper Ford"),
                ("address", ""),
                ("contact_email", "funding@hour-timebank.ie"),
                ("sub_processors", Arr(
                    "Microsoft Azure (hosting, EU)",
                    "Cloudflare (CDN / WAF)",
                    "Stripe (payments + identity verification)",
                    "OpenAI (matching & summarisation, optional)",
                    "Google Firebase Cloud Messaging (push notifications)")))),
            ("data_categories", Obj(
                ("identity", Arr("name", "email", "phone", "date_of_birth")),
                ("profile", Arr("biography", "photo", "skills", "preferred_language")),
                ("caring", Arr("help_requests", "support_relationships", "caregiver_links")),
                ("time_credits", Arr("transactions", "volunteer_logs", "wallet_balance")),
                ("communications", Arr("messages", "notifications", "announcements")),
                ("safeguarding", Arr("reports", "flags", "verification_status")),
                ("research_consent", Arr("flag", "aggregate_dataset_inclusion")))),
            ("lawful_basis", Obj(
                ("identity", "contract"),
                ("profile", "consent"),
                ("caring", "contract"),
                ("time_credits", "contract"),
                ("communications", "contract"),
                ("safeguarding", "legitimate_interest"),
                ("research_consent", "consent"))),
            ("retention_defaults", Obj(
                ("active_account_data", "lifetime_of_membership"),
                ("inactive_account_data", "24_months_then_anonymise"),
                ("transactions", "10_years_after_completion"),
                ("help_requests", "24_months_after_closure"),
                ("safeguarding_reports", "7_years_after_resolution"),
                ("communications", "24_months"),
                ("research_datasets", "duration_of_research_partnership"))),
            ("data_subject_rights", Obj(
                ("access", true),
                ("export", true),
                ("rectify", true),
                ("erase", true),
                ("restrict", true),
                ("object", true),
                ("portability", true),
                ("export_format", "json+csv"))),
            ("federation", Obj(
                ("enabled", false),
                ("aggregate_policy", "no_personal_data_shared_outside_tenant"),
                ("opt_out", true))),
            ("isolated_node", Obj(
                ("available", true),
                ("description", "Canton-controlled deployment with own SMTP, storage, and backups. Federation can be disabled entirely."),
                ("hosting_owner", ""),
                ("smtp_owner", ""),
                ("storage_owner", ""),
                ("backup_owner", ""),
                ("update_cadence", "monthly"))),
            ("incident_response", Obj(
                ("owner_name", ""),
                ("contact_email", ""),
                ("notification_window_hours", 72),
                ("fadp_authority", "Eidgen\u00f6ssischer Datenschutz- und \u00d6ffentlichkeitsbeauftragter (ED\u00d6B)"))),
            ("cross_border_transfers", Obj(
                ("occurs", true),
                ("destinations", Arr("EU (Microsoft Azure)", "US (Cloudflare, Stripe, OpenAI)")),
                ("safeguards", Arr("Standard Contractual Clauses (SCCs)", "Swiss-US Data Privacy Framework where applicable")))),
            ("amendments", Obj(
                ("last_reviewed_at", null),
                ("reviewer", ""),
                ("next_review_due", null))));
    }

    private static JsonObject MergeDeep(JsonObject baseObject, JsonObject overrides)
    {
        foreach (var (key, value) in overrides)
        {
            if (value is JsonObject overrideObject
                && baseObject[key] is JsonObject baseChild)
            {
                MergeDeep(baseChild, overrideObject);
                continue;
            }

            baseObject[key] = value?.DeepClone();
        }

        return baseObject;
    }

    private static JsonObject Obj(params (string Key, object? Value)[] values)
    {
        var obj = new JsonObject();
        foreach (var (key, value) in values)
        {
            obj[key] = ToNode(value);
        }

        return obj;
    }

    private static JsonArray Arr(params string[] values)
    {
        var arr = new JsonArray();
        foreach (var value in values)
        {
            arr.Add(value);
        }

        return arr;
    }

    private static JsonNode? ToNode(object? value)
    {
        if (value is null)
        {
            return null;
        }

        if (value is JsonNode node)
        {
            return node.DeepClone();
        }

        if (value is JsonElement element)
        {
            return JsonNode.Parse(element.GetRawText());
        }

        return JsonSerializer.SerializeToNode(value, JsonOptions);
    }

    private static JsonObject WithoutKeys(JsonObject? obj, params string[] keys)
    {
        var clone = obj?.DeepClone() as JsonObject ?? new JsonObject();
        foreach (var key in keys)
        {
            clone.Remove(key);
        }

        return clone;
    }

    private static string Kv(JsonObject? data)
    {
        if (data is null)
        {
            return string.Empty;
        }

        var lines = new List<string>();
        foreach (var (key, value) in data)
        {
            lines.Add($"- **{key}**: {ValueToString(value)}");
        }

        return string.Join("\n", lines);
    }

    private static IReadOnlyList<string> AsList(JsonNode? node)
    {
        if (node is not JsonArray array)
        {
            return [];
        }

        return array.Select(ValueToString).ToArray();
    }

    private static string ValueToString(JsonNode? node)
    {
        if (node is null)
        {
            return "_(unset)_";
        }

        if (node is JsonValue value)
        {
            if (value.TryGetValue<string>(out var text))
            {
                return string.IsNullOrEmpty(text) ? "_(unset)_" : text;
            }

            if (value.TryGetValue<bool>(out var boolean))
            {
                return boolean ? "true" : "false";
            }
        }

        return node.ToJsonString(JsonOptions);
    }

    private static string? StringAt(JsonObject payload, string section, string key)
    {
        return TryGetNode(payload, section, key, out var node) && node is JsonValue value
            && value.TryGetValue<string>(out var text)
                ? text
                : null;
    }

    private static bool TryGetNode(JsonObject payload, string section, string key, out JsonNode? node)
    {
        node = null;
        if (payload[section] is not JsonObject sectionObject || !sectionObject.ContainsKey(key))
        {
            return false;
        }

        node = sectionObject[key];
        return true;
    }

    private static decimal? NumericValue(JsonNode? node)
    {
        if (node is not JsonValue value)
        {
            return null;
        }

        if (value.TryGetValue<int>(out var intValue)) return intValue;
        if (value.TryGetValue<long>(out var longValue)) return longValue;
        if (value.TryGetValue<decimal>(out var decimalValue)) return decimalValue;
        if (value.TryGetValue<double>(out var doubleValue)) return (decimal)doubleValue;
        if (value.TryGetValue<string>(out var text)
            && decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static bool IsValidEmail(string email)
    {
        try
        {
            return new MailAddress(email).Address.Equals(email, StringComparison.OrdinalIgnoreCase);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }
}

public sealed class DisclosurePackUpdateRequest
{
    [JsonPropertyName("controller")]
    public Dictionary<string, object?>? Controller { get; set; }

    [JsonPropertyName("processor")]
    public Dictionary<string, object?>? Processor { get; set; }

    [JsonPropertyName("data_categories")]
    public Dictionary<string, object?>? DataCategories { get; set; }

    [JsonPropertyName("lawful_basis")]
    public Dictionary<string, object?>? LawfulBasis { get; set; }

    [JsonPropertyName("retention_defaults")]
    public Dictionary<string, object?>? RetentionDefaults { get; set; }

    [JsonPropertyName("data_subject_rights")]
    public Dictionary<string, object?>? DataSubjectRights { get; set; }

    [JsonPropertyName("federation")]
    public Dictionary<string, object?>? Federation { get; set; }

    [JsonPropertyName("isolated_node")]
    public Dictionary<string, object?>? IsolatedNode { get; set; }

    [JsonPropertyName("incident_response")]
    public Dictionary<string, object?>? IncidentResponse { get; set; }

    [JsonPropertyName("cross_border_transfers")]
    public Dictionary<string, object?>? CrossBorderTransfers { get; set; }

    [JsonPropertyName("amendments")]
    public Dictionary<string, object?>? Amendments { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }

    internal JsonObject ToPayload()
    {
        var payload = new JsonObject();

        Add(payload, "controller", Controller);
        Add(payload, "processor", Processor);
        Add(payload, "data_categories", DataCategories);
        Add(payload, "lawful_basis", LawfulBasis);
        Add(payload, "retention_defaults", RetentionDefaults);
        Add(payload, "data_subject_rights", DataSubjectRights);
        Add(payload, "federation", Federation);
        Add(payload, "isolated_node", IsolatedNode);
        Add(payload, "incident_response", IncidentResponse);
        Add(payload, "cross_border_transfers", CrossBorderTransfers);
        Add(payload, "amendments", Amendments);

        if (ExtensionData is not null)
        {
            foreach (var (key, value) in ExtensionData)
            {
                if (!payload.ContainsKey(key))
                {
                    payload[key] = JsonNode.Parse(value.GetRawText());
                }
            }
        }

        return payload;
    }

    private static void Add(JsonObject payload, string key, Dictionary<string, object?>? value)
    {
        if (value is null)
        {
            return;
        }

        var section = new JsonObject();
        foreach (var (field, fieldValue) in value)
        {
            section[field] = ToNode(fieldValue);
        }

        payload[key] = section;
    }

    private static JsonNode? ToNode(object? value)
    {
        if (value is null) return null;
        if (value is JsonElement element) return JsonNode.Parse(element.GetRawText());
        if (value is JsonNode node) return node.DeepClone();
        return JsonSerializer.SerializeToNode(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    }
}

public sealed record DisclosurePackView(
    [property: JsonPropertyName("pack")] JsonObject Pack,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt,
    [property: JsonPropertyName("is_customised")] bool IsCustomised);

public sealed record DisclosurePackUpdateResult(
    JsonObject? Pack = null,
    IReadOnlyList<DisclosurePackValidationError>? Errors = null);

public sealed record DisclosurePackValidationError(string Field, string Message);
