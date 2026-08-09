// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/sales")]
[Route("api/v2/sales")]
public class SalesOrderController : ControllerBase
{
    private const string RecipientEmail = "jasper.ford.esq@gmail.com";
    private readonly IEmailService _emailService;

    public SalesOrderController(IEmailService emailService)
    {
        _emailService = emailService;
    }

    [HttpPost("orders")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    public async Task<IActionResult> Submit([FromBody] SalesOrderRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.Website))
            return Received(GenerateReference());

        var errors = Validate(request);
        if (errors.Count > 0)
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors });

        var reference = GenerateReference();
        var sent = await _emailService.SendEmailAsync(
            RecipientEmail,
            BuildSubject(request, reference),
            RenderOrderEmail(request, reference),
            null,
            HttpContext.RequestAborted);

        if (!sent)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                errors = new[]
                {
                    new
                    {
                        code = "SALES_ORDER_SEND_FAILED",
                        message = "We could not send the order enquiry. Please try again or email jasper.ford.esq@gmail.com."
                    }
                }
            });
        }

        return Received(reference);
    }

    private ObjectResult Received(string reference)
        => StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                status = "received",
                reference,
                message = "Your Project NEXUS order enquiry has been received."
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}".TrimEnd('/') }
        });

    private static List<object> Validate(SalesOrderRequest request)
    {
        var errors = new List<object>();

        RequireString(errors, request.ContactName, "contact_name", min: 2, max: 160);
        MaxString(errors, request.Organisation, "organisation", 180);
        RequireEmail(errors, request.Email, "email", 255);
        MaxString(errors, request.Region, "region", 160);
        MaxString(errors, request.Note, "note", 5000);
        MaxString(errors, request.PageUrl, "page_url", 2048);

        if (request.Quote == null)
        {
            AddError(errors, "quote", "The quote field is required.");
            return errors;
        }

        RequireString(errors, request.Quote.ProductLineLabel, "quote.product_line_label", max: 120);
        RequireString(errors, request.Quote.PlanName, "quote.plan_name", max: 120);
        RequireString(errors, request.Quote.ActiveMemberLabel, "quote.active_member_label", max: 160);
        RequireOneOf(errors, request.Quote.BillingCycle, "quote.billing_cycle", "monthly", "annual");
        RequireOneOf(errors, request.Quote.PricingMode, "quote.pricing_mode", "published", "custom");
        RequireString(errors, request.Quote.MonthlyRecurringLabel, "quote.monthly_recurring_label", max: 80);
        RequireString(errors, request.Quote.AnnualRecurringLabel, "quote.annual_recurring_label", max: 80);
        RequireString(errors, request.Quote.AnnualSavingsLabel, "quote.annual_savings_label", max: 80);
        RequireString(errors, request.Quote.OneOffLabel, "quote.one_off_label", max: 80);
        RequireString(errors, request.Quote.FirstYearLabel, "quote.first_year_label", max: 80);

        if (request.Quote.LineItems.Count > 60)
            AddError(errors, "quote.line_items", "The quote.line_items field must not have more than 60 items.");

        for (var i = 0; i < request.Quote.LineItems.Count; i++)
        {
            var item = request.Quote.LineItems[i];
            RequireString(errors, item.Label, $"quote.line_items.{i}.label", max: 180);
            RequireString(errors, item.AmountLabel, $"quote.line_items.{i}.amount_label", max: 80);
            if (item.Quantity is < 1 or > 999)
                AddError(errors, $"quote.line_items.{i}.quantity", $"The quote.line_items.{i}.quantity field must be between 1 and 999.");
            RequireOneOf(errors, item.Cadence, $"quote.line_items.{i}.cadence", "monthly", "one-off");
        }

        return errors;
    }

    private static void RequireString(List<object> errors, string? value, string field, int min = 1, int max = int.MaxValue)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            AddError(errors, field, $"The {field} field is required.");
            return;
        }

        var length = value.Trim().Length;
        if (length < min)
            AddError(errors, field, $"The {field} field must be at least {min} characters.");
        if (length > max)
            AddError(errors, field, $"The {field} field must not be greater than {max} characters.");
    }

    private static void MaxString(List<object> errors, string? value, string field, int max)
    {
        if (value != null && value.Length > max)
            AddError(errors, field, $"The {field} field must not be greater than {max} characters.");
    }

    private static void RequireEmail(List<object> errors, string? value, string field, int max)
    {
        RequireString(errors, value, field, max: max);
        if (string.IsNullOrWhiteSpace(value))
            return;

        try
        {
            _ = new MailAddress(value);
        }
        catch (FormatException)
        {
            AddError(errors, field, $"The {field} field must be a valid email address.");
        }
    }

    private static void RequireOneOf(List<object> errors, string? value, string field, params string[] allowed)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            AddError(errors, field, $"The {field} field is required.");
            return;
        }

        if (!allowed.Contains(value, StringComparer.Ordinal))
            AddError(errors, field, $"The selected {field} is invalid.");
    }

    private static void AddError(List<object> errors, string field, string message)
        => errors.Add(new { code = "VALIDATION_FAILED", message, field });

    private static string BuildSubject(SalesOrderRequest request, string reference)
    {
        var name = !string.IsNullOrWhiteSpace(request.Organisation)
            ? request.Organisation!.Trim()
            : request.ContactName.Trim();
        var plan = request.Quote?.PlanName ?? "Project NEXUS";
        var subject = $"Project NEXUS order enquiry {reference} - {name} - {plan}";
        return subject.Length <= 180 ? subject : subject[..180];
    }

    private string RenderOrderEmail(SalesOrderRequest request, string reference)
    {
        var quote = request.Quote!;
        var rows = new[]
        {
            ("Reference", reference),
            ("Submitted at", DateTime.UtcNow.ToString("u")),
            ("Contact", request.ContactName),
            ("Organisation", request.Organisation ?? ""),
            ("Email", request.Email),
            ("Region", request.Region ?? ""),
            ("Product line", quote.ProductLineLabel),
            ("Recommended plan", quote.PlanName),
            ("Capacity", quote.ActiveMemberLabel),
            ("Billing preference", quote.BillingCycle),
            ("Pricing mode", quote.PricingMode),
            ("Monthly recurring", quote.MonthlyRecurringLabel),
            ("Annual recurring", quote.AnnualRecurringLabel),
            ("Annual saving", quote.AnnualSavingsLabel),
            ("One-off total", quote.OneOffLabel),
            ("First-year estimate", quote.FirstYearLabel),
            ("Page URL", request.PageUrl ?? ""),
            ("IP", HttpContext.Connection.RemoteIpAddress?.ToString() ?? ""),
            ("User agent", Request.Headers.UserAgent.ToString())
        };

        var summaryRows = string.Join("", rows.Select(row =>
            $"<tr><th style=\"text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#475569;width:220px;\">{Esc(row.Item1)}</th><td style=\"padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#0f172a;\">{Esc(string.IsNullOrWhiteSpace(row.Item2) ? "-" : row.Item2)}</td></tr>"));

        var lineRows = quote.LineItems.Count == 0
            ? "<tr><td colspan=\"4\" style=\"padding:10px 12px;color:#64748b;\">No paid line items selected.</td></tr>"
            : string.Join("", quote.LineItems.Select(item =>
                $"<tr><td style=\"padding:10px 12px;border-bottom:1px solid #e5e7eb;\">{Esc(item.Label)}</td><td style=\"padding:10px 12px;border-bottom:1px solid #e5e7eb;\">{Esc(item.Cadence)}</td><td style=\"padding:10px 12px;border-bottom:1px solid #e5e7eb;\">{Math.Max(1, item.Quantity ?? 1)}</td><td style=\"padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;\">{Esc(item.AmountLabel)}</td></tr>"));

        return "<!doctype html><html><body style=\"margin:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a;\">"
            + "<div style=\"max-width:760px;margin:0 auto;padding:28px;\">"
            + "<div style=\"background:#0b1220;color:#fff;border-radius:16px;padding:24px 28px;margin-bottom:20px;\">"
            + "<p style=\"margin:0 0 8px;color:#38bdf8;font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;\">Project NEXUS sales order enquiry</p>"
            + $"<h1 style=\"margin:0;font-size:28px;line-height:1.15;\">{Esc(reference)}</h1>"
            + "<p style=\"margin:12px 0 0;color:#cbd5e1;\">A new pricing/order enquiry was submitted from the sales site.</p>"
            + "</div>"
            + "<div style=\"background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;margin-bottom:20px;\">"
            + $"<table role=\"presentation\" style=\"width:100%;border-collapse:collapse;\">{summaryRows}</table>"
            + "</div>"
            + "<div style=\"background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;margin-bottom:20px;\">"
            + "<div style=\"padding:16px 18px;border-bottom:1px solid #e5e7eb;\"><strong>Selected quote line items</strong></div>"
            + "<table role=\"presentation\" style=\"width:100%;border-collapse:collapse;\">"
            + "<thead><tr><th style=\"text-align:left;padding:10px 12px;background:#f1f5f9;\">Item</th><th style=\"text-align:left;padding:10px 12px;background:#f1f5f9;\">Cadence</th><th style=\"text-align:left;padding:10px 12px;background:#f1f5f9;\">Qty</th><th style=\"text-align:left;padding:10px 12px;background:#f1f5f9;\">Amount</th></tr></thead>"
            + $"<tbody>{lineRows}</tbody></table></div>"
            + "<div style=\"background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;\">"
            + $"<strong>Notes</strong><p style=\"white-space:pre-wrap;line-height:1.6;color:#334155;\">{Esc(string.IsNullOrWhiteSpace(request.Note) ? "No extra notes added." : request.Note)}</p>"
            + "</div></div></body></html>";
    }

    private static string GenerateReference()
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        Span<byte> bytes = stackalloc byte[6];
        RandomNumberGenerator.Fill(bytes);
        var suffix = new string(bytes.ToArray().Select(value => alphabet[value % alphabet.Length]).ToArray());
        return $"NXSO-{DateTime.UtcNow:yyMMdd}-{suffix}";
    }

    private static string Esc(string? value)
        => HtmlEncoder.Default.Encode(value ?? "");
}

