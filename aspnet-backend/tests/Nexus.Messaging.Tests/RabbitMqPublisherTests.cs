// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Nexus.Contracts.Events;
using Nexus.Messaging.Configuration;

namespace Nexus.Messaging.Tests;

public class RabbitMqPublisherTests
{
    private readonly Mock<ILogger<RabbitMqPublisher>> _loggerMock = new();

    private RabbitMqPublisher CreatePublisher(RabbitMqOptions? options = null)
    {
        var opts = Options.Create(options ?? new RabbitMqOptions());
        return new RabbitMqPublisher(opts, _loggerMock.Object);
    }

    [Fact]
    public void Implements_IEventPublisher()
    {
        var publisher = CreatePublisher();
        publisher.Should().BeAssignableTo<IEventPublisher>();
    }

    [Fact]
    public void Implements_IAsyncDisposable()
    {
        var publisher = CreatePublisher();
        publisher.Should().BeAssignableTo<IAsyncDisposable>();
    }

    // --- Disabled path tests ---

    [Fact]
    public async Task PublishAsync_WhenDisabled_SkipsPublishing()
    {
        var publisher = CreatePublisher(new RabbitMqOptions { Enabled = false });
        var @event = new UserCreatedEvent { TenantId = 1, UserId = 42 };

        await publisher.PublishAsync(@event);

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Debug,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("disabled")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Fact]
    public async Task PublishAsync_WhenDisabled_DoesNotAttemptConnection()
    {
        var publisher = CreatePublisher(new RabbitMqOptions { Enabled = false });
        var @event = new UserCreatedEvent { TenantId = 1, UserId = 42 };

        // Should not throw (no connection attempt)
        await publisher.PublishAsync(@event);

        // Should not log any connection info
        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Information,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("Connected to RabbitMQ")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Never);
    }

    [Fact]
    public async Task PublishAsync_WhenDisabled_LogsCorrectEventType()
    {
        var publisher = CreatePublisher(new RabbitMqOptions { Enabled = false });
        var @event = new UserSuspendedEvent { TenantId = 1, UserId = 99 };

        await publisher.PublishAsync(@event);

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Debug,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("user.suspended")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    // --- Connection failure tests ---

    [Fact]
    public async Task PublishAsync_WhenConnectionFails_LogsErrorAndDoesNotThrow()
    {
        // Use an unreachable host to force connection failure
        var publisher = CreatePublisher(new RabbitMqOptions
        {
            Enabled = true,
            Host = "nonexistent.invalid",
            Port = 59999
        });

        var @event = new UserCreatedEvent { TenantId = 1, UserId = 42 };

        // Should NOT throw - errors are caught and logged
        await publisher.PublishAsync(@event);

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Error,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("Failed to publish")),
                It.IsAny<Exception>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Fact]
    public async Task PublishAsync_WhenConnectionFails_LogsEventType()
    {
        var publisher = CreatePublisher(new RabbitMqOptions
        {
            Enabled = true,
            Host = "nonexistent.invalid",
            Port = 59999
        });

        var @event = new UserCreatedEvent { TenantId = 1, UserId = 42 };

        await publisher.PublishAsync(@event);

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Error,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("user.created")),
                It.IsAny<Exception>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    // --- Cancellation tests ---

    [Fact]
    public async Task PublishAsync_WhenCancelled_DoesNotThrowOrHandlesGracefully()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var publisher = CreatePublisher(new RabbitMqOptions
        {
            Enabled = true,
            Host = "nonexistent.invalid"
        });

        var @event = new UserCreatedEvent { TenantId = 1, UserId = 42 };

        // Cancelled token should either be handled gracefully or throw OperationCanceledException
        // The implementation catches all exceptions, so it should not throw
        await publisher.PublishAsync(@event, cts.Token);
    }

    // --- Dispose tests ---

    [Fact]
    public async Task DisposeAsync_CanBeCalledWithoutPriorPublish()
    {
        var publisher = CreatePublisher();

        await publisher.DisposeAsync();
        // Should complete without error
    }

    [Fact]
    public async Task DisposeAsync_CanBeCalledMultipleTimes()
    {
        var publisher = CreatePublisher();

        await publisher.DisposeAsync();
        await publisher.DisposeAsync(); // Second dispose should be safe (idempotent)
    }

    [Fact]
    public async Task DisposeAsync_AfterFailedPublish_CompletesCleanly()
    {
        var publisher = CreatePublisher(new RabbitMqOptions
        {
            Enabled = true,
            Host = "nonexistent.invalid",
            Port = 59999
        });

        var @event = new UserCreatedEvent { TenantId = 1, UserId = 42 };
        await publisher.PublishAsync(@event); // Will fail connection

        await publisher.DisposeAsync(); // Should still complete cleanly
    }

    // --- Multiple event types ---

    [Fact]
    public async Task PublishAsync_WhenDisabled_WorksWithAllEventTypes()
    {
        var publisher = CreatePublisher(new RabbitMqOptions { Enabled = false });

        await publisher.PublishAsync(new UserCreatedEvent { TenantId = 1 });
        await publisher.PublishAsync(new UserSuspendedEvent { TenantId = 1 });
        await publisher.PublishAsync(new UserActivatedEvent { TenantId = 1 });
        await publisher.PublishAsync(new UserUpdatedEvent { TenantId = 1 });
        await publisher.PublishAsync(new UserPasswordChangedEvent { TenantId = 1 });

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Debug,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Exactly(5));
    }

    // --- Concurrent publish tests ---

    [Fact]
    public async Task PublishAsync_ConcurrentDisabledPublishes_AreThreadSafe()
    {
        var publisher = CreatePublisher(new RabbitMqOptions { Enabled = false });

        var tasks = Enumerable.Range(0, 100)
            .Select(i => publisher.PublishAsync(new UserCreatedEvent { TenantId = 1, UserId = i }));

        await Task.WhenAll(tasks);
        // All 100 publishes should complete without errors
    }

    [Fact]
    public async Task PublishAsync_ConcurrentFailedPublishes_AreThreadSafe()
    {
        var publisher = CreatePublisher(new RabbitMqOptions
        {
            Enabled = true,
            Host = "nonexistent.invalid",
            Port = 59999
        });

        var tasks = Enumerable.Range(0, 10)
            .Select(i => publisher.PublishAsync(new UserCreatedEvent { TenantId = 1, UserId = i }));

        // All should complete without throwing, despite connection failures
        await Task.WhenAll(tasks);
    }
}
