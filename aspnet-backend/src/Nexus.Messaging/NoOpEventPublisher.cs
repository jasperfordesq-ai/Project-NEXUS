// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.Extensions.Logging;
using Nexus.Contracts.Events;

namespace Nexus.Messaging;

/// <summary>
/// No-op implementation of IEventPublisher for when messaging is disabled.
/// </summary>
public class NoOpEventPublisher : IEventPublisher
{
    private readonly ILogger<NoOpEventPublisher> _logger;

    public NoOpEventPublisher(ILogger<NoOpEventPublisher> logger)
    {
        _logger = logger;
    }

    public Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
    {
        _logger.LogDebug("NoOp: Would publish event {EventType} (messaging disabled)", @event.EventType);
        return Task.CompletedTask;
    }
}
