// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

public sealed class EventRecurrenceRule : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public string Frequency { get; set; } = "daily";
    public int Interval { get; set; } = 1;
    public string? DaysOfWeek { get; set; }
    public int? DayOfMonth { get; set; }
    public string EndsType { get; set; } = "after_count";
    public int? EndsAfterCount { get; set; }
    public DateTime? EndsOnDate { get; set; }
    public string RRule { get; set; } = string.Empty;
    public string ExDates { get; set; } = "[]";
    public string RDates { get; set; } = "[]";
    public string RecurrenceEngine { get; set; } = "sabre-vobject";
    public string RecurrenceEngineVersion { get; set; } = "2";
    public string RuleHash { get; set; } = string.Empty;
    public long EffectiveRevisionVersion { get; set; }
    public long MaterializedSetVersion { get; set; }
    public DateTime? MaterializedThroughAt { get; set; }
    public DateTime? MaterializationResumeAt { get; set; }
    public DateTime? MaterializationLastAttemptedAt { get; set; }
    public DateTime? MaterializationLastSucceededAt { get; set; }
    public DateTime? MaterializationLastFailedAt { get; set; }
    public string? MaterializationErrorCode { get; set; }
    public bool MaterializationTruncated { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public sealed class EventRecurrenceRevision : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int RootEventId { get; set; }
    public long RevisionVersion { get; set; }
    public string EffectiveFromRecurrenceId { get; set; } = string.Empty;
    public DateTime EffectiveFromUtc { get; set; }
    public string? EffectiveUntilRecurrenceId { get; set; }
    public DateTime? EffectiveUntilUtc { get; set; }
    public string CanonicalTimezone { get; set; } = "UTC";
    public string CanonicalRRule { get; set; } = string.Empty;
    public string RuleHash { get; set; } = string.Empty;
    public string BlueprintPatch { get; set; } = "{}";
    public string PatchHash { get; set; } = string.Empty;
    public int ActorUserId { get; set; }
    public long RootCalendarSequence { get; set; }
    public long RuleVersion { get; set; }
    public long MaterializedSetVersion { get; set; }
    public string MaterializedChecksumBefore { get; set; } = string.Empty;
    public string MaterializedChecksumAfter { get; set; } = string.Empty;
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public string ImpactSummary { get; set; } = "{}";
    public DateTime PreviewedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRecurrenceOccurrenceLedger : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int RootEventId { get; set; }
    public int EventId { get; set; }
    public string RecurrenceId { get; set; } = string.Empty;
    public string OccurrenceKey { get; set; } = string.Empty;
    public string State { get; set; } = "materialized";
    public long StateVersion { get; set; }
    public long? RevisionVersion { get; set; }
    public DateTime? StartTimeUtc { get; set; }
    public DateTime? EndTimeUtc { get; set; }
    public int? ActorUserId { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRecurrenceDefinitionBlueprint : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int RootEventId { get; set; }
    public int SourceEventId { get; set; }
    public string SourceRecurrenceId { get; set; } = string.Empty;
    public string SourceOccurrenceKey { get; set; } = string.Empty;
    public int BlueprintVersion { get; set; }
    public int SchemaVersion { get; set; } = 1;
    public string EffectiveFromRecurrenceId { get; set; } = string.Empty;
    public string SelectedSections { get; set; } = "{}";
    public string Manifest { get; set; } = "{}";
    public string ManifestHash { get; set; } = string.Empty;
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public int? CapturedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRecurrenceDefinitionApplication : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int RootEventId { get; set; }
    public int EventId { get; set; }
    public string RecurrenceId { get; set; } = string.Empty;
    public long BlueprintId { get; set; }
    public int BlueprintVersion { get; set; }
    public string ManifestHash { get; set; } = string.Empty;
    public string ApplicationHash { get; set; } = string.Empty;
    public string AppliedCounts { get; set; } = "{}";
    public string Status { get; set; } = "applied";
    public int? AppliedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
