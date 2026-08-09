// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class GroupInviteAndExportLifecycleTests : IntegrationTestBase
{
    public GroupInviteAndExportLifecycleTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task LinkInvite_PreviewAndAccept_AreCanonicalAndIdempotent()
    {
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync("Canonical invite lifecycle");
        var create = await Client.PostAsync($"/api/groups/{groupId}/invites/link", null);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var token = created.GetProperty("data").GetProperty("token").GetString()!;

        await AuthenticateAsAdminAsync();
        var preview = await Client.GetAsync($"/api/v2/groups/invite/{token}");
        preview.StatusCode.Should().Be(HttpStatusCode.OK);
        var previewJson = await preview.Content.ReadFromJsonAsync<JsonElement>();
        previewJson.GetProperty("data").GetProperty("invite").GetProperty("type").GetString().Should().Be("link");
        previewJson.GetProperty("data").GetProperty("membership").GetProperty("status").GetString().Should().Be("none");

        var accepted = await Client.PostAsync($"/api/v2/groups/invite/{token}/accept", null);
        accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        var acceptedJson = await accepted.Content.ReadFromJsonAsync<JsonElement>();
        acceptedJson.GetProperty("data").GetProperty("action").GetString().Should().Be("joined");
        acceptedJson.GetProperty("data").GetProperty("invite").GetProperty("status").GetString().Should().Be("pending");

        var second = await Client.PostAsync($"/api/v2/groups/invite/{token}/accept", null);
        var secondJson = await second.Content.ReadFromJsonAsync<JsonElement>();
        secondJson.GetProperty("data").GetProperty("action").GetString().Should().Be("already_member");
    }

    [Fact]
    public async Task EmailInvite_RejectsWrongUser_AndExpiredInviteTransitionsOnAccept()
    {
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync("Bound invite lifecycle");
        string emailToken;
        string expiredToken;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            emailToken = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
            expiredToken = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
            db.GroupInvites.AddRange(
                new GroupInvite { TenantId = TestData.Tenant1.Id, GroupId = groupId, InvitedByUserId = TestData.MemberUser.Id, InviteType = "email", Email = TestData.MemberUser.Email, Token = emailToken, ExpiresAt = DateTime.UtcNow.AddHours(1) },
                new GroupInvite { TenantId = TestData.Tenant1.Id, GroupId = groupId, InvitedByUserId = TestData.MemberUser.Id, InviteType = "link", Token = expiredToken, ExpiresAt = DateTime.UtcNow.AddMinutes(-1) });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var mismatch = await Client.GetAsync($"/api/v2/groups/invite/{emailToken}");
        mismatch.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var mismatchJson = await mismatch.Content.ReadFromJsonAsync<JsonElement>();
        mismatchJson.GetProperty("error").GetProperty("code").GetString().Should().Be("EMAIL_MISMATCH");
        var expired = await Client.PostAsync($"/api/v2/groups/invite/{expiredToken}/accept", null);
        expired.StatusCode.Should().Be(HttpStatusCode.Gone);
        using var verification = Factory.Services.CreateScope();
        var verifyDb = verification.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.GroupInvites.IgnoreQueryFilters().SingleAsync(x => x.Token == expiredToken)).Status.Should().Be("expired");
    }

    [Fact]
    public async Task Export_IsQueuedGeneratedPrivateAndDownloadable()
    {
        await AuthenticateAsMemberAsync();
        var groupId = await CreateGroupAsync("Private queued export");
        (await Client.GetAsync($"/api/v2/groups/{groupId}/export")).StatusCode.Should().Be(HttpStatusCode.Gone);
        var duplicateRequests = await Task.WhenAll(
            Client.PostAsync($"/api/v2/groups/{groupId}/exports", null),
            Client.PostAsync($"/api/v2/groups/{groupId}/exports", null));
        duplicateRequests.Should().OnlyContain(response => response.StatusCode == HttpStatusCode.Accepted);
        var requested = duplicateRequests[0];
        requested.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var json = await requested.Content.ReadFromJsonAsync<JsonElement>();
        var exportId = json.GetProperty("data").GetProperty("id").GetGuid();
        var duplicateJson = await duplicateRequests[1].Content.ReadFromJsonAsync<JsonElement>();
        duplicateJson.GetProperty("data").GetProperty("id").GetGuid().Should().Be(exportId);
        json.GetProperty("data").GetProperty("status").GetString().Should().Be("queued");

        string? path;
        using (var scope = Factory.Services.CreateScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<GroupDataExportService>();
            (await service.GenerateAsync(exportId, CancellationToken.None)).Should().BeTrue();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var row = await db.GroupDataExports.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == exportId);
            path = service.SafeAbsolutePath(row);
            row.Status.Should().Be("completed");
            row.ByteSize.Should().BeGreaterThan(0);
        }

        var status = await Client.GetAsync($"/api/v2/groups/{groupId}/exports/{exportId}");
        status.StatusCode.Should().Be(HttpStatusCode.OK);
        var statusJson = await status.Content.ReadFromJsonAsync<JsonElement>();
        statusJson.GetProperty("data").GetProperty("download_url").GetString().Should().EndWith($"/{exportId}/download");
        var download = await Client.GetAsync($"/api/v2/groups/{groupId}/exports/{exportId}/download");
        download.StatusCode.Should().Be(HttpStatusCode.OK);
        download.Headers.CacheControl!.NoStore.Should().BeTrue();
        download.Content.Headers.ContentType!.MediaType.Should().Be("application/json");
        using var document = JsonDocument.Parse(await download.Content.ReadAsStringAsync());
        document.RootElement.GetProperty("schema").GetProperty("name").GetString().Should().Be("nexus.group-export");
        document.RootElement.GetProperty("invitations").ToString().Should().NotContain("token");

        var outsideFile = Path.GetTempFileName();
        Guid unsafeId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var now = DateTime.UtcNow;
            var unsafeRow = new GroupDataExport { Id = Guid.NewGuid(), TenantId = TestData.Tenant1.Id, GroupId = groupId, RequestedByUserId = TestData.MemberUser.Id, Status = "completed", StoragePath = outsideFile, ExpiresAt = now.AddHours(1), CreatedAt = now, UpdatedAt = now };
            unsafeId = unsafeRow.Id;
            db.GroupDataExports.Add(unsafeRow);
            await db.SaveChangesAsync();
        }
        (await Client.GetAsync($"/api/v2/groups/{groupId}/exports/{unsafeId}/download")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        File.Exists(outsideFile).Should().BeTrue("an untrusted path must never be read or deleted");
        File.Delete(outsideFile);

        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/groups/{groupId}/exports/{exportId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        if (path is not null && File.Exists(path)) File.Delete(path);
    }

    private async Task<int> CreateGroupAsync(string name)
    {
        var response = await Client.PostAsJsonAsync("/api/groups", new { name });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        return content.GetProperty("group").GetProperty("id").GetInt32();
    }
}
