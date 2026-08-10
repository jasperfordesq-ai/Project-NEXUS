// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class PaperOnboardingIntakeService
{
    private const string DefaultStatus = "pending_review";
    private const string ManualReviewProvider = "manual_review_stub";
    private const int MaxListLimit = 100;

    private static readonly HashSet<string> AllowedStatuses = new(StringComparer.Ordinal)
    {
        "pending_review",
        "confirmed",
        "rejected",
        "all"
    };

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly NexusDbContext _db;
    private readonly IConfiguration _configuration;

    public PaperOnboardingIntakeService(NexusDbContext db, IConfiguration configuration)
    {
        _db = db;
        _configuration = configuration;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<CaringPaperOnboardingListResult> ListAsync(
        int tenantId,
        string? status,
        int limit,
        CancellationToken ct)
    {
        var normalizedStatus = NormalizeStatus(status);
        var clampedLimit = Math.Max(1, Math.Min(MaxListLimit, limit));
        var query = _db.CaringPaperOnboardingIntakes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.DeletedAt == null);

        if (normalizedStatus != "all")
        {
            query = query.Where(row => row.Status == normalizedStatus);
        }

        var rows = await query
            .OrderByDescending(row => row.CreatedAt)
            .Take(clampedLimit)
            .ToListAsync(ct);

        var items = rows.Select(MapRow).ToArray();
        return new CaringPaperOnboardingListResult(items.Length, items);
    }

    public async Task<CaringPaperOnboardingRow> CreateFromUploadAsync(
        int tenantId,
        int coordinatorId,
        IFormFile file,
        CaringPaperOnboardingSeedFields seedFields,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var originalFilename = SanitizeOriginalFilename(file.FileName);
        var extension = NormalizeExtension(originalFilename, file.ContentType);
        var storedPath = $"caring-paper-onboarding/{tenantId}/{Guid.NewGuid():N}{extension}";
        var fullPath = ToFullPath(storedPath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        await using (var input = file.OpenReadStream())
        await using (var output = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            await input.CopyToAsync(output, ct);
        }

        var row = new CaringPaperOnboardingIntake
        {
            TenantId = tenantId,
            UploadedBy = coordinatorId,
            Status = DefaultStatus,
            OriginalFilename = originalFilename,
            StoredPath = storedPath,
            MimeType = TrimToNull(file.ContentType),
            FileSize = checked((int) file.Length),
            OcrProvider = ManualReviewProvider,
            ExtractedFields = JsonSerializer.Serialize(ExtractFields(seedFields), JsonOptions),
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringPaperOnboardingIntakes.Add(row);
        await _db.SaveChangesAsync(ct);

        return MapRow(row);
    }

    public async Task<CaringPaperOnboardingConfirmResult> ConfirmAsync(
        int tenantId,
        long intakeId,
        int coordinatorId,
        CaringPaperOnboardingConfirmRequest request,
        CancellationToken ct)
    {
        var intake = await _db.CaringPaperOnboardingIntakes
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == intakeId && row.DeletedAt == null, ct);

        if (intake is null)
        {
            return CaringPaperOnboardingConfirmResult.Failure("NOT_FOUND");
        }

        if (!string.Equals(intake.Status, DefaultStatus, StringComparison.Ordinal))
        {
            return CaringPaperOnboardingConfirmResult.Failure("ALREADY_REVIEWED");
        }

        var name = TrimToEmpty(request.Name);
        var email = TrimToEmpty(request.Email).ToLowerInvariant();
        var phone = TrimToEmpty(request.Phone);
        var address = TrimToEmpty(request.Address);
        var dateOfBirth = TrimToEmpty(request.DateOfBirth);

        if (name.Length == 0 || email.Length == 0 || !IsEmailLike(email))
        {
            return CaringPaperOnboardingConfirmResult.Failure("VALIDATION_ERROR");
        }

        var emailExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.TenantId == tenantId && u.Email.ToLower() == email, ct);
        if (emailExists)
        {
            return CaringPaperOnboardingConfirmResult.Failure("EMAIL_EXISTS");
        }

        var nameParts = SplitName(name);
        var tempPassword = GenerateTemporaryPassword();
        var now = DateTime.UtcNow;
        var user = new User
        {
            TenantId = tenantId,
            FirstName = nameParts.FirstName,
            LastName = nameParts.LastName,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword),
            Role = Role.Names.Member,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync(ct);

        var correctedFields = new Dictionary<string, string?>
        {
            ["name"] = name,
            ["date_of_birth"] = dateOfBirth.Length > 0 ? dateOfBirth : null,
            ["address"] = address.Length > 0 ? address : null,
            ["phone"] = phone.Length > 0 ? phone : null,
            ["email"] = email
        };

        intake.Status = "confirmed";
        intake.ReviewedBy = coordinatorId;
        intake.CreatedUserId = user.Id;
        intake.CorrectedFields = JsonSerializer.Serialize(correctedFields, JsonOptions);
        intake.CoordinatorNotes = TrimToNull(request.Note);
        intake.ConfirmedAt = now;
        intake.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);

        return CaringPaperOnboardingConfirmResult.Successful(
            MapRow(intake),
            new CaringPaperOnboardingUserRow(user.Id, $"{user.FirstName} {user.LastName}".Trim(), user.Email),
            tempPassword);
    }

    public IReadOnlyDictionary<string, string?> ExtractFields(CaringPaperOnboardingSeedFields seedFields)
    {
        return new Dictionary<string, string?>
        {
            ["name"] = TrimToNull(seedFields.Name),
            ["date_of_birth"] = TrimToNull(seedFields.DateOfBirth),
            ["address"] = TrimToNull(seedFields.Address),
            ["phone"] = TrimToNull(seedFields.Phone),
            ["email"] = TrimToNull(seedFields.Email)
        };
    }

    private CaringPaperOnboardingRow MapRow(CaringPaperOnboardingIntake row)
    {
        return new CaringPaperOnboardingRow(
            row.Id,
            row.TenantId,
            row.UploadedBy,
            row.ReviewedBy,
            row.CreatedUserId,
            row.Status,
            row.OriginalFilename,
            row.MimeType,
            row.FileSize,
            row.OcrProvider,
            DecodeJson(row.ExtractedFields),
            DecodeJson(row.CorrectedFields),
            row.CoordinatorNotes,
            row.CreatedAt,
            row.UpdatedAt,
            row.ConfirmedAt,
            row.RejectedAt,
            IsDocumentAvailable(row.StoredPath));
    }

    private bool IsDocumentAvailable(string? storedPath)
    {
        return !string.IsNullOrWhiteSpace(storedPath) && File.Exists(ToFullPath(storedPath));
    }

    private string ToFullPath(string storedPath)
    {
        var relative = storedPath.Replace('/', Path.DirectorySeparatorChar);
        return Path.Combine(GetStorageRoot(), relative);
    }

    private string GetStorageRoot()
    {
        var configured = _configuration["CaringCommunity:PaperOnboardingRoot"];
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        var uploadRoot = _configuration["FileUpload:UploadsRoot"];
        if (!string.IsNullOrWhiteSpace(uploadRoot))
        {
            return uploadRoot;
        }

        return Path.Combine(AppContext.BaseDirectory, "storage", "app");
    }

    private static IReadOnlyDictionary<string, string?>? DecodeJson(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string?>>(value, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string NormalizeStatus(string? status)
    {
        var normalized = TrimToEmpty(status);
        return AllowedStatuses.Contains(normalized) ? normalized : DefaultStatus;
    }

    private static string SanitizeOriginalFilename(string? originalFilename)
    {
        var fileName = Path.GetFileName(originalFilename ?? string.Empty).Trim();
        return fileName.Length > 0 ? fileName : "paper-onboarding.bin";
    }

    private static string NormalizeExtension(string originalFilename, string? contentType)
    {
        var extension = Path.GetExtension(originalFilename);
        if (!string.IsNullOrWhiteSpace(extension))
        {
            return extension.ToLowerInvariant();
        }

        return contentType?.Trim().ToLowerInvariant() switch
        {
            "application/pdf" => ".pdf",
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            _ => ".bin"
        };
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
            _ = new System.Net.Mail.MailAddress(email);
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

    private static string TrimToEmpty(string? value)
    {
        return value?.Trim() ?? string.Empty;
    }

    private static string? TrimToNull(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
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
}

public sealed record CaringPaperOnboardingSeedFields(
    string? Name,
    string? DateOfBirth,
    string? Address,
    string? Phone,
    string? Email);

public sealed class CaringPaperOnboardingConfirmRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("date_of_birth")] public string? DateOfBirth { get; set; }
    [JsonPropertyName("address")] public string? Address { get; set; }
    [JsonPropertyName("phone")] public string? Phone { get; set; }
    [JsonPropertyName("email")] public string? Email { get; set; }
    [JsonPropertyName("note")] public string? Note { get; set; }
}

public sealed record CaringPaperOnboardingListResult(
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("items")] IReadOnlyList<CaringPaperOnboardingRow> Items);

