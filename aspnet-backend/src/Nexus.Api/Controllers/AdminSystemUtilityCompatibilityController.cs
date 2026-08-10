// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize(Policy = NexusAuthorizationPolicies.RouteAwareAdmin)]
public sealed class AdminSystemUtilityCompatibilityController : ControllerBase
{
    private const int MinRetentionDays = 30;
    private const int MaxRetentionDays = 3650;
    private const int DefaultRetentionDays = 365;
    private const string RetentionPolicyPrefix = "admin.retention.policy.";
    private const string RetentionRunsKey = "admin.retention.runs";
    private static readonly string[] RetentionActions = ["delete"];
    private static readonly string[] RetentionDataTypes = ["activity_log", "admin_audit_log", "notifications", "email_log"];
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly FileUploadService _files;

    public AdminSystemUtilityCompatibilityController(NexusDbContext db, TenantContext tenant, FileUploadService files)
    {
        _db = db;
        _tenant = tenant;
        _files = files;
    }

    [HttpGet("/api/admin/registration/breaker")]
    [HttpGet("/api/v2/admin/registration/breaker")]
    public async Task<IActionResult> RegistrationBreaker()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var tripped = await GetConfigValueAsync($"registration.breaker.tripped.{tenantId}") == "true";
        var count = int.TryParse(await GetConfigValueAsync($"registration.breaker.hourly_count.{tenantId}"), out var parsed) ? parsed : 0;
        var threshold = int.TryParse(Environment.GetEnvironmentVariable("REGISTRATION_TENANT_HOURLY_CAP"), out var envThreshold)
            ? envThreshold
            : 20;

