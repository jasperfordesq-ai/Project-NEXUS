// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services;

/// <summary>
/// 2026-05-09 — primary/fallback email transport per project owner directive.
///
/// Tries the primary transport (SendGrid) first; on a non-success result or a
/// recoverable exception falls back to the secondary (Gmail SMTP/OAuth2).
/// Both transports already log to <c>EmailLogs</c> in their own
/// implementations, so the deliverability dashboard reflects the mixed
/// transport (status=Sent on whichever path succeeded, status=Failed only if
/// both fail).
///
/// Health check returns true if EITHER transport reports healthy.
/// </summary>
public class FallbackEmailService : IEmailService
{
    private readonly SendGridEmailService _primary;
    private readonly GmailEmailService _fallback;
    private readonly ILogger<FallbackEmailService> _logger;

    public FallbackEmailService(
        SendGridEmailService primary,
        GmailEmailService fallback,
        ILogger<FallbackEmailService> logger)
    {
        _primary = primary;
        _fallback = fallback;
        _logger = logger;
    }

    public async Task<bool> SendEmailAsync(string to, string subject, string htmlBody, string? textBody = null, CancellationToken ct = default)
        => (await SendEmailWithEvidenceAsync(to, subject, htmlBody, textBody, null, ct)).Accepted;

    public async Task<EmailDeliveryResult> SendEmailWithEvidenceAsync(
        string to,
        string subject,
        string htmlBody,
        string? textBody = null,
        string? idempotencyKey = null,
        CancellationToken ct = default)
    {
        try
        {
            var primary = await _primary.SendEmailWithEvidenceAsync(to, subject, htmlBody, textBody, idempotencyKey, ct);
            if (primary.Accepted) return primary;
            _logger.LogInformation("Primary email transport (SendGrid) rejected {Op} â€” falling back to Gmail", nameof(SendEmailWithEvidenceAsync));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Primary email transport (SendGrid) threw for {Op} â€” falling back to Gmail", nameof(SendEmailWithEvidenceAsync));
        }

        return await _fallback.SendEmailWithEvidenceAsync(to, subject, htmlBody, textBody, idempotencyKey, ct);
    }

    public async Task<bool> SendPasswordResetEmailAsync(string to, string resetToken, string userName, string resetUrl, CancellationToken ct = default)
    {
        if (await TryPrimaryAsync(svc => svc.SendPasswordResetEmailAsync(to, resetToken, userName, resetUrl, ct), nameof(SendPasswordResetEmailAsync)))
            return true;
        return await _fallback.SendPasswordResetEmailAsync(to, resetToken, userName, resetUrl, ct);
    }

    public async Task<bool> SendWelcomeEmailAsync(string to, string userName, string tenantName, CancellationToken ct = default)
    {
        if (await TryPrimaryAsync(svc => svc.SendWelcomeEmailAsync(to, userName, tenantName, ct), nameof(SendWelcomeEmailAsync)))
            return true;
        return await _fallback.SendWelcomeEmailAsync(to, userName, tenantName, ct);
    }

    public async Task<bool> IsHealthyAsync(CancellationToken ct = default)
    {
        try { if (await _primary.IsHealthyAsync(ct)) return true; }
        catch (Exception ex) { _logger.LogWarning(ex, "Primary (SendGrid) health check threw"); }
        try { return await _fallback.IsHealthyAsync(ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Fallback (Gmail) health check threw"); return false; }
    }

    private async Task<bool> TryPrimaryAsync(Func<SendGridEmailService, Task<bool>> action, string op)
    {
        try
        {
            var ok = await action(_primary);
            if (!ok) _logger.LogInformation("Primary email transport (SendGrid) returned false for {Op} — falling back to Gmail", op);
            return ok;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Primary email transport (SendGrid) threw for {Op} — falling back to Gmail", op);
            return false;
        }
    }
}
