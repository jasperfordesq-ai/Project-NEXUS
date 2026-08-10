// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventInvitationRecipientDecision(bool IsAllowed, bool IsUnavailable, int? ResolvedUserId = null)
{
    public static EventInvitationRecipientDecision Allowed(int? resolvedUserId = null) => new(true, false, resolvedUserId);
    public static EventInvitationRecipientDecision Denied(int? resolvedUserId = null) => new(false, false, resolvedUserId);
    public static EventInvitationRecipientDecision Unavailable(int? resolvedUserId = null) => new(false, true, resolvedUserId);
}

/// <summary>
/// Laravel-compatible, fail-closed invitation recipient boundary. Invitations
/// never grant event visibility and email-shaped member targets cannot bypass
/// member block, safeguarding, or linked-group policy.
/// </summary>
public sealed class EventInvitationRecipientAuthorizer(NexusDbContext db, SafeguardingInteractionPolicy safeguarding)
{
    public async Task<EventInvitationRecipientDecision> EvaluateAsync(
        int tenantId,
        Event evt,
        int actorId,
        int? memberId,
        string? externalEmail,
        CancellationToken ct)
    {
        if (tenantId <= 0 || evt.TenantId != tenantId || actorId <= 0)
            return EventInvitationRecipientDecision.Denied();

        var contactActors = new List<int> { actorId };
        var activeActorIds = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsActive && (x.Id == actorId || x.Id == evt.CreatedById))
            .Select(x => x.Id)
            .ToListAsync(ct);
        if (!activeActorIds.Contains(actorId) || evt.CreatedById <= 0 || !activeActorIds.Contains(evt.CreatedById))
            return EventInvitationRecipientDecision.Denied();
        if (evt.CreatedById != actorId) contactActors.Add(evt.CreatedById);

        User? target = null;
        if (memberId is int targetId && targetId > 0)
        {
            target = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == targetId, ct);
        }
        else if (!string.IsNullOrWhiteSpace(externalEmail))
        {
            var normalized = externalEmail.Trim().ToLowerInvariant();
            target = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Email.ToLower() == normalized, ct);
            if (target is null)
                return await ExternalDecisionAsync(tenantId, evt, ct);
        }
        else return EventInvitationRecipientDecision.Denied();

        if (target is null)
            return EventInvitationRecipientDecision.Denied();

        if (!target.IsActive || !await CanViewEventAsync(tenantId, target, evt, ct))
            return EventInvitationRecipientDecision.Denied(target.Id);

        var blocked = await db.UserBlocks.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(x => x.TenantId == tenantId
                && (contactActors.Contains(x.UserId) && x.UserId != target.Id && x.BlockedUserId == target.Id
                    || x.UserId == target.Id && contactActors.Contains(x.BlockedUserId) && x.BlockedUserId != target.Id), ct);
        if (blocked) return EventInvitationRecipientDecision.Denied(target.Id);

        foreach (var contactActorId in contactActors.Distinct())
        {
            if (contactActorId == target.Id) continue;
            var decision = await safeguarding.EvaluateLocalContactAsync(contactActorId, target.Id, tenantId, "event_invitation", ct);
            if (decision.IsUnavailable) return EventInvitationRecipientDecision.Unavailable(target.Id);
            if (decision.IsDenied) return EventInvitationRecipientDecision.Denied(target.Id);
        }

        return EventInvitationRecipientDecision.Allowed(target.Id);
    }

    private async Task<EventInvitationRecipientDecision> ExternalDecisionAsync(int tenantId, Event evt, CancellationToken ct)
    {
        if (evt.PublicationStatus != "published") return EventInvitationRecipientDecision.Denied();
        if (evt.GroupId is not int groupId) return EventInvitationRecipientDecision.Allowed();
        var isPublic = await db.Groups.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(x => x.TenantId == tenantId && x.Id == groupId && x.IsActive && x.Status == "active" && !x.IsPrivate && x.Visibility == "public", ct);
        return isPublic ? EventInvitationRecipientDecision.Allowed() : EventInvitationRecipientDecision.Denied();
    }

    private async Task<bool> CanViewEventAsync(int tenantId, User user, Event evt, CancellationToken ct)
    {
        Group? group = null;
        if (evt.GroupId is int groupId)
        {
            group = await db.Groups.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId && x.IsActive && x.Status == "active", ct);
            if (group is null) return false;
        }

        var isAdmin = user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod
            || user.Role is "admin" or "super_admin" or "tenant_admin";
        var hasGroupAccess = group is null || isAdmin || group.CreatedById == user.Id
            || await db.GroupMembers.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
                x.TenantId == tenantId && x.GroupId == group.Id && x.UserId == user.Id && x.Status == "active", ct);
        var hasStaffView = await db.EventStaffAssignments.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
            x.TenantId == tenantId && x.EventId == evt.Id && x.UserId == user.Id && x.Status == "active"
            && x.RevokedAt == null && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow), ct);
        if (hasGroupAccess && (isAdmin || evt.CreatedById == user.Id || hasStaffView)) return true;
        if (evt.PublicationStatus != "published") return false;
        return group is null || group.Visibility == "public" && !group.IsPrivate || hasGroupAccess;
    }
}
