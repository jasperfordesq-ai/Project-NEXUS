// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing frequently asked questions, grouped by category.
/// </summary>
public class FaqService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<FaqService> _logger;

    public FaqService(NexusDbContext db, TenantContext tenantContext, ILogger<FaqService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// List FAQs, optionally filtered by category, ordered by SortOrder.
    /// </summary>
    public async Task<List<Faq>> GetFaqsAsync(string? category, bool publishedOnly = true)
    {
        var query = _db.Set<Faq>().AsNoTracking();

        if (publishedOnly)
            query = query.Where(f => f.IsPublished);

        if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(f => f.Category == category);

        return await query
            .OrderBy(f => f.SortOrder)
            .ThenBy(f => f.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Get a single FAQ by ID.
    /// </summary>
    public async Task<Faq?> GetFaqAsync(int id)
    {
        return await _db.Set<Faq>()
            .FirstOrDefaultAsync(f => f.Id == id);
    }

    /// <summary>
    /// Get distinct categories from all FAQs.
    /// </summary>
    public async Task<List<string>> GetCategoriesAsync()
    {
        return await _db.Set<Faq>()
            .AsNoTracking()
            .Where(f => f.Category != null)
            .Select(f => f.Category!)
            .Distinct()
            .OrderBy(c => c)
            .ToListAsync();
    }

    /// <summary>
    /// Create a FAQ. Validates question/answer not empty; auto-assigns SortOrder.
    /// </summary>
    public async Task<(Faq? Faq, string? Error)> CreateFaqAsync(
        int tenantId, string question, string answer, string? category)
    {
        if (string.IsNullOrWhiteSpace(question))
            return (null, "Question is required");

        if (string.IsNullOrWhiteSpace(answer))
            return (null, "Answer is required");

        // Auto-assign SortOrder as max + 1
        var maxSortOrder = await _db.Set<Faq>()
            .Where(f => f.TenantId == tenantId)
            .MaxAsync(f => (int?)f.SortOrder) ?? -1;

        var faq = new Faq
        {
            TenantId = tenantId,
            Question = question.Trim(),
            Answer = answer.Trim(),
            Category = category?.Trim(),
            SortOrder = maxSortOrder + 1,
            IsPublished = true,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<Faq>().Add(faq);
        await _db.SaveChangesAsync();

        _logger.LogInformation("FAQ {FaqId} created: {Question}", faq.Id, question);
        return (faq, null);
    }

    /// <summary>
    /// Update a FAQ. Validates question/answer not empty.
    /// </summary>
    public async Task<(Faq? Faq, string? Error)> UpdateFaqAsync(
        int id, string question, string answer, string? category, bool isPublished)
    {
        if (string.IsNullOrWhiteSpace(question))
            return (null, "Question is required");

        if (string.IsNullOrWhiteSpace(answer))
            return (null, "Answer is required");

        var faq = await _db.Set<Faq>().FirstOrDefaultAsync(f => f.Id == id);
        if (faq == null)
            return (null, "FAQ not found");

        faq.Question = question.Trim();
        faq.Answer = answer.Trim();
        faq.Category = category?.Trim();
        faq.IsPublished = isPublished;
        faq.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("FAQ {FaqId} updated", id);
        return (faq, null);
    }

    /// <summary>
    /// Hard-delete a FAQ.
    /// </summary>
    public async Task<(bool Success, string? Error)> DeleteFaqAsync(int id)
    {
        var faq = await _db.Set<Faq>().FirstOrDefaultAsync(f => f.Id == id);
        if (faq == null)
            return (false, "FAQ not found");

        _db.Set<Faq>().Remove(faq);
        await _db.SaveChangesAsync();

        _logger.LogInformation("FAQ {FaqId} deleted", id);
        return (true, null);
    }

    /// <summary>
    /// Reorder FAQs by array position.
    /// </summary>
    public async Task<(bool Success, string? Error)> ReorderFaqsAsync(int[] faqIds)
    {
        if (faqIds.Length == 0)
            return (false, "No FAQ IDs provided");

        var faqs = await _db.Set<Faq>()
            .Where(f => faqIds.Contains(f.Id))
            .ToListAsync();

        if (faqs.Count != faqIds.Length)
            return (false, "Some FAQ IDs are invalid");

        for (int i = 0; i < faqIds.Length; i++)
        {
            var faq = faqs.First(f => f.Id == faqIds[i]);
            faq.SortOrder = i;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("FAQs reordered: {Count} items", faqIds.Length);
        return (true, null);
    }
}
