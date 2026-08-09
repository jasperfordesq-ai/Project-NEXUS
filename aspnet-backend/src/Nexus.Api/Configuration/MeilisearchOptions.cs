// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Configuration;

/// <summary>
/// Configuration for Meilisearch full-text search engine.
/// </summary>
public class MeilisearchOptions
{
    public const string SectionName = "Meilisearch";

    /// <summary>
    /// Base URL of the Meilisearch instance (e.g. "http://meilisearch:7700").
    /// </summary>
    public string BaseUrl { get; set; } = "http://localhost:7700";

    /// <summary>
    /// Master API key for Meilisearch authentication.
    /// </summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>
    /// Whether Meilisearch integration is enabled.
    /// When false, search falls back to PostgreSQL ILIKE.
    /// </summary>
    public bool Enabled { get; set; } = false;

    /// <summary>
    /// Prefix for index names (e.g. "nexus_tenant1_listings").
    /// </summary>
    public string IndexPrefix { get; set; } = "nexus";

    /// <summary>
    /// Timeout in seconds for Meilisearch API calls.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 10;
}
