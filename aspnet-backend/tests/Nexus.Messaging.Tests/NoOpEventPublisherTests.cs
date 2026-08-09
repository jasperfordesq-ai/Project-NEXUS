// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using Nexus.Contracts.Events;

namespace Nexus.Messaging.Tests;

public class NoOpEventPublisherTests
{
    private readonly Mock<ILogger<NoOpEventPublisher>> _loggerMock = new();
    private readonly NoOpEventPublisher _sut;

    public NoOpEventPublisherTests()
    {
        _sut = new NoOpEventPublisher(_loggerMock.Object);
    }

    [Fact]
    public async Task PublishAsync_ReturnsCompletedTask()
    {
        var @event = new UserCreatedEvent
        {
            TenantId = 1,
            UserId = 42,
            Email = "test@example.com"
        };

        var task = _sut.PublishAsync(@event);

        task.IsCompleted.Should().BeTrue();
        await task; // should not throw
    }

    [Fact]
    public async Task PublishAsync_LogsDebugMessage()
    {
        var @event = new UserCreatedEvent
        {
            TenantId = 1,
            UserId = 42,
            Email = "test@example.com"
        };

        await _sut.PublishAsync(@event);

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Debug,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("user.created")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Fact]
    public async Task PublishAsync_LogsCorrectEventType_ForDifferentEvents()
    {
        var @event = new UserSuspendedEvent
        {
            TenantId = 2,
            UserId = 99
        };

        await _sut.PublishAsync(@event);

        _loggerMock.Verify(
            x => x.Log(
                LogLevel.Debug,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString()!.Contains("user.suspended")),
                null,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Fact]
    public async Task PublishAsync_SupportsCancellationToken()
    {
        using var cts = new CancellationTokenSource();
        var @event = new UserCreatedEvent { TenantId = 1 };

        // Should complete normally even with a live cancellation token
        await _sut.PublishAsync(@event, cts.Token);
    }

    [Fact]
    public void Implements_IEventPublisher()
    {
        _sut.Should().BeAssignableTo<IEventPublisher>();
    }
}