public sealed class SalesOrderRequest
{
    [JsonPropertyName("website")]
    public string? Website { get; init; }

    [JsonPropertyName("contact_name")]
    public string ContactName { get; init; } = "";

    [JsonPropertyName("organisation")]
    public string? Organisation { get; init; }

    [JsonPropertyName("email")]
    public string Email { get; init; } = "";

    [JsonPropertyName("region")]
    public string? Region { get; init; }

    [JsonPropertyName("note")]
    public string? Note { get; init; }

    [JsonPropertyName("page_url")]
    public string? PageUrl { get; init; }

    [JsonPropertyName("quote")]
    public SalesOrderQuoteRequest? Quote { get; init; }
}

public sealed class SalesOrderQuoteRequest
{
    [JsonPropertyName("product_line_label")]
    public string ProductLineLabel { get; init; } = "";

    [JsonPropertyName("plan_name")]
    public string PlanName { get; init; } = "";

    [JsonPropertyName("active_member_label")]
    public string ActiveMemberLabel { get; init; } = "";

    [JsonPropertyName("billing_cycle")]
    public string BillingCycle { get; init; } = "";

    [JsonPropertyName("pricing_mode")]
    public string PricingMode { get; init; } = "";

    [JsonPropertyName("monthly_recurring_label")]
    public string MonthlyRecurringLabel { get; init; } = "";

    [JsonPropertyName("annual_recurring_label")]
    public string AnnualRecurringLabel { get; init; } = "";

    [JsonPropertyName("annual_savings_label")]
    public string AnnualSavingsLabel { get; init; } = "";

    [JsonPropertyName("one_off_label")]
    public string OneOffLabel { get; init; } = "";

    [JsonPropertyName("first_year_label")]
    public string FirstYearLabel { get; init; } = "";

    [JsonPropertyName("line_items")]
    public List<SalesOrderLineItemRequest> LineItems { get; init; } = new();
}

public sealed class SalesOrderLineItemRequest
{
    [JsonPropertyName("label")]
    public string Label { get; init; } = "";

    [JsonPropertyName("amount_label")]
    public string AmountLabel { get; init; } = "";

    [JsonPropertyName("quantity")]
    public int? Quantity { get; init; }

    [JsonPropertyName("cadence")]
    public string Cadence { get; init; } = "";
}
