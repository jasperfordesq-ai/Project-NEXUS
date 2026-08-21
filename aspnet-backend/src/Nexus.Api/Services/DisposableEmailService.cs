// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Collections.Frozen;

namespace Nexus.Api.Services;

/// <summary>
/// Checks an email against a curated list of throwaway / temp-email providers
/// (mailinator, 10minutemail, guerrillamail, tempmail, yopmail, …).
///
/// Contract parity with the V1 PHP <c>App\Services\DisposableEmailService</c>:
///   - empty / malformed addresses return FALSE (the ordinary email validator
///     surfaces those; we must not double-error);
///   - an exact domain match blocks;
///   - a match on any PARENT domain with at least two labels blocks too, so
///     <c>foo.mailinator.com</c> cannot dodge an exact-match blocklist.
///
/// The blocklist is a build-time content file, so this check needs no network
/// and cannot fail open — a disposable address is refused deterministically.
/// </summary>
public interface IDisposableEmailService
{
    bool IsDisposable(string? email);
}

public class DisposableEmailService : IDisposableEmailService
{
    /// <summary>
    /// Path is relative to the application base directory. The file is copied
    /// there by the <c>Resources\Security\*</c> content item in Nexus.Api.csproj.
    /// </summary>
    public const string BlocklistRelativePath = "Resources/Security/disposable-email-domains.txt";

    private readonly ILogger<DisposableEmailService> _logger;
    private readonly Lazy<FrozenSet<string>> _blocklist;

    public DisposableEmailService(ILogger<DisposableEmailService> logger)
    {
        _logger = logger;
        // Loaded once per process on first use. The service is registered as a
        // singleton, so this is the whole cache — mirrors the PHP static
        // property, minus the per-request reload.
        _blocklist = new Lazy<FrozenSet<string>>(LoadBlocklist, isThreadSafe: true);
    }

    public bool IsDisposable(string? email)
    {
        var domain = ExtractDomain(email);
        if (domain is null) return false;

        var blocklist = _blocklist.Value;
        if (blocklist.Contains(domain)) return true;

        // Test every parent suffix that still has at least two labels, so
        // `a.b.mailinator.com` tests `b.mailinator.com` then `mailinator.com`.
        // Direct translation of the PHP `while (count($parts) > 2) { shift; }`
        // loop: the full domain is already tested above, and a bare TLD never
        // is (blocking `.com` would refuse the whole internet).
        var parts = domain.Split('.');
        for (var skip = 1; skip <= parts.Length - 2; skip++)
        {
            if (blocklist.Contains(string.Join('.', parts, skip, parts.Length - skip))) return true;
        }

        return false;
    }

    /// <summary>
    /// Lower-cased domain, or null when the address is empty or has no local
    /// part / no domain part. Uses the LAST '@' the way PHP's strrpos does.
    /// </summary>
    private static string? ExtractDomain(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var trimmed = email.Trim().ToLowerInvariant();
        var at = trimmed.LastIndexOf('@');
        if (at < 0 || at == trimmed.Length - 1) return null;
        var domain = trimmed[(at + 1)..];
        return domain.Length == 0 ? null : domain;
    }

    private FrozenSet<string> LoadBlocklist()
    {
        var path = Path.Combine(AppContext.BaseDirectory, BlocklistRelativePath);
        if (!File.Exists(path))
        {
            // Deliberately loud. An empty blocklist silently accepts every
            // throwaway address, which is the exact failure this guard exists
            // to prevent — so it must never be mistaken for "nothing blocked".
            _logger.LogError(
                "disposable_email.blocklist_missing path={Path} — every disposable domain will be ACCEPTED until this is fixed",
                path);
            return FrozenSet<string>.Empty;
        }

        var domains = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var rawLine in File.ReadLines(path))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            domains.Add(line.ToLowerInvariant());
        }

        _logger.LogInformation("disposable_email.blocklist_loaded count={Count}", domains.Count);
        return domains.ToFrozenSet(StringComparer.OrdinalIgnoreCase);
    }
}
