// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Ai;

/// <summary>
/// One retrieval result from the semantic index.
/// </summary>
public record KnowledgeHit(int ChunkId, string SourceType, int SourceId, string Title, string Content, string MetadataJson, float Score);

/// <summary>
/// Read-side of the per-tenant knowledge index. Embeds the query via the
/// active <see cref="IEmbeddingProvider"/>, fetches candidate chunks under
/// the tenant + provider/model filter, and ranks them by cosine similarity.
/// </summary>
public class AiKnowledgeService
{
    private readonly NexusDbContext _db;
    private readonly IEmbeddingProviderFactory _embeddingFactory;
    private readonly ILogger<AiKnowledgeService> _logger;

    public AiKnowledgeService(NexusDbContext db, IEmbeddingProviderFactory embeddingFactory, ILogger<AiKnowledgeService> logger)
    {
        _db = db;
        _embeddingFactory = embeddingFactory;
        _logger = logger;
    }

    public async Task<IReadOnlyList<KnowledgeHit>> SearchAsync(
        int tenantId,
        string query,
        int k = 8,
        IReadOnlyCollection<string>? sourceTypes = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query) || k <= 0) return Array.Empty<KnowledgeHit>();

        var provider = _embeddingFactory.Resolve();
        if (!provider.IsConfigured)
        {
            _logger.LogDebug("Knowledge search skipped: embedding provider {Name} not configured", provider.Name);
            return Array.Empty<KnowledgeHit>();
        }

        var queryVec = await provider.EmbedAsync(query, ct);
        if (queryVec.Length == 0) return Array.Empty<KnowledgeHit>();

        var providerName = provider.Name;
        var providerModel = provider.Model;

        var q = _db.KnowledgeChunks.IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId
                        && c.EmbeddingProvider == providerName
                        && c.EmbeddingModel == providerModel);

        if (sourceTypes != null && sourceTypes.Count > 0)
        {
            var typesList = sourceTypes.ToList();
            q = q.Where(c => typesList.Contains(c.SourceType));
        }

        var rows = await q
            .Select(c => new
            {
                c.Id, c.SourceType, c.SourceId, c.Title, c.Content, c.MetadataJson, c.Embedding
            })
            .ToListAsync(ct);

        var queryNorm = Norm(queryVec);
        if (queryNorm == 0f) return Array.Empty<KnowledgeHit>();

        var scored = new List<KnowledgeHit>(rows.Count);
        foreach (var r in rows)
        {
            if (r.Embedding == null || r.Embedding.Length != queryVec.Length) continue;
            var sim = Cosine(queryVec, queryNorm, r.Embedding);
            scored.Add(new KnowledgeHit(r.Id, r.SourceType, r.SourceId, r.Title, r.Content, r.MetadataJson, sim));
        }

        return scored
            .OrderByDescending(h => h.Score)
            .Take(k)
            .ToList();
    }

    /// <summary>
    /// Render a list of hits into a compact block suitable for inclusion in a
    /// system prompt. Each entry is numbered, labelled with its source, and
    /// truncated to the first 600 characters of content.
    /// </summary>
    public static string FormatForPrompt(IReadOnlyList<KnowledgeHit> hits)
    {
        if (hits.Count == 0) return "(no relevant platform context found)";
        var sb = new System.Text.StringBuilder();
        for (var i = 0; i < hits.Count; i++)
        {
            var h = hits[i];
            var snippet = h.Content.Length > 600 ? h.Content.Substring(0, 600) + "…" : h.Content;
            sb.Append('[').Append(i + 1).Append("] (").Append(h.SourceType).Append(" #").Append(h.SourceId).Append(") ")
              .Append(h.Title).Append('\n').Append(snippet).Append('\n').Append('\n');
        }
        return sb.ToString().TrimEnd();
    }

    private static float Norm(float[] v)
    {
        double s = 0;
        for (var i = 0; i < v.Length; i++) s += (double)v[i] * v[i];
        return (float)Math.Sqrt(s);
    }

    private static float Cosine(float[] a, float aNorm, float[] b)
    {
        double dot = 0; double bNorm2 = 0;
        for (var i = 0; i < a.Length; i++)
        {
            dot += (double)a[i] * b[i];
            bNorm2 += (double)b[i] * b[i];
        }
        var bNorm = Math.Sqrt(bNorm2);
        if (aNorm == 0 || bNorm == 0) return 0f;
        return (float)(dot / (aNorm * bNorm));
    }
}
