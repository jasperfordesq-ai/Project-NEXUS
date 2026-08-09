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
public sealed class EventSafetyWorkflowParityTests : IntegrationTestBase
{
    public EventSafetyWorkflowParityTests(NexusWebApplicationFactory factory):base(factory){}

    [Fact]
    public async Task Requirements_AreVersionedIdempotentPublishableAndArchivable()
    {
        var id=await EventAsync();await AuthenticateAsAdminAsync();var text="Respect every attendee.";var saved=await Put($"/api/v2/events/{id}/safety/requirements",new{minimum_age=(int?)null,guardian_consent_required=true,minor_age_threshold=18,code_of_conduct_required=true,code_of_conduct_text=text,code_of_conduct_text_version="coc-1",expected_revision=(long?)null},"safety-save-0001");saved.StatusCode.Should().Be(HttpStatusCode.OK);var data=Data(saved);data.GetProperty("requirements").GetProperty("status").GetString().Should().Be("draft");data.GetProperty("requirements").GetProperty("revision").GetInt64().Should().Be(1);data.GetProperty("privacy").GetProperty("guardian_identity_redacted").GetBoolean().Should().BeTrue();
        var replay=await Put($"/api/v2/events/{id}/safety/requirements",new{minimum_age=(int?)null,guardian_consent_required=true,minor_age_threshold=18,code_of_conduct_required=true,code_of_conduct_text=text,code_of_conduct_text_version="coc-1",expected_revision=(long?)null},"safety-save-0001");replay.StatusCode.Should().Be(HttpStatusCode.OK);
        var published=await Post($"/api/v2/events/{id}/safety/requirements/publish",new{expected_revision=1,expected_version=1},"safety-publish-0001");Data(published).GetProperty("requirements").GetProperty("status").GetString().Should().Be("published");
        var archived=await Post($"/api/v2/events/{id}/safety/requirements/archive",new{expected_revision=2,expected_version=1},"safety-archive-0001");Data(archived).GetProperty("requirements").GetProperty("status").GetString().Should().Be("archived");
        using var scope=Factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();(await db.EventSafetyRequirementHistory.IgnoreQueryFilters().Where(x=>x.EventId==id).OrderBy(x=>x.RequirementsRevision).Select(x=>x.Action).ToListAsync()).Should().Equal("saved","published","archived");
    }

    [Fact]
    public async Task CodeAcknowledgement_IsPolicyBoundAndAppendOnly()
    {
        var id=await PublishedEvent();await AuthenticateAsMemberAsync();var textHash=Hash("Respect every attendee.");var before=await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{id}/safety");before.GetProperty("data").GetProperty("eligibility").GetProperty("reason_codes").EnumerateArray().Select(x=>x.GetString()).Should().Contain("event_safety_code_of_conduct_acknowledgement_required");
        var ack=await Post($"/api/v2/events/{id}/safety/code-of-conduct/acknowledgements",new{text_version="coc-1",text_hash=textHash},"safety-ack-0001");var evidence=Data(ack).GetProperty("evidence").GetProperty("code_of_conduct");evidence.GetProperty("status").GetString().Should().Be("acknowledged");var ackId=evidence.GetProperty("acknowledgement_id").GetInt64();
        var withdrawn=await Delete($"/api/v2/events/{id}/safety/code-of-conduct/acknowledgements/{ackId}","safety-ack-withdraw-0001",new{});Data(withdrawn).GetProperty("evidence").GetProperty("code_of_conduct").GetProperty("status").GetString().Should().Be("required");
        using var scope=Factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();(await db.EventSafetyCodeAcknowledgements.IgnoreQueryFilters().Where(x=>x.EventId==id).OrderBy(x=>x.EvidenceSequence).Select(x=>x.Action).ToListAsync()).Should().Equal("acknowledged","withdrawn");
    }

