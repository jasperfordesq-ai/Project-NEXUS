// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Public pages endpoints - read published CMS pages.
/// </summary>
[ApiController]
[Route("api/pages")]
[Authorize]
public class PagesController : ControllerBase
{
    private readonly PageService _pages;

    public PagesController(PageService pages)
    {
        _pages = pages;
    }

    /// <summary>
    /// GET /api/pages - List published pages.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetPages()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var pages = await _pages.GetPublishedPagesAsync();
        return Ok(new
        {
            data = pages.Select(p => MapPage(p))
        });
    }

    /// <summary>
    /// GET /api/pages/menu?location=header - Get menu pages.
    /// </summary>
    [HttpGet("menu")]
    [AllowAnonymous]
    public async Task<IActionResult> GetMenuPages([FromQuery] string? location = null)
    {
        var pages = await _pages.GetMenuPagesAsync(location);
        return Ok(new
        {
            data = pages.Select(p => new
            {
                p.Id,
                p.Title,
                p.Slug,
                menu_location = p.MenuLocation,
                sort_order = p.SortOrder,
                parent_id = p.ParentId
            })
        });
    }

    /// <summary>
    /// GET /api/pages/{slug} - Get a published page by slug.
    /// </summary>
    [HttpGet("{slug}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetPage(string slug)
    {
        var page = await _pages.GetPageBySlugAsync(slug);
        if (page == null) return NotFound(new { error = "Page not found" });

        return Ok(new { data = MapPage(page) });
    }

    private static object MapPage(Entities.Page p) => new
    {
        p.Id,
        p.Title,
        p.Slug,
        p.Content,
        is_published = p.IsPublished,
        show_in_menu = p.ShowInMenu,
        menu_location = p.MenuLocation,
        sort_order = p.SortOrder,
        parent_id = p.ParentId,
        current_version = p.CurrentVersion,
        meta_title = p.MetaTitle,
        meta_description = p.MetaDescription,
        created_at = p.CreatedAt,
        updated_at = p.UpdatedAt,
        created_by = p.CreatedBy != null ? new { p.CreatedBy.Id, p.CreatedBy.FirstName, p.CreatedBy.LastName } : null
    };
}
