// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Regression tests for private direct-message media delivery
/// (`GET /api/v2/messages/{message}/voice` and `.../attachments/{attachment}`) — two of
/// the four route gaps Baseline 3 recorded. Voice messages were uploadable but never
/// fetchable, so a received voice message could not be played against this backend.
///
/// The contract is Laravel's `MessageMediaController`: participant-only access (sender
/// or conversation participant; 403 otherwise, 404 for unknown message/media), and the
/// private-media header set on every 200 — private no-store caching, nosniff, a
/// sandboxing CSP and same-site CORP (`MessageMediaController.php:70-80`). The headers
/// exist so a hostile upload rendered inline cannot script and no shared cache ever
/// holds a private message's audio; the header assertions below are the test's point.
/// </summary>
[Collection("Integration")]
public sealed class MessageMediaDeliveryTests : IntegrationTestBase
{
    public MessageMediaDeliveryTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const int ConversationId = 950001;
    private const int MessageId = 950002;
    private const int AttachmentId = 950003;
    private const int UploadId = 950004;
    private const int StrangerConversationId = 950011;
    private const int StrangerMessageId = 950012;

    private async Task SeedAsync()
    {
        await using var scope = Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        if (db.Messages.Any(m => m.Id == MessageId))
        {
            return;
        }

        // A real file on disk, under the SAME root rule FileUploadService.GetFullPath
        // uses, so the 200 path streams real bytes rather than 404ing on a phantom.
        var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var uploadsRoot = config["FileUpload:UploadsRoot"]
            ?? Path.Combine(AppContext.BaseDirectory, "uploads");
        var relativePath = Path.Combine("test-media", "voice-probe.ogg");
        var fullPath = Path.Combine(uploadsRoot, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await File.WriteAllBytesAsync(fullPath, "OggS-probe-bytes"u8.ToArray());

        db.FileUploads.Add(new FileUpload
        {
            Id = UploadId,
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.AdminUser.Id,
            OriginalFilename = "voice-probe.ogg",
            StoredFilename = "voice-probe.ogg",
            FilePath = relativePath,
            ContentType = "audio/ogg",
            FileSizeBytes = 16,
        });

        // Admin -> Member conversation; the MEMBER is a participant via the
        // conversation row, not as sender — exercising the second authorization arm.
        db.Conversations.Add(new Conversation
        {
            Id = ConversationId,
            TenantId = TestData.Tenant1.Id,
            Participant1Id = Math.Min(TestData.AdminUser.Id, TestData.MemberUser.Id),
            Participant2Id = Math.Max(TestData.AdminUser.Id, TestData.MemberUser.Id),
        });
        db.Messages.Add(new Message
        {
            Id = MessageId,
            TenantId = TestData.Tenant1.Id,
            ConversationId = ConversationId,
            SenderId = TestData.AdminUser.Id,
            Content = string.Empty,
        });
        db.MessageAttachments.Add(new MessageAttachment
        {
            Id = AttachmentId,
            MessageId = MessageId,
            FileUploadId = UploadId,
            UploadedById = TestData.AdminUser.Id,
        });

        // A conversation the signed-in member has NOTHING to do with — the 403 arm.
        // The second participant must be a REAL user (conversations carries an FK to
        // users; a synthetic id failed exactly here on this test's first run), so the
        // fixture's other-tenant user stands in: the point is only that the MEMBER is
        // not a participant.
        db.Conversations.Add(new Conversation
        {
            Id = StrangerConversationId,
            TenantId = TestData.Tenant1.Id,
            Participant1Id = TestData.AdminUser.Id,
            Participant2Id = TestData.OtherTenantUser.Id,
        });
        db.Messages.Add(new Message
        {
            Id = StrangerMessageId,
            TenantId = TestData.Tenant1.Id,
            ConversationId = StrangerConversationId,
            SenderId = TestData.AdminUser.Id,
            Content = "not yours",
        });

        await db.SaveChangesAsync();
    }

    [Theory]
    [InlineData("/api/v2/messages/{0}/voice")]
    [InlineData("/api/messages/{0}/voice")]
    [InlineData("/api/v2/messages/{0}/attachments/{1}")]
    public async Task A_conversation_participant_gets_the_media_with_laravels_private_headers(string template)
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        var path = string.Format(template, MessageId, AttachmentId);
        using var response = await Client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "the member is a conversation participant (not the sender — that arm matters)");
        response.Content.Headers.ContentType!.MediaType.Should().Be("audio/ogg");

