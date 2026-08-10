// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Mail;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityAssistedOnboardingController : ControllerBase
{
    private const string CaringCommunityFeatureKey = "features.caring_community";

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityAssistedOnboardingController(NexusDbContext db, TenantContext tenant)
    {
        _db = db;
        _tenant = tenant;
    }

    [HttpPost("assisted-onboarding")]
    public async Task<IActionResult> AssistedOnboarding(
        [FromBody] AssistedOnboardingRequest? request,
        CancellationToken ct = default)
    {
        var adminId = User.GetUserId();
        if (adminId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var fullName = TrimToEmpty(request?.Name);
        var email = TrimToEmpty(request?.Email).ToLowerInvariant();
        var note = TrimToEmpty(request?.Note);
        var errors = new List<object>();

        if (fullName.Length == 0)
        {
            errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "First name is required.", "name"));
        }

        if (email.Length == 0 || !IsEmailLike(email))
        {
            errors.Add(new LaravelErrorRow("VALIDATION_ERROR", "A valid email address is required.", "email"));
        }

        if (errors.Count > 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors });
        }

        var duplicate = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(user => user.TenantId == tenantId && user.Email.ToLower() == email, ct);
        if (duplicate)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Email already exists.", "email"));
        }

        var (firstName, lastName) = SplitName(fullName);
        var tempPassword = GenerateTemporaryPassword();
        var now = DateTime.UtcNow;
        var user = new User
        {
            TenantId = tenantId,
            FirstName = firstName,
            LastName = lastName,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword),
            Role = Role.Names.Member,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync(ct);

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = adminId.Value,
            Action = "coordinator_assisted_onboarding",
            EntityType = "User",
            EntityId = user.Id,
            NewValues = JsonSerializer.Serialize(new
            {
                email,
                note = note.Length > 0 ? note : null
            }),
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.ToString(),
            Severity = AuditSeverity.Info,
            CreatedAt = now
        });
        await _db.SaveChangesAsync(ct);

        var emailSkipped = IsDummyEmail(email);

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                success = true,
                user = new
                {
                    id = user.Id,
                    name = $"{user.FirstName} {user.LastName}".Trim(),
                    email = user.Email
                },
                temp_password = tempPassword,
                email_sent = false,
                email_skipped = emailSkipped
            }
        });
    }

    private async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == CaringCommunityFeatureKey)
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    private static (string FirstName, string LastName) SplitName(string name)
    {
        var parts = name.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 1 ? (parts[0], string.Empty) : (parts[0], parts[1]);
    }

    private static bool IsEmailLike(string email)
    {
        try
        {
            _ = new MailAddress(email);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string GenerateTemporaryPassword()
    {
        return Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant()[..16];
    }

    private static bool IsDummyEmail(string email)
    {
        return email.EndsWith(".invalid", StringComparison.OrdinalIgnoreCase)
            || email.EndsWith(".placeholder", StringComparison.OrdinalIgnoreCase);
    }

    private static string TrimToEmpty(string? value)
    {
        return value?.Trim() ?? string.Empty;
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        return new
        {
            errors = new[]
            {
                new LaravelErrorRow(code, message, field)
            }
        };
    }
}

public sealed class AssistedOnboardingRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("email")] public string? Email { get; set; }
    [JsonPropertyName("phone")] public string? Phone { get; set; }
    [JsonPropertyName("note")] public string? Note { get; set; }
}

public sealed record LaravelErrorRow(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("field")] string? Field = null);
