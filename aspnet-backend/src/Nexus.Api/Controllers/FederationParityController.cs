// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Controllers;

/// <summary>
/// V1.5 compatibility endpoints for federation protocols and native ingest.
/// </summary>
[ApiController]
[Route("api/federation")]
[Authorize(Policy = "AdminOnly")]
public class FederationParityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public FederationParityController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    [HttpGet("aggregates")]
    public async Task<IActionResult> Aggregates()
    {
        var tenantId = TenantId();
        return Ok(new
        {
            data = new
            {
                tenants = await _db.Tenants.CountAsync(),
                partners = await _db.FederationPartners.CountAsync(p => p.TenantId == tenantId),
                listings = await _db.Listings.CountAsync(l => l.TenantId == tenantId),
                groups = await _db.Groups.CountAsync(g => g.TenantId == tenantId),
                events = await _db.Events.CountAsync(e => e.TenantId == tenantId)
            }
        });
    }

    [HttpGet("groups")]
    public async Task<IActionResult> Groups() => Ok(new { data = await _db.Groups.Where(g => g.TenantId == TenantId()).OrderBy(g => g.Name).Select(g => new { g.Id, g.Name, g.Description }).ToListAsync() });

    [HttpGet("partners/{partnerId:int}")]
    public async Task<IActionResult> Partner(int partnerId)
    {
        var partner = await _db.FederationPartners.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.Id == partnerId);
        return partner == null ? NotFound(new { error = "Partner not found" }) : Ok(new { data = partner });
    }

    [HttpPost("connections/{connectionId:int}/accept")]
    public async Task<IActionResult> AcceptConnection(int connectionId) => await UpdatePartner(connectionId, "Active");

    [HttpPost("connections/{connectionId:int}/reject")]
    public async Task<IActionResult> RejectConnection(int connectionId) => await UpdatePartner(connectionId, "Rejected");

    [HttpDelete("connections/{connectionId:int}")]
    public async Task<IActionResult> DeleteConnection(int connectionId)
    {
        var partner = await _db.FederationPartners.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.Id == connectionId);
        if (partner != null) _db.FederationPartners.Remove(partner);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("members/{memberId:int}/reviews")]
    public async Task<IActionResult> MemberReviews(int memberId)
    {
        var reviews = await _db.Reviews.Where(r => r.TenantId == TenantId() && (r.TargetUserId == memberId || r.ReviewerId == memberId)).ToListAsync();
        return Ok(new { data = reviews });
    }

    [HttpPost("messages")]
    public IActionResult SendFederatedMessage([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPost("messages/{messageId:int}/translate")]
    public IActionResult TranslateMessage(int messageId, [FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPost("messages/mark-read-batch")]
    public IActionResult MarkReadBatch([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPost("transactions")]
    public IActionResult FederationTransaction([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPost("hour-transfer/inbound")]
    public IActionResult InboundHourTransfer([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPost("external/webhooks/receive")]
    public IActionResult ReceiveWebhook([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPost("ingest/connections")]
    public IActionResult IngestConnections([FromBody] JsonElement body) => Ingest("connections", body);

    [HttpPost("ingest/events")]
    public IActionResult IngestEvents([FromBody] JsonElement body) => Ingest("events", body);

    [HttpPost("ingest/groups")]
    public IActionResult IngestGroups([FromBody] JsonElement body) => Ingest("groups", body);

    [HttpPost("ingest/listings")]
    public IActionResult IngestListings([FromBody] JsonElement body) => Ingest("listings", body);

    [HttpPost("ingest/members/sync")]
    public IActionResult IngestMembers([FromBody] JsonElement body) => Ingest("members", body);

    [HttpPost("ingest/reviews")]
    public IActionResult IngestReviews([FromBody] JsonElement body) => Ingest("reviews", body);

    [HttpPost("ingest/volunteering")]
    public IActionResult IngestVolunteering([FromBody] JsonElement body) => Ingest("volunteering", body);

    [HttpGet("cc/about")]
    [AllowAnonymous]
    public IActionResult CreditCommonsAbout() => Ok(new { data = new { name = "Project NEXUS", protocol = "credit-commons", version = "1.0" } });

    [HttpGet("cc/forms")]
    public IActionResult CreditCommonsForms() => Ok(new { data = new[] { new { id = "transfer", fields = new[] { "payer", "payee", "amount", "description" } } } });

    [HttpGet("cc/accounts")]
    public IActionResult CreditCommonsAccounts() => FederationWorkflowUnavailable();

    [HttpGet("cc/account")]
    public IActionResult MyCreditCommonsAccount() => FederationWorkflowUnavailable();

    [HttpGet("cc/account/history")]
    public async Task<IActionResult> MyCreditCommonsHistory() => Ok(new { data = await _db.Transactions.Where(t => t.TenantId == TenantId()).Take(50).ToListAsync() });

    [HttpGet("cc/account/{accountId}")]
    public IActionResult CreditCommonsAccount(string accountId) => FederationWorkflowUnavailable();

    [HttpGet("cc/account/history/{accountId}")]
    public IActionResult CreditCommonsAccountHistory(string accountId) => FederationWorkflowUnavailable();

    [HttpGet("cc/entries")]
    public async Task<IActionResult> CreditCommonsEntries() => Ok(new { data = await _db.Transactions.Where(t => t.TenantId == TenantId()).Take(100).ToListAsync() });

    [HttpGet("cc/entries/{entryId}")]
    public IActionResult CreditCommonsEntry(string entryId) => FederationWorkflowUnavailable();

    [HttpGet("cc/transactions")]
    public IActionResult CreditCommonsTransactions() => FederationWorkflowUnavailable();

    [HttpGet("cc/transaction/{transactionId}")]
    public IActionResult CreditCommonsTransaction(string transactionId) => FederationWorkflowUnavailable();

    [HttpPost("cc/transaction")]
    public IActionResult CreateCreditCommonsTransaction([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPost("cc/transaction/relay")]
    public IActionResult RelayCreditCommonsTransaction([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPatch("cc/transaction/{transactionId}/{verb}")]
    public IActionResult PatchCreditCommonsTransaction(string transactionId, string verb) => FederationWorkflowUnavailable();

    [HttpPost("cc/transactions/propose")]
    public IActionResult ProposeCreditCommonsTransaction([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpPost("cc/transactions/{transactionId}/validate")]
    public IActionResult ValidateCreditCommonsTransaction(string transactionId) => FederationWorkflowUnavailable();

    [HttpPost("cc/transactions/{transactionId}/commit")]
    public IActionResult CommitCreditCommonsTransaction(string transactionId) => FederationWorkflowUnavailable();

    [HttpGet("komunitin/currencies")]
    public IActionResult KomunitinCurrencies() => FederationWorkflowUnavailable();

    [HttpPost("komunitin/currencies")]
    public IActionResult CreateKomunitinCurrency([FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpGet("komunitin/{system}/currency")]
    public IActionResult KomunitinCurrency(string system) => FederationWorkflowUnavailable();

    [HttpPatch("komunitin/{system}/currency")]
    public IActionResult UpdateKomunitinCurrency(string system, [FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpDelete("komunitin/{system}/currency")]
    public IActionResult DeleteKomunitinCurrency(string system) => FederationWorkflowUnavailable();

    [HttpGet("komunitin/{system}/currency/settings")]
    public IActionResult KomunitinCurrencySettings(string system) => FederationWorkflowUnavailable();

    [HttpPatch("komunitin/{system}/currency/settings")]
    public IActionResult UpdateKomunitinCurrencySettings(string system, [FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpGet("komunitin/{system}/accounts")]
    public async Task<IActionResult> KomunitinAccounts(string system) => Ok(new { data = await _db.Users.Where(u => u.TenantId == TenantId()).Select(u => new { id = u.Id, system, name = u.FirstName + " " + u.LastName }).ToListAsync() });

    [HttpPost("komunitin/{system}/accounts")]
    public IActionResult CreateKomunitinAccount(string system, [FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpGet("komunitin/{system}/accounts/{accountId}")]
    public IActionResult KomunitinAccount(string system, string accountId) => FederationWorkflowUnavailable();

    [HttpPatch("komunitin/{system}/accounts/{accountId}")]
    public IActionResult UpdateKomunitinAccount(string system, string accountId, [FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpDelete("komunitin/{system}/accounts/{accountId}")]
    public IActionResult DeleteKomunitinAccount(string system, string accountId) => FederationWorkflowUnavailable();

    [HttpGet("komunitin/{system}/transfers")]
    public IActionResult KomunitinTransfers(string system) => FederationWorkflowUnavailable();

    [HttpPost("komunitin/{system}/transfers")]
    public IActionResult CreateKomunitinTransfer(string system, [FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpGet("komunitin/{system}/transfers/{transferId}")]
    public IActionResult KomunitinTransfer(string system, string transferId) => FederationWorkflowUnavailable();

    [HttpPatch("komunitin/{system}/transfers/{transferId}")]
    public IActionResult UpdateKomunitinTransfer(string system, string transferId, [FromBody] JsonElement body) => FederationWorkflowUnavailable();

    [HttpDelete("komunitin/{system}/transfers/{transferId}")]
    public IActionResult DeleteKomunitinTransfer(string system, string transferId) => FederationWorkflowUnavailable();

    private async Task<IActionResult> UpdatePartner(int id, string status)
    {
        var partner = await _db.FederationPartners.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.Id == id);
        if (partner == null) return NotFound(new { error = "Connection not found" });
        partner.Status = Enum.TryParse<PartnerStatus>(status, true, out var parsed) ? parsed : partner.Status;
        partner.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = partner });
    }

    private IActionResult Ingest(string resource, JsonElement body) => FederationWorkflowUnavailable();

    private ObjectResult FederationWorkflowUnavailable() => StatusCode(StatusCodes.Status503ServiceUnavailable, new
    {
        success = false,
        error = "Federation protocol workflows are unavailable until durable authenticated persistence is implemented.",
        code = "FEDERATION_WORKFLOW_UNAVAILABLE"
    });

    private int TenantId() => _tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");
}
