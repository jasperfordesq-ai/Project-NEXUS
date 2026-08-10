// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventRegistrationProductParityTests : IntegrationTestBase
{
    public EventRegistrationProductParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public void CanonicalRoutes_HaveOneFocusedOwnerAndExactLaravelRatePolicies()
    {
        var expected = new Dictionary<string, string>
        {
            ["AttendeeState"] = RateLimitingExtensions.EventRegistrationReadPolicy,
            ["OrganizerOverview"] = RateLimitingExtensions.EventRegistrationReadPolicy,
            ["SaveSettings"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["PublishSettings"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["CreateForm"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["UpdateForm"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["ForkForm"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["PublishForm"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["SaveSubmission"] = RateLimitingExtensions.EventRegistrationSubmissionPolicy,
            ["Submit"] = RateLimitingExtensions.EventRegistrationSubmissionPolicy,
            ["Amend"] = RateLimitingExtensions.EventRegistrationSubmissionPolicy,
            ["Answers"] = RateLimitingExtensions.EventRegistrationAnswerReadPolicy,
            ["Export"] = RateLimitingExtensions.EventRegistrationRestrictedPolicy,
            ["PreviewCampaign"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["ScheduleCampaign"] = RateLimitingExtensions.EventRegistrationRestrictedPolicy,
            ["IssueCampaign"] = RateLimitingExtensions.EventRegistrationRestrictedPolicy,
            ["CancelCampaign"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["RevokeInvitation"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["AcceptInvitation"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["AcceptMemberInvitation"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["CaptureGuest"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["CancelGuest"] = RateLimitingExtensions.EventRegistrationMutationPolicy,
            ["GuestAttendance"] = RateLimitingExtensions.EventRegistrationSubmissionPolicy,
            ["RetentionDryRun"] = RateLimitingExtensions.EventRegistrationRestrictedPolicy,
            ["RetentionApply"] = RateLimitingExtensions.EventRegistrationRetentionApplyPolicy
        };

        var endpoints = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.Metadata.GetMetadata<ControllerActionDescriptor>()?.ControllerName == "EventRegistrationProduct")
            .ToList();

        endpoints.Should().HaveCount(25);
        foreach (var (actionName, policy) in expected)
        {
            var endpoint = endpoints.Where(candidate =>
                    candidate.Metadata.GetMetadata<ControllerActionDescriptor>()?.ActionName == actionName)
                .Should().ContainSingle().Which;
            endpoint.Metadata.GetMetadata<IHttpMethodMetadata>().Should().NotBeNull();
            endpoint.Metadata.GetRequiredMetadata<EnableRateLimitingAttribute>().PolicyName.Should().Be(policy);
        }
    }

    [Fact]
    public async Task OrganizerOverview_UsesIndependentCanonicalPaginationAndPrivateV2Headers()
    {
        var (eventId, _) = await EventAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync($"/api/v2/events/{eventId}/registration-product/manage?submissions_page=2&submissions_per_page=1&campaigns_page=3&campaigns_per_page=2&guests_page=4&guests_per_page=3");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var pagination = Data(response).GetProperty("pagination");
        pagination.GetProperty("submissions").GetProperty("per_page").GetInt32().Should().Be(1);
        pagination.GetProperty("campaigns").GetProperty("per_page").GetInt32().Should().Be(2);
        pagination.GetProperty("guests").GetProperty("per_page").GetInt32().Should().Be(3);
        response.Headers.CacheControl!.Private.Should().BeTrue();
        response.Headers.CacheControl.NoStore.Should().BeTrue();
        response.Headers.Vary.Should().Contain(new[] { "Authorization", "Cookie", "X-Tenant-ID" });
        response.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");

        var invalid = await Client.GetAsync($"/api/v2/events/{eventId}/registration-product/manage?submissions_page=0");
        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var error = await invalid.Content.ReadFromJsonAsync<JsonElement>();
        error.GetProperty("code").GetString().Should().Be("EVENT_REGISTRATION_VALIDATION_FAILED");
        error.GetProperty("error").GetProperty("field").GetString().Should().Be("pagination");
    }

    [Fact]
    public async Task SettingsFormsAndSubmissions_AreVersionedDurableAndAudited()
    {
        var (eventId, registrationId) = await EventAsync(seedRegistration: true);
        await AuthenticateAsAdminAsync();
        var settings = await Put($"/api/v2/events/{eventId}/registration-product/settings", Settings(), "erp-settings-0001");
        settings.StatusCode.Should().Be(HttpStatusCode.Created);
        Data(settings).GetProperty("settings").GetProperty("revision").GetInt64().Should().Be(1);
        var settingsKeyReuse = await Put($"/api/v2/events/{eventId}/registration-product/settings", Settings(guestRetentionDays: 31), "erp-settings-0001");
        settingsKeyReuse.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var publishedSettings = await Post($"/api/v2/events/{eventId}/registration-product/settings/publish", new { expected_revision = 1 }, "erp-settings-publish-0001");
        Data(publishedSettings).GetProperty("settings").GetProperty("revision").GetInt64().Should().Be(2);

        var created = await Post($"/api/v2/events/{eventId}/registration-product/forms", new
        {
            expected_settings_revision = 2,
            name = "Attendee details",
            description = "Needed to run the event",
            questions = new[] { new { stable_key = "dietary", question_type = "dietary", prompt = "Dietary needs", help_text = (string?)null, is_required = true, data_classification = "confidential", purpose = "event catering", retention_days = 30, choice_options = (object?)null, validation_rules = (object?)null, visibility_rules = (object?)null, displayed_text = (string?)null, displayed_text_version = (string?)null } }
        }, "erp-form-create-0001");
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var formId = Data(created).GetProperty("form").GetProperty("id").GetInt64();
        var published = await Post($"/api/v2/events/{eventId}/registration-product/forms/{formId}/publish", new { expected_form_revision = 1, expected_settings_revision = 3 }, "erp-form-publish-0001");
        Data(published).GetProperty("settings_revision").GetInt64().Should().Be(4);
        var createReplay = await Post($"/api/v2/events/{eventId}/registration-product/forms", new
        {
            expected_settings_revision = 2,
            name = "Attendee details",
            description = "Needed to run the event",
            questions = new[] { new { stable_key = "dietary", question_type = "dietary", prompt = "Dietary needs", help_text = (string?)null, is_required = true, data_classification = "confidential", purpose = "event catering", retention_days = 30, choice_options = (object?)null, validation_rules = (object?)null, visibility_rules = (object?)null, displayed_text = (string?)null, displayed_text_version = (string?)null } }
        }, "erp-form-create-0001");
        createReplay.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(createReplay).GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        var createKeyReuse = await Post($"/api/v2/events/{eventId}/registration-product/forms", new
        {
            expected_settings_revision = 2,
            name = "Different form",
            description = "Must not replay",
            questions = new[] { new { stable_key = "dietary", question_type = "dietary", prompt = "Dietary needs", help_text = (string?)null, is_required = true, data_classification = "confidential", purpose = "event catering", retention_days = 30, choice_options = (object?)null, validation_rules = (object?)null, visibility_rules = (object?)null, displayed_text = (string?)null, displayed_text_version = (string?)null } }
        }, "erp-form-create-0001");
        createKeyReuse.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var publishedReplay = await Post($"/api/v2/events/{eventId}/registration-product/forms/{formId}/publish", new { expected_form_revision = 1, expected_settings_revision = 3 }, "erp-form-publish-0001");
        publishedReplay.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(publishedReplay).GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        var updatedPublishedSettings = await Put($"/api/v2/events/{eventId}/registration-product/settings", Settings(expectedRevision: 4), "erp-settings-update-published-0001");
        var updatedSettingsData = Data(updatedPublishedSettings).GetProperty("settings");
        updatedSettingsData.GetProperty("status").GetString().Should().Be("published");
        updatedSettingsData.GetProperty("revision").GetInt64().Should().Be(5);

        await AuthenticateAsMemberAsync();
        var saved = await Post($"/api/v2/events/{eventId}/registration-product/submissions", new { registration_id = registrationId, form_version_id = formId, expected_revision = (long?)null, answers = new { dietary = "No nuts" } }, "erp-submission-save-0001");
        saved.StatusCode.Should().Be(HttpStatusCode.Created);
        var submissionId = Data(saved).GetProperty("submission").GetProperty("id").GetInt64();
        var saveKeyReuse = await Post($"/api/v2/events/{eventId}/registration-product/submissions", new { registration_id = registrationId, form_version_id = formId, expected_revision = (long?)null, answers = new { dietary = "Different answer" } }, "erp-submission-save-0001");
        saveKeyReuse.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var submitted = await Post($"/api/v2/events/{eventId}/registration-product/submissions/{submissionId}/submit", new { expected_revision = 1 }, "erp-submission-submit-0001");
        Data(submitted).GetProperty("submission").GetProperty("status").GetString().Should().Be("submitted");
        var submitKeyReuse = await Post($"/api/v2/events/{eventId}/registration-product/submissions/{submissionId}/submit", new { expected_revision = 2 }, "erp-submission-submit-0001");
        submitKeyReuse.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var ownerAnswers = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/submissions/{submissionId}/answers", new { purpose = "review my registration", correlation_id = "erp-owner-answer-read-0001", include_sensitive = true });
        ownerAnswers.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(ownerAnswers).GetProperty("answers").GetProperty("dietary").GetProperty("value").GetString().Should().Be("No nuts");

        await AuthenticateAsAdminAsync();
        var answers = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/submissions/{submissionId}/answers", new { purpose = "catering", correlation_id = "erp-answer-read-0001", include_sensitive = true });
        answers.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(answers).GetProperty("answers").GetProperty("dietary").GetProperty("value").GetString().Should().Be("No nuts");
        var exported = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/submissions/export", new { purpose = "catering export", correlation_id = "erp-answer-export-0001", include_sensitive = true });
        exported.StatusCode.Should().Be(HttpStatusCode.OK);
        var csv = await exported.Content.ReadAsStringAsync();
        csv.Should().Contain("member_name").And.Contain("attempt_number").And.Contain("dietary: Dietary needs").And.Contain("No nuts");
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.EventRegistrationSubmissionHistory.IgnoreQueryFilters().Where(x => x.SubmissionId == submissionId).Select(x => x.Action).ToListAsync()).Should().Equal("saved", "submitted");
        (await db.EventRegistrationAnswerAccessAudits.IgnoreQueryFilters().CountAsync(x => x.SubmissionId == submissionId)).Should().Be(3);
        var storedAnswer = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().SingleAsync(x => x.SubmissionId == submissionId);
        storedAnswer.ValueJson.Should().NotContain("No nuts");
        var audits = await db.EventRegistrationAnswerAccessAudits.IgnoreQueryFilters().Where(x => x.SubmissionId == submissionId).ToListAsync();
        audits.Should().OnlyContain(audit => audit.CorrelationId.Length == 64
            && audit.AnswerId == storedAnswer.Id
            && audit.QuestionId == storedAnswer.QuestionId);
    }

    [Fact]
    public async Task IncompleteDraftsAreSavedButSubmitRevalidatesRequiredAndUnknownAnswers()
    {
        var (eventId, registrationId) = await EventAsync(seedRegistration: true);
        await AuthenticateAsAdminAsync();
        await Put($"/api/v2/events/{eventId}/registration-product/settings", Settings(), "erp-draft-settings-0001");
        await Post($"/api/v2/events/{eventId}/registration-product/settings/publish", new { expected_revision = 1 }, "erp-draft-settings-publish-0001");
        var created = await Post($"/api/v2/events/{eventId}/registration-product/forms", new
        {
            expected_settings_revision = 2,
            name = "Required details",
            description = "Submit-time validation",
            questions = new[] { new { stable_key = "required_name", question_type = "short_text", prompt = "Required name", help_text = (string?)null, is_required = true, data_classification = "confidential", purpose = "registration", retention_days = 30, choice_options = (object?)null, validation_rules = (object?)null, visibility_rules = (object?)null, displayed_text = (string?)null, displayed_text_version = (string?)null } }
        }, "erp-draft-form-create-0001");
        var formId = Data(created).GetProperty("form").GetProperty("id").GetInt64();
        await Post($"/api/v2/events/{eventId}/registration-product/forms/{formId}/publish", new { expected_form_revision = 1, expected_settings_revision = 3 }, "erp-draft-form-publish-0001");

        await AuthenticateAsMemberAsync();
        var draft = await Post($"/api/v2/events/{eventId}/registration-product/submissions", new { registration_id = registrationId, form_version_id = formId, expected_revision = (long?)null, answers = new { } }, "erp-draft-empty-0001");
        draft.StatusCode.Should().Be(HttpStatusCode.Created);
        var submissionId = Data(draft).GetProperty("submission").GetProperty("id").GetInt64();
        var incomplete = await Post($"/api/v2/events/{eventId}/registration-product/submissions/{submissionId}/submit", new { expected_revision = 1 }, "erp-draft-submit-incomplete-0001");
        incomplete.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var unknown = await Post($"/api/v2/events/{eventId}/registration-product/submissions", new { registration_id = registrationId, form_version_id = formId, expected_revision = (long?)1, answers = new { unknown = "no" } }, "erp-draft-unknown-0001");
        unknown.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var completed = await Post($"/api/v2/events/{eventId}/registration-product/submissions", new { registration_id = registrationId, form_version_id = formId, expected_revision = (long?)1, answers = new { required_name = "Complete" } }, "erp-draft-complete-0001");
        completed.StatusCode.Should().Be(HttpStatusCode.Created);
        Data(completed).GetProperty("submission").GetProperty("revision").GetInt64().Should().Be(2);
        var submitted = await Post($"/api/v2/events/{eventId}/registration-product/submissions/{submissionId}/submit", new { expected_revision = 2 }, "erp-draft-submit-complete-0001");
        submitted.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(submitted).GetProperty("submission").GetProperty("status").GetString().Should().Be("submitted");
    }

    [Fact]
    public async Task CampaignInvitationAndAcceptance_AreIdempotentAndCreateParticipation()
    {
        var (eventId, _) = await EventAsync();
        await AuthenticateAsAdminAsync();
        var preview = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "member", source = new { member_ids = new[] { TestData.MemberUser.Id } }, default_locale = "en" }, "erp-campaign-preview-0001");
        preview.StatusCode.Should().Be(HttpStatusCode.Created);
        var campaignId = Data(preview).GetProperty("campaign").GetProperty("id").GetInt64();
        using (var previewScope = Factory.Services.CreateScope())
        {
            var previewDb = previewScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await previewDb.EventInvitationCampaigns.IgnoreQueryFilters().SingleAsync(x => x.Id == campaignId);
            stored.Source.Should().NotBe(JsonSerializer.Serialize(new { member_ids = new[] { TestData.MemberUser.Id } }));
            stored.SourceHash.Should().MatchRegex("^[0-9a-f]{64}$");
        }
        var issued = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/{campaignId}/issue", new { expected_revision = 1, expires_at = DateTime.UtcNow.AddDays(2).ToString("O") }, "erp-campaign-issue-0001");
        var invitationId = Data(issued).GetProperty("invitations")[0].GetProperty("invitation").GetProperty("id").GetInt64();
        using (var evidenceScope = Factory.Services.CreateScope())
        {
            var evidenceDb = evidenceScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var evidence = await evidenceDb.EventInvitationDeliveryEvidence.IgnoreQueryFilters().Where(x => x.InvitationId == invitationId && x.EvidenceVersion == 1).OrderBy(x => x.Channel).ToListAsync();
            evidence.Should().HaveCount(5);
            evidence.Select(x => x.Channel).Should().BeEquivalentTo("email", "in_app", "web_push", "fcm", "realtime");
            var outbox = await evidenceDb.EventDomainOutbox.IgnoreQueryFilters().SingleAsync(x => x.Id == evidence[0].OutboxId);
            outbox.Action.Should().Be("event.invitation.issued");
            outbox.Status.Should().Be("pending");
            outbox.Payload.Should().NotContain("nxi1_");
            var deliveries = await evidenceDb.EventNotificationDeliveries.IgnoreQueryFilters().Where(x => x.OutboxId == outbox.Id).ToListAsync();
            deliveries.Should().HaveCount(5);
            deliveries.Should().OnlyHaveUniqueItems(x => x.DeliveryKey);
            using var firstProcessingScope = Factory.Services.CreateScope();
            using var competingScope = Factory.Services.CreateScope();
            var firstProcessor = firstProcessingScope.ServiceProvider.GetRequiredService<EventInvitationDeliveryProcessor>();
            var secondProcessor = competingScope.ServiceProvider.GetRequiredService<EventInvitationDeliveryProcessor>();
            var processed = await Task.WhenAll(firstProcessor.ProcessBatchAsync(), secondProcessor.ProcessBatchAsync());
            processed.Sum(x => x.Claimed).Should().Be(1);
            processed.Sum(x => x.Completed).Should().Be(1);
            await evidenceDb.Entry(outbox).ReloadAsync();
            outbox.Status.Should().Be("processed");
            outbox.Attempts.Should().Be(1);
            (await evidenceDb.EventInvitationDeliveryEvidence.IgnoreQueryFilters().CountAsync(x => x.InvitationId == invitationId && x.EvidenceVersion == 2)).Should().Be(5);
            (await evidenceDb.Notifications.IgnoreQueryFilters().CountAsync(x => x.TenantId == TestData.Tenant1.Id && x.UserId == TestData.MemberUser.Id && x.Type == "event_invitation")).Should().Be(1);
        }

        await AuthenticateAsMemberAsync();
        var accepted = await Post($"/api/v2/events/{eventId}/registration-product/invitations/{invitationId}/accept", new { }, "erp-invitation-accept-0001");
        accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        var acceptedData = Data(accepted);
        acceptedData.GetProperty("invitation").GetProperty("status").GetString().Should().Be("accepted");
        acceptedData.GetProperty("participation").GetProperty("status").GetString().Should().Be("confirmed");
        acceptedData.GetProperty("participation").GetProperty("registration").GetProperty("registration_state").GetString().Should().Be("confirmed");
        var replay = await Post($"/api/v2/events/{eventId}/registration-product/invitations/{invitationId}/accept", new { }, "erp-invitation-accept-0001");
        Data(replay).GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.EventRegistrationHistory.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId && x.UserId == TestData.MemberUser.Id)).Should().Be(1);
        (await db.EventDomainOutbox.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId && x.Action == "event.registration.confirmed")).Should().Be(1);
    }

    [Fact]
    public async Task InvitationAcceptance_WhenEventIsFull_JoinsCapacitySafeWaitlist()
    {
        var (eventId, _) = await EventAsync();
        using (var eventScope = Factory.Services.CreateScope())
        {
            var eventDb = eventScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var evt = await eventDb.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == eventId);
            evt.MaxAttendees = 1;
            eventDb.EventRegistrations.Add(new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = eventId, UserId = TestData.AdminUser.Id, RegistrationState = "confirmed", ConfirmedAt = DateTime.UtcNow, StateChangedAt = DateTime.UtcNow, StateChangedBy = TestData.AdminUser.Id });
            await eventDb.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var preview = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "member", source = new { member_ids = new[] { TestData.MemberUser.Id } }, default_locale = "en" }, "erp-full-preview-0001");
        var campaignId = Data(preview).GetProperty("campaign").GetProperty("id").GetInt64();
        var issued = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/{campaignId}/issue", new { expected_revision = 1, expires_at = DateTime.UtcNow.AddDays(2).ToString("O") }, "erp-full-issue-0001");
        var invitationId = Data(issued).GetProperty("invitations")[0].GetProperty("invitation").GetProperty("id").GetInt64();

        await AuthenticateAsMemberAsync();
        var accepted = await Post($"/api/v2/events/{eventId}/registration-product/invitations/{invitationId}/accept", new { }, "erp-full-accept-0001");
        var participation = Data(accepted).GetProperty("participation");
        participation.GetProperty("status").GetString().Should().Be("waitlisted");
        participation.GetProperty("registration").ValueKind.Should().Be(JsonValueKind.Null);
        participation.GetProperty("waitlist").GetProperty("queue_state").GetString().Should().Be("waiting");
    }

    [Fact]
    public async Task GuestAttendanceAndRetention_ProtectIdentityAndPurgeDueData()
    {
        var (eventId, registrationId) = await EventAsync(seedRegistration: true);
        await AuthenticateAsAdminAsync();
        await Put($"/api/v2/events/{eventId}/registration-product/settings", Settings(guestRetentionDays: 1), "erp-guest-settings-0001");
        await Post($"/api/v2/events/{eventId}/registration-product/settings/publish", new { expected_revision = 1 }, "erp-guest-settings-publish-0001");
        var managerCapture = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/registrations/{registrationId}/guests", new { expected_registration_version = 1, display_name = "Manager-added guest", consent_accepted = true, consent_text = "I consent", consent_text_version = "v1" });
        managerCapture.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AuthenticateAsMemberAsync();
        var invalidLocale = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/registrations/{registrationId}/guests", new { expected_registration_version = 1, display_name = "Invalid Locale", consent_accepted = true, consent_text = "I consent", consent_text_version = "v1", preferred_locale = "xx", notification_consent = false });
        invalidLocale.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var guest = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/registrations/{registrationId}/guests", new { expected_registration_version = 1, display_name = "Private Guest", email = "guest@example.test", phone = "+353100000", consent_accepted = true, consent_text = "I consent", consent_text_version = "v1", preferred_locale = "EN_ie", notification_consent = false });
        guest.StatusCode.Should().Be(HttpStatusCode.Created);
        var guestData = Data(guest).GetProperty("guest");
        guestData.GetProperty("preferred_locale").GetString().Should().Be("en");
        var guestId = guestData.GetProperty("id").GetInt64();

        using (var attendanceScope = Factory.Services.CreateScope())
        {
            var attendanceDb = attendanceScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var evt = await attendanceDb.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == eventId);
            evt.StartsAt = DateTime.UtcNow.AddMinutes(5);
            evt.EndsAt = DateTime.UtcNow.AddHours(2);
            await attendanceDb.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var checkIn = await Post($"/api/v2/events/{eventId}/registration-product/guests/{guestId}/attendance/check_in", new { expected_version = 0 }, "erp-guest-checkin-0001");
        Data(checkIn).GetProperty("attendance").GetProperty("status").GetString().Should().Be("checked_in");
        var replayedCheckIn = await Post($"/api/v2/events/{eventId}/registration-product/guests/{guestId}/attendance/check_in", new { expected_version = 0 }, "erp-guest-checkin-0001");
        Data(replayedCheckIn).GetProperty("replayed").GetBoolean().Should().BeTrue();
        var dry = await Post($"/api/v2/events/{eventId}/registration-product/retention/dry-run", new { as_of = DateTime.UtcNow.AddDays(10).ToString("O") }, "erp-retention-dry-0001");
        var runId = Data(dry).GetProperty("run").GetProperty("id").GetInt64();
        var applied = await Post($"/api/v2/events/{eventId}/registration-product/retention/{runId}/apply", new { }, "erp-retention-apply-0001");
        var appliedBody = await applied.Content.ReadFromJsonAsync<JsonElement>();
        applied.StatusCode.Should().Be(HttpStatusCode.Created, appliedBody.ToString());
        appliedBody.GetProperty("data").GetProperty("run").GetProperty("affected_count").GetInt32().Should().BeGreaterThan(0);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.EventRegistrationGuests.IgnoreQueryFilters().SingleAsync(x => x.Id == guestId);
        stored.Status.Should().Be("anonymised");
        stored.EmailCiphertext.Should().BeNull();
        stored.DisplayNameCiphertext.Should().BeNull();
    }

    [Fact]
    public async Task GuestCancellation_ReplaysOnlyTheSameRevisionBoundReasonAndWritesOneOutbox()
    {
        var (eventId, registrationId) = await EventAsync(seedRegistration: true);
        await AuthenticateAsAdminAsync();
        await Put($"/api/v2/events/{eventId}/registration-product/settings", Settings(), "erp-cancel-settings-0001");
        await Post($"/api/v2/events/{eventId}/registration-product/settings/publish", new { expected_revision = 1 }, "erp-cancel-settings-publish-0001");
        await AuthenticateAsMemberAsync();
        var captured = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/registrations/{registrationId}/guests", new { expected_registration_version = 1, display_name = "Retry Guest", email = "retry@example.test", consent_accepted = true, consent_text = "I consent", consent_text_version = "v1", preferred_locale = "en", notification_consent = false });
        var guestId = Data(captured).GetProperty("guest").GetProperty("id").GetInt64();

        var first = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/guests/{guestId}/cancel", new { expected_revision = 1, reason = "Plans changed" });
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(first).GetProperty("changed").GetBoolean().Should().BeTrue();
        var replay = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/guests/{guestId}/cancel", new { expected_revision = 1, reason = "Plans changed" });
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(replay).GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        var conflict = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/guests/{guestId}/cancel", new { expected_revision = 1, reason = "Different reason" });
        conflict.StatusCode.Should().Be(HttpStatusCode.Conflict);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var outboxes = await db.EventDomainOutbox.IgnoreQueryFilters().Where(x => x.EventId == eventId && x.Action == "event.registration_guest.withdrawn").ToListAsync();
        outboxes.Should().ContainSingle();
        outboxes[0].Status.Should().Be("pending");
        outboxes[0].Payload.Should().Contain("Plans changed").And.NotContain("retry@example.test");
    }

    [Fact]
    public async Task RegistrationManagerOverview_RedactsSensitiveGuestDataAndDeniesPrivilegedActions()
    {
        var (eventId, registrationId) = await EventAsync(seedRegistration: true);
        await AuthenticateAsAdminAsync();
        await Put($"/api/v2/events/{eventId}/registration-product/settings", Settings(), "erp-policy-settings-0001");
        await Post($"/api/v2/events/{eventId}/registration-product/settings/publish", new { expected_revision = 1 }, "erp-policy-settings-publish-0001");
        await AuthenticateAsMemberAsync();
        var captured = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/registration-product/registrations/{registrationId}/guests", new { expected_registration_version = 1, display_name = "Visible Name", email = "private@example.test", phone = "+353100001", consent_accepted = true, consent_text = "I consent", consent_text_version = "v1", preferred_locale = "en", notification_consent = false });
        var guestId = Data(captured).GetProperty("guest").GetProperty("id").GetInt64();
        using (var staffScope = Factory.Services.CreateScope())
        {
            var staffDb = staffScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            staffDb.EventStaffAssignments.Add(new EventStaffAssignment { TenantId = TestData.Tenant1.Id, EventId = eventId, UserId = TestData.MemberUser.Id, Role = "registration_manager", GrantedAt = DateTime.UtcNow, GrantedBy = TestData.AdminUser.Id });
            await staffDb.SaveChangesAsync();
        }

        var overview = await Client.GetAsync($"/api/v2/events/{eventId}/registration-product/manage");
        overview.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = Data(overview);
        var permissions = data.GetProperty("permissions");
        permissions.GetProperty("view_roster").GetBoolean().Should().BeTrue();
        permissions.GetProperty("export_answers").GetBoolean().Should().BeTrue();
        permissions.GetProperty("view_sensitive_answers").GetBoolean().Should().BeFalse();
        permissions.GetProperty("manage_retention").GetBoolean().Should().BeFalse();
        permissions.GetProperty("manage_attendance").GetBoolean().Should().BeFalse();
        var guest = data.GetProperty("guests").EnumerateArray().Single(x => x.GetProperty("id").GetInt64() == guestId);
        guest.GetProperty("display_name").GetString().Should().Be("Visible Name");
        guest.TryGetProperty("email", out _).Should().BeFalse();
        guest.TryGetProperty("phone", out _).Should().BeFalse();

        var retention = await Post($"/api/v2/events/{eventId}/registration-product/retention/dry-run", new { as_of = DateTime.UtcNow.AddDays(10).ToString("O") }, "erp-policy-retention-0001");
        retention.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var attendance = await Post($"/api/v2/events/{eventId}/registration-product/guests/{guestId}/attendance/check_in", new { expected_version = 0 }, "erp-policy-attendance-0001");
        attendance.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GroupAudienceAndCsvCampaigns_UseFrozenValidatedSnapshots()
    {
        var (eventId, registrationId) = await EventAsync(seedRegistration: true);
        await AuthenticateAsAdminAsync();
        int groupId;
        using (var seedScope = Factory.Services.CreateScope())
        {
            var seedDb = seedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var member = await seedDb.Users.IgnoreQueryFilters().SingleAsync(x => x.Id == TestData.MemberUser.Id);
            member.IsApproved = true;
            member.PreferredLanguage = "ga";
            member.CreatedAt = new DateTime(2025, 1, 15, 12, 0, 0, DateTimeKind.Utc);
            var group = new Group { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Name = "Invitation source", Status = "active", IsActive = true };
            seedDb.Groups.Add(group); await seedDb.SaveChangesAsync(); groupId = group.Id;
            seedDb.GroupMembers.Add(new GroupMember { TenantId = TestData.Tenant1.Id, GroupId = group.Id, UserId = TestData.MemberUser.Id, Role = "member", Status = "active" });
            await seedDb.SaveChangesAsync();
        }
        var groupPreview = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "group", source = new { group_id = groupId }, default_locale = "en" }, "erp-group-preview-0001");
        groupPreview.StatusCode.Should().Be(HttpStatusCode.Created);
        var groupCampaign = Data(groupPreview).GetProperty("campaign");
        groupCampaign.GetProperty("valid_count").GetInt32().Should().Be(1);
        var groupCampaignId = groupCampaign.GetProperty("id").GetInt64();
        using (var mutateScope = Factory.Services.CreateScope())
        {
            var mutateDb = mutateScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var membership = await mutateDb.GroupMembers.IgnoreQueryFilters().SingleAsync(x => x.TenantId == TestData.Tenant1.Id && x.GroupId == groupId && x.UserId == TestData.MemberUser.Id);
            mutateDb.GroupMembers.Remove(membership); await mutateDb.SaveChangesAsync();
        }
        var groupIssue = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/{groupCampaignId}/issue", new { expected_revision = 1, expires_at = DateTime.UtcNow.AddDays(2).ToString("O") }, "erp-group-issue-0001");
        groupIssue.StatusCode.Should().Be(HttpStatusCode.OK);
        var groupIssueData = Data(groupIssue);
        groupIssueData.GetProperty("invitations").GetArrayLength().Should().Be(1, "issuance must use the frozen preview snapshot");
        using (var localeScope = Factory.Services.CreateScope())
        {
            var localeDb = localeScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await localeDb.EventInvitations.IgnoreQueryFilters()
                .Where(x => x.EventId == eventId && x.CampaignId == groupCampaignId)
                .Select(x => x.Locale).SingleAsync()).Should().Be("ga", "member locale overrides the campaign fallback");
            (await localeDb.EventInvitationDeliveryEvidence.IgnoreQueryFilters()
                .Where(x => x.EventId == eventId && x.EvidenceVersion == 1)
                .Select(x => x.RecipientLocale).Distinct().ToListAsync()).Should().Equal("ga");
        }

        var audience = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "audience", source = new { member_ids = new[] { TestData.MemberUser.Id } }, default_locale = "en" }, "erp-audience-preview-0001");
        audience.StatusCode.Should().Be(HttpStatusCode.Created);
        Data(audience).GetProperty("campaign").GetProperty("valid_count").GetInt32().Should().Be(1);
        var criteriaAudience = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new
        {
            campaign_type = "audience",
            source = new { criteria = new { all_active = true, approved = true, preferred_languages = new[] { "ga" }, joined_after = "2025-01-01", joined_before = "2025-01-31" } },
            default_locale = "en"
        }, "erp-audience-criteria-preview-0001");
        criteriaAudience.StatusCode.Should().Be(HttpStatusCode.Created);
        Data(criteriaAudience).GetProperty("campaign").GetProperty("valid_count").GetInt32().Should().Be(1);
        var invalidRange = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new
        {
            campaign_type = "audience",
            source = new { criteria = new { joined_after = "2025-02-01", joined_before = "2025-01-01" } },
            default_locale = "en"
        }, "erp-audience-range-preview-0001");
        invalidRange.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var csv = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "csv", source = new { csv = "name,email\nOne,first@example.test\nBad,not-an-email\nDuplicate,FIRST@example.test" }, default_locale = "en" }, "erp-csv-preview-0001");
        csv.StatusCode.Should().Be(HttpStatusCode.Created);
        var csvCampaign = Data(csv).GetProperty("campaign");
        csvCampaign.GetProperty("preview_count").GetInt32().Should().Be(3);
        csvCampaign.GetProperty("valid_count").GetInt32().Should().Be(1);
        csvCampaign.GetProperty("error_count").GetInt32().Should().Be(2);

        var malformed = new HttpRequestMessage(HttpMethod.Post, $"/api/v2/events/{eventId}/registration-product/registrations/{registrationId}/guests") { Content = JsonContent.Create(new[] { "not", "an", "object" }) };
        var malformedResponse = await Client.SendAsync(malformed);
        malformedResponse.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var storedCampaigns = await db.EventInvitationCampaigns.IgnoreQueryFilters().Where(x => x.EventId == eventId).ToListAsync();
        storedCampaigns.Should().HaveCount(4).And.OnlyContain(x => !x.Source.Contains("first@example.test", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task DeliveryWorker_ReclaimsStaleParentsAndDeadLettersInvalidPayloadAfterFiveClaims()
    {
        var (eventId, _) = await EventAsync();
        await AuthenticateAsAdminAsync();
        var preview = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "member", source = new { member_ids = new[] { TestData.MemberUser.Id } }, default_locale = "en" }, "erp-dead-preview-0001");
        var campaignId = Data(preview).GetProperty("campaign").GetProperty("id").GetInt64();
        await Post($"/api/v2/events/{eventId}/registration-product/campaigns/{campaignId}/issue", new { expected_revision = 1, expires_at = DateTime.UtcNow.AddDays(2).ToString("O") }, "erp-dead-issue-0001");

        long outboxId;
        using (var corruptScope = Factory.Services.CreateScope())
        {
            var corruptDb = corruptScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var outbox = await corruptDb.EventDomainOutbox.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId && x.Action == "event.invitation.issued");
            outbox.Payload = "{}";
            outbox.Status = "processing";
            outbox.ClaimToken = Guid.NewGuid();
            outbox.ClaimedAt = DateTime.UtcNow.AddMinutes(-10);
            outboxId = outbox.Id;
            await corruptDb.SaveChangesAsync();
        }

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            using var processScope = Factory.Services.CreateScope();
            var result = await processScope.ServiceProvider.GetRequiredService<EventInvitationDeliveryProcessor>().ProcessBatchAsync();
            result.Claimed.Should().Be(1);
            if (attempt < 5)
            {
                result.Retrying.Should().Be(1);
                var processDb = processScope.ServiceProvider.GetRequiredService<NexusDbContext>();
                await processDb.EventDomainOutbox.IgnoreQueryFilters().Where(x => x.Id == outboxId)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.NextAttemptAt, DateTime.UtcNow.AddMinutes(-1)));
            }
            else result.DeadLettered.Should().Be(1);
        }

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await assertDb.EventDomainOutbox.IgnoreQueryFilters().SingleAsync(x => x.Id == outboxId);
        stored.Status.Should().Be("dead_lettered");
        stored.Attempts.Should().Be(5);
        stored.DeadLetteredAt.Should().NotBeNull();
        stored.ClaimToken.Should().BeNull();
    }

    [Fact]
    public async Task ExternalEmailDelivery_UsesTheProviderAndRecordsTerminalEvidence()
    {
        var (eventId, _) = await EventAsync();
        await AuthenticateAsAdminAsync();
        var preview = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "email", source = new { emails = new[] { "outside@example.test" } }, default_locale = "en" }, "erp-email-preview-0001");
        var campaignId = Data(preview).GetProperty("campaign").GetProperty("id").GetInt64();
        var issued = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/{campaignId}/issue", new { expected_revision = 1, expires_at = DateTime.UtcNow.AddDays(2).ToString("O") }, "erp-email-issue-0001");
        Data(issued).GetProperty("invitations")[0].TryGetProperty("secret", out _).Should().BeFalse("the invitation bearer secret is delivery-only evidence");

        var transport = new RecordingInvitationEmailService(true);
        using var deliveryFactory = Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(transport);
        }));
        using (var processScope = deliveryFactory.Services.CreateScope())
        {
            var result = await processScope.ServiceProvider.GetRequiredService<EventInvitationDeliveryProcessor>().ProcessBatchAsync();
            result.Completed.Should().Be(1);
        }

        transport.Recipients.Should().ContainSingle().Which.Should().Be("outside@example.test");
        var expectedUrlPrefix = $"http://localhost:5173/test-tenant/events/{eventId}?invitation_token=nxi1_";
        transport.HtmlBodies.Should().ContainSingle().Which.Should().Contain(expectedUrlPrefix);
        transport.TextBodies.Should().ContainSingle().Which.Should().Contain(expectedUrlPrefix);
        using var assertScope = Factory.Services.CreateScope();
        var db = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var delivery = await db.EventNotificationDeliveries.IgnoreQueryFilters().SingleAsync(x => x.ExternalRecipientHash != null && x.Channel == "email");
        delivery.Status.Should().Be("delivered");
        delivery.Provider.Should().Be(nameof(RecordingInvitationEmailService));
        var emailLog = await db.EmailLogs.IgnoreQueryFilters().SingleAsync(x => x.IdempotencyKey == delivery.DeliveryKey);
        emailLog.Status.Should().Be(EmailSendStatus.Sent);
        emailLog.Provider.Should().Be(nameof(RecordingInvitationEmailService));
        emailLog.Source.Should().Be(nameof(EventInvitationDeliveryProcessor));
        (await db.EventInvitationDeliveryEvidence.IgnoreQueryFilters().SingleAsync(x => x.NotificationDeliveryId == delivery.Id && x.EvidenceVersion == 2)).Status.Should().Be("delivered");
    }

    [Fact]
    public async Task ExternalEmailDelivery_RetriesProviderRejectionAndTerminatesAfterFiveAttempts()
    {
        var (eventId, _) = await EventAsync();
        await AuthenticateAsAdminAsync();
        var preview = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "email", source = new { emails = new[] { "rejected@example.test" } }, default_locale = "en" }, "erp-rejected-preview-0001");
        var campaignId = Data(preview).GetProperty("campaign").GetProperty("id").GetInt64();
        await Post($"/api/v2/events/{eventId}/registration-product/campaigns/{campaignId}/issue", new { expected_revision = 1, expires_at = DateTime.UtcNow.AddDays(2).ToString("O") }, "erp-rejected-issue-0001");
        long outboxId;
        using (var outboxScope = Factory.Services.CreateScope())
        {
            var outboxDb = outboxScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            outboxId = await outboxDb.EventDomainOutbox.IgnoreQueryFilters().Where(x => x.EventId == eventId && x.Action == "event.invitation.issued").Select(x => x.Id).SingleAsync();
        }

        var transport = new RecordingInvitationEmailService(false);
        using var deliveryFactory = Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IEmailService>();
            services.AddSingleton<IEmailService>(transport);
        }));
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            using var processScope = deliveryFactory.Services.CreateScope();
            await processScope.ServiceProvider.GetRequiredService<EventInvitationDeliveryProcessor>().ProcessBatchAsync();
            if (attempt >= 5) continue;
            var db = processScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.EventDomainOutbox.IgnoreQueryFilters().Where(x => x.Id == outboxId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.NextAttemptAt, DateTime.UtcNow.AddMinutes(-1)));
            await db.EventNotificationDeliveries.IgnoreQueryFilters().Where(x => x.OutboxId == outboxId && x.Channel == "email")
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.NextAttemptAt, DateTime.UtcNow.AddMinutes(-1)));
        }

        transport.Recipients.Should().HaveCount(5).And.OnlyContain(x => x == "rejected@example.test");
        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var delivery = await assertDb.EventNotificationDeliveries.IgnoreQueryFilters().SingleAsync(x => x.OutboxId == outboxId && x.Channel == "email");
        delivery.Status.Should().Be("failed_terminal");
        delivery.Attempts.Should().Be(5);
        delivery.DeadLetteredAt.Should().NotBeNull();
        var emailLog = await assertDb.EmailLogs.IgnoreQueryFilters().SingleAsync(x => x.IdempotencyKey == delivery.DeliveryKey);
        emailLog.Status.Should().Be(EmailSendStatus.Failed);
        emailLog.RetryCount.Should().Be(4);
        var outbox = await assertDb.EventDomainOutbox.IgnoreQueryFilters().SingleAsync(x => x.Id == outboxId);
        outbox.Status.Should().Be("processed");
        (await assertDb.EventInvitationDeliveryEvidence.IgnoreQueryFilters().SingleAsync(x => x.NotificationDeliveryId == delivery.Id && x.EvidenceVersion == 2)).Status.Should().Be("failed");
    }

    [Fact]
    public async Task Issue_ReauthorizesFrozenRecipientsAndEmailTargetsCannotBypassMemberPolicy()
    {
        var (eventId, _) = await EventAsync();
        await AuthenticateAsAdminAsync();
        var preview = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "member", source = new { member_ids = new[] { TestData.MemberUser.Id } }, default_locale = "en" }, "erp-reauth-preview-0001");
        var campaignId = Data(preview).GetProperty("campaign").GetProperty("id").GetInt64();
        using (var blockScope = Factory.Services.CreateScope())
        {
            var db = blockScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.UserBlocks.Add(new UserBlock { TenantId = TestData.Tenant1.Id, UserId = TestData.AdminUser.Id, BlockedUserId = TestData.MemberUser.Id, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }

        var issue = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/{campaignId}/issue", new { expected_revision = 1, expires_at = DateTime.UtcNow.AddDays(2).ToString("O") }, "erp-reauth-issue-0001");
        issue.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var emailBypass = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "email", source = new { emails = new[] { TestData.MemberUser.Email } }, default_locale = "en" }, "erp-email-bypass-preview-0001");
        emailBypass.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        using var assertScope = Factory.Services.CreateScope();
        (await assertScope.ServiceProvider.GetRequiredService<NexusDbContext>().EventInvitations.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId)).Should().Be(0);
    }

    [Fact]
    public async Task Delivery_RechecksLivePreferencesBeforeSendingQueuedMemberChannels()
    {
        var (eventId, _) = await EventAsync();
        await AuthenticateAsAdminAsync();
        var preview = await Post($"/api/v2/events/{eventId}/registration-product/campaigns/preview", new { campaign_type = "member", source = new { member_ids = new[] { TestData.MemberUser.Id } }, default_locale = "en" }, "erp-live-pref-preview-0001");
        var campaignId = Data(preview).GetProperty("campaign").GetProperty("id").GetInt64();
        await Post($"/api/v2/events/{eventId}/registration-product/campaigns/{campaignId}/issue", new { expected_revision = 1, expires_at = DateTime.UtcNow.AddDays(2).ToString("O") }, "erp-live-pref-issue-0001");
        using (var preferenceScope = Factory.Services.CreateScope())
        {
            var db = preferenceScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var member = await db.Users.IgnoreQueryFilters().SingleAsync(x => x.Id == TestData.MemberUser.Id);
            member.NotificationPreferences = JsonSerializer.Serialize(new { email_events = false, push_enabled = false });
            db.EventNotificationPreferencesProduct.Add(new EventNotificationPreferenceProduct
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                EventId = eventId,
                EmailEnabled = false,
                InAppEnabled = false,
                WebPushEnabled = false,
                FcmEnabled = false,
                RealtimeEnabled = false,
                Cadence = "off"
            });
            await db.SaveChangesAsync();
        }

        using (var processScope = Factory.Services.CreateScope())
        {
            var result = await processScope.ServiceProvider.GetRequiredService<EventInvitationDeliveryProcessor>().ProcessBatchAsync();
            result.Completed.Should().Be(1);
        }
        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await assertDb.EventNotificationDeliveries.IgnoreQueryFilters().Where(x => x.RecipientUserId == TestData.MemberUser.Id).ToListAsync())
            .Should().OnlyContain(x => x.Status == "suppressed");
        (await assertDb.Notifications.IgnoreQueryFilters().CountAsync(x => x.UserId == TestData.MemberUser.Id && x.Type == "event_invitation")).Should().Be(0);
    }

    [Fact]
    public async Task OrganizerAndTenantBoundaries_FailClosed()
    {
        var (eventId, _) = await EventAsync();
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/registration-product/manage")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/registration-product")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<(int EventId, long RegistrationId)> EventAsync(bool seedRegistration = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "Registration product event", StartsAt = now.AddDays(7), EndsAt = now.AddDays(7).AddHours(2), Timezone = "Europe/Dublin", Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled" };
        db.Events.Add(evt);
        await db.SaveChangesAsync();
        if (!seedRegistration) return (evt.Id, 0);
        var registration = new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, RegistrationState = "confirmed", ConfirmedAt = now, StateChangedAt = now, StateChangedBy = TestData.MemberUser.Id };
        db.EventRegistrations.Add(registration);
        await db.SaveChangesAsync();
        return (evt.Id, registration.Id);
    }

    private static object Settings(int guestRetentionDays = 30, long expectedRevision = 0)
    {
        var now = DateTime.UtcNow;
        var closes = now.AddDays(6);
        return new { expected_revision = expectedRevision, approval_mode = "auto", per_member_limit = 1, guests_enabled = true, max_guests_per_registration = 2, guest_retention_days = guestRetentionDays, opens_at_utc = now.AddDays(-1).ToString("O"), closes_at_utc = closes.ToString("O"), cancellation_cutoff_at_utc = closes.ToString("O") };
    }
    private async Task<HttpResponseMessage> Put(string path, object body, string key) { var request = new HttpRequestMessage(HttpMethod.Put, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return await Client.SendAsync(request); }
    private async Task<HttpResponseMessage> Post(string path, object body, string key) { var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return await Client.SendAsync(request); }
    private static JsonElement Data(HttpResponseMessage response) => response.Content.ReadFromJsonAsync<JsonElement>().GetAwaiter().GetResult().GetProperty("data");

    private sealed class RecordingInvitationEmailService(bool succeeds) : IEmailService
    {
        public List<string> Recipients { get; } = [];
        public List<string> HtmlBodies { get; } = [];
        public List<string> TextBodies { get; } = [];
        public Task<bool> SendEmailAsync(string to, string subject, string htmlBody, string? textBody = null, CancellationToken ct = default) { Recipients.Add(to); HtmlBodies.Add(htmlBody); TextBodies.Add(textBody ?? ""); return Task.FromResult(succeeds); }
        public Task<bool> SendPasswordResetEmailAsync(string to, string resetToken, string userName, string resetUrl, CancellationToken ct = default) => Task.FromResult(succeeds);
        public Task<bool> SendWelcomeEmailAsync(string to, string userName, string tenantName, CancellationToken ct = default) => Task.FromResult(succeeds);
        public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(succeeds);
    }
}
