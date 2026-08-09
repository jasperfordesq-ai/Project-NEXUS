// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services;

/// <summary>
/// Controlled jurisdiction, policy, reason, and preset vocabulary. None of
/// these values may be supplied by a member or inferred from legacy evidence.
/// </summary>
public static class SafeguardingVettingCatalog
{
    public const string PurposeSafeguardedMemberContact = "safeguarded_member_contact";
    public const string TenantScope = "tenant";
    public const string Unconfigured = "unconfigured";

    public static readonly IReadOnlySet<string> RevocationReasonCodes = new HashSet<string>(StringComparer.Ordinal)
    {
        "community_decision_withdrawn",
        "member_requested_correction",
        "policy_changed",
        "recorded_in_error"
    };

    public static readonly IReadOnlySet<string> ReviewResolutionCodes = new HashSet<string>(StringComparer.Ordinal)
    {
        "no_change",
        "duplicate_request",
        "member_contacted"
    };

    public static readonly IReadOnlySet<string> RotationReasonCodes = new HashSet<string>(StringComparer.Ordinal)
    {
        "policy_changed",
        "scheduled_review",
        "incident_response"
    };

    public static readonly IReadOnlyDictionary<string, SafeguardingPolicyDefinition> Policies =
        new Dictionary<string, SafeguardingPolicyDefinition>(StringComparer.Ordinal)
        {
            ["england_wales"] = new(
                "dbs_england_wales", "dbs_enhanced", "safeguarded-contact-v1", true,
                "England and Wales", "Enhanced DBS confirmed for safeguarded member contact", "england_wales"),
            ["scotland"] = new(
                "pvg_scotland", "pvg_scotland", "safeguarded-contact-v1", false,
                "Scotland", "PVG status confirmed for safeguarded member contact", "scotland"),
            ["northern_ireland"] = new(
                "access_ni", "access_ni", "safeguarded-contact-v1", false,
                "Northern Ireland", "AccessNI status confirmed for safeguarded member contact", "northern_ireland"),
            ["ireland"] = new(
                "garda_vetting", "garda_vetting", "safeguarded-contact-v1", false,
                "Republic of Ireland", "Garda Vetting confirmed for safeguarded member contact", "ireland"),
            ["custom"] = new(
                null, null, "custom-unconfigured-v1", false,
                "Custom jurisdiction", null, null)
        };

    public static IReadOnlyList<SafeguardingJurisdictionOption> AvailableJurisdictions()
    {
        var items = new List<SafeguardingJurisdictionOption>
        {
            new(Unconfigured, "Safeguarding jurisdiction not configured", null, null, false, false)
        };
        items.AddRange(Policies.Select(pair => new SafeguardingJurisdictionOption(
            pair.Key,
            pair.Value.Label,
            pair.Value.AttestationCode,
            pair.Value.AttestationLabel,
            pair.Value.ContactPolicyAvailable,
            pair.Value.ContactPolicyAvailable)));
        return items;
    }

    public static IReadOnlyList<SafeguardingPresetOption> PresetOptions(string preset)
    {
        if (!Policies.TryGetValue(preset, out var policy) || policy.Preset is null || policy.AttestationCode is null)
        {
            return Array.Empty<SafeguardingPresetOption>();
        }

        var jurisdiction = policy.Preset;
        var code = policy.AttestationCode;
        var vulnerableLabel = jurisdiction == "scotland"
            ? "safeguarding.presets.scotland.options.is_vulnerable_adult.label"
            : "safeguarding.presets.common.options.is_vulnerable_adult.label";
        var coordinatorDescription = jurisdiction == "ireland"
            ? "safeguarding.presets.ireland.options.requires_coordinator_contact.description"
            : "safeguarding.presets.common.options.requires_coordinator_contact.description";
        var vulnerableProviderLabel = jurisdiction == "scotland"
            ? "safeguarding.presets.scotland.options.works_with_vulnerable_adults.label"
            : "safeguarding.presets.common.options.works_with_vulnerable_adults.label";
        var vulnerableProviderDescription = jurisdiction == "ireland"
            ? "safeguarding.presets.ireland.options.works_with_vulnerable_adults.description"
            : $"safeguarding.presets.{jurisdiction}.options.works_with_children.description";
        return
        [
            Option("is_vulnerable_adult", vulnerableLabel,
                "safeguarding.presets.common.options.is_vulnerable_adult.description",
                BoolTriggers(("requires_broker_approval", true), ("restricts_messaging", true),
                    ("restricts_matching", true), ("notify_admin_on_selection", true))),
            Option("requires_vetted_partners", "safeguarding.presets.common.options.requires_vetted_partners.label",
                $"safeguarding.presets.{jurisdiction}.options.requires_vetted_partners.description",
                VettedTriggers(code, restrictMatching: true, notifyAdmin: true)),
            Option("requires_coordinator_contact", "safeguarding.presets.common.options.requires_coordinator_contact.label",
                coordinatorDescription,
                BoolTriggers(("requires_broker_approval", true), ("restricts_messaging", true),
                    ("notify_admin_on_selection", true))),
            Option("no_home_visits", "safeguarding.presets.common.options.no_home_visits.label",
                "safeguarding.presets.common.options.no_home_visits.description",
                BoolTriggers(("notify_admin_on_selection", true))),
            Option("works_with_children", "safeguarding.presets.common.options.works_with_children.label",
                $"safeguarding.presets.{jurisdiction}.options.works_with_children.description",
                InformationalVettingTriggers(code)),
            Option("works_with_vulnerable_adults", vulnerableProviderLabel,
                vulnerableProviderDescription,
                InformationalVettingTriggers(code)),
            Option("none_apply", "safeguarding.presets.common.options.none_apply.label",
                "safeguarding.presets.common.options.none_apply.description",
                new Dictionary<string, object?>())
        ];
    }