    [Fact]
    public async Task GuardianRequest_EncryptsIdentityHashesCapabilityAndCanBeWithdrawn()
    {
        var id=await PublishedEvent();await AuthenticateAsMemberAsync();var response=await Post($"/api/v2/events/{id}/safety/guardian-consents",new{guardian_name="Private Guardian",guardian_email="guardian@example.test",relationship_code="parent",preferred_language="en"},"safety-guardian-0001");response.StatusCode.Should().Be(HttpStatusCode.OK);var evidence=Data(response).GetProperty("evidence").GetProperty("guardian_consent");evidence.GetProperty("status").GetString().Should().Be("pending");var consentId=evidence.GetProperty("consent_id").GetInt64();var body=(await response.Content.ReadAsStringAsync()).ToLowerInvariant();body.Should().NotContain("guardian@example.test").And.NotContain("private guardian").And.NotContain("token_hash");
        using(var scope=Factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();var row=await db.EventGuardianConsents.IgnoreQueryFilters().SingleAsync(x=>x.Id==consentId);row.GuardianEmailCiphertext.Should().NotContain("guardian@example.test");row.GuardianIdentityCiphertext.Should().NotContain("Private Guardian");row.TokenHash.Should().MatchRegex("^[0-9a-f]{64}$");}
        var withdrawn=await Delete($"/api/v2/events/{id}/safety/guardian-consents/{consentId}","safety-guardian-withdraw-0001",new{});Data(withdrawn).GetProperty("evidence").GetProperty("guardian_consent").GetProperty("status").GetString().Should().Be("withdrawn");var invalid=await Post("/api/v2/events/safety/guardian-consents/grant",new{token="invalid",guardian_email="guardian@example.test"},"invalid-grant-0001",authenticate:false);invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);(await invalid.Content.ReadAsStringAsync()).Should().Contain("EVENT_GUARDIAN_CONSENT_INVALID");
    }

    [Fact]
    public async Task ParticipationReviews_AreManagerScopedVersionedAndTenantIsolated()
    {
        var id=await EventAsync();await AuthenticateAsAdminAsync();var recorded=await Post($"/api/v2/events/{id}/safety/reviews",new{user_id=TestData.MemberUser.Id,decision="deny",reason_code="safety_review",effective_from=DateTime.UtcNow.AddMinutes(-1).ToString("O"),effective_until=(string?)null,expected_version=(long?)null},"safety-review-0001");recorded.StatusCode.Should().Be(HttpStatusCode.OK);var denial=Data(recorded).GetProperty("items")[0].GetProperty("denial");var denialId=denial.GetProperty("id").GetInt64();denial.GetProperty("decision_version").GetInt64().Should().Be(1);
        var withdrawn=await Delete($"/api/v2/events/{id}/safety/reviews/{denialId}","safety-review-withdraw-0001",new{expected_version=1});var withdrawnBody=await withdrawn.Content.ReadAsStringAsync();withdrawn.StatusCode.Should().Be(HttpStatusCode.OK,because:withdrawnBody);var item=JsonDocument.Parse(withdrawnBody).RootElement.GetProperty("data").GetProperty("items")[0];item.GetProperty("denial").GetProperty("status").GetString().Should().Be("withdrawn");item.GetProperty("history").GetArrayLength().Should().Be(2);
        await AuthenticateAsMemberAsync();(await Client.GetAsync($"/api/v2/events/{id}/safety/reviews")).StatusCode.Should().Be(HttpStatusCode.Forbidden);await AuthenticateAsOtherTenantUserAsync();(await Client.GetAsync($"/api/v2/events/{id}/safety")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<int> PublishedEvent(){var id=await EventAsync();await AuthenticateAsAdminAsync();await Put($"/api/v2/events/{id}/safety/requirements",new{minimum_age=(int?)null,guardian_consent_required=true,minor_age_threshold=18,code_of_conduct_required=true,code_of_conduct_text="Respect every attendee.",code_of_conduct_text_version="coc-1",expected_revision=(long?)null},$"published-save-{id:D4}");await Post($"/api/v2/events/{id}/safety/requirements/publish",new{expected_revision=1,expected_version=1},$"published-publish-{id:D4}");return id;}
    private async Task<int> EventAsync(){using var scope=Factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<NexusDbContext>();var e=new Event{TenantId=TestData.Tenant1.Id,CreatedById=TestData.AdminUser.Id,Title="Safety event",StartsAt=DateTime.UtcNow.AddDays(5),EndsAt=DateTime.UtcNow.AddDays(5).AddHours(2),Status="active",PublicationStatus="published",OperationalStatus="scheduled"};db.Add(e);await db.SaveChangesAsync();return e.Id;}
    private async Task<HttpResponseMessage> Put(string path,object body,string key){using var r=new HttpRequestMessage(HttpMethod.Put,path){Content=JsonContent.Create(body)};r.Headers.Add("Idempotency-Key",key);return await Client.SendAsync(r);}private async Task<HttpResponseMessage> Post(string path,object body,string key,bool authenticate=true){using var r=new HttpRequestMessage(HttpMethod.Post,path){Content=JsonContent.Create(body)};r.Headers.Add("Idempotency-Key",key);return await Client.SendAsync(r);}private async Task<HttpResponseMessage> Delete(string path,string key,object body){using var r=new HttpRequestMessage(HttpMethod.Delete,path){Content=JsonContent.Create(body)};r.Headers.Add("Idempotency-Key",key);return await Client.SendAsync(r);}private static JsonElement Data(HttpResponseMessage r)=>r.Content.ReadFromJsonAsync<JsonElement>().GetAwaiter().GetResult().GetProperty("data");private static string Hash(string x)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(x))).ToLowerInvariant();
}
