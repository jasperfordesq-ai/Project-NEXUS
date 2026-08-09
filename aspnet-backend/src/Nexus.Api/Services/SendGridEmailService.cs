// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http;
using SendGrid;
using SendGrid.Helpers.Mail;

namespace Nexus.Api.Services;

public class SendGridEmailService : IEmailService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<SendGridEmailService> _logger;
    private readonly string? _apiKey;
    private readonly string _senderEmail;
    private readonly string _senderName;

    public SendGridEmailService(IConfiguration configuration, ILogger<SendGridEmailService> logger)
    {
        _configuration = configuration;
        _logger = logger;
        _apiKey = configuration["SendGrid:ApiKey"];
        _senderEmail = configuration["SendGrid:SenderEmail"] ?? "noreply@project-nexus.net";
        _senderName = configuration["SendGrid:SenderName"] ?? "Project NEXUS";
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
        if (string.IsNullOrEmpty(_apiKey))
        {
            _logger.LogWarning("SendGrid API key not configured. Email to {To} not sent.", to);
            return new EmailDeliveryResult(false, "sendgrid", null, "sendgrid_not_configured");
        }

        try
        {
            var client = new SendGridClient(_apiKey);
            var from = new EmailAddress(_senderEmail, _senderName);
            var toAddress = new EmailAddress(to);
            var msg = MailHelper.CreateSingleEmail(from, toAddress, subject, textBody ?? "", htmlBody);
            if (!string.IsNullOrWhiteSpace(idempotencyKey))
                msg.AddCustomArg("idempotency_key", idempotencyKey);
            var response = await client.SendEmailAsync(msg, ct);

            if (response.IsSuccessStatusCode)
            {
                var providerMessageId = response.Headers.TryGetValues("X-Message-Id", out var values)
                    ? values.FirstOrDefault()
                    : null;
                _logger.LogInformation("Email sent via SendGrid to {To}: {Subject}", to, subject);
                return new EmailDeliveryResult(true, "sendgrid", providerMessageId);
            }

            var body = await response.Body.ReadAsStringAsync(ct);
            _logger.LogError("SendGrid failed ({StatusCode}): {Body}", response.StatusCode, body);
            return new EmailDeliveryResult(false, "sendgrid", null, $"sendgrid_http_{(int)response.StatusCode}");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            _logger.LogError(ex, "SendGrid error sending email to {To}", to);
            return new EmailDeliveryResult(false, "sendgrid", null, "sendgrid_send_failed");
        }
    }

    public async Task<bool> SendPasswordResetEmailAsync(string to, string resetToken, string userName, string resetUrl, CancellationToken ct = default)
    {
        var subject = "Reset Your Credentials - Project NEXUS";
        var html = $"<h2>Account Recovery</h2><p>Hi {userName},</p><p>Click below to set a new credential:</p><p><a href='{resetUrl}'>Reset Now</a></p><p>This link expires in 30 minutes.</p>";
        return await SendEmailAsync(to, subject, html, null, ct);
    }

    public async Task<bool> SendWelcomeEmailAsync(string to, string userName, string tenantName, CancellationToken ct = default)
    {
        var subject = $"Welcome to {tenantName}!";
        var html = $"<h2>Welcome, {userName}!</h2><p>Your account on <strong>{tenantName}</strong> has been created.</p>";
        return await SendEmailAsync(to, subject, html, null, ct);
    }

    public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(!string.IsNullOrEmpty(_apiKey));
}
