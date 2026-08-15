// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// One recorded sign-in attempt, used for per-account and per-address lockout.
///
/// 🔴 Why this table exists. Until 2026-08-15 this backend had only a per-IP
/// request limiter. Laravel additionally counts failures per EMAIL
/// (App\Core\RateLimiter: 10 attempts in a 300s window, 300s lockout, checked
/// before the password is verified), so one account could be attacked from many
/// addresses here without ever tripping a limit.
///
/// Deliberately a table rather than in-memory: a lockout that resets on restart,
/// or that only protects the node that happened to receive the attempts, is a
/// security control with a silent hole in it.
///
/// NOT tenant-scoped. Sign-in happens before the tenant is known for certain,
/// and an attacker must not be able to reset a counter by switching community.
/// </summary>
public class LoginAttempt
{
    public long Id { get; set; }

    /// <summary>The email address or client IP the attempt was made against.</summary>
    public string Identifier { get; set; } = string.Empty;

    /// <summary>"email" or "ip".</summary>
    public string IdentifierType { get; set; } = "email";

    public bool Succeeded { get; set; }

    public DateTime AttemptedAt { get; set; } = DateTime.UtcNow;
}
