// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using System.Diagnostics;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/monitor")]
[Authorize(Policy = "AdminOnly")]
public class PerformanceMonitorController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<PerformanceMonitorController> _logger;

    public PerformanceMonitorController(NexusDbContext db, ILogger<PerformanceMonitorController> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>GET /api/admin/monitor/health - Detailed system health and performance metrics.</summary>
    [HttpGet("health")]
    public async Task<IActionResult> Health()
    {
        var sw = Stopwatch.StartNew();
        string dbStatus;
        long dbPingMs;
        try
        {
            var dbSw = Stopwatch.StartNew();
            await _db.Database.ExecuteSqlRawAsync("SELECT 1");
            dbSw.Stop();
            dbStatus = "healthy";
            dbPingMs = dbSw.ElapsedMilliseconds;
        }
        catch
        {
            dbStatus = "unhealthy";
            dbPingMs = -1;
        }
        sw.Stop();

        var proc = Process.GetCurrentProcess();
        return Ok(new
        {
            status = dbStatus == "healthy" ? "healthy" : "degraded",
            uptime_seconds = (long)(DateTime.UtcNow - proc.StartTime.ToUniversalTime()).TotalSeconds,
            database = new { status = dbStatus, ping_ms = dbPingMs },
            memory = new
            {
                working_set_mb = proc.WorkingSet64 / 1024 / 1024,
                private_mb = proc.PrivateMemorySize64 / 1024 / 1024,
                gc_total_mb = GC.GetTotalMemory(false) / 1024 / 1024
            },
            threads = proc.Threads.Count,
            timestamp = DateTime.UtcNow,
            response_ms = sw.ElapsedMilliseconds
        });
    }

    /// <summary>GET /api/admin/monitor/database - Database statistics.</summary>
    [HttpGet("database")]
    public async Task<IActionResult> Database()
    {
        var sw = Stopwatch.StartNew();

        // DB row counts (tenant-isolated via global filters)
        var userCount = await _db.Users.AsNoTracking().CountAsync();
        var listingCount = await _db.Listings.AsNoTracking().CountAsync();
        var exchangeCount = await _db.Exchanges.AsNoTracking().CountAsync();
        var txCount = await _db.Transactions.AsNoTracking().CountAsync();

        sw.Stop();
        return Ok(new
        {
            query_time_ms = sw.ElapsedMilliseconds,
            tenant_counts = new
            {
                users = userCount,
                listings = listingCount,
                exchanges = exchangeCount,
                transactions = txCount
            },
            timestamp = DateTime.UtcNow
        });
    }

    /// <summary>GET /api/admin/monitor/system - System resource usage.</summary>
    [HttpGet("system")]
    public IActionResult GetSystemInfo()
    {
        var proc = Process.GetCurrentProcess();
        return Ok(new
        {
            process_id = proc.Id,
            cpu_time_seconds = proc.TotalProcessorTime.TotalSeconds,
            working_set_mb = proc.WorkingSet64 / 1024 / 1024,
            thread_count = proc.Threads.Count,
            gc_collections = new
            {
                gen0 = GC.CollectionCount(0),
                gen1 = GC.CollectionCount(1),
                gen2 = GC.CollectionCount(2)
            },
            dotnet_version = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
            environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production",
            timestamp = DateTime.UtcNow
        });
    }
}
