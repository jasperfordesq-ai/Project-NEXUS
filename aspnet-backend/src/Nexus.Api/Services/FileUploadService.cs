// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using System.Text;

namespace Nexus.Api.Services;

/// <summary>
/// Manages file uploads: validation, storage, and retrieval.
/// Files are stored on the local filesystem under a configurable uploads directory.
/// </summary>
public class FileUploadService
{
    private readonly NexusDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<FileUploadService> _logger;

    private const long MaxFileSizeBytes = 10 * 1024 * 1024; // 10 MB
    private const long MaxAvatarSizeBytes = 5 * 1024 * 1024; // 5 MB
    private const long MaxTenantLogoSizeBytes = 2 * 1024 * 1024; // 2 MB
    private const int MaxVoiceDurationSeconds = 300;

    private static readonly HashSet<string> AllowedImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/gif", "image/webp"
    };

    private static readonly HashSet<string> AllowedTenantLogoTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"
    };

    private static readonly HashSet<string> AllowedDocumentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/gif", "image/webp",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain", "text/csv"
    };

    private static readonly IReadOnlyDictionary<string, string[]> AllowedMessageTypesByExtension =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = ["image/jpeg"],
        [".jpeg"] = ["image/jpeg"],
        [".png"] = ["image/png"],
        [".gif"] = ["image/gif"],
        [".webp"] = ["image/webp"],
        [".pdf"] = ["application/pdf"],
        [".txt"] = ["text/plain"],
        [".csv"] = ["text/plain", "text/csv", "application/csv"],
        [".doc"] = ["application/msword"],
        [".docx"] = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
        [".xls"] = ["application/vnd.ms-excel"],
        [".xlsx"] = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"]
    };

    public FileUploadService(NexusDbContext db, IConfiguration config, ILogger<FileUploadService> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Upload a file. Validates type and size, stores to disk, records in database.
    /// </summary>
    public async Task<(FileUpload? File, string? Error)> UploadAsync(
        Stream fileStream, string originalFilename, string contentType, long fileSize,
        int userId, int tenantId, FileCategory category, int? entityId = null, string? entityType = null,
        CancellationToken cancellationToken = default)
    {
        var maxSize = category switch
        {
            FileCategory.Avatar => MaxAvatarSizeBytes,
            FileCategory.TenantLogo => MaxTenantLogoSizeBytes,
            _ => MaxFileSizeBytes
        };
        if (fileSize > maxSize)
            return (null, category == FileCategory.Message
                ? "Attachment is too large (max 10 MB)"
                : $"File too large. Maximum size: {maxSize / 1024 / 1024} MB");

        if (fileSize <= 0)
            return (null, "File is empty");

        var safeOriginalFilename = SanitizeFilename(originalFilename);
        var extension = Path.GetExtension(safeOriginalFilename).ToLowerInvariant();
        string storedContentType;

        if (category == FileCategory.Message)
        {
            // Laravel's message uploader requires an allow-listed extension and
            // validates it against the bytes on disk. The multipart Content-Type
            // header is intentionally not trusted.
            if (string.IsNullOrWhiteSpace(extension)
                || !AllowedMessageTypesByExtension.ContainsKey(extension))
            {
                return (null, "That attachment type is not allowed");
            }

            storedContentType = string.Empty;
        }
        else
        {
            var allowedTypes = category switch
            {
                FileCategory.Document => AllowedDocumentTypes,
                FileCategory.TenantLogo => AllowedTenantLogoTypes,
                _ => AllowedImageTypes
            };
            if (!allowedTypes.Contains(contentType))
                return (null, $"File type '{contentType}' is not allowed for {category}");

            storedContentType = contentType;
            if (string.IsNullOrEmpty(extension))
                extension = MimeToExtension(contentType);
        }

        var storedFilename = $"{Guid.NewGuid():N}{extension}";
        var relativePath = Path.Combine(tenantId.ToString(), category.ToString().ToLowerInvariant(), storedFilename);
        var uploadsRoot = GetUploadsRoot();
        var fullPath = Path.Combine(uploadsRoot, relativePath);
        var directory = Path.GetDirectoryName(fullPath)!;
        Directory.CreateDirectory(directory);
        var temporaryPath = fullPath + $".{Guid.NewGuid():N}.uploading";
        FileUpload? upload = null;
        var databasePersisted = false;

        try
        {
            var actualSize = await CopyToTemporaryFileAsync(
                fileStream,
                temporaryPath,
                maxSize,
                cancellationToken);
            if (actualSize < 0)
            {
                TryDeleteFile(temporaryPath, "oversized upload");
                return (null, category == FileCategory.Message
                    ? "Attachment is too large (max 10 MB)"
                    : $"File too large. Maximum size: {maxSize / 1024 / 1024} MB");
            }
            if (actualSize == 0)
            {
                TryDeleteFile(temporaryPath, "empty upload");
                return (null, "File is empty");
            }

            if (category == FileCategory.Message)
            {
                storedContentType = await DetectMessageContentTypeAsync(
                    temporaryPath,
                    extension,
                    cancellationToken);
                if (!AllowedMessageTypesByExtension[extension].Contains(
                        storedContentType,
                        StringComparer.OrdinalIgnoreCase))
                {
                    TryDeleteFile(temporaryPath, "invalid message attachment");
                    return (null, "That attachment type is not allowed");
                }
            }

            File.Move(temporaryPath, fullPath);

            upload = new FileUpload
            {
                TenantId = tenantId,
                UserId = userId,
                OriginalFilename = safeOriginalFilename,
                StoredFilename = storedFilename,
                FilePath = relativePath.Replace('\\', '/'),
                ContentType = storedContentType,
                FileSizeBytes = actualSize,
                Category = category,
                EntityId = entityId,
                EntityType = entityType,
                CreatedAt = DateTime.UtcNow
            };

            _db.Set<FileUpload>().Add(upload);
            await _db.SaveChangesAsync(cancellationToken);
            databasePersisted = true;

            _logger.LogInformation("File uploaded: {FileId} ({Category}) by user {UserId}", upload.Id, category, userId);
            return (upload, null);
        }
        catch
        {
            TryDeleteFile(temporaryPath, "failed upload staging");
            if (!databasePersisted)
            {
                TryDeleteFile(fullPath, "failed upload persistence");
                if (upload != null)
                    _db.Entry(upload).State = EntityState.Detached;
            }
            throw;
        }
    }

    /// <summary>
    /// Get a file record by ID. Validates ownership or tenant access.
    /// </summary>
    public async Task<FileUpload?> GetByIdAsync(int fileId)
    {
        return await _db.Set<FileUpload>().FirstOrDefaultAsync(f => f.Id == fileId);
    }

    /// <summary>
    /// Get the full filesystem path for a file.
    /// </summary>
    public string GetFullPath(FileUpload file)
    {
        return Path.Combine(GetUploadsRoot(), file.FilePath);
    }

    /// <summary>
    /// Get the stable API URL that serves a file through the download endpoint.
    /// </summary>
    public string GetDownloadUrl(FileUpload file)
    {
        return $"/api/files/{file.Id}/download";
    }

    /// <summary>
    /// List files for an entity (e.g., all images for a listing).
    /// </summary>
    public async Task<List<FileUpload>> GetByEntityAsync(string entityType, int entityId)
    {
        return await _db.Set<FileUpload>()
            .Where(f => f.EntityType == entityType && f.EntityId == entityId)
            .OrderByDescending(f => f.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Delete a file. Removes from disk and database.
    /// </summary>
    public async Task<(bool Success, string? Error)> DeleteAsync(int fileId, int userId)
    {
        var file = await _db.Set<FileUpload>().FirstOrDefaultAsync(f => f.Id == fileId);
        if (file == null)
            return (false, "File not found");

        if (file.UserId != userId)
            return (false, "You can only delete your own files");

        // Delete from disk
        var fullPath = GetFullPath(file);
        if (File.Exists(fullPath))
        {
            try { File.Delete(fullPath); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { _logger.LogWarning(ex, "Failed to delete file from disk: {Path}", fullPath); }
        }

        _db.Set<FileUpload>().Remove(file);
        await _db.SaveChangesAsync();

        _logger.LogInformation("File deleted: {FileId} by user {UserId}", fileId, userId);
        return (true, null);
    }

    private string GetUploadsRoot()
    {
        return _config["FileUpload:UploadsRoot"] ?? Path.Combine(AppContext.BaseDirectory, "uploads");
    }

    private static string SanitizeFilename(string filename)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var basename = Path.GetFileName(filename.Trim());
        var sanitized = string.Concat(basename.Where(c => !invalid.Contains(c) && !char.IsControl(c)));
        return string.IsNullOrWhiteSpace(sanitized)
            ? "attachment"
            : new string(sanitized.Take(255).ToArray());
    }

    public async Task<bool> DeleteEntityFileAsync(
        int fileId,
        int tenantId,
        string entityType,
        int entityId,
        CancellationToken cancellationToken = default)
    {
        var file = await _db.Set<FileUpload>().IgnoreQueryFilters().FirstOrDefaultAsync(candidate =>
            candidate.Id == fileId
            && candidate.TenantId == tenantId
            && candidate.EntityType == entityType
            && candidate.EntityId == entityId,
            cancellationToken);
        if (file is null) return false;
        var fullPath = GetFullPath(file);
        if (File.Exists(fullPath))
        {
            try { File.Delete(fullPath); }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                _logger.LogWarning(exception, "Failed to delete entity file from disk: {Path}", fullPath);
                return false;
            }
        }
        _db.Set<FileUpload>().Remove(file);
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// Stores a voice-message recording without widening the ordinary message
    /// attachment allow-list. MIME is derived from file signatures; the client
    /// header is used only to distinguish audio-only WebM from video/webm, as
    /// Laravel's AudioUploader accepts both finfo results.
    /// </summary>
    public async Task<(FileUpload? File, int DurationSeconds, string? Error)> UploadVoiceAsync(
        Stream fileStream,
        string originalFilename,
        string contentType,
        long fileSize,
        int durationSeconds,
        int userId,
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        if (fileSize <= 0)
            return (null, 0, "Voice message file is required");
        if (fileSize > MaxFileSizeBytes)
            return (null, 0, "Audio file too large. Maximum 10MB allowed.");
        if (durationSeconds > MaxVoiceDurationSeconds)
            return (null, 0, "Voice message too long. Maximum 5 minutes allowed.");

        var uploadsRoot = GetUploadsRoot();
        var directory = Path.Combine(uploadsRoot, tenantId.ToString(), "voice_messages");
        Directory.CreateDirectory(directory);
        var temporaryPath = Path.Combine(directory, $".{Guid.NewGuid():N}.uploading");
        string? fullPath = null;
        FileUpload? upload = null;
        var databasePersisted = false;

        try
        {
            var actualSize = await CopyToTemporaryFileAsync(
                fileStream,
                temporaryPath,
                MaxFileSizeBytes,
                cancellationToken);
            if (actualSize < 0)
            {
                TryDeleteFile(temporaryPath, "oversized voice upload");
                return (null, 0, "Audio file too large. Maximum 10MB allowed.");
            }
            if (actualSize == 0)
            {
                TryDeleteFile(temporaryPath, "empty voice upload");
                return (null, 0, "Voice message file is required");
            }

            var detectedContentType = await DetectVoiceContentTypeAsync(
                temporaryPath,
                contentType,
                cancellationToken);
            if (detectedContentType == null)
            {
                TryDeleteFile(temporaryPath, "invalid voice upload");
                return (null, 0, "Invalid audio format. Supported: WebM, OGG, MP3, WAV, M4A, AAC");
            }

            var extension = VoiceMimeToExtension(detectedContentType);
            var storedFilename = $"{Guid.NewGuid():N}.{extension}";
            var relativePath = Path.Combine(tenantId.ToString(), "voice_messages", storedFilename);
            fullPath = Path.Combine(uploadsRoot, relativePath);
            File.Move(temporaryPath, fullPath);

            upload = new FileUpload
            {
                TenantId = tenantId,
                UserId = userId,
                OriginalFilename = SanitizeFilename(originalFilename),
                StoredFilename = storedFilename,
                FilePath = relativePath.Replace('\\', '/'),
                ContentType = detectedContentType,
                FileSizeBytes = actualSize,
                Category = FileCategory.Message,
                EntityType = "message_voice",
                CreatedAt = DateTime.UtcNow
            };
            _db.FileUploads.Add(upload);
            await _db.SaveChangesAsync(cancellationToken);
            databasePersisted = true;

            return (upload, Math.Max(1, durationSeconds), null);
        }
        catch
        {
            TryDeleteFile(temporaryPath, "failed voice staging");
            if (!databasePersisted && fullPath != null)
            {
                TryDeleteFile(fullPath, "failed voice persistence");
                if (upload != null)
                    _db.Entry(upload).State = EntityState.Detached;
            }
            throw;
        }
    }

    /// <summary>
    /// Removes an unattached staged upload. A database row is deliberately
    /// retained if physical deletion fails so stored bytes never become an
    /// untracked orphan.
    /// </summary>
    public async Task<bool> DeleteStagedAsync(
        FileUpload upload,
        CancellationToken cancellationToken = default)
    {
        var fullPath = GetFullPath(upload);
        try
        {
            if (File.Exists(fullPath))
                File.Delete(fullPath);
        }
        catch (Exception exception)
        {
            _logger.LogCritical(
                exception,
                "Failed to remove staged upload {FileUploadId} at {Path}; retaining its database row",
                upload.Id,
                fullPath);
            return false;
        }

        try
        {
            _db.ChangeTracker.Clear();
            if (upload.Id > 0)
            {
                await _db.FileUploads
                    .IgnoreQueryFilters()
                    .Where(row => row.Id == upload.Id && row.TenantId == upload.TenantId)
                    .ExecuteDeleteAsync(cancellationToken);
            }
            return true;
        }
        catch (Exception exception)
        {
            _logger.LogCritical(exception, "Failed to remove staged upload row {FileUploadId}", upload.Id);
            return false;
        }
    }

    private async Task<long> CopyToTemporaryFileAsync(
        Stream input,
        string temporaryPath,
        long maximumBytes,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[81_920];
        long total = 0;
        await using var output = new FileStream(
            temporaryPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            buffer.Length,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        while (true)
        {
            var read = await input.ReadAsync(buffer.AsMemory(), cancellationToken);
            if (read == 0)
                break;

            total += read;
            if (total > maximumBytes)
                return -1;

            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }

        await output.FlushAsync(cancellationToken);
        return total;
    }

    private static async Task<string> DetectMessageContentTypeAsync(
        string path,
        string extension,
        CancellationToken cancellationToken)
    {
        var sample = new byte[8_192];
        int count;
        await using (var input = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            sample.Length,
            FileOptions.Asynchronous | FileOptions.SequentialScan))
        {
            count = await input.ReadAsync(sample.AsMemory(), cancellationToken);
        }

        return DetectMessageContentType(sample, count, extension);
    }

    private static async Task<string?> DetectVoiceContentTypeAsync(
        string path,
        string claimedContentType,
        CancellationToken cancellationToken)
    {
        var sample = new byte[64];
        int count;
        await using (var input = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            sample.Length,
            FileOptions.Asynchronous | FileOptions.SequentialScan))
        {
            count = await input.ReadAsync(sample.AsMemory(), cancellationToken);
        }

        return DetectVoiceContentType(sample, count, claimedContentType);
    }

    private static string? DetectVoiceContentType(byte[] sample, int count, string claimedContentType)
    {
        var bytes = sample.AsSpan(0, count);
        var baseClaim = claimedContentType.Split(';', 2, StringSplitOptions.None)[0].Trim().ToLowerInvariant();

        if (StartsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]))
            return baseClaim is "audio/webm" or "video/webm" ? baseClaim : "video/webm";
        if (StartsWith(bytes, Encoding.ASCII.GetBytes("OggS")))
            return "audio/ogg";
        if (bytes.Length >= 2
            && bytes[0] == 0xff
            && bytes[1] is 0xf1 or 0xf9)
            return "audio/aac";
        if (StartsWith(bytes, Encoding.ASCII.GetBytes("ID3"))
            || (bytes.Length >= 2 && bytes[0] == 0xff && bytes[1] is 0xfb or 0xf3 or 0xf2))
            return "audio/mpeg";
        if (bytes.Length >= 12
            && StartsWith(bytes, Encoding.ASCII.GetBytes("RIFF"))
            && bytes.Slice(8, 4).SequenceEqual(Encoding.ASCII.GetBytes("WAVE")))
            return "audio/wav";
        if (bytes.Length >= 12
            && bytes.Slice(4, 4).SequenceEqual(Encoding.ASCII.GetBytes("ftyp")))
            return baseClaim is "audio/x-m4a" ? "audio/x-m4a" : "audio/mp4";
        return null;
    }

    private static string DetectMessageContentType(byte[] sample, int count, string extension)
    {
        var bytes = sample.AsSpan(0, count);
        if (StartsWith(bytes, [0xff, 0xd8, 0xff]))
            return "image/jpeg";
        if (StartsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
            return "image/png";
        if (StartsWith(bytes, Encoding.ASCII.GetBytes("GIF87a"))
            || StartsWith(bytes, Encoding.ASCII.GetBytes("GIF89a")))
            return "image/gif";
        if (bytes.Length >= 12
            && StartsWith(bytes, Encoding.ASCII.GetBytes("RIFF"))
            && bytes.Slice(8, 4).SequenceEqual(Encoding.ASCII.GetBytes("WEBP")))
            return "image/webp";
        if (StartsWith(bytes, Encoding.ASCII.GetBytes("%PDF-")))
            return "application/pdf";
        if (StartsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
            return extension.Equals(".xls", StringComparison.OrdinalIgnoreCase)
                ? "application/vnd.ms-excel"
                : "application/msword";
        if (StartsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
            || StartsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
            || StartsWith(bytes, [0x50, 0x4b, 0x07, 0x08]))
            return "application/zip";
        if (LooksLikeUtf8Text(bytes))
            return "text/plain";

        return "application/octet-stream";
    }

    private static bool StartsWith(ReadOnlySpan<byte> bytes, ReadOnlySpan<byte> signature)
        => bytes.Length >= signature.Length && bytes[..signature.Length].SequenceEqual(signature);

    private static bool LooksLikeUtf8Text(ReadOnlySpan<byte> bytes)
    {
        try
        {
            var text = new UTF8Encoding(false, true).GetString(bytes);
            return text.All(character => character is '\r' or '\n' or '\t'
                || (!char.IsControl(character) && character != '\u007f'));
        }
        catch (DecoderFallbackException)
        {
            return false;
        }
    }

    private void TryDeleteFile(string path, string reason)
    {
        if (!File.Exists(path))
            return;

        try
        {
            File.Delete(path);
        }
        catch (Exception exception)
        {
            _logger.LogCritical(exception, "Failed to remove {Reason} file at {Path}", reason, path);
        }
    }

    private static string MimeToExtension(string contentType) => contentType switch
    {
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "image/svg+xml" => ".svg",
        "application/pdf" => ".pdf",
        _ => ".bin"
    };

    private static string VoiceMimeToExtension(string contentType) => contentType switch
    {
        "audio/webm" or "video/webm" => "webm",
        "audio/ogg" => "ogg",
        "audio/mpeg" or "audio/mp3" => "mp3",
        "audio/wav" or "audio/x-wav" => "wav",
        "audio/mp4" or "audio/x-m4a" or "video/mp4" => "m4a",
        "audio/aac" or "audio/x-hx-aac-adts" => "aac",
        _ => "webm"
    };
}
