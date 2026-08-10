// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Buffers.Binary;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using GroupEntity = Nexus.Api.Entities.Group;

namespace Nexus.Api.Services;

public sealed record GroupFormError(string Code, string Message, int Status, string? Field = null);
public sealed record GroupFormResult(object? Data, GroupFormError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed partial class GroupFormService
{
    private const string ConfigKey = "admin_explicit.module_config.groups";
    private const long ImageMaxBytes = 8 * 1024 * 1024;
    private readonly NexusDbContext _db;
    private readonly FileUploadService _files;

    public GroupFormService(NexusDbContext db, FileUploadService files)
    {
        _db = db;
        _files = files;
    }

    public async Task<object> GetCapabilitiesAsync(int tenantId, int userId, CancellationToken cancellationToken)
    {
        var config = await LoadConfigAsync(tenantId, cancellationToken);
        var allowPrivate = GetBool(config, "allow_private_groups", true);
        var descriptionMin = Math.Max(0, GetInt(config, "min_description_length", 10));
        var descriptionMax = Math.Max(descriptionMin, GetInt(config, "max_description_length", 5000));
        var types = await _db.GroupTypes.IgnoreQueryFilters().AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.IsActive)
            .OrderBy(row => row.SortOrder).ThenBy(row => row.Name)
            .Select(row => new { row.Id, row.Name, row.Description, row.Icon, row.Color }).ToListAsync(cancellationToken);
        var templates = await _db.GroupTemplates.IgnoreQueryFilters().AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.IsActive)
            .OrderBy(row => row.SortOrder).ThenBy(row => row.Id).ToListAsync(cancellationToken);
        var manageable = await (from groupRow in _db.Groups.IgnoreQueryFilters().AsNoTracking()
                                join member in _db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
                                    on groupRow.Id equals member.GroupId
                                where groupRow.TenantId == tenantId && member.TenantId == tenantId
                                    && member.UserId == userId && groupRow.IsActive
                                    && (member.Role == GroupEntity.Roles.Owner || member.Role == GroupEntity.Roles.Admin)
                                orderby groupRow.Name
                                select new { groupRow.Id, groupRow.Name, groupRow.ParentId }).ToListAsync(cancellationToken);
        return new
        {
            allowed_visibility = allowPrivate ? new[] { "public", "private", "secret" } : new[] { "public" },
            limits = new { name_min = 3, name_max = 255, description_min = descriptionMin, description_max = descriptionMax, location_max = 255, image_max_bytes = ImageMaxBytes },
            templates = templates.Select(row => new
            {
                row.Id, row.Name, row.Description, row.Icon,
                default_visibility = row.DefaultVisibility,
                default_type_id = row.DefaultTypeId,
                default_tags = ReadJson(row.DefaultTagsJson, Array.Empty<int>()),
                features = ReadJson<object>(row.FeaturesJson, new Dictionary<string, bool>()),
                welcome_message = row.WelcomeMessage
            }),
            group_types = types,
            parent_candidates = manageable,
            fields = new { type = types.Count != 0, parent = manageable.Count != 0, location = true, avatar = true, cover = true, branding = true },
            image_operations = new[] { "keep", "replace", "remove" },
            capabilities = new { can_create = GetBool(config, "allow_user_group_creation", true) }
        };
    }

    public async Task<GroupFormResult> UpdateAsync(
        int tenantId, int groupId, int actorId, IFormCollection form, CancellationToken cancellationToken)
    {
        var group = await FindManageableAsync(tenantId, groupId, actorId, cancellationToken);
        if (group.Result is not null) return group.Result;
        var entity = group.Group!;
        var config = await LoadConfigAsync(tenantId, cancellationToken);
        var avatarAction = form["avatar_action"].FirstOrDefault() ?? "keep";
        var coverAction = form["cover_action"].FirstOrDefault() ?? "keep";
        if (!ValidAction(avatarAction) || !ValidAction(coverAction))
            return Invalid("Image action is invalid", "image");

        var name = form["name"].FirstOrDefault()?.Trim();
        var description = form["description"].FirstOrDefault()?.Trim() ?? string.Empty;
        var visibility = form["visibility"].FirstOrDefault() ?? entity.Visibility;
        var minDescription = Math.Max(0, GetInt(config, "min_description_length", 10));
        var maxDescription = Math.Max(minDescription, GetInt(config, "max_description_length", 5000));
        if (name is null || name.Length is < 3 or > 255) return Invalid("Group name is invalid", "name");
        if (description.Length < minDescription || description.Length > maxDescription) return Invalid("Group description is invalid", "description");
        if (visibility is not ("public" or "private" or "secret")
            || visibility != "public" && !GetBool(config, "allow_private_groups", true))
            return Invalid("Group visibility is invalid", "visibility");
        var location = form["location"].FirstOrDefault()?.Trim();
        if (location?.Length > 255) return Invalid("Group location is invalid", "location");
        if (!TryNullableDecimal(form["latitude"].FirstOrDefault(), -90, 90, out var latitude)
            || !TryNullableDecimal(form["longitude"].FirstOrDefault(), -180, 180, out var longitude)
            || (latitude.HasValue != longitude.HasValue))
            return Invalid("Group coordinates are invalid", "location");
        if (!TryNullableInt(form["type_id"].FirstOrDefault(), out var typeId)
            || typeId.HasValue && !await _db.GroupTypes.IgnoreQueryFilters().AnyAsync(row => row.TenantId == tenantId && row.Id == typeId && row.IsActive, cancellationToken))
            return Invalid("Group type is invalid", "type_id");
        if (!TryNullableInt(form["parent_id"].FirstOrDefault(), out var parentId)
            || parentId == groupId
            || parentId.HasValue && !await CanUseParentAsync(tenantId, parentId.Value, actorId, cancellationToken))
            return Invalid("Parent group is invalid", "parent_id");
        var primary = NormalizeColor(form["primary_color"].FirstOrDefault());
        var accent = NormalizeColor(form["accent_color"].FirstOrDefault());
        if (primary.Invalid || accent.Invalid) return Invalid("Brand color is invalid", "primary_color");

        var staged = new List<(FileUpload Upload, string Type)>();
        foreach (var (type, action) in new[] { ("avatar", avatarAction), ("cover", coverAction) })
        {
            if (action != "replace") continue;
            var file = form.Files.GetFile(type);
            if (file is null) return Invalid("No image was uploaded", type);
            if (file.Length is < 1 or > ImageMaxBytes || !await ValidImageAsync(file, cancellationToken))
                return new(null, new("VALIDATION_ERROR", "Group image is invalid", file.Length > ImageMaxBytes ? 413 : 422, type));
            await using var stream = file.OpenReadStream();
            var (upload, error) = await _files.UploadAsync(stream, file.FileName, file.ContentType, file.Length,
                actorId, tenantId, FileCategory.Group, groupId, "group", cancellationToken);
            if (upload is null) return new(null, new("UPLOAD_FAILED", error ?? "Failed to upload image", 500, type));
            staged.Add((upload, type));
        }

        var oldAvatar = entity.ImageUrl;
        var oldCover = entity.CoverImageUrl;
        entity.Name = name;
        entity.Description = description;
        entity.Visibility = visibility;
        entity.IsPrivate = visibility != "public";
        entity.Location = string.IsNullOrWhiteSpace(location) ? null : location;
        entity.Latitude = latitude;
        entity.Longitude = longitude;
        entity.TypeId = typeId;
        entity.ParentId = parentId;
        entity.PrimaryColor = primary.Value;
        entity.AccentColor = accent.Value;
        entity.ImageUrl = ResolveImage(avatarAction, entity.ImageUrl, staged, "avatar");
        entity.CoverImageUrl = ResolveImage(coverAction, entity.CoverImageUrl, staged, "cover");
        entity.UpdatedAt = DateTime.UtcNow;
        try { await _db.SaveChangesAsync(cancellationToken); }
        catch
        {
            foreach (var (upload, _) in staged)
                await _files.DeleteEntityFileAsync(upload.Id, tenantId, "group", groupId, cancellationToken);
            throw;
        }
        await CleanupOldAsync(oldAvatar, entity.ImageUrl, tenantId, groupId, cancellationToken);
        await CleanupOldAsync(oldCover, entity.CoverImageUrl, tenantId, groupId, cancellationToken);
        return new(Map(entity));
    }

    public async Task<GroupFormResult> RemoveImageAsync(
        int tenantId, int groupId, int actorId, string type, CancellationToken cancellationToken)
    {
        if (type is not ("avatar" or "cover")) return Invalid("Group image type is invalid", "type");
        var group = await FindManageableAsync(tenantId, groupId, actorId, cancellationToken);
        if (group.Result is not null) return group.Result;
        var entity = group.Group!;
        var previous = type == "cover" ? entity.CoverImageUrl : entity.ImageUrl;
        if (type == "cover") entity.CoverImageUrl = null; else entity.ImageUrl = null;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        await CleanupOldAsync(previous, null, tenantId, groupId, cancellationToken);
        return new(new { image_url = (string?)null, type });
    }

    private async Task<(Nexus.Api.Entities.Group? Group, GroupFormResult? Result)> FindManageableAsync(int tenantId, int groupId, int actorId, CancellationToken ct)
    {
        var group = await _db.Groups.IgnoreQueryFilters().SingleOrDefaultAsync(row => row.TenantId == tenantId && row.Id == groupId, ct);
        if (group is null) return (null, new(null, new("NOT_FOUND", "Group not found", 404)));
        var canManage = await _db.GroupMembers.IgnoreQueryFilters().AnyAsync(row => row.TenantId == tenantId
            && row.GroupId == groupId && row.UserId == actorId && (row.Role == GroupEntity.Roles.Owner || row.Role == GroupEntity.Roles.Admin), ct);
        return canManage ? (group, null) : (null, new(null, new("FORBIDDEN", "You cannot edit this group", 403)));
    }

    private async Task<bool> CanUseParentAsync(int tenantId, int parentId, int actorId, CancellationToken ct) =>
        await _db.Groups.IgnoreQueryFilters().AnyAsync(row => row.TenantId == tenantId && row.Id == parentId && row.IsActive, ct)
        && await _db.GroupMembers.IgnoreQueryFilters().AnyAsync(row => row.TenantId == tenantId && row.GroupId == parentId
            && row.UserId == actorId && (row.Role == GroupEntity.Roles.Owner || row.Role == GroupEntity.Roles.Admin), ct);

    private async Task<Dictionary<string, JsonElement>> LoadConfigAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.Key == ConfigKey).Select(row => row.Value).SingleOrDefaultAsync(ct);
        if (string.IsNullOrWhiteSpace(raw)) return [];
        try { return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(raw) ?? []; }
        catch (JsonException) { return []; }
    }

    private async Task CleanupOldAsync(string? oldUrl, string? newUrl, int tenantId, int groupId, CancellationToken ct)
    {
        if (oldUrl == newUrl || !TryFileId(oldUrl, out var fileId)) return;
        await _files.DeleteEntityFileAsync(fileId, tenantId, "group", groupId, ct);
    }

    private object Map(Nexus.Api.Entities.Group group) => new
    {
        group.Id, group.Name, group.Description, visibility = group.Visibility,
        image_url = group.ImageUrl, cover_image_url = group.CoverImageUrl,
        location = group.Location, latitude = group.Latitude, longitude = group.Longitude,
        type_id = group.TypeId, parent_id = group.ParentId,
        primary_color = group.PrimaryColor, accent_color = group.AccentColor,
        updated_at = group.UpdatedAt
    };

    private static string? ResolveImage(string action, string? current, List<(FileUpload Upload, string Type)> staged, string type) =>
        action == "remove" ? null : action == "replace" ? staged.Where(row => row.Type == type).Select(row => $"/api/files/{row.Upload.Id}/download").Single() : current;
    private static bool ValidAction(string action) => action is "keep" or "replace" or "remove";
    private static async Task<bool> ValidImageAsync(IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!((file.ContentType == "image/jpeg" && extension is ".jpg" or ".jpeg")
            || (file.ContentType == "image/png" && extension == ".png")
            || (file.ContentType == "image/gif" && extension == ".gif")
            || (file.ContentType == "image/webp" && extension == ".webp")))
            return false;
        var length = (int)Math.Min(file.Length, 64 * 1024);
        var bytes = new byte[length];
        await using var stream = file.OpenReadStream();
        var read = 0;
        while (read < length)
        {
            var count = await stream.ReadAsync(bytes.AsMemory(read, length - read), cancellationToken);
            if (count == 0) break;
            read += count;
        }
        if (!TryImageDimensions(bytes.AsSpan(0, read), file.ContentType, out var width, out var height))
            return false;
        return width > 0 && height > 0 && (long)width * height <= 25_000_000;
    }

    private static bool TryImageDimensions(ReadOnlySpan<byte> bytes, string contentType, out int width, out int height)
    {
        width = height = 0;
        if (contentType == "image/png" && bytes.Length >= 24
            && bytes[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
        {
            width = BinaryPrimitives.ReadInt32BigEndian(bytes.Slice(16, 4));
            height = BinaryPrimitives.ReadInt32BigEndian(bytes.Slice(20, 4));
            return true;
        }
        if (contentType == "image/gif" && bytes.Length >= 10
            && (bytes[..6].SequenceEqual("GIF87a"u8) || bytes[..6].SequenceEqual("GIF89a"u8)))
        {
            width = BinaryPrimitives.ReadUInt16LittleEndian(bytes.Slice(6, 2));
            height = BinaryPrimitives.ReadUInt16LittleEndian(bytes.Slice(8, 2));
            return true;
        }
        if (contentType == "image/webp" && bytes.Length >= 30
            && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8)
            && bytes.Slice(12, 4).SequenceEqual("VP8X"u8))
        {
            width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
            height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
            return true;
        }
        if (contentType != "image/jpeg" || bytes.Length < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8)
            return false;
        var offset = 2;
        while (offset + 8 < bytes.Length)
        {
            if (bytes[offset++] != 0xFF) continue;
            var marker = bytes[offset++];
            if (marker is 0xD8 or 0xD9) continue;
            if (offset + 2 > bytes.Length) break;
            var segmentLength = BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset, 2));
            if (segmentLength < 2 || offset + segmentLength > bytes.Length) break;
            if (marker is >= 0xC0 and <= 0xC3 or >= 0xC5 and <= 0xC7 or >= 0xC9 and <= 0xCB or >= 0xCD and <= 0xCF)
            {
                if (segmentLength < 7) return false;
                height = BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset + 3, 2));
                width = BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset + 5, 2));
                return true;
            }
            offset += segmentLength;
        }
        return false;
    }
    private static bool TryFileId(string? url, out int id) => int.TryParse(url?.Split('/', StringSplitOptions.RemoveEmptyEntries) is ["api", "files", var raw, "download"] ? raw : null, out id);
    private static bool TryNullableInt(string? raw, out int? value) { value = null; if (string.IsNullOrWhiteSpace(raw)) return true; if (!int.TryParse(raw, out var parsed) || parsed <= 0) return false; value = parsed; return true; }
    private static bool TryNullableDecimal(string? raw, decimal min, decimal max, out decimal? value) { value = null; if (string.IsNullOrWhiteSpace(raw)) return true; if (!decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) || parsed < min || parsed > max) return false; value = parsed; return true; }
    private static (string? Value, bool Invalid) NormalizeColor(string? raw) { if (string.IsNullOrWhiteSpace(raw)) return (null, false); var value = raw.Trim().ToUpperInvariant(); return HexColor().IsMatch(value) ? (value, false) : (null, true); }
    private static int GetInt(Dictionary<string, JsonElement> config, string key, int fallback) => config.TryGetValue(key, out var value) && value.TryGetInt32(out var result) ? result : fallback;
    private static bool GetBool(Dictionary<string, JsonElement> config, string key, bool fallback) => config.TryGetValue(key, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : fallback;
    private static T ReadJson<T>(string raw, T fallback) { try { return JsonSerializer.Deserialize<T>(raw) ?? fallback; } catch (JsonException) { return fallback; } }
    private static GroupFormResult Invalid(string message, string field) => new(null, new("VALIDATION_ERROR", message, 422, field));
    [GeneratedRegex("^#[0-9A-F]{6}$", RegexOptions.CultureInvariant)] private static partial Regex HexColor();
}
