// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Mail;

namespace Nexus.Api.Services;

/// <summary>
/// Local certification transport. It is registered only when the explicit
/// SmtpCapture:Enabled flag is present in Development/Testing and lets the
/// browser journey obtain reset links through MailHog instead of a token API or
/// a database read. Production never selects this service.
/// </summary>
public sealed class SmtpCaptureEmailService : IEmailService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<SmtpCaptureEmailService> _logger;

    public SmtpCaptureEmailService(
        IConfiguration configuration,
        ILogger<SmtpCaptureEmailService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<bool> SendEmailAsync(
        string to,
        string subject,
        string htmlBody,
        string? textBody = null,
        CancellationToken ct = default)
    {
        try
        {
            using var message = new MailMessage
            {
                From = new MailAddress(
                    _configuration["SmtpCapture:FromEmail"] ?? "noreply@project-nexus.invalid",
                    _configuration["SmtpCapture:FromName"] ?? "Project NEXUS"),
                Subject = subject,
                Body = htmlBody,
                IsBodyHtml = true,
            };
            message.To.Add(to);
            if (!string.IsNullOrWhiteSpace(textBody))
                message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(textBody, null, "text/plain"));

            using var client = new SmtpClient(
                _configuration["SmtpCapture:Host"] ?? "localhost",
                _configuration.GetValue("SmtpCapture:Port", 1025))
            {
                EnableSsl = false,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false,
                Credentials = CredentialCache.DefaultNetworkCredentials,
            };
            await client.SendMailAsync(message, ct);
            return true;
        }
        catch (Exception ex) when (ex is SmtpException or InvalidOperationException)
        {
            _logger.LogError(ex, "Local SMTP capture rejected an email for recipient domain {Domain}",
                to.Split('@').LastOrDefault() ?? "unknown");
            return false;
        }
    }

    public Task<bool> SendPasswordResetEmailAsync(
        string to,
        string resetToken,
        string userName,
        string resetUrl,
        CancellationToken ct = default)
        => SendEmailAsync(
            to,
            "Password reset",
            $"<p><a href=\"{WebUtility.HtmlEncode(resetUrl)}\">Reset password</a></p>",
            $"Reset password: {resetUrl}",
            ct);

    public Task<bool> SendWelcomeEmailAsync(
        string to,
        string userName,
        string tenantName,
        CancellationToken ct = default)
        => SendEmailAsync(to, "Welcome", $"<p>{WebUtility.HtmlEncode(tenantName)}</p>", tenantName, ct);

    public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(true);
}
