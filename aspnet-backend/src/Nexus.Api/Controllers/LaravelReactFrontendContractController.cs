// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Backend contract endpoints used directly by the canonical Laravel React frontend.
/// </summary>
[ApiController]
public class LaravelReactFrontendContractController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly FileUploadService _fileUploadService;

    public LaravelReactFrontendContractController(NexusDbContext db, FileUploadService fileUploadService)
    {
        _db = db;
        _fileUploadService = fileUploadService;
    }

    [HttpGet("api/sw-reset")]
    [AllowAnonymous]
    public ContentResult SwReset()
    {
        Response.Headers["Clear-Site-Data"] = "\"cache\", \"storage\"";
        const string html = """
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Resetting Project NEXUS</title></head>
<body>
<script>
(async () => {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } finally {
    window.location.replace('/');
  }
})();
</script>
</body>
</html>
""";
        return Content(html, "text/html", Encoding.UTF8);
    }

    [HttpGet("api/partner-analytics/me/dashboard")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerAnalyticsDashboard([FromQuery] string? period = null, [FromQuery] string? token = null)
    {
        var subscription = await ResolveRegionalAnalyticsSubscriptionAsync(token);
        if (subscription is null) return Unauthorized(Error("unauthorized", "Invalid or missing subscription token."));
        if (!IsActiveSubscription(subscription)) return StatusCode(403, Error("forbidden", "Subscription is not active."));

        var normalizedPeriod = NormalizePartnerAnalyticsPeriod(period);
        var reportCount = await _db.RegionalAnalyticsReports
            .CountAsync(r => r.SubscriptionId == subscription.Id && r.TenantId == subscription.TenantId);

        await LogPartnerAnalyticsAccessAsync(subscription, "/partner-analytics/me/dashboard");

        return Ok(new
        {
            success = true,
            data = new
            {
                period = normalizedPeriod,
                tenant_id = subscription.TenantId,
                partner_name = subscription.PartnerName,
                plan_tier = subscription.PlanTier,
                enabled_modules = ParseStringList(subscription.EnabledModules),
                reports_available = reportCount,
                metrics = new
                {
                    active_members = await _db.Users.CountAsync(u => u.TenantId == subscription.TenantId && u.IsActive),
                    listings = await _db.Listings.CountAsync(l => l.TenantId == subscription.TenantId),
                    groups = await _db.Groups.CountAsync(g => g.TenantId == subscription.TenantId)
                }
            }
        });
    }

    [HttpGet("api/partner-analytics/me/reports")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerAnalyticsReports([FromQuery] string? token = null)
    {
        var subscription = await ResolveRegionalAnalyticsSubscriptionAsync(token);
        if (subscription is null) return Unauthorized(Error("unauthorized", "Invalid or missing subscription token."));
        if (!IsActiveSubscription(subscription)) return StatusCode(403, Error("forbidden", "Subscription is not active."));

        var reports = await _db.RegionalAnalyticsReports
            .Where(r => r.SubscriptionId == subscription.Id && r.TenantId == subscription.TenantId)
            .OrderByDescending(r => r.Id)
            .Take(60)
            .Select(r => new
            {
                id = r.Id,
                report_type = r.ReportType,
                period_start = r.PeriodStart,
                period_end = r.PeriodEnd,
                generated_at = r.GeneratedAt,
                status = r.Status,
                file_url = r.FileUrl
            })
            .ToListAsync();

        await LogPartnerAnalyticsAccessAsync(subscription, "/partner-analytics/me/reports");
        return Ok(new { success = true, data = new { reports } });
    }

    [HttpGet("api/partner-analytics/me/reports/{id:long}/download")]
    [AllowAnonymous]
    public async Task<IActionResult> DownloadPartnerAnalyticsReport(long id, [FromQuery] string? token = null)
    {
        var subscription = await ResolveRegionalAnalyticsSubscriptionAsync(token);
        if (subscription is null) return Unauthorized(Error("unauthorized", "Invalid or missing subscription token."));
        if (!IsActiveSubscription(subscription)) return StatusCode(403, Error("forbidden", "Subscription is not active."));

        var report = await _db.RegionalAnalyticsReports
            .FirstOrDefaultAsync(r => r.Id == id && r.SubscriptionId == subscription.Id && r.TenantId == subscription.TenantId);
        if (report is null || string.IsNullOrWhiteSpace(report.FileUrl))
            return NotFound(Error("REPORT_NOT_FOUND", "Report not available."));

        await LogPartnerAnalyticsAccessAsync(subscription, $"/partner-analytics/me/reports/{id}/download");
        var filename = $"regional-analytics-{report.PeriodStart:yyyy-MM-dd}.pdf";
        return File(BuildRegionalAnalyticsPdf(report, subscription), "application/pdf", filename);
    }

    [HttpGet("api/v2/marketplace/sellers/{sellerId:int}/shipping-options")]
    [Authorize]
    public async Task<IActionResult> SellerShippingOptions(int sellerId)
    {
        var tenantId = User.GetTenantId();
        if (tenantId is null) return Unauthorized(new { success = false, error = "Invalid token" });

        var rows = await _db.MarketplaceShippingOptions
            .Where(o => o.TenantId == tenantId.Value && o.UserId == sellerId && o.IsActive)
            .OrderBy(o => o.Price)
            .ThenBy(o => o.Name)
            .Select(o => new
            {
                id = o.Id,
                seller_id = o.UserId,
                name = o.Name,
                courier_name = o.Name,
                courier_code = o.Region,
                price = o.Price,
                currency = o.Currency,
                region = o.Region,
                estimated_days = (int?)null,
                is_default = false,
                is_active = o.IsActive
            })
            .ToListAsync();

        return Ok(new { success = true, data = rows, meta = new { total = rows.Count } });
    }

    [HttpGet("api/v2/members/search")]
    [Authorize]
    public async Task<IActionResult> MembersSearch([FromQuery] string? q = null, [FromQuery] int limit = 20)
    {
        var tenantId = User.GetTenantId();
        if (tenantId is null) return Unauthorized(new { success = false, error = "Invalid token" });

        limit = Math.Clamp(limit, 1, 100);
        var query = (q ?? string.Empty).Trim().ToLowerInvariant();
        var users = _db.Users.Where(u => u.TenantId == tenantId.Value && u.IsActive);
        if (!string.IsNullOrWhiteSpace(query))
        {
            users = users.Where(u =>
                u.FirstName.ToLower().Contains(query) ||
                u.LastName.ToLower().Contains(query) ||
                (u.FirstName + " " + u.LastName).ToLower().Contains(query) ||
                u.Email.ToLower().Contains(query));
        }

        var results = await users
            .OrderBy(u => u.FirstName)
            .ThenBy(u => u.LastName)
            .Take(limit)
            .Select(u => new
            {
                id = u.Id,
                name = (u.FirstName + " " + u.LastName).Trim(),
                first_name = u.FirstName,
                last_name = u.LastName,
                avatar_url = u.AvatarUrl
            })
            .ToListAsync();

        return Ok(new { success = true, data = results });
    }

    [HttpPost("api/v2/upload")]
    [Authorize]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile file, [FromForm] string? type = null)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null) return Unauthorized(new { success = false, error = "Invalid token" });
        if (file is null || file.Length == 0) return BadRequest(new { success = false, error = "No valid file provided" });

        var category = MapUploadCategory(type);
        await using var stream = file.OpenReadStream();
        var (upload, error) = await _fileUploadService.UploadAsync(
            stream,
            file.FileName,
            file.ContentType,
            file.Length,
            userId.Value,
            tenantId.Value,
            category,
            null,
            "upload");

        if (error is not null) return UnprocessableEntity(new { success = false, error });

        var url = _fileUploadService.GetDownloadUrl(upload!);
        var payload = MapUploadedAsset(upload!, url);
        return Created(url, new { success = true, data = payload });
    }

    [HttpGet("api/v2/upload/list")]
    [Authorize]
    public async Task<IActionResult> UploadList()
    {
        var tenantId = User.GetTenantId();
        if (tenantId is null) return Unauthorized(new { success = false, error = "Invalid token" });

        var images = await _db.FileUploads
            .Where(f => f.TenantId == tenantId.Value && f.ContentType.StartsWith("image/"))
            .OrderByDescending(f => f.CreatedAt)
            .Take(100)
            .Select(f => new
            {
                url = $"/api/files/{f.Id}/download",
                path = f.FilePath,
                name = f.OriginalFilename
            })
            .ToListAsync();

        return Ok(new { success = true, data = new { images } });
    }

    private async Task<RegionalAnalyticsSubscription?> ResolveRegionalAnalyticsSubscriptionAsync(string? queryToken)
    {
        var token = queryToken;
        var auth = Request.Headers.Authorization.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(token) && auth?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true)
        {
            token = auth["Bearer ".Length..].Trim();
        }

        if (string.IsNullOrWhiteSpace(token)) return null;

        var hash = Sha256Hex(token);
        return await _db.RegionalAnalyticsSubscriptions
            .FirstOrDefaultAsync(s => s.SubscriptionTokenHash == hash || s.SubscriptionToken == token);
    }

    private async Task LogPartnerAnalyticsAccessAsync(RegionalAnalyticsSubscription subscription, string endpoint)
    {
        _db.RegionalAnalyticsAccessLogs.Add(new RegionalAnalyticsAccessLog
        {
            TenantId = subscription.TenantId,
            SubscriptionId = subscription.Id,
            AccessedEndpoint = endpoint,
            AccessedAt = DateTime.UtcNow,
            IpHash = Sha256Hex(HttpContext.Connection.RemoteIpAddress?.ToString() ?? string.Empty),
            UserAgent = Request.Headers.UserAgent.ToString()
        });
        await _db.SaveChangesAsync();
    }

    private static object Error(string code, string message) => new
    {
        success = false,
        error = code,
        message
    };

    private static bool IsActiveSubscription(RegionalAnalyticsSubscription subscription)
        => subscription.Status.Equals("active", StringComparison.OrdinalIgnoreCase)
            || subscription.Status.Equals("trialing", StringComparison.OrdinalIgnoreCase);

    private static byte[] BuildRegionalAnalyticsPdf(RegionalAnalyticsReport report, RegionalAnalyticsSubscription subscription)
    {
        var lines = RenderRegionalAnalyticsReportLines(report, subscription);
        var textOps = string.Join("", lines.Select(line => $"({EscapePdfText(line)}) Tj T* \n"));
        var stream = $"BT\n/F1 9 Tf\n50 760 Td\n12 TL\n{textOps}ET";
        var streamLength = Encoding.UTF8.GetByteCount(stream);

        var objects = new Dictionary<int, string>
        {
            [1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
            [2] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
            [3] = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj",
            [4] = $"4 0 obj\n<< /Length {streamLength} >>\nstream\n{stream}\nendstream\nendobj",
            [5] = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj"
        };

        var pdf = new StringBuilder("%PDF-1.4\n");
        var offsets = new Dictionary<int, int>();
        foreach (var (number, body) in objects)
        {
            offsets[number] = Encoding.UTF8.GetByteCount(pdf.ToString());
            pdf.Append(body).Append('\n');
        }

        var xrefOffset = Encoding.UTF8.GetByteCount(pdf.ToString());
        pdf.Append("xref\n0 ").Append(objects.Count + 1).Append('\n');
        pdf.Append("0000000000 65535 f \n");
        for (var i = 1; i <= objects.Count; i++)
        {
            pdf.AppendFormat("{0:0000000000} 00000 n \n", offsets[i]);
        }

        pdf.Append("trailer\n<< /Size ").Append(objects.Count + 1).Append(" /Root 1 0 R >>\n");
        pdf.Append("startxref\n").Append(xrefOffset).Append("\n%%EOF");
        return Encoding.UTF8.GetBytes(pdf.ToString());
    }

    private static List<string> RenderRegionalAnalyticsReportLines(RegionalAnalyticsReport report, RegionalAnalyticsSubscription subscription)
    {
        var lines = new List<string>
        {
            "PROJECT NEXUS - REGIONAL ANALYTICS REPORT",
            $"Partner: {SanitizePdfText(subscription.PartnerName)}",
            $"Plan: {SanitizePdfText(subscription.PlanTier)}",
            $"Report type: {SanitizePdfText(report.ReportType)}",
            $"Period: {report.PeriodStart:yyyy-MM-dd} to {report.PeriodEnd:yyyy-MM-dd}",
            $"Generated: {(report.GeneratedAt ?? report.CreatedAt):O}",
            new string('=', 70),
            ""
        };

        if (string.IsNullOrWhiteSpace(report.PayloadJson))
        {
            lines.Add("Summary");
            lines.Add("  Report metadata is ready for partner download.");
            lines.Add("  Detailed bucketed metrics were not attached to this compatibility row.");
            lines.Add("");
        }
        else
        {
            AddPayloadSummaryLines(lines, report.PayloadJson);
        }

        lines.Add(new string('-', 70));
        lines.Add("PRIVACY: All values in regional analytics reports are aggregate or bucketed.");
        lines.Add("No individual user data appears in this report.");
        return lines;
    }

    private static void AddPayloadSummaryLines(List<string> lines, string payloadJson)
    {
        try
        {
            using var document = JsonDocument.Parse(payloadJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                lines.Add("Payload summary: non-object payload attached.");
                lines.Add("");
                return;
            }

            foreach (var section in document.RootElement.EnumerateObject().Take(8))
            {
                lines.Add(SanitizePdfText(section.Name));
                AddJsonValueLines(lines, section.Value, 1);
                lines.Add("");
            }
        }
        catch (JsonException)
        {
            lines.Add("Payload summary could not be parsed.");
            lines.Add("");
        }
    }

    private static void AddJsonValueLines(List<string> lines, JsonElement value, int depth)
    {
        var indent = new string(' ', depth * 2);
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in value.EnumerateObject().Take(12))
                {
                    if (property.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                    {
                        lines.Add($"{indent}{SanitizePdfText(property.Name)}:");
                        AddJsonValueLines(lines, property.Value, depth + 1);
                    }
                    else
                    {
                        lines.Add($"{indent}{SanitizePdfText(property.Name)}: {SanitizePdfText(JsonScalarText(property.Value))}");
                    }
                }
                break;
            case JsonValueKind.Array:
                lines.Add($"{indent}items: {value.GetArrayLength()}");
                foreach (var item in value.EnumerateArray().Take(5))
                {
                    AddJsonValueLines(lines, item, depth + 1);
                }
                break;
            default:
                lines.Add($"{indent}{SanitizePdfText(JsonScalarText(value))}");
                break;
        }
    }

    private static string JsonScalarText(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        _ => value.GetRawText()
    };

    private static string EscapePdfText(string value)
        => SanitizePdfText(value).Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("(", "\\(", StringComparison.Ordinal)
            .Replace(")", "\\)", StringComparison.Ordinal);

    private static string SanitizePdfText(string? value)
        => string.IsNullOrWhiteSpace(value)
            ? "-"
            : new string(value.Select(ch => ch is >= ' ' and <= '~' ? ch : '-').ToArray());

    private static string NormalizePartnerAnalyticsPeriod(string? period)
        => period is "last_90d" or "last_year" or "last_12m" ? period : "last_30d";

    private static IReadOnlyList<string> ParseStringList(string? raw)
        => string.IsNullOrWhiteSpace(raw)
            ? Array.Empty<string>()
            : raw.Trim('[', ']', '"').Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static FileCategory MapUploadCategory(string? type)
    {
        return type?.ToLowerInvariant() switch
        {
            "avatar" => FileCategory.Avatar,
            "cover" => FileCategory.Group,
            "listing" => FileCategory.Listing,
            "post" => FileCategory.Message,
            _ => FileCategory.Listing
        };
    }

    private object MapUploadedAsset(FileUpload upload, string url)
    {
        return new
        {
            url,
            path = upload.FilePath,
            name = upload.OriginalFilename,
            content_type = upload.ContentType,
            size = upload.FileSizeBytes
        };
    }

    private static string Sha256Hex(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
