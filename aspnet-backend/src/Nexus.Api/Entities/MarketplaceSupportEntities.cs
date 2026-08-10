// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-scoped dynamic field definition for a marketplace category.
/// Mirrors Laravel's marketplace_category_templates table.
/// </summary>
public sealed class MarketplaceCategoryTemplate
{
    public long Id { get; set; }
    public int? TenantId { get; set; }
    public int? CategoryId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string FieldsJson { get; set; } = "[]";
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>
/// Durable bell/email outbox row for marketplace report lifecycle events.
/// Mirrors Laravel's marketplace_report_notifications table.
/// </summary>
public sealed class MarketplaceReportNotification : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int MarketplaceReportId { get; set; }
    public int RecipientUserId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string Channel { get; set; } = string.Empty;
    public string DedupeKey { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public int Attempts { get; set; }
    public string? LastError { get; set; }
    public DateTime? LastAttemptedAt { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime? NextRetryAt { get; set; }
    public string? PayloadJson { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
