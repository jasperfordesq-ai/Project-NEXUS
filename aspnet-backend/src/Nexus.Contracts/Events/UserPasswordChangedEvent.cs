// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Contracts.Events;

/// <summary>
/// Published when a user's password is changed or reset.
/// Does NOT contain the password hash - just notification.
/// </summary>
public class UserPasswordChangedEvent : IntegrationEvent
{
    public override string EventType => "user.password_changed";

    public int UserId { get; init; }

    /// <summary>
    /// Whether this was a reset (via token) or a regular change.
    /// </summary>
    public bool WasReset { get; init; }
}
