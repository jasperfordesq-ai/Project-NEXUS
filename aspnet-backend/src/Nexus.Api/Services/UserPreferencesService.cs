// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing user preferences (general and notification).
/// Creates default preferences on first access.
/// </summary>
public class UserPreferencesService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<UserPreferencesService> _logger;

    private static readonly string[] ValidThemes = ["light", "dark", "system"];
    private static readonly string[] ValidDigestFrequencies = ["daily", "weekly", "never"];
    private static readonly string[] ValidProfileVisibilities = ["public", "members", "connections"];

    public UserPreferencesService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<UserPreferencesService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Get user preferences, creating defaults if they don't exist yet.
    /// </summary>
    public async Task<UserPreference> GetPreferencesAsync(int tenantId, int userId)
    {
        var prefs = await _db.UserPreferences
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);

        if (prefs != null) return prefs;

        // Create default preferences
        prefs = new UserPreference
        {
            TenantId = tenantId,
            UserId = userId,
            CreatedAt = DateTime.UtcNow
        };

        _db.UserPreferences.Add(prefs);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Created default preferences for user {UserId} in tenant {TenantId}",
            userId, tenantId);

        return prefs;
    }

    /// <summary>
    /// Partially update user preferences. Only non-null fields in the DTO are applied.
    /// </summary>
    public async Task<UserPreference> UpdatePreferencesAsync(int tenantId, int userId, UpdatePreferencesDto dto)
    {
        var prefs = await GetPreferencesAsync(tenantId, userId);

        if (dto.Theme != null)
        {
            if (!ValidThemes.Contains(dto.Theme))
                throw new ArgumentException($"Invalid theme. Must be one of: {string.Join(", ", ValidThemes)}");
            prefs.Theme = dto.Theme;
        }

        if (dto.Language != null)
        {
            if (string.IsNullOrWhiteSpace(dto.Language) || dto.Language.Length > 10)
                throw new ArgumentException("Language code must be 1-10 characters");
            prefs.Language = dto.Language;
        }

        if (dto.Timezone != null)
        {
            if (string.IsNullOrWhiteSpace(dto.Timezone) || dto.Timezone.Length > 100)
                throw new ArgumentException("Timezone must be 1-100 characters");
            prefs.Timezone = dto.Timezone;
        }

        if (dto.EmailDigestFrequency != null)
        {
            if (!ValidDigestFrequencies.Contains(dto.EmailDigestFrequency))
                throw new ArgumentException($"Invalid digest frequency. Must be one of: {string.Join(", ", ValidDigestFrequencies)}");
            prefs.EmailDigestFrequency = dto.EmailDigestFrequency;
        }

        if (dto.ProfileVisibility != null)
        {
            if (!ValidProfileVisibilities.Contains(dto.ProfileVisibility))
                throw new ArgumentException($"Invalid profile visibility. Must be one of: {string.Join(", ", ValidProfileVisibilities)}");
            prefs.ProfileVisibility = dto.ProfileVisibility;
        }

        if (dto.ShowOnlineStatus.HasValue)
            prefs.ShowOnlineStatus = dto.ShowOnlineStatus.Value;

        if (dto.ShowLastSeen.HasValue)
            prefs.ShowLastSeen = dto.ShowLastSeen.Value;

        prefs.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Updated preferences for user {UserId} in tenant {TenantId}",
            userId, tenantId);

        return prefs;
    }

    /// <summary>
    /// Get all notification preferences for a user.
    /// </summary>
    public async Task<List<NotificationPreference>> GetNotificationPreferencesAsync(int tenantId, int userId)
    {
        return await _db.NotificationPreferences
            .Where(p => p.TenantId == tenantId && p.UserId == userId)
            .OrderBy(p => p.NotificationType)
            .ToListAsync();
    }

    /// <summary>
    /// Upsert a notification preference for a specific notification type.
    /// Only non-null channel flags are updated.
    /// </summary>
    public async Task<NotificationPreference> SetNotificationPreferenceAsync(
        int tenantId, int userId, string notificationType, bool? inApp, bool? push, bool? email)
    {
        if (string.IsNullOrWhiteSpace(notificationType))
            throw new ArgumentException("notification_type is required");

        if (notificationType.Length > 50)
            throw new ArgumentException("notification_type must be 50 characters or less");

        var pref = await _db.NotificationPreferences
            .FirstOrDefaultAsync(p =>
                p.TenantId == tenantId &&
                p.UserId == userId &&
                p.NotificationType == notificationType);

        if (pref == null)
        {
            pref = new NotificationPreference
            {
                TenantId = tenantId,
                UserId = userId,
                NotificationType = notificationType,
                EnableInApp = inApp ?? true,
                EnablePush = push ?? true,
                EnableEmail = email ?? false,
                CreatedAt = DateTime.UtcNow
            };
            _db.NotificationPreferences.Add(pref);
        }
        else
        {
            if (inApp.HasValue) pref.EnableInApp = inApp.Value;
            if (push.HasValue) pref.EnablePush = push.Value;
            if (email.HasValue) pref.EnableEmail = email.Value;
            pref.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Set notification preference '{Type}' for user {UserId} in tenant {TenantId}",
            notificationType, userId, tenantId);

        return pref;
    }

    /// <summary>
    /// Reset all user preferences to defaults. Deletes the existing record
    /// so a fresh default is created on next access.
    /// </summary>
    public async Task<UserPreference> ResetPreferencesAsync(int tenantId, int userId)
    {
        var existing = await _db.UserPreferences
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);

        if (existing != null)
        {
            _db.UserPreferences.Remove(existing);
            await _db.SaveChangesAsync();
        }

        // Create fresh defaults
        var prefs = new UserPreference
        {
            TenantId = tenantId,
            UserId = userId,
            CreatedAt = DateTime.UtcNow
        };

        _db.UserPreferences.Add(prefs);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Reset preferences to defaults for user {UserId} in tenant {TenantId}",
            userId, tenantId);

        return prefs;
    }


    /// <summary>Get privacy settings for a user.</summary>
    public async Task<object> GetPrivacySettingsAsync(int tenantId, int userId)
    {
        var prefs = await GetPreferencesAsync(tenantId, userId);
        return new
        {
            show_email = prefs.ShowEmail,
            show_phone = prefs.ShowPhone,
            show_location = prefs.ShowLocation,
            profile_visibility = prefs.ProfileVisibility,
            searchable = prefs.Searchable
        };
    }

    /// <summary>Update privacy settings for a user.</summary>
    public async Task<(bool Success, string? Error)> UpdatePrivacySettingsAsync(
        int tenantId, int userId,
        bool? showEmail, bool? showPhone, bool? showLocation,
        string? visibility, bool? searchable)
    {
        var prefs = await GetPreferencesAsync(tenantId, userId);

        if (showEmail.HasValue) prefs.ShowEmail = showEmail.Value;
        if (showPhone.HasValue) prefs.ShowPhone = showPhone.Value;
        if (showLocation.HasValue) prefs.ShowLocation = showLocation.Value;
        if (searchable.HasValue) prefs.Searchable = searchable.Value;

        if (visibility != null)
        {
            if (!ValidProfileVisibilities.Contains(visibility))
                return (false, $"Invalid visibility. Must be one of: {string.Join(", ", ValidProfileVisibilities)}");
            prefs.ProfileVisibility = visibility;
        }

        prefs.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>Get notification channel preferences (global toggles).</summary>
    public async Task<object> GetNotificationPreferencesGlobalAsync(int tenantId, int userId)
    {
        var prefs = await GetPreferencesAsync(tenantId, userId);
        return new
        {
            email_notifications = prefs.EmailNotifications,
            push_notifications = prefs.PushNotifications,
            sms_notifications = prefs.SmsNotifications,
            digest_frequency = prefs.EmailDigestFrequency
        };
    }

    /// <summary>Update global notification channel toggles.</summary>
    public async Task<(bool Success, string? Error)> UpdateNotificationPreferencesGlobalAsync(
        int tenantId, int userId,
        bool? email, bool? push, bool? sms, string? digestFreq)
    {
        var prefs = await GetPreferencesAsync(tenantId, userId);

        if (email.HasValue) prefs.EmailNotifications = email.Value;
        if (push.HasValue) prefs.PushNotifications = push.Value;
        if (sms.HasValue) prefs.SmsNotifications = sms.Value;

        if (digestFreq != null)
        {
            if (!ValidDigestFrequencies.Contains(digestFreq))
                return (false, $"Invalid digest frequency. Must be one of: {string.Join(", ", ValidDigestFrequencies)}");
            prefs.EmailDigestFrequency = digestFreq;
        }

        prefs.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>Get display preferences (theme, language, timezone, date format, items per page).</summary>
    public async Task<object> GetDisplayPreferencesAsync(int tenantId, int userId)
    {
        var prefs = await GetPreferencesAsync(tenantId, userId);
        return new
        {
            theme = prefs.Theme,
            language = prefs.Language,
            timezone = prefs.Timezone,
            date_format = prefs.DateFormat,
            items_per_page = prefs.ItemsPerPage
        };
    }

    /// <summary>Update display preferences.</summary>
    public async Task<(bool Success, string? Error)> UpdateDisplayPreferencesAsync(
        int tenantId, int userId,
        string? theme, string? language, string? timezone, string? dateFormat, int? itemsPerPage)
    {
        var prefs = await GetPreferencesAsync(tenantId, userId);

        if (theme != null)
        {
            if (!ValidThemes.Contains(theme))
                return (false, $"Invalid theme. Must be one of: {string.Join(", ", ValidThemes)}");
            prefs.Theme = theme;
        }
        if (language != null) prefs.Language = language;
        if (timezone != null) prefs.Timezone = timezone;
        if (dateFormat != null) prefs.DateFormat = dateFormat;
        if (itemsPerPage.HasValue) prefs.ItemsPerPage = Math.Clamp(itemsPerPage.Value, 5, 100);

        prefs.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (true, null);
    }
}

/// <summary>
/// DTO for partial preference updates. Null fields are not changed.
/// </summary>
public class UpdatePreferencesDto
{
    [System.Text.Json.Serialization.JsonPropertyName("theme")]
    public string? Theme { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("language")]
    public string? Language { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("timezone")]
    public string? Timezone { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("email_digest_frequency")]
    public string? EmailDigestFrequency { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("profile_visibility")]
    public string? ProfileVisibility { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("show_online_status")]
    public bool? ShowOnlineStatus { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("show_last_seen")]
    public bool? ShowLastSeen { get; set; }
}
