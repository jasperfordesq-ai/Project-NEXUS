// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Support.Safeguarding;

/// <summary>
/// Port of Laravel App\Support\Safeguarding\SupportTiers — the carer
/// permission model for account relationships. Four tiers per capability:
/// none &lt; assist &lt; co_decide &lt; represent.
///
/// Safety rules copied deliberately, each pinned by SupportTiersTests:
/// - the legacy can_view_messages boolean is permanently DEAD: it has no
///   legacy mapping and ToLegacyBooleans hard-writes it false, because
///   historical rows stored true from the years the switch saved-and-did-
///   nothing — mapping it would retroactively grant access nobody consented to;
/// - stored or requested tiers above a capability's cap are DROPPED, not
///   clamped ("degrade toward LESS power");
/// - the messages capability is capped at assist, and staff grants are capped
///   at co_decide with messages removed entirely.
/// </summary>
public static class SupportTiers
{
    public const string None = "none";
    public const string Assist = "assist";
    public const string CoDecide = "co_decide";
    public const string Represent = "represent";

    public static readonly string[] Capabilities = ["activity", "listings", "credits", "messages"];

    public static readonly IReadOnlyDictionary<string, string> MaxTierByCapability =
        new Dictionary<string, string> { ["messages"] = Assist };

    public const string MaxStaffTier = CoDecide;

    private static readonly Dictionary<string, int> Rank = new()
    {
        [None] = 0,
        [Assist] = 1,
        [CoDecide] = 2,
        [Represent] = 3,
    };

    /// <summary>legacy boolean → (capability, tier floor). can_view_messages absent ON PURPOSE.</summary>
    private static readonly (string LegacyKey, string Capability, string Tier)[] LegacyMap =
    [
        ("can_view_activity", "activity", Assist),
        ("can_manage_listings", "listings", Represent),
        ("can_transact", "credits", Represent),
    ];

    /// <summary>
    /// Resolve a stored permissions document (legacy booleans + optional
    /// "tiers" object) into a complete capability→tier map. Legacy booleans
    /// set the floor; the tiers object overrides per capability; unknown tier
    /// strings are ignored; values above a capability's cap are dropped.
    /// </summary>
    public static Dictionary<string, string> Resolve(
        IReadOnlyDictionary<string, bool>? legacyBooleans,
        IReadOnlyDictionary<string, string>? tiers)
    {
        var resolved = Capabilities.ToDictionary(capability => capability, _ => None);

        if (legacyBooleans is not null)
        {
            foreach (var (legacyKey, capability, tier) in LegacyMap)
            {
                if (legacyBooleans.TryGetValue(legacyKey, out var enabled) && enabled)
                {
                    resolved[capability] = tier;
                }
            }
        }

        if (tiers is not null)
        {
            foreach (var (capability, tier) in tiers)
            {
                if (!resolved.ContainsKey(capability)) continue;
                if (!Rank.ContainsKey(tier)) continue;
                if (ExceedsCap(capability, tier)) continue; // dropped, never clamped
                resolved[capability] = tier;
            }
        }

        return resolved;
    }

    /// <summary>
    /// Sanitize an INCOMING tiers payload: unknown capabilities, unknown tier
    /// strings, and above-cap values are all dropped.
    /// </summary>
    public static Dictionary<string, string> SanitizeTiers(
        IReadOnlyDictionary<string, string>? requested)
    {
        var clean = new Dictionary<string, string>();
        if (requested is null) return clean;
        foreach (var (capability, tier) in requested)
        {
            if (!Capabilities.Contains(capability)) continue;
            if (!Rank.ContainsKey(tier)) continue;
            if (ExceedsCap(capability, tier)) continue;
            clean[capability] = tier;
        }

        return clean;
    }

    public static bool AtLeast(
        IReadOnlyDictionary<string, string> tiers, string capability, string minimum)
    {
        var current = tiers.TryGetValue(capability, out var tier) ? tier : None;
        return RankOf(current) >= RankOf(minimum);
    }

    /// <summary>True when any capability gained power.</summary>
    public static bool IsExpansion(
        IReadOnlyDictionary<string, string> before, IReadOnlyDictionary<string, string> after)
    {
        foreach (var capability in Capabilities)
        {
            var beforeRank = RankOf(before.TryGetValue(capability, out var b) ? b : None);
            var afterRank = RankOf(after.TryGetValue(capability, out var a) ? a : None);
            if (afterRank > beforeRank) return true;
        }

        return false;
    }

    /// <summary>
    /// The stored legacy-boolean projection. can_view_messages is ALWAYS
    /// false, including now that a real messages capability exists.
    /// </summary>
    public static Dictionary<string, bool> ToLegacyBooleans(
        IReadOnlyDictionary<string, string> tiers)
    {
        var booleans = new Dictionary<string, bool>();
        foreach (var (legacyKey, capability, tier) in LegacyMap)
        {
            booleans[legacyKey] = AtLeast(tiers, capability, tier);
        }

        booleans["can_view_messages"] = false;
        return booleans;
    }

    /// <summary>
    /// Staff-proposed grants are clamped to co_decide, and the messages
    /// capability is removed entirely — staff never hold it.
    /// </summary>
    public static Dictionary<string, string> CapForStaff(
        IReadOnlyDictionary<string, string> tiers)
    {
        var capped = new Dictionary<string, string>();
        foreach (var (capability, tier) in tiers)
        {
            if (capability == "messages") continue;
            if (!Capabilities.Contains(capability) || !Rank.ContainsKey(tier)) continue;
            capped[capability] = RankOf(tier) > RankOf(MaxStaffTier) ? MaxStaffTier : tier;
        }

        return capped;
    }

    private static bool ExceedsCap(string capability, string tier) =>
        MaxTierByCapability.TryGetValue(capability, out var cap) && RankOf(tier) > RankOf(cap);

    private static int RankOf(string tier) => Rank.TryGetValue(tier, out var rank) ? rank : 0;
}
