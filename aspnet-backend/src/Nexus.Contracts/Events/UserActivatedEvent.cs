// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Contracts.Events;

/// <summary>
/// Published when an admin reactivates a suspended user.
/// </summary>
public class UserActivatedEvent : IntegrationEvent
{
    public override string EventType => "user.activated";

    public int UserId { get; init; }
    public int ActivatedByUserId { get; init; }
}
