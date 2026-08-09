// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using MimeKit;
using Nexus.Api.Configuration;

namespace Nexus.Api.Services;

/// <summary>
/// Email service implementation using Gmail API with OAuth2.
/// </summary>
public class GmailEmailService : IEmailService
{
    private readonly GmailOptions _options;
    private readonly ILogger<GmailEmailService> _logger;
    private readonly HttpClient _httpClient;
    private string? _accessToken;
    private DateTime _tokenExpiry = DateTime.MinValue;

    public GmailEmailService(
        HttpClient httpClient,
        IOptions<GmailOptions> options,
        ILogger<GmailEmailService> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<bool> SendEmailAsync(
        string to,
        string subject,
        string htmlBody,
        string? textBody = null,
        CancellationToken ct = default)
        => (await SendEmailWithEvidenceAsync(to, subject, htmlBody, textBody, null, ct)).Accepted;

    public async Task<EmailDeliveryResult> SendEmailWithEvidenceAsync(
        string to,
        string subject,
        string htmlBody,
        string? textBody = null,
        string? idempotencyKey = null,
        CancellationToken ct = default)
    {
        // Create safe log identifiers upfront to avoid logging user-provided values directly
        var safeRecipient = MaskEmail(to);
        var safeSubjectLength = subject?.Length ?? 0;

        if (!_options.Enabled)
        {
            _logger.LogWarning("Email sending is disabled. Would have sent to: {To}, SubjectLength: {SubjectLength}",
                safeRecipient, safeSubjectLength);
            return new EmailDeliveryResult(false, "gmail-disabled", null, "gmail_disabled");
        }

        if (!_options.IsConfigured)
        {
            _logger.LogError("Gmail is not properly configured. Missing required credentials.");
            return new EmailDeliveryResult(false, "gmail", null, "gmail_not_configured");
        }

        try
        {
            var accessToken = await GetAccessTokenAsync(ct);
            if (string.IsNullOrEmpty(accessToken))
            {
                _logger.LogError("Failed to get Gmail API access token");
                return new EmailDeliveryResult(false, "gmail", null, "gmail_access_token_unavailable");
            }

            using var message = new MimeMessage();
            message.From.Add(new MailboxAddress(_options.SenderName, _options.SenderEmail));
            message.To.Add(new MailboxAddress(string.Empty, to));
            message.Subject = subject!;
            if (!string.IsNullOrWhiteSpace(idempotencyKey))
                message.MessageId = $"<{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(idempotencyKey))).ToLowerInvariant()}@project-nexus.invalid>";

            var builder = new BodyBuilder();
            builder.HtmlBody = htmlBody;
            if (!string.IsNullOrEmpty(textBody))
            {
                builder.TextBody = textBody;
            }
            message.Body = builder.ToMessageBody();

            var rawMessage = await GetRawMessageAsync(message);

            // Send via Gmail API directly
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new { raw = rawMessage }),
                Encoding.UTF8,
                "application/json");

            using var response = await _httpClient.SendAsync(request, ct);
            var responseBody = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Gmail API error ({StatusCode}): {Error}", response.StatusCode, responseBody);
                return new EmailDeliveryResult(false, "gmail", null, $"gmail_http_{(int)response.StatusCode}");
            }

