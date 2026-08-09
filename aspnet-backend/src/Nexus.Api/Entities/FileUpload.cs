// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a file uploaded by a user.
/// Files are stored on disk under /uploads/{tenant_id}/{category}/{filename}.
/// </summary>
public class FileUpload : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Original filename as uploaded by the user.
    /// </summary>
    public string OriginalFilename { get; set; } = string.Empty;

    /// <summary>
    /// Stored filename (UUID-based to prevent collisions).
    /// </summary>
    public string StoredFilename { get; set; } = string.Empty;

    /// <summary>
    /// Relative path from the uploads root.
    /// </summary>
    public string FilePath { get; set; } = string.Empty;

    /// <summary>
    /// MIME content type.
    /// </summary>
    public string ContentType { get; set; } = string.Empty;

    /// <summary>
    /// File size in bytes.
    /// </summary>
    public long FileSizeBytes { get; set; }

    /// <summary>
    /// Category for organizing files: avatar, listing, group, event, document.
    /// </summary>
    public FileCategory Category { get; set; }

    /// <summary>
    /// Optional reference to the entity this file belongs to (listing ID, group ID, etc.).
    /// </summary>
    public int? EntityId { get; set; }

    /// <summary>
    /// Entity type for the reference (e.g., "listing", "group", "event", "user").
    /// </summary>
    public string? EntityType { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

public enum FileCategory
{
    Avatar,
    Listing,
    Group,
    Event,
    Document,
    Message,
    TenantLogo,
    Podcast
}
