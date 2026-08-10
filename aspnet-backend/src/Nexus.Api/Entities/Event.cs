// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Community event, optionally associated with a group.
/// Events have a date/time, location, and RSVP functionality.
/// </summary>
public class Event : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// User who created the event.
    /// </summary>
    public int CreatedById { get; set; }

    /// <summary>
    /// Optional group this event belongs to. Null for community-wide events.
    /// </summary>
    public int? GroupId { get; set; }

    /// <summary>
    /// Event title.
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Detailed description of the event.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Physical or virtual location.
    /// </summary>
    public string? Location { get; set; }

    /// <summary>
    /// When the event starts.
    /// </summary>
    public DateTime StartsAt { get; set; }

    /// <summary>
    /// When the event ends (optional).
    /// </summary>
    public DateTime? EndsAt { get; set; }

    /// <summary>
    /// Maximum number of attendees (null = unlimited).
    /// </summary>
    public int? MaxAttendees { get; set; }

    /// <summary>
    /// Optional image URL for the event.
    /// </summary>
    public string? ImageUrl { get; set; }
    public int? CategoryId { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public bool IsOnline { get; set; }
    public bool AllowRemoteAttendance { get; set; }
    public string Timezone { get; set; } = "UTC";
    public bool AllDay { get; set; }
    public string FederatedVisibility { get; set; } = "none";
    public long FederationVersion { get; set; } = 1;
    public long CalendarSequence { get; set; }
    public long AgendaVersion { get; set; }
    public long CheckinManifestVersion { get; set; }
    public int? ParentEventId { get; set; }
    public int? SeriesId { get; set; }
    public string? OccurrenceKey { get; set; }
    public bool IsRecurringTemplate { get; set; }
    public string? RecurrenceEngine { get; set; }
    public string? RecurrenceEngineVersion { get; set; }
    public string? RecurrenceId { get; set; }
    public bool IsRecurrenceException { get; set; }
    public string? RecurrenceOverrideFields { get; set; }
    public long RecurrenceOverrideVersion { get; set; }
    public DateTime? RecurrenceOverrideUpdatedAt { get; set; }
    public int? RecurrenceOverrideUpdatedBy { get; set; }
    public string? OnlineLink { get; set; }
    public string? VideoUrl { get; set; }
    public bool? AccessibilityStepFree { get; set; }
    public bool? AccessibilityToilet { get; set; }
    public bool? AccessibilityHearingLoop { get; set; }
    public bool? AccessibilityQuietSpace { get; set; }
    public bool? AccessibilitySeating { get; set; }
    public bool? AccessibilityParking { get; set; }
    public string? AccessibilityParkingDetails { get; set; }
    public string? AccessibilityTransitDetails { get; set; }
    public string? AccessibilityAssistanceContact { get; set; }
    public string? AccessibilityNotes { get; set; }

    /// <summary>
    /// Whether the event has been cancelled.
    /// </summary>
    public bool IsCancelled { get; set; } = false;
    public string Status { get; set; } = "active";
    public string PublicationStatus { get; set; } = "published";
    public string OperationalStatus { get; set; } = "scheduled";
    public long LifecycleVersion { get; set; }
    public string? LifecycleReason { get; set; }
    public DateTime? PublicationStatusChangedAt { get; set; }
    public int? PublicationStatusChangedBy { get; set; }
    public DateTime? OperationalStatusChangedAt { get; set; }
    public int? OperationalStatusChangedBy { get; set; }
    public DateTime? ModerationSubmittedAt { get; set; }
    public int? ModerationSubmittedBy { get; set; }
    public DateTime? ModeratedAt { get; set; }
    public int? ModeratedBy { get; set; }
    public string? ModerationReason { get; set; }
    public DateTime? CancelledAt { get; set; }
    public int? CancelledBy { get; set; }
    public string? CancellationReason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
    public Group? Group { get; set; }
    public ICollection<EventRsvp> Rsvps { get; set; } = new List<EventRsvp>();

    /// <summary>
    /// RSVP status constants.
    /// </summary>
    public static class RsvpStatus
    {
        public const string Going = "going";
        public const string Maybe = "maybe";
        public const string NotGoing = "not_going";
    }
}
