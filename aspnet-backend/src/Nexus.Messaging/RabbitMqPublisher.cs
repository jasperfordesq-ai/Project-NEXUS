// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Nexus.Contracts.Events;
using Nexus.Messaging.Configuration;
using RabbitMQ.Client;

namespace Nexus.Messaging;

/// <summary>
/// RabbitMQ implementation of IEventPublisher.
/// </summary>
public class RabbitMqPublisher : IEventPublisher, IAsyncDisposable
{
    private readonly RabbitMqOptions _options;
    private readonly ILogger<RabbitMqPublisher> _logger;
    private readonly SemaphoreSlim _connectionLock = new(1, 1);
    private IConnection? _connection;
    private IChannel? _channel;
    private bool _disposed;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = false
    };

    public RabbitMqPublisher(IOptions<RabbitMqOptions> options, ILogger<RabbitMqPublisher> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
    {
        if (!_options.Enabled)
        {
            _logger.LogDebug("RabbitMQ publishing disabled, skipping event {EventType}", @event.EventType);
            return;
        }

        try
        {
            await EnsureConnectionAsync(cancellationToken);

            if (_channel == null)
            {
                _logger.LogWarning("RabbitMQ channel not available, skipping event {EventType}", @event.EventType);
                return;
            }

            var message = JsonSerializer.Serialize(@event, @event.GetType(), JsonOptions);
            var body = Encoding.UTF8.GetBytes(message);

            var properties = new BasicProperties
            {
                ContentType = "application/json",
                DeliveryMode = DeliveryModes.Persistent,
                MessageId = @event.EventId.ToString(),
                Timestamp = new AmqpTimestamp(DateTimeOffset.UtcNow.ToUnixTimeSeconds()),
                Headers = new Dictionary<string, object?>
                {
                    ["tenant_id"] = @event.TenantId.ToString(),
                    ["event_type"] = @event.EventType
                }
            };

            await _channel.BasicPublishAsync(
                exchange: _options.ExchangeName,
                routingKey: @event.EventType,
                mandatory: false,
                basicProperties: properties,
                body: body,
                cancellationToken: cancellationToken);

            _logger.LogInformation(
                "Published event {EventType} (id: {EventId}, tenant: {TenantId})",
                @event.EventType, @event.EventId, @event.TenantId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to publish event {EventType}", @event.EventType);
            // Don't throw - publishing should not break the main flow
        }
    }

    private async Task EnsureConnectionAsync(CancellationToken cancellationToken)
    {
        if (_channel is { IsOpen: true })
            return;

        await _connectionLock.WaitAsync(cancellationToken);
        try
        {
            if (_channel is { IsOpen: true })
                return;

            await CloseExistingConnectionAsync();

            var factory = new ConnectionFactory
            {
                HostName = _options.Host,
                Port = _options.Port,
                UserName = _options.Username,
                Password = _options.Password,
                VirtualHost = _options.VirtualHost
            };

            _connection = await factory.CreateConnectionAsync(cancellationToken);
            _channel = await _connection.CreateChannelAsync(cancellationToken: cancellationToken);

            // Declare the exchange (topic exchange for routing by event type)
            await _channel.ExchangeDeclareAsync(
                exchange: _options.ExchangeName,
                type: ExchangeType.Topic,
                durable: true,
                autoDelete: false,
                cancellationToken: cancellationToken);

            _logger.LogInformation("Connected to RabbitMQ at {Host}:{Port}", _options.Host, _options.Port);
        }
        finally
        {
            _connectionLock.Release();
        }
    }

    private async Task CloseExistingConnectionAsync()
    {
        if (_channel != null)
        {
            await _channel.CloseAsync();
            await _channel.DisposeAsync();
            _channel = null;
        }

        if (_connection != null)
        {
            await _connection.CloseAsync();
            await _connection.DisposeAsync();
            _connection = null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
            return;

        _disposed = true;
        await CloseExistingConnectionAsync();
        _connectionLock.Dispose();

        GC.SuppressFinalize(this);
    }
}
