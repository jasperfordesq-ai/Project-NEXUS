// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Receives HMAC-SHA256 signed webhook events from the PHP platform
/// for volunteering, safeguarding, training, and expense events.
/// Uses HMAC authentication instead of JWT - endpoints are [AllowAnonymous].
/// </summary>
[ApiController]
[Route("api/webhooks/volunteering")]
[AllowAnonymous]
public class VolunteerWebhookController : ControllerBase
{
    private readonly VolunteerWebhookService _webhookService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<VolunteerWebhookController> _logger;

    public VolunteerWebhookController(
        VolunteerWebhookService webhookService,
        TenantContext tenantContext,
        ILogger<VolunteerWebhookController> logger)
    {
        _webhookService = webhookService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Receives a webhook event from the PHP platform.
    /// Validates HMAC-SHA256 signature, extracts tenant context, and processes the event.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> ReceiveWebhook()
    {
        // Read raw body for HMAC validation (must read before model binding consumes the stream)
        Request.EnableBuffering();
        using var reader = new StreamReader(Request.Body);
        var rawBody = await reader.ReadToEndAsync();

        if (string.IsNullOrWhiteSpace(rawBody))
        {
            return BadRequest(new { error = "Empty request body" });
        }

        // Validate HMAC signature
        var signature = Request.Headers["X-Nexus-Signature"].FirstOrDefault();
        if (!_webhookService.ValidateSignature(rawBody, signature))
        {
            _logger.LogWarning("Webhook received with invalid HMAC signature");
            return Unauthorized(new { error = "Invalid signature" });
        }

        // Parse the envelope
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(rawBody);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Webhook received with invalid JSON body");
            return BadRequest(new { error = "Invalid JSON payload" });
        }

        using (doc)
        {
            var root = doc.RootElement;

            // Extract required fields from envelope
            if (!root.TryGetProperty("event", out var eventProp) ||
                !root.TryGetProperty("tenant_id", out var tenantIdProp) ||
                !root.TryGetProperty("payload", out var payloadProp))
            {
                return BadRequest(new { error = "Missing required fields: event, tenant_id, payload" });
            }

            var eventType = eventProp.GetString();
            if (string.IsNullOrEmpty(eventType))
            {
                return BadRequest(new { error = "Event type cannot be empty" });
            }

            int tenantId;
            try
            {
                tenantId = tenantIdProp.GetInt32();
            }
            catch
            {
                return BadRequest(new { error = "tenant_id must be an integer" });
            }

            // Set tenant context manually (no JWT in webhook requests)
            _tenantContext.SetTenant(tenantId);

            // External event id for idempotent dedup. The PHP staging platform
            // sends X-Nexus-Webhook-Id on outbound deliveries (verified in
            // AdminFederationWebhooksController.php). Fall back to a generic
            // X-Webhook-Event-Id header if the PHP-specific one is absent.
            var externalEventId = Request.Headers["X-Nexus-Webhook-Id"].FirstOrDefault()
                ?? Request.Headers["X-Webhook-Event-Id"].FirstOrDefault();

            // Process the event
            var (success, error) = await _webhookService.ProcessEventAsync(eventType, payloadProp, externalEventId);

            if (!success)
            {
                _logger.LogError("Webhook processing failed for {EventType}: {Error}", eventType, error);
                return StatusCode(500, new { error = $"Processing failed: {error}" });
            }

            return Ok(new { status = "processed", @event = eventType });
        }
    }
}
