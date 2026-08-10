// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Translation controller - i18n and multi-language support.
/// Phase 34: i18n / Multi-Language.
/// Public endpoints for fetching translations and user locale preferences.
/// Admin endpoints for managing translations and locales.
/// </summary>
[ApiController]
[Authorize]
public class TranslationController : ControllerBase
{
    private readonly TranslationService _translationService;
    private readonly ILogger<TranslationController> _logger;

    public TranslationController(
        TranslationService translationService,
        ILogger<TranslationController> logger)
    {
        _translationService = translationService;
        _logger = logger;
    }

    #region Public Endpoints

    /// <summary>
    /// GET /api/i18n/translations/{locale} - Get all translations for a locale.
    /// Optionally filter by namespace.
    /// </summary>
    [HttpGet("api/i18n/translations/{locale}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetTranslations(string locale, [FromQuery] string? ns = null)
    {
        if (string.IsNullOrWhiteSpace(locale) || locale.Length > 10)
        {
            return BadRequest(new { error = "Invalid locale" });
        }

        var translations = await _translationService.GetTranslationsAsync(locale, ns);

        return Ok(new
        {
            locale,
            @namespace = ns,
            count = translations.Count,
            translations
        });
    }

    /// <summary>
    /// GET /api/i18n/locales - List supported locales.
    /// </summary>
    [HttpGet("api/i18n/locales")]
    [AllowAnonymous]
    public async Task<IActionResult> GetLocales()
    {
        var locales = await _translationService.GetSupportedLocalesAsync();

        return Ok(new
        {
            data = locales.Select(l => new
            {
                locale = l.Locale,
                name = l.Name,
                native_name = l.NativeName,
                is_default = l.IsDefault,
                is_active = l.IsActive,
                completion_percent = l.CompletionPercent
            })
        });
    }

    /// <summary>
    /// GET /api/i18n/my-locale - Get current user's locale preference.
    /// </summary>
    [HttpGet("api/i18n/my-locale")]
    public async Task<IActionResult> GetMyLocale()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var locale = await _translationService.GetUserLocaleAsync(userId.Value);

        return Ok(new
        {
            locale
        });
    }

    /// <summary>
    /// PUT /api/i18n/my-locale - Set current user's locale preference.
    /// </summary>
    [HttpPut("api/i18n/my-locale")]
    public async Task<IActionResult> SetMyLocale([FromBody] SetLocaleRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Locale))
        {
            return BadRequest(new { error = "locale is required" });
        }

        var pref = await _translationService.SetUserLocaleAsync(
            userId.Value,
            request.Locale,
            request.Fallback);

