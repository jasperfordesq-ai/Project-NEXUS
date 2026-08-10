// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin vetting/DBS record management - CRUD, verification, bulk operations.
/// </summary>
[ApiController]
[Route("api/admin/vetting")]
[Authorize(Policy = "AdminOnly")]
public class AdminVettingController : ControllerBase
{
    private readonly VettingService _vetting;
    private readonly TenantContext _tenant;

    public AdminVettingController(VettingService vetting, TenantContext tenant)
    {
        _vetting = vetting;
        _tenant = tenant;
    }

    /// <summary>
    /// GET /api/admin/vetting/records - List all vetting records.
    /// </summary>
    [HttpGet("records")]
    public async Task<IActionResult> ListRecords(
        [FromQuery] int? userId = null,
        [FromQuery] string? status = null,
        [FromQuery] string? type = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var records = await _vetting.GetRecordsAsync(userId, status, type);

        var total = records.Count;
        var paged = records
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToList();

        return Ok(new
        {
            data = paged.Select(r => MapRecord(r)),
            meta = new { page, limit, total }
        });
    }

    /// <summary>
    /// GET /api/admin/vetting/records/{id} - Get record details.
    /// </summary>
    [HttpGet("records/{id:int}")]
    public async Task<IActionResult> GetRecord(int id)
    {
        var record = await _vetting.GetRecordAsync(id);
        if (record == null) return NotFound(new { error = "Record not found" });
        return Ok(new { data = MapRecord(record) });
    }

    /// <summary>
    /// POST /api/admin/vetting/records - Create a vetting record for a user.
    /// </summary>
    [HttpPost("records")]
    public async Task<IActionResult> CreateRecord([FromBody] CreateVettingRecordRequest request)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var (record, error) = await _vetting.CreateRecordAsync(
            tenantId, request.UserId, request.Type, request.ReferenceNumber,
            request.IssuedAt, request.ExpiresAt, request.DocumentUrl);

