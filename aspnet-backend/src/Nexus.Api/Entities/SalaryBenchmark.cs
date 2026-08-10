// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Global-or-tenant salary benchmark used for job-title matching.
/// Mirrors Laravel's current salary_benchmarks table.
/// </summary>
public sealed class SalaryBenchmark
{
    public long Id { get; set; }
    public int? TenantId { get; set; }
    public string RoleKeyword { get; set; } = string.Empty;
    public string? Industry { get; set; }
    public string? Location { get; set; }
    public decimal SalaryMin { get; set; }
    public decimal SalaryMax { get; set; }
    public decimal SalaryMedian { get; set; }
    public string SalaryType { get; set; } = "annual";
    public string Currency { get; set; } = "EUR";
    public short Year { get; set; } = 2026;
    public string? Source { get; set; }
    public DateTime CreatedAt { get; set; }
}
