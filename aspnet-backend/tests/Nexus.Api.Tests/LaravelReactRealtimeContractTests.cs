// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class LaravelReactRealtimeContractTests : IntegrationTestBase
{
    public LaravelReactRealtimeContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task RealtimeConfig_ReturnsLaravelReactPusherBootstrapShape()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/realtime/config");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = await ReadDataAsync(response);
        data.GetProperty("driver").GetString().Should().Be("pusher");
        data.GetProperty("key").GetString().Should().NotBeNull();
        data.GetProperty("cluster").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("authEndpoint").GetString().Should().Be("/api/pusher/auth");
        data.GetProperty("enabled").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task PusherAuth_RejectsMissingSocketOrChannelWithLaravelErrorEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/pusher/auth", new { socket_id = "123.456" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeFalse();
        json.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public async Task MessageTyping_AcceptsLaravelReactRecipientPayload()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/messages/typing", new
        {
            recipient_id = TestData.AdminUser.Id,
            is_typing = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = await ReadDataAsync(response);
        data.GetProperty("sent").GetBoolean().Should().BeTrue();
        data.EnumerateObject().Select(property => property.Name).Should().Equal("sent");
    }

    [Fact]
    public async Task MessageRestrictionStatus_ReturnsLaravelReactShape()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/messages/restriction-status");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = await ReadDataAsync(response);
        data.GetProperty("messaging_disabled").GetBoolean().Should().BeFalse();
        data.GetProperty("under_monitoring").GetBoolean().Should().BeFalse();
        data.GetProperty("restriction_reason").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task MessageInbox_ReturnsLaravelReactCollectionEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/messages");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        json.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        json.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(20);
        json.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task MessageThread_ReturnsLaravelReactUserConversationEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var sendResponse = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Thread contract setup"
        });
        sendResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var sentMessage = await ReadDataAsync(sendResponse);
        sentMessage.GetProperty("id").GetInt32().Should().BeGreaterThan(0);

        var response = await Client.GetAsync($"/api/v2/messages/{TestData.AdminUser.Id}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        json.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        json.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(50);
        json.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();
        json.GetProperty("meta").GetProperty("conversation").GetProperty("other_user").GetProperty("id").GetInt32()
            .Should().Be(TestData.AdminUser.Id);
    }

    [Fact]
    public async Task MessageSendMultipartV2_AcceptsLaravelReactAttachmentsFormData()
    {
        await AuthenticateAsMemberAsync();

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(TestData.AdminUser.Id.ToString()), "recipient_id");
        form.Add(new StringContent(string.Empty), "body");
        using var attachment = new ByteArrayContent("hello from laravel react"u8.ToArray());
        attachment.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        form.Add(attachment, "attachments[]", "hello.txt");

        var response = await Client.PostAsync("/api/v2/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = await ReadDataAsync(response);
        data.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("recipient_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        data.GetProperty("attachments").EnumerateArray().Should().ContainSingle(attachmentJson =>
            attachmentJson.GetProperty("original_filename").GetString() == "hello.txt" &&
            attachmentJson.GetProperty("content_type").GetString() == "text/plain" &&
            attachmentJson.GetProperty("url").GetString()!.Contains("/api/files/"));
    }

    [Fact]
    public async Task MessageVoiceV2_AcceptsLaravelReactVoiceFormData()
    {
        await AuthenticateAsMemberAsync();

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(TestData.AdminUser.Id.ToString()), "recipient_id");
        using var voice = new ByteArrayContent(new byte[] { 0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00 });
        voice.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(voice, "voice_message", "voice-message.webm");

        var response = await Client.PostAsync("/api/v2/messages/voice", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = await ReadDataAsync(response);
        data.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("recipient_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        data.GetProperty("is_voice").GetBoolean().Should().BeTrue();
        data.GetProperty("audio_url").GetString().Should().Contain("/api/files/");
        data.GetProperty("audio_duration").GetInt32().Should().Be(1);
        data.GetProperty("attachments").EnumerateArray().Should().ContainSingle(attachmentJson =>
            attachmentJson.GetProperty("original_filename").GetString() == "voice-message.webm" &&
            attachmentJson.GetProperty("content_type").GetString() == "audio/webm");
    }

    [Fact]
    public async Task MessageUnreadCount_ReturnsLaravelReactCountEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/messages/unread-count");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = await ReadDataAsync(response);
        data.GetProperty("count").GetInt32().Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task MessageReadReceipt_UsesLaravelReactOtherUserId()
    {
        await AuthenticateAsAdminAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.MemberUser.Id,
            body = "Unread contract setup"
        });
        sendResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        await AuthenticateAsMemberAsync();

        var before = await ReadDataAsync(await Client.GetAsync("/api/v2/messages/unread-count"));
        before.GetProperty("count").GetInt32().Should().BeGreaterThan(0);

        var readResponse = await Client.PutAsJsonAsync($"/api/v2/messages/{TestData.AdminUser.Id}/read", new { });

        readResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var readData = await ReadDataAsync(readResponse);
        readData.EnumerateObject().Select(property => property.Name)
            .Should().Equal("marked_read");
        readData.GetProperty("marked_read").GetInt32().Should().BeGreaterThan(0);

        var after = await ReadDataAsync(await Client.GetAsync("/api/v2/messages/unread-count"));
        after.GetProperty("count").GetInt32().Should().Be(0);
    }

    [Fact]
    public async Task MessageTranslate_UsesStoredMessageContent()
    {
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Translate this message"
        });
        sendResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var sentMessage = await ReadDataAsync(sendResponse);
        var messageId = sentMessage.GetProperty("id").GetInt32();

        var response = await Client.PostAsJsonAsync($"/api/v2/messages/{messageId}/translate", new
        {
            target_language = "en"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = await ReadDataAsync(response);
        data.GetProperty("translated_text").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("source_type").GetString().Should().Be("body");
    }

    [Fact]
    public async Task MessageReaction_TogglesLaravelReactAction()
    {
        await AuthenticateAsMemberAsync();
        var sendResponse = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "React to this message"
        });
        sendResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var sentMessage = await ReadDataAsync(sendResponse);
        var messageId = sentMessage.GetProperty("id").GetInt32();

        var addedResponse = await Client.PostAsJsonAsync($"/api/v2/messages/{messageId}/reactions", new
        {
            emoji = "\U0001F44D"
        });

        addedResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var added = await ReadDataAsync(addedResponse);
        added.GetProperty("action").GetString().Should().Be("added");
        added.GetProperty("emoji").GetString().Should().Be("\U0001F44D");
        added.GetProperty("message_id").GetInt32().Should().Be(messageId);

        var removedResponse = await Client.PostAsJsonAsync($"/api/v2/messages/{messageId}/reactions", new
        {
            emoji = "\U0001F44D"
        });

        removedResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var removed = await ReadDataAsync(removedResponse);
        removed.GetProperty("action").GetString().Should().Be("removed");
    }

    private static async Task<JsonElement> ReadDataAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        if (json.TryGetProperty("success", out var success))
        {
            success.GetBoolean().Should().BeTrue();
        }
        return json.GetProperty("data");
    }
}
