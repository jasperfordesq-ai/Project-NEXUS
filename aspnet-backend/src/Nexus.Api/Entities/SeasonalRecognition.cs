// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Per-user seasonal recognition derived from monthly engagement.
/// Mirrors Laravel's seasonal_recognition table.
/// </summary>
public sealed class SeasonalRecognition : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string Season { get; set; } = string.Empty;
    public short MonthsActive { get; set; }
    public DateTime? RecognizedAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
