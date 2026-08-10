// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Nexus.Messaging.Configuration;

namespace Nexus.Messaging.Tests;

public class ServiceCollectionExtensionsTests
{
    [Fact]
    public void AddEventPublishing_WhenDisabled_RegistersNoOpEventPublisher()
    {
        var config = BuildConfig(enabled: false);
        var services = new ServiceCollection();
        services.AddLogging();

        services.AddEventPublishing(config);

        var provider = services.BuildServiceProvider();
        var publisher = provider.GetRequiredService<IEventPublisher>();

        publisher.Should().BeOfType<NoOpEventPublisher>();
    }

    [Fact]
    public void AddEventPublishing_WhenEnabled_RegistersRabbitMqPublisher()
    {
        var config = BuildConfig(enabled: true);
        var services = new ServiceCollection();
        services.AddLogging();

        services.AddEventPublishing(config);

        var provider = services.BuildServiceProvider();
        var publisher = provider.GetRequiredService<IEventPublisher>();

        publisher.Should().BeOfType<RabbitMqPublisher>();
    }

    [Fact]
    public void AddEventPublishing_MissingSection_RegistersNoOpEventPublisher()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();

        services.AddEventPublishing(config);

        var provider = services.BuildServiceProvider();
        var publisher = provider.GetRequiredService<IEventPublisher>();

        publisher.Should().BeOfType<NoOpEventPublisher>();
    }

    [Fact]
    public void AddEventPublishing_ConfiguresRabbitMqOptions()
    {
        var config = BuildConfig(enabled: false, host: "custom-host", port: 5673);
        var services = new ServiceCollection();
        services.AddLogging();

        services.AddEventPublishing(config);

        var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<RabbitMqOptions>>().Value;

        options.Host.Should().Be("custom-host");
        options.Port.Should().Be(5673);
    }

    [Fact]
    public void AddEventPublishing_RegistersAsSingleton()
    {
        var config = BuildConfig(enabled: false);
        var services = new ServiceCollection();
        services.AddLogging();

        services.AddEventPublishing(config);

        var descriptor = services.First(d => d.ServiceType == typeof(IEventPublisher));
        descriptor.Lifetime.Should().Be(ServiceLifetime.Singleton);
    }

    [Fact]
    public void AddEventPublishing_ReturnsSameServiceCollection()
    {
        var config = BuildConfig(enabled: false);
        var services = new ServiceCollection();
        services.AddLogging();

        var result = services.AddEventPublishing(config);

        result.Should().BeSameAs(services);
    }

    private static IConfiguration BuildConfig(
        bool enabled,
        string host = "localhost",
        int port = 5672)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["RabbitMq:Host"] = host,
                ["RabbitMq:Port"] = port.ToString(),
                ["RabbitMq:Enabled"] = enabled.ToString()
            })
            .Build();
    }
}
