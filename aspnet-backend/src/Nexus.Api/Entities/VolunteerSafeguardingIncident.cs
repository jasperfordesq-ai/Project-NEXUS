// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A safeguarding concern raised during volunteering. Mirrors Laravel's
/// <c>vol_safeguarding_incidents</c>.
///
/// 🔴 Why this exists (R-27), and it is the most serious gap found in this
/// backend so far. A volunteer could report a safeguarding concern — a
/// disclosure, an allegation, a concern about a child or an at-risk adult — and
/// receive "Incident recorded". Nothing recorded it anywhere anyone could read:
/// the POST wrote the request body as an opaque blob into tenant config under
/// <c>compat:vol-incident:</c>, the member's list returned a hardcoded empty
/// array, the single-incident endpoint fabricated <c>{id, status:"open"}</c> for
/// any id at all, and no admin surface read incidents. So the report was
/// accepted, acknowledged, and lost, and neither the reporter nor a safeguarding
/// lead had any way to notice.
///
/// Design notes that are safeguarding requirements, not preferences:
///
/// <list type="bullet">
/// <item><description>A reporter can never delete a report. Once raised, a
/// concern is a record; withdrawal is a status a safeguarding lead sets, with a
/// reason, not an erasure.</description></item>
/// <item><description>The reporter's identity is always stored. Anonymous
/// safeguarding reports cannot be followed up, and the person who raised the
/// concern is usually the only witness.</description></item>
/// <item><description>Severity and status are closed vocabularies matching
/// Laravel's enums, so a report cannot arrive in a state no queue looks
/// at.</description></item>
/// </list>
/// </summary>
public class VolunteerSafeguardingIncident : ITenantEntity
{
    public static class IncidentTypes
    {
        public const string Concern = "concern";
        public const string Allegation = "allegation";
        public const string Disclosure = "disclosure";
        public const string NearMiss = "near_miss";
        public const string Other = "other";

        public static readonly string[] All = [Concern, Allegation, Disclosure, NearMiss, Other];
    }

    public static class Severities
    {
        public const string Low = "low";
        public const string Medium = "medium";
        public const string High = "high";
        public const string Critical = "critical";

        public static readonly string[] All = [Low, Medium, High, Critical];
    }

    public static class Statuses
    {
        public const string Open = "open";
        public const string Investigating = "investigating";
        public const string Resolved = "resolved";
        public const string Escalated = "escalated";
        public const string Closed = "closed";

        public static readonly string[] All = [Open, Investigating, Resolved, Escalated, Closed];
    }

    public int Id { get; set; }
    public int TenantId { get; set; }

    public int? ShiftId { get; set; }
    public int? OpportunityId { get; set; }
    public int? OrganizationId { get; set; }

    /// <summary>Never null: an anonymous safeguarding report cannot be followed up.</summary>
    public int ReportedBy { get; set; }

    [MaxLength(255)]
    public string? Title { get; set; }

    public int? SubjectUserId { get; set; }
    public int? InvolvedUserId { get; set; }

    [MaxLength(30)]
    public string IncidentType { get; set; } = IncidentTypes.Concern;

    [MaxLength(100)]
    public string? Category { get; set; } = "general";

    [MaxLength(20)]
    public string Severity { get; set; } = Severities.Medium;

    public DateOnly? IncidentDate { get; set; }

    public string Description { get; set; } = string.Empty;
    public string? ActionTaken { get; set; }

    /// <summary>Designated safeguarding lead, and when they were told.</summary>
    public int? DlpUserId { get; set; }
    public DateTime? DlpNotifiedAt { get; set; }

    public int? AssignedTo { get; set; }

    public bool AuthorityNotified { get; set; }

    [MaxLength(100)]
    public string? AuthorityReference { get; set; }

    [MaxLength(20)]
    public string Status { get; set; } = Statuses.Open;

    public DateTime? ResolvedAt { get; set; }
    public string? ResolutionNotes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Reporter { get; set; }
}
