// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Durable tenant health-check outcome and latency evidence.
/// Mirrors Laravel's health_check_history table.
/// </summary>
public sealed class HealthCheckHistory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string Status { get; set; } = string.Empty;
    public string ChecksJson { get; set; } = "{}";
    public int? LatencyMs { get; set; }
    public DateTime CreatedAt { get; set; }
}
