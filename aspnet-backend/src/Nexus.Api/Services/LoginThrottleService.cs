// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Per-account and per-address sign-in lockout.
///
/// Mirrors Laravel's <c>App\Core\RateLimiter</c>: at most
/// <see cref="MaxAttempts"/> failures inside <see cref="WindowSeconds"/>, then a
/// <see cref="LockoutSeconds"/> lockout. Checked BEFORE the password is
/// verified, and cleared on a successful sign-in.
///
/// 🔴 The per-EMAIL half is the part this backend was missing. The existing
/// ASP.NET limiter is per-IP only, so credential stuffing spread across many
/// addresses could grind away at one account unthrottled.
/// </summary>
public sealed class LoginThrottleService(NexusDbContext db)
{
    public const int MaxAttempts = 10;
    public const int WindowSeconds = 300;
    public const int LockoutSeconds = 300;

    public const string TypeEmail = "email";
    public const string TypeIp = "ip";

    public sealed record Verdict(bool Limited, int RetryAfterSeconds, int RemainingAttempts);

    private static readonly Verdict Allowed = new(false, 0, MaxAttempts);

    /// <summary>Is this identifier currently locked out?</summary>
    public async Task<Verdict> CheckAsync(string? identifier, string type, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(identifier)) return Allowed;

        var key = Normalise(identifier, type);
        var windowStart = DateTime.UtcNow.AddSeconds(-WindowSeconds);

        var failures = await db.Set<LoginAttempt>().AsNoTracking()
            .Where(a => a.Identifier == key
                && a.IdentifierType == type
                && !a.Succeeded
                && a.AttemptedAt >= windowStart)
            .OrderByDescending(a => a.AttemptedAt)
            .Select(a => a.AttemptedAt)
            .Take(MaxAttempts)
            .ToListAsync(ct);

        if (failures.Count < MaxAttempts)
        {
            return new Verdict(false, 0, MaxAttempts - failures.Count);
        }

        // Locked from the most recent failure, exactly as Laravel measures it.
        var lockoutEnds = failures[0].AddSeconds(LockoutSeconds);
        var remaining = (int)Math.Ceiling((lockoutEnds - DateTime.UtcNow).TotalSeconds);
        return remaining <= 0
            ? new Verdict(false, 0, 1)
            : new Verdict(true, remaining, 0);
    }

    /// <summary>
    /// Record an attempt. A success clears the identifier's history, so a member
    /// who mistypes a few times and then gets in is not left near a lockout.
    /// </summary>
    public async Task RecordAsync(string? identifier, string type, bool succeeded, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(identifier)) return;

        var key = Normalise(identifier, type);

        if (succeeded)
        {
            await db.Set<LoginAttempt>()
                .Where(a => a.Identifier == key && a.IdentifierType == type)
                .ExecuteDeleteAsync(ct);
            return;
        }

        db.Set<LoginAttempt>().Add(new LoginAttempt
        {
            Identifier = key,
            IdentifierType = type,
            Succeeded = false,
            AttemptedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Human-readable retry message, matching Laravel's wording shape.</summary>
    public static string RetryMessage(int retryAfterSeconds)
    {
        var minutes = (int)Math.Ceiling(retryAfterSeconds / 60.0);
        return minutes <= 1
            ? "Too many attempts. Please try again in a minute."
            : $"Too many attempts. Please try again in {minutes} minutes.";
    }

    private static string Normalise(string identifier, string type)
        => type == TypeEmail ? identifier.Trim().ToLowerInvariant() : identifier.Trim();
}
