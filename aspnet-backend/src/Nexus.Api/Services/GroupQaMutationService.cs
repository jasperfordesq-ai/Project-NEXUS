// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record GroupQaMutationError(string Code, string Message, int Status);
public sealed record GroupQaMutationResult(object? Data, GroupQaMutationError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed class GroupQaMutationService
{
    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;

    public GroupQaMutationService(NexusDbContext db, SafeguardingInteractionPolicy safeguarding)
    {
        _db = db;
        _safeguarding = safeguarding;
    }

    public async Task<GroupQaMutationResult> CreateQuestionAsync(
        int tenantId, int groupId, int actorId, string title, string body,
        CancellationToken cancellationToken = default)
    {
        title = title.Trim();
        body = body.Trim();
        if (title.Length is < 5 or > 500 || body.Length is < 1 or > 50_000)
            return Invalid("Question title or body is invalid");
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        var access = await GetWriteAccessAsync(tenantId, groupId, actorId, cancellationToken);
        if (access.Error is not null) return new(null, access.Error);
        var policyError = await CheckSafeguardingAsync(tenantId, groupId, actorId, "group_question_create", cancellationToken);
        if (policyError is not null) return new(null, policyError);
        var now = DateTime.UtcNow;
        var question = new GroupQuestion
        {
            TenantId = tenantId,
            GroupId = groupId,
            AuthorUserId = actorId,
            Title = title,
            Body = body,
            CreatedAt = now,
            UpdatedAt = now
        };
        _db.GroupQuestions.Add(question);
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(new { id = question.Id, title = question.Title });
    }

    public async Task<GroupQaMutationResult> CreateAnswerAsync(
        int tenantId, int groupId, int questionId, int actorId, string body,
        CancellationToken cancellationToken = default)
    {
        body = body.Trim();
        if (body.Length is < 1 or > 50_000) return Invalid("Answer body is invalid");
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        var access = await GetWriteAccessAsync(tenantId, groupId, actorId, cancellationToken);
        if (access.Error is not null) return new(null, access.Error);
        var question = await _db.GroupQuestions.IgnoreQueryFilters().SingleOrDefaultAsync(row =>
            row.TenantId == tenantId && row.GroupId == groupId && row.Id == questionId, cancellationToken);
        if (question is null) return Missing("Question not found");
        if (question.IsClosed) return new(null, new("CLOSED", "Question is closed", 409));
        var policyError = await CheckSafeguardingAsync(tenantId, groupId, actorId, "group_answer_create", cancellationToken);
        if (policyError is not null) return new(null, policyError);
        var now = DateTime.UtcNow;
        var answer = new GroupAnswer
        {
            TenantId = tenantId,
            QuestionId = questionId,
            AuthorUserId = actorId,
            Body = body,
            CreatedAt = now,
            UpdatedAt = now
        };
        _db.GroupAnswers.Add(answer);
        question.AnswerCount++;
        question.UpdatedAt = now;
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(new { id = answer.Id, question_id = questionId });
    }

    public async Task<GroupQaMutationResult> UpdateQuestionAsync(
        int tenantId, int groupId, int questionId, int actorId, string title, string body,
        CancellationToken cancellationToken = default)
    {
        title = title.Trim();
        body = body.Trim();
        if (title.Length is < 5 or > 500 || body.Length is < 1 or > 50_000)
            return Invalid("Question title or body is invalid");

        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        var access = await GetWriteAccessAsync(tenantId, groupId, actorId, cancellationToken);
        if (access.Error is not null) return new(null, access.Error);

        var question = await _db.GroupQuestions.IgnoreQueryFilters().SingleOrDefaultAsync(row =>
            row.TenantId == tenantId && row.GroupId == groupId && row.Id == questionId, cancellationToken);
        if (question is null) return Missing("Question not found");
        if (question.AuthorUserId != actorId && !access.CanManage) return Forbidden();

        var policyError = await CheckSafeguardingAsync(tenantId, groupId, actorId, "group_question_update", cancellationToken);
        if (policyError is not null) return new(null, policyError);

        question.Title = title;
        question.Body = body;
        question.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(new { id = question.Id, title = question.Title, body = question.Body });
    }

    public async Task<GroupQaMutationResult> DeleteQuestionAsync(
        int tenantId, int groupId, int questionId, int actorId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        var access = await GetWriteAccessAsync(tenantId, groupId, actorId, cancellationToken);
        if (access.Error is not null) return new(null, access.Error);
        var question = await _db.GroupQuestions.IgnoreQueryFilters().SingleOrDefaultAsync(row =>
            row.TenantId == tenantId && row.GroupId == groupId && row.Id == questionId, cancellationToken);
        if (question is null) return Missing("Question not found");
        if (question.AuthorUserId != actorId && !access.CanManage) return Forbidden();

        var answerIds = await _db.GroupAnswers.IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId && row.QuestionId == questionId)
            .Select(row => row.Id).ToListAsync(cancellationToken);
        await _db.GroupQaVotes.IgnoreQueryFilters().Where(row => row.TenantId == tenantId
            && ((row.TargetType == "question" && row.TargetId == questionId)
                || (row.TargetType == "answer" && answerIds.Contains(row.TargetId))))
            .ExecuteDeleteAsync(cancellationToken);
        await _db.GroupAnswers.IgnoreQueryFilters().Where(row => row.TenantId == tenantId && row.QuestionId == questionId)
            .ExecuteDeleteAsync(cancellationToken);
        _db.GroupQuestions.Remove(question);
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(new { deleted = true });
    }

    public async Task<GroupQaMutationResult> UpdateAnswerAsync(
        int tenantId, int groupId, int answerId, int actorId, string body,
        CancellationToken cancellationToken = default)
    {
        body = body.Trim();
        if (body.Length is < 1 or > 50_000) return Invalid("Answer body is invalid");
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        var access = await GetWriteAccessAsync(tenantId, groupId, actorId, cancellationToken);
        if (access.Error is not null) return new(null, access.Error);
        var identity = await FindAnswerAsync(tenantId, groupId, answerId, cancellationToken);
        if (identity is null) return Missing("Answer not found");
        var (answer, question) = identity.Value;
        if (answer.AuthorUserId != actorId && !access.CanManage) return Forbidden();

        var policyError = await CheckSafeguardingAsync(tenantId, groupId, actorId, "group_answer_update", cancellationToken);
        if (policyError is not null) return new(null, policyError);
        answer.Body = body;
        answer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(new { id = answerId, question_id = question.Id, body });
    }

    public async Task<GroupQaMutationResult> DeleteAnswerAsync(
        int tenantId, int groupId, int answerId, int actorId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        var access = await GetWriteAccessAsync(tenantId, groupId, actorId, cancellationToken);
        if (access.Error is not null) return new(null, access.Error);
        var identity = await FindAnswerAsync(tenantId, groupId, answerId, cancellationToken);
        if (identity is null) return Missing("Answer not found");
        var (answer, question) = identity.Value;
        if (answer.AuthorUserId != actorId && !access.CanManage) return Forbidden();

        await _db.GroupQaVotes.IgnoreQueryFilters().Where(row => row.TenantId == tenantId
            && row.TargetType == "answer" && row.TargetId == answerId).ExecuteDeleteAsync(cancellationToken);
        if (question.AcceptedAnswerId == answerId)
            question.AcceptedAnswerId = null;
        question.AnswerCount = Math.Max(0, question.AnswerCount - 1);
        question.UpdatedAt = DateTime.UtcNow;
        _db.GroupAnswers.Remove(answer);
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(new { deleted = true });
    }

    public async Task<GroupQaMutationResult> AcceptAnswerAsync(
        int tenantId, int groupId, int answerId, int actorId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        var access = await GetWriteAccessAsync(tenantId, groupId, actorId, cancellationToken);
        if (access.Error is not null) return new(null, access.Error);
        var identity = await FindAnswerAsync(tenantId, groupId, answerId, cancellationToken);
        if (identity is null) return Missing("Answer not found");
        var (answer, question) = identity.Value;
        if (question.AuthorUserId != actorId && !access.CanManage) return Forbidden();
        await _db.GroupAnswers.IgnoreQueryFilters().Where(row => row.TenantId == tenantId
            && row.QuestionId == question.Id && row.IsAccepted && row.Id != answerId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.IsAccepted, false), cancellationToken);
        answer.IsAccepted = true;
        question.AcceptedAnswerId = answerId;
        question.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(new { message = "Answer accepted" });
    }

    private async Task<(bool CanManage, GroupQaMutationError? Error)> GetWriteAccessAsync(
        int tenantId, int groupId, int actorId, CancellationToken cancellationToken)
    {
        var groupExists = await _db.Groups.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(row => row.TenantId == tenantId && row.Id == groupId, cancellationToken);
        if (!groupExists) return (false, new("NOT_FOUND", "Group not found", 404));
        var membership = await _db.GroupMembers.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(row =>
            row.TenantId == tenantId && row.GroupId == groupId && row.UserId == actorId, cancellationToken);
        if (membership is null) return (false, new("FORBIDDEN", "Group membership is required", 403));
        return (membership.Role is Group.Roles.Owner or Group.Roles.Admin, null);
    }

    private async Task<(GroupAnswer Answer, GroupQuestion Question)?> FindAnswerAsync(
        int tenantId, int groupId, int answerId, CancellationToken cancellationToken)
    {
        var answer = await _db.GroupAnswers.IgnoreQueryFilters().SingleOrDefaultAsync(row =>
            row.TenantId == tenantId && row.Id == answerId, cancellationToken);
        if (answer is null) return null;
        var question = await _db.GroupQuestions.IgnoreQueryFilters().SingleOrDefaultAsync(row =>
            row.TenantId == tenantId && row.GroupId == groupId && row.Id == answer.QuestionId, cancellationToken);
        return question is null ? null : (answer, question);
    }

    private async Task<GroupQaMutationError?> CheckSafeguardingAsync(
        int tenantId, int groupId, int actorId, string channel, CancellationToken cancellationToken)
    {
        var recipients = await _db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.GroupId == groupId && row.UserId != actorId)
            .Select(row => row.UserId).ToListAsync(cancellationToken);
        var decision = await _safeguarding.EvaluateLockedManyLocalContactsAsync(
            actorId, recipients, tenantId, channel, cancellationToken);
        return decision.IsAllowed ? null : new(
            decision.Code,
            decision.IsUnavailable ? "Safeguarding policy is temporarily unavailable" : "This interaction is restricted by safeguarding policy",
            decision.IsUnavailable ? 503 : 403);
    }

    private static GroupQaMutationResult Missing(string message) => new(null, new("NOT_FOUND", message, 404));
    private static GroupQaMutationResult Forbidden() => new(null, new("FORBIDDEN", "You cannot modify this content", 403));
    private static GroupQaMutationResult Invalid(string message) => new(null, new("VALIDATION", message, 422));
}
