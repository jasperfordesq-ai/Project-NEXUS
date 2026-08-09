// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class DirectMessageParityCorrectionsTests : IntegrationTestBase
{
    public DirectMessageParityCorrectionsTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    [Fact]
    public async Task V2Send_PersistsSanitizedMessageNotificationAndXp_WithPlain201EnvelopeAndPartnerInboxId()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "  <strong>Hello from parity</strong>  "
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().BeNull("Laravel returns a data envelope, not a REST Location header");
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("success", out _).Should().BeFalse();
        json.TryGetProperty("meta", out _).Should().BeTrue();
        var data = json.GetProperty("data");
        data.GetProperty("content").GetString().Should().Be("Hello from parity");
        data.GetProperty("body").GetString().Should().Be("Hello from parity");
        data.GetProperty("receiver_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        var messageId = data.GetProperty("id").GetInt32();
        var conversationId = data.GetProperty("conversation_id").GetInt32();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.Messages.IgnoreQueryFilters().SingleAsync()).Content.Should().Be("Hello from parity");
            var notification = await db.Notifications.IgnoreQueryFilters().SingleAsync(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.UserId == TestData.AdminUser.Id
                && row.Type == "new_message");
            notification.Link.Should().Be($"/messages/{TestData.MemberUser.Id}");
            notification.Data.Should().Contain($"\"message_id\":{messageId}");

            var xp = await db.XpLogs.IgnoreQueryFilters().SingleAsync(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.UserId == TestData.MemberUser.Id
                && row.Source == "send_message"
                && row.ReferenceId == messageId);
            xp.Amount.Should().Be(2);
            (await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Id == TestData.MemberUser.Id))
                .TotalXp.Should().Be(TestData.MemberUser.TotalXp + 2);
        }

        var inboxResponse = await Client.GetAsync("/api/v2/messages");
        inboxResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var inbox = await inboxResponse.Content.ReadFromJsonAsync<JsonElement>();
        var row = inbox.GetProperty("data").EnumerateArray().Single();
        row.GetProperty("id").GetInt32().Should().Be(TestData.AdminUser.Id);
        row.GetProperty("partner_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        row.GetProperty("conversation_id").GetInt32().Should().Be(conversationId);
    }

    [Fact]
    public async Task V2Send_UsesDetectedMimeAndProjectsCanonicalAttachmentAliasesOnSendAndThread()
    {
        await AuthenticateAsMemberAsync();
        var bytes = Encoding.UTF8.GetBytes("name,hours\nmember,2\n");
        using var form = MessageForm(
            TestData.AdminUser.Id,
            string.Empty,
            "hours.csv",
            "application/octet-stream",
            bytes);

        var response = await Client.PostAsync("/api/v2/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var attachment = json.GetProperty("data").GetProperty("attachments").EnumerateArray().Single();
        AssertCanonicalAttachment(attachment, "hours.csv", "text/plain", "file", bytes.Length);
        var messageId = json.GetProperty("data").GetProperty("id").GetInt32();

        var threadResponse = await Client.GetAsync($"/api/v2/messages/{TestData.AdminUser.Id}");
        threadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var thread = await threadResponse.Content.ReadFromJsonAsync<JsonElement>();
        var message = thread.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == messageId);
        var loadedAttachment = message.GetProperty("attachments").EnumerateArray().Single();
        AssertCanonicalAttachment(loadedAttachment, "hours.csv", "text/plain", "file", bytes.Length);
    }

    [Fact]
    public async Task V2Send_RejectsSpoofedPngBytesAndLeavesNoUploadOrStoredFile()
    {
        await AuthenticateAsMemberAsync();
        var filesBefore = SnapshotStoredFiles();
        using var form = MessageForm(
            TestData.AdminUser.Id,
            "Spoof attempt",
            "payload.png",
            "image/png",
            [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

        var response = await Client.PostAsync("/api/v2/messages", form);

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var error = (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors").EnumerateArray().Single();
        error.GetProperty("message").GetString().Should().Be("That attachment type is not allowed");
        error.GetProperty("field").GetString().Should().Be("attachments");
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.FileUploads.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.Messages.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        SnapshotStoredFiles().Should().BeEquivalentTo(filesBefore);
    }

    [Fact]
    public async Task V2Send_ConcurrentFirstMessagesReuseOneNormalizedConversation()
    {
        await AuthenticateAsMemberAsync();

        var first = Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "first concurrent message"
        });
        var second = Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "second concurrent message"
        });
        var responses = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(30));

        responses.Should().OnlyContain(response => response.StatusCode == HttpStatusCode.Created);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Conversations.IgnoreQueryFilters().CountAsync()).Should().Be(1);
        (await db.Messages.IgnoreQueryFilters().CountAsync()).Should().Be(2);
        (await db.Messages.IgnoreQueryFilters().Select(message => message.ConversationId).Distinct().CountAsync())
            .Should().Be(1);
    }

    [Fact]
    public async Task V2Send_AllowsExistingInactiveRecipientAndAtomicallyExpiresSenderRestriction()
    {
        await AuthenticateAsMemberAsync();
        using (var setup = Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
            var recipient = await db.Users.IgnoreQueryFilters()
                .SingleAsync(user => user.Id == TestData.AdminUser.Id);
            recipient.IsActive = false;
            recipient.SuspendedAt = DateTime.UtcNow;
            db.UserMonitoringRestrictions.Add(new UserMonitoringRestriction
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                UnderMonitoring = true,
                MessagingDisabled = true,
                MonitoringExpiresAt = DateTime.UtcNow.AddMinutes(-1),
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var response = await Client.PostAsJsonAsync("/api/v2/messages", new
        {
            recipient_id = TestData.AdminUser.Id,
            body = "Recipient existence is the Laravel contract"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var restriction = await verifyDb.UserMonitoringRestrictions.IgnoreQueryFilters().SingleAsync();
        restriction.UnderMonitoring.Should().BeFalse();
        restriction.MessagingDisabled.Should().BeFalse();
        restriction.MonitoringExpiresAt.Should().BeNull();
    }

    [Fact]
    public async Task FileUploadService_PartialStreamFailureDeletesTemporaryBytesAndDoesNotCreateRow()
    {
        var root = Path.Combine(Path.GetTempPath(), $"nexus-message-upload-{Guid.NewGuid():N}");
        try
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["FileUpload:UploadsRoot"] = root
                })
                .Build();
            var service = new FileUploadService(db, configuration, NullLogger<FileUploadService>.Instance);
            await using var stream = new ThrowingAfterFirstReadStream(Encoding.UTF8.GetBytes("partial text"));

            Func<Task> upload = async () =>
            {
                await service.UploadAsync(
                    stream,
                    "partial.txt",
                    "text/plain",
                    64,
                    TestData.MemberUser.Id,
                    TestData.Tenant1.Id,
                    FileCategory.Message);
            };

            await upload.Should().ThrowAsync<IOException>();
            Directory.Exists(root).Should().BeTrue();
            Directory.GetFiles(root, "*", SearchOption.AllDirectories).Should().BeEmpty();
            (await db.FileUploads.IgnoreQueryFilters().CountAsync(row => row.OriginalFilename == "partial.txt"))
                .Should().Be(0);
        }
        finally
        {
            if (Directory.Exists(root))
                Directory.Delete(root, recursive: true);
        }
    }

    private static void AssertCanonicalAttachment(
        JsonElement attachment,
        string filename,
        string mime,
        string type,
        int size)
    {
        attachment.GetProperty("name").GetString().Should().Be(filename);
        attachment.GetProperty("file_name").GetString().Should().Be(filename);
        attachment.GetProperty("mime_type").GetString().Should().Be(mime);
        attachment.GetProperty("content_type").GetString().Should().Be(mime);
        attachment.GetProperty("type").GetString().Should().Be(type);
        attachment.GetProperty("size").GetInt64().Should().Be(size);
        attachment.GetProperty("file_size").GetInt64().Should().Be(size);
        attachment.GetProperty("url").GetString().Should().StartWith("/api/files/");
    }

    private static MultipartFormDataContent MessageForm(
        int recipientId,
        string body,
        string filename,
        string contentType,
        byte[] bytes)
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(recipientId.ToString()), "recipient_id");
        form.Add(new StringContent(body), "body");
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "attachments[]", filename);
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

    private sealed class ThrowingAfterFirstReadStream(byte[] bytes) : Stream
    {
        private bool _returnedBytes;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => bytes.Length;
        public override long Position { get => _returnedBytes ? bytes.Length : 0; set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_returnedBytes)
                throw new IOException("Synthetic stream failure");

            _returnedBytes = true;
            var length = Math.Min(count, bytes.Length);
            bytes.AsSpan(0, length).CopyTo(buffer.AsSpan(offset, length));
            return length;
        }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_returnedBytes)
                return ValueTask.FromException<int>(new IOException("Synthetic stream failure"));

            _returnedBytes = true;
            var length = Math.Min(buffer.Length, bytes.Length);
            bytes.AsMemory(0, length).CopyTo(buffer);
            return ValueTask.FromResult(length);
        }

        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