public sealed record CaringPaperOnboardingRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("uploaded_by")] int? UploadedBy,
    [property: JsonPropertyName("reviewed_by")] int? ReviewedBy,
    [property: JsonPropertyName("created_user_id")] int? CreatedUserId,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("original_filename")] string OriginalFilename,
    [property: JsonPropertyName("mime_type")] string? MimeType,
    [property: JsonPropertyName("file_size")] int? FileSize,
    [property: JsonPropertyName("ocr_provider")] string OcrProvider,
    [property: JsonPropertyName("extracted_fields")] IReadOnlyDictionary<string, string?>? ExtractedFields,
    [property: JsonPropertyName("corrected_fields")] IReadOnlyDictionary<string, string?>? CorrectedFields,
    [property: JsonPropertyName("coordinator_notes")] string? CoordinatorNotes,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt,
    [property: JsonPropertyName("confirmed_at")] DateTime? ConfirmedAt,
    [property: JsonPropertyName("rejected_at")] DateTime? RejectedAt,
    [property: JsonPropertyName("document_available")] bool DocumentAvailable);

public sealed record CaringPaperOnboardingUserRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("email")] string Email);

public sealed record CaringPaperOnboardingConfirmResult(
    bool Success,
    string? Code,
    CaringPaperOnboardingRow? Intake,
    CaringPaperOnboardingUserRow? User,
    string? TempPassword)
{
    public static CaringPaperOnboardingConfirmResult Failure(string code) =>
        new(false, code, null, null, null);

    public static CaringPaperOnboardingConfirmResult Successful(
        CaringPaperOnboardingRow intake,
        CaringPaperOnboardingUserRow user,
        string tempPassword) =>
        new(true, null, intake, user, tempPassword);
}
