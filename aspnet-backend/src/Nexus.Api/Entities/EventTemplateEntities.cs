// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

public sealed class EventTemplate : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public Guid PublicId { get; set; }
    public int SourceEventId { get; set; }
    public int CurrentVersion { get; set; } = 1;
    public string Status { get; set; } = "active";
    public int CreatedByUserId { get; set; }
    public int? ArchivedByUserId { get; set; }
    public DateTime? ArchivedAt { get; set; }
    public string? ArchiveReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventTemplateVersion : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long TemplateId { get; set; }
    public int SourceEventId { get; set; }
    public int VersionNumber { get; set; }
    public short SchemaVersion { get; set; } = 2;
    public string Payload { get; set; } = "{}";
    public string PayloadHash { get; set; } = string.Empty;
    public string CopiedFields { get; set; } = "[]";
    public string SkippedFields { get; set; } = "[]";
    public long SourceLifecycleVersion { get; set; }
    public long SourceCalendarSequence { get; set; }
    public DateTime? SourceUpdatedAt { get; set; }
    public int CapturedByUserId { get; set; }
    public string CaptureIdempotencyHash { get; set; } = string.Empty;
    public string CaptureRequestHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventTemplateMaterialization : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long TemplateId { get; set; }
    public long TemplateVersionId { get; set; }
    public int TemplateVersionNumber { get; set; }
    public int SourceEventId { get; set; }
    public int CreatedEventId { get; set; }
    public int MaterializedByUserId { get; set; }
    public short SchemaVersion { get; set; } = 2;
    public string TemplatePayloadHash { get; set; } = string.Empty;
    public string EffectivePayloadHash { get; set; } = string.Empty;
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public DateTime ScheduleStartUtc { get; set; }
    public DateTime? ScheduleEndUtc { get; set; }
    public string ScheduleTimezone { get; set; } = "UTC";
    public bool ScheduleAllDay { get; set; }
    public string OverrideFields { get; set; } = "[]";
    public bool FederationNormalized { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventTemplateAudit : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long TemplateId { get; set; }
    public long? TemplateVersionId { get; set; }
    public int TemplateVersionNumber { get; set; }
    public int SourceEventId { get; set; }
    public int? MaterializedEventId { get; set; }
    public string Action { get; set; } = string.Empty;
    public int ActorUserId { get; set; }
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
