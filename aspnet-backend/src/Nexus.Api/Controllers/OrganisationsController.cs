// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Organisation / employer profile endpoints.
/// </summary>
[ApiController]
[Route("api/organisations")]
[Authorize]
public class OrganisationsController : ControllerBase
{
    private readonly OrganisationService _orgs;

    public OrganisationsController(OrganisationService orgs)
    {
        _orgs = orgs;
    }

    /// <summary>
    /// GET /api/organisations - List verified public organisations.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetOrganisations(
        [FromQuery] string? type = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var orgs = await _orgs.GetOrganisationsAsync(type, search, page, limit);
        var total = await _orgs.CountOrganisationsAsync(type, search);

        return Ok(new
        {
            data = orgs.Select(o => MapOrg(o)),
            meta = new { page, limit, total }
        });
    }

    /// <summary>
    /// GET /api/organisations/my - List my organisations.
    /// </summary>
    [HttpGet("my")]
    public async Task<IActionResult> GetMyOrganisations()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var orgs = await _orgs.GetMyOrganisationsAsync(userId.Value);
        return Ok(new { data = orgs.Select(o => MapOrg(o)) });
    }

    /// <summary>
    /// GET /api/organisations/{id} - Get organisation details.
    /// </summary>
    [HttpGet("{id:int}")]
    [HttpGet("/api/organizations/{id:int}")]
    public async Task<IActionResult> GetOrganisation(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var org = await _orgs.GetByIdAsync(id, userId.Value);
        if (org == null) return NotFound(new { error = "Organisation not found" });

        return Ok(new
        {
            data = new
            {
                org.Id, org.Name, org.Slug, org.Description, logo_url = org.LogoUrl,
                website_url = org.WebsiteUrl, org.Email, org.Phone, org.Address,
                org.Latitude, org.Longitude, org.Type, org.Industry, org.Status,
                is_public = org.IsPublic, created_at = org.CreatedAt, verified_at = org.VerifiedAt,
                owner = org.Owner != null ? new { org.Owner.Id, org.Owner.FirstName, org.Owner.LastName } : null,
                members = org.Members?.Select(m => new
                {
                    m.Id, m.UserId, m.Role, job_title = m.JobTitle, joined_at = m.JoinedAt,
                    user = m.User != null ? new { m.User.Id, m.User.FirstName, m.User.LastName } : null
                })
            }
        });
    }

    /// <summary>
    /// GET /api/organisations/slug/{slug} - Get by slug.
    /// </summary>
    [HttpGet("slug/{slug}")]
    public async Task<IActionResult> GetBySlug(string slug)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var org = await _orgs.GetBySlugAsync(slug);
        if (org == null) return NotFound(new { error = "Organisation not found" });

        return Ok(new { data = MapOrg(org) });
    }

    /// <summary>
    /// POST /api/organisations - Create organisation.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateOrgRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (org, error) = await _orgs.CreateAsync(
            userId.Value, request.Name, request.Description, request.LogoUrl,
            request.WebsiteUrl, request.Email, request.Phone, request.Address,
            request.Latitude, request.Longitude, request.Type ?? "business", request.Industry);

        if (error != null) return BadRequest(new { error });
        return Created($"/api/organisations/{org!.Id}", new { data = new { org.Id, org.Name, org.Slug } });
    }

    /// <summary>
    /// PUT /api/organisations/{id} - Update organisation.
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateOrgRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (org, error) = await _orgs.UpdateAsync(
            id, userId.Value, request.Name, request.Description, request.LogoUrl,
            request.WebsiteUrl, request.Email, request.Phone, request.Address,
            request.Latitude, request.Longitude, request.Type, request.Industry, request.IsPublic);

        if (error != null)
        {
            if (error.Contains("not found")) return NotFound(new { error });
            return BadRequest(new { error });
        }
        return Ok(new { data = new { org!.Id, org.Name, org.Slug } });
    }

    /// <summary>
    /// DELETE /api/organisations/{id} - Delete organisation (owner only).
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _orgs.DeleteAsync(id, userId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Organisation deleted" });
    }

    /// <summary>
    /// GET /api/organisations/{id}/members - List members.
    /// </summary>
    [HttpGet("{id:int}/members")]
    public async Task<IActionResult> GetMembers(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var members = await _orgs.GetMembersAsync(id, userId.Value);
        if (members == null) return NotFound(new { error = "Organisation not found" });
        return Ok(new
        {
            data = members.Select(m => new
            {
                m.Id, m.UserId, m.Role, job_title = m.JobTitle, joined_at = m.JoinedAt,
                user = m.User != null ? new { m.User.Id, m.User.FirstName, m.User.LastName } : null
            })
        });
    }

    /// <summary>
    /// POST /api/organisations/{id}/members - Add member.
    /// </summary>
    [HttpPost("{id:int}/members")]
    public async Task<IActionResult> AddMember(int id, [FromBody] AddOrgMemberRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (member, error) = await _orgs.AddMemberAsync(
            id, request.UserId, userId.Value, request.Role ?? "member", request.JobTitle);

        if (error != null) return BadRequest(new { error });
        return Created($"/api/organisations/{id}/members", new { data = new { member!.Id, member.UserId, member.Role } });
    }

    /// <summary>
    /// DELETE /api/organisations/{id}/members/{userId} - Remove member.
    /// </summary>
    [HttpDelete("{id:int}/members/{memberId}")]
    public async Task<IActionResult> RemoveMember(int id, int memberId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _orgs.RemoveMemberAsync(id, memberId, userId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Member removed" });
    }

    /// <summary>
    /// PUT /api/organisations/{id}/members/{userId}/role - Update member role.
    /// </summary>
    [HttpPut("{id:int}/members/{memberId}/role")]
    public async Task<IActionResult> UpdateMemberRole(int id, int memberId, [FromBody] UpdateOrgMemberRoleRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (member, error) = await _orgs.UpdateMemberRoleAsync(
            id, memberId, userId.Value, request.Role, request.JobTitle);

        if (error != null) return BadRequest(new { error });
        return Ok(new { data = new { member!.Id, member.UserId, member.Role } });
    }

    private static object MapOrg(Entities.Organisation o) => new
    {
        o.Id, o.Name, o.Slug, o.Description, logo_url = o.LogoUrl,
        website_url = o.WebsiteUrl, o.Email, o.Phone, o.Address,
        o.Latitude, o.Longitude, o.Type, o.Industry, o.Status,
        is_public = o.IsPublic, created_at = o.CreatedAt, verified_at = o.VerifiedAt,
        owner = o.Owner != null ? new { o.Owner.Id, o.Owner.FirstName, o.Owner.LastName } : null
    };
}

