// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Municipality pilot-region qualification and sales-pipeline record.
/// Mirrors Laravel's pilot_inquiries table.
/// </summary>
public sealed class PilotInquiry : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string MunicipalityName { get; set; } = string.Empty;
    public string? Region { get; set; }
    public string Country { get; set; } = "CH";
    public int? Population { get; set; }
    public string ContactName { get; set; } = string.Empty;
    public string ContactEmail { get; set; } = string.Empty;
    public string? ContactPhone { get; set; }
    public string? ContactRole { get; set; }
    public short HasKissCooperative { get; set; }
    public short HasExistingDigitalTool { get; set; }
    public string? ExistingToolName { get; set; }
    public int? TimelineMonths { get; set; }
    public string? InterestModulesJson { get; set; }
    public string? BudgetIndication { get; set; }
    public string? Notes { get; set; }
    public decimal? FitScore { get; set; }
    public string? FitBreakdownJson { get; set; }
    public string Stage { get; set; } = "new";
    public int? AssignedTo { get; set; }
    public DateTime? ProposalSentAt { get; set; }
    public DateTime? PilotAgreedAt { get; set; }
    public DateTime? WentLiveAt { get; set; }
    public string? RejectionReason { get; set; }
    public string? InternalNotes { get; set; }
    public string? Source { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
