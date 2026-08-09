// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public sealed class MessageReaction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int MessageId { get; set; }
    public int UserId { get; set; }
    public string Emoji { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Tenant? Tenant { get; set; }
    public Message? Message { get; set; }
    public User? User { get; set; }
}
