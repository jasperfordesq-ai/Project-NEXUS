// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Nexus.Api.Entities;

/// <summary>
/// Typed audit row for V2 admin parity / compatibility write captures.
///
/// Replaces the legacy approach of serializing JSON blobs into a
/// <see cref="TenantConfig"/> entry under the key
/// <c>admin_explicit.compatibility_writes</c>. Each row records one inbound
/// admin request that was accepted by the strangler-fig parity layer for
/// later replay or auditing, without committing to a typed domain entity.
///
/// Tenant-scoped via <see cref="ITenantEntity"/> (EF global query filter).
/// </summary>
public class CompatibilityAuditEntry : ITenantEntity
{
    public int Id { get; set; }

    public int TenantId { get; set; }

    /// <summary>
    /// Admin user who issued the request, when resolvable. Null for
    /// anonymous-but-tenant-scoped paths or when the JWT did not carry a
    /// numeric subject claim.
    /// </summary>
    public int? UserId { get; set; }

    /// <summary>
    /// Inbound URL path, e.g. <c>/api/v2/admin/ad-campaigns/42/approve</c>.
    /// </summary>
    [Required]
    [MaxLength(500)]
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>
    /// HTTP verb (uppercase): GET, POST, PUT, PATCH, DELETE.
    /// </summary>
    [Required]
    [MaxLength(10)]
    public string HttpMethod { get; set; } = string.Empty;

    /// <summary>
    /// Logical action label captured by the parity helper
    /// (post / put / patch / delete).
    /// </summary>
    [MaxLength(20)]
    public string? Action { get; set; }

    /// <summary>
    /// Raw inbound request payload, stored as PostgreSQL jsonb. Always
    /// well-formed JSON (the writer normalises malformed payloads to
    /// <c>{ "raw": "..." }</c> before persisting).
    /// </summary>
    [Column(TypeName = "jsonb")]
    public string RequestBody { get; set; } = "{}";

    /// <summary>
    /// Response payload echoed back to the client, also jsonb. Stored so
    /// that <c>GetPersistedCompatibilityRead</c> can replay the most
    /// recent matching response without re-running the parity logic.
    /// </summary>
    [Column(TypeName = "jsonb")]
    public string ResponseBody { get; set; } = "{}";

    /// <summary>
    /// HTTP status code returned to the client (typically 202 for the
    /// Accepted parity write path).
    /// </summary>
    public int StatusCode { get; set; }

    /// <summary>
    /// When the entry was recorded (server time).
    /// </summary>
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
