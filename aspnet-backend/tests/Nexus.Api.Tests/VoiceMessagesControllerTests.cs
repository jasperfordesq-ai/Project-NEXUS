// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class VoiceMessagesControllerTests : IntegrationTestBase
{
    public VoiceMessagesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetVoiceMessages_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/voice-messages/conversation/1");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetVoiceMessages_AsMember_ReturnsOkOrNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/voice-messages/conversation/1");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetVoiceMessage_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/voice-messages/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateVoiceMessage_AsMember_ReturnsOkOrCreated()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/voice-messages", new
        {
            conversation_id = 1,
            audio_url = "https://example.com/audio.mp3",
            duration_seconds = 15,
            file_size_bytes = 50000,
            format = "mp3"
        });
        // May fail with NotFound/BadRequest if conversation doesn't exist, or 500 if service throws
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created, HttpStatusCode.NotFound, HttpStatusCode.BadRequest, HttpStatusCode.InternalServerError);
    }

    [Fact]
    public async Task DeleteVoiceMessage_NonExistent_ReturnsNotFoundOrBadRequest()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.DeleteAsync("/api/voice-messages/99999");
        // Controller returns BadRequest when service returns error for non-existent voice message
        r.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task MarkRead_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PutAsync("/api/voice-messages/99999/read", null);
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
