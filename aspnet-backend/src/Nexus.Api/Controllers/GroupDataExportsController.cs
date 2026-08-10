// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/groups")]
[Route("api/v2/groups")]
public sealed class GroupDataExportsController : ControllerBase
{
    private readonly GroupDataExportService _exports;
    private readonly TenantContext _tenant;
    public GroupDataExportsController(GroupDataExportService exports, TenantContext tenant) { _exports = exports; _tenant = tenant; }

    [HttpPost("{groupId:int}/exports")]
    public async Task<IActionResult> RequestExport(int groupId, CancellationToken ct)
    {
        var result = await _exports.RequestAsync(TenantId(), groupId, UserId(), ct);
        return Result(result, 202);
    }

    [HttpGet("{groupId:int}/exports/{exportId:guid}")]
    public async Task<IActionResult> Status(int groupId, Guid exportId, CancellationToken ct)
        => Result(await _exports.GetAsync(TenantId(), groupId, UserId(), exportId, ct));

    [HttpGet("{groupId:int}/exports/{exportId:guid}/download")]
    public async Task<IActionResult> Download(int groupId, Guid exportId, CancellationToken ct)
    {
        var (row, error) = await _exports.GetDownloadAsync(TenantId(), groupId, UserId(), exportId, ct);
        if (error is not null) return StatusCode(error.Status, new { error = new { code = error.Code, message = error.Message } });
        var path = _exports.SafeAbsolutePath(row!)!;
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.XContentTypeOptions = "nosniff";
        return PhysicalFile(path, "application/json; charset=UTF-8", $"group-{groupId}-export.json");
    }

    private IActionResult Result(GroupExportResult result, int success = 200) => result.Succeeded
        ? StatusCode(success, new { data = result.Data })
        : StatusCode(result.Error!.Status, new { error = new { code = result.Error.Code, message = result.Error.Message } });
    private int TenantId() => _tenant.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");
}
