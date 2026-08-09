// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Groups controller - community groups management.
/// Phase 11: Create, manage, and join groups.
/// </summary>
[ApiController]
[Route("api/groups")]
[Authorize]
public class GroupsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<GroupsController> _logger;
    private readonly GamificationService _gamification;
    private readonly GroupFormService _groupForms;

    public GroupsController(
        NexusDbContext db,
        ILogger<GroupsController> logger,
        GamificationService gamification,
        GroupFormService groupForms)
    {
        _db = db;
        _logger = logger;
        _gamification = gamification;
        _groupForms = groupForms;
    }

    [HttpGet("form-capabilities")]
    [HttpGet("/api/v2/groups/form-capabilities")]
    public async Task<IActionResult> FormCapabilities(CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null) return Unauthorized();
        return Ok(new { data = await _groupForms.GetCapabilitiesAsync(tenantId.Value, userId.Value, cancellationToken) });
    }

    [HttpPost("/api/v2/groups/{id:int}/settings")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> UpdateGroupSettings(int id, CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null) return Unauthorized();
        if (!Request.HasFormContentType)
            return GroupFormResponse(new(null, new("VALIDATION_ERROR", "Multipart form data is required", 422)));
        var form = await Request.ReadFormAsync(cancellationToken);
        return GroupFormResponse(await _groupForms.UpdateAsync(
            tenantId.Value, id, userId.Value, form, cancellationToken));
    }

    [HttpDelete("/api/v2/groups/{id:int}/image")]
    public async Task<IActionResult> RemoveGroupImage(int id, [FromQuery] string type = "avatar", CancellationToken cancellationToken = default)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null) return Unauthorized();
        return GroupFormResponse(await _groupForms.RemoveImageAsync(
            tenantId.Value, id, userId.Value, type, cancellationToken));
    }

    private IActionResult GroupFormResponse(GroupFormResult result) => result.Succeeded
        ? Ok(new { data = result.Data })
        : StatusCode(result.Error!.Status, new
        {
            success = false,
            errors = new[] { new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } }
        });

    /// <summary>
    /// GET /api/groups - List all groups (paginated).
    /// </summary>
    [HttpGet]
    [HttpGet("/api/v2/groups")]
    public async Task<IActionResult> GetGroups(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? search = null)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Groups.AsQueryable();

        // Search by name (case-insensitive)
        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchLower = search.ToLower();
            query = query.Where(g => g.Name.ToLower().Contains(searchLower));
        }

        var total = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var groups = await query
            .AsNoTracking()
            .OrderByDescending(g => g.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(g => new
            {
                g.Id,
                g.Name,
                g.Description,
                g.IsPrivate,
                g.ImageUrl,
                image_url = g.ImageUrl,
                cover_image_url = g.ImageUrl,
                cover_image = g.ImageUrl,
                visibility = g.IsPrivate ? "private" : "public",
                g.CreatedAt,
                created_by = g.CreatedBy != null
                    ? new { g.CreatedBy.Id, g.CreatedBy.FirstName, g.CreatedBy.LastName }
                    : null,
                member_count = _db.GroupMembers.Count(gm => gm.GroupId == g.Id)
            })
            .ToListAsync();

        return Ok(new
        {
            data = groups,
            pagination = new
            {
                page,
                limit,
                total,
                pages = totalPages
            }
        });
    }

    /// <summary>
    /// GET /api/groups/my - List groups the current user is a member of.
    /// </summary>
    [HttpGet("my")]
    public async Task<IActionResult> GetMyGroups()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var groups = await _db.GroupMembers
            .AsNoTracking()
            .Where(gm => gm.UserId == userId)
            .OrderByDescending(gm => gm.JoinedAt)
            .Select(gm => new
            {
                gm.Group!.Id,
                gm.Group.Name,
                gm.Group.Description,
                gm.Group.IsPrivate,
                gm.Group.ImageUrl,
                image_url = gm.Group.ImageUrl,
                cover_image_url = gm.Group.ImageUrl,
                cover_image = gm.Group.ImageUrl,
                visibility = gm.Group.IsPrivate ? "private" : "public",
                gm.Group.CreatedAt,
                my_role = gm.Role,
                joined_at = gm.JoinedAt,
                member_count = _db.GroupMembers.Count(m => m.GroupId == gm.GroupId)
            })
            .ToListAsync();

        return Ok(new { data = groups });
    }

    /// <summary>
    /// GET /api/groups/{id} - Get a single group by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetGroup(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var group = await _db.Groups
            .AsNoTracking()
            .Where(g => g.Id == id)
            .Select(g => new
            {
                g.Id,
                g.Name,
                g.Description,
                g.IsPrivate,
                g.ImageUrl,
                image_url = g.ImageUrl,
                cover_image_url = g.ImageUrl,
                cover_image = g.ImageUrl,
                visibility = g.IsPrivate ? "private" : "public",
                g.CreatedAt,
                g.UpdatedAt,
                created_by = g.CreatedBy != null
                    ? new { g.CreatedBy.Id, g.CreatedBy.FirstName, g.CreatedBy.LastName }
                    : null,
                member_count = _db.GroupMembers.Count(gm => gm.GroupId == g.Id)
            })
            .FirstOrDefaultAsync();

        if (group == null)
        {
            return NotFound(new { error = "Group not found" });
        }

        // Check if current user is a member
        var membership = await _db.GroupMembers
            .AsNoTracking()
            .Where(gm => gm.GroupId == id && gm.UserId == userId)
            .Select(gm => new { gm.Role, gm.JoinedAt })
            .FirstOrDefaultAsync();

        return Ok(new
        {
            group,
            my_membership = membership
        });
    }

    /// <summary>
    /// POST /api/groups - Create a new group.
    /// </summary>
    [HttpPost]
    [HttpPost("/api/v2/groups")]
    public async Task<IActionResult> CreateGroup([FromBody] CreateGroupRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { error = "Group name is required" });
        }

        if (request.Name.Length > 255)
        {
            return BadRequest(new { error = "Group name cannot exceed 255 characters" });
        }

        var group = new Group
        {
            CreatedById = userId.Value,
            Name = request.Name.Trim(),
            Description = request.Description?.Trim(),
            IsPrivate = request.IsPrivate,
            Visibility = request.IsPrivate ? "private" : "public",
            ImageUrl = request.ImageUrl?.Trim()
        };

        // Use transaction to ensure group + owner membership are created atomically
        await using var transaction = await _db.Database.BeginTransactionAsync();

        _db.Groups.Add(group);
        await _db.SaveChangesAsync();

        // Creator automatically becomes owner
        var membership = new GroupMember
        {
            GroupId = group.Id,
            UserId = userId.Value,
            Role = Group.Roles.Owner
        };

        _db.GroupMembers.Add(membership);
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        // Award XP and check badges for creating a group (non-critical)
        try
        {
            await _gamification.AwardXpAsync(userId.Value, XpLog.Amounts.GroupCreated, XpLog.Sources.GroupCreated, group.Id, $"Created group: {group.Name}");
            await _gamification.CheckAndAwardBadgesAsync(userId.Value, "group_created");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for group {GroupId}", group.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for group {GroupId}", group.Id);
        }

        _logger.LogInformation("User {UserId} created group {GroupId}: {GroupName}", userId, group.Id, group.Name);

        return CreatedAtAction(nameof(GetGroup), new { id = group.Id }, new
        {
            success = true,
            message = "Group created",
            group = new
            {
                group.Id,
                group.Name,
                group.Description,
                group.IsPrivate,
                group.ImageUrl,
                image_url = group.ImageUrl,
                cover_image_url = group.ImageUrl,
                cover_image = group.ImageUrl,
                visibility = group.IsPrivate ? "private" : "public",
                group.CreatedAt,
                my_role = Group.Roles.Owner
            }
        });
    }

    /// <summary>
    /// PUT /api/groups/{id} - Update a group (admin/owner only).
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateGroup(int id, [FromBody] UpdateGroupRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == id);
        if (group == null)
        {
            return NotFound(new { error = "Group not found" });
        }

        // Check if user is admin or owner
        var membership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);

        if (membership == null || (membership.Role != Group.Roles.Admin && membership.Role != Group.Roles.Owner))
        {
            return StatusCode(403, new { error = "Only admins and owners can update the group" });
        }

        if (request.Name != null)
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return BadRequest(new { error = "Group name cannot be empty" });
            }
            if (request.Name.Length > 255)
            {
                return BadRequest(new { error = "Group name cannot exceed 255 characters" });
            }
            group.Name = request.Name.Trim();
        }

        if (request.Description != null)
        {
            group.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        }

        if (request.IsPrivate.HasValue)
        {
            group.IsPrivate = request.IsPrivate.Value;
            group.Visibility = request.IsPrivate.Value ? "private" : "public";
        }

        if (request.ImageUrl != null)
        {
            group.ImageUrl = string.IsNullOrWhiteSpace(request.ImageUrl) ? null : request.ImageUrl.Trim();
        }

        group.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} updated group {GroupId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Group updated",
            group = new
            {
                group.Id,
                group.Name,
                group.Description,
                group.IsPrivate,
                group.ImageUrl,
                image_url = group.ImageUrl,
                cover_image_url = group.ImageUrl,
                cover_image = group.ImageUrl,
                visibility = group.IsPrivate ? "private" : "public",
                group.CreatedAt,
                group.UpdatedAt
            }
        });
    }

    /// <summary>
    /// DELETE /api/groups/{id} - Delete a group (owner only).
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteGroup(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == id);
        if (group == null)
        {
            return NotFound(new { error = "Group not found" });
        }

        // Check if user is owner
        var membership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);

        if (membership == null || membership.Role != Group.Roles.Owner)
        {
            return StatusCode(403, new { error = "Only the owner can delete the group" });
        }

        _db.Groups.Remove(group);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} deleted group {GroupId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Group deleted"
        });
    }

    /// <summary>
    /// GET /api/groups/{id}/members - List group members.
    /// </summary>
    [HttpGet("{id:int}/members")]
    public async Task<IActionResult> GetGroupMembers(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var groupExists = await _db.Groups.AnyAsync(g => g.Id == id);
        if (!groupExists)
        {
            return NotFound(new { error = "Group not found" });
        }

        var members = await _db.GroupMembers
            .AsNoTracking()
            .Where(gm => gm.GroupId == id)
            .OrderBy(gm => gm.Role == Group.Roles.Owner ? 0 : gm.Role == Group.Roles.Admin ? 1 : 2)
            .ThenBy(gm => gm.JoinedAt)
            .Select(gm => new
            {
                id = gm.User != null ? gm.User.Id : 0,
                first_name = gm.User != null ? gm.User.FirstName : "",
                last_name = gm.User != null ? gm.User.LastName : "",
                email = gm.User != null ? gm.User.Email : "",
                gm.Role,
                joined_at = gm.JoinedAt
            })
            .ToListAsync();

        return Ok(new { data = members });
    }

    /// <summary>
    /// POST /api/groups/{id}/join - Join a group.
    /// </summary>
    [HttpPost("{id:int}/join")]
    public async Task<IActionResult> JoinGroup(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == id);
        if (group == null)
        {
            return NotFound(new { error = "Group not found" });
        }

        // Check if already a member
        var existingMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);

        if (existingMembership != null)
        {
            return BadRequest(new { error = "You are already a member of this group" });
        }

        // For private groups, could implement invitation/request system
        // For now, private groups require admin to add members
        if (group.IsPrivate)
        {
            return StatusCode(403, new { error = "This is a private group. Contact an admin to join." });
        }

        var membership = new GroupMember
        {
            GroupId = id,
            UserId = userId.Value,
            Role = Group.Roles.Member
        };

        _db.GroupMembers.Add(membership);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} joined group {GroupId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Joined group successfully",
            membership = new
            {
                group_id = id,
                role = membership.Role,
                joined_at = membership.JoinedAt
            }
        });
    }

    /// <summary>
    /// DELETE /api/groups/{id}/leave - Leave a group.
    /// </summary>
    [HttpDelete("{id:int}/leave")]
    public async Task<IActionResult> LeaveGroup(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var membership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);

        if (membership == null)
        {
            return BadRequest(new { error = "You are not a member of this group" });
        }

        // Owner cannot leave (must transfer ownership or delete group)
        if (membership.Role == Group.Roles.Owner)
        {
            return BadRequest(new { error = "Owner cannot leave the group. Transfer ownership or delete the group." });
        }

        _db.GroupMembers.Remove(membership);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} left group {GroupId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Left group successfully"
        });
    }

    /// <summary>
    /// POST /api/groups/{id}/members - Add a member (admin/owner only).
    /// </summary>
    [HttpPost("{id:int}/members")]
    public async Task<IActionResult> AddMember(int id, [FromBody] AddMemberRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == id);
        if (group == null)
        {
            return NotFound(new { error = "Group not found" });
        }

        // Check if user is admin or owner
        var currentMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);

        if (currentMembership == null || (currentMembership.Role != Group.Roles.Admin && currentMembership.Role != Group.Roles.Owner))
        {
            return StatusCode(403, new { error = "Only admins and owners can add members" });
        }

        // Validate target user exists
        var targetUser = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId);
        if (targetUser == null)
        {
            return NotFound(new { error = "User not found" });
        }

        // Check if already a member
        var existingMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == request.UserId);

        if (existingMembership != null)
        {
            return BadRequest(new { error = "User is already a member of this group" });
        }

        var membership = new GroupMember
        {
            GroupId = id,
            UserId = request.UserId,
            Role = Group.Roles.Member
        };

        _db.GroupMembers.Add(membership);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} added user {TargetUserId} to group {GroupId}", userId, request.UserId, id);

        return Ok(new
        {
            success = true,
            message = "Member added successfully",
            member = new
            {
                targetUser.Id,
                targetUser.FirstName,
                targetUser.LastName,
                role = membership.Role,
                joined_at = membership.JoinedAt
            }
        });
    }

    /// <summary>
    /// DELETE /api/groups/{id}/members/{memberId} - Remove a member (admin/owner only).
    /// </summary>
    [HttpDelete("{id:int}/members/{memberId}")]
    public async Task<IActionResult> RemoveMember(int id, int memberId)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Check if user is admin or owner
        var currentMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);

        if (currentMembership == null || (currentMembership.Role != Group.Roles.Admin && currentMembership.Role != Group.Roles.Owner))
        {
            return StatusCode(403, new { error = "Only admins and owners can remove members" });
        }

        var targetMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == memberId);

        if (targetMembership == null)
        {
            return NotFound(new { error = "Member not found in this group" });
        }

        // Cannot remove owner
        if (targetMembership.Role == Group.Roles.Owner)
        {
            return BadRequest(new { error = "Cannot remove the owner from the group" });
        }

        // Admins cannot remove other admins (only owner can)
        if (targetMembership.Role == Group.Roles.Admin && currentMembership.Role != Group.Roles.Owner)
        {
            return StatusCode(403, new { error = "Only the owner can remove admins" });
        }

        _db.GroupMembers.Remove(targetMembership);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} removed user {MemberId} from group {GroupId}", userId, memberId, id);

        return Ok(new
        {
            success = true,
            message = "Member removed successfully"
        });
    }

    /// <summary>
    /// PUT /api/groups/{id}/members/{memberId}/role - Update member role (owner only).
    /// </summary>
    [HttpPut("{id:int}/members/{memberId}/role")]
    public async Task<IActionResult> UpdateMemberRole(int id, int memberId, [FromBody] UpdateRoleRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Check if user is owner
        var currentMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);

        if (currentMembership == null || currentMembership.Role != Group.Roles.Owner)
        {
            return StatusCode(403, new { error = "Only the owner can change member roles" });
        }

        var targetMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == memberId);

        if (targetMembership == null)
        {
            return NotFound(new { error = "Member not found in this group" });
        }

        // Cannot change own role as owner
        if (memberId == userId)
        {
            return BadRequest(new { error = "Cannot change your own role. Transfer ownership to another member first." });
        }

        // Validate role
        var validRoles = new[] { Group.Roles.Member, Group.Roles.Admin };
        if (!validRoles.Contains(request.Role))
        {
            return BadRequest(new { error = $"Invalid role. Valid roles: {string.Join(", ", validRoles)}" });
        }

        targetMembership.Role = request.Role;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} changed role of user {MemberId} to {Role} in group {GroupId}",
            userId, memberId, request.Role, id);

        return Ok(new
        {
            success = true,
            message = "Member role updated",
            member = new
            {
                user_id = memberId,
                role = targetMembership.Role
            }
        });
    }

    /// <summary>
    /// PUT /api/groups/{id}/transfer-ownership - Transfer group ownership (owner only).
    /// </summary>
    [HttpPut("{id:int}/transfer-ownership")]
    public async Task<IActionResult> TransferOwnership(int id, [FromBody] TransferOwnershipRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Check if user is owner
        var currentMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == userId);

        if (currentMembership == null || currentMembership.Role != Group.Roles.Owner)
        {
            return StatusCode(403, new { error = "Only the owner can transfer ownership" });
        }

        var newOwnerMembership = await _db.GroupMembers
            .FirstOrDefaultAsync(gm => gm.GroupId == id && gm.UserId == request.NewOwnerId);

        if (newOwnerMembership == null)
        {
            return NotFound(new { error = "New owner must be a member of the group" });
        }

        // Transfer ownership
        currentMembership.Role = Group.Roles.Admin;
        newOwnerMembership.Role = Group.Roles.Owner;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} transferred ownership of group {GroupId} to user {NewOwnerId}",
            userId, id, request.NewOwnerId);

        return Ok(new
        {
            success = true,
            message = "Ownership transferred successfully",
            new_owner_id = request.NewOwnerId,
            your_new_role = Group.Roles.Admin
        });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

public class CreateGroupRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("is_private")]
    public bool IsPrivate { get; set; } = false;

    [JsonPropertyName("image_url")]
    [Url(ErrorMessage = "ImageUrl must be a valid URL")]
    public string? ImageUrl { get; set; }
}

public class UpdateGroupRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("is_private")]
    public bool? IsPrivate { get; set; }

    [JsonPropertyName("image_url")]
    [Url(ErrorMessage = "ImageUrl must be a valid URL")]
    public string? ImageUrl { get; set; }
}

public class AddMemberRequest
{
    [JsonPropertyName("user_id")]
    public int UserId { get; set; }
}

public class UpdateRoleRequest
{
    [JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;
}

public class TransferOwnershipRequest
{
    [JsonPropertyName("new_owner_id")]
    public int NewOwnerId { get; set; }
}
