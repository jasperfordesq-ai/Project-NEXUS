// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Support;

/// <summary>
/// One place that knows how a tenant feature flag is stored in
/// <c>tenant_configs</c>, and reads BOTH spellings that exist in the wild.
///
/// 🔴 Why this exists. This backend had two conventions for the same thing and
/// no single owner, so half the code could not see what the other half wrote:
///
/// <list type="bullet">
/// <item><description><c>features.{flag}</c> — what the seeders write and what
/// the gates read: <c>PublicEventsController</c>, <c>AuthController</c>,
/// <c>OutOfScopeFeatureGuardMiddleware</c>, and every Caring Community
/// service.</description></item>
/// <item><description><c>feature.{flag}</c> — what <c>CompatibilityController</c>
/// reads for all forty flags it publishes in <c>/api/v2/tenant/bootstrap</c>,
/// plus <c>MemberParityController</c> and the volunteering services. Several
/// tests write this spelling too.</description></item>
/// </list>
///
/// The consequence was not cosmetic. Bootstrap is how the React frontend learns
/// which features a community has, so the switch and the display read different
/// rows. Reproduced on the running dev API:
///
/// <code>
/// INSERT features.public_events = true
/// GET /api/v2/public/events        → 200   (the gate honoured it)
/// GET /api/v2/tenant/bootstrap     → features.public_events = false
/// </code>
///
/// The backend was serving a feature the frontend had been told did not exist —
/// and the reverse is worse: switching a default-on feature OFF left the
/// frontend still advertising it, sending members to a screen the backend
/// refuses.
///
/// 🔴 Read both, and do not "tidy" this to one. Live rows exist under the
/// canonical spelling and tests write the legacy one; picking a single key would
/// silently discard whichever half it dropped, which is the same failure again
/// in the other direction. Canonical is what new writes use.
/// </summary>
public static class TenantFeatureKeys
{
    /// <summary>Prefix new writes use.</summary>
    public const string CanonicalPrefix = "features.";

    /// <summary>Prefix still present in stored rows and in tests.</summary>
    public const string LegacyPrefix = "feature.";

    public static string Canonical(string flag) => CanonicalPrefix + flag;

    public static string Legacy(string flag) => LegacyPrefix + flag;

    /// <summary>Both keys a stored flag may live under, canonical first.</summary>
    public static string[] BothKeys(string flag) => [Canonical(flag), Legacy(flag)];

    /// <summary>
    /// Reads a flag from an already-loaded config map, preferring the canonical
    /// spelling and falling back to the legacy one. Returns
    /// <paramref name="defaultValue"/> when neither key is present or the stored
    /// value is blank.
    /// </summary>
    public static bool Read(IReadOnlyDictionary<string, string> config, string flag, bool defaultValue)
    {
        if (config.TryGetValue(Canonical(flag), out var canonical) && !string.IsNullOrWhiteSpace(canonical))
        {
            return IsTruthy(canonical);
        }

        if (config.TryGetValue(Legacy(flag), out var legacy) && !string.IsNullOrWhiteSpace(legacy))
        {
            return IsTruthy(legacy);
        }

        return defaultValue;
    }

    /// <summary>
    /// Whether a stored value means "on". Deliberately generous: these rows are
    /// written by seeders, admin screens and tests, and have appeared as "true",
    /// "1", "yes" and "on".
    /// </summary>
    public static bool IsTruthy(string? value) =>
        value is not null
        && (value.Equals("true", StringComparison.OrdinalIgnoreCase)
            || value.Equals("1", StringComparison.Ordinal)
            || value.Equals("yes", StringComparison.OrdinalIgnoreCase)
            || value.Equals("on", StringComparison.OrdinalIgnoreCase));
}