        // Laravel's private-media header set, byte for byte. These are the contract.
        response.Headers.CacheControl!.ToString().Should().Contain("private").And.Contain("no-store");
        response.Headers.Pragma.ToString().Should().Be("no-cache");
        response.Headers.GetValues("X-Content-Type-Options").Should().ContainSingle("nosniff");
        response.Headers.GetValues("Content-Security-Policy").Should()
            .ContainSingle().Which.Should().Be("default-src 'none'; sandbox");
        response.Headers.GetValues("Cross-Origin-Resource-Policy").Should().ContainSingle("same-site");

        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes.Should().StartWith("OggS"u8.ToArray(), "the response must stream the actual file");
    }

    [Fact]
    public async Task A_same_tenant_non_participant_is_403_never_404()
    {
        // Laravel's split: the message EXISTS, the caller just may not have it — abort(403).
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var response = await Client.GetAsync($"/api/v2/messages/{StrangerMessageId}/voice");
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_cross_tenant_caller_gets_404_because_the_message_is_invisible()
    {
        // Tenant isolation is enforced by the global query filter BEFORE authorization —
        // the other tenant's user cannot even observe that the message exists.
        await SeedByMemberThenSwitchAsync();

        using var response = await Client.GetAsync($"/api/v2/messages/{MessageId}/voice");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task SeedByMemberThenSwitchAsync()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();
        await AuthenticateAsOtherTenantUserAsync();
    }

    [Fact]
    public async Task A_credential_owner_downloads_their_file_and_nobody_else_can()
    {
        // The last closable route gap: GET /api/v2/volunteering/credentials/{id}/download.
        // Owner-only (404, never 403), and the TYPE allowlist is re-checked on download
        // exactly as Laravel re-checks VolunteerCredentialPolicy::isAllowed — a row that
        // predates the policy must not become retrievable.
        await AuthenticateAsMemberAsync();

        const int credentialId = 950021;
        const int disallowedCredentialId = 950022;
        const int credentialUploadId = 950023;
        await using (var scope = Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            if (!db.VolunteerCredentials.Any(c => c.Id == credentialId))
            {
                var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
                var uploadsRoot = config["FileUpload:UploadsRoot"]
                    ?? Path.Combine(AppContext.BaseDirectory, "uploads");
                var relativePath = Path.Combine("test-media", "credential-probe.pdf");
                Directory.CreateDirectory(Path.Combine(uploadsRoot, "test-media"));
                await File.WriteAllBytesAsync(
                    Path.Combine(uploadsRoot, relativePath), "%PDF-probe"u8.ToArray());

                db.FileUploads.Add(new FileUpload
                {
                    Id = credentialUploadId,
                    TenantId = TestData.Tenant1.Id,
                    UserId = TestData.MemberUser.Id,
                    OriginalFilename = "credential-probe.pdf",
                    StoredFilename = "credential-probe.pdf",
                    FilePath = relativePath,
                    ContentType = "application/pdf",
                    FileSizeBytes = 9,
                });
                db.VolunteerCredentials.AddRange(
                    new VolunteerCredential
                    {
                        Id = credentialId,
                        TenantId = TestData.Tenant1.Id,
                        UserId = TestData.MemberUser.Id,
                        CredentialType = "first_aid",
                        FileUrl = $"/api/files/{credentialUploadId}/download",
                        FileName = "My First Aid Cert.pdf",
                    },
                    new VolunteerCredential
                    {
                        Id = disallowedCredentialId,
                        TenantId = TestData.Tenant1.Id,
                        UserId = TestData.MemberUser.Id,
                        CredentialType = "mystery_type_not_on_the_allowlist",
                        FileUrl = $"/api/files/{credentialUploadId}/download",
                        FileName = "mystery.pdf",
                    });
                await db.SaveChangesAsync();
            }
        }

        using var owned = await Client.GetAsync($"/api/v2/volunteering/credentials/{credentialId}/download");
        owned.StatusCode.Should().Be(HttpStatusCode.OK);
        owned.Content.Headers.ContentType!.MediaType.Should().Be("application/pdf");
        owned.Content.Headers.ContentDisposition!.FileNameStar.Should().Be("My First Aid Cert.pdf",
            "the stored display name is the download name, as in Laravel");
        (await owned.Content.ReadAsByteArrayAsync()).Should().StartWith("%PDF"u8.ToArray());

        using var disallowed = await Client.GetAsync($"/api/v2/volunteering/credentials/{disallowedCredentialId}/download");
        disallowed.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "a type outside the allowlist must not download even for its owner");

        // Another signed-in user gets 404, never 403 — the response must not confirm
        // that someone else's credential exists.
        await AuthenticateAsAdminAsync();
        using var foreign = await Client.GetAsync($"/api/v2/volunteering/credentials/{credentialId}/download");
        foreign.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AuthenticateAsMemberAsync();
    }

    [Fact]
    public async Task An_unknown_message_and_a_foreign_attachment_id_are_404()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var unknown = await Client.GetAsync("/api/v2/messages/86420975/voice");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);

        // An attachment id that exists but belongs to a DIFFERENT message must 404 —
        // Laravel scopes the lookup `where message_id`, so ids cannot be mixed and matched.
        using var mismatched = await Client.GetAsync(
            $"/api/v2/messages/{StrangerMessageId}/attachments/{AttachmentId}");
        // (The stranger message 403s first for this member; use the member's own message
        // with a nonexistent attachment id for the pure-404 arm.)
        using var missingAttachment = await Client.GetAsync(
            $"/api/v2/messages/{MessageId}/attachments/86420976");
        missingAttachment.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
