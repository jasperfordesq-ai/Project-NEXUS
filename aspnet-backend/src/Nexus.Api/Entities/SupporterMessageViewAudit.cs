// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// One immutable row per supervised message view — Laravel parity for
/// supporter_message_view_audits. Written BEFORE any data is fetched, so
/// there can never be a view without its record; a database trigger refuses
/// UPDATE. The purpose is the supporter's own stated reason, required on
/// every view.
/// </summary>
public class SupporterMessageViewAudit : ITenantEntity
{
    public const string ActionList = "list";
    public const string ActionRead = "read";

    public long Id { get; set; }
    public int TenantId { get; set; }
    public int RelationshipId { get; set; }
    public int SupporterUserId { get; set; }
    public int SupportedUserId { get; set; }
    public int? PartnerUserId { get; set; }
    public string Action { get; set; } = ActionList;
    public string Purpose { get; set; } = string.Empty;
    public string CorrelationHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
}
