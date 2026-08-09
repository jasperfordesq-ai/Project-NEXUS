// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using System.Data;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventLifecycleError(string Code, string Message, int Status, string? Field = null);
public sealed record EventLifecycleResult(object? Data, EventLifecycleError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed class EventLifecycleService
{
    private static readonly HashSet<string> Publications = ["draft", "pending_review", "published", "archived"];
    private static readonly HashSet<string> Operations = ["scheduled", "postponed", "cancelled", "completed"];
    private readonly NexusDbContext _db;
    private readonly EventFederationStatusService _federation;
    public EventLifecycleService(NexusDbContext db, EventFederationStatusService federation) { _db = db; _federation = federation; }

    public async Task<EventLifecycleResult> TransitionAsync(int tenantId, int eventId, int actorId, string action, string? reason, CancellationToken ct)
    {
        reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (reason?.Length > 4000) return Invalid("VALIDATION_INVALID_REASON", "Reason is too long", "reason");
        if (action == "reject" && reason is null) return Invalid("VALIDATION_REQUIRED_FIELD", "Reason is required", "reason");

        var candidate = await _db.Events.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
        if (candidate is null) return Missing();
        var publicationAction = action is "submit_for_review" or "publish" or "approve" or "reject";
        var seriesRootId = candidate.ParentEventId ?? candidate.Id;
        var seriesRoot = candidate.ParentEventId is null
            ? candidate
            : await _db.Events.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == seriesRootId && x.IsRecurringTemplate, ct);
        if (seriesRoot is null) return Missing();
        if (seriesRoot.IsRecurringTemplate && (publicationAction || candidate.Id == seriesRoot.Id))
            return await TransitionSeriesAsync(tenantId, candidate.Id, seriesRoot.Id, actorId, action, reason, publicationAction, ct);

        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {eventId})", ct);
        var evt = await _db.Events.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
        if (evt is null) return Missing();
        var actor = await _db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == actorId && x.IsActive, ct);
        if (actor is null) return new(null, new("FORBIDDEN", "Event management access is required", 403));
        var isAdmin = IsAdmin(actor);
        var isMemberManaged = action is "submit_for_review" or "publish" or "cancel" or "archive";
        if (isMemberManaged)
        {
            if (!await CanManageAsync(tenantId, evt, actor, isAdmin, ct))
                return new(null, new("FORBIDDEN", "Event management access is required", 403));
        }
        else if (!isAdmin)
        {
            return new(null, new("FORBIDDEN", "Administrator access is required", 403));
        }

        var current = Resolve(evt);
        if (current.Error is not null) return current;
        var fromPublication = evt.PublicationStatus;
        var fromOperational = evt.OperationalStatus;
        var toPublication = fromPublication;
        var toOperational = fromOperational;
        HashSet<string>? publicationGuard = null;
        HashSet<string>? operationalGuard = null;
        var moderationRequired = action is "submit_for_review" or "publish" && await ModerationRequiredAsync(tenantId, ct);
        switch (action)
        {
            case "submit_for_review":
                if (!moderationRequired || isAdmin)
                    return new(null, new("EVENT_REVIEW_NOT_REQUIRED", "Event review is not required", 409));
                toPublication = "pending_review";
                publicationGuard = ["draft", "pending_review"];
                break;
            case "publish":
                if (moderationRequired && !isAdmin)
                    return new(null, new("EVENT_REVIEW_REQUIRED", "Event review is required", 409));
                toPublication = "published";
                publicationGuard = ["draft", "pending_review", "published"];
                break;
            case "approve": toPublication = "published"; publicationGuard = ["draft", "pending_review", "published"]; break;
            case "reject": toPublication = "draft"; publicationGuard = ["pending_review", "draft"]; break;
            case "postpone": toOperational = "postponed"; operationalGuard = ["scheduled", "postponed"]; break;
            case "complete": toOperational = "completed"; operationalGuard = ["scheduled", "completed"]; break;
            case "cancel":
                toOperational = "cancelled";
                operationalGuard = ["scheduled", "postponed", "cancelled"];
                break;
            case "archive":
                toPublication = "archived";
                if (fromOperational is "scheduled" or "postponed") toOperational = "cancelled";
                break;
            case "restore":
            case "reschedule":
                if (fromPublication == "archived") toPublication = "draft";
                if (fromOperational is "postponed" or "cancelled") toOperational = "scheduled";
                operationalGuard = ["scheduled", "postponed", "cancelled"];
                break;
            default: return new(null, new("EVENT_LIFECYCLE_CONFLICT", "Unknown lifecycle transition", 409));
        }
        if (publicationGuard is not null && !publicationGuard.Contains(fromPublication)) return Conflict();
        if (operationalGuard is not null && !operationalGuard.Contains(fromOperational)) return Conflict();
        if (toPublication == fromPublication && toOperational == fromOperational)
        {
            await SynchronizeModerationQueueAsync(evt, actorId, action, reason, ct);
            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new(Resource(evt, action, false, null, null, EmptyCascade()));
        }
        if (!CanPublicationTransition(fromPublication, toPublication) || !CanOperationalTransition(fromOperational, toOperational) || !Compatible(toPublication, toOperational)) return Conflict();

        var activeRsvps = await _db.EventRsvps.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId && new[] { "going", "interested", "maybe", "invited", "waitlisted" }.Contains(x.Status)).ToListAsync(ct);
        var terminal = toOperational == "cancelled" && fromOperational != "cancelled" || toPublication == "archived" && fromPublication != "archived";
        var requiresReason = terminal && (toOperational == "cancelled" || fromPublication == "published" || activeRsvps.Count > 0);
        if (requiresReason && reason is null) return new(null, new("EVENT_LIFECYCLE_CONFLICT", "A reason is required for this transition", 409, "reason"));

        var now = DateTime.UtcNow;
        var publicationChanged = fromPublication != toPublication;
        var operationalChanged = fromOperational != toOperational;
        var nextVersion = evt.LifecycleVersion + 1;
        var legacy = LegacyMirror(toPublication, toOperational);
        var fromLegacy = evt.Status;
        if (publicationChanged)
        {
            evt.PublicationStatusChangedAt = now; evt.PublicationStatusChangedBy = actorId;
            if (toPublication == "pending_review") { evt.ModerationSubmittedAt = now; evt.ModerationSubmittedBy = actorId; }
            if (fromPublication == "pending_review") { evt.ModeratedAt = now; evt.ModeratedBy = actorId; evt.ModerationReason = reason; }
        }
        if (operationalChanged)
        {
            evt.OperationalStatusChangedAt = now; evt.OperationalStatusChangedBy = actorId;
            if (toOperational == "cancelled") { evt.CancelledAt = now; evt.CancelledBy = actorId; evt.CancellationReason = reason; }
            else if (fromOperational == "cancelled") { evt.CancelledAt = null; evt.CancelledBy = null; evt.CancellationReason = null; }
        }
        evt.PublicationStatus = toPublication; evt.OperationalStatus = toOperational; evt.Status = legacy;
        evt.IsCancelled = legacy == "cancelled"; evt.LifecycleVersion = nextVersion; evt.LifecycleReason = reason; evt.UpdatedAt = now;

        var reminders = await _db.EventReminders.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.EventId == eventId && x.Status == "pending" && !x.IsSent).ToListAsync(ct);
        var cascade = EmptyCascade();
        var recipients = new HashSet<int>();
        if (terminal)
        {
            foreach (var rsvp in activeRsvps) { rsvp.Status = "cancelled"; rsvp.RespondedAt = now; recipients.Add(rsvp.UserId); }
            foreach (var reminder in reminders) { reminder.Status = "cancelled"; reminder.ClosedReason = "event_unavailable"; reminder.UpdatedAt = now; }
            cascade["registrations_cancelled"] = activeRsvps.Count; cascade["reminders_cancelled"] = reminders.Count;
        }
        else if (toOperational is "postponed" or "completed" && operationalChanged)
        {
            foreach (var reminder in reminders) { reminder.Status = toOperational == "postponed" ? "superseded" : "cancelled"; reminder.ClosedReason = $"event_{toOperational}"; reminder.UpdatedAt = now; }
            cascade["reminders_cancelled"] = reminders.Count;
        }

        var metadata = JsonSerializer.Serialize(new { schema_version = 1, source = "event_lifecycle_service", axes_changed = new[] { publicationChanged ? "publication" : null, operationalChanged ? "operational" : null }.Where(x => x is not null), cascade, series = (object?)null, notifications_suppressed = false });
        var history = new EventStatusHistory { TenantId = tenantId, EventId = eventId, ActorUserId = actorId, LifecycleVersion = nextVersion, FromPublicationStatus = fromPublication, ToPublicationStatus = toPublication, FromOperationalStatus = fromOperational, ToOperationalStatus = toOperational, FromLegacyStatus = fromLegacy, ToLegacyStatus = legacy, Reason = reason, Metadata = metadata, CreatedAt = now };
        _db.EventStatusHistories.Add(history);
        var outbox = new EventDomainOutbox { TenantId = tenantId, EventId = eventId, AggregateStream = "lifecycle", AggregateVersion = nextVersion, IdempotencyKey = $"event:{tenantId}:{eventId}:lifecycle:v{nextVersion}", Payload = JsonSerializer.Serialize(new { schema_version = 1, tenant_id = tenantId, event_id = eventId, actor_user_id = actorId, organizer_user_id = evt.CreatedById, affected_recipient_user_ids = recipients, lifecycle_version = nextVersion, publication = new { from = fromPublication, to = toPublication }, operational = new { from = fromOperational, to = toOperational }, legacy_status = legacy, reason, metadata, occurred_at = now }), AvailableAt = now, ProcessedAt = now, CreatedAt = now, UpdatedAt = now };
        _db.EventDomainOutbox.Add(outbox);
        await SynchronizeModerationQueueAsync(evt, actorId, action, reason, ct);
        await _federation.EnqueueLifecycleAsync(evt, ct);
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        try
        {
            if (action == "approve" && publicationChanged && evt.CreatedById != actorId) AddNotification(tenantId, evt.CreatedById, "event_approved", "Event approved", evt.Id, now);
            if (terminal)
            {
                recipients.Add(evt.CreatedById);
                foreach (var userId in recipients.Where(x => x > 0 && x != actorId)) AddNotification(tenantId, userId, "event_cancelled", "Event cancelled", evt.Id, now);
            }
            else if (action is "postpone" or "restore" or "reschedule" && operationalChanged && evt.CreatedById != actorId)
                AddNotification(tenantId, evt.CreatedById, "event_update", "Event schedule updated", evt.Id, now);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            foreach (var entry in _db.ChangeTracker.Entries<Notification>().Where(x => x.State == EntityState.Added)) entry.State = EntityState.Detached;
        }
        return new(Resource(evt, action, true, history.Id, outbox.Id, cascade));
    }

    private async Task<EventLifecycleResult> TransitionSeriesAsync(
        int tenantId,
        int requestedEventId,
        int rootEventId,
        int actorId,
        string action,
        string? reason,
        bool publicationAction,
        CancellationToken ct)
    {
        await using var tx = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {rootEventId})", ct);

        var root = await _db.Events.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == rootEventId && x.IsRecurringTemplate, ct);
        var requested = requestedEventId == rootEventId
            ? root
            : await _db.Events.IgnoreQueryFilters()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == requestedEventId && x.ParentEventId == rootEventId, ct);
        if (root is null || requested is null) return Missing();

        var actor = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == actorId && x.IsActive, ct);
        if (actor is null) return new(null, new("FORBIDDEN", "Event management access is required", 403));
        var isAdmin = IsAdmin(actor);
        var memberManaged = action is "submit_for_review" or "publish" or "cancel" or "archive";
        if (memberManaged)
        {
            if (!await CanManageAsync(tenantId, requested, actor, isAdmin, ct)
                || !await CanManageAsync(tenantId, root, actor, isAdmin, ct))
                return new(null, new("FORBIDDEN", "Event management access is required", 403));
        }
        else if (!isAdmin)
        {
            return new(null, new("FORBIDDEN", "Administrator access is required", 403));
        }

        var moderationRequired = publicationAction && await ModerationRequiredAsync(tenantId, ct);
        if (action == "submit_for_review" && (!moderationRequired || isAdmin))
            return new(null, new("EVENT_REVIEW_NOT_REQUIRED", "Event review is not required", 409));
        if (action == "publish" && moderationRequired && !isAdmin)
            return new(null, new("EVENT_REVIEW_REQUIRED", "Event review is required", 409));

        var operationStartedAt = DateTime.UtcNow;
        var childrenQuery = _db.Events.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.ParentEventId == rootEventId);
        if (!publicationAction) childrenQuery = childrenQuery.Where(x => x.StartsAt >= operationStartedAt);
        var children = await childrenQuery.OrderBy(x => x.Id).ToListAsync(ct);
        var targets = new List<Event> { root };
        targets.AddRange(children);

        var outcomes = new Dictionary<int, SeriesTransitionOutcome>();
        foreach (var target in targets)
        {
            var applied = await ApplySeriesTargetAsync(
                tenantId,
                target,
                actorId,
                action,
                reason,
                rootEventId,
                target.Id != rootEventId,
                ct);
            if (applied.Error is not null) return new(null, applied.Error);
            outcomes[target.Id] = applied.Outcome!;
        }

        var changedChildren = outcomes.Values.Where(x => x.Event.Id != rootEventId && x.Changed).ToList();
        if (!outcomes[rootEventId].Changed && changedChildren.Count > 0)
            outcomes[rootEventId] = CreateSyntheticRootOutcome(root, actorId, action, reason, changedChildren, operationStartedAt);

        var changed = outcomes.Values.Where(x => x.Changed).OrderBy(x => x.Event.Id).ToList();
        var changedIds = changed.Select(x => x.Event.Id).ToArray();
        var recipientIds = changed.SelectMany(x => x.RecipientIds).Where(x => x > 0).Distinct().OrderBy(x => x).ToArray();
        var rootOutcome = outcomes[rootEventId];
        if (rootOutcome.Changed)
        {
            var presentationId = changedChildren.OrderBy(x => x.Event.StartsAt).ThenBy(x => x.Event.Id)
                .Select(x => x.Event.Id).FirstOrDefault();
            if (presentationId == 0) presentationId = rootEventId;
            var seriesEvidence = new
            {
                root_event_id = rootEventId,
                member_type = "template",
                action,
                affected_event_ids = changedIds,
                presentation_event_id = presentationId,
                recipient_count = recipientIds.Length,
                synthetic_root_revision = rootOutcome.SyntheticRoot
            };
            rootOutcome.History!.Metadata = LifecycleMetadata(
                rootOutcome.PublicationChanged,
                rootOutcome.OperationalChanged,
                rootOutcome.Cascade,
                seriesEvidence,
                false,
                rootOutcome.SyntheticRoot ? "event_lifecycle_series_aggregate" : "event_lifecycle_service");
            rootOutcome.Outbox!.ProductionMode = "outbox_authoritative";
            rootOutcome.Outbox.Status = "pending";
            rootOutcome.Outbox.ProcessedAt = null;
            rootOutcome.Outbox.AvailableAt = operationStartedAt;
            rootOutcome.Outbox.Payload = LifecyclePayload(rootOutcome, actorId, recipientIds, rootOutcome.History.Metadata, operationStartedAt, presentationId);
        }
        foreach (var child in changedChildren)
        {
            child.Outbox!.ProductionMode = "shadow_outbox";
            child.Outbox.Status = "processed";
            child.Outbox.ProcessedAt = operationStartedAt;
        }

        await SynchronizeSeriesModerationQueueAsync(root, targets.Select(x => x.Id).ToArray(), actorId, action, reason, ct);
        foreach (var outcome in changed) await _federation.EnqueueLifecycleAsync(outcome.Event, ct);
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        try
        {
            var presentationId = changedChildren.OrderBy(x => x.Event.StartsAt).ThenBy(x => x.Event.Id)
                .Select(x => x.Event.Id).FirstOrDefault();
            if (presentationId == 0) presentationId = rootEventId;
            if (action == "approve" && rootOutcome.PublicationChanged && root.CreatedById != actorId)
                AddNotification(tenantId, root.CreatedById, "event_approved", "Event approved", presentationId, operationStartedAt);
            if (changed.Any(x => x.Terminal))
            {
                var cancellationRecipients = recipientIds.Append(root.CreatedById).Where(x => x > 0 && x != actorId).Distinct();
                foreach (var userId in cancellationRecipients)
                    AddNotification(tenantId, userId, "event_cancelled", "Event cancelled", presentationId, operationStartedAt);
            }
            else if (action is "postpone" or "restore" or "reschedule" && changed.Any(x => x.OperationalChanged) && root.CreatedById != actorId)
                AddNotification(tenantId, root.CreatedById, "event_update", "Event schedule updated", presentationId, operationStartedAt);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            foreach (var entry in _db.ChangeTracker.Entries<Notification>().Where(x => x.State == EntityState.Added))
                entry.State = EntityState.Detached;
        }

        var responseOutcome = outcomes[requestedEventId];
        var aggregateCascade = EmptyCascade();
        foreach (var outcome in outcomes.Values)
            foreach (var key in aggregateCascade.Keys.ToArray()) aggregateCascade[key] += outcome.Cascade[key];
        var series = new
        {
            is_series = true,
            root_event_id = rootEventId,
            target_count = outcomes.Count,
            changed_count = changed.Count,
            replayed_count = outcomes.Count - changed.Count,
            history_count = changed.Count,
            outbox_count = changed.Count,
            event_ids = outcomes.Keys.OrderBy(x => x).ToArray(),
            changed_event_ids = changedIds
        };
        return new(Resource(responseOutcome.Event, action, changed.Count > 0,
            responseOutcome.History?.Id, responseOutcome.Outbox?.Id, aggregateCascade, series));
    }

    private async Task<SeriesApplyResult> ApplySeriesTargetAsync(
        int tenantId,
        Event evt,
        int actorId,
        string action,
        string? reason,
        int rootEventId,
        bool isOccurrence,
        CancellationToken ct)
    {
        var current = Resolve(evt);
        if (current.Error is not null) return new(null, current.Error);
        var fromPublication = evt.PublicationStatus;
        var fromOperational = evt.OperationalStatus;
        var toPublication = fromPublication;
        var toOperational = fromOperational;
        HashSet<string>? publicationGuard = null;
        HashSet<string>? operationalGuard = null;
        switch (action)
        {
            case "submit_for_review": toPublication = "pending_review"; publicationGuard = ["draft", "pending_review"]; break;
            case "publish": case "approve": toPublication = "published"; publicationGuard = ["draft", "pending_review", "published"]; break;
            case "reject": toPublication = "draft"; publicationGuard = ["pending_review", "draft"]; break;
            case "cancel": toOperational = "cancelled"; operationalGuard = ["scheduled", "postponed", "cancelled"]; break;
            case "postpone": toOperational = "postponed"; operationalGuard = ["scheduled", "postponed"]; break;
            case "complete": toOperational = "completed"; operationalGuard = ["scheduled", "completed"]; break;
            case "archive":
                toPublication = "archived";
                if (fromOperational is "scheduled" or "postponed") toOperational = "cancelled";
                break;
            case "restore": case "reschedule":
                if (fromPublication == "archived") toPublication = "draft";
                if (fromOperational is "postponed" or "cancelled") toOperational = "scheduled";
                operationalGuard = ["scheduled", "postponed", "cancelled"];
                break;
            default: return new(null, new("EVENT_LIFECYCLE_CONFLICT", "Unknown lifecycle transition", 409));
        }
        if (publicationGuard is not null && !publicationGuard.Contains(fromPublication)) return new(null, Conflict().Error);
        if (operationalGuard is not null && !operationalGuard.Contains(fromOperational)) return new(null, Conflict().Error);
        if (toPublication == fromPublication && toOperational == fromOperational)
            return new(new(evt, false, null, null, EmptyCascade(), [], false, false, false, false, fromPublication, fromOperational), null);
        if (!CanPublicationTransition(fromPublication, toPublication)
            || !CanOperationalTransition(fromOperational, toOperational)
            || !Compatible(toPublication, toOperational)) return new(null, Conflict().Error);

        var activeRsvps = await _db.EventRsvps.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.EventId == evt.Id
                && new[] { "going", "interested", "maybe", "invited", "waitlisted" }.Contains(x.Status))
            .ToListAsync(ct);
        var terminal = toOperational == "cancelled" && fromOperational != "cancelled"
            || toPublication == "archived" && fromPublication != "archived";
        var requiresReason = terminal && (toOperational == "cancelled" || fromPublication == "published" || activeRsvps.Count > 0);
        if (requiresReason && reason is null)
            return new(null, new("EVENT_LIFECYCLE_CONFLICT", "A reason is required for this transition", 409, "reason"));

        var now = DateTime.UtcNow;
        var publicationChanged = fromPublication != toPublication;
        var operationalChanged = fromOperational != toOperational;
        var nextVersion = evt.LifecycleVersion + 1;
        var legacy = LegacyMirror(toPublication, toOperational);
        var fromLegacy = evt.Status;
        if (publicationChanged)
        {
            evt.PublicationStatusChangedAt = now; evt.PublicationStatusChangedBy = actorId;
            if (toPublication == "pending_review") { evt.ModerationSubmittedAt = now; evt.ModerationSubmittedBy = actorId; }
            if (fromPublication == "pending_review") { evt.ModeratedAt = now; evt.ModeratedBy = actorId; evt.ModerationReason = reason; }
        }
        if (operationalChanged)
        {
            evt.OperationalStatusChangedAt = now; evt.OperationalStatusChangedBy = actorId;
            if (toOperational == "cancelled") { evt.CancelledAt = now; evt.CancelledBy = actorId; evt.CancellationReason = reason; }
            else if (fromOperational == "cancelled") { evt.CancelledAt = null; evt.CancelledBy = null; evt.CancellationReason = null; }
        }
        evt.PublicationStatus = toPublication; evt.OperationalStatus = toOperational; evt.Status = legacy;
        evt.IsCancelled = legacy == "cancelled"; evt.LifecycleVersion = nextVersion; evt.LifecycleReason = reason; evt.UpdatedAt = now;

        var reminders = await _db.EventReminders.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenantId && x.EventId == evt.Id && x.Status == "pending" && !x.IsSent).ToListAsync(ct);
        var cascade = EmptyCascade();
        var recipients = new HashSet<int>();
        if (terminal)
        {
            foreach (var rsvp in activeRsvps)
            {
                if (rsvp.Status == "waitlisted") cascade["waitlist_cancelled"]++;
                else cascade["registrations_cancelled"]++;
                rsvp.Status = "cancelled"; rsvp.RespondedAt = now; recipients.Add(rsvp.UserId);
            }
            foreach (var reminder in reminders) { reminder.Status = "cancelled"; reminder.ClosedReason = "event_unavailable"; reminder.UpdatedAt = now; }
            cascade["reminders_cancelled"] = reminders.Count;
        }
        else if (toOperational is "postponed" or "completed" && operationalChanged)
        {
            foreach (var reminder in reminders) { reminder.Status = toOperational == "postponed" ? "superseded" : "cancelled"; reminder.ClosedReason = $"event_{toOperational}"; reminder.UpdatedAt = now; }
            cascade["reminders_cancelled"] = reminders.Count;
        }

        var series = new { root_event_id = rootEventId, member_type = isOccurrence ? "occurrence" : "template", action };
        var metadata = LifecycleMetadata(publicationChanged, operationalChanged, cascade, series, isOccurrence, "event_lifecycle_service");
        var history = new EventStatusHistory
        {
            TenantId = tenantId, EventId = evt.Id, ActorUserId = actorId, LifecycleVersion = nextVersion,
            FromPublicationStatus = fromPublication, ToPublicationStatus = toPublication,
            FromOperationalStatus = fromOperational, ToOperationalStatus = toOperational,
            FromLegacyStatus = fromLegacy, ToLegacyStatus = legacy, Reason = reason, Metadata = metadata, CreatedAt = now
        };
        _db.EventStatusHistories.Add(history);
        var outcome = new SeriesTransitionOutcome(evt, true, history, null, cascade, recipients, publicationChanged,
            operationalChanged, terminal, false, fromPublication, fromOperational);
        var outbox = new EventDomainOutbox
        {
            TenantId = tenantId, EventId = evt.Id, AggregateStream = "lifecycle", AggregateVersion = nextVersion,
            IdempotencyKey = $"event:{tenantId}:{evt.Id}:lifecycle:v{nextVersion}",
            ProductionMode = isOccurrence ? "shadow_outbox" : "outbox_authoritative",
            Status = isOccurrence ? "processed" : "pending",
            Payload = LifecyclePayload(outcome, actorId, recipients.OrderBy(x => x).ToArray(), metadata, now, evt.Id),
            AvailableAt = now, ProcessedAt = isOccurrence ? now : null, CreatedAt = now, UpdatedAt = now
        };
        _db.EventDomainOutbox.Add(outbox);
        return new(outcome with { Outbox = outbox }, null);
    }

    private SeriesTransitionOutcome CreateSyntheticRootOutcome(
        Event root,
        int actorId,
        string action,
        string? reason,
        IReadOnlyCollection<SeriesTransitionOutcome> changedChildren,
        DateTime now)
    {
        var nextVersion = root.LifecycleVersion + 1;
        root.LifecycleVersion = nextVersion;
        root.LifecycleReason = reason;
        root.UpdatedAt = now;
        var cascade = EmptyCascade();
        var changedIds = changedChildren.Select(x => x.Event.Id).OrderBy(x => x).ToArray();
        var series = new { root_event_id = root.Id, member_type = "template", action, changed_occurrence_ids = changedIds, synthetic_root_revision = true };
        var metadata = LifecycleMetadata(false, false, cascade, series, false, "event_lifecycle_series_aggregate");
        var history = new EventStatusHistory
        {
            TenantId = root.TenantId, EventId = root.Id, ActorUserId = actorId, LifecycleVersion = nextVersion,
            FromPublicationStatus = root.PublicationStatus, ToPublicationStatus = root.PublicationStatus,
            FromOperationalStatus = root.OperationalStatus, ToOperationalStatus = root.OperationalStatus,
            FromLegacyStatus = root.Status, ToLegacyStatus = root.Status, Reason = reason, Metadata = metadata, CreatedAt = now
        };
        _db.EventStatusHistories.Add(history);
        var outcome = new SeriesTransitionOutcome(root, true, history, null, cascade, [], false, false, false, true,
            root.PublicationStatus, root.OperationalStatus);
        var outbox = new EventDomainOutbox
        {
            TenantId = root.TenantId, EventId = root.Id, AggregateStream = "lifecycle", AggregateVersion = nextVersion,
            IdempotencyKey = $"event:{root.TenantId}:{root.Id}:lifecycle:v{nextVersion}", ProductionMode = "outbox_authoritative",
            Status = "pending", Payload = LifecyclePayload(outcome, actorId, [], metadata, now, root.Id),
            AvailableAt = now, CreatedAt = now, UpdatedAt = now
        };
        _db.EventDomainOutbox.Add(outbox);
        return outcome with { Outbox = outbox };
    }

    private async Task SynchronizeSeriesModerationQueueAsync(Event root, int[] eventIds, int actorId, string action, string? reason, CancellationToken ct)
    {
        if (action is not ("submit_for_review" or "publish" or "approve" or "reject")) return;
        var rows = await _db.ContentModerationQueue.IgnoreQueryFilters()
            .Where(x => x.TenantId == root.TenantId && x.ContentType == "event" && eventIds.Contains(x.ContentId))
            .OrderByDescending(x => x.ContentId == root.Id).ThenBy(x => x.Id).ToListAsync(ct);
        var now = DateTime.UtcNow;
        if (action == "submit_for_review")
        {
            var row = rows.FirstOrDefault(x => x.ContentId == root.Id) ?? new ContentModerationQueue
            {
                TenantId = root.TenantId, ContentType = "event", ContentId = root.Id, AuthorId = root.CreatedById, CreatedAt = now
            };
            if (row.Id == 0) _db.ContentModerationQueue.Add(row);
            row.AuthorId = root.CreatedById; row.Title = root.Title.Length <= 255 ? root.Title : root.Title[..255];
            row.Status = "pending"; row.ReviewerId = null; row.ReviewedAt = null; row.RejectionReason = null;
            row.AutoFlagged = false; row.FlagReason = null; row.UpdatedAt = now;
            _db.ContentModerationQueue.RemoveRange(rows.Where(x => x != row));
            return;
        }
        foreach (var row in rows)
        {
            row.Status = action == "reject" ? "rejected" : "approved"; row.ReviewerId = actorId;
            row.ReviewedAt = now; row.RejectionReason = action == "reject" ? reason : null; row.UpdatedAt = now;
        }
    }

    private static string LifecycleMetadata(bool publicationChanged, bool operationalChanged, Dictionary<string, int> cascade,
        object? series, bool notificationsSuppressed, string source)
        => JsonSerializer.Serialize(new
        {
            schema_version = 1,
            source,
            axes_changed = new[] { publicationChanged ? "publication" : null, operationalChanged ? "operational" : null }.Where(x => x is not null),
            cascade,
            series,
            notifications_suppressed = notificationsSuppressed
        });

    private static string LifecyclePayload(SeriesTransitionOutcome outcome, int actorId, IEnumerable<int> recipients,
        string metadata, DateTime occurredAt, int presentationEventId)
        => JsonSerializer.Serialize(new
        {
            schema_version = 1,
            tenant_id = outcome.Event.TenantId,
            event_id = outcome.Event.Id,
            actor_user_id = actorId,
            organizer_user_id = outcome.Event.CreatedById,
            affected_recipient_user_ids = recipients,
            presentation_event_id = presentationEventId,
            lifecycle_version = outcome.Event.LifecycleVersion,
            publication = new { from = outcome.FromPublication, to = outcome.Event.PublicationStatus },
            operational = new { from = outcome.FromOperational, to = outcome.Event.OperationalStatus },
            legacy_status = outcome.Event.Status,
            reason = outcome.Event.LifecycleReason,
            metadata = JsonSerializer.Deserialize<JsonElement>(metadata),
            occurred_at = occurredAt
        });

    private void AddNotification(int tenantId, int userId, string type, string title, int eventId, DateTime now) => _db.Notifications.Add(new Notification { TenantId = tenantId, UserId = userId, Type = type, Title = title, Link = $"/events/{eventId}", Data = JsonSerializer.Serialize(new { event_id = eventId }), CreatedAt = now });
    private async Task<bool> CanManageAsync(int tenantId, Event evt, User actor, bool isAdmin, CancellationToken ct)
    {
        if (evt.GroupId is int groupId)
        {
            var group = await _db.Groups.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == groupId, ct);
            if (group is null || !group.IsActive || group.Status != "active") return false;
            if (!isAdmin && group.CreatedById != actor.Id && !await _db.GroupMembers.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(x => x.TenantId == tenantId && x.GroupId == groupId && x.UserId == actor.Id && x.Status == "active", ct))
                return false;
        }

        if (isAdmin || evt.CreatedById == actor.Id) return true;
        return await _db.EventStaffAssignments.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
            x.TenantId == tenantId && x.EventId == evt.Id && x.UserId == actor.Id
            && x.Role == "co_organizer" && x.Status == "active"
            && (x.ExpiresAt == null || x.ExpiresAt > DateTime.UtcNow), ct);
    }

    private async Task<bool> ModerationRequiredAsync(int tenantId, CancellationToken ct)
    {
        var values = await _db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && (x.Key == "moderation.enabled" || x.Key == "moderation.require_event"))
            .ToDictionaryAsync(x => x.Key, x => x.Value, ct);
        return values.TryGetValue("moderation.enabled", out var enabled) && StoredBoolean(enabled)
            && values.TryGetValue("moderation.require_event", out var requireEvent) && StoredBoolean(requireEvent);
    }

    private async Task SynchronizeModerationQueueAsync(Event evt, int actorId, string action, string? reason, CancellationToken ct)
    {
        if (action is not ("submit_for_review" or "publish" or "approve" or "reject")) return;
        var rows = await _db.ContentModerationQueue.IgnoreQueryFilters()
            .Where(x => x.TenantId == evt.TenantId && x.ContentType == "event" && x.ContentId == evt.Id)
            .OrderBy(x => x.Id).ToListAsync(ct);
        var now = DateTime.UtcNow;
        if (action == "submit_for_review")
        {
            var row = rows.FirstOrDefault();
            if (row is null)
            {
                row = new ContentModerationQueue
                {
                    TenantId = evt.TenantId, ContentType = "event", ContentId = evt.Id,
                    AuthorId = evt.CreatedById, CreatedAt = now
                };
                _db.ContentModerationQueue.Add(row);
            }
            row.AuthorId = evt.CreatedById;
            row.Title = evt.Title.Length <= 255 ? evt.Title : evt.Title[..255];
            row.Status = "pending";
            row.ReviewerId = null;
            row.ReviewedAt = null;
            row.RejectionReason = null;
            row.AutoFlagged = false;
            row.FlagReason = null;
            row.UpdatedAt = now;
            if (rows.Count > 1) _db.ContentModerationQueue.RemoveRange(rows.Skip(1));
            return;
        }

        foreach (var row in rows)
        {
            row.Status = action == "reject" ? "rejected" : "approved";
            row.ReviewerId = actorId;
            row.ReviewedAt = now;
            row.RejectionReason = action == "reject" ? reason : null;
            row.UpdatedAt = now;
        }
    }

    private static bool IsAdmin(User actor) => actor.IsAdmin || actor.IsSuperAdmin || actor.IsTenantSuperAdmin || actor.IsGod
        || actor.Role is "admin" or "super_admin" or "tenant_admin" or "god";
    private static bool StoredBoolean(string? value) => value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    private static EventLifecycleResult Resolve(Event evt)
    {
        if (!Publications.Contains(evt.PublicationStatus) || !Operations.Contains(evt.OperationalStatus) || evt.Status != LegacyMirror(evt.PublicationStatus, evt.OperationalStatus)) return Conflict();
        return new(new { });
    }
    private static bool Compatible(string publication, string operational) => publication is not ("draft" or "pending_review") || operational == "scheduled";
    private static bool CanPublicationTransition(string from, string to) => from == to || from switch { "draft" => to is "pending_review" or "published" or "archived", "pending_review" => to is "draft" or "published" or "archived", "published" => to == "archived", "archived" => to == "draft", _ => false };
    private static bool CanOperationalTransition(string from, string to) => from == to || from switch { "scheduled" => to is "postponed" or "cancelled" or "completed", "postponed" => to is "scheduled" or "cancelled", "cancelled" => to == "scheduled", "completed" => false, _ => false };
    private static string LegacyMirror(string publication, string operational) => publication == "archived" ? "cancelled" : publication is "draft" or "pending_review" ? "draft" : operational switch { "scheduled" => "active", "postponed" or "cancelled" => "cancelled", "completed" => "completed", _ => throw new InvalidOperationException() };
    private static Dictionary<string, int> EmptyCascade() => new() { ["reminders_cancelled"] = 0, ["waitlist_cancelled"] = 0, ["registrations_cancelled"] = 0 };
    private static object Resource(Event evt, string action, bool changed, long? historyId, long? outboxId, Dictionary<string, int> cascade, object? series = null) => new { id = evt.Id, evt.Title, description = evt.Description, status = evt.Status, publication_state = evt.PublicationStatus, operational_state = evt.OperationalStatus, lifecycle_version = evt.LifecycleVersion, start_at = evt.StartsAt, end_at = evt.EndsAt, location = evt.Location, organizer = new { id = evt.CreatedById, display_name = (string?)null }, group = evt.GroupId is null ? (object?)null : new { id = evt.GroupId, name = (string?)null }, capacity = new { limit = evt.MaxAttendees, confirmed = 0, remaining = (int?)null, is_full = false }, moderation = new { submitted_at = evt.ModerationSubmittedAt, submitted_by = evt.ModerationSubmittedBy, decided_at = evt.ModeratedAt, decided_by = evt.ModeratedBy, reason = evt.ModerationReason }, lifecycle_reason = evt.LifecycleReason, created_at = evt.CreatedAt, updated_at = evt.UpdatedAt, transition = new { action, changed, history_id = historyId, outbox_id = outboxId, cascade, series } };
    private sealed record SeriesTransitionOutcome(
        Event Event,
        bool Changed,
        EventStatusHistory? History,
        EventDomainOutbox? Outbox,
        Dictionary<string, int> Cascade,
        HashSet<int> RecipientIds,
        bool PublicationChanged,
        bool OperationalChanged,
        bool Terminal,
        bool SyntheticRoot,
        string FromPublication,
        string FromOperational);
    private sealed record SeriesApplyResult(SeriesTransitionOutcome? Outcome, EventLifecycleError? Error);
    private static EventLifecycleResult Missing() => new(null, new("NOT_FOUND", "Event not found", 404));
    private static EventLifecycleResult Conflict() => new(null, new("EVENT_LIFECYCLE_CONFLICT", "Invalid event lifecycle transition", 409));
    private static EventLifecycleResult Invalid(string code, string message, string field) => new(null, new(code, message, 422, field));
}
