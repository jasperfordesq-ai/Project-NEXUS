// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Ai;

/// <summary>
/// Builds and maintains the per-tenant semantic index. Reads the source
/// tables (Listings, Users + Skills, Groups, Events, BlogPosts, KB
/// articles, FAQs), produces one or more <see cref="KnowledgeChunk"/>
/// rows per source row, and embeds them via the active
/// <see cref="IEmbeddingProvider"/>.
///
/// Idempotent: re-running over an already-indexed source skips work
/// unless <see cref="KnowledgeChunk.ContentHash"/> changed.
/// </summary>
public class KnowledgeIndexerService
{
    private readonly NexusDbContext _db;
    private readonly IEmbeddingProviderFactory _embeddingFactory;
    private readonly ILogger<KnowledgeIndexerService> _logger;

    private const int MaxChunkChars = 1800;     // ~450 tokens per chunk
    private const int BatchEmbedSize = 32;      // OpenAI sweet spot

    public KnowledgeIndexerService(NexusDbContext db, IEmbeddingProviderFactory embeddingFactory, ILogger<KnowledgeIndexerService> logger)
    {
        _db = db;
        _embeddingFactory = embeddingFactory;
        _logger = logger;
    }

    /// <summary>
    /// Run a full reindex pass for one tenant. Returns a summary of what
    /// was added / updated / skipped.
    /// </summary>
    public async Task<IndexerReport> ReindexTenantAsync(int tenantId, CancellationToken ct = default)
    {
        var report = new IndexerReport { TenantId = tenantId };
        var provider = _embeddingFactory.Resolve();
        if (!provider.IsConfigured)
        {
            _logger.LogWarning("Embedding provider {Name} not configured; skipping reindex of tenant {TenantId}", provider.Name, tenantId);
            report.Notes = "embedding_provider_unconfigured";
            return report;
        }

        await IndexListingsAsync(tenantId, provider, report, ct);
        await IndexUsersAsync(tenantId, provider, report, ct);
        await IndexSkillsAsync(tenantId, provider, report, ct);
        await IndexGroupsAsync(tenantId, provider, report, ct);
        await IndexEventsAsync(tenantId, provider, report, ct);
        await IndexBlogPostsAsync(tenantId, provider, report, ct);
        await IndexKnowledgeArticlesAsync(tenantId, provider, report, ct);
        await IndexFaqsAsync(tenantId, provider, report, ct);

        _logger.LogInformation("Reindex tenant {TenantId}: added={Added} updated={Updated} skipped={Skipped}",
            tenantId, report.Added, report.Updated, report.Skipped);
        return report;
    }

    // ─── Per-source indexers ─────────────────────────────────────────────

    private async Task IndexListingsAsync(int tenantId, IEmbeddingProvider provider, IndexerReport report, CancellationToken ct)
    {
        var listings = await _db.Set<Listing>()
            .IgnoreQueryFilters()
            .Where(l => l.TenantId == tenantId && l.DeletedAt == null && l.Status == ListingStatus.Active)
            .Select(l => new { l.Id, l.Title, l.Description, l.Location, l.EstimatedHours, l.CategoryId, l.CreatedAt, l.UpdatedAt })
            .ToListAsync(ct);

        foreach (var l in listings)
        {
            ct.ThrowIfCancellationRequested();
            var body = $"Listing: {l.Title}\n{l.Description}\nLocation: {l.Location ?? "n/a"}\nEstimated hours: {l.EstimatedHours?.ToString() ?? "n/a"}";
            var meta = JsonSerializer.Serialize(new { l.CategoryId, l.Location, l.EstimatedHours });
            await UpsertChunkAsync(tenantId, "listing", l.Id, l.Title, body, meta, l.UpdatedAt ?? l.CreatedAt, provider, report, ct);
        }
    }

