// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public class IdeationService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamification;
    private readonly ILogger<IdeationService> _logger;

    public IdeationService(NexusDbContext db, TenantContext tenantContext, GamificationService gamification, ILogger<IdeationService> logger)
    { _db = db; _tenantContext = tenantContext; _gamification = gamification; _logger = logger; }

    public async Task<(Idea? Idea, string? Error)> CreateIdeaAsync(int userId, string title, string content, string? category)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var idea = new Idea { TenantId = tenantId, AuthorId = userId, Title = title.Trim(), Content = content.Trim(), Category = category?.Trim() };
        _db.Set<Idea>().Add(idea);
        await _db.SaveChangesAsync();
        return (idea, null);
    }

    public async Task<(List<Idea> Data, int Total)> ListIdeasAsync(int page, int limit, string? status = null, string? sort = "newest")
    {
        var query = _db.Set<Idea>().AsNoTracking();
        if (!string.IsNullOrEmpty(status)) query = query.Where(i => i.Status == status);
        var total = await query.CountAsync();
        query = sort switch { "popular" => query.OrderByDescending(i => i.UpvoteCount), "discussed" => query.OrderByDescending(i => i.CommentCount), _ => query.OrderByDescending(i => i.CreatedAt) };
        var data = await query.Include(i => i.Author).Skip((page - 1) * limit).Take(limit).ToListAsync();
        return (data, total);
    }

    public async Task<Idea?> GetIdeaAsync(int ideaId) => await _db.Set<Idea>().Include(i => i.Author).Include(i => i.Comments.OrderByDescending(c => c.CreatedAt)).ThenInclude(c => c.User).Include(i => i.Votes).FirstOrDefaultAsync(i => i.Id == ideaId);

    public async Task<(bool Success, string? Error)> VoteIdeaAsync(int ideaId, int userId)
    {
        try
        {
            var idea = await _db.Set<Idea>().FirstOrDefaultAsync(i => i.Id == ideaId);
            if (idea == null) return (false, "Idea not found");
            _db.Set<IdeaVote>().Add(new IdeaVote { TenantId = _tenantContext.GetTenantIdOrThrow(), IdeaId = ideaId, UserId = userId });
            idea.UpvoteCount++;
            await _db.SaveChangesAsync();
            return (true, null);
        }
        catch (DbUpdateException)
        {
            return (false, "Already upvoted");
        }
    }

    public async Task<(bool Success, string? Error)> UnvoteIdeaAsync(int ideaId, int userId)
    {
        var vote = await _db.Set<IdeaVote>().FirstOrDefaultAsync(v => v.IdeaId == ideaId && v.UserId == userId);
        if (vote == null) return (false, "Not upvoted");
        var idea = await _db.Set<Idea>().FirstOrDefaultAsync(i => i.Id == ideaId);
        if (idea != null && idea.UpvoteCount > 0) idea.UpvoteCount--;
        _db.Set<IdeaVote>().Remove(vote);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(IdeaComment? Comment, string? Error)> CommentOnIdeaAsync(int ideaId, int userId, string content)
    {
        var idea = await _db.Set<Idea>().FirstOrDefaultAsync(i => i.Id == ideaId);
        if (idea == null) return (null, "Idea not found");
        var comment = new IdeaComment { TenantId = _tenantContext.GetTenantIdOrThrow(), IdeaId = ideaId, UserId = userId, Content = content.Trim() };
        _db.Set<IdeaComment>().Add(comment);
        idea.CommentCount++;
        await _db.SaveChangesAsync();
        return (comment, null);
    }

    public async Task<(List<Challenge> Data, int Total)> ListChallengesAsync(int page, int limit, bool? activeOnly = null)
    {
        var query = _db.Set<Challenge>().AsNoTracking();
        if (activeOnly == true) query = query.Where(c => c.IsActive);
        var total = await query.CountAsync();
        var data = await query.Include(c => c.Participants).OrderByDescending(c => c.CreatedAt).Skip((page - 1) * limit).Take(limit).ToListAsync();
        return (data, total);
    }

    public async Task<(bool Success, string? Error)> JoinChallengeAsync(int challengeId, int userId)
    {
        var challenge = await _db.Set<Challenge>().FirstOrDefaultAsync(c => c.Id == challengeId);
        if (challenge == null) return (false, "Challenge not found");
        if (!challenge.IsActive) return (false, "Challenge is not active");
        if (challenge.MaxParticipants.HasValue)
        {
            var count = await _db.Set<ChallengeParticipant>().CountAsync(p => p.ChallengeId == challengeId);
            if (count >= challenge.MaxParticipants.Value) return (false, "Challenge is full");
        }
        if (await _db.Set<ChallengeParticipant>().AnyAsync(p => p.ChallengeId == challengeId && p.UserId == userId)) return (false, "Already participating");
        _db.Set<ChallengeParticipant>().Add(new ChallengeParticipant { TenantId = _tenantContext.GetTenantIdOrThrow(), ChallengeId = challengeId, UserId = userId });
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(bool Success, string? Error)> UpdateChallengeProgressAsync(int challengeId, int userId, int progress)
    {
        var participant = await _db.Set<ChallengeParticipant>().Include(p => p.Challenge).FirstOrDefaultAsync(p => p.ChallengeId == challengeId && p.UserId == userId);
        if (participant == null) return (false, "Not participating");
        if (participant.IsCompleted) return (false, "Already completed");
        participant.CurrentProgress = progress;
        if (participant.Challenge != null && progress >= participant.Challenge.TargetCount)
        {
            participant.IsCompleted = true;
            participant.CompletedAt = DateTime.UtcNow;
            try { await _gamification.AwardXpAsync(userId, participant.Challenge.XpReward, "challenge_completed", challengeId, $"Completed: {participant.Challenge.Title}"); }
            catch (Exception ex) when (ex is InvalidOperationException or Microsoft.EntityFrameworkCore.DbUpdateException) { _logger.LogWarning(ex, "Failed to award XP for challenge {ChallengeId}", challengeId); }
        }
        await _db.SaveChangesAsync();
        return (true, null);
    }

    // ---- NEW METHODS (Task 2 additions) ----

    public async Task<(bool IsFavorited, string? Error)> ToggleFavoriteIdeaAsync(int ideaId, int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var idea = await _db.Set<Idea>().FirstOrDefaultAsync(i => i.Id == ideaId);
        if (idea == null) return (false, "Idea not found");

        var existing = await _db.Set<IdeaFavorite>().FirstOrDefaultAsync(f => f.IdeaId == ideaId && f.UserId == userId);
        if (existing != null)
        {
            _db.Set<IdeaFavorite>().Remove(existing);
            await _db.SaveChangesAsync();
            return (false, null);
        }

        _db.Set<IdeaFavorite>().Add(new IdeaFavorite { TenantId = tenantId, IdeaId = ideaId, UserId = userId });
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(bool IsFavorited, string? Error)> AddFavoriteIdeaAsync(int ideaId, int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var idea = await _db.Set<Idea>().FirstOrDefaultAsync(i => i.Id == ideaId);
        if (idea == null) return (false, "Idea not found");

        var existing = await _db.Set<IdeaFavorite>().FirstOrDefaultAsync(f => f.IdeaId == ideaId && f.UserId == userId);
        if (existing != null) return (true, "Already favorited");

        _db.Set<IdeaFavorite>().Add(new IdeaFavorite { TenantId = tenantId, IdeaId = ideaId, UserId = userId });
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(bool Removed, string? Error)> RemoveFavoriteIdeaAsync(int ideaId, int userId)
    {
        var idea = await _db.Set<Idea>().FirstOrDefaultAsync(i => i.Id == ideaId);
        if (idea == null) return (false, "Idea not found");

        var existing = await _db.Set<IdeaFavorite>().FirstOrDefaultAsync(f => f.IdeaId == ideaId && f.UserId == userId);
        if (existing == null) return (false, "Not favorited");

        _db.Set<IdeaFavorite>().Remove(existing);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(Idea? Copy, string? Error)> DuplicateIdeaAsync(int ideaId, int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var original = await _db.Set<Idea>().FirstOrDefaultAsync(i => i.Id == ideaId);
        if (original == null) return (null, "Idea not found");

        var copy = new Idea
        {
            TenantId = tenantId,
            AuthorId = userId,
            Title = string.Concat("Copy of ", original.Title),
            Content = original.Content,
            Category = original.Category,
            Status = "submitted"
        };

        _db.Set<Idea>().Add(copy);
        await _db.SaveChangesAsync();
        return (copy, null);
    }

    public async Task<(Group? NewGroup, string? Error)> ConvertToGroupAsync(int ideaId, int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var idea = await _db.Set<Idea>().FirstOrDefaultAsync(i => i.Id == ideaId);
        if (idea == null) return (null, "Idea not found");
        if (idea.AuthorId != userId) return (null, "Only the idea author can convert to a group");
        if (idea.Status == "converted") return (null, "Idea has already been converted to a group");

        var group = new Group
        {
            TenantId = tenantId,
            CreatedById = userId,
            Name = idea.Title,
            Description = idea.Content,
            IsPrivate = false
        };

        _db.Groups.Add(group);

        idea.Status = "converted";
        idea.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        // Add creator as owner member
        _db.Set<GroupMember>().Add(new GroupMember
        {
            TenantId = tenantId,
            GroupId = group.Id,
            UserId = userId,
            Role = Group.Roles.Owner
        });
        await _db.SaveChangesAsync();

        _logger.LogInformation("Converted idea {IdeaId} to group {GroupId} by user {UserId}", ideaId, group.Id, userId);
        return (group, null);
    }


}
