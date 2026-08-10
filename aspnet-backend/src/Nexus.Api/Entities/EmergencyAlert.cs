// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class EmergencyAlert : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Urgency { get; set; } = "medium"; // low, medium, high, critical
    public string? ContactInfo { get; set; }
    public int? VolunteerOpportunityId { get; set; }
    public bool IsActive { get; set; } = true;
    public int CreatedById { get; set; }
    public int? ResolvedById { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
}
