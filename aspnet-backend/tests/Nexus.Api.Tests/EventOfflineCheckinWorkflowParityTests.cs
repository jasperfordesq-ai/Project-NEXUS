// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventOfflineCheckinWorkflowParityTests : IntegrationTestBase
{
    public EventOfflineCheckinWorkflowParityTests(NexusWebApplicationFactory factory):base(factory){}

    [Fact]
    public async Task Credential_IsSignedOneShotHashedVersionedAndRevocable()
    {
        var (eventId,registrationId)=await EventAsync();await AuthenticateAsAdminAsync();
        var issued=await Post($"/api/v2/events/{eventId}/offline-checkin/credentials",new{registration_id=registrationId},"credential-issue-0001");issued.StatusCode.Should().Be(HttpStatusCode.Created);
        var data=(await issued.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");var credential=data.GetProperty("credential");var id=credential.GetProperty("id").GetInt64();var token=credential.GetProperty("token").GetString()!;token.Should().StartWith("nqx2_").And.Contain(".");credential.GetProperty("token_one_shot").GetBoolean().Should().BeTrue();
        using(var scope=Factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();var row=await db.EventCheckinCredentials.IgnoreQueryFilters().SingleAsync(x=>x.Id==id);row.TokenHash.Should().Be(Hash(token));row.TokenHash.Should().NotContain(token);}
        var replay=await Post($"/api/v2/events/{eventId}/offline-checkin/credentials",new{registration_id=registrationId},"credential-issue-0001");replay.StatusCode.Should().Be(HttpStatusCode.OK);(await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("credential").GetProperty("token").ValueKind.Should().Be(JsonValueKind.Null);
        var rotated=await Post($"/api/v2/events/{eventId}/offline-checkin/credentials/{id}/rotate",new{expected_version=1},"credential-rotate-0001");rotated.StatusCode.Should().Be(HttpStatusCode.Created);var next=(await rotated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("credential");next.GetProperty("version").GetInt32().Should().Be(2);
        var revoked=await Post($"/api/v2/events/{eventId}/offline-checkin/credentials/{next.GetProperty("id").GetInt64()}/revoke",new{expected_version=2,reason="Device lost"},null);revoked.StatusCode.Should().Be(HttpStatusCode.OK);(await revoked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("credential").GetProperty("status").GetString().Should().Be("revoked");
    }

    [Fact]
    public async Task DeviceAndManifest_UseOneShotSecretsStrictPrivacyAndEd25519Metadata()
    {
        var (eventId,registrationId)=await EventAsync();await AuthenticateAsAdminAsync();await Post($"/api/v2/events/{eventId}/offline-checkin/credentials",new{registration_id=registrationId},"manifest-credential-1");
        var registered=await Post($"/api/v2/events/{eventId}/offline-checkin/devices",new{label="Front desk",expires_at=(string?)null},"device-register-0001");registered.StatusCode.Should().Be(HttpStatusCode.Created);var device=(await registered.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("device");var id=device.GetProperty("id").GetInt64();var secret=device.GetProperty("secret").GetString()!;secret.Should().StartWith("nxd1_").And.HaveLength(48);
        using(var scope=Factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();var row=await db.EventCheckinDevices.IgnoreQueryFilters().SingleAsync(x=>x.Id==id);row.SecretHash.Should().Be(Hash(secret)).And.NotContain(secret);}
        var manifest=await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/offline-checkin/manifest",new{device_secret=secret});manifest.StatusCode.Should().Be(HttpStatusCode.OK);var m=(await manifest.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");m.GetProperty("schema_version").GetInt32().Should().Be(2);m.GetProperty("credential_verification").GetProperty("algorithm").GetString().Should().Be("Ed25519");m.GetProperty("credential_verification").GetProperty("keys")[0].GetProperty("public_key").GetString().Should().NotBeNullOrWhiteSpace();var serialized=m.ToString().ToLowerInvariant();serialized.Should().NotContain("email").And.NotContain("phone").And.NotContain("device_secret");
        var rotated=await Post($"/api/v2/events/{eventId}/offline-checkin/devices/{id}/rotate",new{expected_version=1},"device-rotate-0001");var next=(await rotated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("device");var nextSecret=next.GetProperty("secret").GetString()!;nextSecret.Should().NotBe(secret);(await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/offline-checkin/manifest",new{device_secret=secret})).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var revoked=await Post($"/api/v2/events/{eventId}/offline-checkin/devices/{id}/revoke",new{expected_version=2,reason="Retired"},null);(await revoked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("device").GetProperty("purge_local_data_required").GetBoolean().Should().BeTrue();(await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/offline-checkin/manifest",new{device_secret=nextSecret})).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task OfflineSync_IsDurableIdempotentAndConflictResolutionIsAppendOnly()
    {
        var (eventId,registrationId)=await EventAsync();await AuthenticateAsAdminAsync();var issued=await Post($"/api/v2/events/{eventId}/offline-checkin/credentials",new{registration_id=registrationId},"sync-credential-0001");var token=(await issued.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("credential").GetProperty("token").GetString()!;var hash=Hash(token);var registered=await Post($"/api/v2/events/{eventId}/offline-checkin/devices",new{label="Door A"},"sync-device-0001");var secret=(await registered.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("device").GetProperty("secret").GetString()!;
        object Payload(string batch,string nonce,long expected)=>new{device_secret=secret,client_batch_id=batch,manifest_version=2,items=new[]{new{client_nonce=nonce,operation="check_in",observed_at=DateTime.UtcNow.ToString("O"),expected_attendance_version=expected,credential_fingerprint=hash[..16],credential_hash_reference=hash}}};
        var firstPayload=Payload("batch-0001","nonce-accepted-0001",0);var first=await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/offline-checkin/sync",firstPayload);first.StatusCode.Should().Be(HttpStatusCode.Accepted);var batch=(await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");batch.GetProperty("batch").GetProperty("accepted_count").GetInt32().Should().Be(1);batch.GetProperty("items")[0].GetProperty("state").GetString().Should().Be("synced");var batchId=batch.GetProperty("batch").GetProperty("id").GetInt64();
        var replay=await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/offline-checkin/sync",firstPayload);replay.StatusCode.Should().Be(HttpStatusCode.OK);(await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("batch").GetProperty("id").GetInt64().Should().Be(batchId);
        var conflict=await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/offline-checkin/sync",Payload("batch-0002","nonce-conflict-0002",0));var conflictData=(await conflict.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");conflictData.GetProperty("batch").GetProperty("conflict_count").GetInt32().Should().Be(1);var itemId=conflictData.GetProperty("items")[0].GetProperty("id").GetInt64();
        var list=await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}/offline-checkin/conflicts");list.GetProperty("data").GetProperty("total").GetInt32().Should().Be(1);var resolved=await Post($"/api/v2/events/{eventId}/offline-checkin/conflicts/{itemId}",new{expected_decision_version=1,disposition="reject",expected_attendance_version=1,reason="Duplicate scan"},"resolve-conflict-0001");resolved.StatusCode.Should().Be(HttpStatusCode.OK);(await resolved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("total").GetInt32().Should().Be(0);
        using var scope=Factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var acceptedItem=await db.EventOfflineSyncItems.IgnoreQueryFilters().SingleAsync(x=>x.BatchId==batchId);acceptedItem.CredentialId.Should().NotBeNull();acceptedItem.RegistrationId.Should().Be(registrationId);acceptedItem.UserId.Should().Be(TestData.MemberUser.Id);
        (await db.EventOfflineSyncDecisions.IgnoreQueryFilters().Where(x=>x.ItemId==itemId).OrderBy(x=>x.DecisionVersion).Select(x=>x.Outcome).ToListAsync()).Should().Equal("conflict","rejected");
    }

    [Fact]
    public async Task ManagerTenantAndVersionBoundaries_FailClosed()
    {
        var (eventId,registrationId)=await EventAsync();await AuthenticateAsMemberAsync();(await Client.GetAsync($"/api/v2/events/{eventId}/offline-checkin")).StatusCode.Should().Be(HttpStatusCode.Forbidden);await AuthenticateAsAdminAsync();var device=await Post($"/api/v2/events/{eventId}/offline-checkin/devices",new{label="Scoped"},"tenant-device-0001");var id=(await device.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("device").GetProperty("id").GetInt64();(await Post($"/api/v2/events/{eventId}/offline-checkin/devices/{id}/rotate",new{expected_version=99},"bad-version-0001")).StatusCode.Should().Be(HttpStatusCode.Conflict);await AuthenticateAsOtherTenantUserAsync();(await Client.GetAsync($"/api/v2/events/{eventId}/offline-checkin")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<(int EventId,long RegistrationId)> EventAsync(){using var scope=Factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();var start=DateTime.UtcNow.AddDays(4);var e=new Event{TenantId=TestData.Tenant1.Id,CreatedById=TestData.AdminUser.Id,Title="Offline check-in",StartsAt=start,EndsAt=start.AddHours(3),Timezone="Europe/Dublin",Status="active",PublicationStatus="published",OperationalStatus="scheduled"};db.Add(e);await db.SaveChangesAsync();var r=new EventRegistration{TenantId=TestData.Tenant1.Id,EventId=e.Id,UserId=TestData.MemberUser.Id,RegistrationState="confirmed",ConfirmedAt=DateTime.UtcNow,StateChangedAt=DateTime.UtcNow,StateChangedBy=TestData.MemberUser.Id};db.Add(r);await db.SaveChangesAsync();return(e.Id,r.Id);}
    private async Task<HttpResponseMessage> Post(string path,object body,string? key){using var request=new HttpRequestMessage(HttpMethod.Post,path){Content=JsonContent.Create(body)};if(key is not null)request.Headers.Add("Idempotency-Key",key);return await Client.SendAsync(request);}private static string Hash(string x)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(x))).ToLowerInvariant();
}