    private async Task IndexUsersAsync(int tenantId, IEmbeddingProvider provider, IndexerReport report, CancellationToken ct)
    {
        var users = await _db.Set<User>()
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == tenantId && u.IsActive && u.SuspendedAt == null)
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.Bio, u.CreatedAt, u.UpdatedAt })
            .ToListAsync(ct);

        // Pull skills for each user in one query
        var userSkills = await _db.Set<UserSkill>()
            .IgnoreQueryFilters()
            .Where(us => us.TenantId == tenantId)
            .Join(_db.Set<Skill>().IgnoreQueryFilters(), us => us.SkillId, s => s.Id,
                (us, s) => new { us.UserId, SkillName = s.Name, us.IsVerified, us.EndorsementCount })
            .ToListAsync(ct);

        var skillsByUser = userSkills.GroupBy(x => x.UserId).ToDictionary(g => g.Key, g => g.ToList());

        foreach (var u in users)
        {
            ct.ThrowIfCancellationRequested();
            var skillList = skillsByUser.TryGetValue(u.Id, out var s)
                ? string.Join(", ", s.Select(x => x.IsVerified ? $"{x.SkillName} (verified)" : x.SkillName))
                : "(no skills listed)";
            var title = $"{u.FirstName} {u.LastName}".Trim();
            var body = $"Member: {title}\nBio: {u.Bio ?? "(no bio)"}\nSkills: {skillList}";
            var meta = JsonSerializer.Serialize(new { skill_count = s?.Count ?? 0 });
            await UpsertChunkAsync(tenantId, "user", u.Id, title, body, meta, u.UpdatedAt ?? u.CreatedAt, provider, report, ct);
        }
    }

    private async Task IndexSkillsAsync(int tenantId, IEmbeddingProvider provider, IndexerReport report, CancellationToken ct)
    {
        var skills = await _db.Set<Skill>()
            .IgnoreQueryFilters()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.Name, s.Description, s.CategoryId, s.CreatedAt })
            .ToListAsync(ct);

        foreach (var s in skills)
        {
            ct.ThrowIfCancellationRequested();
            var body = $"Skill: {s.Name}\n{s.Description ?? "(no description)"}";
            var meta = JsonSerializer.Serialize(new { s.CategoryId });
            await UpsertChunkAsync(tenantId, "skill", s.Id, s.Name, body, meta, s.CreatedAt, provider, report, ct);
        }
    }

    private async Task IndexGroupsAsync(int tenantId, IEmbeddingProvider provider, IndexerReport report, CancellationToken ct)
    {
        var groups = await _db.Set<Group>()
            .IgnoreQueryFilters()
            .Where(g => g.TenantId == tenantId)
            .Select(g => new { g.Id, g.Name, g.Description, g.IsPrivate, g.CreatedAt, g.UpdatedAt })
            .ToListAsync(ct);

        foreach (var g in groups)
        {
            ct.ThrowIfCancellationRequested();
            var body = $"Group: {g.Name}\n{g.Description ?? "(no description)"}";
            var meta = JsonSerializer.Serialize(new { g.IsPrivate });
            await UpsertChunkAsync(tenantId, "group", g.Id, g.Name, body, meta, g.UpdatedAt ?? g.CreatedAt, provider, report, ct);
        }
    }

    private async Task IndexEventsAsync(int tenantId, IEmbeddingProvider provider, IndexerReport report, CancellationToken ct)
    {
        var events = await _db.Set<Event>()
            .IgnoreQueryFilters()
            .Where(e => e.TenantId == tenantId && !e.IsCancelled)
            .Select(e => new { e.Id, e.Title, e.Description, e.Location, e.StartsAt, e.EndsAt, e.GroupId, e.CreatedAt, e.UpdatedAt })
            .ToListAsync(ct);

        foreach (var e in events)
        {
            ct.ThrowIfCancellationRequested();
            var body = $"Event: {e.Title}\nWhen: {e.StartsAt:yyyy-MM-dd HH:mm}{(e.EndsAt.HasValue ? $" – {e.EndsAt:yyyy-MM-dd HH:mm}" : "")}\nWhere: {e.Location ?? "n/a"}\n{e.Description ?? "(no description)"}";
            var meta = JsonSerializer.Serialize(new { e.GroupId, starts_at = e.StartsAt });
            await UpsertChunkAsync(tenantId, "event", e.Id, e.Title, body, meta, e.UpdatedAt ?? e.CreatedAt, provider, report, ct);
        }
    }

    private async Task IndexBlogPostsAsync(int tenantId, IEmbeddingProvider provider, IndexerReport report, CancellationToken ct)
    {
        var posts = await _db.Set<BlogPost>()
            .IgnoreQueryFilters()
            .Where(p => p.TenantId == tenantId && p.Status == "published")
            .Select(p => new { p.Id, p.Title, p.Excerpt, p.Content, p.Tags, p.Slug, p.PublishedAt, p.CreatedAt, p.UpdatedAt })
            .ToListAsync(ct);

        foreach (var p in posts)
        {
            ct.ThrowIfCancellationRequested();
            // Long-form: split into MaxChunkChars-sized chunks at paragraph boundaries
            var chunks = SplitText($"{p.Title}\n\n{p.Excerpt}\n\n{p.Content}", MaxChunkChars);
            for (var i = 0; i < chunks.Count; i++)
            {
                var meta = JsonSerializer.Serialize(new { p.Slug, p.Tags, chunk_index = i, total_chunks = chunks.Count });
                await UpsertChunkAsync(tenantId, "blog", p.Id, p.Title, chunks[i], meta, p.UpdatedAt ?? p.CreatedAt, provider, report, ct, chunkIndex: i);
            }
        }
    }

    private async Task IndexKnowledgeArticlesAsync(int tenantId, IEmbeddingProvider provider, IndexerReport report, CancellationToken ct)
    {
        var articles = await _db.Set<KnowledgeArticle>()
            .IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId && a.IsPublished)
            .Select(a => new { a.Id, a.Title, a.Content, a.Category, a.Tags, a.Slug, a.CreatedAt, a.UpdatedAt })
            .ToListAsync(ct);

        foreach (var a in articles)
        {
            ct.ThrowIfCancellationRequested();
            var chunks = SplitText($"{a.Title}\n\n{a.Content}", MaxChunkChars);
            for (var i = 0; i < chunks.Count; i++)
            {
                var meta = JsonSerializer.Serialize(new { a.Slug, a.Category, a.Tags, chunk_index = i, total_chunks = chunks.Count });
                await UpsertChunkAsync(tenantId, "kb_article", a.Id, a.Title, chunks[i], meta, a.UpdatedAt ?? a.CreatedAt, provider, report, ct, chunkIndex: i);
            }
        }
    }

    private async Task IndexFaqsAsync(int tenantId, IEmbeddingProvider provider, IndexerReport report, CancellationToken ct)
    {
        var faqs = await _db.Set<Faq>()
            .IgnoreQueryFilters()
            .Where(f => f.TenantId == tenantId && f.IsPublished)
            .Select(f => new { f.Id, f.Question, f.Answer, f.Category, f.CreatedAt, f.UpdatedAt })
            .ToListAsync(ct);

        foreach (var f in faqs)
        {
            ct.ThrowIfCancellationRequested();
            var body = $"Q: {f.Question}\nA: {f.Answer}";
            var meta = JsonSerializer.Serialize(new { f.Category });
            await UpsertChunkAsync(tenantId, "faq", f.Id, f.Question, body, meta, f.UpdatedAt ?? f.CreatedAt, provider, report, ct);
        }
    }

    // ─── Upsert + embed primitive ─────────────────────────────────────────

    private async Task UpsertChunkAsync(
        int tenantId,
        string sourceType,
        int sourceId,
        string title,
        string content,
        string metadataJson,
        DateTime sourceUpdatedAt,
        IEmbeddingProvider provider,
        IndexerReport report,
        CancellationToken ct,
        int chunkIndex = 0)
    {
        var hash = Sha256(content);

        var existing = await _db.Set<KnowledgeChunk>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c =>
                c.TenantId == tenantId
                && c.SourceType == sourceType
                && c.SourceId == sourceId
                && c.ChunkIndex == chunkIndex, ct);

        if (existing != null
            && existing.ContentHash == hash
            && existing.EmbeddingProvider == provider.Name
            && existing.EmbeddingModel == provider.Model)
        {
            report.Skipped++;
            return;
        }

        var embedding = await provider.EmbedAsync(content, ct);
        if (embedding.Length == 0)
        {
            report.Failed++;
            return;
        }

        if (existing == null)
        {
            _db.Add(new KnowledgeChunk
            {
                TenantId = tenantId,
                SourceType = sourceType,
                SourceId = sourceId,
                ChunkIndex = chunkIndex,
                Title = title,
                Content = content,
                MetadataJson = metadataJson,
                ContentHash = hash,
                Embedding = embedding,
                EmbeddingProvider = provider.Name,
                EmbeddingModel = provider.Model,
                SourceUpdatedAt = sourceUpdatedAt,
                IndexedAt = DateTime.UtcNow
            });
            report.Added++;
        }
        else
        {
            existing.Title = title;
            existing.Content = content;
            existing.MetadataJson = metadataJson;
            existing.ContentHash = hash;
            existing.Embedding = embedding;
            existing.EmbeddingProvider = provider.Name;
            existing.EmbeddingModel = provider.Model;
            existing.SourceUpdatedAt = sourceUpdatedAt;
            existing.IndexedAt = DateTime.UtcNow;
            report.Updated++;
        }

        // Flush every 50 changes to keep the change-tracker small.
        if ((report.Added + report.Updated) % 50 == 0)
            await _db.SaveChangesAsync(ct);
    }

    public async Task<int> FlushAsync(CancellationToken ct = default) => await _db.SaveChangesAsync(ct);

    private static List<string> SplitText(string text, int maxChars)
    {
        if (text.Length <= maxChars) return new List<string> { text };
        var paragraphs = text.Split(new[] { "\n\n" }, StringSplitOptions.RemoveEmptyEntries);
        var chunks = new List<string>();
        var current = new StringBuilder();
        foreach (var p in paragraphs)
        {
            if (current.Length + p.Length > maxChars && current.Length > 0)
            {
                chunks.Add(current.ToString().Trim());
                current.Clear();
            }
            current.Append(p).Append("\n\n");
        }
        if (current.Length > 0) chunks.Add(current.ToString().Trim());
        return chunks;
    }

    private static string Sha256(string s)
    {
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
        return Convert.ToHexString(bytes);
    }
}

public class IndexerReport
{
    public int TenantId { get; set; }
    public int Added { get; set; }
    public int Updated { get; set; }
    public int Skipped { get; set; }
    public int Failed { get; set; }
    public string? Notes { get; set; }
    public DateTime CompletedAt { get; set; } = DateTime.UtcNow;
}
