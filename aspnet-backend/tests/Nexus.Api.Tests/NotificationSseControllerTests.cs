// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class NotificationSseControllerTests : IntegrationTestBase
{
    public NotificationSseControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Stream_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/notifications/stream");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
