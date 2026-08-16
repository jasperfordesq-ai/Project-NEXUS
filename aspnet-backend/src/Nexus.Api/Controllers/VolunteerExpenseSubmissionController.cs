// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Submitting a volunteering expense claim (R-27 follow-up).
///
/// 🔴 What was here before. The expense LIST already read the real store
/// (<c>volunteer_expenses</c>), but the submit handler wrote the claim as an
/// opaque blob into tenant config under <c>compat:vol-expense:</c> — so a
/// volunteer submitted a claim, was told "Expense submitted", and their own list
/// stayed empty while no reviewer ever saw it.
///
/// 🔴 It could not have worked even as written: the handler took
/// <c>[FromBody] object?</c> while the screen sends <b>multipart form data</b>
/// with a receipt file, so the body never bound. A stub that cannot bind its own
/// request is a good reminder that "the route exists" proves nothing.
///
/// The claim is created <b>Submitted</b>, never approved: approval is a
/// reviewer's decision, and money moves on the back of it.
/// </summary>
[ApiController]
[Authorize]
public class VolunteerExpenseSubmissionController : ControllerBase
{
    /// <summary>A guard against a typo reaching a reimbursement queue.</summary>
    private const decimal MaximumAmount = 100_000m;

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly FileUploadService _fileService;

    public VolunteerExpenseSubmissionController(
        NexusDbContext db,
        TenantContext tenantContext,
        FileUploadService fileService)
    {
        _db = db;
        _tenantContext = tenantContext;
        _fileService = fileService;
    }

    /// <summary>POST /api/v2/volunteering/expenses — submit a claim.</summary>
    [HttpPost("api/v2/volunteering/expenses")]
    [HttpPost("api/volunteering/expenses")]
    public async Task<IActionResult> Submit(
        [FromForm] decimal? amount,
        [FromForm] string? description,
        [FromForm(Name = "expense_type")] string? expenseType,
        [FromForm] string? currency,
        [FromForm(Name = "organization_id")] int? organizationId,
        [FromForm(Name = "shift_id")] int? shiftId,
        IFormFile? receipt = null)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        if (amount is null || amount <= 0)
        {
            return BadRequest(new { error = "amount must be greater than zero", code = "VALIDATION_ERROR" });
        }

        if (amount > MaximumAmount)
        {
            return BadRequest(new { error = $"amount must be {MaximumAmount:N0} or less", code = "VALIDATION_ERROR" });
        }

        if (string.IsNullOrWhiteSpace(description))
        {
            return BadRequest(new
            {
                error = "description is required",
                code = "VALIDATION_ERROR",
            });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        string? receiptUrl = null;
        if (receipt is not null && receipt.Length > 0)
        {
            var (upload, error) = await _fileService.UploadAsync(
                receipt.OpenReadStream(), receipt.FileName, receipt.ContentType, receipt.Length,
                userId.Value, tenantId, FileCategory.Document);
            if (error != null) return BadRequest(new { error });
            receiptUrl = upload is null ? null : _fileService.GetDownloadUrl(upload);
        }

        var expense = new VolunteerExpense
        {
            TenantId = tenantId,
            UserId = userId.Value,
            ShiftId = shiftId,
            Amount = decimal.Round(amount.Value, 2, MidpointRounding.AwayFromZero),
            Currency = string.IsNullOrWhiteSpace(currency) ? "EUR" : currency.Trim().ToUpperInvariant(),
            Category = string.IsNullOrWhiteSpace(expenseType) ? "travel" : expenseType.Trim().ToLowerInvariant(),
            Description = description.Trim(),
            ReceiptUrl = receiptUrl,

            // 🔴 Submitted, never Approved. Approval is a reviewer's decision and
            // money moves on the back of it.
            Status = VolunteerExpenseStatus.Submitted,
            CreatedAt = DateTime.UtcNow,
        };

        _db.Set<VolunteerExpense>().Add(expense);
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        _ = organizationId; // accepted by the client's form; not modelled on this entity

        return Ok(new
        {
            success = true,
            data = new
            {
                id = expense.Id,
                status = expense.Status.ToString().ToLowerInvariant(),
                amount = expense.Amount,
            },
        });
    }
}