public class CreateOrgRequest
{
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("logo_url")] public string? LogoUrl { get; set; }
    [JsonPropertyName("website_url")] public string? WebsiteUrl { get; set; }
    [JsonPropertyName("email")] public string? Email { get; set; }
    [JsonPropertyName("phone")] public string? Phone { get; set; }
    [JsonPropertyName("address")] public string? Address { get; set; }
    [JsonPropertyName("latitude")] public double? Latitude { get; set; }
    [JsonPropertyName("longitude")] public double? Longitude { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("industry")] public string? Industry { get; set; }
}

public class UpdateOrgRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("logo_url")] public string? LogoUrl { get; set; }
    [JsonPropertyName("website_url")] public string? WebsiteUrl { get; set; }
    [JsonPropertyName("email")] public string? Email { get; set; }
    [JsonPropertyName("phone")] public string? Phone { get; set; }
    [JsonPropertyName("address")] public string? Address { get; set; }
    [JsonPropertyName("latitude")] public double? Latitude { get; set; }
    [JsonPropertyName("longitude")] public double? Longitude { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("industry")] public string? Industry { get; set; }
    [JsonPropertyName("is_public")] public bool? IsPublic { get; set; }
}

public class AddOrgMemberRequest
{
    [JsonPropertyName("user_id")] public int UserId { get; set; }
    [JsonPropertyName("role")] public string? Role { get; set; }
    [JsonPropertyName("job_title")] public string? JobTitle { get; set; }
}

public class UpdateOrgMemberRoleRequest
{
    [JsonPropertyName("role")] public string Role { get; set; } = "member";
    [JsonPropertyName("job_title")] public string? JobTitle { get; set; }
}
