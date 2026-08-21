// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace Nexus.Api.Services;

/// <summary>
/// Checks that an email domain is real enough to receive mail.
///
/// Contract parity with the V1 PHP <c>App\Services\MxRecordValidator</c>:
///   - a malformed address passes (the ordinary email validator owns that
///     error; we must not double-report it);
///   - syntactically impossible domains and over-long domains are refused;
///   - RFC 2606 / RFC 6761 reserved documentation-and-testing names are
///     refused BEFORE any DNS lookup, because several of them (example.com in
///     particular) publish real MX records and sail through a naive check —
///     a live attack in May 2026 used exactly that;
///   - otherwise MX, then A/AAAA per RFC 5321 §5.1;
///   - results cached 24h positive, 1h negative.
///
/// 🔴 FAIL-OPEN POLICY — read before changing anything here.
/// A registration guard that depends on the network has two ways to be wrong.
/// Fail CLOSED and a resolver outage locks every legitimate member out of
/// sign-up. Fail OPEN too eagerly and the guard is decoration. The split this
/// class enforces:
///
///   • the resolver answered, and the domain has no mail records  → REFUSE
///   • the resolver answered NXDOMAIN                             → REFUSE
///   • the lookup did not complete (timeout / SERVFAIL / no
///     resolver / unreadable reply)                               → ALLOW,
///     and log <c>email_deliverability.fail_open</c> at WARNING so the
///     outage is visible instead of silent.
///
/// That is the behaviour the V1 docblock describes ("DNS lookups fail open …
/// A genuine 'no MX, no A' result is what we reject"). V1 cannot actually
/// achieve it, because <c>checkdnsrr()</c> returns bare <c>false</c> for both
/// cases and its own comment concedes the point, so in a resolver outage V1
/// refuses everyone. This edition implements the documented intent instead of
/// reproducing that latent fault. The refusal path — the one a member or an
/// attacker actually hits — is identical; the two engines differ ONLY while
/// DNS is broken, and that divergence was reported to the owner deliberately
/// rather than discovered later. Do not "fix" it by collapsing the three
/// resolver states back into two.
/// </summary>
public interface IEmailDeliverabilityValidator
{
    Task<bool> IsResolvableAsync(string? email, CancellationToken ct = default);
}

public class EmailDeliverabilityValidator : IEmailDeliverabilityValidator
{
    private static readonly TimeSpan PositiveCacheTtl = TimeSpan.FromHours(24);
    private static readonly TimeSpan NegativeCacheTtl = TimeSpan.FromHours(1);

    /// <summary>
    /// RFC 6761 + RFC 2606 names that exist solely for documentation and
    /// testing and must never receive real email. Kept byte-identical to the
    /// V1 PHP RESERVED_DOMAINS / RESERVED_TLDS lists — do not "improve" one
    /// side alone. Note that <c>.local</c> is deliberately NOT here: V1 does
    /// not refuse it, and adding it would refuse addresses V1 accepts.
    /// </summary>
    private static readonly string[] ReservedDomains = ["example.com", "example.net", "example.org", "localhost"];

    private static readonly string[] ReservedTlds = [".test", ".example", ".invalid", ".localhost"];

    private static readonly Regex LegalDomain = new("^[a-z0-9.-]+$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly IEmailDomainResolver _resolver;
    private readonly IMemoryCache _cache;
    private readonly IConfiguration _config;
    private readonly ILogger<EmailDeliverabilityValidator> _logger;

    public EmailDeliverabilityValidator(
        IEmailDomainResolver resolver,
        IMemoryCache cache,
        IConfiguration config,
        ILogger<EmailDeliverabilityValidator> logger)
    {
        _resolver = resolver;
        _cache = cache;
        _config = config;
        _logger = logger;
    }

    public async Task<bool> IsResolvableAsync(string? email, CancellationToken ct = default)
    {
        // Escape hatch for an operator whose environment genuinely cannot do
        // DNS. Default ON: an undeliverable-address guard that ships disabled
        // is not a guard. Turning it off is a recorded configuration choice,
        // never a silent fallback.
        if (!_config.GetValue("EmailDeliverability:Enabled", true)) return true;

        if (string.IsNullOrWhiteSpace(email)) return true;
        var at = email.LastIndexOf('@');
        if (at < 0 || at == email.Length - 1) return true; // malformed — not our error to report
        var domain = email[(at + 1)..].Trim().ToLowerInvariant();
        if (domain.Length == 0) return true;

        var cacheKey = $"mx:{domain}";
        if (_cache.TryGetValue<bool>(cacheKey, out var cached)) return cached;

        var resolvable = await ResolveLiveAsync(domain, ct);

        // Positive results cache longer than negative, so a domain that has
        // only just had its mail records set up stops being refused within
        // the hour rather than the day.
        _cache.Set(cacheKey, resolvable, resolvable ? PositiveCacheTtl : NegativeCacheTtl);
        return resolvable;
    }

    private async Task<bool> ResolveLiveAsync(string domain, CancellationToken ct)
    {
        // Reject obvious junk before touching the network.
        if (!LegalDomain.IsMatch(domain) || domain.Length > 253) return false;
        if (ReservedDomains.Contains(domain, StringComparer.Ordinal)) return false;
        foreach (var tld in ReservedTlds)
        {
            if (domain.EndsWith(tld, StringComparison.Ordinal)) return false;
        }

        var resolution = await _resolver.ResolveAsync(domain, ct);
        switch (resolution)
        {
            case DomainMailResolution.HasRecords:
                return true;

            case DomainMailResolution.NoRecords:
                return false;

            default:
                // The check did not run. We allow the registration, but we do
                // NOT pretend the domain was verified — WARNING, not Debug,
                // because a burst of these is an infrastructure incident and
                // the guard is off while it lasts.
                _logger.LogWarning(
                    "email_deliverability.fail_open domain={Domain} reason=lookup_incomplete — address ACCEPTED without verification",
                    domain);
                return true;
        }
    }
}
