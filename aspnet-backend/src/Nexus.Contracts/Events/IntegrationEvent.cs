// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Contracts.Events;

/// <summary>
/// Base class for all integration events published between microservices.
/// </summary>
public abstract class IntegrationEvent
{
    /// <summary>
    /// Unique identifier for this event instance.
    /// </summary>
    public Guid EventId { get; init; } = Guid.NewGuid();

    /// <summary>
    /// UTC timestamp when the event was created.
    /// </summary>
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;

    /// <summary>
    /// Tenant ID for multi-tenant isolation.
    /// </summary>
    public int TenantId { get; init; }

    /// <summary>
    /// Event type name for routing (e.g., "user.created").
    /// </summary>
    public abstract string EventType { get; }
}
