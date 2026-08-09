// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventRegistrationProductController(EventRegistrationProductService registration) : ControllerBase
{
    private const string Root = "api/v2/events/{id:int}/registration-product";

    [HttpGet(Root)]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationReadPolicy)]
    public Task<IActionResult> AttendeeState(int id, CancellationToken ct) =>
        Run(registration.AttendeeState(Tenant(), id, UserId(), ct));

    [HttpGet(Root + "/manage")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationReadPolicy)]
    public Task<IActionResult> OrganizerOverview(int id, CancellationToken ct = default)
    {
        if (!PositiveQuery("submissions_page", 1, out var submissionsPage)
            || !PositiveQuery("submissions_per_page", 50, out var submissionsPerPage)
            || !PositiveQuery("campaigns_page", 1, out var campaignsPage)
            || !PositiveQuery("campaigns_per_page", 50, out var campaignsPerPage)
            || !PositiveQuery("guests_page", 1, out var guestsPage)
            || !PositiveQuery("guests_per_page", 50, out var guestsPerPage))
        {
            return Task.FromResult<IActionResult>(Error(new(
                "EVENT_REGISTRATION_VALIDATION_FAILED",
                "Validation failed",
                422,
                "pagination")));
        }

        return Run(registration.OrganizerOverview(
            Tenant(), id, UserId(),
            submissionsPage, Math.Min(submissionsPerPage, 100),
            campaignsPage, Math.Min(campaignsPerPage, 100),
            guestsPage, Math.Min(guestsPerPage, 100),
            ct));
    }

    [HttpPut(Root + "/settings")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> SaveSettings(int id, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.SaveSettings(Tenant(), id, UserId(), body, Long(body, "expected_revision"), Key(body), ct));

    [HttpPost(Root + "/settings/publish")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> PublishSettings(int id, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.PublishSettings(Tenant(), id, UserId(), Long(body, "expected_revision"), Key(body), ct));

    [HttpPost(Root + "/forms")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> CreateForm(int id, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.CreateForm(Tenant(), id, UserId(), body, Long(body, "expected_settings_revision"), Key(body), ct));

    [HttpPut(Root + "/forms/{formId:long}")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> UpdateForm(int id, long formId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.UpdateForm(Tenant(), id, formId, UserId(), body, Long(body, "expected_form_revision"), Long(body, "expected_settings_revision"), Key(body), ct));

    [HttpPost(Root + "/forms/{formId:long}/fork")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> ForkForm(int id, long formId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.ForkForm(Tenant(), id, formId, UserId(), Long(body, "expected_settings_revision"), Key(body), ct));

    [HttpPost(Root + "/forms/{formId:long}/publish")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> PublishForm(int id, long formId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.PublishForm(Tenant(), id, formId, UserId(), Long(body, "expected_form_revision"), Long(body, "expected_settings_revision"), Key(body), ct));

    [HttpPost(Root + "/submissions")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationSubmissionPolicy)]
    public Task<IActionResult> SaveSubmission(int id, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.SaveSubmission(Tenant(), id, UserId(), Long(body, "registration_id"), Long(body, "form_version_id"), NullableLong(body, "expected_revision"), Property(body, "answers"), Key(body), ct));

    [HttpPost(Root + "/submissions/{submissionId:long}/submit")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationSubmissionPolicy)]
    public Task<IActionResult> Submit(int id, long submissionId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.Submit(Tenant(), id, submissionId, UserId(), Long(body, "expected_revision"), Key(body), ct));

    [HttpPost(Root + "/submissions/{submissionId:long}/amend")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationSubmissionPolicy)]
    public Task<IActionResult> Amend(int id, long submissionId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.Amend(Tenant(), id, submissionId, UserId(), Long(body, "expected_revision"), Key(body), ct));

    [HttpPost(Root + "/submissions/{submissionId:long}/answers")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationAnswerReadPolicy)]
    public Task<IActionResult> Answers(int id, long submissionId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.ReadAnswers(Tenant(), id, submissionId, UserId(), Text(body, "purpose") ?? "", Text(body, "correlation_id") ?? "", Bool(body, "include_sensitive"), ct));

    [HttpPost(Root + "/submissions/export")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationRestrictedPolicy)]
    public async Task<IActionResult> Export(int id, [FromBody] JsonElement body, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        Response.Headers["API-Version"] = "2.0";
        var result = await registration.Export(Tenant(), id, UserId(), Text(body, "purpose") ?? "", Text(body, "correlation_id") ?? "", Bool(body, "include_sensitive"), ct);
        if (!result.Succeeded) return Error(result.Error!);
        return File((byte[])result.Data!, "text/csv; charset=UTF-8", $"event-registration-{id}.csv");
    }

    [HttpPost(Root + "/campaigns/preview")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> PreviewCampaign(int id, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.PreviewCampaign(Tenant(), id, UserId(), Text(body, "campaign_type") ?? "", Property(body, "source"), Text(body, "default_locale") ?? "en", Key(body), ct));

    [HttpPost(Root + "/campaigns/{campaignId:long}/schedule")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationRestrictedPolicy)]
    public Task<IActionResult> ScheduleCampaign(int id, long campaignId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.ScheduleCampaign(Tenant(), id, campaignId, UserId(), Long(body, "expected_revision"), Date(body, "scheduled_for"), Key(body), ct));

    [HttpPost(Root + "/campaigns/{campaignId:long}/issue")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationRestrictedPolicy)]
    public Task<IActionResult> IssueCampaign(int id, long campaignId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.IssueCampaign(Tenant(), id, campaignId, UserId(), Long(body, "expected_revision"), Date(body, "expires_at"), Key(body), ct));

    [HttpPost(Root + "/campaigns/{campaignId:long}/cancel")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> CancelCampaign(int id, long campaignId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.CancelCampaign(Tenant(), id, campaignId, UserId(), Long(body, "expected_revision"), Text(body, "reason") ?? "", Key(body), ct));

    [HttpPost(Root + "/invitations/{invitationId:long}/revoke")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> RevokeInvitation(int id, long invitationId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.RevokeInvitation(Tenant(), id, invitationId, UserId(), Text(body, "reason") ?? "", Key(body), ct));

    [HttpPost(Root + "/invitations/accept")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> AcceptInvitation(int id, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.AcceptInvitation(Tenant(), id, null, UserId(), Text(body, "token"), Text(body, "email"), Key(body), ct));

    [HttpPost(Root + "/invitations/{invitationId:long}/accept")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> AcceptMemberInvitation(int id, long invitationId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.AcceptInvitation(Tenant(), id, invitationId, UserId(), null, null, Key(body), ct));

    [HttpPost(Root + "/registrations/{registrationId:long}/guests")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> CaptureGuest(int id, long registrationId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.CaptureGuest(Tenant(), id, registrationId, UserId(), Long(body, "expected_registration_version"), body, ct));

    [HttpPost(Root + "/guests/{guestId:long}/cancel")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationMutationPolicy)]
    public Task<IActionResult> CancelGuest(int id, long guestId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.CancelGuest(Tenant(), id, guestId, UserId(), Long(body, "expected_revision"), Text(body, "reason") ?? "", ct));

    [HttpPost(Root + "/guests/{guestId:long}/attendance/{attendanceAction:regex(^(check_in|check_out|no_show|undo)$)}")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationSubmissionPolicy)]
    public Task<IActionResult> GuestAttendance(int id, long guestId, string attendanceAction, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.GuestAttendance(Tenant(), id, guestId, UserId(), attendanceAction, Long(body, "expected_version"), Key(body), Text(body, "reason"), ct));

    [HttpPost(Root + "/retention/dry-run")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationRestrictedPolicy)]
    public Task<IActionResult> RetentionDryRun(int id, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.RetentionDryRun(Tenant(), id, UserId(), Date(body, "as_of"), Key(body), ct));

    [HttpPost(Root + "/retention/{dryRunId:long}/apply")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationRetentionApplyPolicy)]
    public Task<IActionResult> RetentionApply(int id, long dryRunId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(registration.RetentionApply(Tenant(), id, dryRunId, UserId(), Key(body), ct));

    private async Task<IActionResult> Run(Task<EventRegistrationProductResult> task)
    {
        var result = await task;
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        Response.Headers["API-Version"] = "2.0";
        return result.Succeeded
            ? StatusCode(result.Status, new { success = true, data = result.Data })
            : Error(result.Error!);
    }

    private IActionResult Error(EventRegistrationProductError error)
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        Response.Headers["API-Version"] = "2.0";
        var errors = error.Field is null ? null : new Dictionary<string, string[]> { [error.Field] = [error.Message] };
        return StatusCode(error.Status, new { success = false, message = error.Message, code = error.Code, error = new { code = error.Code, message = error.Message, field = error.Field }, errors });
    }

    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException();
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException();
    private string Key(JsonElement body)
    {
        var header = Request.Headers["Idempotency-Key"].ToString().Trim();
        var supplied = Text(body, "idempotency_key")?.Trim() ?? "";
        return header.Length > 0 && supplied.Length > 0 && !string.Equals(header, supplied, StringComparison.Ordinal) ? "" : header.Length > 0 ? header : supplied;
    }
    private static JsonElement Property(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) ? value : default;
    private static string? Text(JsonElement body, string name) => Property(body, name).ValueKind == JsonValueKind.String ? Property(body, name).GetString() : null;
    private static long Long(JsonElement body, string name) { var value = Property(body, name); return value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var parsed) ? parsed : 0; }
    private static long? NullableLong(JsonElement body, string name) { var value = Property(body, name); return value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var parsed) ? parsed : -1; }
    private static bool Bool(JsonElement body, string name) => Property(body, name).ValueKind == JsonValueKind.True;
    private static DateTime Date(JsonElement body, string name) => DateTimeOffset.TryParse(Text(body, name), out var value) ? value.UtcDateTime : default;
    private bool PositiveQuery(string name, int defaultValue, out int value)
    {
        var raw = Request.Query[name].ToString();
        if (raw.Length == 0)
        {
            value = defaultValue;
            return true;
        }

        return int.TryParse(raw, out value) && value > 0;
    }
}
