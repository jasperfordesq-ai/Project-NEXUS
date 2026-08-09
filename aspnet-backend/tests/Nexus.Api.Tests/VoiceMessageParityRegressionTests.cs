// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class VoiceMessageParityRegressionTests : IntegrationTestBase
{
    public VoiceMessageParityRegressionTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task V2Voice_ValidWebmCommitsWholeGraphAndEffects_WithoutWeakeningAttachments()
    {
        await AuthenticateAsMemberAsync();
        using var form = VoiceForm(TestData.AdminUser.Id, "voice-message.webm", "audio/webm",
            [0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);

        var response = await Client.PostAsync("/api/v2/messages/voice", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var root = await response.Content.ReadFromJsonAsync<JsonElement>();
        root.TryGetProperty("success", out _).Should().BeFalse();
        root.TryGetProperty("meta", out _).Should().BeTrue();
        var data = root.GetProperty("data");
        data.GetProperty("is_voice").GetBoolean().Should().BeTrue();
        data.GetProperty("audio_duration").GetInt32().Should().Be(1);
        data.GetProperty("audio_url").GetString().Should().StartWith("/api/files/");
        var messageId = data.GetProperty("id").GetInt32();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.Conversations.IgnoreQueryFilters().CountAsync()).Should().Be(1);
            (await db.Messages.IgnoreQueryFilters().CountAsync()).Should().Be(1);
            (await db.MessageAttachments.CountAsync()).Should().Be(1);
            (await db.VoiceMessages.IgnoreQueryFilters().CountAsync()).Should().Be(1);
            var upload = await db.FileUploads.IgnoreQueryFilters().SingleAsync();
            upload.ContentType.Should().Be("audio/webm");
            upload.EntityType.Should().Be("message_voice");
            upload.EntityId.Should().Be(messageId);
            File.Exists(scope.ServiceProvider.GetRequiredService<FileUploadService>().GetFullPath(upload)).Should().BeTrue();
            (await db.Notifications.IgnoreQueryFilters().CountAsync(row => row.Type == "new_message")).Should().Be(1);
            (await db.XpLogs.IgnoreQueryFilters().CountAsync(row =>
                row.Source == "send_message" && row.ReferenceId == messageId && row.Amount == 2)).Should().Be(1);
        }

        using var ordinary = new MultipartFormDataContent();
        ordinary.Add(new StringContent(TestData.AdminUser.Id.ToString()), "recipient_id");
        ordinary.Add(new StringContent(string.Empty), "body");
        var ordinaryAudio = new ByteArrayContent([0x1a, 0x45, 0xdf, 0xa3]);
        ordinaryAudio.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        ordinary.Add(ordinaryAudio, "attachments[]", "ordinary.webm");
        var ordinaryResponse = await Client.PostAsync("/api/v2/messages", ordinary);
        ordinaryResponse.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.Messages.IgnoreQueryFilters().CountAsync()).Should().Be(1);
        (await verifyDb.FileUploads.IgnoreQueryFilters().CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task V2Voice_SpoofedWebmReturnsUploadFailureWithoutGhostWritesOrFiles()
    {
        await AuthenticateAsMemberAsync();
        var before = SnapshotStoredFiles();
        using var form = VoiceForm(TestData.AdminUser.Id, "spoof.webm", "audio/webm",
            [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

        var response = await Client.PostAsync("/api/v2/messages/voice", form);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors").EnumerateArray().Single();
        error.GetProperty("code").GetString().Should().Be("UPLOAD_FAILED");
        error.GetProperty("field").GetString().Should().Be("voice_message");
        await AssertNoVoiceSideEffectsAsync();
        SnapshotStoredFiles().Should().BeEquivalentTo(before);
    }

    [Fact]
    public async Task V2Voice_MessagingRestrictionRejectsBeforeAudioStaging()
    {
        using (var setup = Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.UserMonitoringRestrictions.Add(new UserMonitoringRestriction
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                UnderMonitoring = true,
                MessagingDisabled = true,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }
        await AuthenticateAsMemberAsync();
        var before = SnapshotStoredFiles();
        using var form = VoiceForm(TestData.AdminUser.Id, "blocked.webm", "audio/webm",
            [0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86]);

        var response = await Client.PostAsync("/api/v2/messages/voice", form);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors").EnumerateArray().Single();
        error.GetProperty("code").GetString().Should().Be("MESSAGING_DISABLED");
        await AssertNoVoiceSideEffectsAsync();
        SnapshotStoredFiles().Should().BeEquivalentTo(before);
    }

    private async Task AssertNoVoiceSideEffectsAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Conversations.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.Messages.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.MessageAttachments.CountAsync()).Should().Be(0);
        (await db.VoiceMessages.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.FileUploads.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.Notifications.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.XpLogs.IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    private static MultipartFormDataContent VoiceForm(
        int recipientId,
        string filename,
        string contentType,
        byte[] bytes)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(recipientId.ToString()), "recipient_id");
        var voice = new ByteArrayContent(bytes);
        voice.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(voice, "voice_message", filename);
        return form;
    }

    private static string[] SnapshotStoredFiles()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "uploads");
        return Directory.Exists(root)
            ? Directory.GetFiles(root, "*", SearchOption.AllDirectories)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray()
            : [];
    }
}
