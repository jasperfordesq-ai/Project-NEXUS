// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class Resource : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Url { get; set; }
    public string ResourceType { get; set; } = "link";
    public int? CategoryId { get; set; }
    public int CreatedById { get; set; }
    public int SortOrder { get; set; }
    public bool IsPublished { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
    public ResourceCategory? Category { get; set; }
}

public class ResourceCategory : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int? ParentId { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public ResourceCategory? Parent { get; set; }
    public List<ResourceCategory> Children { get; set; } = new();
    public List<Resource> Resources { get; set; } = new();
}
