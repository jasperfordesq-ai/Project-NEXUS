// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class ThreadedComment : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string TargetType { get; set; } = string.Empty;
    public int TargetId { get; set; }
    public int? ParentId { get; set; }
    public int AuthorId { get; set; }
    public string Content { get; set; } = string.Empty;
    public bool IsEdited { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Author { get; set; }
    public ThreadedComment? Parent { get; set; }
    public List<ThreadedComment> Replies { get; set; } = new();
}