            string? providerMessageId = null;
            try
            {
                using var result = JsonDocument.Parse(responseBody);
                providerMessageId = result.RootElement.TryGetProperty("id", out var id) ? id.GetString() : null;
            }
            catch (JsonException)
            {
                // A successful provider response without JSON is still accepted,
                // but the durable email log will show that no remote id was returned.
            }
            _logger.LogInformation("Email sent successfully to {To}", safeRecipient);
            return new EmailDeliveryResult(true, "gmail", providerMessageId);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP error sending email to {To}", safeRecipient);
            return new EmailDeliveryResult(false, "gmail", null, "gmail_http_error");
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Configuration error sending email to {To}", safeRecipient);
            return new EmailDeliveryResult(false, "gmail", null, "gmail_configuration_error");
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogError(ex, "Timeout sending email to {To}", safeRecipient);
            return new EmailDeliveryResult(false, "gmail", null, "gmail_timeout");
        }
    }

    /// <inheritdoc />
    public async Task<bool> SendPasswordResetEmailAsync(
        string to,
        string resetToken,
        string userName,
        string resetUrl,
        CancellationToken ct = default)
    {
        var subject = "Reset Your Password - Project NEXUS";

        var htmlBody = $@"
<!DOCTYPE html>
<html>
<head>
    <meta charset='utf-8'>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
        .content {{ background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }}
        .button {{ display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
        .footer {{ text-align: center; padding: 20px; color: #64748b; font-size: 12px; }}
        .token {{ background: #e2e8f0; padding: 10px; font-family: monospace; border-radius: 4px; word-break: break-all; }}
    </style>
</head>
<body>
    <div class='container'>
        <div class='header'>
            <h1 style='margin: 0;'>Project NEXUS</h1>
        </div>
        <div class='content'>
            <h2>Password Reset Request</h2>
            <p>Hi {userName},</p>
            <p>We received a request to reset your password. Click the button below to set a new password:</p>
            <p style='text-align: center;'>
                <a href='{resetUrl}' class='button' style='color: white;'>Reset Password</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p class='token'>{resetUrl}</p>
            <p><strong>This link will expire in 30 minutes.</strong></p>
            <p>If you didn't request this password reset, you can safely ignore this email. Your password won't be changed.</p>
        </div>
        <div class='footer'>
            <p>This email was sent by Project NEXUS.<br>
            If you have questions, please contact your timebank administrator.</p>
        </div>
    </div>
</body>
</html>";

        var textBody = $@"
Password Reset Request

Hi {userName},

We received a request to reset your password.

Click this link to reset your password:
{resetUrl}

This link will expire in 30 minutes.

If you didn't request this password reset, you can safely ignore this email.

---
Project NEXUS
";

        return await SendEmailAsync(to, subject, htmlBody, textBody, ct);
    }

    /// <inheritdoc />
    public async Task<bool> SendWelcomeEmailAsync(
        string to,
        string userName,
        string tenantName,
        CancellationToken ct = default)
    {
        var subject = $"Welcome to {tenantName} - Project NEXUS";

        var htmlBody = $@"
<!DOCTYPE html>
<html>
<head>
    <meta charset='utf-8'>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: #059669; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
        .content {{ background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }}
        .footer {{ text-align: center; padding: 20px; color: #64748b; font-size: 12px; }}
    </style>
</head>
<body>
    <div class='container'>
        <div class='header'>
            <h1 style='margin: 0;'>Welcome to {tenantName}!</h1>
        </div>
        <div class='content'>
            <h2>Hi {userName},</h2>
            <p>Welcome to <strong>{tenantName}</strong>! We're excited to have you join our timebanking community.</p>
            <p>Timebanking is a simple idea: for every hour you spend helping someone in your community, you earn one time credit. You can then spend that credit on services from other members.</p>
            <h3>Getting Started</h3>
            <ul>
                <li><strong>Complete your profile</strong> - Add a bio and list your skills</li>
                <li><strong>Browse listings</strong> - See what services are offered and needed</li>
                <li><strong>Create a listing</strong> - Share what you can offer or what you need help with</li>
                <li><strong>Connect with members</strong> - Build relationships in your community</li>
            </ul>
            <p>If you have any questions, don't hesitate to reach out to your timebank coordinator.</p>
            <p>Happy timebanking!</p>
        </div>
        <div class='footer'>
            <p>This email was sent by Project NEXUS on behalf of {tenantName}.</p>
        </div>
    </div>
</body>
</html>";

        var textBody = $@"
Welcome to {tenantName}!

Hi {userName},

Welcome to {tenantName}! We're excited to have you join our timebanking community.

Timebanking is a simple idea: for every hour you spend helping someone in your community, you earn one time credit. You can then spend that credit on services from other members.

Getting Started:
- Complete your profile - Add a bio and list your skills
- Browse listings - See what services are offered and needed
- Create a listing - Share what you can offer or what you need help with
- Connect with members - Build relationships in your community

If you have any questions, don't hesitate to reach out to your timebank coordinator.

Happy timebanking!

---
Project NEXUS on behalf of {tenantName}
";

        return await SendEmailAsync(to, subject, htmlBody, textBody, ct);
    }

    /// <inheritdoc />
    public async Task<bool> IsHealthyAsync(CancellationToken ct = default)
    {
        if (!_options.Enabled)
        {
            return true; // Disabled is a valid state
        }

        if (!_options.IsConfigured)
        {
            return false;
        }

        try
        {
            var accessToken = await GetAccessTokenAsync(ct);
            if (string.IsNullOrEmpty(accessToken))
            {
                return false;
            }

            using var request = new HttpRequestMessage(HttpMethod.Get, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            var response = await _httpClient.SendAsync(request, ct);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Gmail health check failed due to HTTP error");
            return false;
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Gmail health check configuration error");
            return false;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(ex, "Gmail health check timed out");
            return false;
        }
    }

    /// <summary>
    /// Gets an access token, refreshing if necessary.
    /// Uses direct HTTP calls to Google OAuth2 endpoint (same as PHP implementation).
    /// </summary>
    private async Task<string?> GetAccessTokenAsync(CancellationToken ct)
    {
        // Return cached token if still valid
        if (!string.IsNullOrEmpty(_accessToken) && DateTime.UtcNow < _tokenExpiry)
        {
            return _accessToken;
        }

        try
        {
            using var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = _options.ClientId,
                ["client_secret"] = _options.ClientSecret,
                ["refresh_token"] = _options.RefreshToken,
                ["grant_type"] = "refresh_token"
            });

            var response = await _httpClient.PostAsync("https://oauth2.googleapis.com/token", content, ct);
            var responseBody = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Gmail token refresh failed (HTTP {StatusCode}): {Response}",
                    (int)response.StatusCode, responseBody);
                return null;
            }

            using var doc = JsonDocument.Parse(responseBody);
            var root = doc.RootElement;

            if (root.TryGetProperty("access_token", out var tokenElement))
            {
                _accessToken = tokenElement.GetString();
                var expiresIn = root.TryGetProperty("expires_in", out var expiresElement)
                    ? expiresElement.GetInt32()
                    : 3600;

                // Cache for slightly less than expiry to be safe
                _tokenExpiry = DateTime.UtcNow.AddSeconds(expiresIn - 100);

                _logger.LogDebug("Gmail access token refreshed, expires in {ExpiresIn}s", expiresIn);
                return _accessToken;
            }

            _logger.LogError("Gmail token response missing access_token: {Response}", responseBody);
            return null;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP error refreshing Gmail access token");
            return null;
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Failed to parse Gmail token response");
            return null;
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Configuration error refreshing Gmail access token");
            return null;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogError(ex, "Timeout refreshing Gmail access token");
            return null;
        }
    }

    private static async Task<string> GetRawMessageAsync(MimeMessage message)
    {
        using var stream = new MemoryStream();
        await message.WriteToAsync(stream);
        var bytes = stream.ToArray();
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .Replace("=", "");
    }

    /// <summary>
    /// Masks an email address for safe logging (e.g., "user@example.com" → "u***@e]").
    /// Returns a fixed-format string constructed from validated characters only,
    /// ensuring no user-controlled data flows into log output.
    /// </summary>
    private static string MaskEmail(string email)
    {
        if (string.IsNullOrEmpty(email))
            return "[empty]";

        var atIndex = email.IndexOf('@');
        if (atIndex <= 0)
            return "[invalid-email]";

        // Extract only safe characters to break taint tracking chain
        var firstChar = char.IsLetterOrDigit(email[0]) ? email[0] : '_';
        var domainStart = atIndex + 1;
        var domainChar = domainStart < email.Length && char.IsLetterOrDigit(email[domainStart])
            ? email[domainStart]
            : '_';

        // Construct a completely new string from validated individual characters
        return string.Concat(firstChar.ToString(), "***@", domainChar.ToString(), "...");
    }
}
