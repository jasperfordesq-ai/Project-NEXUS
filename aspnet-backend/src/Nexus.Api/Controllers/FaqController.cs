// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/faqs")]
[Authorize]
public class FaqController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<FaqController> _logger;

    public FaqController(NexusDbContext db, TenantContext tenantContext, ILogger<FaqController> logger)
    { _db = db; _tenantContext = tenantContext; _logger = logger; }

    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> List([FromQuery] string? category = null, [FromQuery] bool publishedOnly = true)
    {
        var query = _db.Faqs.AsNoTracking().AsQueryable();
        if (publishedOnly) query = query.Where(f => f.IsPublished);
        if (!string.IsNullOrWhiteSpace(category)) query = query.Where(f => f.Category == category);
        var faqs = await query.OrderBy(f => f.SortOrder).ThenBy(f => f.CreatedAt)
            .Select(f => new { f.Id, f.Question, f.Answer, f.Category, sort_order = f.SortOrder, is_published = f.IsPublished, created_at = f.CreatedAt }).ToListAsync();
        return Ok(new { data = faqs });
    }

    [HttpGet("{id:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> Get(int id)
    {
        var faq = await _db.Faqs.AsNoTracking().Where(f => f.Id == id)
            .Select(f => new { f.Id, f.Question, f.Answer, f.Category, sort_order = f.SortOrder, is_published = f.IsPublished, created_at = f.CreatedAt, updated_at = f.UpdatedAt }).FirstOrDefaultAsync();
        if (faq == null) return NotFound(new { error = "FAQ not found" });
        return Ok(faq);
    }

    [HttpGet("categories")]
    [AllowAnonymous]
    public async Task<IActionResult> ListCategories()
    {
        var categories = await _db.Faqs.AsNoTracking().Where(f => f.Category != null && f.IsPublished)
            .Select(f => f.Category!).Distinct().OrderBy(c => c).ToListAsync();
        return Ok(new { data = categories });
    }

    [HttpPost]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Create([FromBody] CreateFaqDto request)
    {
        if (string.IsNullOrWhiteSpace(request.Question)) return BadRequest(new { error = "Question is required" });
        if (string.IsNullOrWhiteSpace(request.Answer)) return BadRequest(new { error = "Answer is required" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var faq = new Faq { TenantId = tenantId, Question = request.Question.Trim(), Answer = request.Answer.Trim(), Category = request.Category?.Trim(), SortOrder = request.SortOrder ?? 0, IsPublished = true };
        _db.Faqs.Add(faq); await _db.SaveChangesAsync();
        _logger.LogInformation("FAQ created: {FaqId}", faq.Id);
        return CreatedAtAction(nameof(Get), new { id = faq.Id }, new { success = true, message = "FAQ created", faq = new { faq.Id, faq.Question, faq.Answer, faq.Category, sort_order = faq.SortOrder, is_published = faq.IsPublished, created_at = faq.CreatedAt } });
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateFaqDto request)
    {
        var faq = await _db.Faqs.FirstOrDefaultAsync(f => f.Id == id);
        if (faq == null) return NotFound(new { error = "FAQ not found" });
        if (request.Question != null) { if (string.IsNullOrWhiteSpace(request.Question)) return BadRequest(new { error = "Question cannot be empty" }); faq.Question = request.Question.Trim(); }
        if (request.Answer != null) { if (string.IsNullOrWhiteSpace(request.Answer)) return BadRequest(new { error = "Answer cannot be empty" }); faq.Answer = request.Answer.Trim(); }
        if (request.Category != null) faq.Category = string.IsNullOrWhiteSpace(request.Category) ? null : request.Category.Trim();
        if (request.SortOrder.HasValue) faq.SortOrder = request.SortOrder.Value;
        if (request.IsPublished.HasValue) faq.IsPublished = request.IsPublished.Value;
        faq.UpdatedAt = DateTime.UtcNow; await _db.SaveChangesAsync();
        return Ok(new { success = true, message = "FAQ updated", faq = new { faq.Id, faq.Question, faq.Answer, faq.Category, sort_order = faq.SortOrder, is_published = faq.IsPublished, updated_at = faq.UpdatedAt } });
    }

    [HttpDelete("{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Delete(int id)
    {
        var faq = await _db.Faqs.FirstOrDefaultAsync(f => f.Id == id);
        if (faq == null) return NotFound(new { error = "FAQ not found" });
        _db.Faqs.Remove(faq); await _db.SaveChangesAsync();
        return Ok(new { success = true, message = "FAQ deleted" });
    }

    [HttpPut("reorder")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Reorder([FromBody] ReorderFaqsDto request)
    {
        if (request.FaqIds == null || request.FaqIds.Length == 0) return BadRequest(new { error = "faq_ids is required" });
        var faqs = await _db.Faqs.Where(f => request.FaqIds.Contains(f.Id)).ToListAsync();
        for (int i = 0; i < request.FaqIds.Length; i++) { var faq = faqs.FirstOrDefault(f => f.Id == request.FaqIds[i]); if (faq != null) faq.SortOrder = i; }
        await _db.SaveChangesAsync();
        return Ok(new { success = true, message = "FAQs reordered" });
    }
}

public record CreateFaqDto
{
    [JsonPropertyName("question")] public string Question { get; init; } = string.Empty;
    [JsonPropertyName("answer")] public string Answer { get; init; } = string.Empty;
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("sort_order")] public int? SortOrder { get; init; }
}

public record UpdateFaqDto
{
    [JsonPropertyName("question")] public string? Question { get; init; }
    [JsonPropertyName("answer")] public string? Answer { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("sort_order")] public int? SortOrder { get; init; }
    [JsonPropertyName("is_published")] public bool? IsPublished { get; init; }
}

public record ReorderFaqsDto
{
    [JsonPropertyName("faq_ids")] public int[] FaqIds { get; init; } = Array.Empty<int>();
}
