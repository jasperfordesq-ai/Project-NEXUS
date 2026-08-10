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

public sealed class CommercialBoundaryService
{
    public const string SettingKey = "caring.commercial_boundary";

    public static readonly string[] Classifications =
    [
        "agpl_public",
        "tenant_config",
        "private_deployment",
        "commercial"
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly CommercialBoundaryCategory[] Categories =
    [
        new("core_caring", "Core caring community"),
        new("community_governance", "Community governance"),
        new("gamification_engagement", "Gamification & engagement"),
        new("commercial_layer", "Commercial layer"),
        new("advanced_ai", "Advanced AI"),
        new("mobile_native", "Mobile native"),
        new("regional_intelligence", "Regional intelligence")
    ];

    private static readonly CommercialBoundaryClassification[] ClassificationDefinitions =
    [
        new(
            "agpl_public",
            "AGPL public",
            "AGPL public code in the open-source repo. Anyone may deploy this for free."),
        new(
            "tenant_config",
            "Tenant config",
            "Feature toggle in `tenants.features`. AGPL code; tenant chooses whether to enable."),
        new(
            "private_deployment",
            "Private deployment",
            "Operational deployment layer (build accounts, infrastructure ownership). Not a code license issue."),
        new(
            "commercial",
            "Commercial",
            "Requires a separate commercial agreement with the platform operator. Not part of the AGPL package.")
    ];

    private static readonly CommercialBoundaryCapabilityDefinition[] CanonicalCapabilities =
    [
        new(
            "caring_community_module",
            "Caring Community module",
            "The umbrella feature flag that activates the full Caring Community workflow inside a tenant.",
            "core_caring",
            "agpl_public",
            true,
            "Master gate that other caring features hang off."),
        new(
            "caring_help_requests",
            "Help requests",
            "Caring help-request flow with on-behalf-of caregiver requests, matching, and acceptance lifecycle.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_support_relationships",
            "Support relationships",
            "Long-running 1:1 caring relationships between a recipient and one or more supporters with weekly check-ins.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_caregiver_links",
            "Caregiver links",
            "Verified link between an informal caregiver and the person they care for, allowing the caregiver to request help on behalf.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_substitute_cover",
            "Substitute / cover scheduling",
            "Find substitute caregivers when the primary supporter is unavailable, with conflict detection and confirmation.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_warmth_pass",
            "Warmth Pass",
            "Recipient-side dignity layer that controls who can see their needs, with consent-based introduction flows.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_emergency_alerts",
            "Emergency alerts",
            "Recipient or caregiver-triggered emergency broadcast to a vetted radius of trusted neighbours.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_sub_regions",
            "Caring sub-regions",
            "Sub-regional cells inside a tenant (canton, district, neighbourhood) with their own coordinator and KPI roll-up.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_research_consent",
            "Research consent flag",
            "Member opt-in flag for inclusion in anonymised research datasets shared with academic or municipal partners.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_municipal_roi",
            "Municipal ROI report",
            "CHF-denominated formal-care-cost-offset and prevention-value report for B2G procurement conversations.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_pilot_scoreboard",
            "Pilot scoreboard",
            "Live KPI tile pack used during pilot stand-ups with funder-facing momentum metrics.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_disclosure_pack",
            "FADP / nDSG disclosure pack",
            "Editable Swiss data-protection disclosure pack a pilot can hand to legal counsel before resident onboarding.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "caring_operating_policy",
            "Operating policy workshop",
            "Schema-driven policy form covering approval authority, SLA windows, legacy-hour settlement, CHF rates and cadence.",
            "core_caring",
            "agpl_public",
            true,
            ""),
        new(
            "safeguarding_reports",
            "Safeguarding reports",
            "Member-to-coordinator safeguarding flag flow with audit trail and escalation routing.",
            "community_governance",
            "agpl_public",
            true,
            ""),
        new(
            "trust_tier_system",
            "Trust tier system",
            "Member trust progression (new, trusted, vetted) gating which caring actions a member can perform.",
            "community_governance",
            "agpl_public",
            true,
            ""),
        new(
            "municipal_verification",
            "Municipal verification badge",
            "Optional municipal partner-issued verification stamp on a member profile (residence or background-check based).",
            "community_governance",
            "agpl_public",
            true,
            ""),
        new(
            "xp_badges_journeys",
            "XP, badges & journeys",
            "Engagement layer with XP, badges, journeys and challenges that reward caring participation.",
            "gamification_engagement",
            "agpl_public",
            true,
            ""),
        new(
            "appreciation_messages",
            "Appreciation messages",
            "Lightweight thank-you / kudos flow letting recipients publicly acknowledge supporters.",
            "gamification_engagement",
            "agpl_public",
            true,
            ""),
        new(
            "local_advertising_campaigns",
            "Local advertising campaigns",
            "In-app placements sold to local merchants. AGPL code, opt-in per tenant, revenue stays with the deployer.",
            "commercial_layer",
            "tenant_config",
            true,
            "Opt-in per tenant. AGPL code, no revenue share back to platform operator."),
        new(
            "paid_push_campaigns",
            "Paid push campaigns",
            "Targeted push-notification campaigns merchants can purchase to reach opted-in members.",
            "commercial_layer",
            "tenant_config",
            true,
            "Tenant must enable + accept FCM cost responsibility."),
        new(
            "premium_member_tier",
            "Premium member tier",
            "Optional paid member tier with extra perks - tenant decides whether to operate one.",
            "commercial_layer",
            "tenant_config",
            true,
            ""),
        new(
            "merchant_loyalty_coupons",
            "Merchant loyalty & coupons",
            "Local merchant loyalty stamp cards and coupon redemption tied to time-credit balances.",
            "commercial_layer",
            "agpl_public",
            true,
            ""),
        new(
            "verein_dues_collection",
            "Verein / association dues",
            "Recurring association dues collection via Stripe with member statements and reconciliation.",
            "commercial_layer",
            "agpl_public",
            true,
            "Stripe account is operational ownership; the code is AGPL."),
        new(
            "smart_matching_engine",
            "Smart matching engine",
            "Heuristic matcher that pairs help requests with likely supporters using skills, distance and history.",
            "advanced_ai",
            "agpl_public",
            true,
            ""),
        new(
            "ki_agenten_framework",
            "KI-Agenten framework",
            "Per-tenant agent runtime that lets coordinators define structured assistants for repeatable workflows.",
            "advanced_ai",
            "agpl_public",
            true,
            "Code is AGPL; tenant supplies its own LLM API key (separate cost)."),
        new(
            "ai_chat_assistant",
            "AI chat assistant",
            "Member-facing chat assistant grounded in the tenant knowledge base for help and onboarding.",
            "advanced_ai",
            "agpl_public",
            true,
            "Tenant supplies its own OpenAI key."),
        new(
            "embedding_recommendations",
            "Embedding-based recommendations",
            "OpenAI embeddings power listing, member, and group recommendations across the platform.",
            "advanced_ai",
            "agpl_public",
            true,
            "Tenant pays the embedding API bill."),
        new(
            "tenant_branded_native_app",
            "Tenant-branded native app",
            "iOS / Android Capacitor app published under the tenant brand. The code is AGPL; the build pipeline and store accounts are not.",
            "mobile_native",
            "private_deployment",
            true,
            "Source is AGPL. Apple / Google developer accounts, signing keys, build pipeline and review workflow are operational ownership and not part of the package."),
        new(
            "paid_regional_analytics",
            "Paid regional analytics (B2G)",
            "Cross-tenant aggregate analytics for cantonal / municipal procurement - sold separately to public-sector buyers.",
            "regional_intelligence",
            "commercial",
            false,
            "Separate B2G product. Requires a commercial agreement with the platform operator."),
        new(
            "partner_api_access",
            "Partner API access",
            "Outbound API for research, government and integration partners with rate-limited cross-tenant queries.",
            "regional_intelligence",
            "commercial",
            false,
            "Commercial agreement required. Not exposed to AGPL deployers by default.")
    ];

    private readonly NexusDbContext _db;

    public CommercialBoundaryService(NexusDbContext db, TenantContext tenantContext)
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

    public async Task<CommercialBoundaryMatrix> MatrixAsync(int tenantId, CancellationToken ct)
    {
        var (overrides, lastUpdatedAt) = await LoadOverridesAsync(tenantId, ct);
        var capabilities = CanonicalCapabilities
            .Select(capability =>
            {
                var isOverridden = overrides.TryGetValue(capability.Key, out var overrideClassification);
                return new CommercialBoundaryCapability(
                    capability.Key,
                    capability.Label,
                    capability.Description,
                    capability.Category,
                    capability.DefaultClassification,
                    isOverridden ? overrideClassification! : capability.DefaultClassification,
                    isOverridden,
                    capability.AgplModule,
                    capability.Notes);
            })
            .ToArray();

        return new CommercialBoundaryMatrix(
            Categories,
            ClassificationDefinitions,
            capabilities,
            overrides.Count,
            lastUpdatedAt);
    }

    public async Task<CommercialBoundaryMutationResult> SetOverrideAsync(
        int tenantId,
        string capabilityKey,
        string? classification,
        CancellationToken ct)
    {
        var errors = new List<CommercialBoundaryValidationError>();
        if (!IsValidCapabilityKey(capabilityKey))
        {
            errors.Add(new CommercialBoundaryValidationError("capability_key", "unknown capability"));
        }

        if (classification is not null && !IsValidClassification(classification))
        {
            errors.Add(new CommercialBoundaryValidationError(
                "classification",
                $"must be one of: {string.Join(", ", Classifications)}"));
        }

        if (errors.Count > 0)
        {
            return new CommercialBoundaryMutationResult(Errors: errors);
        }

        var (overrides, _) = await LoadOverridesAsync(tenantId, ct);
        if (classification is null)
        {
            overrides.Remove(capabilityKey);
        }
        else
        {
            overrides[capabilityKey] = classification;
        }

        await PersistOverridesAsync(tenantId, overrides, ct);
        return new CommercialBoundaryMutationResult(Matrix: await MatrixAsync(tenantId, ct));
    }

    public static bool IsValidClassification(string classification)
    {
        return Classifications.Contains(classification, StringComparer.Ordinal);
    }

    public static bool IsValidCapabilityKey(string key)
    {
        return CanonicalCapabilities.Any(capability => string.Equals(capability.Key, key, StringComparison.Ordinal));
    }

    public static bool TryReadClassification(object? raw, out string? classification)
    {
        classification = null;
        if (raw is null)
        {
            return true;
        }

        switch (raw)
        {
            case string value:
                classification = value;
                return true;
            case JsonElement { ValueKind: JsonValueKind.String } element:
                classification = element.GetString();
                return true;
            case JsonElement { ValueKind: JsonValueKind.Null }:
                return true;
            default:
                return false;
        }
    }

    private async Task<(Dictionary<string, string> Overrides, string? LastUpdatedAt)> LoadOverridesAsync(
        int tenantId,
        CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (row is null || string.IsNullOrWhiteSpace(row.Value))
        {
            return (new Dictionary<string, string>(StringComparer.Ordinal), null);
        }

        var lastUpdatedAt = row.UpdatedAt?.ToUniversalTime().ToString("O");
        try
        {
            var decoded = JsonSerializer.Deserialize<StoredCommercialBoundaryEnvelope>(row.Value, JsonOptions);
            if (decoded?.Overrides is null)
            {
                return (new Dictionary<string, string>(StringComparer.Ordinal), lastUpdatedAt);
            }

            var clean = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var (key, value) in decoded.Overrides)
            {
                if (IsValidCapabilityKey(key) && IsValidClassification(value))
                {
                    clean[key] = value;
                }
            }

            return (clean, lastUpdatedAt);
        }
        catch (JsonException)
        {
            return (new Dictionary<string, string>(StringComparer.Ordinal), lastUpdatedAt);
        }
    }

