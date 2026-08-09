// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Interface for domain-grouped entity configurations.
/// Each implementation configures multiple related entities for a domain area.
/// </summary>
public interface IEntityGroupConfiguration
{
    void Configure(ModelBuilder modelBuilder);
}
