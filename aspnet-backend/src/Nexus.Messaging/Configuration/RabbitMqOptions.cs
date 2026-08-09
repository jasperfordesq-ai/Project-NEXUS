// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Messaging.Configuration;

/// <summary>
/// Configuration options for RabbitMQ connection.
/// </summary>
public class RabbitMqOptions
{
    /// <summary>
    /// Configuration section name in appsettings.json.
    /// </summary>
    public const string SectionName = "RabbitMq";

    /// <summary>
    /// RabbitMQ host name (default: localhost).
    /// </summary>
    public string Host { get; set; } = "localhost";

    /// <summary>
    /// RabbitMQ port (default: 5672).
    /// </summary>
    public int Port { get; set; } = 5672;

    /// <summary>
    /// RabbitMQ username (default: guest).
    /// </summary>
    public string Username { get; set; } = "guest";

    /// <summary>
    /// RabbitMQ password (default: guest).
    /// </summary>
    public string Password { get; set; } = "guest";

    /// <summary>
    /// Virtual host (default: /).
    /// </summary>
    public string VirtualHost { get; set; } = "/";

    /// <summary>
    /// Exchange name for events (default: nexus.events).
    /// </summary>
    public string ExchangeName { get; set; } = "nexus.events";

    /// <summary>
    /// Whether messaging is enabled (feature flag).
    /// </summary>
    public bool Enabled { get; set; } = false;
}
