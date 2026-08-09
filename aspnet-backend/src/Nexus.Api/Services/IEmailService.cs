// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services;

/// <summary>
/// Interface for email sending services.
/// </summary>
public interface IEmailService
{
    /// <summary>
    /// Sends an email.
    /// </summary>
    /// <param name="to">Recipient email address.</param>
    /// <param name="subject">Email subject.</param>
    /// <param name="htmlBody">HTML body content.</param>
    /// <param name="textBody">Plain text body (optional, for fallback).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>True if email was sent successfully.</returns>
    Task<bool> SendEmailAsync(
        string to,
        string subject,
        string htmlBody,
        string? textBody = null,
        CancellationToken ct = default);

    /// <summary>
    /// Sends an email and returns provider evidence when the transport exposes it.
    /// Implementations that have not yet adopted the richer contract retain their
    /// existing behavior through this default adapter.
    /// </summary>
    async Task<EmailDeliveryResult> SendEmailWithEvidenceAsync(
        string to,
        string subject,
        string htmlBody,
        string? textBody = null,
        string? idempotencyKey = null,
        CancellationToken ct = default)
    {
        var accepted = await SendEmailAsync(to, subject, htmlBody, textBody, ct);
        return new EmailDeliveryResult(accepted, GetType().Name, null,
            accepted ? null : "email_provider_rejected");
    }

    /// <summary>
    /// Sends a password reset email.
    /// </summary>
    /// <param name="to">Recipient email address.</param>
    /// <param name="resetToken">The password reset token.</param>
    /// <param name="userName">The user's display name.</param>
    /// <param name="resetUrl">Full URL for password reset (with token).</param>
    /// <param name="ct">Cancellation token.</param>
    Task<bool> SendPasswordResetEmailAsync(
        string to,
        string resetToken,
        string userName,
        string resetUrl,
        CancellationToken ct = default);

    /// <summary>
    /// Sends a welcome email to a new user.
    /// </summary>
    /// <param name="to">Recipient email address.</param>
    /// <param name="userName">The user's display name.</param>
    /// <param name="tenantName">The timebank/tenant name.</param>
    /// <param name="ct">Cancellation token.</param>
    Task<bool> SendWelcomeEmailAsync(
        string to,
        string userName,
        string tenantName,
        CancellationToken ct = default);

    /// <summary>
    /// Checks if the email service is properly configured and operational.
    /// </summary>
    Task<bool> IsHealthyAsync(CancellationToken ct = default);
}

public sealed record EmailDeliveryResult(
    bool Accepted,
    string Provider,
    string? ProviderMessageId,
    string? FailureReason = null);
