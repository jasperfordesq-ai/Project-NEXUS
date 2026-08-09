// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

public class RecurringShiftPattern : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int OpportunityId { get; set; }
    public int CreatedBy { get; set; }
    [MaxLength(255)] public string? Title { get; set; }
    [MaxLength(20)] public string Frequency { get; set; } = "weekly";
    [MaxLength(50)] public string? DaysOfWeek { get; set; }
    public TimeSpan StartTime { get; set; }
    public TimeSpan EndTime { get; set; }
    public int SpotsPerShift { get; set; } = 1;
    public int Capacity { get; set; } = 1;
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public int? MaxOccurrences { get; set; }
    public int OccurrencesGenerated { get; set; } = 0;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public Tenant? Tenant { get; set; }
    public VolunteerOpportunity? Opportunity { get; set; }
    public User? Creator { get; set; }
    public ICollection<VolunteerShift> GeneratedShifts { get; set; } = new List<VolunteerShift>();
}
