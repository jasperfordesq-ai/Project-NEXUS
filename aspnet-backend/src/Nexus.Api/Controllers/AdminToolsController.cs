// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Data.Common;
using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Nexus.Api.Data;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/tools")]
[Authorize(Policy = "AdminOnly")]
public class AdminToolsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly IMemoryCache _cache;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<AdminToolsController> _logger;

    public AdminToolsController(NexusDbContext db, IMemoryCache cache, TenantContext tenantContext, ILogger<AdminToolsController> logger)
    {
        _db = db;
        _cache = cache;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    [HttpPost("cache/clear")]
    public IActionResult ClearCache()
    {
        if (_cache is MemoryCache mc) mc.Compact(1.0);
        _logger.LogInformation("Cache cleared by admin");
        return Ok(new { message = "Cache cleared", cleared_at = DateTime.UtcNow });
    }

    [HttpGet("404-errors")]
    public IActionResult Get404Errors()
    {
        var errors = _cache.TryGetValue("404_errors", out List<NotFoundEntry>? entries) ? entries ?? new() : new();
        return Ok(new { data = errors.OrderByDescending(e => e.Count).Take(100), total = errors.Count });
    }

    [HttpGet("redirects")]
    public async Task<IActionResult> GetRedirects()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var key = $"url_redirects_{tenantId}";
        var setting = await _db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key);
        var redirects = setting == null ? new List<UrlRedirect>() : JsonSerializer.Deserialize<List<UrlRedirect>>(setting.Value ?? "[]") ?? new();
        return Ok(new { data = redirects });
    }

    [HttpPost("redirects")]
    public async Task<IActionResult> CreateRedirect([FromBody] CreateRedirectRequest req)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var key = $"url_redirects_{tenantId}";
        var setting = await _db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key);
        List<UrlRedirect> redirects;
        if (setting == null)
        {
            redirects = new();
            setting = new SystemSetting { Key = key, Value = "[]" };
            _db.SystemSettings.Add(setting);
        }
        else
        {
            redirects = JsonSerializer.Deserialize<List<UrlRedirect>>(setting.Value ?? "[]") ?? new();
        }
        redirects.RemoveAll(r => r.From == req.From);
        redirects.Add(new UrlRedirect { From = req.From, To = req.To, IsPermanent = req.IsPermanent, CreatedAt = DateTime.UtcNow });
        setting.Value = JsonSerializer.Serialize(redirects);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Redirect created", from = req.From, to = req.To });
    }

    [HttpDelete("redirects")]
    public async Task<IActionResult> DeleteRedirect([FromBody] DeleteRedirectRequest req)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var key = $"url_redirects_{tenantId}";
        var setting = await _db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting == null) return NotFound(new { error = "No redirects configured" });
        var redirects = JsonSerializer.Deserialize<List<UrlRedirect>>(setting.Value ?? "[]") ?? new();
        redirects.RemoveAll(r => r.From == req.From);
        setting.Value = JsonSerializer.Serialize(redirects);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Redirect deleted" });
    }

    [HttpGet("health")]
    public async Task<IActionResult> DetailedHealth()
    {
        var sw = Stopwatch.StartNew();
        bool dbOk = false;
        string dbError = "";
        try { dbOk = await _db.Database.CanConnectAsync(); } catch (DbException ex) { dbError = ex.Message; }
        sw.Stop();
        return Ok(new
        {
            status = dbOk ? "healthy" : "degraded",
            database = new { status = dbOk ? "ok" : "error", response_time_ms = sw.ElapsedMilliseconds, error = dbError.Length > 0 ? dbError : null },
            cache = new { status = "ok" },
            timestamp = DateTime.UtcNow
        });
    }

    [HttpPost("ip-debug")]
    public IActionResult IpDebug([FromBody] IpDebugRequest req)
    {
        if (!IPAddress.TryParse(req.Ip, out var ip))
            return BadRequest(new { error = "Invalid IP address" });
        var bytes = ip.GetAddressBytes();
        bool isPrivate = IPAddress.IsLoopback(ip) || (bytes.Length == 4 && (
            bytes[0] == 10 ||
            (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
            (bytes[0] == 192 && bytes[1] == 168)));
        return Ok(new
        {
            ip = req.Ip,
            is_loopback = IPAddress.IsLoopback(ip),
            is_private = isPrivate,
            address_family = ip.AddressFamily.ToString(),
            country = "IE",
            asn = "AS12345 (mock)"
        });
    }
}

public record CreateRedirectRequest([property: Required] string From, [property: Required] string To, bool IsPermanent = false);
public record DeleteRedirectRequest([property: Required] string From);
public record IpDebugRequest([property: Required] string Ip);

public class NotFoundEntry { public string Path { get; set; } = ""; public int Count { get; set; } public DateTime LastSeen { get; set; } }
public class UrlRedirect { public string From { get; set; } = ""; public string To { get; set; } = ""; public bool IsPermanent { get; set; } public DateTime CreatedAt { get; set; } }
