// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A single embedded chunk in the per-tenant semantic knowledge index.
/// Each row represents one searchable piece of platform content (a listing,
/// a user profile, a blog paragraph, an FAQ, etc.) with its dense vector
/// embedding. <see cref="ContentHash"/> + (<see cref="EmbeddingProvider"/>,
/// <see cref="EmbeddingModel"/>) lets the indexer skip work when nothing
/// has changed.
/// </summary>
public class KnowledgeChunk : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>Lowercase source-table key e.g. "listing", "user", "blog".</summary>
    public string SourceType { get; set; } = string.Empty;

    /// <summary>Primary key of the source row.</summary>
    public int SourceId { get; set; }

    /// <summary>
    /// For long-form content split across multiple chunks. 0 for short rows.
    /// </summary>
    public int ChunkIndex { get; set; }

    /// <summary>The text that was embedded.</summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>Display label used when rendering retrieved hits.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>Dense float vector, stored as PG real[].</summary>
    public float[] Embedding { get; set; } = Array.Empty<float>();

    /// <summary>e.g. "ollama" / "openai".</summary>
    public string EmbeddingProvider { get; set; } = string.Empty;

    /// <summary>Model identifier the embedding was produced by.</summary>
    public string EmbeddingModel { get; set; } = string.Empty;

    /// <summary>SHA-256 hex of <see cref="Content"/> — used to skip no-op reindexes.</summary>
    public string ContentHash { get; set; } = string.Empty;

    /// <summary>Arbitrary per-source metadata (jsonb).</summary>
    public string MetadataJson { get; set; } = "{}";

    /// <summary>The source row's UpdatedAt (or CreatedAt) when last indexed.</summary>
    public DateTime SourceUpdatedAt { get; set; }

    /// <summary>When this chunk was (re)embedded.</summary>
    public DateTime IndexedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
}
