// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Per-user monthly activity aggregate used for engagement recognition.
/// Mirrors Laravel's monthly_engagement table.
/// </summary>
public sealed class MonthlyEngagement : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string YearMonth { get; set; } = string.Empty;
    public bool WasActive { get; set; }
    public int ActivityCount { get; set; }
    public DateTime? RecognizedAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
