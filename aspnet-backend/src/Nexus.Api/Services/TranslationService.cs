// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing translations, supported locales, and user language preferences.
/// Phase 34: i18n / Multi-Language.
/// </summary>
public class TranslationService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<TranslationService> _logger;

    public TranslationService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<TranslationService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Get all translations for a locale, optionally filtered by namespace.
    /// Returns a dictionary of key -> value pairs.
    /// </summary>
    public async Task<Dictionary<string, string>> GetTranslationsAsync(string locale, string? ns = null)
    {
        var query = _db.Set<Translation>()
            .Where(t => t.Locale == locale);

        if (!string.IsNullOrWhiteSpace(ns))
        {
            query = query.Where(t => t.Namespace == ns);
        }

        var rows = await query.ToListAsync();
        // Group by key to handle any duplicate keys gracefully (first value wins)
        return rows
            .GroupBy(t => t.Key)
            .ToDictionary(g => g.Key, g => g.First().Value);
    }

    /// <summary>
    /// Get a single translation by locale and key.
    /// </summary>
    public async Task<string?> GetTranslationAsync(string locale, string key)
    {
        var translation = await _db.Set<Translation>()
            .FirstOrDefaultAsync(t => t.Locale == locale && t.Key == key);

        return translation?.Value;
    }

    /// <summary>
    /// Set a single translation. Creates or updates as needed.
    /// </summary>
    public async Task<Translation> SetTranslationAsync(string locale, string key, string value, string? ns = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var existing = await _db.Set<Translation>()
            .FirstOrDefaultAsync(t => t.Locale == locale && t.Key == key);

        if (existing != null)
        {
            existing.Value = value;
            if (ns != null) existing.Namespace = ns;
            existing.UpdatedAt = DateTime.UtcNow;
            // Reset approval when translation is changed
            existing.IsApproved = false;
            existing.ApprovedById = null;
        }
        else
        {
            existing = new Translation
            {
                TenantId = tenantId,
                Locale = locale,
                Key = key,
                Value = value,
                Namespace = ns
            };
            _db.Set<Translation>().Add(existing);
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Translation set for locale {Locale}, key {Key}",
            locale, key);

        // Update completion stats
        await UpdateCompletionStatsAsync(locale);

        return existing;
    }

    /// <summary>
    /// Bulk import translations for a locale.
    /// </summary>
    public async Task<int> BulkSetTranslationsAsync(string locale, Dictionary<string, string> translations, string? ns = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var keys = translations.Keys.ToList();

        // Load existing translations for these keys
        var existing = await _db.Set<Translation>()
            .Where(t => t.Locale == locale && keys.Contains(t.Key))
            .ToDictionaryAsync(t => t.Key);

        var count = 0;

        foreach (var (key, value) in translations)
        {
            if (existing.TryGetValue(key, out var trans))
            {
                trans.Value = value;
                if (ns != null) trans.Namespace = ns;
                trans.UpdatedAt = DateTime.UtcNow;
                trans.IsApproved = false;
                trans.ApprovedById = null;
            }
            else
            {
                _db.Set<Translation>().Add(new Translation
                {
                    TenantId = tenantId,
                    Locale = locale,
                    Key = key,
                    Value = value,
                    Namespace = ns
                });
            }

            count++;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Bulk imported {Count} translations for locale {Locale}",
            count, locale);

        // Update completion stats
        await UpdateCompletionStatsAsync(locale);

        return count;
    }

    /// <summary>
    /// Get all active supported locales for the current tenant.
    /// </summary>
    public async Task<List<SupportedLocale>> GetSupportedLocalesAsync()
    {
        return await _db.Set<SupportedLocale>()
            .Where(l => l.IsActive)
            .OrderByDescending(l => l.IsDefault)
            .ThenBy(l => l.Name)
            .ToListAsync();
    }

    /// <summary>
    /// Add a new supported locale for the tenant.
    /// </summary>
    public async Task<SupportedLocale> AddLocaleAsync(string locale, string name, string nativeName, bool isDefault = false)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Check if locale already exists
        var existing = await _db.Set<SupportedLocale>()
            .FirstOrDefaultAsync(l => l.Locale == locale);

        if (existing != null)
        {
            existing.Name = name;
            existing.NativeName = nativeName;
            existing.IsActive = true;

            if (isDefault)
            {
                // ExecuteUpdateAsync bypasses EF global query filters, so we must
                // explicitly enforce tenant isolation in the WHERE clause.
                await _db.Set<SupportedLocale>()
                    .Where(l => l.TenantId == tenantId && l.IsDefault && l.Id != existing.Id)
                    .ExecuteUpdateAsync(s => s.SetProperty(l => l.IsDefault, false));
                existing.IsDefault = true;
            }

            await _db.SaveChangesAsync();
            return existing;
        }

        if (isDefault)
        {
            // ExecuteUpdateAsync bypasses EF global query filters, so we must
            // explicitly enforce tenant isolation in the WHERE clause.
            await _db.Set<SupportedLocale>()
                .Where(l => l.TenantId == tenantId && l.IsDefault)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.IsDefault, false));
        }

        var supportedLocale = new SupportedLocale
        {
            TenantId = tenantId,
            Locale = locale,
            Name = name,
            NativeName = nativeName,
            IsDefault = isDefault
        };

        _db.Set<SupportedLocale>().Add(supportedLocale);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Supported locale added: {Locale} ({Name}), default={IsDefault}",
            locale, name, isDefault);

        return supportedLocale;
    }

    /// <summary>
    /// Get a user's preferred locale.
    /// Falls back to tenant default if no preference is set.
    /// </summary>
    public async Task<string> GetUserLocaleAsync(int userId)
    {
        var pref = await _db.Set<UserLanguagePreference>()
            .FirstOrDefaultAsync(p => p.UserId == userId);

        if (pref != null)
        {
            return pref.PreferredLocale;
        }

        var userLocale = await _db.Users.IgnoreQueryFilters()
            .Where(candidate => candidate.Id == userId)
            .Select(candidate => candidate.PreferredLanguage)
            .FirstOrDefaultAsync();
        if (!string.IsNullOrWhiteSpace(userLocale))
        {
            return userLocale;
        }

        // Fall back to tenant default
        var defaultLocale = await _db.Set<SupportedLocale>()
            .FirstOrDefaultAsync(l => l.IsDefault && l.IsActive);

        return defaultLocale?.Locale ?? "en";
    }

    /// <summary>
    /// Set a user's locale preference.
    /// </summary>
    public async Task<UserLanguagePreference> SetUserLocaleAsync(int userId, string locale, string? fallback = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var pref = await _db.Set<UserLanguagePreference>()
            .FirstOrDefaultAsync(p => p.UserId == userId);

        if (pref != null)
        {
            pref.PreferredLocale = locale;
            if (fallback != null) pref.FallbackLocale = fallback;
            pref.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            pref = new UserLanguagePreference
            {
                TenantId = tenantId,
                UserId = userId,
                PreferredLocale = locale,
                FallbackLocale = fallback
            };
            _db.Set<UserLanguagePreference>().Add(pref);
        }

        var user = await _db.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(candidate => candidate.TenantId == tenantId && candidate.Id == userId);
        if (user != null)
        {
            user.PreferredLanguage = locale;
            user.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "User {UserId} locale set to {Locale} (fallback: {Fallback})",
            userId, locale, fallback ?? "(tenant default)");

        return pref;
    }

    /// <summary>
    /// Get translation completion statistics for all locales.
    /// </summary>
    public async Task<List<LocaleStats>> GetTranslationStatsAsync()
    {
        var locales = await _db.Set<SupportedLocale>()
            .Where(l => l.IsActive)
            .ToListAsync();

        // Get the default locale to use as the reference for total keys
        var defaultLocale = locales.FirstOrDefault(l => l.IsDefault)?.Locale ?? "en";

        var totalKeys = await _db.Set<Translation>()
            .Where(t => t.Locale == defaultLocale)
            .CountAsync();

        var stats = new List<LocaleStats>();

        foreach (var locale in locales)
        {
            var translatedKeys = await _db.Set<Translation>()
                .Where(t => t.Locale == locale.Locale)
                .CountAsync();

            var approvedKeys = await _db.Set<Translation>()
                .Where(t => t.Locale == locale.Locale && t.IsApproved)
                .CountAsync();

            stats.Add(new LocaleStats
            {
                Locale = locale.Locale,
                Name = locale.Name,
                NativeName = locale.NativeName,
                IsDefault = locale.IsDefault,
                TotalKeys = totalKeys,
                TranslatedKeys = translatedKeys,
                ApprovedKeys = approvedKeys,
                CompletionPercent = totalKeys > 0
                    ? (int)Math.Min(100, Math.Round(translatedKeys * 100.0 / totalKeys))
                    : 0
            });
        }

        return stats;
    }

    /// <summary>
    /// Get keys that exist in the default locale but are missing in the specified locale.
    /// </summary>
    public async Task<List<string>> GetMissingKeysAsync(string locale)
    {
        var defaultLocale = await _db.Set<SupportedLocale>()
            .Where(l => l.IsDefault && l.IsActive)
            .Select(l => l.Locale)
            .FirstOrDefaultAsync() ?? "en";

        var defaultKeys = await _db.Set<Translation>()
            .Where(t => t.Locale == defaultLocale)
            .Select(t => t.Key)
            .ToListAsync();

        var translatedKeys = await _db.Set<Translation>()
            .Where(t => t.Locale == locale)
            .Select(t => t.Key)
            .ToListAsync();
        var translatedKeySet = translatedKeys.ToHashSet();

        return defaultKeys
            .Where(k => !translatedKeySet.Contains(k))
            .OrderBy(k => k)
            .ToList();
    }

    /// <summary>
    /// Update the completion percentage for a locale's SupportedLocale record.
    /// </summary>
    private async Task UpdateCompletionStatsAsync(string locale)
    {
        var supportedLocale = await _db.Set<SupportedLocale>()
            .FirstOrDefaultAsync(l => l.Locale == locale);

        if (supportedLocale == null) return;

        var defaultLocale = await _db.Set<SupportedLocale>()
            .Where(l => l.IsDefault && l.IsActive)
            .Select(l => l.Locale)
            .FirstOrDefaultAsync() ?? "en";

        var totalKeys = await _db.Set<Translation>()
            .Where(t => t.Locale == defaultLocale)
            .CountAsync();

        var translatedKeys = await _db.Set<Translation>()
            .Where(t => t.Locale == locale)
            .CountAsync();

        supportedLocale.CompletionPercent = totalKeys > 0
            ? (int)Math.Min(100, Math.Round(translatedKeys * 100.0 / totalKeys))
            : 0;

        await _db.SaveChangesAsync();
    }
}

/// <summary>
/// Translation completion statistics for a locale.
/// </summary>
public class LocaleStats
{
    public string Locale { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NativeName { get; set; } = string.Empty;
    public bool IsDefault { get; set; }
    public int TotalKeys { get; set; }
    public int TranslatedKeys { get; set; }
    public int ApprovedKeys { get; set; }
    public int CompletionPercent { get; set; }
}
