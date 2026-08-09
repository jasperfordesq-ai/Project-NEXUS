// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record GroupInviteError(string Code, string Message, int Status);
public sealed record GroupInviteResult(object? Data, GroupInviteError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed class GroupInviteLifecycleService
{
    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;

    public GroupInviteLifecycleService(NexusDbContext db, SafeguardingInteractionPolicy safeguarding)
    {
        _db = db;
        _safeguarding = safeguarding;
    }

    public async Task<GroupInviteResult> PreviewAsync(int tenantId, int userId, string token, CancellationToken ct)
    {
        if (!ValidToken(token)) return Missing();
        var user = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == userId, ct);
        if (user is null) return Forbidden();
        var invite = await _db.GroupInvites.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Token == token, ct);
        var validation = Validate(invite, user);
        if (validation is not null) return validation;
        var group = await _db.Groups.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == invite!.GroupId, ct);
        if (group is null || !group.IsActive || group.Status != "active") return Conflict("GROUP_UNAVAILABLE", "Group is unavailable");
        var membership = await _db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.GroupId == group.Id && x.UserId == userId, ct);
        if (invite!.Status == "accepted" && (invite.AcceptedByUserId != userId || membership?.Status != "active")) return Missing();
        return new(PreviewPayload(invite, group, membership?.Status ?? "none"));
    }

    public async Task<GroupInviteResult> AcceptAsync(int tenantId, int userId, string token, CancellationToken ct)
    {
        if (!ValidToken(token)) return Missing();
        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        var tokenLock = unchecked((long)(uint)StringComparer.Ordinal.GetHashCode(token) ^ ((long)tenantId << 32));
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tokenLock})", ct);
        var invite = await _db.GroupInvites.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Token == token, ct);
        if (invite is null) return Missing();
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {invite.GroupId})", ct);
        var group = await _db.Groups.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == invite.GroupId, ct);
        if (group is null || !group.IsActive || group.Status != "active") return Conflict("GROUP_UNAVAILABLE", "Group is unavailable");
        var user = await _db.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == userId, ct);
        if (user is null) return Forbidden();
        var validation = Validate(invite, user);
        if (validation is not null)
        {
            if (validation.Error?.Code == "EXPIRED" && invite.Status == "pending")
            {
                invite.Status = "expired";
                invite.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
            }
            return validation;
        }

        var membership = await _db.GroupMembers.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.GroupId == group.Id && x.UserId == userId, ct);
        if (membership?.Status == "banned") return Forbidden("BANNED", "You are banned from this group");
        if (invite.Status == "accepted")
        {
            if (invite.AcceptedByUserId == userId && membership?.Status == "active")
                return new(AcceptancePayload(invite, group, "already_member"));
            return Missing();
        }
        if (membership?.Status == "active")
        {
            AcceptEmailInvite(invite, userId);
            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new(AcceptancePayload(invite, group, "already_member"));
        }

        var userGroups = await _db.GroupMembers.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && x.UserId == userId && x.Status == "active", ct);
        if (userGroups >= 10) return Conflict("MEMBERSHIP_LIMIT_REACHED", "Group membership limit reached");
        var groupMembers = await _db.GroupMembers.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && x.GroupId == group.Id && x.Status == "active", ct);
        if (groupMembers >= 500) return Conflict("CAPACITY_FULL", "Group is at capacity");

        var cohort = await _db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.GroupId == group.Id && x.Status == "active" && x.UserId != userId)
            .Select(x => x.UserId).ToListAsync(ct);
        if (invite.InvitedByUserId > 0 && invite.InvitedByUserId != userId && !cohort.Contains(invite.InvitedByUserId)) cohort.Add(invite.InvitedByUserId);
        foreach (var memberId in cohort)
        {
            var outward = await _safeguarding.EvaluateLockedLocalContactAsync(userId, memberId, tenantId, "group_invitation_accept", ct);
            var inward = await _safeguarding.EvaluateLockedLocalContactAsync(memberId, userId, tenantId, "group_invitation_accept", ct);
            if (!outward.IsAllowed || !inward.IsAllowed) return Forbidden("FORBIDDEN", "Safeguarding policy does not permit this membership");
        }

        var now = DateTime.UtcNow;
        if (membership is null)
            _db.GroupMembers.Add(new GroupMember { TenantId = tenantId, GroupId = group.Id, UserId = userId, Role = "member", Status = "active", JoinedAt = now });
        else
        {
            membership.Role = "member";
            membership.Status = "active";
            membership.JoinedAt = now;
        }
        AcceptEmailInvite(invite, userId);
        group.CachedMemberCount = groupMembers + 1;
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(AcceptancePayload(invite, group, "joined"));
    }

    private static void AcceptEmailInvite(GroupInvite invite, int userId)
    {
        if (invite.InviteType != "email") return;
        invite.Status = "accepted";
        invite.AcceptedByUserId = userId;
        invite.AcceptedAt = DateTime.UtcNow;
        invite.UpdatedAt = DateTime.UtcNow;
    }

    private static GroupInviteResult? Validate(GroupInvite? invite, User user)
    {
        if (invite is null) return Missing();
        if (invite.Status == "revoked") return Gone("REVOKED", "Invite has been revoked");
        if (invite.Status == "expired" || invite.Status == "pending" && invite.ExpiresAt is not null && invite.ExpiresAt <= DateTime.UtcNow)
            return Gone("EXPIRED", "Invite has expired");
        if (invite.Status is not ("pending" or "accepted")) return Missing();
        if (invite.InviteType == "email" && !string.Equals(invite.Email, user.Email, StringComparison.OrdinalIgnoreCase))
            return Forbidden("EMAIL_MISMATCH", "Invite is bound to another email address");
        return null;
    }

    private static object PreviewPayload(GroupInvite invite, Group group, string status) => new
    {
        invite = new { id = invite.Id, type = invite.InviteType, status = invite.Status, email_bound = invite.InviteType == "email", expires_at = invite.ExpiresAt },
        group = new { id = group.Id, name = group.Name, image_url = group.ImageUrl, visibility = group.Visibility, member_count = group.CachedMemberCount },
        membership = new { status = status is "active" or "pending" or "invited" or "banned" ? status : "none" }
    };
    private static object AcceptancePayload(GroupInvite invite, Group group, string action) => new
    {
        action, group = new { id = group.Id, name = group.Name }, membership = new { status = "active", role = "member" },
        invite = new { id = invite.Id, type = invite.InviteType, status = invite.Status }
    };
    private static bool ValidToken(string token) => token.Length is >= 32 and <= 128 && token.All(char.IsLetterOrDigit);
    private static GroupInviteResult Missing() => new(null, new("NOT_FOUND", "Invite not found", 404));
    private static GroupInviteResult Forbidden(string code = "FORBIDDEN", string message = "Invite is forbidden") => new(null, new(code, message, 403));
    private static GroupInviteResult Gone(string code, string message) => new(null, new(code, message, 410));
    private static GroupInviteResult Conflict(string code, string message) => new(null, new(code, message, 409));
}
