// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Global-or-tenant cookie disclosure inventory entry.
/// Mirrors Laravel's cookie_inventory table.
/// </summary>
public sealed class CookieInventoryItem
{
    public int Id { get; set; }
    public string CookieName { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Purpose { get; set; } = string.Empty;
    public string Duration { get; set; } = string.Empty;
    public string? ThirdParty { get; set; }
    public int? TenantId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
