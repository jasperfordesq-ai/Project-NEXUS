// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Configuration;

/// <summary>
/// Configuration options for Gmail API email sending.
/// </summary>
public class GmailOptions
{
    public const string SectionName = "Gmail";

    /// <summary>
    /// Google OAuth Client ID.
    /// </summary>
    public string ClientId { get; set; } = "";

    /// <summary>
    /// Google OAuth Client Secret.
    /// </summary>
    public string ClientSecret { get; set; } = "";

    /// <summary>
    /// OAuth Refresh Token for offline access.
    /// </summary>
    public string RefreshToken { get; set; } = "";

    /// <summary>
    /// Email address to send from.
    /// </summary>
    public string SenderEmail { get; set; } = "";

    /// <summary>
    /// Display name for the sender.
    /// </summary>
    public string SenderName { get; set; } = "Project NEXUS";

    /// <summary>
    /// Whether email sending is enabled.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Returns true if all required credentials are configured.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrEmpty(ClientId) &&
        !string.IsNullOrEmpty(ClientSecret) &&
        !string.IsNullOrEmpty(RefreshToken) &&
        !string.IsNullOrEmpty(SenderEmail);
}
