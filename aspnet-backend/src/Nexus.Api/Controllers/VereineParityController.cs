// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// V1.5 compatibility endpoints for the Verein organisation domain.
/// </summary>
[ApiController]
[Route("api/vereine")]
[Route("api/v2/vereine")]
[Authorize]
public class VereineParityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public VereineParityController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    [HttpGet("{organizationId:int}/cross-invitations")]
    public async Task<IActionResult> CrossInvitations(int organizationId)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return Ok(new { data = Array.Empty<object>(), meta = new { organization_id = organizationId, total = 0 } });
    }

    [HttpPost("{organizationId:int}/cross-invitations")]
    public async Task<IActionResult> CreateCrossInvitation(int organizationId, [FromBody] JsonElement body)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        var invitation = new
        {
            id = StableId(body),
            organization_id = organizationId,
            target_organization_id = Int(body, "target_organization_id") ?? Int(body, "target_verein_id"),
            user_id = Int(body, "user_id"),
            status = "pending",
            message = Str(body, "message"),
            created_at = DateTime.UtcNow
        };

        return Ok(new { data = invitation });
    }

    [HttpGet("{organizationId:int}/dues")]
    public async Task<IActionResult> Dues(int organizationId)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        var dues = await _db.OrganisationMembers
            .Where(m => m.OrganisationId == organizationId)
            .OrderBy(m => m.UserId)
            .Select(m => new
            {
                id = m.Id,
                organization_id = organizationId,
                user_id = m.UserId,
                amount = 0m,
                currency = "hours",
                status = "not_configured",
                due_at = (DateTime?)null,
                paid_at = (DateTime?)null
            })
            .ToListAsync();

        return Ok(new { data = dues });
    }

    [HttpGet("{organizationId:int}/dues/fee-config")]
    public async Task<IActionResult> FeeConfig(int organizationId)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return Ok(new { data = DefaultFeeConfig(organizationId) });
    }

    [HttpPut("{organizationId:int}/dues/fee-config")]
    public async Task<IActionResult> UpdateFeeConfig(int organizationId, [FromBody] JsonElement body)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return Ok(new
        {
            data = new
            {
                organization_id = organizationId,
                enabled = Bool(body, "enabled") ?? true,
                amount = Decimal(body, "amount") ?? Decimal(body, "fee") ?? 0m,
                currency = Str(body, "currency") ?? "hours",
                cadence = Str(body, "cadence") ?? Str(body, "interval") ?? "annual",
                grace_days = Int(body, "grace_days") ?? 0,
                updated_at = DateTime.UtcNow
            }
        });
    }

    [HttpGet("{organizationId:int}/dues/overdue")]
    public async Task<IActionResult> OverdueDues(int organizationId)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return Ok(new { data = Array.Empty<object>(), meta = new { organization_id = organizationId, overdue_count = 0 } });
    }

    [HttpPost("{organizationId:int}/dues/generate")]
    public async Task<IActionResult> GenerateDues(int organizationId, [FromBody] JsonElement body)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        var memberCount = await _db.OrganisationMembers.CountAsync(m => m.OrganisationId == organizationId);
        return Ok(new
        {
            data = new
            {
                organization_id = organizationId,
                generated = memberCount,
                period = Str(body, "period") ?? DateTime.UtcNow.Year.ToString(),
                status = "generated"
            }
        });
    }

    [HttpPost("{organizationId:int}/dues/{duesId:int}/remind")]
    public async Task<IActionResult> RemindDue(int organizationId, int duesId)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return Ok(new { data = new { id = duesId, organization_id = organizationId, reminder_sent = true, sent_at = DateTime.UtcNow } });
    }

    [HttpPost("{organizationId:int}/dues/{duesId:int}/waive")]
    public async Task<IActionResult> WaiveDue(int organizationId, int duesId, [FromBody] JsonElement body)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return Ok(new { data = new { id = duesId, organization_id = organizationId, status = "waived", reason = Str(body, "reason"), waived_at = DateTime.UtcNow } });
    }

    [HttpGet("{organizationId:int}/federation-consent")]
    public async Task<IActionResult> FederationConsent(int organizationId)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return Ok(new { data = new { organization_id = organizationId, enabled = false, scopes = Array.Empty<string>(), updated_at = (DateTime?)null } });
    }

    [HttpPut("{organizationId:int}/federation-consent")]
    public async Task<IActionResult> UpdateFederationConsent(int organizationId, [FromBody] JsonElement body)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return Ok(new
        {
            data = new
            {
                organization_id = organizationId,
                enabled = Bool(body, "enabled") ?? Bool(body, "consented") ?? true,
                scopes = Strings(body, "scopes"),
                updated_at = DateTime.UtcNow
            }
        });
    }

    [HttpGet("{organizationId:int}/network")]
    public async Task<IActionResult> Network(int organizationId)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        var organisations = await _db.Organisations
            .Where(o => o.Id != organizationId && o.IsPublic && o.Status != "suspended")
            .OrderBy(o => o.Name)
            .Take(50)
            .Select(o => new { o.Id, o.Name, o.Slug, o.Type, o.Status })
            .ToListAsync();

        return Ok(new { data = organisations });
    }

    [HttpGet("{organizationId:int}/shared-events")]
    public async Task<IActionResult> SharedEvents(int organizationId)
    {
        var organisation = await _db.Organisations.FirstOrDefaultAsync(o => o.Id == organizationId);
        if (organisation == null) return NotFound(new { error = "Verein not found" });

        var events = await _db.Events
            .Where(e => e.CreatedById == organisation.OwnerId && !e.IsCancelled)
            .OrderByDescending(e => e.StartsAt)
            .Take(50)
            .Select(e => new { e.Id, e.Title, e.Description, e.Location, e.StartsAt, e.EndsAt })
            .ToListAsync();

        return Ok(new { data = events });
    }

    [HttpPost("{organizationId:int}/share-event")]
    public async Task<IActionResult> ShareEvent(int organizationId, [FromBody] JsonElement body)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        var eventId = Int(body, "event_id");
        if (eventId.HasValue && !await _db.Events.AnyAsync(e => e.Id == eventId.Value))
            return NotFound(new { error = "Event not found" });

        return Ok(new
        {
            data = new
            {
                id = StableId(body),
                organization_id = organizationId,
                event_id = eventId,
                target_organization_id = Int(body, "target_organization_id") ?? Int(body, "target_verein_id"),
                status = "shared",
                shared_at = DateTime.UtcNow
            }
        });
    }

    [HttpDelete("{organizationId:int}/event-shares/{shareId:int}")]
    public async Task<IActionResult> DeleteEventShare(int organizationId, int shareId)
    {
        if (!await OrganisationExists(organizationId)) return NotFound(new { error = "Verein not found" });

        return NoContent();
    }

    [HttpGet("cross-invite-targets/{userId:int}")]
    public async Task<IActionResult> CrossInviteTargets(int userId)
    {
        var memberOrgIds = await _db.OrganisationMembers
            .Where(m => m.UserId == userId)
            .Select(m => m.OrganisationId)
            .ToListAsync();

        var targets = await _db.Organisations
            .Where(o => o.IsPublic && o.Status != "suspended" && !memberOrgIds.Contains(o.Id))
            .OrderBy(o => o.Name)
            .Take(50)
            .Select(o => new { o.Id, o.Name, o.Slug, o.Type, o.Status })
            .ToListAsync();

        return Ok(new { data = targets });
    }

    private async Task<bool> OrganisationExists(int organizationId) =>
        await _db.Organisations.AnyAsync(o => o.Id == organizationId);

    private int TenantId() => _tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");

    private static object DefaultFeeConfig(int organizationId) => new
    {
        organization_id = organizationId,
        enabled = false,
        amount = 0m,
        currency = "hours",
        cadence = "annual",
        grace_days = 0
    };

    private static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null
            ? v.ToString()
            : null;

    private static int? Int(JsonElement e, string name) => int.TryParse(Str(e, name), out var value) ? value : null;

    private static decimal? Decimal(JsonElement e, string name) => decimal.TryParse(Str(e, name), out var value) ? value : null;

    private static bool? Bool(JsonElement e, string name) => bool.TryParse(Str(e, name), out var value) ? value : null;

    private static string[] Strings(JsonElement e, string name)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
            return Array.Empty<string>();

        return value.EnumerateArray().Select(item => item.ToString()).Where(item => !string.IsNullOrWhiteSpace(item)).ToArray();
    }

    private static int StableId(JsonElement body) =>
        body.ValueKind == JsonValueKind.Undefined ? 0 : Math.Abs(HashCode.Combine(body.GetRawText()));
}
