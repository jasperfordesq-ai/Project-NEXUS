// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a staffing prediction for a given date, optionally tied to a specific opportunity.
/// Used by the predictive staffing system to forecast volunteer shortfalls.
/// </summary>
public class StaffingPrediction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Optional opportunity this prediction is for. Null means tenant-wide prediction.
    /// </summary>
    public int? OpportunityId { get; set; }

    /// <summary>
    /// The date being predicted for.
    /// </summary>
    public DateTime PredictedDate { get; set; }

    /// <summary>
    /// Predicted number of volunteers needed on that date.
    /// </summary>
    public int PredictedVolunteersNeeded { get; set; }

    /// <summary>
    /// Predicted number of volunteers available on that date.
    /// </summary>
    public int PredictedVolunteersAvailable { get; set; }

    /// <summary>
    /// Probability of understaffing (0.0 = no risk, 1.0 = certain shortfall).
    /// </summary>
    [Column(TypeName = "numeric(3,2)")]
    public decimal ShortfallRisk { get; set; }

    /// <summary>
    /// JSON-encoded factors explaining the prediction.
    /// </summary>
    public string? Factors { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public VolunteerOpportunity? Opportunity { get; set; }
}
