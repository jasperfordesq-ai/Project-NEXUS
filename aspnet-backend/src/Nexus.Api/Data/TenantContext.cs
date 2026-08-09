// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Data;

/// <summary>
/// Holds the current tenant context for the request.
/// Scoped lifetime - one instance per HTTP request.
/// </summary>
public class TenantContext
{
    public int? TenantId { get; private set; }
    public bool IsResolved => TenantId.HasValue;

    public void SetTenant(int tenantId)
    {
        if (TenantId.HasValue)
        {
            throw new InvalidOperationException("Tenant has already been set for this request.");
        }
        TenantId = tenantId;
    }

    public int GetTenantIdOrThrow()
    {
        if (!TenantId.HasValue)
        {
            throw new InvalidOperationException("Tenant context has not been resolved.");
        }
        return TenantId.Value;
    }
}
