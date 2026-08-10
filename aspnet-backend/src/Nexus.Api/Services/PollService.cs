// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing polls, options, and votes.
/// Supports single-choice, multiple-choice, and ranked voting.
/// </summary>
public class PollService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamification;
    private readonly ILogger<PollService> _logger;

    public PollService(NexusDbContext db, TenantContext tenantContext, GamificationService gamification, ILogger<PollService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _gamification = gamification;
        _logger = logger;
    }

    public async Task<(Poll? Poll, string? Error)> CreatePollAsync(
        int userId, string title, string? description, string pollType,
        List<string> options, bool isAnonymous, bool showResults,
        int? maxChoices, int? groupId, DateTime? closesAt)
    {
        if (options.Count < 2)
            return (null, "A poll must have at least 2 options");
        if (options.Count > 20)
            return (null, "A poll cannot have more than 20 options");

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var poll = new Poll
        {
            TenantId = tenantId,
            CreatedById = userId,
            Title = title.Trim(),
            Description = description?.Trim(),
            PollType = pollType,
            IsAnonymous = isAnonymous,
            ShowResultsBeforeClose = showResults,
            MaxChoices = maxChoices,
            GroupId = groupId,
            ClosesAt = closesAt,
            Status = "active"
        };

        _db.Set<Poll>().Add(poll);
        await _db.SaveChangesAsync();

        for (int i = 0; i < options.Count; i++)
        {
            _db.Set<PollOption>().Add(new PollOption
            {
                TenantId = tenantId,
                PollId = poll.Id,
                Text = options[i].Trim(),
                SortOrder = i
            });
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Poll {PollId} created by user {UserId}: {Title}", poll.Id, userId, title);
        return (poll, null);
    }

    /// <summary>
    /// Closes all polls whose ClosesAt has passed. Should be called from a background job,
    /// not from read endpoints. TODO: wire into a hosted IHostedService/Hangfire job.
    /// </summary>
    public async Task CloseExpiredPollsAsync()
    {
        var now = DateTime.UtcNow;
        var expired = await _db.Set<Poll>()
            .Where(p => p.Status == "active" && p.ClosesAt != null && p.ClosesAt <= now)
            .ToListAsync();
        foreach (var p in expired) p.Status = "closed";
        if (expired.Count > 0) await _db.SaveChangesAsync();
    }

    public async Task<(List<Poll> Data, int Total)> ListPollsAsync(int page, int limit, string? status = null)
    {
        var query = _db.Set<Poll>().AsNoTracking();

        if (!string.IsNullOrEmpty(status))
            query = query.Where(p => p.Status == status);

        var total = await query.CountAsync();
        var data = await query
            .Include(p => p.CreatedBy)
            .Include(p => p.Options)
            .OrderByDescending(p => p.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (data, total);
    }

    public async Task<Poll?> GetPollAsync(int pollId)
    {
        return await _db.Set<Poll>()
            .Include(p => p.CreatedBy)
            .Include(p => p.Options.OrderBy(o => o.SortOrder))
            .Include(p => p.Votes)
            .FirstOrDefaultAsync(p => p.Id == pollId);
    }

    public async Task<(bool Success, string? Error)> VoteAsync(int pollId, int userId, List<int> optionIds, List<int>? ranks = null)
    {
        var poll = await _db.Set<Poll>()
            .Include(p => p.Options)
            .FirstOrDefaultAsync(p => p.Id == pollId);

        if (poll == null)
            return (false, "Poll not found");

        if (poll.Status != "active")
            return (false, "Poll is not active");

        if (poll.ClosesAt.HasValue && poll.ClosesAt <= DateTime.UtcNow)
        {
            poll.Status = "closed";
            await _db.SaveChangesAsync();
            return (false, "Poll has closed");
        }

        // Validate options belong to this poll
        var validOptionIds = poll.Options.Select(o => o.Id).ToHashSet();
        if (optionIds.Any(id => !validOptionIds.Contains(id)))
            return (false, "Invalid option selected");

        // Validate vote count
        if (poll.PollType == "single" && optionIds.Count != 1)
            return (false, "Single-choice poll requires exactly one selection");

        if (poll.PollType == "multiple" && poll.MaxChoices.HasValue && optionIds.Count > poll.MaxChoices.Value)
            return (false, $"Maximum {poll.MaxChoices} choices allowed");

        if (poll.PollType == "ranked" && optionIds.Count != poll.Options.Count)
            return (false, "Ranked voting requires ranking all options");

        // Validate ranked ranks: must be 1..N without duplicates
        if (poll.PollType == "ranked")
        {
            var n = poll.Options.Count;
            if (ranks == null || ranks.Count != n)
                return (false, $"Ranked voting requires exactly {n} rank values");
            var sortedRanks = ranks.OrderBy(r => r).ToList();
            for (int r = 0; r < n; r++)
            {
                if (sortedRanks[r] != r + 1)
                    return (false, $"Ranks must be 1 through {n} without duplicates");
            }
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Wrap the double-vote check + insert in a serializable transaction to prevent race conditions
        await using var dbTransaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        try
        {
            // Re-check inside the transaction under serializable isolation
            var existingVotes = await _db.Set<PollVote>()
                .AnyAsync(v => v.PollId == pollId && v.UserId == userId);
            if (existingVotes)
            {
                await dbTransaction.RollbackAsync();
                return (false, "You have already voted on this poll");
            }

            for (int i = 0; i < optionIds.Count; i++)
            {
                _db.Set<PollVote>().Add(new PollVote
                {
                    TenantId = tenantId,
                    PollId = pollId,
                    OptionId = optionIds[i],
                    UserId = userId,
                    Rank = poll.PollType == "ranked" ? ranks![i] : null
                });
            }

            await _db.SaveChangesAsync();
            await dbTransaction.CommitAsync();
        }
        catch (DbUpdateException ex)
        {
            await dbTransaction.RollbackAsync();
            _logger.LogWarning(ex, "Duplicate vote attempt or DB error for user {UserId} on poll {PollId}", userId, pollId);
            return (false, "Your vote could not be recorded. Please try again.");
        }

        // Award XP for voting
        try
        {
            await _gamification.AwardXpAsync(userId, XpLog.Amounts.PollVoted, XpLog.Sources.PollVoted, pollId, "Voted in a poll");
        }
        catch (Exception ex) when (ex is InvalidOperationException or Microsoft.EntityFrameworkCore.DbUpdateException) { _logger.LogWarning(ex, "Failed to award XP for poll vote {PollId}", pollId); }

        _logger.LogInformation("User {UserId} voted on poll {PollId}", userId, pollId);
        return (true, null);
    }

    public async Task<(bool Success, string? Error)> ClosePollAsync(int pollId, int userId)
    {
        var poll = await _db.Set<Poll>().FirstOrDefaultAsync(p => p.Id == pollId);
        if (poll == null)
            return (false, "Poll not found");

        if (poll.CreatedById != userId)
            return (false, "Only the poll creator can close it");

        if (poll.Status == "closed")
            return (false, "Poll is already closed");

        poll.Status = "closed";
        poll.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return (true, null);
    }

    public async Task<(object Results, bool NotFound, bool Forbidden)> GetPollResultsAsync(int pollId, int? requestingUserId)
    {
        var poll = await _db.Set<Poll>()
            .Include(p => p.Options.OrderBy(o => o.SortOrder))
            .Include(p => p.Votes)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == pollId);

        if (poll == null) return (new { error = "Poll not found" }, true, false);

        // If results are hidden before close, only show if poll is closed or user has voted
        if (!poll.ShowResultsBeforeClose && poll.Status != "closed")
        {
            var hasVoted = requestingUserId.HasValue && poll.Votes.Any(v => v.UserId == requestingUserId.Value);
            if (!hasVoted)
                return (new { error = "Results are not available until the poll closes" }, false, true);
        }

        var totalVoters = poll.Votes.Select(v => v.UserId).Distinct().Count();

        var results = poll.Options.Select(o => new
        {
            option_id = o.Id,
            text = o.Text,
            vote_count = poll.Votes.Count(v => v.OptionId == o.Id),
            percentage = totalVoters > 0
                ? Math.Round((double)poll.Votes.Count(v => v.OptionId == o.Id) / totalVoters * 100, 1)
                : 0.0,
            average_rank = poll.PollType == "ranked" && poll.Votes.Any(v => v.OptionId == o.Id && v.Rank.HasValue)
                ? Math.Round(poll.Votes.Where(v => v.OptionId == o.Id && v.Rank.HasValue).Average(v => v.Rank!.Value), 2)
                : (double?)null
        }).ToList();

        return (new
        {
            poll_id = poll.Id,
            title = poll.Title,
            poll_type = poll.PollType,
            status = poll.Status,
            total_voters = totalVoters,
            results
        }, false, false);
    }
}
