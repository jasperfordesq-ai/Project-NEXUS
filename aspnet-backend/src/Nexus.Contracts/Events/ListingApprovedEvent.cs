// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Contracts.Events;

/// <summary>
/// Published when an admin approves a pending listing.
/// </summary>
public class ListingApprovedEvent : IntegrationEvent
{
    public override string EventType => "listing.approved";

    public int ListingId { get; init; }
    public int ApprovedByUserId { get; init; }
}
