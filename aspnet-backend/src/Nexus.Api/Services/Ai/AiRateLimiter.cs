// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Collections.Concurrent;
using Microsoft.Extensions.Configuration;

namespace Nexus.Api.Services.Ai;

public interface IAiRateLimiter
{
    /// <summary>
    /// Atomically check the per-user and per-tenant sliding 1-minute windows
    /// and either consume one slot or deny.
    /// </summary>
    bool TryAcquire(int tenantId, int userId, out string deniedReason);
}

/// <summary>
/// In-memory sliding-window rate limiter. Two buckets per caller — per-user
/// and per-tenant — both keyed off a fixed 60-second window. Suitable for
/// single-instance deployments; replace with a Redis-backed implementation
/// for horizontal scale.
/// </summary>
public class AiRateLimiter : IAiRateLimiter
{
    private readonly int _perUserPerMinute;
    private readonly int _perTenantPerMinute;
    private readonly ConcurrentDictionary<(int, int), Queue<DateTime>> _userBuckets = new();
    private readonly ConcurrentDictionary<int, Queue<DateTime>> _tenantBuckets = new();
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    public AiRateLimiter(IConfiguration config)
    {
        _perUserPerMinute = config.GetValue<int?>("Ai:RateLimit:PerUserPerMinute") ?? 20;
        _perTenantPerMinute = config.GetValue<int?>("Ai:RateLimit:PerTenantPerMinute") ?? 600;
    }

    public bool TryAcquire(int tenantId, int userId, out string deniedReason)
    {
        var now = DateTime.UtcNow;
        var userBucket = _userBuckets.GetOrAdd((tenantId, userId), _ => new Queue<DateTime>());
        lock (userBucket)
        {
            while (userBucket.Count > 0 && now - userBucket.Peek() > Window) userBucket.Dequeue();
            if (userBucket.Count >= _perUserPerMinute)
            {
                deniedReason = $"per_user_limit:{_perUserPerMinute}/min";
                return false;
            }
            userBucket.Enqueue(now);
        }

        var tenantBucket = _tenantBuckets.GetOrAdd(tenantId, _ => new Queue<DateTime>());
        lock (tenantBucket)
        {
            while (tenantBucket.Count > 0 && now - tenantBucket.Peek() > Window) tenantBucket.Dequeue();
            if (tenantBucket.Count >= _perTenantPerMinute)
            {
                // Roll back the user slot we just took so a tenant-cap denial
                // doesn't permanently penalise the calling user.
                lock (userBucket)
                {
                    if (userBucket.Count > 0) userBucket.Dequeue();
                }
                deniedReason = $"per_tenant_limit:{_perTenantPerMinute}/min";
                return false;
            }
            tenantBucket.Enqueue(now);
        }

        deniedReason = string.Empty;
        return true;
    }
}
