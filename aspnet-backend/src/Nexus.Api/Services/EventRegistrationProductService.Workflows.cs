// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed partial class EventRegistrationProductService
{
    private static readonly HashSet<string> CampaignTypes = ["member", "email", "group", "audience", "csv"];
    private static readonly HashSet<string> AttendanceActions = ["check_in", "check_out", "no_show", "undo"];

    public async Task<EventRegistrationProductResult> ForkForm(int t, int e, long sourceId, int actor, long expectedSettingsRevision, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || expectedSettingsRevision < 1) return Validation("revision");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct); var context = await Context(t, e, actor, true, ct); if (!context.Ok) return context.Error!;
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e, ct); var source = await db.EventRegistrationFormVersions.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == sourceId && x.Status == "published", ct); if (settings is null || source is null) return Missing();
        var requestHash = Hash(new { eventId = e, sourceId, expectedSettingsRevision }); var kh = Hash(key); var replay = await db.EventRegistrationFormVersions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.CreateIdempotencyHash == kh, ct); if (replay is not null) { if (replay.EventId != e || replay.ForkedFromFormId != sourceId || replay.CreateRequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return FormMutation(await FormProjection(t, replay, ct), settings.Revision, false); }
        if (settings.Revision != expectedSettingsRevision) return Conflict();
        var version = (await db.EventRegistrationFormVersions.IgnoreQueryFilters().Where(x => x.TenantId == t && x.EventId == e).MaxAsync(x => (long?)x.VersionNumber, ct) ?? 0) + 1;
        var form = new EventRegistrationFormVersion { TenantId = t, EventId = e, VersionNumber = version, Name = source.Name, Description = source.Description, ForkedFromFormId = source.Id, CreatedBy = actor, UpdatedBy = actor, CreateIdempotencyHash = kh, CreateRequestHash = requestHash }; db.Add(form); await db.SaveChangesAsync(ct);
        var questions = await db.EventRegistrationFormQuestions.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.FormVersionId == sourceId).OrderBy(x => x.Position).ToListAsync(ct); foreach (var q in questions) db.Add(new EventRegistrationFormQuestion { TenantId = t, EventId = e, FormVersionId = form.Id, StableKey = q.StableKey, Position = q.Position, QuestionType = q.QuestionType, Prompt = q.Prompt, HelpText = q.HelpText, IsRequired = q.IsRequired, DataClassification = q.DataClassification, Purpose = q.Purpose, RetentionDays = q.RetentionDays, ChoiceOptions = q.ChoiceOptions, ValidationRules = q.ValidationRules, VisibilityRules = q.VisibilityRules, DisplayedText = q.DisplayedText, DisplayedTextVersion = q.DisplayedTextVersion });
        settings.Revision++; settings.FormState = settings.PublishedFormVersionId is null ? "draft" : "published"; settings.UpdatedBy = actor; settings.UpdatedAt = DateTime.UtcNow; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return FormMutation(await FormProjection(t, form, ct), settings.Revision, true, 201);
    }

    public async Task<EventRegistrationProductResult> Amend(int t, int e, long id, int actor, long expectedRevision, string key, CancellationToken ct)
    {
        if (!ValidKey(key)) return Validation("idempotency_key"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct); var context = await Context(t, e, actor, false, ct); if (!context.Ok) return context.Error!;
        var source = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id && x.UserId == actor, ct); if (source is null) return Missing(); var requestHash = Hash(new { eventId = e, submissionId = id, expectedRevision }); var kh = Hash(key); var hist = await db.EventRegistrationSubmissionHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (hist is not null) { if (hist.EventId != e || hist.Action != "amended" || hist.RequestHash != requestHash) return Conflict(); var existing = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.Id == hist.SubmissionId && x.SupersedesSubmissionId == id, ct); if (existing is null) return Conflict(); await tx.CommitAsync(ct); return new(new { submission = SubmissionProjection(existing), superseded_submission = SubmissionProjection(source), changed = false, idempotent_replay = true }); }
        if (source.Revision != expectedRevision || source.Status != "submitted" || source.EffectiveSlot != 1) return Conflict(); source.Revision++; source.EffectiveSlot = null; source.SupersededAt = DateTime.UtcNow; source.UpdatedAt = DateTime.UtcNow;
        var amended = new EventRegistrationFormSubmission { TenantId = t, EventId = e, RegistrationId = source.RegistrationId, FormVersionId = source.FormVersionId, UserId = actor, Revision = 1, Status = "draft", AttemptNumber = source.AttemptNumber + 1, SupersedesSubmissionId = source.Id, SaveIdempotencyHash = kh, SaveRequestHash = requestHash }; db.Add(amended); await db.SaveChangesAsync(ct);
        var answers = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.SubmissionId == id && !x.IsPurged).ToListAsync(ct); foreach (var a in answers) db.Add(new EventRegistrationFormAnswer { TenantId = t, EventId = e, SubmissionId = amended.Id, QuestionId = a.QuestionId, StableKey = a.StableKey, DataClassification = a.DataClassification, Purpose = a.Purpose, ValueJson = a.ValueJson, ValueHash = a.ValueHash, RetentionDueAt = a.RetentionDueAt }); db.Add(SubmissionHistory(amended, "amended", actor, kh, amended.SaveRequestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return new(new { submission = SubmissionProjection(amended), superseded_submission = SubmissionProjection(source), changed = true, idempotent_replay = false }, Status: 201);
    }

    public async Task<EventRegistrationProductResult> ReadAnswers(int t, int e, long id, int actor, string purpose, string correlation, bool includeSensitive, CancellationToken ct)
    {
        purpose = Clean(purpose, 500) ?? ""; correlation = Clean(correlation, 191) ?? ""; if (purpose.Length == 0 || correlation.Length == 0) return Validation("access_evidence"); var context = await Context(t, e, actor, false, ct); if (!context.Ok) return context.Error!;
        var submission = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id, ct); if (submission is null) return Missing();
        var isOwner = submission.UserId == actor; if (!isOwner && !context.Manage) return Forbidden();
        var permissions = await Permissions(t, context.Event!, context.Actor!, ct);
        if (includeSensitive && !isOwner && !permissions.ViewSensitiveAnswers) return Forbidden();
        var rows = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.SubmissionId == id).OrderBy(x => x.QuestionId).ToListAsync(ct); var result = new Dictionary<string, object?>(); var correlationHash = Hash(correlation); foreach (var row in rows) { var sensitive = row.DataClassification == "sensitive"; if (sensitive && !includeSensitive) continue; var clear = row.IsPurged ? null : Unprotect(row.ValueJson); result[row.StableKey] = new { question_id = row.QuestionId, value = clear is null ? null : Json(clear), purged = row.IsPurged, classification = row.DataClassification }; db.Add(new EventRegistrationAnswerAccessAudit { TenantId = t, EventId = e, SubmissionId = id, AnswerId = row.Id, QuestionId = row.QuestionId, ActorUserId = actor, Action = "read", Purpose = purpose, CorrelationId = correlationHash, IncludedSensitive = includeSensitive, AnswerCount = 1 }); }
        await db.SaveChangesAsync(ct); return new(new { answers = result });
    }

    public async Task<EventRegistrationProductResult> Export(int t, int e, int actor, string purpose, string correlation, bool includeSensitive, CancellationToken ct)
    {
        purpose = Clean(purpose, 500) ?? "";
        correlation = Clean(correlation, 191) ?? "";
        if (purpose.Length == 0 || correlation.Length == 0) return Validation("access_evidence");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(t, e, ct);
        var context = await Context(t, e, actor, false, ct);
        if (!context.Ok) return context.Error!;
        var permissions = await Permissions(t, context.Event!, context.Actor!, ct);
        if (!permissions.ExportAnswers || includeSensitive && !permissions.ViewSensitiveAnswers) return Forbidden();
        var correlationHash = Hash(correlation);
        if (await db.EventRegistrationAnswerAccessAudits.IgnoreQueryFilters().AnyAsync(x => x.TenantId == t && x.CorrelationId == correlationHash && x.Action == "export", ct))
            return Conflict();

        var questionRows = await db.EventRegistrationFormQuestions.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == t && x.EventId == e && (includeSensitive || x.DataClassification != "sensitive"))
            .OrderBy(x => x.FormVersionId).ThenBy(x => x.Position).ThenBy(x => x.Id).ToListAsync(ct);
        var questions = questionRows.GroupBy(x => x.StableKey, StringComparer.Ordinal).Select(x => x.First()).ToList();
        var submissions = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == t && x.EventId == e && x.EffectiveSlot == 1 && (x.Status == "submitted" || x.Status == "withdrawn"))
            .OrderBy(x => x.Id).Take(10001).ToListAsync(ct);
        if (submissions.Count > 10000) return Validation("export_limit");
        var submissionIds = submissions.Select(x => x.Id).ToArray();
        var userIds = submissions.Select(x => x.UserId).Distinct().ToArray();
        var memberNames = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == t && userIds.Contains(x.Id))
            .Select(x => new { x.Id, x.FirstName, x.LastName }).ToDictionaryAsync(x => x.Id, x => $"{x.FirstName} {x.LastName}".Trim(), ct);
        var answers = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == t && submissionIds.Contains(x.SubmissionId) && !x.IsPurged)
            .ToListAsync(ct);
        var answerMap = answers.GroupBy(x => (x.SubmissionId, x.StableKey)).ToDictionary(x => x.Key, x => x.OrderByDescending(a => a.Id).First());

        var csv = new StringBuilder();
        WriteCsv(csv, ["submission_id", "registration_id", "member_id", "member_name", "attempt_number", "status", "submitted_at", .. questions.Select(x => CsvCell($"{x.StableKey}: {x.Prompt}"))]);
        foreach (var submission in submissions)
        {
            var row = new List<string?>
            {
                submission.Id.ToString(), submission.RegistrationId.ToString(), submission.UserId.ToString(),
                CsvCell(memberNames.GetValueOrDefault(submission.UserId)), submission.AttemptNumber.ToString(), submission.Status, IsoN(submission.SubmittedAt)
            };
            foreach (var question in questions)
            {
                var clear = answerMap.TryGetValue((submission.Id, question.StableKey), out var answer) ? Unprotect(answer.ValueJson) : null;
                row.Add(clear is null ? null : CsvJsonCell(clear));
            }
            WriteCsv(csv, row);
        }

        foreach (var answer in answers)
        {
            db.EventRegistrationAnswerAccessAudits.Add(new EventRegistrationAnswerAccessAudit
            {
                TenantId = t, EventId = e, SubmissionId = answer.SubmissionId, AnswerId = answer.Id,
                QuestionId = answer.QuestionId, ActorUserId = actor, Action = "export", Purpose = purpose,
                CorrelationId = correlationHash, IncludedSensitive = includeSensitive, AnswerCount = 1,
                Metadata = JsonSerializer.Serialize(new { submission_count = submissions.Count, question_count = questions.Count })
            });
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray());
    }

    public async Task<EventRegistrationProductResult> PreviewCampaign(int t, int e, int actor, string type, JsonElement source, string locale, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || !CampaignTypes.Contains(type) || source.ValueKind != JsonValueKind.Object) return Validation("campaign");
        locale = GuestLocale(locale) ?? ""; if (locale.Length == 0) return Validation("default_locale");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(t, e, ct);
        var context = await Context(t, e, actor, true, ct); if (!context.Ok) return context.Error!;
        var kh = Hash(key); var requestHash = Hash(new { type, source = source.GetRawText(), locale }); var replay = await db.EventInvitationCampaigns.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.CreateIdempotencyHash == kh, ct); if (replay is not null) { if (replay.CreateRequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return Mutation("campaign", CampaignProjection(replay), false); }
        var expansion = await ExpandCampaignRecipientsAsync(t, e, actor, type, source, ct); if (expansion is null || expansion.Recipients.Count == 0) return Validation("campaign_recipients");
        var snapshotJson = JsonSerializer.Serialize(expansion.Snapshot); var sourceHash = Hash(snapshotJson);
        var campaign = new EventInvitationCampaign
        {
            TenantId = t, EventId = e, CampaignType = type, Source = JsonSerializer.Serialize(Protect(snapshotJson)),
            SourceHash = sourceHash, SourceSchemaVersion = 1, PreviewCount = expansion.PreviewCount, ValidCount = expansion.Recipients.Count,
            ErrorCount = expansion.Errors.Count, PreviewErrors = JsonSerializer.Serialize(expansion.Errors), SegmentCriteriaSummary = expansion.CriteriaSummary is null ? null : JsonSerializer.Serialize(expansion.CriteriaSummary), DefaultLocale = locale,
            CreatedBy = actor, UpdatedBy = actor, CreateIdempotencyHash = kh, CreateRequestHash = requestHash
        };
        db.Add(campaign); await db.SaveChangesAsync(ct); db.Add(CampaignHistory(campaign, "previewed", actor, kh, campaign.CreateRequestHash));
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Mutation("campaign", CampaignProjection(campaign), true, 201);
    }

    public Task<EventRegistrationProductResult> ScheduleCampaign(int t, int e, long id, int actor, long expected, DateTime scheduled, string key, CancellationToken ct) => CampaignTransition(t, e, id, actor, expected, "scheduled", scheduled, null, key, ct);
    public Task<EventRegistrationProductResult> CancelCampaign(int t, int e, long id, int actor, long expected, string reason, string key, CancellationToken ct) => CampaignTransition(t, e, id, actor, expected, "cancelled", null, Clean(reason, 500), key, ct);
    private async Task<EventRegistrationProductResult> CampaignTransition(int t, int e, long id, int actor, long expected, string action, DateTime? scheduled, string? reason, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || expected < 1 || action == "cancelled" && reason is null || action == "scheduled" && (scheduled is null || scheduled <= DateTime.UtcNow)) return Validation("campaign"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct); var context = await Context(t, e, actor, true, ct); if (!context.Ok) return context.Error!; if (action == "scheduled" && scheduled >= context.Event!.StartsAt) return Validation("campaign_schedule");
        var campaign = await db.EventInvitationCampaigns.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id, ct); if (campaign is null) return Missing(); var kh = Hash(key); var requestHash = Hash(new { expected, scheduled, reason }); var replay = await db.EventInvitationCampaignHistory.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (replay is not null) { if (replay.Action != action || replay.RequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return Mutation("campaign", CampaignProjection(campaign), false); } if (campaign.Revision != expected || campaign.Status is "issued" or "cancelled") return Conflict();
        campaign.Revision++; campaign.Status = action; campaign.ScheduledForUtc = scheduled; campaign.CancellationReason = reason; if (action == "cancelled") campaign.CancelledAt = DateTime.UtcNow; campaign.UpdatedBy = actor; campaign.UpdatedAt = DateTime.UtcNow; db.Add(CampaignHistory(campaign, action, actor, kh, requestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Mutation("campaign", CampaignProjection(campaign), true);
    }

    public async Task<EventRegistrationProductResult> IssueCampaign(int t, int e, long id, int actor, long expected, DateTime expires, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || expires <= DateTime.UtcNow) return Validation("campaign_issue"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct); var context = await Context(t, e, actor, true, ct); if (!context.Ok) return context.Error!; if (expires > context.Event!.StartsAt) return Validation("campaign_issue"); var campaign = await db.EventInvitationCampaigns.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id, ct); if (campaign is null) return Missing(); var kh = Hash(key); var requestHash = Hash(new { expected, expires }); var replay = await db.EventInvitationCampaignHistory.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (replay is not null) { if (replay.Action != "issued" || replay.RequestHash != requestHash) return Conflict(); var existing = await db.EventInvitations.IgnoreQueryFilters().Where(x => x.TenantId == t && x.CampaignId == id).ToListAsync(ct); await tx.CommitAsync(ct); return new(new { campaign = CampaignProjection(campaign), invitations = existing.Select(x => new { invitation = InvitationProjection(x), delivery_queued = true }), changed = false, idempotent_replay = true }); } if (campaign.Revision != expected || campaign.Status is not ("previewed" or "scheduled") || campaign.Status == "scheduled" && campaign.ScheduledForUtc > DateTime.UtcNow) return Conflict();
        var protectedSource = JsonSerializer.Deserialize<string>(campaign.Source); var clearSource = Unprotect(protectedSource); if (clearSource is null || Hash(clearSource) != campaign.SourceHash) return Conflict(); var subjects = await RestoreCampaignSnapshotAsync(t, actor, campaign.CampaignType, clearSource, ct); if (subjects is null || subjects.Count == 0 || subjects.Count != campaign.ValidCount) return Conflict();
        foreach (var subject in subjects)
        {
            var decision = await recipientAuthorizer.EvaluateAsync(t, context.Event!, actor, subject.User, subject.Email, ct);
            if (!decision.IsAllowed) return Validation(decision.IsUnavailable ? "campaign_recipient_policy" : "campaign_recipients");
        }
        var projected = new List<object>(); foreach (var subject in subjects.Distinct()) projected.Add(await QueueInvitationAsync(t, e, campaign, subject.User, subject.Email, expires, ct));
        campaign.Revision++; campaign.Status = "issued"; campaign.StartedAt = DateTime.UtcNow; campaign.IssuedAt = campaign.StartedAt; campaign.CompletedAt = campaign.IssuedAt; campaign.UpdatedBy = actor; db.Add(CampaignHistory(campaign, "issued", actor, kh, requestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return new(new { campaign = CampaignProjection(campaign), invitations = projected, changed = true, idempotent_replay = false });
    }

    public async Task<EventRegistrationProductResult> AcceptInvitation(int t, int e, long? invitationId, int actor, string? token, string? email, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || invitationId is null && string.IsNullOrWhiteSpace(token)) return Validation("invitation"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct); var context = await Context(t, e, actor, false, ct); if (!context.Ok) return context.Error!;
        var invitation = invitationId is not null ? await db.EventInvitations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == invitationId, ct) : await db.EventInvitations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.TokenHash == Hash(token!), ct); if (invitation is null) return Missing(); var requestHash = Hash(new { eventId = e, invitationId = invitation.Id, actor }); var kh = Hash(key); var replay = await db.EventInvitationHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (replay is not null) { if (replay.EventId != e || replay.InvitationId != invitation.Id || replay.Action != "accepted" || replay.RequestHash != requestHash) return Conflict(); var replayParticipation = await Participation(t, e, actor, ct); await tx.CommitAsync(ct); return InvitationMutation(invitation, false, replayParticipation); }
        if (invitation.Status != "issued" || invitation.TokenExpiresAt <= DateTime.UtcNow || invitation.UserId is not null && invitation.UserId != actor || invitation.EmailBlindHash is not null && Hash((email ?? "").Trim().ToLowerInvariant()) != invitation.EmailBlindHash) return Forbidden(); invitation.Status = "accepted"; invitation.InvitationVersion++; invitation.AcceptedAt = DateTime.UtcNow; invitation.AcceptedBy = actor; invitation.UpdatedAt = DateTime.UtcNow;
        var participation = await ActivateParticipation(t, e, actor, kh, context.Event!, ct); db.Add(InvitationHistory(invitation, "accepted", actor, kh, requestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return InvitationMutation(invitation, true, participation);
    }

    public async Task<EventRegistrationProductResult> RevokeInvitation(int t, int e, long id, int actor, string reason, string key, CancellationToken ct)
    {
        reason = Clean(reason, 500) ?? ""; if (!ValidKey(key) || reason.Length == 0) return Validation("invitation_revocation"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct); var context = await Context(t, e, actor, true, ct); if (!context.Ok) return context.Error!; var invitation = await db.EventInvitations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id, ct); if (invitation is null) return Missing(); var requestHash = Hash(new { eventId = e, invitationId = id, reason }); var kh = Hash(key); var replay = await db.EventInvitationHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (replay is not null) { if (replay.EventId != e || replay.InvitationId != id || replay.Action != "revoked" || replay.RequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return InvitationMutation(invitation, false); } if (invitation.Status != "issued") return Conflict(); invitation.Status = "revoked"; invitation.InvitationVersion++; invitation.RevokedAt = DateTime.UtcNow; invitation.RevokedBy = actor; invitation.RevocationReason = reason; db.Add(InvitationHistory(invitation, "revoked", actor, kh, requestHash)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return InvitationMutation(invitation, true);
    }

    public async Task<EventRegistrationProductResult> CaptureGuest(int t, int e, long registrationId, int actor, long expectedRegistrationVersion, JsonElement body, CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object) return Validation("guest");
        var name = Clean(Text(body, "display_name"), 191);
        var consent = Clean(Text(body, "consent_text"), 4000);
        var consentVersion = Clean(Text(body, "consent_text_version"), 64);
        if (name is null || !Bool(body, "consent_accepted") || consent is null || consentVersion is null) return Validation("guest");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct);
        var context = await Context(t, e, actor, false, ct); if (!context.Ok) return context.Error!;
        var registration = await db.EventRegistrations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == registrationId && x.UserId == actor && (x.RegistrationState == "invited" || x.RegistrationState == "pending" || x.RegistrationState == "confirmed"), ct);
        var settings = await db.EventRegistrationSettingsProduct.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Status == "published", ct);
        if (registration is null || settings is null) return Missing();
        if (!settings.GuestsEnabled || registration.RegistrationVersion != expectedRegistrationVersion) return Conflict();
        var count = await db.EventRegistrationGuests.IgnoreQueryFilters().CountAsync(x => x.TenantId == t && x.RegistrationId == registrationId && x.Status == "captured", ct); if (count >= settings.MaxGuestsPerRegistration) return Conflict();
        var nextGuestNumber = (await db.EventRegistrationGuests.IgnoreQueryFilters().Where(x => x.TenantId == t && x.RegistrationId == registrationId).MaxAsync(x => (int?)x.GuestNumber, ct) ?? 0) + 1; if (nextGuestNumber > 20) return Conflict();
        var email = Text(body, "email")?.Trim().ToLowerInvariant(); var phone = Clean(Text(body, "phone"), 64); if (email is not null && !MailAddress.TryCreate(email, out _)) return Validation("email"); if (phone is not null && !System.Text.RegularExpressions.Regex.IsMatch(phone, @"^\+?[0-9][0-9 ()-]{5,30}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant)) return Validation("phone");
        var fingerprint = Hash(new { name = name.ToLowerInvariant(), email, phone }); if (await db.EventRegistrationGuests.IgnoreQueryFilters().AnyAsync(x => x.TenantId == t && x.RegistrationId == registrationId && x.Status == "captured" && x.IdentityFingerprint == fingerprint, ct)) return Conflict();
        var now = DateTime.UtcNow; var preferredLocale = GuestLocale(Text(body, "preferred_locale")); if (Text(body, "preferred_locale") is not null && preferredLocale is null) return Validation("preferred_locale"); var notificationConsent = Bool(body, "notification_consent"); var notificationText = Clean(Text(body, "notification_consent_text"), 4000); var notificationVersion = Clean(Text(body, "notification_consent_version"), 64); if (notificationConsent && (email is null || preferredLocale is null || notificationText is null || notificationVersion is null)) return Validation("notification_consent");
        long? ticketId = null; if (body.TryGetProperty("ticket_entitlement_id", out var ticket) && ticket.TryGetInt64(out var parsedTicketId)) { var entitlement = await db.EventTicketEntitlements.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == parsedTicketId && x.RegistrationId == registrationId && x.UserId == actor && x.Status == "confirmed", ct); if (entitlement is null || entitlement.Units < count + 2) return Validation("ticket_entitlement_id"); ticketId = parsedTicketId; }
        var retentionAnchor = (context.Event!.EndsAt ?? context.Event.StartsAt).ToUniversalTime();
        var guest = new EventRegistrationGuest { TenantId = t, EventId = e, RegistrationId = registrationId, GuestNumber = nextGuestNumber, TicketEntitlementId = ticketId, DisplayNameCiphertext = Protect(name), EmailCiphertext = email is null ? null : Protect(email), PhoneCiphertext = phone is null ? null : Protect(phone), EmailBlindHash = email is null ? null : Hash(email), IdentityFingerprint = fingerprint, PreferredLocale = preferredLocale, NotificationConsent = notificationConsent, ConsentTextHash = Hash(consent), ConsentTextVersion = consentVersion, ConsentedAt = now, NotificationConsentedAt = notificationConsent ? now : null, NotificationConsentHash = notificationConsent ? Hash(notificationText!) : null, NotificationConsentVersion = notificationConsent ? notificationVersion : null, RetentionDueAt = retentionAnchor.AddDays(settings.GuestRetentionDays), CreatedBy = actor };
        db.Add(guest); registration.RegistrationVersion++; registration.PartySize = count + 2; registration.UpdatedAt = now; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return new(new { guest = await GuestProjection(t, guest, true, true, false, ct), party_size = registration.PartySize }, Status: 201);
    }

    public async Task<EventRegistrationProductResult> CancelGuest(int t, int e, long id, int actor, long expected, string reason, CancellationToken ct)
    {
        reason = Clean(reason, 500) ?? "";
        if (reason.Length == 0 || expected < 1) return Validation("guest_cancellation");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(t, e, ct);
        var context = await Context(t, e, actor, false, ct);
        if (!context.Ok) return context.Error!;
        var guest = await db.EventRegistrationGuests.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id, ct);
        if (guest is null) return Missing();
        var registration = await db.EventRegistrations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == guest.RegistrationId, ct);
        if (registration is null) return Missing();
        if (registration.UserId != actor) return Forbidden();
        var nextRevision = expected + 1;
        var outboxKey = $"event-registration-guest-withdrawn:{t}:{e}:{id}:{nextRevision}";
        if (guest.Status == "withdrawn")
        {
            if (guest.Revision != nextRevision) return Conflict();
            var replay = await db.EventDomainOutbox.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyKey == outboxKey, ct);
            if (replay is null || !GuestCancellationReplayMatches(replay.Payload, actor, reason)) return Conflict();
            await tx.CommitAsync(ct);
            return new(new { guest = await GuestProjection(t, guest, true, true, false, ct), party_size = registration.PartySize, changed = false, idempotent_replay = true });
        }
        if (guest.Revision != expected || guest.Status != "captured") return Conflict();
        var now = DateTime.UtcNow;
        guest.Revision = nextRevision;
        guest.Status = "withdrawn";
        guest.WithdrawnAt = now;
        guest.UpdatedAt = now;
        registration.RegistrationVersion++;
        registration.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        var count = await db.EventRegistrationGuests.IgnoreQueryFilters().CountAsync(x => x.TenantId == t && x.RegistrationId == registration.Id && x.Status == "captured", ct);
        registration.PartySize = count + 1;
        db.EventDomainOutbox.Add(new EventDomainOutbox
        {
            TenantId = t, EventId = e, AggregateStream = $"event:{e}:registration-guest:{id}",
            AggregateVersion = guest.Revision, Action = "event.registration_guest.withdrawn",
            IdempotencyKey = outboxKey, ProductionMode = "queued", Status = "pending", AvailableAt = now,
            Payload = JsonSerializer.Serialize(new
            {
                guest_id = id, registration_id = registration.Id, guest_revision = guest.Revision,
                actor_user_id = actor, reason, notification_consent = guest.NotificationConsent,
                recipient_locale = guest.PreferredLocale, external_email_ciphertext = guest.EmailCiphertext,
                occurred_at = Iso(now)
            }),
            CreatedAt = now, UpdatedAt = now
        });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(new { guest = await GuestProjection(t, guest, true, true, false, ct), party_size = registration.PartySize, changed = true, idempotent_replay = false });
    }

    private static bool GuestCancellationReplayMatches(string payload, int actor, string reason)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;
            return root.TryGetProperty("actor_user_id", out var actorValue) && actorValue.TryGetInt32(out var storedActor) && storedActor == actor
                && root.TryGetProperty("reason", out var reasonValue) && reasonValue.ValueKind == JsonValueKind.String
                && string.Equals(reasonValue.GetString(), reason, StringComparison.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public async Task<EventRegistrationProductResult> GuestAttendance(int t, int e, long guestId, int actor, string action, long expected, string key, string? reason, CancellationToken ct)
    {
        reason = Clean(reason, 500);
        if (!ValidKey(key) || !AttendanceActions.Contains(action) || expected < 0 || action == "undo" && reason is null) return Validation("guest_attendance");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct);
        var context = await Context(t, e, actor, false, ct); if (!context.Ok) return context.Error!;
        if (!(await Permissions(t, context.Event!, context.Actor!, ct)).ManageAttendance) return Forbidden();
        var now = DateTime.UtcNow; var eventEnd = context.Event!.EndsAt ?? context.Event.StartsAt; if (now < context.Event.StartsAt.AddMinutes(-30) || now > eventEnd.AddHours(24)) return Conflict();
        var guest = await db.EventRegistrationGuests.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == guestId && x.Status == "captured", ct); if (guest is null) return Missing();
        var registration = await db.EventRegistrations.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == guest.RegistrationId && x.RegistrationState == "confirmed", ct); if (registration is null) return Conflict();
        if (guest.TicketEntitlementId is long ticketId && !await db.EventTicketEntitlements.IgnoreQueryFilters().AnyAsync(x => x.TenantId == t && x.EventId == e && x.Id == ticketId && x.RegistrationId == guest.RegistrationId && x.Status == "confirmed", ct)) return Conflict();
        var kh = Hash(key); var requestHash = Hash(new { action, expected, reason }); var replay = await db.EventRegistrationGuestAttendanceHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct);
        var attendance = await db.EventRegistrationGuestAttendance.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.GuestId == guestId, ct);
        if (replay is not null) { if (replay.Action != action || replay.RequestHash != requestHash || attendance is null || attendance.Version != replay.AttendanceVersion) return Conflict(); await tx.CommitAsync(ct); return AttendanceMutation(attendance, false, true, replay.Id); }
        attendance ??= new EventRegistrationGuestAttendance { TenantId = t, EventId = e, RegistrationId = guest.RegistrationId, GuestId = guestId, StatusChangedAt = now };
        if (attendance.Version != expected) return Conflict();
        var from = attendance.Status; EventRegistrationGuestAttendanceHistory? undoHistory = null;
        string? target = action switch { "check_in" when from == "not_checked_in" => "checked_in", "check_out" when from == "checked_in" => "checked_out", "no_show" when from == "not_checked_in" => "no_show", _ => null };
        if (action == "undo") { undoHistory = await db.EventRegistrationGuestAttendanceHistory.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.EventId == e && x.GuestId == guestId).OrderByDescending(x => x.AttendanceVersion).FirstOrDefaultAsync(ct); if (undoHistory is null || undoHistory.Action == "undo") return Conflict(); target = undoHistory.FromStatus; }
        if (target is null) return Conflict();
        var before = new { status = attendance.Status, checked_in_at = attendance.CheckedInAt, checked_out_at = attendance.CheckedOutAt, attended_at = attendance.AttendedAt, no_show_at = attendance.NoShowAt };
        attendance.Version++; attendance.Status = target; attendance.StatusChangedAt = now; attendance.StatusChangedBy = actor; attendance.UpdatedBy = actor; attendance.UpdatedAt = now;
        if (action == "check_in") { attendance.CheckedInAt = now; attendance.CheckedOutAt = null; attendance.AttendedAt = null; attendance.NoShowAt = null; }
        else if (action == "check_out") { attendance.CheckedOutAt = now; attendance.AttendedAt = null; attendance.NoShowAt = null; }
        else if (action == "no_show") { attendance.CheckedInAt = null; attendance.CheckedOutAt = null; attendance.AttendedAt = null; attendance.NoShowAt = now; }
        else if (undoHistory is not null) { using var metadata = JsonDocument.Parse(undoHistory.Metadata); var saved = metadata.RootElement.GetProperty("before"); attendance.CheckedInAt = JsonDate(saved, "checked_in_at"); attendance.CheckedOutAt = JsonDate(saved, "checked_out_at"); attendance.AttendedAt = JsonDate(saved, "attended_at"); attendance.NoShowAt = JsonDate(saved, "no_show_at"); }
        if (attendance.Id == 0) db.Add(attendance); await db.SaveChangesAsync(ct);
        var history = new EventRegistrationGuestAttendanceHistory { TenantId = t, EventId = e, AttendanceId = attendance.Id, RegistrationId = guest.RegistrationId, GuestId = guestId, AttendanceVersion = attendance.Version, Action = action, FromStatus = from, ToStatus = target, Status = target, ActorUserId = actor, IdempotencyHash = kh, RequestHash = requestHash, Reason = reason, Metadata = JsonSerializer.Serialize(new { schema_version = 1, credit_mode = "off", before, undone_history_id = undoHistory?.Id }) }; db.Add(history); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return AttendanceMutation(attendance, true, false, history.Id);
    }

    public async Task<EventRegistrationProductResult> RetentionDryRun(int t, int e, int actor, DateTime asOf, string key, CancellationToken ct)
    {
        if (!ValidKey(key)) return Validation("retention");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct);
        var context = await Context(t, e, actor, false, ct); if (!context.Ok) return context.Error!;
        if (!(await Permissions(t, context.Event!, context.Actor!, ct)).ManageRetention) return Forbidden();
        var eventEnd = (context.Event!.EndsAt ?? context.Event.StartsAt).ToUniversalTime(); var canonicalAsOf = CanonicalInstant(asOf); if (canonicalAsOf < eventEnd) return Conflict();
        var answers = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.EventId == e && !x.IsPurged && x.ValueJson != null && x.RetentionDueAt <= asOf).OrderBy(x => x.Id).ToListAsync(ct);
        var guests = await db.EventRegistrationGuests.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.EventId == e && x.Status != "anonymised" && x.DisplayNameCiphertext != null && x.RetentionDueAt <= asOf).OrderBy(x => x.Id).ToListAsync(ct);
        var candidateRows = answers.Select(x => new { subject_type = "answer", subject_id = x.Id, ciphertext_hash = Hash(x.ValueJson!) })
            .Concat(guests.Select(x => new { subject_type = "guest", subject_id = x.Id, ciphertext_hash = GuestCipherHash(x) })).ToArray();
        var candidateHash = Hash(candidateRows);
        var kh = Hash(key); var requestHash = Hash(new { asOf = canonicalAsOf, candidateHash });
        var replay = await db.EventRegistrationRetentionRuns.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (replay is not null) { if (replay.RequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return Mutation("run", RetentionProjection(replay), false); }
        var run = new EventRegistrationRetentionRun { TenantId = t, EventId = e, AsOfUtc = canonicalAsOf, EligibleCount = candidateRows.Length, CreatedBy = actor, IdempotencyHash = kh, RequestHash = requestHash };
        db.Add(run); await db.SaveChangesAsync(ct);
        foreach (var row in candidateRows) db.Add(new EventRegistrationRetentionItem { TenantId = t, EventId = e, RetentionRunId = run.Id, SubjectType = row.subject_type, SubjectId = row.subject_id, Action = row.subject_type == "answer" ? "purge" : "anonymise", Evidence = JsonSerializer.Serialize(new { schema_version = 1, candidate_hash = candidateHash, ciphertext_hash = row.ciphertext_hash }) });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Mutation("run", RetentionProjection(run), true, 201);
    }

    public async Task<EventRegistrationProductResult> RetentionApply(int t, int e, long runId, int actor, string key, CancellationToken ct)
    {
        if (!ValidKey(key)) return Validation("idempotency_key");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct);
        var context = await Context(t, e, actor, false, ct); if (!context.Ok) return context.Error!;
        if (!(await Permissions(t, context.Event!, context.Actor!, ct)).ManageRetention) return Forbidden();
        var dry = await db.EventRegistrationRetentionRuns.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == runId && x.Mode == "dry_run", ct); if (dry is null) return Missing();
        var eventEnd = (context.Event!.EndsAt ?? context.Event.StartsAt).ToUniversalTime(); if (dry.AsOfUtc < eventEnd) return Conflict();
        var items = await db.EventRegistrationRetentionItems.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.EventId == e && x.RetentionRunId == runId).OrderBy(x => x.Id).ToListAsync(ct); if (items.Count != dry.EligibleCount) return Conflict();
        var evidence = new List<(EventRegistrationRetentionItem Item, string CiphertextHash, string CandidateHash)>();
        foreach (var item in items) { try { using var document = JsonDocument.Parse(item.Evidence); var root = document.RootElement; evidence.Add((item, root.GetProperty("ciphertext_hash").GetString()!, root.GetProperty("candidate_hash").GetString()!)); } catch { return Conflict(); } }
        var candidateRows = evidence.Select(x => new { subject_type = x.Item.SubjectType, subject_id = x.Item.SubjectId, ciphertext_hash = x.CiphertextHash }).ToArray(); var candidateHash = Hash(candidateRows);
        if (evidence.Any(x => x.CandidateHash != candidateHash) || dry.RequestHash != Hash(new { asOf = dry.AsOfUtc, candidateHash })) return Conflict();
        var kh = Hash(key); var requestHash = Hash(new { runId, candidateHash }); var replay = await db.EventRegistrationRetentionRuns.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (replay is not null) { if (replay.RequestHash != requestHash) return Conflict(); await tx.CommitAsync(ct); return Mutation("run", RetentionProjection(replay), false); }
        var now = DateTime.UtcNow; var affected = 0; var affectedSubmissions = new HashSet<long>(); var results = new List<(EventRegistrationRetentionItem Item, bool Applied, string CiphertextHash)>();
        foreach (var row in evidence)
        {
            var applied = false;
            if (row.Item.SubjectType == "answer")
            {
                var answer = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == row.Item.SubjectId && !x.IsPurged && x.RetentionDueAt <= dry.AsOfUtc, ct);
                if (answer?.ValueJson is not null && Hash(answer.ValueJson) == row.CiphertextHash) { answer.ValueJson = null; answer.IsPurged = true; answer.PurgedAt = now; affectedSubmissions.Add(answer.SubmissionId); applied = true; }
            }
            else
            {
                var guest = await db.EventRegistrationGuests.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == row.Item.SubjectId && x.Status != "anonymised" && x.RetentionDueAt <= dry.AsOfUtc, ct);
                if (guest?.DisplayNameCiphertext is not null && GuestCipherHash(guest) == row.CiphertextHash) { guest.DisplayNameCiphertext = null; guest.EmailCiphertext = null; guest.PhoneCiphertext = null; guest.EmailBlindHash = null; guest.IdentityFingerprint = Hash($"anonymised:{guest.Id}:{Guid.NewGuid():N}"); guest.Status = "anonymised"; guest.AnonymisedAt = now; guest.UpdatedAt = now; guest.Revision++; applied = true; }
            }
            if (applied) affected++; results.Add((row.Item, applied, row.CiphertextHash));
        }
        foreach (var submissionId in affectedSubmissions) { var remaining = await db.EventRegistrationFormAnswers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == t && x.SubmissionId == submissionId && !x.IsPurged, ct); if (!remaining) { var submission = await db.EventRegistrationFormSubmissions.IgnoreQueryFilters().SingleAsync(x => x.TenantId == t && x.Id == submissionId, ct); if (submission.Status is "submitted" or "withdrawn") { submission.Status = "anonymised"; submission.AnonymisedAt = now; submission.UpdatedAt = now; submission.Revision++; } } }
        var run = new EventRegistrationRetentionRun { TenantId = t, EventId = e, Mode = "apply", DryRunId = runId, AsOfUtc = dry.AsOfUtc, EligibleCount = results.Count, AffectedCount = affected, CreatedBy = actor, IdempotencyHash = kh, RequestHash = requestHash };
        db.Add(run); await db.SaveChangesAsync(ct);
        foreach (var row in results) db.Add(new EventRegistrationRetentionItem { TenantId = t, EventId = e, RetentionRunId = run.Id, SubjectType = row.Item.SubjectType, SubjectId = row.Item.SubjectId, Action = row.Item.Action, Status = row.Applied ? "applied" : "skipped", Evidence = JsonSerializer.Serialize(new { schema_version = 1, source_item_id = row.Item.Id, candidate_hash = candidateHash, ciphertext_hash = row.CiphertextHash, outcome = row.Applied ? "purged" : "skipped" }) });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Mutation("run", RetentionProjection(run), true, 201);
    }

    private static string GuestCipherHash(EventRegistrationGuest guest) => Hash(new { guest.DisplayNameCiphertext, guest.EmailCiphertext, guest.PhoneCiphertext });
    private static DateTime CanonicalInstant(DateTime value) { var utc = value.ToUniversalTime(); return new DateTime(utc.Ticks - utc.Ticks % 10, DateTimeKind.Utc); }

    private static EventInvitationCampaignHistory CampaignHistory(EventInvitationCampaign x, string action, int actor, string key, string request) => new() { TenantId = x.TenantId, EventId = x.EventId, CampaignId = x.Id, CampaignRevision = x.Revision, Action = action, ActorUserId = actor, IdempotencyHash = key, RequestHash = request, Snapshot = JsonSerializer.Serialize(x) };
    private static EventInvitationHistory InvitationHistory(EventInvitation x, string action, int actor, string key, string request) => new() { TenantId = x.TenantId, EventId = x.EventId, InvitationId = x.Id, InvitationVersion = x.InvitationVersion, Action = action, ActorUserId = actor, IdempotencyHash = key, RequestHash = request };
    private static object InvitationProjection(EventInvitation x) => new { id = x.Id, campaign_id = x.CampaignId, status = x.Status, invitation_version = x.InvitationVersion, token_expires_at = Iso(x.TokenExpiresAt), accepted_at = IsoN(x.AcceptedAt), revoked_at = IsoN(x.RevokedAt) };
    private static EventRegistrationProductResult InvitationMutation(EventInvitation x, bool changed, object? participation = null) => new(new { invitation = InvitationProjection(x), participation, changed, idempotent_replay = !changed });
    private static EventRegistrationProductResult AttendanceMutation(EventRegistrationGuestAttendance x, bool changed, bool replayed, long historyId) => new(new { attendance = new { id = x.Id, registration_id = x.RegistrationId, guest_id = x.GuestId, status = x.Status, version = x.Version, status_changed_at = Iso(x.StatusChangedAt), status_changed_by = x.StatusChangedBy, checked_in_at = IsoN(x.CheckedInAt), checked_out_at = IsoN(x.CheckedOutAt), attended_at = IsoN(x.AttendedAt), no_show_at = IsoN(x.NoShowAt) }, changed, replayed, history_id = historyId });
    private static object RetentionProjection(EventRegistrationRetentionRun x) => new { id = x.Id, mode = x.Mode, dry_run_id = x.DryRunId, as_of_utc = Iso(x.AsOfUtc), eligible_count = x.EligibleCount, affected_count = x.AffectedCount, completed_at = Iso(x.CompletedAt) };
    private static void WriteCsv(StringBuilder output, IEnumerable<string?> fields) =>
        output.AppendLine(string.Join(',', fields.Select(value => $"\"{(value ?? string.Empty).Replace("\"", "\"\"")}\"")));

    private static string? GuestLocale(string? value)
    {
        if (value is null) return null;
        var locale = value.Trim().Replace('_', '-').Split('-', 2)[0].ToLowerInvariant();
        return locale is "ar" or "de" or "en" or "es" or "fr" or "ga" or "it" or "ja" or "nl" or "pl" or "pt" ? locale : null;
    }

    private static string CsvJsonCell(string json)
    {
        using var document = JsonDocument.Parse(json);
        var value = document.RootElement;
        var text = value.ValueKind switch
        {
            JsonValueKind.Null => string.Empty,
            JsonValueKind.True => "1",
            JsonValueKind.False => "0",
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.Array => string.Join("; ", value.EnumerateArray().Select(CsvJsonPlain)),
            _ => value.GetRawText()
        };
        return CsvCell(text);
    }

    private static string CsvJsonPlain(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null => string.Empty,
        JsonValueKind.True => "1",
        JsonValueKind.False => "0",
        JsonValueKind.String => value.GetString() ?? string.Empty,
        _ => value.GetRawText()
    };

    private static string CsvCell(string? value)
    {
        var text = value ?? string.Empty;
        var first = text.AsSpan().TrimStart();
        return !first.IsEmpty && first[0] is '=' or '+' or '-' or '@' ? $"'{text}" : text;
    }

    private static DateTime? JsonDate(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
        && DateTimeOffset.TryParse(value.GetString(), out var parsed)
            ? parsed.UtcDateTime
            : null;

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private async Task<object> ActivateParticipation(int tenantId, int eventId, int actorId, string acceptanceKeyHash, Event evt, CancellationToken ct)
    {
        var registration = await db.EventRegistrations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.UserId == actorId && x.CapacityPoolKey == "event", ct);
        var waitlist = await db.EventWaitlistEntries.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.UserId == actorId && x.CapacityPoolKey == "event", ct);
        if (registration?.RegistrationState == "confirmed") return ParticipationProjection("confirmed", registration, null);
        if (waitlist?.QueueState == "waiting") return ParticipationProjection("waitlisted", registration, waitlist);

        var now = DateTime.UtcNow;
        var confirmedCount = await db.EventRegistrations.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.CapacityPoolKey == "event" && x.RegistrationState == "confirmed", ct);
        var canConfirm = waitlist?.QueueState == "offered" || evt.MaxAttendees is null || confirmedCount < evt.MaxAttendees.Value;
        if (canConfirm)
        {
            var from = registration?.RegistrationState;
            registration ??= new EventRegistration { TenantId = tenantId, EventId = eventId, UserId = actorId, CapacityPoolKey = "event", RegistrationVersion = 1, CreatedAt = now };
            if (registration.Id == 0) db.Add(registration); else registration.RegistrationVersion++;
            registration.RegistrationState = "confirmed"; registration.StateChangedAt = now; registration.StateChangedBy = actorId; registration.ConfirmedAt = now; registration.CancelledAt = null; registration.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            db.Add(new EventRegistrationHistory { TenantId = tenantId, EventId = eventId, RegistrationId = registration.Id, UserId = actorId, ActorUserId = actorId, CapacityPoolKey = "event", RegistrationVersion = registration.RegistrationVersion, Action = waitlist?.QueueState == "offered" ? "confirmed_from_waitlist" : "confirmed", FromState = from, ToState = "confirmed", IdempotencyKey = Hash($"invitation-registration:{acceptanceKeyHash}"), Metadata = "{\"contract_version\":2}", CreatedAt = now });
            if (waitlist?.QueueState == "offered")
            {
                waitlist.QueueState = "accepted"; waitlist.QueueVersion++; waitlist.StateChangedAt = now; waitlist.StateChangedBy = actorId; waitlist.AcceptedAt = now; waitlist.AcceptedRegistrationId = registration.Id; waitlist.OfferTokenUsedAt = now; waitlist.UpdatedAt = now;
                db.Add(new EventWaitlistEntryHistory { TenantId = tenantId, EventId = eventId, WaitlistEntryId = waitlist.Id, UserId = actorId, ActorUserId = actorId, CapacityPoolKey = "event", QueueVersion = waitlist.QueueVersion, QueueSequence = waitlist.QueueSequence, Action = "accepted", FromState = "offered", ToState = "accepted", IdempotencyKey = Hash($"invitation-offer:{acceptanceKeyHash}"), Metadata = "{\"contract_version\":2}", CreatedAt = now });
            }
            db.EventDomainOutbox.Add(new EventDomainOutbox { TenantId = tenantId, EventId = eventId, AggregateStream = "registration", AggregateVersion = registration.RegistrationVersion, Action = "event.registration.confirmed", IdempotencyKey = $"registration:{Hash($"invitation-outbox:{acceptanceKeyHash}")}", ProductionMode = "direct", Status = "direct", Payload = JsonSerializer.Serialize(new { user_id = actorId, invitation_acceptance = true }), ProcessedAt = now, CreatedAt = now, UpdatedAt = now });
            return ParticipationProjection("confirmed", registration, waitlist?.QueueState == "accepted" ? waitlist : null);
        }

        var previousState = waitlist?.QueueState;
        if (waitlist is null)
        {
            var sequence = (await db.EventWaitlistEntries.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId && x.CapacityPoolKey == "event").MaxAsync(x => (long?)x.QueueSequence, ct) ?? 0) + 1;
            waitlist = new EventWaitlistEntry { TenantId = tenantId, EventId = eventId, UserId = actorId, CapacityPoolKey = "event", QueueState = "waiting", QueueVersion = 1, QueueSequence = sequence, StateChangedAt = now, StateChangedBy = actorId, CreatedAt = now, UpdatedAt = now };
            db.Add(waitlist); await db.SaveChangesAsync(ct);
        }
        else
        {
            waitlist.QueueState = "waiting"; waitlist.QueueVersion++; waitlist.StateChangedAt = now; waitlist.StateChangedBy = actorId; waitlist.CancelledAt = null; waitlist.UpdatedAt = now;
        }
        db.Add(new EventWaitlistEntryHistory { TenantId = tenantId, EventId = eventId, WaitlistEntryId = waitlist.Id, UserId = actorId, ActorUserId = actorId, CapacityPoolKey = "event", QueueVersion = waitlist.QueueVersion, QueueSequence = waitlist.QueueSequence, Action = "joined", FromState = previousState, ToState = "waiting", IdempotencyKey = Hash($"invitation-waitlist:{acceptanceKeyHash}"), Metadata = "{\"contract_version\":2}", CreatedAt = now });
        db.EventDomainOutbox.Add(new EventDomainOutbox { TenantId = tenantId, EventId = eventId, AggregateStream = "waitlist", AggregateVersion = waitlist.QueueVersion, Action = "event.waitlist.joined", IdempotencyKey = $"registration:{Hash($"invitation-waitlist-outbox:{acceptanceKeyHash}")}", ProductionMode = "direct", Status = "direct", Payload = JsonSerializer.Serialize(new { user_id = actorId, invitation_acceptance = true }), ProcessedAt = now, CreatedAt = now, UpdatedAt = now });
        return ParticipationProjection("waitlisted", registration, waitlist);
    }

    private async Task<object> Participation(int tenantId, int eventId, int actorId, CancellationToken ct)
    {
        var registration = await db.EventRegistrations.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.UserId == actorId && x.CapacityPoolKey == "event", ct);
        var waitlist = await db.EventWaitlistEntries.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.EventId == eventId && x.UserId == actorId && x.CapacityPoolKey == "event", ct);
        if (registration?.RegistrationState == "confirmed") return ParticipationProjection("confirmed", registration, null);
        if (waitlist?.QueueState is "waiting" or "offered") return ParticipationProjection("waitlisted", registration, waitlist);
        return ParticipationProjection("none", registration, waitlist);
    }

    private static object ParticipationProjection(string status, EventRegistration? registration, EventWaitlistEntry? waitlist) => new
    {
        status,
        registration = registration is null ? null : new { id = registration.Id, registration_state = registration.RegistrationState, registration_version = registration.RegistrationVersion, party_size = registration.PartySize },
        waitlist = waitlist is null ? null : new { id = waitlist.Id, queue_state = waitlist.QueueState, queue_version = waitlist.QueueVersion, queue_sequence = waitlist.QueueSequence, offered_at = IsoN(waitlist.OfferedAt), offer_expires_at = IsoN(waitlist.OfferExpiresAt) }
    };
}
