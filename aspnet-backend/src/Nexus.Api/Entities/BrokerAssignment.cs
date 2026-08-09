// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class BrokerAssignment : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int BrokerId { get; set; }
    public int MemberId { get; set; }
    public string Status { get; set; } = "active";
    public string? Notes { get; set; }
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public Tenant? Tenant { get; set; }
    public User? Broker { get; set; }
    public User? Member { get; set; }
}

public class BrokerNote : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int BrokerId { get; set; }
    public int? MemberId { get; set; }
    public int? ExchangeId { get; set; }
    public string Content { get; set; } = string.Empty;
    public bool IsPrivate { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Tenant? Tenant { get; set; }
    public User? Broker { get; set; }
    public User? Member { get; set; }
}

public class EnterpriseConfig
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? Description { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