    public static string AttestationLabel(string code) => code switch
    {
        "dbs_enhanced" => "Enhanced DBS",
        "garda_vetting" => "Garda vetting",
        "access_ni" => "AccessNI",
        "pvg_scotland" => "PVG Scotland",
        _ => string.Join(' ', code.Split('_', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => char.ToUpperInvariant(word[0]) + word[1..]))
    };

    public static string EnglishOptionLabel(
        string? optionKey,
        string? storedLabel,
        string? presetSource)
    {
        if (storedLabel is not null
            && !storedLabel.StartsWith("safeguarding.", StringComparison.Ordinal))
        {
            return storedLabel;
        }

        return optionKey switch
        {
            "is_vulnerable_adult" when presetSource == "scotland" =>
                "I consider myself a vulnerable or protected adult and may need additional safeguarding support",
            "is_vulnerable_adult" =>
                "I consider myself a vulnerable adult and may need additional safeguarding support",
            "requires_vetted_partners" =>
                "I would prefer to only interact with members who have been appropriately vetted",
            "requires_coordinator_contact" =>
                "I would like a coordinator to help arrange my exchanges rather than being contacted directly",
            "no_home_visits" =>
                "I do not want members visiting my home without coordinator arrangement",
            "works_with_children" =>
                "I plan to offer services that may involve children or young people (under 18)",
            "works_with_vulnerable_adults" when presetSource == "scotland" =>
                "I plan to offer services that may involve protected adults",
            "works_with_vulnerable_adults" =>
                "I plan to offer services that may involve vulnerable adults",
            "none_apply" => "None of these apply to me",
            _ => storedLabel ?? $"option #{optionKey ?? "unknown"}"
        };
    }

    private static SafeguardingPresetOption Option(
        string key,
        string label,
        string description,
        IReadOnlyDictionary<string, object?> triggers)
        => new(key, "checkbox", label, description, null, triggers);

    private static IReadOnlyDictionary<string, object?> BoolTriggers(params (string Key, bool Value)[] values)
        => values.ToDictionary(value => value.Key, value => (object?)value.Value, StringComparer.Ordinal);

    private static IReadOnlyDictionary<string, object?> VettedTriggers(
        string code,
        bool restrictMatching,
        bool notifyAdmin)
        => new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["requires_vetted_interaction"] = true,
            ["restricts_matching"] = restrictMatching,
            ["notify_admin_on_selection"] = notifyAdmin,
            ["vetting_type_required"] = code
        };

    private static IReadOnlyDictionary<string, object?> InformationalVettingTriggers(string code)
        => new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["notify_admin_on_selection"] = true,
            ["vetting_type_required"] = code
        };
}

public sealed record SafeguardingPolicyDefinition(
    string? SchemeCode,
    string? AttestationCode,
    string BasePolicyVersion,
    bool ContactPolicyAvailable,
    string Label,
    string? AttestationLabel,
    string? Preset);

public sealed record SafeguardingPresetOption(
    string OptionKey,
    string OptionType,
    string Label,
    string? Description,
    string? HelpUrl,
    IReadOnlyDictionary<string, object?> Triggers);