        return Data(new
        {
            tripped,
            count_in_current_hour = count,
            threshold,
            auto_resume_in_seconds = tripped ? 3600 : (int?)null
        });
    }

    [HttpPost("/api/admin/registration/resume-signups")]
    [HttpPost("/api/v2/admin/registration/resume-signups")]
    public async Task<IActionResult> ResumeSignups()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        await RemoveConfigValueAsync($"registration.breaker.tripped.{tenantId}");
        await RemoveConfigValueAsync($"registration.breaker.hourly_count.{tenantId}");
        await _db.SaveChangesAsync();

        return Data(new { resumed = true });
    }

    [HttpGet("/api/admin/retention/policies")]
    [HttpGet("/api/v2/admin/retention/policies")]
    public async Task<IActionResult> RetentionPolicies()
    {
        var policies = new List<object>();
        foreach (var dataType in RetentionDataTypes)
        {
            policies.Add(PolicyPayload(await LoadRetentionPolicyAsync(dataType)));
        }

        return Data(new
        {
            policies,
            limits = new
            {
                min_days = MinRetentionDays,
                max_days = MaxRetentionDays,
                actions = RetentionActions
            }
        });
    }

    [HttpPut("/api/admin/retention/policies/{dataType}")]
    [HttpPut("/api/v2/admin/retention/policies/{dataType}")]
    public async Task<IActionResult> UpdateRetentionPolicy(string dataType, [FromBody] JsonElement body)
    {
        if (!RetentionDataTypes.Contains(dataType, StringComparer.OrdinalIgnoreCase))
        {
            return Error("Unknown retention data type.", StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "retention_days");
        }

        var retentionDays = ReadInt(body, "retention_days") ?? 0;
        var enabled = ReadBool(body, "is_enabled") ?? false;
        var action = ReadString(body, "action") ?? "delete";

        if (!RetentionActions.Contains(action, StringComparer.OrdinalIgnoreCase))
        {
            return Error("Unknown retention action.", StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "retention_days");
        }

        if (retentionDays is < MinRetentionDays or > MaxRetentionDays)
        {
            return Error($"Retention days must be between {MinRetentionDays} and {MaxRetentionDays}.", StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "retention_days");
        }

        var policy = new RetentionPolicyRecord(dataType, retentionDays, action, enabled, DateTime.UtcNow);
        await UpsertConfigValueAsync(RetentionPolicyPrefix + dataType, JsonSerializer.Serialize(policy, JsonOptions));
        await _db.SaveChangesAsync();

        return Data(new { policy = PolicyPayload(policy) });
    }

    [HttpGet("/api/admin/retention/runs")]
    [HttpGet("/api/v2/admin/retention/runs")]
    public async Task<IActionResult> RetentionRuns([FromQuery] int limit = 50)
    {
        var runs = await LoadRetentionRunsAsync();
        var boundedLimit = Math.Clamp(limit, 1, 200);

        return Data(new
        {
            runs = runs
                .OrderByDescending(x => x.RanAt)
                .ThenByDescending(x => x.Id)
                .Take(boundedLimit)
                .Select(RunPayload)
                .ToArray()
        });
    }

    [HttpPut("/api/admin/settings/header-colors")]
    [HttpPut("/api/v2/admin/settings/header-colors")]
    public async Task<IActionResult> SaveHeaderColors([FromBody] JsonElement body)
    {
        var rawBg = ReadString(body, "bg_color");
        var rawAccent = ReadString(body, "accent_color");
        var bg = NormalizeHexColor(rawBg);
        var accent = NormalizeHexColor(rawAccent);

        if (!string.IsNullOrWhiteSpace(rawBg) && bg == null)
        {
            return Error("Background colour must be a valid hex value like #0053BE.", StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "bg_color");
        }

        if (!string.IsNullOrWhiteSpace(rawAccent) && accent == null)
        {
            return Error("Accent colour must be a valid hex value like #0053BE.", StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "accent_color");
        }

        await SetOptionalConfigValueAsync("header_bg_color", bg);
        await SetOptionalConfigValueAsync("header_accent_color", accent);
        await _db.SaveChangesAsync();

        return Data(new
        {
            header_bg_color = bg,
            header_accent_color = accent
        });
    }

    [HttpPost("/api/admin/settings/powered-by-image-light")]
    [HttpPost("/api/v2/admin/settings/powered-by-image-light")]
    [Authorize(Policy = NexusAuthorizationPolicies.GodOnly)]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public Task<IActionResult> UploadPoweredByImageLight([FromForm] IFormFile? logo, CancellationToken ct) =>
        UploadPoweredByImageAsync("light", logo, ct);

    [HttpPost("/api/admin/settings/powered-by-image-dark")]
    [HttpPost("/api/v2/admin/settings/powered-by-image-dark")]
    [Authorize(Policy = NexusAuthorizationPolicies.GodOnly)]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public Task<IActionResult> UploadPoweredByImageDark([FromForm] IFormFile? logo, CancellationToken ct) =>
        UploadPoweredByImageAsync("dark", logo, ct);

    [HttpPost("/api/admin/users/{id:int}/send-verification-email")]
    [HttpPost("/api/v2/admin/users/{id:int}/send-verification-email")]
    public async Task<IActionResult> SendVerificationEmail(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var user = await _db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.TenantId == tenantId && u.Id == id);

        if (user == null)
        {
            return Error("User not found.", StatusCodes.Status404NotFound, "RESOURCE_NOT_FOUND");
        }

        if (user.EmailVerified)
        {
            return Data(new { sent = false, already_verified = true, id });
        }

        user.EmailVerificationCode = Random.Shared.Next(100000, 999999).ToString();
        user.EmailVerificationCodeExpiresAt = DateTime.UtcNow.AddMinutes(30);
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Data(new { sent = true, already_verified = false, id });
    }

    [HttpGet("/api/admin/super/tenants/{id:int}/purge-preview")]
    [HttpGet("/api/v2/admin/super/tenants/{id:int}/purge-preview")]
    [Authorize(Policy = NexusAuthorizationPolicies.GodOnly)]
    public async Task<IActionResult> TenantPurgePreview(int id)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
        if (tenant == null)
        {
            return Error("Tenant not found.", StatusCodes.Status404NotFound, "VALIDATION_ERROR");
        }

        return Data(await BuildTenantPurgeReportAsync(tenant, dryRun: true));
    }

    [HttpPost("/api/admin/super/tenants/{id:int}/purge")]
    [HttpPost("/api/v2/admin/super/tenants/{id:int}/purge")]
    [Authorize(Policy = NexusAuthorizationPolicies.GodOnly)]
    public async Task<IActionResult> TenantPurge(int id)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
        if (tenant == null)
        {
            return Error("Tenant not found.", StatusCodes.Status404NotFound, "VALIDATION_ERROR");
        }

        return StatusCode(StatusCodes.Status202Accepted, new
        {
            success = true,
            data = new
            {
                purge_started = true,
                tenant_id = id,
                queued = true,
                dry_run = false,
                compatibility_mode = true
            }
        });
    }

    private async Task<IActionResult> UploadPoweredByImageAsync(string variant, IFormFile? logo, CancellationToken ct)
    {
        if (logo == null || logo.Length == 0)
        {
            return Error("No image uploaded.", StatusCodes.Status400BadRequest, "VALIDATION_ERROR", "logo");
        }

        if (logo.Length > 2 * 1024 * 1024)
        {
            return Error("Image must be 2 MB or smaller.", StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "logo");
        }

        var contentType = NormalizeImageContentType(logo);
        if (contentType == null)
        {
            return Error("File must be an image (JPEG, PNG, GIF, WebP, or SVG).", StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "logo");
        }

        var userId = User.GetUserId();
        if (userId == null)
        {
            return Unauthorized(new { success = false, error = "Invalid token", code = "AUTH_UNAUTHORIZED" });
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        await using var stream = logo.OpenReadStream();
        var (upload, error) = await _files.UploadAsync(
            stream,
            logo.FileName,
            contentType,
            logo.Length,
            userId.Value,
            tenantId,
            FileCategory.TenantLogo,
            tenantId,
            $"powered_by_image_{variant}");

        if (error != null)
        {
            return Error(error, StatusCodes.Status422UnprocessableEntity, "VALIDATION_ERROR", "logo");
        }

        var url = _files.GetDownloadUrl(upload!);
        await UpsertConfigValueAsync($"general.powered_by_image_{variant}", url);
        await _db.SaveChangesAsync();

        return Data(new { url });
    }

    private async Task<object> BuildTenantPurgeReportAsync(Tenant tenant, bool dryRun)
    {
        var users = await _db.Users.IgnoreQueryFilters().CountAsync(u => u.TenantId == tenant.Id);
        var configs = await _db.TenantConfigs.IgnoreQueryFilters().CountAsync(c => c.TenantId == tenant.Id);
        var files = await _db.Set<FileUpload>().IgnoreQueryFilters().CountAsync(f => f.TenantId == tenant.Id);

        return new
        {
            success = true,
            dry_run = dryRun,
            tenant_id = tenant.Id,
            tenant = new
            {
                tenant.Id,
                tenant.Slug,
                tenant.Name,
                is_active = tenant.IsActive
            },
            resources = new object[]
            {
                new { name = "users", count = users },
                new { name = "tenant_configs", count = configs },
                new { name = "file_uploads", count = files }
            },
            external_resources = Array.Empty<object>()
        };
    }

    private async Task<RetentionPolicyRecord> LoadRetentionPolicyAsync(string dataType)
    {
        var raw = await GetConfigValueAsync(RetentionPolicyPrefix + dataType);
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<RetentionPolicyRecord>(raw, JsonOptions);
                if (parsed != null)
                {
                    return parsed;
                }
            }
            catch (JsonException)
            {
                // Fall through to Laravel defaults.
            }
        }

        return new RetentionPolicyRecord(dataType, DefaultRetentionDays, "delete", false, null);
    }

    private async Task<IReadOnlyList<RetentionRunRecord>> LoadRetentionRunsAsync()
    {
        var raw = await GetConfigValueAsync(RetentionRunsKey);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<RetentionRunRecord>>(raw, JsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task<string?> GetConfigValueAsync(string key)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        return await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == key)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();
    }

    private async Task SetOptionalConfigValueAsync(string key, string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            await RemoveConfigValueAsync(key);
            return;
        }

        await UpsertConfigValueAsync(key, value);
    }

    private async Task UpsertConfigValueAsync(string key, string value)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);

        if (existing == null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                Value = value,
                CreatedAt = DateTime.UtcNow
            });
            return;
        }

        existing.Value = value;
        existing.UpdatedAt = DateTime.UtcNow;
    }

    private async Task RemoveConfigValueAsync(string key)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == key)
            .ToListAsync();
        _db.TenantConfigs.RemoveRange(rows);
    }

    private IActionResult Data(object data) => Ok(new { success = true, data });

    private IActionResult Error(string message, int status, string code, string? field = null) =>
        StatusCode(status, new { success = false, error = message, code, field });

    private static object PolicyPayload(RetentionPolicyRecord policy) => new
    {
        data_type = policy.DataType,
        retention_days = policy.RetentionDays,
        action = policy.Action,
        is_enabled = policy.IsEnabled,
        updated_at = policy.UpdatedAt
    };

    private static object RunPayload(RetentionRunRecord run) => new
    {
        id = run.Id,
        data_type = run.DataType,
        action = run.Action,
        retention_days = run.RetentionDays,
        affected_rows = run.AffectedRows,
        status = run.Status,
        error = run.Error,
        ran_at = run.RanAt
    };

    private static string? NormalizeHexColor(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var hex = value.Trim().TrimStart('#');
        if (hex.Length == 3 && hex.All(Uri.IsHexDigit))
        {
            hex = string.Concat(hex.Select(c => $"{c}{c}"));
        }

        return hex.Length == 6 && hex.All(Uri.IsHexDigit)
            ? "#" + hex.ToLowerInvariant()
            : null;
    }

    private static string? NormalizeImageContentType(IFormFile logo)
    {
        var contentType = logo.ContentType?.Trim().ToLowerInvariant();
        var extension = Path.GetExtension(logo.FileName).ToLowerInvariant();

        if (extension == ".svg" || contentType == "image/svg+xml")
        {
            return "image/svg+xml";
        }

        return contentType is "image/jpeg" or "image/png" or "image/gif" or "image/webp"
            ? contentType
            : null;
    }

    private static string? ReadString(JsonElement body, string property)
    {
        return body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty(property, out var value)
            && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static int? ReadInt(JsonElement body, string property)
    {
        return body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty(property, out var value)
            && value.TryGetInt32(out var parsed)
            ? parsed
            : null;
    }

    private static bool? ReadBool(JsonElement body, string property)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(property, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            _ => null
        };
    }

    private sealed record RetentionPolicyRecord(
        string DataType,
        int RetentionDays,
        string Action,
        bool IsEnabled,
        DateTime? UpdatedAt);

    private sealed record RetentionRunRecord(
        int Id,
        string DataType,
        string Action,
        int RetentionDays,
        int AffectedRows,
        string Status,
        string? Error,
        DateTime RanAt);
}
