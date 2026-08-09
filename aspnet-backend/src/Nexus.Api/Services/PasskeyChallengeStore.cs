// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Diagnostics.CodeAnalysis;
using Microsoft.Extensions.Caching.Memory;

namespace Nexus.Api.Services;

/// <summary>
/// Stores short-lived WebAuthn challenges and atomically consumes them once.
/// This guarantee is process-local: every ceremony handled by this API process
/// shares the singleton lock, but multi-node deployments require a distributed
/// store with an atomic take operation to provide the same cross-node guarantee.
/// </summary>
public sealed class PasskeyChallengeStore
{
    private readonly IMemoryCache _cache;
    private readonly object _sync = new();

    public PasskeyChallengeStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public void Set<TChallenge>(string key, TChallenge challenge, TimeSpan lifetime)
        where TChallenge : class
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        ArgumentNullException.ThrowIfNull(challenge);

        lock (_sync)
        {
            _cache.Set(key, challenge, lifetime);
        }
    }

    public bool TryTake<TChallenge>(
        string key,
        [NotNullWhen(true)] out TChallenge? challenge)
        where TChallenge : class
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        lock (_sync)
        {
            if (!_cache.TryGetValue(key, out challenge) || challenge is null)
            {
                challenge = null;
                return false;
            }

            _cache.Remove(key);
            return true;
        }
    }
}
