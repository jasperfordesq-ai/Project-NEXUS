// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventRegistrationProductError(string Code, string Message, int Status, string? Field = null);
public sealed record EventRegistrationProductResult(object? Data, EventRegistrationProductError? Error = null, int Status = 200)
{
    public bool Succeeded => Error is null;
}

public sealed partial class EventRegistrationProductService(NexusDbContext db, IDataProtectionProvider protection, EventInvitationRecipientAuthorizer recipientAuthorizer, EventInvitationEvidenceHasher invitationHasher, EventNotificationPreferenceResolver notificationPreferences)
{
    private readonly IDataProtector _protector = protection.CreateProtector("nexus.event-registration-product.v1");
    private static readonly HashSet<string> QuestionTypes = ["short_text", "long_text", "single_choice", "multiple_choice", "dietary", "accessibility", "consent", "waiver"];
    private static readonly HashSet<string> Classifications = ["public", "internal", "confidential", "sensitive"];

    public async Task<EventRegistrationProductResult> OrganizerOverview(
        int tenantId,
        int eventId,
        int actorId,
        int submissionsPage,
        int submissionsPerPage,
        int campaignsPage,
        int campaignsPerPage,
        int guestsPage,
        int guestsPerPage,
        CancellationToken ct)
    {
        var context = await Context(tenantId, eventId, actorId, true, ct);
        if (!context.Ok) return context.Error!;
        var permissions = await Permissions(tenantId, context.Event!, context.Actor!, ct);
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId, ct);
        var forms = await db.EventRegistrationFormVersions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId).OrderByDescending(x => x.VersionNumber).ToListAsync(ct);
        var submissionsQuery = db.EventRegistrationFormSubmissions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId).OrderByDescending(x => x.UpdatedAt).ThenByDescending(x => x.Id);
        var submissionsTotal = await submissionsQuery.CountAsync(ct);
        submissionsPage = ClampPage(submissionsPage, submissionsPerPage, submissionsTotal);
        var submissions = await submissionsQuery.Skip((submissionsPage - 1) * submissionsPerPage).Take(submissionsPerPage).ToListAsync(ct);
        var submissionUserIds = submissions.Select(x => x.UserId).Distinct().ToArray();
        Dictionary<int, string> memberNames = [];
        if (permissions.ViewRoster)
        {
            var members = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && submissionUserIds.Contains(x.Id))
                .Select(x => new { x.Id, x.FirstName, x.LastName })
                .ToListAsync(ct);
            memberNames = members.ToDictionary(x => x.Id, x => $"{x.FirstName} {x.LastName}".Trim());
        }
        var campaignsQuery = db.EventInvitationCampaigns.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId).OrderByDescending(x => x.Id);
        var campaignsTotal = await campaignsQuery.CountAsync(ct);
        campaignsPage = ClampPage(campaignsPage, campaignsPerPage, campaignsTotal);
        var campaigns = await campaignsQuery.Skip((campaignsPage - 1) * campaignsPerPage).Take(campaignsPerPage).ToListAsync(ct);
        var campaignIds = campaigns.Select(x => x.Id).ToArray();
        var invitationCounts = await db.EventInvitations.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.EventId == eventId && campaignIds.Contains(x.CampaignId))
            .GroupBy(x => x.CampaignId)
            .Select(x => new { CampaignId = x.Key, Count = x.Count() })
            .ToDictionaryAsync(x => x.CampaignId, x => x.Count, ct);
        var deliveryCounts = await db.EventInvitationDeliveryEvidence.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.EventId == eventId && campaignIds.Contains(x.CampaignId))
            .GroupBy(x => new { x.CampaignId, x.Status })
            .Select(x => new { x.Key.CampaignId, x.Key.Status, Count = x.Count() })
            .ToListAsync(ct);
        var guestsQuery = db.EventRegistrationGuests.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId).OrderBy(x => x.RegistrationId).ThenBy(x => x.GuestNumber).ThenBy(x => x.Id);
        var guestsTotal = await guestsQuery.CountAsync(ct);
        guestsPage = ClampPage(guestsPage, guestsPerPage, guestsTotal);
        var guests = await guestsQuery.Skip((guestsPage - 1) * guestsPerPage).Take(guestsPerPage).ToListAsync(ct);
        var formRows = new List<object>(); foreach (var form in forms) formRows.Add(await FormProjection(tenantId, form, ct));
        var guestRows = new List<object>(); foreach (var guest in guests) guestRows.Add(await GuestProjection(tenantId, guest, permissions.ViewRoster, permissions.ViewSensitiveAnswers, permissions.ViewSensitiveAnswers, ct));
        var campaignRows = campaigns.Select(campaign => CampaignProjection(
            campaign,
            invitationCounts.GetValueOrDefault(campaign.Id),
            deliveryCounts.Where(x => x.CampaignId == campaign.Id).ToDictionary(x => x.Status, x => x.Count))).ToArray();
        return new(new
        {
            settings = settings is null ? null : SettingsProjection(settings), forms = formRows,
            submissions = submissions.Select(x => SubmissionProjection(x, permissions.ViewRoster && memberNames.TryGetValue(x.UserId, out var name) ? name : null, permissions.ViewRoster)), campaigns = campaignRows, guests = guestRows,
            pagination = new { submissions = Page(submissionsPage, submissionsPerPage, submissionsTotal), campaigns = Page(campaignsPage, campaignsPerPage, campaignsTotal), guests = Page(guestsPage, guestsPerPage, guestsTotal) },
            summary = new { submissions_total = submissionsTotal, campaigns_total = campaignsTotal, guests_total = guestsTotal },
            permissions = new { view_roster = permissions.ViewRoster, view_sensitive_answers = permissions.ViewSensitiveAnswers, export_answers = permissions.ExportAnswers, manage_retention = permissions.ManageRetention, manage_attendance = permissions.ManageAttendance }
        });
    }

    public async Task<EventRegistrationProductResult> AttendeeState(int tenantId, int eventId, int actorId, CancellationToken ct)
    {
        var context = await Context(tenantId, eventId, actorId, false, ct);
        if (!context.Ok) return context.Error!;
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Status == "published", ct);
        EventRegistrationFormVersion? form = null;
        if (settings?.PublishedFormVersionId is long versionNumber)
            form = await db.EventRegistrationFormVersions.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.VersionNumber == versionNumber && x.Status == "published", ct);
        var registrations = await db.EventRegistrations.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId && x.UserId == actorId).OrderBy(x => x.Id).ToListAsync(ct);
        var registrationIds = registrations.Select(x => x.Id).ToArray();
        var submissions = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId && x.UserId == actorId && registrationIds.Contains(x.RegistrationId)).OrderByDescending(x => x.Id).ToListAsync(ct);
        var guests = await db.EventRegistrationGuests.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId && registrationIds.Contains(x.RegistrationId)).OrderBy(x => x.GuestNumber).ToListAsync(ct);
        var guestRows = new List<object>(); foreach (var guest in guests) guestRows.Add(await GuestProjection(tenantId, guest, true, true, false, ct));
        var invitations = await db.EventInvitations.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId && x.UserId == actorId).OrderByDescending(x => x.Id).Select(x => new { id = x.Id, campaign_id = x.CampaignId, status = x.Status, invitation_version = x.InvitationVersion, token_expires_at = Iso(x.TokenExpiresAt), accepted_at = IsoN(x.AcceptedAt), revoked_at = IsoN(x.RevokedAt) }).ToListAsync(ct);
        return new(new
        {
            settings = settings is null ? null : SettingsProjection(settings), form = form is null ? null : await FormProjection(tenantId, form, ct),
            registrations = registrations.Select(x => new { id = x.Id, registration_state = x.RegistrationState, registration_version = x.RegistrationVersion, party_size = 1 + guests.Count(g => g.RegistrationId == x.Id && g.Status == "captured"), state_changed_at = Iso(x.StateChangedAt), invited_at = IsoN(x.InvitedAt), pending_at = IsoN(x.PendingAt), confirmed_at = IsoN(x.ConfirmedAt), declined_at = IsoN(x.DeclinedAt), cancelled_at = IsoN(x.CancelledAt) }),
            submissions = submissions.Select(x => SubmissionProjection(x)), guests = guestRows, invitations
        });
    }

    public async Task<EventRegistrationProductResult> SaveSettings(int tenantId, int eventId, int actorId, JsonElement body, long expectedRevision, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || expectedRevision < 0 || !SettingsInput(body, out var input)) return Validation("settings");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(tenantId, eventId, ct);
        var context = await Context(tenantId, eventId, actorId, true, ct); if (!context.Ok) return context.Error!;
        if (input.Opens is not null && input.Closes is not null && input.Opens >= input.Closes || input.Closes > context.Event!.StartsAt || input.Cutoff > context.Event.StartsAt) return Validation("registration_window");
        var keyHash = Hash(key); var requestHash = Hash(new { eventId, expectedRevision, settings = body.GetRawText() }); var replay = await db.EventRegistrationSettingsHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.IdempotencyHash == keyHash, ct);
        if (replay is not null) { if (replay.EventId != eventId || replay.Action != "saved" || !string.Equals(replay.RequestHash, requestHash, StringComparison.Ordinal)) return Conflict(); var old = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == replay.SettingsId && x.EventId == eventId, ct); if (old is null) return Conflict(); await tx.CommitAsync(ct); return Mutation("settings", SettingsProjection(old), false, 200); }
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId, ct);
        if (settings is null && expectedRevision != 0 || settings is not null && settings.Revision != expectedRevision) return Conflict();
        settings ??= new EventRegistrationSettings { TenantId = tenantId, EventId = eventId, Revision = 0, CreatedBy = actorId };
        if (settings.Id == 0) db.Add(settings);
        settings.Revision++; if (settings.Id == 0) settings.Status = "draft"; settings.ApprovalMode = input.Approval; settings.PerMemberLimit = input.PerMember;
        settings.GuestsEnabled = input.Guests; settings.MaxGuestsPerRegistration = input.MaxGuests; settings.GuestRetentionDays = input.Retention;
        settings.OpensAtUtc = input.Opens; settings.ClosesAtUtc = input.Closes; settings.CancellationCutoffAtUtc = input.Cutoff;
        settings.EventTimezoneSnapshot = context.Event!.Timezone; settings.UpdatedBy = actorId; settings.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); db.Add(SettingsHistory(settings, "saved", actorId, keyHash, requestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Mutation("settings", SettingsProjection(settings), true, 201);
    }

    public async Task<EventRegistrationProductResult> PublishSettings(int tenantId, int eventId, int actorId, long expectedRevision, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || expectedRevision < 1) return Validation("expected_revision");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(tenantId, eventId, ct);
        var context = await Context(tenantId, eventId, actorId, true, ct); if (!context.Ok) return context.Error!;
        var keyHash = Hash(key); var requestHash = Hash(new { eventId, expectedRevision }); var replay = await db.EventRegistrationSettingsHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.IdempotencyHash == keyHash, ct);
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId, ct); if (settings is null) return Missing();
        if (replay is not null) { if (replay.EventId != eventId || replay.Action != "published" || replay.RequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return Mutation("settings", SettingsProjection(settings), false); }
        if (settings.Revision != expectedRevision || settings.Status != "draft") return Conflict();
        settings.Revision++; settings.Status = "published"; settings.PublishedAt = DateTime.UtcNow; settings.PublishedBy = actorId; settings.UpdatedBy = actorId; settings.UpdatedAt = DateTime.UtcNow;
        db.Add(SettingsHistory(settings, "published", actorId, keyHash, requestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Mutation("settings", SettingsProjection(settings), true);
    }

    public async Task<EventRegistrationProductResult> CreateForm(int tenantId, int eventId, int actorId, JsonElement body, long expectedSettingsRevision, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || expectedSettingsRevision < 1 || !FormInput(body, out var input)) return Validation("form");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(tenantId, eventId, ct);
        var context = await Context(tenantId, eventId, actorId, true, ct); if (!context.Ok) return context.Error!;
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId, ct); if (settings is null) return Missing();
        var requestHash = Hash(new { eventId, expectedSettingsRevision, form = body.GetRawText() });
        var keyHash = Hash(key); var replay = await db.EventRegistrationFormVersions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.CreateIdempotencyHash == keyHash, ct);
        if (replay is not null) { if (replay.EventId != eventId || replay.CreateRequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return FormMutation(await FormProjection(tenantId, replay, ct), settings.Revision, false, 200); }
        if (settings.Revision != expectedSettingsRevision) return Conflict();
        var version = (await db.EventRegistrationFormVersions.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId).MaxAsync(x => (long?)x.VersionNumber, ct) ?? 0) + 1;
        var form = new EventRegistrationFormVersion { TenantId = tenantId, EventId = eventId, VersionNumber = version, Name = input.Name, Description = input.Description, CreatedBy = actorId, UpdatedBy = actorId, CreateIdempotencyHash = keyHash, CreateRequestHash = requestHash };
        db.Add(form); await db.SaveChangesAsync(ct); AddQuestions(tenantId, eventId, form.Id, input.Questions); settings.Revision++; settings.FormState = settings.PublishedFormVersionId is null ? "draft" : "published"; settings.UpdatedBy = actorId; settings.UpdatedAt = DateTime.UtcNow; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return FormMutation(await FormProjection(tenantId, form, ct), settings.Revision, true, 201);
    }

    public async Task<EventRegistrationProductResult> UpdateForm(int tenantId, int eventId, long formId, int actorId, JsonElement body, long expectedFormRevision, long expectedSettingsRevision, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || expectedFormRevision < 1 || expectedSettingsRevision < 1 || !FormInput(body, out var input)) return Validation("form");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(tenantId, eventId, ct);
        var context = await Context(tenantId, eventId, actorId, true, ct); if (!context.Ok) return context.Error!;
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId, ct);
        var form = await db.EventRegistrationFormVersions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Id == formId, ct); if (settings is null || form is null) return Missing();
        var requestHash = Hash(new { eventId, formId, expectedFormRevision, expectedSettingsRevision, form = body.GetRawText() });
        var keyHash = Hash(key); var replay = await db.EventRegistrationSettingsHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.IdempotencyHash == keyHash, ct);
        if (replay is not null) { if (replay.EventId != eventId || replay.Action != "form_updated" || replay.RequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return FormMutation(await FormProjection(tenantId, form, ct), settings.Revision, false); }
        if (settings.Revision != expectedSettingsRevision || form.Revision != expectedFormRevision || form.Status != "draft") return Conflict();
        form.Revision++; form.Name = input.Name; form.Description = input.Description; form.UpdatedBy = actorId; form.UpdatedAt = DateTime.UtcNow;
        var old = await db.EventRegistrationFormQuestions.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.FormVersionId == formId).ToListAsync(ct); db.RemoveRange(old); AddQuestions(tenantId, eventId, form.Id, input.Questions);
        settings.Revision++; settings.UpdatedBy = actorId; settings.UpdatedAt = DateTime.UtcNow; db.Add(SettingsHistory(settings, "form_updated", actorId, keyHash, requestHash));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return FormMutation(await FormProjection(tenantId, form, ct), settings.Revision, true);
    }

    public async Task<EventRegistrationProductResult> PublishForm(int tenantId, int eventId, long formId, int actorId, long expectedFormRevision, long expectedSettingsRevision, string key, CancellationToken ct)
    {
        if (!ValidKey(key)) return Validation("idempotency_key"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(tenantId, eventId, ct);
        var context = await Context(tenantId, eventId, actorId, true, ct); if (!context.Ok) return context.Error!;
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId, ct); var form = await db.EventRegistrationFormVersions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Id == formId, ct); if (settings is null || form is null) return Missing();
        var keyHash = Hash(key); var requestHash = Hash(new { eventId, formId, expectedFormRevision, expectedSettingsRevision }); var replay = await db.EventRegistrationSettingsHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.IdempotencyHash == keyHash, ct); if (replay is not null) { if (replay.EventId != eventId || replay.Action != "form_published" || !string.Equals(replay.RequestHash, requestHash, StringComparison.Ordinal)) return Conflict(); await tx.CommitAsync(ct); return FormMutation(await FormProjection(tenantId, form, ct), settings.Revision, false); }
        if (settings.Revision != expectedSettingsRevision || form.Revision != expectedFormRevision || form.Status != "draft") return Conflict();
        var questions = await db.EventRegistrationFormQuestions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId && x.FormVersionId == formId).OrderBy(x => x.Position).ToListAsync(ct); if (questions.Count == 0) return Validation("form");
        form.Revision++; form.Status = "published"; form.DefinitionHash = Hash(new { form.VersionNumber, form.Name, form.Description, questions }); form.PublishedAt = DateTime.UtcNow; form.PublishedBy = actorId; form.UpdatedBy = actorId; form.UpdatedAt = DateTime.UtcNow; settings.Revision++; settings.FormState = "published"; settings.PublishedFormVersionId = form.VersionNumber; settings.UpdatedBy = actorId; settings.UpdatedAt = DateTime.UtcNow; db.Add(SettingsHistory(settings, "form_published", actorId, keyHash, requestHash));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return FormMutation(await FormProjection(tenantId, form, ct), settings.Revision, true);
    }

    public async Task<EventRegistrationProductResult> SaveSubmission(int tenantId, int eventId, int actorId, long registrationId, long formId, long? expectedRevision, JsonElement answers, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || answers.ValueKind != JsonValueKind.Object) return Validation("submission"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(tenantId, eventId, ct);
        var context = await Context(tenantId, eventId, actorId, false, ct); if (!context.Ok) return context.Error!;
        var registration = await db.EventRegistrations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Id == registrationId && x.UserId == actorId, ct); var form = await db.EventRegistrationFormVersions.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Id == formId && x.Status == "published", ct); if (registration is null || form is null) return Missing();
        if (registration.RegistrationState is not ("invited" or "pending" or "confirmed")) return Conflict();
        var requestHash = Hash(new { eventId, registrationId, formId, expectedRevision, answers = answers.GetRawText() }); var keyHash = Hash(key); var replayHistory = await db.EventRegistrationSubmissionHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.IdempotencyHash == keyHash, ct); if (replayHistory is not null) { if (replayHistory.EventId != eventId || replayHistory.Action != "saved" || !string.Equals(replayHistory.RequestHash, requestHash, StringComparison.Ordinal)) return Conflict(); var replay = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == replayHistory.SubmissionId, ct); if (replay is null || replay.RegistrationId != registrationId || replay.FormVersionId != formId) return Conflict(); await tx.CommitAsync(ct); return Mutation("submission", SubmissionProjection(replay), false, 200); }
        var submission = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.RegistrationId == registrationId && x.FormVersionId == formId && x.Status == "draft", ct);
        if (submission is null && expectedRevision is not null || submission is not null && submission.Revision != expectedRevision) return Conflict();
        if (submission is null)
        {
            var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Status == "published" && x.FormState == "published", ct);
            if (settings?.PublishedFormVersionId != form.VersionNumber) return Conflict();
        }
        submission ??= new EventRegistrationFormSubmission { TenantId = tenantId, EventId = eventId, RegistrationId = registrationId, FormVersionId = formId, UserId = actorId, Revision = 0, AttemptNumber = (await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.RegistrationId == registrationId).MaxAsync(x => (int?)x.AttemptNumber, ct) ?? 0) + 1 };
        if (submission.Id == 0) db.Add(submission); submission.Revision++; submission.SaveIdempotencyHash = keyHash; submission.SaveRequestHash = requestHash; submission.UpdatedAt = DateTime.UtcNow; await db.SaveChangesAsync(ct);
        var questions = await db.EventRegistrationFormQuestions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.FormVersionId == formId).OrderBy(x => x.Position).ToListAsync(ct);
        var validationError = ValidateAnswers(questions, answers, false); if (validationError is not null) return Validation(validationError);
        var old = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.SubmissionId == submission.Id).ToListAsync(ct); db.RemoveRange(old);
        var retentionAnchor = (context.Event!.EndsAt ?? context.Event.StartsAt).ToUniversalTime();
        foreach (var q in questions) { if (!answers.TryGetProperty(q.StableKey, out var value)) continue; var raw = value.GetRawText(); db.Add(new EventRegistrationFormAnswer { TenantId = tenantId, EventId = eventId, SubmissionId = submission.Id, QuestionId = q.Id, StableKey = q.StableKey, DataClassification = q.DataClassification, Purpose = q.Purpose, ValueJson = Protect(raw), ValueHash = Hash(raw), RetentionDueAt = retentionAnchor.AddDays(q.RetentionDays) }); }
        db.Add(SubmissionHistory(submission, "saved", actorId, keyHash, requestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Mutation("submission", SubmissionProjection(submission), true, 201);
    }

    public async Task<EventRegistrationProductResult> Submit(int tenantId, int eventId, long submissionId, int actorId, long expectedRevision, string key, CancellationToken ct)
    {
        if (!ValidKey(key)) return Validation("idempotency_key"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(tenantId, eventId, ct); var context = await Context(tenantId, eventId, actorId, false, ct); if (!context.Ok) return context.Error!;
        var submission = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Id == submissionId && x.UserId == actorId, ct); if (submission is null) return Missing(); var keyHash = Hash(key); var requestHash = Hash(new { eventId, submissionId, expectedRevision }); var replay = await db.EventRegistrationSubmissionHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.IdempotencyHash == keyHash, ct); if (replay is not null) { if (replay.EventId != eventId || replay.SubmissionId != submissionId || replay.Action != "submitted" || replay.RequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return Mutation("submission", SubmissionProjection(submission), false); }
        if (submission.Revision != expectedRevision || submission.Status != "draft") return Conflict();
        var registration = await db.EventRegistrations.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Id == submission.RegistrationId && x.UserId == actorId, ct);
        var form = await db.EventRegistrationFormVersions.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Id == submission.FormVersionId && x.Status == "published", ct);
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.Status == "published" && x.FormState == "published", ct);
        if (registration is null || registration.RegistrationState is not ("invited" or "pending" or "confirmed") || form is null || settings?.PublishedFormVersionId != form.VersionNumber) return Conflict();
        var questions = await db.EventRegistrationFormQuestions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.FormVersionId == submission.FormVersionId).OrderBy(x => x.Position).ToListAsync(ct);
        var stored = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.SubmissionId == submission.Id && !x.IsPurged).ToListAsync(ct);
        var values = new Dictionary<string, JsonElement>();
        foreach (var answer in stored) { var clear = Unprotect(answer.ValueJson); if (clear is null) return Conflict(); using var document = JsonDocument.Parse(clear); values[answer.StableKey] = document.RootElement.Clone(); }
        var completeError = ValidateAnswers(questions, JsonSerializer.SerializeToElement(values), true); if (completeError is not null) return Validation(completeError);
        submission.Revision++; submission.Status = "submitted"; submission.EffectiveSlot = 1; submission.SubmittedAt = DateTime.UtcNow; submission.UpdatedAt = DateTime.UtcNow; db.Add(SubmissionHistory(submission, "submitted", actorId, keyHash, requestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Mutation("submission", SubmissionProjection(submission), true);
    }

    private static string? ValidateAnswers(IReadOnlyCollection<EventRegistrationFormQuestion> questions, JsonElement answers, bool requireComplete)
    {
        if (answers.ValueKind != JsonValueKind.Object) return "answers";
        var ordered = questions.OrderBy(x => x.Position).ToArray();
        var known = ordered.Select(x => x.StableKey).ToHashSet(StringComparer.Ordinal);
        if (answers.EnumerateObject().Any(x => !known.Contains(x.Name))) return "answers_unknown";
        var visibleAnswers = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var question in ordered)
        {
            var visible = IsQuestionVisible(question.VisibilityRules, visibleAnswers);
            var supplied = answers.TryGetProperty(question.StableKey, out var value);
            if (!visible)
            {
                if (supplied) return question.StableKey;
                continue;
            }
            if (!supplied)
            {
                if (requireComplete && question.IsRequired) return question.StableKey;
                continue;
            }
            if (!ValidAnswerValue(question, value, requireComplete)) return question.StableKey;
            visibleAnswers[question.StableKey] = value.Clone();
        }
        return null;
    }

    private static bool ValidAnswerValue(EventRegistrationFormQuestion question, JsonElement value, bool requireComplete)
    {
        var type = question.QuestionType;
        if (type is "consent" or "waiver")
            return (value.ValueKind is JsonValueKind.True or JsonValueKind.False) && (!requireComplete || !question.IsRequired || value.ValueKind == JsonValueKind.True);

        if (type == "multiple_choice")
        {
            if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 100) return false;
            var choices = ChoiceValues(question.ChoiceOptions); if (choices is null) return false;
            var selected = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in value.EnumerateArray()) if (row.ValueKind != JsonValueKind.String || !selected.Add(row.GetString()!) || !choices.Contains(row.GetString()!)) return false;
            if (requireComplete && question.IsRequired && selected.Count == 0) return false;
            return ValidSelectionRules(question.ValidationRules, selected.Count);
        }

        if (value.ValueKind != JsonValueKind.String) return false;
        var text = value.GetString() ?? string.Empty;
        var max = type == "short_text" ? 500 : 10000;
        if (text.Length > max || requireComplete && question.IsRequired && string.IsNullOrWhiteSpace(text)) return false;
        if (type == "single_choice")
        {
            var choices = ChoiceValues(question.ChoiceOptions); if (choices is null || !choices.Contains(text)) return false;
            return ValidSelectionRules(question.ValidationRules, text.Length == 0 ? 0 : 1);
        }
        return ValidTextRules(question.ValidationRules, text);
    }

    private static HashSet<string>? ChoiceValues(string? json)
    {
        if (json is null) return null;
        try
        {
            using var document = JsonDocument.Parse(json); if (document.RootElement.ValueKind != JsonValueKind.Array) return null;
            var result = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in document.RootElement.EnumerateArray()) if (row.ValueKind != JsonValueKind.String || !result.Add(row.GetString()!)) return null;
            return result;
        }
        catch (JsonException) { return null; }
    }

    private static bool ValidTextRules(string? json, string value)
    {
        if (json is null) return true;
        try
        {
            using var document = JsonDocument.Parse(json); var rules = document.RootElement;
            if (rules.ValueKind != JsonValueKind.Object) return false;
            if (rules.TryGetProperty("min_length", out var min) && (!min.TryGetInt32(out var minLength) || value.Length < minLength)) return false;
            if (rules.TryGetProperty("max_length", out var max) && (!max.TryGetInt32(out var maxLength) || value.Length > maxLength)) return false;
            if (!rules.TryGetProperty("format", out var format)) return true;
            if (format.ValueKind != JsonValueKind.String) return false;
            return format.GetString() switch
            {
                "email" => System.Net.Mail.MailAddress.TryCreate(value, out _),
                "url" => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https",
                "phone" => Regex.IsMatch(value, @"^\+?[0-9][0-9 ()-]{5,30}$", RegexOptions.CultureInvariant),
                _ => false
            };
        }
        catch (JsonException) { return false; }
    }

    private static bool ValidSelectionRules(string? json, int count)
    {
        if (json is null) return true;
        try
        {
            using var document = JsonDocument.Parse(json); var rules = document.RootElement;
            if (rules.ValueKind != JsonValueKind.Object) return false;
            if (rules.TryGetProperty("min_selections", out var min) && (!min.TryGetInt32(out var minimum) || count < minimum)) return false;
            if (rules.TryGetProperty("max_selections", out var max) && (!max.TryGetInt32(out var maximum) || count > maximum)) return false;
            return true;
        }
        catch (JsonException) { return false; }
    }

    private static bool IsQuestionVisible(string? json, IReadOnlyDictionary<string, JsonElement> answers)
    {
        if (json is null) return true;
        try
        {
            using var document = JsonDocument.Parse(json); var rules = document.RootElement;
            if (rules.ValueKind != JsonValueKind.Object || !rules.TryGetProperty("match", out var match) || !rules.TryGetProperty("conditions", out var conditions) || conditions.ValueKind != JsonValueKind.Array) return false;
            var results = conditions.EnumerateArray().Select(condition => VisibilityCondition(condition, answers)).ToArray();
            return match.GetString() == "all" ? results.All(x => x) : match.GetString() == "any" && results.Any(x => x);
        }
        catch (JsonException) { return false; }
    }

    private static bool VisibilityCondition(JsonElement condition, IReadOnlyDictionary<string, JsonElement> answers)
    {
        if (!condition.TryGetProperty("question_key", out var keyElement) || !condition.TryGetProperty("operator", out var operatorElement)) return false;
        var key = keyElement.GetString(); var op = operatorElement.GetString(); JsonElement actual = default;
        var answered = key is not null && answers.TryGetValue(key, out actual) && IsAnswered(actual);
        if (op == "is_answered") return answered;
        if (op == "is_not_answered") return !answered;
        if (!answered || !condition.TryGetProperty("value", out var expected)) return false;
        var equals = JsonValueEquals(actual, expected);
        var contains = actual.ValueKind == JsonValueKind.Array
            ? actual.EnumerateArray().Any(x => JsonValueEquals(x, expected))
            : actual.ValueKind == JsonValueKind.String && expected.ValueKind == JsonValueKind.String && actual.GetString()!.Contains(expected.GetString()!, StringComparison.Ordinal);
        var expectedContains = expected.ValueKind == JsonValueKind.Array && expected.EnumerateArray().Any(x => JsonValueEquals(x, actual));
        return op switch { "equals" => equals, "not_equals" => !equals, "contains" => contains, "not_contains" => !contains, "in" => expectedContains, "not_in" => !expectedContains, _ => false };
    }

    private static bool JsonValueEquals(JsonElement left, JsonElement right)
    {
        if (left.ValueKind != right.ValueKind) return false;
        if (left.ValueKind == JsonValueKind.Array)
        {
            var leftRows = left.EnumerateArray().ToArray(); var rightRows = right.EnumerateArray().ToArray();
            return leftRows.Length == rightRows.Length && leftRows.Zip(rightRows).All(pair => JsonValueEquals(pair.First, pair.Second));
        }
        return left.GetRawText() == right.GetRawText();
    }

    private static bool IsAnswered(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => false,
        JsonValueKind.String => !string.IsNullOrEmpty(value.GetString()),
        JsonValueKind.Array => value.GetArrayLength() > 0,
        _ => true
    };

    private sealed record SettingsData(string Approval, DateTime? Opens, DateTime? Closes, DateTime? Cutoff, int PerMember, bool Guests, int MaxGuests, int Retention);
    private sealed record FormData(string Name, string? Description, List<QuestionData> Questions);
    private sealed record QuestionData(string Key, string Type, string Prompt, string? Help, bool Required, string Classification, string Purpose, int Retention, string? Choices, string? Validation, string? Visibility, string? Displayed, string? DisplayedVersion);
    private static bool SettingsInput(JsonElement b, out SettingsData x) { x = default!; var approval = Text(b, "approval_mode"); if (approval is not ("auto" or "manual") || !Int(b, "per_member_limit", out var per) || per < 1 || per > 1000 || !Int(b, "max_guests_per_registration", out var max) || max < 0 || max > 10 || !Int(b, "guest_retention_days", out var retention) || retention < 1 || retention > 3650 || !DateN(b, "opens_at_utc", out var opens) || !DateN(b, "closes_at_utc", out var closes) || !DateN(b, "cancellation_cutoff_at_utc", out var cutoff)) return false; x = new(approval, opens, closes, cutoff, per, Bool(b, "guests_enabled"), max, retention); return true; }
    private static bool FormInput(JsonElement b, out FormData x) { x = default!; var name = Clean(Text(b, "name"), 191); if (name is null || !b.TryGetProperty("questions", out var rows) || rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > 100) return false; var questions = new List<QuestionData>(); var keys = new HashSet<string>(); foreach (var q in rows.EnumerateArray()) { var key = Clean(Text(q, "stable_key"), 64); var type = Text(q, "question_type"); var prompt = Clean(Text(q, "prompt"), 500); var classification = Text(q, "data_classification"); var purpose = Clean(Text(q, "purpose"), 191); if (key is null || !keys.Add(key) || type is null || !QuestionTypes.Contains(type) || prompt is null || classification is null || !Classifications.Contains(classification) || purpose is null || !Int(q, "retention_days", out var retention) || retention < 1 || retention > 3650) return false; questions.Add(new(key, type, prompt, Clean(Text(q, "help_text"), 1000), Bool(q, "is_required"), classification, purpose, retention, RawN(q, "choice_options"), RawN(q, "validation_rules"), RawN(q, "visibility_rules"), Clean(Text(q, "displayed_text"), 2000), Clean(Text(q, "displayed_text_version"), 64))); } x = new(name, Clean(Text(b, "description"), 2000), questions); return true; }
    private void AddQuestions(int t, int e, long form, List<QuestionData> rows) { for (var i = 0; i < rows.Count; i++) { var q = rows[i]; db.Add(new EventRegistrationFormQuestion { TenantId = t, EventId = e, FormVersionId = form, StableKey = q.Key, Position = i + 1, QuestionType = q.Type, Prompt = q.Prompt, HelpText = q.Help, IsRequired = q.Required, DataClassification = q.Classification, Purpose = q.Purpose, RetentionDays = q.Retention, ChoiceOptions = q.Choices, ValidationRules = q.Validation, VisibilityRules = q.Visibility, DisplayedText = q.Displayed, DisplayedTextVersion = q.DisplayedVersion }); } }
    private async Task<object> FormProjection(int t, EventRegistrationFormVersion f, CancellationToken ct) { var qs = await db.EventRegistrationFormQuestions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.FormVersionId == f.Id).OrderBy(x => x.Position).ToListAsync(ct); return new { id = f.Id, version_number = f.VersionNumber, revision = f.Revision, status = f.Status, name = f.Name, description = f.Description, questions = qs.Select(q => new { id = q.Id, stable_key = q.StableKey, position = q.Position, question_type = q.QuestionType, prompt = q.Prompt, help_text = q.HelpText, is_required = q.IsRequired, data_classification = q.DataClassification, purpose = q.Purpose, retention_days = q.RetentionDays, choice_options = Json(q.ChoiceOptions), validation_rules = Json(q.ValidationRules), visibility_rules = Json(q.VisibilityRules), displayed_text = q.DisplayedText, displayed_text_version = q.DisplayedTextVersion }), published_at = IsoN(f.PublishedAt) }; }
    private static object SettingsProjection(EventRegistrationSettings x) => new { id = x.Id, revision = x.Revision, status = x.Status, approval_mode = x.ApprovalMode, form_state = x.FormState, published_form_version = x.PublishedFormVersionId, per_member_limit = x.PerMemberLimit, guests_enabled = x.GuestsEnabled, max_guests_per_registration = x.MaxGuestsPerRegistration, guest_retention_days = x.GuestRetentionDays, opens_at_utc = IsoN(x.OpensAtUtc), closes_at_utc = IsoN(x.ClosesAtUtc), cancellation_cutoff_at_utc = IsoN(x.CancellationCutoffAtUtc), event_timezone_snapshot = x.EventTimezoneSnapshot, published_at = IsoN(x.PublishedAt) };
    private static object SubmissionProjection(EventRegistrationFormSubmission x, string? memberName = null, bool includeMemberName = false)
    {
        var result = new Dictionary<string, object?>
        {
            ["id"] = x.Id, ["registration_id"] = x.RegistrationId, ["form_version_id"] = x.FormVersionId,
            ["user_id"] = x.UserId, ["revision"] = x.Revision, ["status"] = x.Status,
            ["attempt_number"] = x.AttemptNumber, ["effective_slot"] = x.EffectiveSlot,
            ["supersedes_submission_id"] = x.SupersedesSubmissionId, ["superseded_at"] = IsoN(x.SupersededAt),
            ["submitted_at"] = IsoN(x.SubmittedAt), ["updated_at"] = Iso(x.UpdatedAt)
        };
        if (includeMemberName) result["member_name"] = memberName;
        return result;
    }

    private static object CampaignProjection(EventInvitationCampaign x, int? invitationsCount = null, IReadOnlyDictionary<string, int>? deliveryCounts = null)
    {
        var result = new Dictionary<string, object?>
        {
            ["id"] = x.Id, ["campaign_type"] = x.CampaignType, ["status"] = x.Status,
            ["revision"] = x.Revision, ["source_hash"] = x.SourceHash,
            ["source_schema_version"] = x.SourceSchemaVersion, ["preview_count"] = x.PreviewCount,
            ["valid_count"] = x.ValidCount, ["error_count"] = x.ErrorCount,
            ["preview_errors"] = Json(x.PreviewErrors), ["segment_criteria_summary"] = Json(x.SegmentCriteriaSummary),
            ["default_locale"] = x.DefaultLocale, ["scheduled_for_utc"] = IsoN(x.ScheduledForUtc),
            ["started_at"] = IsoN(x.StartedAt), ["completed_at"] = IsoN(x.CompletedAt),
            ["issued_at"] = IsoN(x.IssuedAt), ["cancelled_at"] = IsoN(x.CancelledAt)
        };
        if (invitationsCount.HasValue) result["invitations_count"] = invitationsCount.Value;
        if (deliveryCounts is not null) result["delivery_counts"] = deliveryCounts;
        return result;
    }

    private async Task<object> GuestProjection(int t, EventRegistrationGuest x, bool revealName, bool revealEmail, bool revealPhone, CancellationToken ct)
    {
        var attendance = await db.EventRegistrationGuestAttendance.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(y => y.TenantId == t && y.GuestId == x.Id, ct);
        var result = new Dictionary<string, object?>
        {
            ["id"] = x.Id, ["registration_id"] = x.RegistrationId,
            ["ticket_entitlement_id"] = x.TicketEntitlementId, ["guest_number"] = x.GuestNumber,
            ["revision"] = x.Revision, ["status"] = x.Status, ["preferred_locale"] = x.PreferredLocale,
            ["notification_consent"] = x.NotificationConsent, ["retention_due_at"] = Iso(x.RetentionDueAt),
            ["withdrawn_at"] = IsoN(x.WithdrawnAt), ["anonymised_at"] = IsoN(x.AnonymisedAt),
            ["attendance"] = attendance is null ? null : new { id = attendance.Id, status = attendance.Status, version = attendance.Version, checked_in_at = IsoN(attendance.CheckedInAt), checked_out_at = IsoN(attendance.CheckedOutAt), attended_at = IsoN(attendance.AttendedAt), no_show_at = IsoN(attendance.NoShowAt) }
        };
        if (revealName) result["display_name"] = Unprotect(x.DisplayNameCiphertext);
        if (revealEmail) result["email"] = Unprotect(x.EmailCiphertext);
        if (revealPhone) result["phone"] = Unprotect(x.PhoneCiphertext);
        return result;
    }

    private async Task<(bool Ok, Event? Event, User? Actor, bool Manage, EventRegistrationProductResult? Error)> Context(int t, int e, int u, bool manage, CancellationToken ct)
    {
        var evt = await db.Events.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.Id == e, ct);
        if (evt is null) return (false, null, null, false, Missing());
        var actor = await db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.Id == u && x.IsActive, ct);
        if (actor is null) return (false, evt, null, false, Missing());
        var permissions = await Permissions(t, evt, actor, ct);
        if (manage && !permissions.ManageRegistration) return (false, evt, actor, false, Forbidden());
        return (true, evt, actor, permissions.ManageRegistration, null);
    }

    private async Task<RegistrationPermissions> Permissions(int tenantId, Event evt, User actor, CancellationToken ct)
    {
        if (!await LinkedGroupBoundary(tenantId, evt, actor, ct)) return new(false, false, false, false, false, false);
        var fullAuthority = IsAdmin(actor) || evt.CreatedById == actor.Id;
        var roles = fullAuthority
            ? []
            : await db.EventStaffAssignments.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.EventId == evt.Id && x.UserId == actor.Id
                    && x.Status == "active" && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow))
                .Select(x => x.Role).ToListAsync(ct);
        bool Grants(string capability) => fullAuthority || roles.Any(role => RoleGrants(role, capability));
        var manageRegistration = Grants("manageRegistration");
        return new(
            manageRegistration,
            Grants("viewRoster"),
            fullAuthority,
            manageRegistration && Grants("exportPeople"),
            fullAuthority,
            Grants("manageAttendance"));
    }

    private async Task<bool> LinkedGroupBoundary(int tenantId, Event evt, User actor, CancellationToken ct)
    {
        if (evt.GroupId is not int groupId) return true;
        var group = await db.Groups.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId && x.Status == "active" && x.IsActive, ct);
        if (group is null) return false;
        return IsAdmin(actor) || group.CreatedById == actor.Id
            || await db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(x => x.TenantId == tenantId && x.GroupId == groupId && x.UserId == actor.Id && x.Status == "active", ct);
    }

    private static bool RoleGrants(string role, string capability) => role switch
    {
        "co_organizer" => capability is "manageRegistration" or "viewRoster" or "exportPeople" or "manageAttendance",
        "registration_manager" => capability is "manageRegistration" or "viewRoster" or "exportPeople",
        "check_in_staff" => capability is "viewRoster" or "manageAttendance",
        _ => false
    };

    private sealed record RegistrationPermissions(bool ManageRegistration, bool ViewRoster, bool ViewSensitiveAnswers, bool ExportAnswers, bool ManageRetention, bool ManageAttendance);
    private static EventRegistrationSettingsHistory SettingsHistory(EventRegistrationSettings x, string action, int actor, string key, string request) => new() { TenantId = x.TenantId, EventId = x.EventId, SettingsId = x.Id, SettingsRevision = x.Revision, Action = action, ActorUserId = actor, IdempotencyHash = key, RequestHash = request, Snapshot = JsonSerializer.Serialize(x) };
    private static EventRegistrationSubmissionHistory SubmissionHistory(EventRegistrationFormSubmission x, string action, int actor, string key, string request) => new() { TenantId = x.TenantId, EventId = x.EventId, SubmissionId = x.Id, SubmissionRevision = x.Revision, Action = action, ActorUserId = actor, IdempotencyHash = key, RequestHash = request, Snapshot = JsonSerializer.Serialize(x) };
    private static EventRegistrationProductResult Mutation(string field, object value, bool changed, int status = 200) => new(new Dictionary<string, object?> { [field] = value, ["changed"] = changed, ["idempotent_replay"] = !changed }, Status: status);
    private static EventRegistrationProductResult FormMutation(object form, long revision, bool changed, int status = 200) => new(new { form, settings_revision = revision, changed, idempotent_replay = !changed }, Status: status);
    private static object Page(int page, int per, int total) { var last = Math.Max(1, (int)Math.Ceiling(total / (double)per)); var count = Math.Min(per, Math.Max(0, total - (page - 1) * per)); return new { page, per_page = per, total, last_page = last, page_count = count, from = count == 0 ? (int?)null : (page - 1) * per + 1, to = count == 0 ? (int?)null : (page - 1) * per + count, has_more = page < last, previous_page = page > 1 ? page - 1 : (int?)null, next_page = page < last ? page + 1 : (int?)null }; }
    private static int ClampPage(int page, int perPage, int total) => Math.Min(page, Math.Max(1, (int)Math.Ceiling(total / (double)perPage)));
    private Task Lock(int t, int e, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({t}, {e})", ct);
    private static bool IsAdmin(User u) => u.IsAdmin || u.IsSuperAdmin || u.IsTenantSuperAdmin || u.IsGod || u.Role is "admin" or "super_admin" or "god";
    private static bool ValidKey(string x) => !string.IsNullOrWhiteSpace(x) && x.Trim().Length <= 191;
    private static string Hash(string x) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(x))).ToLowerInvariant();
    private static string Hash(object x) => Hash(JsonSerializer.Serialize(x));
    private static string? Clean(string? x, int max) => string.IsNullOrWhiteSpace(x) || x.Trim().Length > max ? null : x.Trim();
    private static string? Text(JsonElement x, string n) => x.ValueKind == JsonValueKind.Object && x.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
    private static bool Int(JsonElement x, string n, out int v) { v = 0; return x.ValueKind == JsonValueKind.Object && x.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out v); }
    private static bool Bool(JsonElement x, string n) => x.ValueKind == JsonValueKind.Object && x.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.True;
    private static bool DateN(JsonElement x, string n, out DateTime? v) { v = null; if (x.ValueKind != JsonValueKind.Object) return false; if (!x.TryGetProperty(n, out var p) || p.ValueKind == JsonValueKind.Null) return true; if (p.ValueKind != JsonValueKind.String || !DateTimeOffset.TryParse(p.GetString(), out var d)) return false; v = d.UtcDateTime; return true; }
    private static string? RawN(JsonElement x, string n) => x.ValueKind == JsonValueKind.Object && x.TryGetProperty(n, out var p) && p.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined) ? p.GetRawText() : null;
    private static object? Json(string? x) => x is null ? null : JsonSerializer.Deserialize<object>(x);
    private static string Iso(DateTime x) => x.ToUniversalTime().ToString("O"); private static string? IsoN(DateTime? x) => x is null ? null : Iso(x.Value);
    private string? Unprotect(string? x) { if (x is null) return null; try { return _protector.Unprotect(x); } catch { return null; } }
    private string Protect(string x) => _protector.Protect(x);
    private static EventRegistrationProductResult Missing() => new(null, new("EVENT_REGISTRATION_NOT_FOUND", "Event registration resource not found", 404));
    private static EventRegistrationProductResult Forbidden() => new(null, new("EVENT_REGISTRATION_FORBIDDEN", "Forbidden", 403));
    private static EventRegistrationProductResult Conflict() => new(null, new("EVENT_REGISTRATION_CONFLICT", "Revision or idempotency conflict", 409));
    private static EventRegistrationProductResult Validation(string field) => new(null, new("EVENT_REGISTRATION_VALIDATION_FAILED", "Validation failed", 422, field));
}
