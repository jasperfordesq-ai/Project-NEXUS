// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Base class for domain-grouped entity configurations that need tenant context
/// for global query filters.
/// </summary>
public abstract class TenantScopedConfiguration : IEntityGroupConfiguration
{
    protected readonly TenantContext TenantContext;

    protected TenantScopedConfiguration(TenantContext tenantContext)
    {
        TenantContext = tenantContext;
    }

    public abstract void Configure(ModelBuilder modelBuilder);
}
