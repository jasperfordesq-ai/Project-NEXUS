// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventRecurrenceMaterializationSummary(
    int Examined,
    int Succeeded,
    int Failed,
    int Paused,
    int NotDue,
    int OccurrencesInserted,
    int OccurrencesReplayed,
    int Truncated);

/// <summary>Bounded, tenant-safe rolling materializer for v2 never-ending recurrence rules.</summary>
public sealed class EventRecurrenceMaterializationService(
    NexusDbContext db,
    EventRecurrenceDefinitionApplicationService definitions,
    IConfiguration configuration,
    ILogger<EventRecurrenceMaterializationService> logger)
{
    public async Task<EventRecurrenceMaterializationSummary> MaterializeDueAsync(int tenantId, DateTime asOfUtc, CancellationToken ct)
    {
        if (tenantId <= 0) throw new ArgumentOutOfRangeException(nameof(tenantId));
        asOfUtc = asOfUtc.Kind == DateTimeKind.Utc ? asOfUtc : asOfUtc.ToUniversalTime();
        var lookahead = Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:Materialization:LookaheadDays") ?? 365, 30, 3650);
        var margin = Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:Materialization:RefreshMarginDays") ?? 30, 1, lookahead - 1);
        var seriesLimit = Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:Materialization:SeriesLimit") ?? 50, 1, 500);
        var target = asOfUtc.AddDays(lookahead);
        var dueBefore = target.AddDays(-margin);
        var candidates = await db.EventRecurrenceRules.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RecurrenceEngine == EventRecurrenceService.Engine &&
                        x.RecurrenceEngineVersion == EventRecurrenceService.EngineVersion && x.EndsType == "never" &&
                        (x.MaterializationResumeAt != null || x.MaterializedThroughAt == null || x.MaterializedThroughAt < dueBefore))
            .Join(db.Events.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.IsRecurringTemplate &&
                    (x.PublicationStatus == "draft" || x.PublicationStatus == "published") && x.OperationalStatus == "scheduled"),
                rule => rule.EventId, root => root.Id, (rule, _) => new { rule.Id, rule.EventId })
            .OrderBy(x => x.Id).Take(seriesLimit).ToListAsync(ct);
        var examined = 0; var succeeded = 0; var failed = 0; var paused = 0; var notDue = 0;
        var inserted = 0; var replayed = 0; var truncated = 0;
        foreach (var candidate in candidates)
        {
            ct.ThrowIfCancellationRequested(); examined++;
            var result = await MaterializeRuleAsync(tenantId, candidate.EventId, candidate.Id, asOfUtc, target, dueBefore, ct);
            switch (result.Status) { case "succeeded": succeeded++; break; case "failed": failed++; break; case "paused": paused++; break; default: notDue++; break; }
            inserted += result.Inserted; replayed += result.Replayed; if (result.Truncated) truncated++;
        }
        return new(examined, succeeded, failed, paused, notDue, inserted, replayed, truncated);
    }

    private async Task<RuleResult> MaterializeRuleAsync(int tenantId, int rootId, long ruleId, DateTime asOfUtc, DateTime target, DateTime dueBefore, CancellationToken ct)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {rootId})", ct);
            var root = await db.Events.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == rootId, ct);
            var rule = await db.EventRecurrenceRules.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == ruleId && x.EventId == rootId, ct);
            if (root is null || rule is null || !root.IsRecurringTemplate || rule.EndsType != "never" ||
                root.RecurrenceEngine != EventRecurrenceService.Engine || root.RecurrenceEngineVersion != EventRecurrenceService.EngineVersion)
                throw new InvalidOperationException("event_recurrence_rule_invalid");
            if (root.PublicationStatus is not ("draft" or "published") || root.OperationalStatus != "scheduled")
            {
                await tx.CommitAsync(ct); return new("paused", 0, 0, false);
            }
            if (rule.MaterializationResumeAt is null && rule.MaterializedThroughAt is not null && rule.MaterializedThroughAt >= dueBefore)
            {
                await tx.CommitAsync(ct); return new("not_due", 0, 0, false);
            }
            rule.MaterializationLastAttemptedAt = asOfUtc;
            var actorId = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.IsActive && (x.Id == root.CreatedById || x.IsAdmin || x.IsSuperAdmin || x.IsTenantSuperAdmin || x.IsGod || x.Role == "admin" || x.Role == "super_admin" || x.Role == "tenant_admin" || x.Role == "god"))
                .OrderByDescending(x => x.Id == root.CreatedById).ThenBy(x => x.Id).Select(x => (int?)x.Id).FirstOrDefaultAsync(ct);
            if (actorId is null) throw new InvalidOperationException("event_recurrence_actor_unavailable");
            var limit = Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:Materialization:OccurrenceLimit") ?? 500, 1, 5000);
            var scanLimit = Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:Materialization:ScanLimit") ?? 20000, limit + 1, 100000);
            var startWindow = rule.MaterializationResumeAt ?? rule.MaterializedThroughAt?.AddTicks(1) ?? root.StartsAt;
            if (startWindow < root.StartsAt) startWindow = root.StartsAt;
            var horizonYears = Math.Clamp(configuration.GetValue<int?>("Events:Recurrence:MaxHorizonYears") ?? 20, 1, 50);
            var dates = ExpandWindow(root.StartsAt, root.Timezone, rule, startWindow, target, scanLimit, horizonYears);
            var isTruncated = dates.Count > limit;
            if (isTruncated) dates = dates.Take(limit).ToList();
            var existingIdList = await db.Events.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.ParentEventId == rootId && x.RecurrenceId != null)
                .Select(x => x.RecurrenceId!).ToListAsync(ct);
            var existingIds = existingIdList.ToHashSet(StringComparer.Ordinal);
            var revisions = await db.EventRecurrenceRevisions.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.RootEventId == rootId)
                .OrderBy(x => x.EffectiveFromRecurrenceId).ThenBy(x => x.RevisionVersion).ToListAsync(ct);
            var duration = root.EndsAt is null ? (TimeSpan?)null : root.EndsAt.Value - root.StartsAt;
            var inserted = 0; var replayed = 0;
            foreach (var date in dates)
            {
                var recurrenceId = date.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'");
                if (!existingIds.Add(recurrenceId)) { replayed++; continue; }
                var occurrence = EventRecurrenceService.CloneOccurrence(root, date, duration, asOfUtc);
                var revision = revisions.LastOrDefault(x => string.Compare(x.EffectiveFromRecurrenceId, recurrenceId, StringComparison.Ordinal) <= 0 &&
                    (x.EffectiveUntilRecurrenceId == null || string.Compare(x.EffectiveUntilRecurrenceId, recurrenceId, StringComparison.Ordinal) >= 0));
                if (revision is not null)
                {
                    var patch = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(revision.BlueprintPatch) ?? [];
                    EventRecurrenceService.ApplyPatch(occurrence, patch, []);
                }
                if (root.PublicationStatus == "published") CopyPublishedLifecycle(occurrence, actorId.Value, asOfUtc);
                db.Events.Add(occurrence);
                await db.SaveChangesAsync(ct);
                db.EventRecurrenceOccurrenceLedger.Add(new EventRecurrenceOccurrenceLedger
                {
                    TenantId = tenantId, RootEventId = rootId, EventId = occurrence.Id, RecurrenceId = recurrenceId,
                    OccurrenceKey = occurrence.OccurrenceKey!, State = "materialized", StateVersion = 1,
                    RevisionVersion = revision?.RevisionVersion, StartTimeUtc = occurrence.StartsAt, EndTimeUtc = occurrence.EndsAt,
                    ActorUserId = actorId, Metadata = JsonSerializer.Serialize(new { source = "rolling_recurrence", rule_version = rule.EffectiveRevisionVersion }), CreatedAt = asOfUtc
                });
                await definitions.ApplyAsync(tenantId, root, occurrence, actorId.Value, ct);
                if (root.PublicationStatus == "published") AddPublishedEvidence(tenantId, root, occurrence, actorId.Value, asOfUtc);
                await db.SaveChangesAsync(ct);
                inserted++;
            }
            rule.MaterializedSetVersion += inserted > 0 ? 1 : 0;
            rule.MaterializedThroughAt = isTruncated && dates.Count > 0 ? dates[^1] : target;
            rule.MaterializationResumeAt = isTruncated && dates.Count > 0 ? dates[^1].AddTicks(1) : null;
            rule.MaterializationTruncated = isTruncated;
            rule.MaterializationLastSucceededAt = asOfUtc;
            rule.MaterializationLastFailedAt = null;
            rule.MaterializationErrorCode = null;
            rule.UpdatedAt = asOfUtc;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new("succeeded", inserted, replayed, isTruncated);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Event recurrence materialization failed for tenant {TenantId}, root {RootId}", tenantId, rootId);
            db.ChangeTracker.Clear();
            try
            {
                var failedRule = await db.EventRecurrenceRules.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == ruleId, ct);
                if (failedRule is not null)
                {
                    failedRule.MaterializationLastAttemptedAt = asOfUtc; failedRule.MaterializationLastFailedAt = asOfUtc;
                    failedRule.MaterializationErrorCode = exception.Message.Length <= 64 ? exception.Message : "event_recurrence_materialization_failed";
                    await db.SaveChangesAsync(ct);
                }
            }
            catch (Exception persistenceException) when (persistenceException is not OperationCanceledException)
            {
                logger.LogWarning(persistenceException, "Could not persist recurrence materialization failure for rule {RuleId}", ruleId);
            }
            return new("failed", 0, 0, false);
        }
    }

    private static List<DateTime> ExpandWindow(DateTime rootStart, string timezone, EventRecurrenceRule rule, DateTime windowStart, DateTime target, int scanLimit, int horizonYears)
    {
        var generated = EventRecurrenceService.GenerateCanonicalRule(rootStart, timezone, rule.RRule, scanLimit, horizonYears);
        var excluded = ReadDates(rule.ExDates);
        var additions = ReadDates(rule.RDates);
        return generated.Concat(additions).Select(x => x.ToUniversalTime()).Where(x => x >= windowStart && x <= target && !excluded.Contains(x))
            .Distinct().OrderBy(x => x).ToList();
    }
    private static HashSet<DateTime> ReadDates(string json)
    {
        try { return (JsonSerializer.Deserialize<string[]>(json) ?? []).Select(x => DateTimeOffset.Parse(x).UtcDateTime).ToHashSet(); }
        catch { return []; }
    }
    private static void CopyPublishedLifecycle(Event occurrence, int actorId, DateTime now)
    {
        occurrence.PublicationStatus = "published"; occurrence.Status = "active"; occurrence.OperationalStatus = "scheduled";
        occurrence.LifecycleVersion = 1; occurrence.PublicationStatusChangedAt = now; occurrence.PublicationStatusChangedBy = actorId;
    }
    private void AddPublishedEvidence(int tenantId, Event root, Event occurrence, int actorId, DateTime now)
    {
        var metadata = JsonSerializer.Serialize(new { schema_version = 1, source = "event_lifecycle_service", series = new { root_event_id = root.Id }, notifications_suppressed = true, materialization = new { source = "rolling_recurrence", recurrence_id = occurrence.RecurrenceId } });
        db.EventStatusHistories.Add(new EventStatusHistory { TenantId = tenantId, EventId = occurrence.Id, ActorUserId = actorId, LifecycleVersion = 1, FromPublicationStatus = "draft", ToPublicationStatus = "published", FromOperationalStatus = "scheduled", ToOperationalStatus = "scheduled", FromLegacyStatus = "draft", ToLegacyStatus = "active", Metadata = metadata, CreatedAt = now });
        db.EventDomainOutbox.Add(new EventDomainOutbox { TenantId = tenantId, EventId = occurrence.Id, AggregateStream = "lifecycle", AggregateVersion = 1, IdempotencyKey = $"event:{tenantId}:{occurrence.Id}:lifecycle:v1", Payload = JsonSerializer.Serialize(new { schema_version = 1, tenant_id = tenantId, event_id = occurrence.Id, actor_user_id = actorId, organizer_user_id = root.CreatedById, affected_recipient_user_ids = Array.Empty<int>(), lifecycle_version = 1, publication = new { from = "draft", to = "published" }, operational = new { from = "scheduled", to = "scheduled" }, legacy_status = "active", metadata, occurred_at = now }), AvailableAt = now, ProcessedAt = now, CreatedAt = now, UpdatedAt = now });
    }
    private sealed record RuleResult(string Status, int Inserted, int Replayed, bool Truncated);
}
