// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Auth-gate tests for MessageAttachmentsController.
 * Verifies the class-level [Authorize] gate on /api/messages/{id}/attachments.
 */

using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class MessageAttachmentsControllerAuthTests : IntegrationTestBase
{
    public MessageAttachmentsControllerAuthTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/messages/999999/attachments";

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]

    [InlineData("member", 200)]
    public async Task MemberAuthGate(string role, int expectedStatus)
    {
        if (role == "anonymous")
        {
            ClearAuthToken();
        }
        else
        {
            var email = role == "admin" ? "admin@test.com" : "member@test.com";
            var token = await GetAccessTokenAsync(email, "test-tenant");
            SetAuthToken(token);
        }

        var resp = await Client.GetAsync(Path);

        if (role == "member")
        {
            var code = (int)resp.StatusCode;
            code.Should().NotBe(401, $"member must not get auth-rejected on {Path}");
            code.Should().NotBe(403, $"{role} must not get authz-rejected on {Path}");
        }
        else
        {
            ((int)resp.StatusCode).Should().Be(expectedStatus);
        }
    }
}
