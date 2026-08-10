// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A community poll/survey for gathering member opinions.
/// Supports single-choice, multiple-choice, and ranked voting.
/// </summary>
public class Poll : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int CreatedById { get; set; }

    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    /// <summary>
    /// Poll type: "single" (one choice), "multiple" (many choices), "ranked" (ranked voting).
    /// </summary>
    [MaxLength(20)]
    public string PollType { get; set; } = "single";

    /// <summary>Whether voting is anonymous (don't show who voted for what).</summary>
    public bool IsAnonymous { get; set; } = false;

    /// <summary>Whether results are visible before the poll closes.</summary>
    public bool ShowResultsBeforeClose { get; set; } = true;

    /// <summary>Maximum number of choices allowed (for multiple-choice).</summary>
    public int? MaxChoices { get; set; }

    /// <summary>Optional group scope — if set, only group members can vote.</summary>
    public int? GroupId { get; set; }

    public string Status { get; set; } = "active"; // draft, active, closed
    public DateTime? ClosesAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
    public Group? Group { get; set; }
    public ICollection<PollOption> Options { get; set; } = new List<PollOption>();
    public ICollection<PollVote> Votes { get; set; } = new List<PollVote>();
}

/// <summary>
/// An option/choice in a poll.
/// </summary>
public class PollOption : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PollId { get; set; }

    [MaxLength(255)]
    public string Text { get; set; } = string.Empty;

    /// <summary>Display order (lower = first).</summary>
    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public Poll? Poll { get; set; }
    public ICollection<PollVote> Votes { get; set; } = new List<PollVote>();
}

/// <summary>
/// A user's vote on a poll option.
/// For ranked voting, Rank indicates the preference order (1 = first choice).
/// </summary>
public class PollVote : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PollId { get; set; }
    public int OptionId { get; set; }
    public int UserId { get; set; }

    /// <summary>For ranked voting: 1 = first choice, 2 = second, etc. Null for non-ranked.</summary>
    public int? Rank { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public Poll? Poll { get; set; }
    public PollOption? Option { get; set; }
    public User? User { get; set; }
}