        return Ok(new
        {
            success = true,
            message = "Locale preference updated",
            preferred_locale = pref.PreferredLocale,
            fallback_locale = pref.FallbackLocale
        });
    }

    #endregion

    #region Admin Endpoints

    /// <summary>
    /// POST /api/admin/i18n/translations - Set a single translation.
    /// </summary>
    [HttpPost("api/admin/i18n/translations")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> SetTranslation([FromBody] SetTranslationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Locale))
        {
            return BadRequest(new { error = "locale is required" });
        }

        if (string.IsNullOrWhiteSpace(request.Key))
        {
            return BadRequest(new { error = "key is required" });
        }

        if (string.IsNullOrWhiteSpace(request.Value))
        {
            return BadRequest(new { error = "value is required" });
        }

        var translation = await _translationService.SetTranslationAsync(
            request.Locale,
            request.Key,
            request.Value,
            request.Namespace);

        _logger.LogInformation(
            "Admin set translation: {Locale}/{Key}",
            request.Locale, request.Key);

        return Ok(new
        {
            success = true,
            message = "Translation saved",
            translation = new
            {
                id = translation.Id,
                locale = translation.Locale,
                key = translation.Key,
                value = translation.Value,
                @namespace = translation.Namespace,
                is_approved = translation.IsApproved,
                updated_at = translation.UpdatedAt ?? translation.CreatedAt
            }
        });
    }

    /// <summary>
    /// POST /api/admin/i18n/translations/bulk - Bulk import translations.
    /// </summary>
    [HttpPost("api/admin/i18n/translations/bulk")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> BulkSetTranslations([FromBody] BulkSetTranslationsRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Locale))
        {
            return BadRequest(new { error = "locale is required" });
        }

        if (request.Translations == null || request.Translations.Count == 0)
        {
            return BadRequest(new { error = "translations must contain at least one entry" });
        }

        var count = await _translationService.BulkSetTranslationsAsync(
            request.Locale,
            request.Translations,
            request.Namespace);

        _logger.LogInformation(
            "Admin bulk imported {Count} translations for locale {Locale}",
            count, request.Locale);

        return Ok(new
        {
            success = true,
            message = $"Imported {count} translation(s)",
            locale = request.Locale,
            count
        });
    }

    /// <summary>
    /// POST /api/admin/i18n/locales - Add a supported locale.
    /// </summary>
    [HttpPost("api/admin/i18n/locales")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AddLocale([FromBody] AddLocaleRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Locale))
        {
            return BadRequest(new { error = "locale is required" });
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { error = "name is required" });
        }

        if (string.IsNullOrWhiteSpace(request.NativeName))
        {
            return BadRequest(new { error = "native_name is required" });
        }

        var locale = await _translationService.AddLocaleAsync(
            request.Locale,
            request.Name,
            request.NativeName,
            request.IsDefault);

        _logger.LogInformation(
            "Admin added locale: {Locale} ({Name})",
            request.Locale, request.Name);

        return Ok(new
        {
            success = true,
            message = "Locale added",
            locale = new
            {
                id = locale.Id,
                locale = locale.Locale,
                name = locale.Name,
                native_name = locale.NativeName,
                is_default = locale.IsDefault,
                is_active = locale.IsActive,
                completion_percent = locale.CompletionPercent
            }
        });
    }

    /// <summary>
    /// GET /api/admin/i18n/stats - Get translation completion stats for all locales.
    /// </summary>
    [HttpGet("api/admin/i18n/stats")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetStats()
    {
        var stats = await _translationService.GetTranslationStatsAsync();

        return Ok(new
        {
            data = stats.Select(s => new
            {
                locale = s.Locale,
                name = s.Name,
                native_name = s.NativeName,
                is_default = s.IsDefault,
                total_keys = s.TotalKeys,
                translated_keys = s.TranslatedKeys,
                approved_keys = s.ApprovedKeys,
                completion_percent = s.CompletionPercent
            })
        });
    }

    /// <summary>
    /// GET /api/admin/i18n/missing/{locale} - Get keys missing for a locale.
    /// </summary>
    [HttpGet("api/admin/i18n/missing/{locale}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetMissingKeys(string locale)
    {
        if (string.IsNullOrWhiteSpace(locale) || locale.Length > 10)
        {
            return BadRequest(new { error = "Invalid locale" });
        }

        var missingKeys = await _translationService.GetMissingKeysAsync(locale);

        return Ok(new
        {
            locale,
            count = missingKeys.Count,
            missing_keys = missingKeys
        });
    }

    #endregion

    private int? GetCurrentUserId() => User.GetUserId();
}

#region Request DTOs

public class SetLocaleRequest
{
    [JsonPropertyName("locale")]
    public string Locale { get; set; } = string.Empty;

    [JsonPropertyName("fallback")]
    public string? Fallback { get; set; }
}

public class SetTranslationRequest
{
    [JsonPropertyName("locale")]
    public string Locale { get; set; } = string.Empty;

    [JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;

    [JsonPropertyName("value")]
    public string Value { get; set; } = string.Empty;

    [JsonPropertyName("namespace")]
    public string? Namespace { get; set; }
}

public class BulkSetTranslationsRequest
{
    [JsonPropertyName("locale")]
    public string Locale { get; set; } = string.Empty;

    [JsonPropertyName("translations")]
    public Dictionary<string, string> Translations { get; set; } = new();

    [JsonPropertyName("namespace")]
    public string? Namespace { get; set; }
}

public class AddLocaleRequest
{
    [JsonPropertyName("locale")]
    public string Locale { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("native_name")]
    public string NativeName { get; set; } = string.Empty;

    [JsonPropertyName("is_default")]
    public bool IsDefault { get; set; } = false;
}

#endregion
