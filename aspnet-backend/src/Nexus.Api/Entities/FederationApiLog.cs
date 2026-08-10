// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Audit log for external federation API calls.
/// Tracks all inbound and outbound federation API requests.
/// </summary>
public class FederationApiLog
{
    public int Id { get; set; }

    /// <summary>The tenant that owns the API key used.</summary>
    public int? TenantId { get; set; }

    /// <summary>ID of the API key used (if authenticated).</summary>
    public int? ApiKeyId { get; set; }

    [MaxLength(10)]
    public string HttpMethod { get; set; } = string.Empty;

    [MaxLength(500)]
    public string Path { get; set; } = string.Empty;

    public int StatusCode { get; set; }

    /// <summary>IP address of the caller.</summary>
    [MaxLength(45)]
    public string? IpAddress { get; set; }

    /// <summary>Duration in milliseconds.</summary>
    public int DurationMs { get; set; }

    /// <summary>"inbound" or "outbound".</summary>
    [MaxLength(10)]
    public string Direction { get; set; } = "inbound";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public FederationApiKey? ApiKey { get; set; }
}
