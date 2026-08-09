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

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin translation/i18n management.
/// </summary>
[ApiController]
[Route("api/admin/translations")]
[Authorize(Policy = "AdminOnly")]
public class AdminTranslationsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public AdminTranslationsController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// GET /api/admin/translations - List translations for a locale.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListTranslations(
        [FromQuery] string locale = "en",
        [FromQuery] string? ns = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 500)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 1000);

        var query = _db.Translations.AsNoTracking().Where(t => t.Locale == locale);

        if (!string.IsNullOrWhiteSpace(ns))
            query = query.Where(t => t.Namespace == ns);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(t => t.Key.ToLower().Contains(term) || t.Value.ToLower().Contains(term));
        }

        var total = await query.CountAsync();
        var rows = await query
            .OrderBy(t => t.Namespace)
            .ThenBy(t => t.Key)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(t => new
            {
                t.Id,
                t.Locale,
                t.Key,
                t.Value,
                @namespace = t.Namespace,
                is_approved = t.IsApproved,
                created_at = t.CreatedAt,
                updated_at = t.UpdatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            locale,
            translations = rows
                .GroupBy(t => t.Key)
                .ToDictionary(g => g.Key, g => g.First().Value),
            data = rows,
            total
        });
    }

    /// <summary>
    /// POST /api/admin/translations - Create or update one translation.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> SaveTranslation([FromBody] AdminSetTranslationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Locale))
            return BadRequest(new { error = "Locale is required" });
        if (string.IsNullOrWhiteSpace(request.Key))
            return BadRequest(new { error = "Key is required" });
        if (string.IsNullOrWhiteSpace(request.Value))
            return BadRequest(new { error = "Value is required" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var locale = request.Locale.Trim();
        var key = request.Key.Trim();
        var ns = string.IsNullOrWhiteSpace(request.Namespace) ? "common" : request.Namespace.Trim();

        var existing = await _db.Translations
            .FirstOrDefaultAsync(t => t.Locale == locale && t.Key == key && t.Namespace == ns);

        if (existing == null)
        {
            existing = new Translation
            {
                TenantId = tenantId,
                Locale = locale,
                Key = key,
                Namespace = ns
            };
            _db.Translations.Add(existing);
        }

        existing.Value = request.Value.Trim();
        existing.IsApproved = true;
        existing.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        return Ok(new
        {
            data = new
            {
                existing.Id,
                existing.Locale,
                existing.Key,
                existing.Value,
                @namespace = existing.Namespace,
                is_approved = existing.IsApproved,
                updated_at = existing.UpdatedAt
            }
        });
    }

    /// <summary>
    /// GET /api/admin/translations/stats - Translation coverage stats.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var totalTranslations = await _db.Translations.CountAsync();
        var locales = await _db.SupportedLocales.ToListAsync();
        var byLocale = await _db.Translations
            .GroupBy(t => t.Locale)
            .Select(g => new { Locale = g.Key, Count = g.Count() })
            .ToListAsync();

        return Ok(new
        {
            data = new
            {
                total_translations = totalTranslations,
                supported_locales = locales.Select(l => new { l.Id, l.Locale, l.Name, l.IsDefault }),
                coverage = byLocale
            }
        });
    }

    /// <summary>
    /// GET /api/admin/translations/missing - Get missing translation keys.
    /// </summary>
    [HttpGet("missing")]
    public async Task<IActionResult> GetMissing([FromQuery] string locale = "en")
    {
        var defaultKeys = await _db.Translations
            .Where(t => t.Locale == "en")
            .Select(t => t.Key)
            .ToListAsync();

        var translatedKeys = await _db.Translations
            .Where(t => t.Locale == locale)
            .Select(t => t.Key)
            .ToListAsync();

        var missing = defaultKeys.Except(translatedKeys).ToList();

        return Ok(new
        {
            data = new
            {
                locale,
                total_keys = defaultKeys.Count,
                translated = translatedKeys.Count,
                missing_count = missing.Count,
                missing_keys = missing.Take(100)
            }
        });
    }

    /// <summary>
    /// POST /api/admin/translations/bulk - Bulk import translations.
    /// </summary>
    [HttpPost("bulk")]
    public async Task<IActionResult> BulkImport([FromBody] BulkTranslationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Locale))
            return BadRequest(new { error = "Locale is required" });
        if (request.Translations == null || request.Translations.Count == 0)
            return BadRequest(new { error = "At least one translation is required" });
        if (request.Translations.Count > 1000)
            return BadRequest(new { error = "Maximum 1000 translations per bulk import" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var locale = request.Locale.Trim();
        var imported = 0;

        foreach (var item in request.Translations)
        {
            if (string.IsNullOrWhiteSpace(item.Key) || string.IsNullOrWhiteSpace(item.Value))
                continue;

            var key = item.Key.Trim();
            var ns = string.IsNullOrWhiteSpace(item.Namespace) ? "common" : item.Namespace.Trim();
            var existing = await _db.Translations
                .FirstOrDefaultAsync(t => t.Locale == locale && t.Key == key && t.Namespace == ns);

            if (existing != null)
            {
                existing.Value = item.Value.Trim();
                existing.IsApproved = true;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                _db.Translations.Add(new Translation
                {
                    TenantId = tenantId,
                    Locale = locale,
                    Key = key,
                    Value = item.Value.Trim(),
                    Namespace = ns,
                    IsApproved = true
                });
            }
            imported++;
        }

        await _db.SaveChangesAsync();
        return Ok(new { message = $"Imported {imported} translations for locale '{locale}'", imported_count = imported });
    }

    /// <summary>
    /// POST /api/admin/translations/locales - Add supported locale.
    /// </summary>
    [HttpPost("locales")]
    public async Task<IActionResult> AddLocale([FromBody] AdminAddLocaleRequest request)
    {
        var existing = await _db.SupportedLocales.AnyAsync(l => l.Locale == request.Code);
        if (existing) return BadRequest(new { error = "Locale already exists" });

        var locale = new SupportedLocale
        {
            Locale = request.Code,
            Name = request.Name,
            IsDefault = false
        };
        _db.SupportedLocales.Add(locale);
        await _db.SaveChangesAsync();
        return Created("/api/admin/translations/locales", new { data = new { locale.Id, locale.Locale, locale.Name } });
    }

    /// <summary>
    /// DELETE /api/admin/translations/locales/{code} - Remove a locale.
    /// </summary>
    [HttpDelete("locales/{code}")]
    public async Task<IActionResult> RemoveLocale(string code)
    {
        if (code == "en") return BadRequest(new { error = "Cannot remove default locale" });

        var locale = await _db.SupportedLocales.FirstOrDefaultAsync(l => l.Locale == code);
        if (locale == null) return NotFound(new { error = "Locale not found" });

        var translations = await _db.Translations.Where(t => t.Locale == code).ToListAsync();
        _db.Translations.RemoveRange(translations);
        _db.SupportedLocales.Remove(locale);
        await _db.SaveChangesAsync();
        return Ok(new { message = $"Locale '{code}' removed" });
    }
}

public class BulkTranslationRequest
{
    [JsonPropertyName("locale")] public string Locale { get; set; } = "en";
    [JsonPropertyName("translations")] public List<TranslationItem> Translations { get; set; } = new();
}

public class AdminSetTranslationRequest
{
    [JsonPropertyName("locale")] public string Locale { get; set; } = string.Empty;
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("value")] public string Value { get; set; } = string.Empty;
    [JsonPropertyName("namespace")] public string? Namespace { get; set; }
}

public class TranslationItem
{
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("value")] public string Value { get; set; } = string.Empty;
    [JsonPropertyName("namespace")] public string? Namespace { get; set; }
}

public class AdminAddLocaleRequest
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
}
