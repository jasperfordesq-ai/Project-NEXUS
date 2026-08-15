// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a tenant (organization/community) in the system.
/// Tenants are the top-level isolation boundary.
/// </summary>
public class Tenant
{
    public int Id { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Tagline { get; set; }
    public string? Domain { get; set; }
    public string? LogoUrl { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // ── Hierarchy ────────────────────────────────────────────────────────────
    // 🔴 Added 2026-08-15. Until then this backend had NO tenant hierarchy at
    // all, while Laravel's entire hub/sub-tenant model rests on it. Two
    // consequences followed: GET super/tenants/hierarchy returned a hardcoded
    // empty array, and — the serious one — a regional (hub) super admin could
    // not be confined to their own communities, because the boundary they are
    // confined by did not exist. See docs/PRODUCTION_READINESS_REMEDIATION.md
    // (R-3, R-4). Column semantics mirror Laravel's tenants table exactly.

    /// <summary>Parent tenant. NULL = root/master level.</summary>
    public int? ParentId { get; set; }

    /// <summary>
    /// Materialised path for fast descendant queries, e.g. <c>/1/2/5/</c>.
    /// 🔴 Nullable by design, and an EMPTY path must never be treated as a
    /// wildcard: a prefix match against "" matches every tenant. Anything
    /// deciding scope from this must deny on an empty path, not resolve to
    /// "everything" — Laravel records the same trap at SuperPanelAccess.php:150-166.
    /// </summary>
    public string? Path { get; set; }

    /// <summary>0 = master, 1 = regional, 2 = local, and so on.</summary>
    public int Depth { get; set; }

    /// <summary>May admins of this tenant create sub-tenants?</summary>
    public bool AllowsSubtenants { get; set; }

    /// <summary>Maximum depth of sub-tenants allowed below this tenant.</summary>
    public int MaxDepth { get; set; }

    public Tenant? Parent { get; set; }
    public ICollection<Tenant> Children { get; set; } = new List<Tenant>();
}
