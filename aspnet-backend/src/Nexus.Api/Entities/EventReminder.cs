// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class EventReminder : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int UserId { get; set; }
    public int MinutesBefore { get; set; } = 60;
    public string ReminderType { get; set; } = "notification";
    public bool IsSent { get; set; }
    public string Status { get; set; } = "pending";
    public string? ClosedReason { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public Tenant? Tenant { get; set; }
    public Event? Event { get; set; }
    public User? User { get; set; }
}
