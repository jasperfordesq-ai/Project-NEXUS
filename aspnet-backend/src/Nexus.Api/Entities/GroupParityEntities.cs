// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class GroupInvite : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int InvitedByUserId { get; set; }
    public string Token { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string InviteType { get; set; } = "link";
    public string Status { get; set; } = "pending";
    public int? AcceptedByUserId { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupDataExport : ITenantEntity
{
    public Guid Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int RequestedByUserId { get; set; }
    public string Status { get; set; } = "queued";
    public string? StoragePath { get; set; }
    public long? ByteSize { get; set; }
    public string? ErrorCode { get; set; }
    public short Attempts { get; set; }
    public DateTime? ProcessingStartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupMediaItem : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int UploadedByUserId { get; set; }
    public string Url { get; set; } = string.Empty;
    public string MediaType { get; set; } = "image";
    public string? Caption { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupWikiPage : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int AuthorUserId { get; set; }
    public string Slug { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public int Revision { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class GroupWikiRevision : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PageId { get; set; }
    public int AuthorUserId { get; set; }
    public int Revision { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupQuestion : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int AuthorUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public int? AcceptedAnswerId { get; set; }
    public bool IsClosed { get; set; }
    public int ViewCount { get; set; }
    public int VoteCount { get; set; }
    public int AnswerCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupAnswer : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int QuestionId { get; set; }
    public int AuthorUserId { get; set; }
    public string Body { get; set; } = string.Empty;
    public bool IsAccepted { get; set; }
    public int VoteCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupQaVote : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string TargetType { get; set; } = "question";
    public int TargetId { get; set; }
    public int Value { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupChallenge : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int CreatedByUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupScheduledPost : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int AuthorUserId { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTime ScheduledFor { get; set; }
    public string Status { get; set; } = "scheduled";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupWebhook : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int CreatedByUserId { get; set; }
    public string Url { get; set; } = string.Empty;
    public string Events { get; set; } = "[]";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupNotificationPreference : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int UserId { get; set; }
    public bool EmailNotifications { get; set; } = true;
    public bool PushNotifications { get; set; } = true;
    public string DigestFrequency { get; set; } = "daily";
    public DateTime? UpdatedAt { get; set; }
}

public class GroupCustomField : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string FieldType { get; set; } = "text";
    public bool IsRequired { get; set; }
}

public class GroupWelcomeSettings : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public string? Message { get; set; }
    public bool SendOnJoin { get; set; } = true;
    public DateTime? UpdatedAt { get; set; }
}

public class GroupChatroomPin : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int ChatroomId { get; set; }
    public int MessageId { get; set; }
    public int PinnedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class GroupRecommendationEvent : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int? GroupId { get; set; }
    public string EventType { get; set; } = "view";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
