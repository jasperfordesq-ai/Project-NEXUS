// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class PusherEventPublisherTests
{
    [Fact]
    public async Task TriggerAsync_BuildsCanonicalSignedPusherRequest()
    {
        var handler = new RecordingHandler();
        using var client = new HttpClient(handler);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["Pusher:AppId"] = "app-42",
                ["Pusher:Key"] = "public-key",
                ["Pusher:Secret"] = "secret-value",
                ["Pusher:ApiHost"] = "https://pusher.example.test"
            }).Build();
        var publisher = new PusherEventPublisher(
            client,
            configuration,
            NullLogger<PusherEventPublisher>.Instance);

        var sent = await publisher.TriggerAsync(
            "private-tenant.7.user.9",
            "typing",
            new { user_id = 3, is_typing = true });

        sent.Should().BeTrue();
        handler.Uri.Should().NotBeNull();
        handler.Uri!.GetLeftPart(UriPartial.Path).Should().Be(
            "https://pusher.example.test/apps/app-42/events");
        var query = ParseQuery(handler.Uri.Query);
        query["auth_key"].Should().Be("public-key");
        query["auth_version"].Should().Be("1.0");
        query["body_md5"].Should().Be(
            Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(handler.Body!))).ToLowerInvariant());
        var unsigned = $"auth_key={query["auth_key"]}&auth_timestamp={query["auth_timestamp"]}&auth_version=1.0&body_md5={query["body_md5"]}";
        var expectedSignature = Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes("secret-value"),
            Encoding.UTF8.GetBytes($"POST\n/apps/app-42/events\n{unsigned}"))).ToLowerInvariant();
        query["auth_signature"].Should().Be(expectedSignature);

        using var document = JsonDocument.Parse(handler.Body!);
        document.RootElement.GetProperty("name").GetString().Should().Be("typing");
        document.RootElement.GetProperty("channels").EnumerateArray().Single().GetString()
            .Should().Be("private-tenant.7.user.9");
        using var payload = JsonDocument.Parse(document.RootElement.GetProperty("data").GetString()!);
        payload.RootElement.GetProperty("user_id").GetInt32().Should().Be(3);
        payload.RootElement.GetProperty("is_typing").GetBoolean().Should().BeTrue();
    }

    private static Dictionary<string, string> ParseQuery(string query)
        => query.TrimStart('?').Split('&').Select(part => part.Split('=', 2))
            .ToDictionary(parts => Uri.UnescapeDataString(parts[0]), parts => Uri.UnescapeDataString(parts[1]));

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public Uri? Uri { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Uri = request.RequestUri;
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }
}
