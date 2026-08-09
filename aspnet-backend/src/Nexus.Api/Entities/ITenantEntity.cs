// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Marker interface for entities that belong to a tenant.
/// All tenant-scoped entities must implement this interface.
/// </summary>
public interface ITenantEntity
{
    int TenantId { get; set; }
}
