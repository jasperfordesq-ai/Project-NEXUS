// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using Microsoft.Extensions.Caching.Memory;

namespace Nexus.Api.Services;

/// <summary>
/// Stores opaque, short-lived, single-use login challenges for TOTP and backup
/// code verification. Challenge values are random capabilities, never JWTs,
/// and therefore cannot be presented as bearer access tokens.
/// </summary>
public sealed class TwoFactorChallengeManager
{
    public static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(5);
    public const int MaximumAttempts = 5;

    private const string CacheKeyPrefix = "2fa_challenge:";
    private readonly IMemoryCache _cache;
    private readonly object _sync = new();

    public TwoFactorChallengeManager(IMemoryCache cache)
    {
        _cache = cache;
    }

    public string Create(
        int userId,
        int tenantId,
        IEnumerable<string> methods,
        DateTime? twoFactorEnabledAt = null)
    {
        if (userId <= 0) throw new ArgumentOutOfRangeException(nameof(userId));
        if (tenantId <= 0) throw new ArgumentOutOfRangeException(nameof(tenantId));

        var normalizedMethods = methods
            .Where(method => !string.IsNullOrWhiteSpace(method))
            .Select(method => method.Trim().ToLowerInvariant())
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (normalizedMethods.Length == 0)
            throw new ArgumentException("At least one verification method is required.", nameof(methods));

        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var challenge = new TwoFactorChallenge(
            userId,
            tenantId,
            normalizedMethods,
            twoFactorEnabledAt,
            Attempts: 0,
            CreatedAt: DateTimeOffset.UtcNow);

        lock (_sync)
        {
            _cache.Set(
                CacheKey(token),
                challenge,
                new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = ChallengeLifetime,
                    Size = 1
                });
        }

        return token;
    }

    public TwoFactorChallenge? Get(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        lock (_sync)
        {
            return _cache.TryGetValue(CacheKey(token), out TwoFactorChallenge? challenge)
                ? challenge
                : null;
        }
    }

    public TwoFactorAttemptResult RecordAttempt(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
            return new TwoFactorAttemptResult(false, 0);

        lock (_sync)
        {
            var key = CacheKey(token);
            if (!_cache.TryGetValue(key, out TwoFactorChallenge? challenge) || challenge is null)
                return new TwoFactorAttemptResult(false, 0);

            var attempts = challenge.Attempts + 1;
            var remaining = MaximumAttempts - attempts;
            if (remaining <= 0)
            {
                _cache.Remove(key);
                return new TwoFactorAttemptResult(false, 0);
            }

            _cache.Set(
                key,
                challenge with { Attempts = attempts },
                new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = ChallengeLifetime,
                    Size = 1
                });
            return new TwoFactorAttemptResult(true, remaining);
        }
    }

    public bool Consume(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;

        lock (_sync)
        {
            var key = CacheKey(token);
            var existed = _cache.TryGetValue(key, out _);
            _cache.Remove(key);
            return existed;
        }
    }

    public bool Delete(string? token) => Consume(token);

    private static string CacheKey(string token) => CacheKeyPrefix + token;
}

public sealed record TwoFactorChallenge(
    int UserId,
    int TenantId,
    IReadOnlyList<string> Methods,
    DateTime? TwoFactorEnabledAt,
    int Attempts,
    DateTimeOffset CreatedAt);

public sealed record TwoFactorAttemptResult(bool Allowed, int AttemptsRemaining);
