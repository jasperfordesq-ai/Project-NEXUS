// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Nexus.Contracts.Events;
using Nexus.Messaging.Configuration;
using RabbitMQ.Client;
using Testcontainers.RabbitMq;

namespace Nexus.Messaging.Tests;

/// <summary>
/// Integration tests using a real RabbitMQ instance via Testcontainers.
/// These tests verify actual connection, channel creation, exchange declaration,
/// and message publishing behaviour.
/// </summary>
[Collection("RabbitMq")]
public class RabbitMqPublisherIntegrationTests : IAsyncLifetime
{
    private readonly RabbitMqContainer _container = new RabbitMqBuilder()
        .WithImage("rabbitmq:3-management-alpine")
        .Build();

    private readonly Mock<ILogger<RabbitMqPublisher>> _loggerMock = new();

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
    }

    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }

    private const string RabbitUser = "rabbitmq";
    private const string RabbitPass = "rabbitmq";

    private RabbitMqPublisher CreatePublisher(string? exchangeName = null)
    {
        var options = Options.Create(new RabbitMqOptions
        {
            Enabled = true,
            Host = _container.Hostname,
            Port = _container.GetMappedPublicPort(5672),
            Username = RabbitUser,
            Password = RabbitPass,
            VirtualHost = "/",
            ExchangeName = exchangeName ?? "nexus.events.test"
        });

        return new RabbitMqPublisher(options, _loggerMock.Object);
    }

    private ConnectionFactory CreateConnectionFactory() => new()
    {
        HostName = _container.Hostname,
        Port = _container.GetMappedPublicPort(5672),
        UserName = RabbitUser,
        Password = RabbitPass
    };

    /// <summary>
    /// Polls a queue with retries to allow for async message delivery.
    /// </summary>
    private static async Task<BasicGetResult?> GetMessageWithRetry(
        IChannel channel, string queueName, int maxRetries = 10, int delayMs = 100)
    {
        for (var i = 0; i < maxRetries; i++)
        {
            var result = await channel.BasicGetAsync(queueName, autoAck: true);
            if (result != null) return result;
            await Task.Delay(delayMs);
        }
        return null;
    }

    [Fact]
    public async Task PublishAsync_ConnectsAndPublishesSuccessfully()
    {
        await using var publisher = CreatePublisher();
        var @event = new UserCreatedEvent
        {
            TenantId = 1,
            UserId = 42,
            Email = "test@example.com",
            FirstName = "Test",
            LastName = "User"
        };

        await publisher.PublishAsync(@event);

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Information,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("Connected to RabbitMQ")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Information,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("Published event")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Fact]
    public async Task PublishAsync_MessageIsRoutedToQueue_WithCorrectContent()
    {
        const string exchangeName = "nexus.events.content-test";
        const string queueName = "test-user-created";
        const string routingKey = "user.created";

        // Set up a queue to consume the published message
        await using var conn = await CreateConnectionFactory().CreateConnectionAsync();
        await using var channel = await conn.CreateChannelAsync();

        await channel.ExchangeDeclareAsync(exchangeName, ExchangeType.Topic, durable: true);
        await channel.QueueDeclareAsync(queueName, durable: false, exclusive: false, autoDelete: true);
        await channel.QueueBindAsync(queueName, exchangeName, routingKey);

        // Publish via the publisher
        await using var publisher = CreatePublisher(exchangeName);
        var @event = new UserCreatedEvent
        {
            TenantId = 5,
            UserId = 123,
            Email = "alice@example.com",
            FirstName = "Alice",
            LastName = "Smith",
            Role = "admin"
        };

        await publisher.PublishAsync(@event);

        // Consume the message (with retry for async delivery)
        var result = await GetMessageWithRetry(channel, queueName);
        result.Should().NotBeNull("a message should have been published to the queue");

        var body = Encoding.UTF8.GetString(result!.Body.ToArray());
        body.Should().NotBeNullOrEmpty();

        // Verify JSON uses snake_case_lower naming
        var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        root.TryGetProperty("tenant_id", out var tenantId).Should().BeTrue();
        tenantId.GetInt32().Should().Be(5);

        root.TryGetProperty("user_id", out var userId).Should().BeTrue();
        userId.GetInt32().Should().Be(123);

        root.TryGetProperty("email", out var email).Should().BeTrue();
        email.GetString().Should().Be("alice@example.com");

        root.TryGetProperty("first_name", out var firstName).Should().BeTrue();
        firstName.GetString().Should().Be("Alice");

        root.TryGetProperty("event_type", out var eventType).Should().BeTrue();
        eventType.GetString().Should().Be("user.created");
    }

    [Fact]
    public async Task PublishAsync_SetsCorrectMessageProperties()
    {
        const string exchangeName = "nexus.events.props-test";
        const string queueName = "test-props";
        const string routingKey = "user.created";

        await using var conn = await CreateConnectionFactory().CreateConnectionAsync();
        await using var channel = await conn.CreateChannelAsync();

        await channel.ExchangeDeclareAsync(exchangeName, ExchangeType.Topic, durable: true);
        await channel.QueueDeclareAsync(queueName, durable: false, exclusive: false, autoDelete: true);
        await channel.QueueBindAsync(queueName, exchangeName, routingKey);

        await using var publisher = CreatePublisher(exchangeName);
        var @event = new UserCreatedEvent
        {
            TenantId = 3,
            UserId = 77,
            Email = "bob@example.com"
        };

        await publisher.PublishAsync(@event);

        var result = await GetMessageWithRetry(channel, queueName);
        result.Should().NotBeNull("a message should have been published to the queue");

        var props = result!.BasicProperties;
        props.ContentType.Should().Be("application/json");
        props.DeliveryMode.Should().Be(DeliveryModes.Persistent);
        props.MessageId.Should().Be(@event.EventId.ToString());
        props.Timestamp.UnixTime.Should().BeGreaterThan(0);

        // Verify headers
        props.Headers.Should().ContainKey("tenant_id");
        props.Headers.Should().ContainKey("event_type");

        var tenantIdHeader = Encoding.UTF8.GetString((byte[])props.Headers!["tenant_id"]!);
        tenantIdHeader.Should().Be("3");

        var eventTypeHeader = Encoding.UTF8.GetString((byte[])props.Headers!["event_type"]!);
        eventTypeHeader.Should().Be("user.created");
    }

    [Fact]
    public async Task PublishAsync_DeclaresTopicExchange()
    {
        const string exchangeName = "nexus.events.exchange-test";

        await using var publisher = CreatePublisher(exchangeName);
        var @event = new UserCreatedEvent { TenantId = 1, UserId = 1 };

        await publisher.PublishAsync(@event);

        // Verify exchange exists by trying to declare it passively
        await using var conn = await CreateConnectionFactory().CreateConnectionAsync();
        await using var channel = await conn.CreateChannelAsync();

        // ExchangeDeclarePassive throws if exchange doesn't exist
        var act = () => channel.ExchangeDeclarePassiveAsync(exchangeName);
        await act.Should().NotThrowAsync("exchange should have been declared by the publisher");
    }

    [Fact]
    public async Task PublishAsync_MultipleEvents_ReusesConnection()
    {
        await using var publisher = CreatePublisher();

        await publisher.PublishAsync(new UserCreatedEvent { TenantId = 1, UserId = 1 });
        await publisher.PublishAsync(new UserSuspendedEvent { TenantId = 1, UserId = 2 });
        await publisher.PublishAsync(new UserActivatedEvent { TenantId = 1, UserId = 3 });

        // Should connect only once
        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Information,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("Connected to RabbitMQ")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);

        // Should publish all three
        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Information,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("Published event")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Exactly(3));
    }

    [Fact]
    public async Task PublishAsync_ConcurrentPublishes_AreThreadSafe()
    {
        await using var publisher = CreatePublisher();

        var tasks = Enumerable.Range(0, 20)
            .Select(i => publisher.PublishAsync(
                new UserCreatedEvent { TenantId = 1, UserId = i, Email = $"user{i}@test.com" }));

        await Task.WhenAll(tasks);

        // No errors should have been logged
        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Error,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Never);
    }

    [Fact]
    public async Task PublishAsync_RoutesEventsByType()
    {
        const string exchangeName = "nexus.events.routing-test";
        const string userQueue = "test-user-events";
        const string listingQueue = "test-listing-events";

        await using var conn = await CreateConnectionFactory().CreateConnectionAsync();
        await using var channel = await conn.CreateChannelAsync();

        await channel.ExchangeDeclareAsync(exchangeName, ExchangeType.Topic, durable: true);
        await channel.QueueDeclareAsync(userQueue, durable: false, exclusive: false, autoDelete: true);
        await channel.QueueDeclareAsync(listingQueue, durable: false, exclusive: false, autoDelete: true);
        await channel.QueueBindAsync(userQueue, exchangeName, "user.*");
        await channel.QueueBindAsync(listingQueue, exchangeName, "listing.*");

        await using var publisher = CreatePublisher(exchangeName);

        await publisher.PublishAsync(new UserCreatedEvent { TenantId = 1, UserId = 1 });
        await publisher.PublishAsync(new ListingApprovedEvent { TenantId = 1, ListingId = 10 });

        // User queue should have the user event
        var userMsg = await GetMessageWithRetry(channel, userQueue);
        userMsg.Should().NotBeNull("a user event should have been routed to the user queue");
        var userBody = Encoding.UTF8.GetString(userMsg!.Body.ToArray());
        userBody.Should().Contain("user.created");

        // Listing queue should have the listing event
        var listingMsg = await GetMessageWithRetry(channel, listingQueue);
        listingMsg.Should().NotBeNull("a listing event should have been routed to the listing queue");
        var listingBody = Encoding.UTF8.GetString(listingMsg!.Body.ToArray());
        listingBody.Should().Contain("listing.approved");
    }

    [Fact]
    public async Task DisposeAsync_ClosesConnectionCleanly()
    {
        var publisher = CreatePublisher();

        // Establish connection
        await publisher.PublishAsync(new UserCreatedEvent { TenantId = 1, UserId = 1 });

        // Dispose should close cleanly
        await publisher.DisposeAsync();

        // Publishing after dispose should fail gracefully (caught exception)
        // The semaphore is disposed so this should be caught in the error handler
        await publisher.PublishAsync(new UserCreatedEvent { TenantId = 1, UserId = 2 });

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Error,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.AtLeastOnce);
    }
}
