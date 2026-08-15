// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A consumed or revoked token jti — Laravel parity for revoked_tokens.
/// Two uses, both single-use by the UNIQUE(jti) constraint: consuming an
/// impersonation PROOF at exchange time (insert wins ⇒ first spender only),
/// and revoking an impersonation SESSION at end time. Not tenant-scoped: a
/// jti is globally unique and the row must be findable without tenant
/// context (the exchange is anonymous).
/// </summary>
public class RevokedToken
{
    public long Id { get; set; }
    public int? UserId { get; set; }
    public string Jti { get; set; } = string.Empty;
    public DateTime RevokedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }
}
