// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class JobSavedProfile : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string? Headline { get; set; }
    public string? Summary { get; set; }
    public string? Skills { get; set; }
    public string? ResumeUrl { get; set; }
    public bool VisibleToEmployers { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class JobTemplate : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int CreatedByUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Category { get; set; } = string.Empty;
    public string JobType { get; set; } = "volunteer";
    public string? RequiredSkills { get; set; }
    public bool IsPublic { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class JobVacancyTeamMember : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int JobId { get; set; }
    public int UserId { get; set; }
    public string Role { get; set; } = "viewer";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class JobInterview : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int JobId { get; set; }
    public int ApplicationId { get; set; }
    public int CandidateUserId { get; set; }
    public int CreatedByUserId { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public string Location { get; set; } = "online";
    public string Status { get; set; } = "proposed";
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class JobInterviewSlot : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int JobId { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public int? BookedByUserId { get; set; }
    public int? ApplicationId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class JobOffer : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int JobId { get; set; }
    public int ApplicationId { get; set; }
    public int CandidateUserId { get; set; }
    public int CreatedByUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Message { get; set; }
    public decimal? TimeCreditsPerHour { get; set; }
    public string Status { get; set; } = "sent";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class JobOfferTemplate : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int CreatedByUserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class JobScorecard : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ApplicationId { get; set; }
    public int ReviewerUserId { get; set; }
    public int Score { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class JobPipelineRule : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int JobId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Trigger { get; set; } = "application_created";
    public string Action { get; set; } = "notify";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class JobReferral : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int JobId { get; set; }
    public int ReferrerUserId { get; set; }
    public string Code { get; set; } = string.Empty;
    public int Clicks { get; set; }
    public int Applications { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class EmployerReview : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int EmployerUserId { get; set; }
    public int ReviewerUserId { get; set; }
    public int Rating { get; set; }
    public string? Comment { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
