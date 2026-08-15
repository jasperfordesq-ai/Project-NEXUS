// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Platform-global capability override — Laravel parity for
/// platform_capability_overrides. Deliberately NOT tenant-scoped: one row per
/// capability for the whole installation. The allowlist of capabilities and
/// their legal values lives in PlatformCapabilityService and is the entire
/// security boundary.
/// </summary>
public class PlatformCapabilityOverride
{
    public long Id { get; set; }
    public string Capability { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public int? UpdatedByUserId { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

// NOTE: EventAttendanceCreditClaim already exists in
// Entities/EventAnalyticsEntities.cs from an earlier schema slice — the
// ledger table was ported before its admin endpoints were. EventCreditService
// builds on that existing entity.