        if (error != null) return BadRequest(new { error });
        return Created("/api/admin/vetting/records/" + record!.Id,
            new { data = new { record.Id, record.UserId, record.VettingType, record.Status } });
    }

    /// <summary>
    /// PUT /api/admin/vetting/records/{id} - Update a vetting record.
    /// </summary>
    [HttpPut("records/{id:int}")]
    public async Task<IActionResult> UpdateRecord(int id, [FromBody] UpdateVettingRecordRequest request)
    {
        var (record, error) = await _vetting.UpdateRecordAsync(
            id, request.Type, request.ReferenceNumber, request.IssuedAt,
            request.ExpiresAt, request.DocumentUrl, request.Notes);

        if (error != null) return BadRequest(new { error });
        return Ok(new { data = MapRecord(record!) });
    }

    /// <summary>
    /// DELETE /api/admin/vetting/records/{id} - Delete a vetting record.
    /// </summary>
    [HttpDelete("records/{id:int}")]
    public async Task<IActionResult> DeleteRecord(int id)
    {
        var error = await _vetting.DeleteRecordAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { message = "Record deleted" });
    }

    /// <summary>
    /// PUT /api/admin/vetting/records/{id}/verify - Verify a vetting record.
    /// </summary>
    [HttpPut("records/{id:int}/verify")]
    public async Task<IActionResult> VerifyRecord(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (record, error) = await _vetting.VerifyRecordAsync(id, userId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { record!.Id, record.Status, verified_at = record.VerifiedAt } });
    }

    /// <summary>
    /// PUT /api/admin/vetting/records/{id}/reject - Reject a vetting record.
    /// </summary>
    [HttpPut("records/{id:int}/reject")]
    public async Task<IActionResult> RejectRecord(int id, [FromBody] RejectRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (record, error) = await _vetting.RejectRecordAsync(id, userId.Value, request.Notes);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { record!.Id, record.Status, record.Notes } });
    }

    /// <summary>
    /// GET /api/admin/vetting/users/{userId}/records - Get all records for a user.
    /// </summary>
    [HttpGet("users/{userId}/records")]
    public async Task<IActionResult> GetUserRecords(int userId)
    {
        var records = await _vetting.GetUserRecordsAsync(userId);
        return Ok(new { data = records.Select(r => MapRecord(r)), meta = new { total = records.Count } });
    }

    /// <summary>
    /// GET /api/admin/vetting/expiring - Records expiring soon.
    /// </summary>
    [HttpGet("expiring")]
    public async Task<IActionResult> GetExpiringRecords([FromQuery] int days = 30)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var records = await _vetting.GetExpiringRecordsAsync(tenantId, days);
        return Ok(new { data = records.Select(r => MapRecord(r)), meta = new { total = records.Count, days } });
    }

    /// <summary>
    /// GET /api/admin/vetting/stats - Vetting statistics.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var stats = await _vetting.GetStatsAsync();
        return Ok(new { data = stats });
    }

    /// <summary>
    /// GET /api/admin/vetting/types - List valid vetting types.
    /// </summary>
    [HttpGet("types")]
    public IActionResult GetTypes()
    {
        return Ok(new { data = VettingService.ValidVettingTypes });
    }

    /// <summary>
    /// POST /api/admin/vetting/bulk-verify - Verify multiple records at once.
    /// </summary>
    [HttpPost("bulk-verify")]
    public async Task<IActionResult> BulkVerify([FromBody] BulkVerifyRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (request.RecordIds == null || request.RecordIds.Length == 0)
            return BadRequest(new { error = "record_ids is required" });

        var results = await _vetting.BulkVerifyAsync(request.RecordIds, userId.Value);

        var verified = results.Where(r => r.Error == null && r.Record != null).Select(r => r.Record!.Id).ToList();
        var failed = results.Where(r => r.Error != null).Select(r => new { id = r.Record?.Id, error = r.Error }).ToList();

        return Ok(new { data = new { verified_count = verified.Count, verified, failed_count = failed.Count, failed } });
    }

    /// <summary>
    /// GET /api/admin/vetting/pending - Shortcut for status=pending records.
    /// </summary>
    [HttpGet("pending")]
    public async Task<IActionResult> GetPendingRecords()
    {
        var records = await _vetting.GetRecordsAsync(status: "pending");
        return Ok(new { data = records.Select(r => MapRecord(r)), meta = new { total = records.Count } });
    }

    /// <summary>
    /// GET /api/admin/vetting/expired - Records that have expired.
    /// </summary>
    [HttpGet("expired")]
    public async Task<IActionResult> GetExpiredRecords()
    {
        var records = await _vetting.GetExpiredRecordsAsync();
        return Ok(new { data = records.Select(r => MapRecord(r)), meta = new { total = records.Count } });
    }

    /// <summary>
    /// PUT /api/admin/vetting/records/{id}/renew - Renew a record (extend expiry).
    /// </summary>
    [HttpPut("records/{id:int}/renew")]
    public async Task<IActionResult> RenewRecord(int id)
    {
        var (record, error) = await _vetting.RenewRecordAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { record!.Id, record.Status, expires_at = record.ExpiresAt, updated_at = record.UpdatedAt } });
    }

    // --- Mapping helper ---

    private static object MapRecord(Entities.VettingRecord r) => new
    {
        r.Id,
        user_id = r.UserId,
        vetting_type = r.VettingType,
        r.Status,
        reference_number = r.ReferenceNumber,
        issued_at = r.IssuedAt,
        expires_at = r.ExpiresAt,
        document_url = r.DocumentUrl,
        r.Notes,
        verified_by_id = r.VerifiedById,
        verified_at = r.VerifiedAt,
        created_at = r.CreatedAt,
        updated_at = r.UpdatedAt,
        user = r.User != null ? new { r.User.Id, r.User.FirstName, r.User.LastName, r.User.Email } : null,
        verified_by = r.VerifiedBy != null ? new { r.VerifiedBy.Id, r.VerifiedBy.FirstName, r.VerifiedBy.LastName } : null
    };

    // --- Request DTOs ---

    public class CreateVettingRecordRequest
    {
        [JsonPropertyName("user_id")] public int UserId { get; set; }
        [JsonPropertyName("type")] public string Type { get; set; } = "other";
        [JsonPropertyName("reference_number")] public string? ReferenceNumber { get; set; }
        [JsonPropertyName("issued_at")] public DateTime? IssuedAt { get; set; }
        [JsonPropertyName("expires_at")] public DateTime? ExpiresAt { get; set; }
        [JsonPropertyName("document_url")] public string? DocumentUrl { get; set; }
    }

    public class UpdateVettingRecordRequest
    {
        [JsonPropertyName("type")] public string? Type { get; set; }
        [JsonPropertyName("reference_number")] public string? ReferenceNumber { get; set; }
        [JsonPropertyName("issued_at")] public DateTime? IssuedAt { get; set; }
        [JsonPropertyName("expires_at")] public DateTime? ExpiresAt { get; set; }
        [JsonPropertyName("document_url")] public string? DocumentUrl { get; set; }
        [JsonPropertyName("notes")] public string? Notes { get; set; }
    }

    public class RejectRequest
    {
        [JsonPropertyName("notes")] public string? Notes { get; set; }
    }

    public class BulkVerifyRequest
    {
        [JsonPropertyName("record_ids")] public int[] RecordIds { get; set; } = Array.Empty<int>();
    }
}