    private async Task PersistOverridesAsync(
        int tenantId,
        Dictionary<string, string> overrides,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var payload = JsonSerializer.Serialize(
            new StoredCommercialBoundaryEnvelope
            {
                Overrides = overrides
            },
            JsonOptions);

        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (existing is null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = SettingKey,
                Value = payload,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
        else
        {
            existing.Value = payload;
            existing.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
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

public sealed class CommercialBoundaryOverrideRequest
{
    [JsonPropertyName("capability_key")] public string? CapabilityKey { get; set; }
    [JsonPropertyName("classification")] public object? Classification { get; set; }
}

public sealed record CommercialBoundaryMatrix(
    [property: JsonPropertyName("categories")] IReadOnlyList<CommercialBoundaryCategory> Categories,
    [property: JsonPropertyName("classifications")] IReadOnlyList<CommercialBoundaryClassification> Classifications,
    [property: JsonPropertyName("capabilities")] IReadOnlyList<CommercialBoundaryCapability> Capabilities,
    [property: JsonPropertyName("overrides_count")] int OverridesCount,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt);

public sealed record CommercialBoundaryCategory(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label")] string Label);

public sealed record CommercialBoundaryClassification(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("description")] string Description);

public sealed record CommercialBoundaryCapability(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("description")] string Description,
    [property: JsonPropertyName("category")] string Category,
    [property: JsonPropertyName("default_classification")] string DefaultClassification,
    [property: JsonPropertyName("effective_classification")] string EffectiveClassification,
    [property: JsonPropertyName("is_overridden")] bool IsOverridden,
    [property: JsonPropertyName("agpl_module")] bool AgplModule,
    [property: JsonPropertyName("notes")] string Notes);

public sealed record CommercialBoundaryValidationError(
    string Field,
    string Message);

public sealed record CommercialBoundaryMutationResult(
    CommercialBoundaryMatrix? Matrix = null,
    IReadOnlyList<CommercialBoundaryValidationError>? Errors = null);

internal sealed record CommercialBoundaryCapabilityDefinition(
    string Key,
    string Label,
    string Description,
    string Category,
    string DefaultClassification,
    bool AgplModule,
    string Notes);

internal sealed class StoredCommercialBoundaryEnvelope
{
    [JsonPropertyName("overrides")] public Dictionary<string, string> Overrides { get; set; } = [];
}
