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

public class RabbitMqOptionsTests
{
    [Fact]
    public void SectionName_IsRabbitMq()
    {
        RabbitMqOptions.SectionName.Should().Be("RabbitMq");
    }

    [Fact]
    public void Defaults_AreCorrect()
    {
        var options = new RabbitMqOptions();

        options.Host.Should().Be("localhost");
        options.Port.Should().Be(5672);
        options.Username.Should().Be("guest");
        options.Password.Should().Be("guest");
        options.VirtualHost.Should().Be("/");
        options.ExchangeName.Should().Be("nexus.events");
        options.Enabled.Should().BeFalse();
    }

    [Fact]
    public void Properties_CanBeSet()
    {
        var options = new RabbitMqOptions
        {
            Host = "rabbitmq.prod",
            Port = 5673,
            Username = "admin",
            Password = "secret",
            VirtualHost = "/nexus",
            ExchangeName = "custom.exchange",
            Enabled = true
        };

        options.Host.Should().Be("rabbitmq.prod");
        options.Port.Should().Be(5673);
        options.Username.Should().Be("admin");
        options.Password.Should().Be("secret");
        options.VirtualHost.Should().Be("/nexus");
        options.ExchangeName.Should().Be("custom.exchange");
        options.Enabled.Should().BeTrue();
    }

    [Fact]
    public void BindsFromConfiguration()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["RabbitMq:Host"] = "rabbit.example.com",
                ["RabbitMq:Port"] = "5673",
                ["RabbitMq:Username"] = "nexus-user",
                ["RabbitMq:Password"] = "nexus-pass",
                ["RabbitMq:VirtualHost"] = "/prod",
                ["RabbitMq:ExchangeName"] = "prod.events",
                ["RabbitMq:Enabled"] = "true"
            })
            .Build();

        var services = new ServiceCollection();
        services.Configure<RabbitMqOptions>(config.GetSection(RabbitMqOptions.SectionName));
        var provider = services.BuildServiceProvider();

        var options = provider.GetRequiredService<IOptions<RabbitMqOptions>>().Value;

        options.Host.Should().Be("rabbit.example.com");
        options.Port.Should().Be(5673);
        options.Username.Should().Be("nexus-user");
        options.Password.Should().Be("nexus-pass");
        options.VirtualHost.Should().Be("/prod");
        options.ExchangeName.Should().Be("prod.events");
        options.Enabled.Should().BeTrue();
    }

    [Fact]
    public void BindsFromConfiguration_MissingSection_UsesDefaults()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        var options = config.GetSection(RabbitMqOptions.SectionName).Get<RabbitMqOptions>()
            ?? new RabbitMqOptions();

        options.Host.Should().Be("localhost");
        options.Port.Should().Be(5672);
        options.Enabled.Should().BeFalse();
    }
}
