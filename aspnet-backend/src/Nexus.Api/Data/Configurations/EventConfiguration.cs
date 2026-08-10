// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for event entities:
/// Event, EventRsvp, EventReminder.
/// </summary>
public class EventConfiguration : TenantScopedConfiguration
{
    public EventConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Event configuration with tenant filter
        modelBuilder.Entity<Event>(entity =>
        {
            entity.ToTable("events");
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnType("text");
            entity.Property(e => e.Location).HasMaxLength(500);
            entity.Property(e => e.ImageUrl).HasMaxLength(500);
            entity.Property(e => e.Status).HasMaxLength(32);
            entity.Property(e => e.PublicationStatus).HasMaxLength(32);
            entity.Property(e => e.OperationalStatus).HasMaxLength(32);
            entity.Property(e => e.Timezone).HasMaxLength(64);
            entity.Property(e => e.FederatedVisibility).HasMaxLength(16);
            entity.Property(e => e.FederationVersion).HasDefaultValue(1L);
            entity.Property(e => e.OccurrenceKey).HasMaxLength(191);
            entity.Property(e => e.RecurrenceEngine).HasMaxLength(32);
            entity.Property(e => e.RecurrenceEngineVersion).HasMaxLength(32);
            entity.Property(e => e.RecurrenceId).HasMaxLength(32);
            entity.Property(e => e.RecurrenceOverrideFields).HasColumnType("jsonb");
            entity.Property(e => e.OnlineLink).HasMaxLength(512);
            entity.Property(e => e.VideoUrl).HasMaxLength(512);
            entity.Property(e => e.AccessibilityParkingDetails).HasMaxLength(1000);
            entity.Property(e => e.AccessibilityTransitDetails).HasMaxLength(1000);
            entity.Property(e => e.AccessibilityAssistanceContact).HasMaxLength(500);
            entity.Property(e => e.AccessibilityNotes).HasMaxLength(4000);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.CreatedById);
            entity.HasIndex(e => e.GroupId);
            entity.HasIndex(e => e.StartsAt);
            entity.HasIndex(e => e.IsCancelled);
            entity.HasIndex(e => new { e.TenantId, e.PublicationStatus, e.OperationalStatus, e.StartsAt, e.Id })
                .HasDatabaseName("idx_events_tenant_lifecycle_start");
            entity.HasIndex(e => new { e.TenantId, e.ParentEventId, e.RecurrenceId }).IsUnique()
                .HasFilter("\"RecurrenceId\" IS NOT NULL").HasDatabaseName("uq_events_tenant_parent_recurrence_id");
            entity.HasIndex(e => new { e.TenantId, e.ParentEventId, e.IsRecurrenceException })
                .HasDatabaseName("idx_events_recurrence_exception");

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.CreatedBy)
                .WithMany()
                .HasForeignKey(e => e.CreatedById)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Group)
                .WithMany(g => g.Events)
                .HasForeignKey(e => e.GroupId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.ParentEventId)
                .OnDelete(DeleteBehavior.Restrict);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // EventRsvp configuration with tenant filter
        modelBuilder.Entity<EventRsvp>(entity =>
        {
            entity.ToTable("event_rsvps");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired();

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.EventId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.RespondedAt);
            // Unique constraint: one RSVP per user per event
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.UserId }).IsUnique();

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Event)
                .WithMany(ev => ev.Rsvps)
                .HasForeignKey(e => e.EventId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // EventReminder
        modelBuilder.Entity<EventReminder>(entity =>
        {
            entity.ToTable("event_reminders");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ReminderType).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(32).IsRequired();
            entity.HasIndex(e => new { e.EventId, e.UserId }).IsUnique();
            entity.HasOne(e => e.Event).WithMany().HasForeignKey(e => e.EventId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EventStatusHistory>(entity =>
        {
            entity.ToTable("event_status_history");
            entity.Property(e => e.FromPublicationStatus).HasMaxLength(32);
            entity.Property(e => e.ToPublicationStatus).HasMaxLength(32);
            entity.Property(e => e.FromOperationalStatus).HasMaxLength(32);
            entity.Property(e => e.ToOperationalStatus).HasMaxLength(32);
            entity.Property(e => e.FromLegacyStatus).HasMaxLength(32);
            entity.Property(e => e.ToLegacyStatus).HasMaxLength(32);
            entity.Property(e => e.Metadata).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.LifecycleVersion })
                .IsUnique().HasDatabaseName("uq_event_status_history_version");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.CreatedAt, e.Id })
                .HasDatabaseName("idx_event_status_history_event");
            entity.HasIndex(e => new { e.TenantId, e.ActorUserId, e.CreatedAt })
                .HasDatabaseName("idx_event_status_history_actor");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EventDomainOutbox>(entity =>
        {
            entity.ToTable("event_domain_outbox");
            entity.Property(e => e.AggregateStream).HasMaxLength(191);
            entity.Property(e => e.Action).HasMaxLength(80);
            entity.Property(e => e.IdempotencyKey).HasMaxLength(191);
            entity.Property(e => e.ProductionMode).HasMaxLength(32);
            entity.Property(e => e.Status).HasMaxLength(32);
            entity.Property(e => e.Payload).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey }).IsUnique()
                .HasDatabaseName("uq_event_outbox_tenant_key");
            entity.HasIndex(e => new { e.Status, e.AvailableAt, e.NextAttemptAt, e.Id })
                .HasDatabaseName("idx_event_outbox_claim");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.AggregateVersion })
                .HasDatabaseName("idx_event_outbox_aggregate");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.AggregateStream, e.AggregateVersion, e.Id })
                .HasDatabaseName("idx_event_outbox_stream");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<ContentModerationQueue>(entity =>
        {
            entity.ToTable("content_moderation_queue");
            entity.Property(e => e.ContentType).HasMaxLength(32).IsRequired();
            entity.Property(e => e.Title).HasMaxLength(255);
            entity.Property(e => e.Status).HasMaxLength(32).IsRequired();
            entity.Property(e => e.RejectionReason).HasColumnType("text");
            entity.Property(e => e.FlagReason).HasMaxLength(255);
            entity.HasIndex(e => new { e.TenantId, e.Status }).HasDatabaseName("idx_content_moderation_tenant_status");
            entity.HasIndex(e => new { e.TenantId, e.ContentType, e.Status }).HasDatabaseName("idx_content_moderation_tenant_type_status");
            entity.HasIndex(e => new { e.ContentType, e.ContentId }).HasDatabaseName("idx_content_moderation_content");
            entity.HasIndex(e => new { e.TenantId, e.AuthorId }).HasDatabaseName("idx_content_moderation_author");
            entity.HasIndex(e => e.ReviewerId).HasDatabaseName("idx_content_moderation_reviewer");
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt }).HasDatabaseName("idx_content_moderation_created");
            entity.HasIndex(e => new { e.TenantId, e.ContentType, e.ContentId }).IsUnique()
                .HasDatabaseName("uq_content_moderation_subject");
            entity.HasOne<Tenant>().WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<User>().WithMany().HasForeignKey(e => e.AuthorId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(e => e.ReviewerId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
            entity.ToTable(t =>
            {
                t.HasCheckConstraint("ck_content_moderation_type", "\"ContentType\" IN ('post','listing','event','comment','group')");
                t.HasCheckConstraint("ck_content_moderation_status", "\"Status\" IN ('pending','approved','rejected','flagged')");
            });
        });

        modelBuilder.Entity<EventRecurrenceRule>(entity =>
        {
            entity.ToTable("event_recurrence_rules");
            entity.Property(e => e.Frequency).HasMaxLength(16);
            entity.Property(e => e.DaysOfWeek).HasMaxLength(64);
            entity.Property(e => e.EndsType).HasMaxLength(16);
            entity.Property(e => e.RRule).HasMaxLength(2048);
            entity.Property(e => e.ExDates).HasColumnType("jsonb");
            entity.Property(e => e.RDates).HasColumnType("jsonb");
            entity.Property(e => e.RecurrenceEngine).HasMaxLength(32);
            entity.Property(e => e.RecurrenceEngineVersion).HasMaxLength(32);
            entity.Property(e => e.RuleHash).HasMaxLength(64);
            entity.Property(e => e.MaterializationErrorCode).HasMaxLength(64);
            entity.HasIndex(e => new { e.TenantId, e.EventId }).IsUnique().HasDatabaseName("uq_event_recurrence_rule_tenant_event");
            entity.HasIndex(e => new { e.TenantId, e.RecurrenceEngine, e.EndsType, e.MaterializedThroughAt }).HasDatabaseName("idx_event_recurrence_materialization_due");
            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.EventId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EventRecurrenceRevision>(entity =>
        {
            entity.ToTable("event_recurrence_revisions");
            entity.Property(e => e.EffectiveFromRecurrenceId).HasMaxLength(32);
            entity.Property(e => e.EffectiveUntilRecurrenceId).HasMaxLength(32);
            entity.Property(e => e.CanonicalTimezone).HasMaxLength(64);
            entity.Property(e => e.CanonicalRRule).HasMaxLength(2048);
            entity.Property(e => e.RuleHash).HasMaxLength(64);
            entity.Property(e => e.BlueprintPatch).HasColumnType("jsonb");
            entity.Property(e => e.PatchHash).HasMaxLength(64);
            entity.Property(e => e.MaterializedChecksumBefore).HasMaxLength(64);
            entity.Property(e => e.MaterializedChecksumAfter).HasMaxLength(64);
            entity.Property(e => e.IdempotencyHash).HasMaxLength(64);
            entity.Property(e => e.RequestHash).HasMaxLength(64);
            entity.Property(e => e.ImpactSummary).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.RevisionVersion }).IsUnique().HasDatabaseName("uq_event_recur_revision_version");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.IdempotencyHash }).IsUnique().HasDatabaseName("uq_event_recur_revision_idempotency");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.EffectiveFromRecurrenceId, e.RevisionVersion }).HasDatabaseName("idx_event_recur_revision_effective");
            entity.HasIndex(e => new { e.TenantId, e.ActorUserId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_recur_revision_actor");
            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.RootEventId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EventRecurrenceOccurrenceLedger>(entity =>
        {
            entity.ToTable("event_recurrence_occurrence_ledger");
            entity.Property(e => e.RecurrenceId).HasMaxLength(32);
            entity.Property(e => e.OccurrenceKey).HasMaxLength(191);
            entity.Property(e => e.State).HasMaxLength(32);
            entity.Property(e => e.Metadata).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.EventId, e.StateVersion }).IsUnique().HasDatabaseName("uq_event_recur_occ_ledger_event_version");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.RecurrenceId, e.StateVersion }).IsUnique().HasDatabaseName("uq_event_recur_occ_ledger_identity_version");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.RecurrenceId, e.Id }).HasDatabaseName("idx_event_recur_occ_ledger_effective");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.State, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_recur_occ_ledger_state");
            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.RootEventId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.EventId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EventRecurrenceDefinitionBlueprint>(entity =>
        {
            entity.ToTable("event_recurrence_definition_blueprints");
            entity.Property(e => e.SourceRecurrenceId).HasMaxLength(32);
            entity.Property(e => e.SourceOccurrenceKey).HasMaxLength(191);
            entity.Property(e => e.EffectiveFromRecurrenceId).HasMaxLength(32);
            entity.Property(e => e.SelectedSections).HasColumnType("jsonb");
            entity.Property(e => e.Manifest).HasColumnType("jsonb");
            entity.Property(e => e.ManifestHash).HasMaxLength(64);
            entity.Property(e => e.IdempotencyHash).HasMaxLength(64);
            entity.Property(e => e.RequestHash).HasMaxLength(64);
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.BlueprintVersion }).IsUnique().HasDatabaseName("uq_ev_rec_def_bp_version");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.IdempotencyHash }).IsUnique().HasDatabaseName("uq_ev_rec_def_bp_idempotency");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.EffectiveFromRecurrenceId, e.BlueprintVersion }).HasDatabaseName("idx_ev_rec_def_bp_effective");
            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.RootEventId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.SourceEventId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EventRecurrenceDefinitionApplication>(entity =>
        {
            entity.ToTable("event_recurrence_definition_applications");
            entity.Property(e => e.RecurrenceId).HasMaxLength(32);
            entity.Property(e => e.ManifestHash).HasMaxLength(64);
            entity.Property(e => e.ApplicationHash).HasMaxLength(64);
            entity.Property(e => e.AppliedCounts).HasColumnType("jsonb");
            entity.Property(e => e.Status).HasMaxLength(16);
            entity.HasIndex(e => new { e.TenantId, e.EventId }).IsUnique().HasDatabaseName("uq_ev_rec_def_app_event");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.RecurrenceId }).IsUnique().HasDatabaseName("uq_ev_rec_def_app_recurrence");
            entity.HasIndex(e => new { e.TenantId, e.RootEventId, e.BlueprintVersion, e.CreatedAt }).HasDatabaseName("idx_ev_rec_def_app_root");
            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.RootEventId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Event>().WithMany().HasForeignKey(e => e.EventId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<EventRecurrenceDefinitionBlueprint>().WithMany().HasForeignKey(e => e.BlueprintId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EventNotificationDelivery>(entity =>
        {
            entity.ToTable("event_notification_deliveries");
            entity.Property(e => e.ExternalRecipientHash).HasMaxLength(64).IsFixedLength();
            entity.Property(e => e.Channel).HasMaxLength(32);
            entity.Property(e => e.DeliveryKey).HasMaxLength(191);
            entity.Property(e => e.Status).HasMaxLength(32);
            entity.Property(e => e.PreferenceReason).HasMaxLength(100);
            entity.Property(e => e.SuppressionReason).HasMaxLength(191);
            entity.Property(e => e.Provider).HasMaxLength(50);
            entity.Property(e => e.ProviderEvidenceId).HasMaxLength(255);
            entity.HasIndex(e => new { e.TenantId, e.DeliveryKey }).IsUnique()
                .HasDatabaseName("uq_event_notification_delivery_key");
            entity.HasIndex(e => new { e.OutboxId, e.RecipientUserId, e.Channel }).IsUnique()
                .HasFilter("\"RecipientUserId\" IS NOT NULL")
                .HasDatabaseName("uq_event_notification_delivery_member");
            entity.HasIndex(e => new { e.OutboxId, e.ExternalRecipientHash, e.Channel }).IsUnique()
                .HasFilter("\"ExternalRecipientHash\" IS NOT NULL")
                .HasDatabaseName("uq_event_notification_delivery_external");
            entity.HasIndex(e => new { e.Status, e.NextAttemptAt, e.Id })
                .HasDatabaseName("idx_event_notification_delivery_claim");
            entity.HasOne<EventDomainOutbox>().WithMany().HasForeignKey(e => e.OutboxId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
            entity.ToTable(t =>
            {
                t.HasCheckConstraint("ck_event_notification_delivery_recipient", "(\"RecipientUserId\" IS NOT NULL) <> (\"ExternalRecipientHash\" IS NOT NULL)");
                t.HasCheckConstraint("ck_event_notification_delivery_external_hash", "\"ExternalRecipientHash\" IS NULL OR \"ExternalRecipientHash\" ~ '^[0-9a-f]{64}$'");
            });
        });

        modelBuilder.Entity<EventTemplate>(entity =>
        {
            entity.ToTable("event_templates"); entity.Property(e => e.Status).HasMaxLength(16); entity.Property(e => e.ArchiveReason).HasMaxLength(500);
            entity.HasIndex(e => e.PublicId).IsUnique().HasDatabaseName("uq_event_template_public");
            entity.HasIndex(e => new { e.TenantId, e.Id }).IsUnique().HasDatabaseName("uq_event_template_tenant_id");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.UpdatedAt, e.Id }).HasDatabaseName("idx_event_template_status");
            entity.HasIndex(e => new { e.TenantId, e.SourceEventId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_template_source");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventTemplateVersion>(entity =>
        {
            entity.ToTable("event_template_versions"); entity.Property(e => e.Payload).HasColumnType("jsonb"); entity.Property(e => e.CopiedFields).HasColumnType("jsonb"); entity.Property(e => e.SkippedFields).HasColumnType("jsonb");
            foreach (var property in new[] { nameof(EventTemplateVersion.PayloadHash), nameof(EventTemplateVersion.CaptureIdempotencyHash), nameof(EventTemplateVersion.CaptureRequestHash) }) entity.Property(property).HasMaxLength(64).IsFixedLength();
            entity.HasIndex(e => new { e.TenantId, e.TemplateId, e.VersionNumber }).IsUnique().HasDatabaseName("uq_event_template_version");
            entity.HasIndex(e => new { e.TenantId, e.CaptureIdempotencyHash }).IsUnique().HasDatabaseName("uq_event_template_capture_key");
            entity.HasIndex(e => new { e.TenantId, e.TemplateId, e.Id, e.VersionNumber, e.SourceEventId }).IsUnique().HasDatabaseName("uq_event_template_version_provenance");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventTemplateMaterialization>(entity =>
        {
            entity.ToTable("event_template_materializations"); entity.Property(e => e.ScheduleTimezone).HasMaxLength(64); entity.Property(e => e.OverrideFields).HasColumnType("jsonb");
            foreach (var property in new[] { nameof(EventTemplateMaterialization.TemplatePayloadHash), nameof(EventTemplateMaterialization.EffectivePayloadHash), nameof(EventTemplateMaterialization.IdempotencyHash), nameof(EventTemplateMaterialization.RequestHash) }) entity.Property(property).HasMaxLength(64).IsFixedLength();
            entity.HasIndex(e => new { e.TenantId, e.IdempotencyHash }).IsUnique().HasDatabaseName("uq_event_template_materialize_key");
            entity.HasIndex(e => new { e.TenantId, e.CreatedEventId }).IsUnique().HasDatabaseName("uq_event_template_materialized_event");
            entity.HasIndex(e => new { e.TenantId, e.TemplateId, e.TemplateVersionNumber, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_template_materialized_version");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventTemplateAudit>(entity =>
        {
            entity.ToTable("event_template_audit"); entity.Property(e => e.Action).HasMaxLength(24); entity.Property(e => e.Metadata).HasColumnType("jsonb"); entity.Property(e => e.IdempotencyHash).HasMaxLength(64).IsFixedLength(); entity.Property(e => e.RequestHash).HasMaxLength(64).IsFixedLength();
            entity.HasIndex(e => new { e.TenantId, e.IdempotencyHash }).IsUnique().HasDatabaseName("uq_event_template_audit_key");
            entity.HasIndex(e => new { e.TenantId, e.TemplateId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_template_audit_template");
            entity.HasIndex(e => new { e.TenantId, e.SourceEventId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_template_audit_source");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<EventRegistration>(entity =>
        {
            entity.ToTable("event_registrations"); entity.Property(e => e.RegistrationState).HasMaxLength(32); entity.Property(e => e.CapacityPoolKey).HasMaxLength(100); entity.Property(e => e.AllocationKey).HasMaxLength(191);
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.UserId, e.CapacityPoolKey }).IsUnique().HasDatabaseName("uq_event_registration_subject");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.CapacityPoolKey, e.RegistrationState, e.Id }).HasDatabaseName("idx_event_registration_capacity");
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.RegistrationState, e.EventId }).HasDatabaseName("idx_event_registration_user");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventRegistrationHistory>(entity =>
        {
            entity.ToTable("event_registration_history"); entity.Property(e => e.CapacityPoolKey).HasMaxLength(100); entity.Property(e => e.AllocationKey).HasMaxLength(191); entity.Property(e => e.Action).HasMaxLength(64); entity.Property(e => e.FromState).HasMaxLength(32); entity.Property(e => e.ToState).HasMaxLength(32); entity.Property(e => e.IdempotencyKey).HasMaxLength(191); entity.Property(e => e.Reason).HasColumnType("text"); entity.Property(e => e.Metadata).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.RegistrationId, e.RegistrationVersion }).IsUnique().HasDatabaseName("uq_event_registration_history_version"); entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey }).IsUnique().HasDatabaseName("uq_event_registration_history_key"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.CapacityPoolKey, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_registration_history_event"); entity.HasIndex(e => new { e.TenantId, e.UserId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_registration_history_user");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventWaitlistEntry>(entity =>
        {
            entity.ToTable("event_waitlist_entries"); entity.Property(e => e.QueueState).HasMaxLength(32); entity.Property(e => e.CapacityPoolKey).HasMaxLength(100); entity.Property(e => e.AllocationKey).HasMaxLength(191); entity.Property(e => e.OfferTokenHash).HasMaxLength(64).IsFixedLength();
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.UserId, e.CapacityPoolKey }).IsUnique().HasDatabaseName("uq_event_waitlist_entry_subject"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.CapacityPoolKey, e.QueueSequence }).IsUnique().HasDatabaseName("uq_event_waitlist_entry_sequence"); entity.HasIndex(e => e.OfferTokenHash).IsUnique().HasDatabaseName("uq_event_waitlist_offer_token");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.CapacityPoolKey, e.QueueState, e.QueueSequence, e.Id }).HasDatabaseName("idx_event_waitlist_queue"); entity.HasIndex(e => new { e.QueueState, e.OfferExpiresAt, e.Id }).HasDatabaseName("idx_event_waitlist_expiry"); entity.HasIndex(e => new { e.TenantId, e.UserId, e.QueueState, e.EventId }).HasDatabaseName("idx_event_waitlist_user");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventWaitlistEntryHistory>(entity =>
        {
            entity.ToTable("event_waitlist_entry_history"); entity.Property(e => e.CapacityPoolKey).HasMaxLength(100); entity.Property(e => e.AllocationKey).HasMaxLength(191); entity.Property(e => e.Action).HasMaxLength(64); entity.Property(e => e.FromState).HasMaxLength(32); entity.Property(e => e.ToState).HasMaxLength(32); entity.Property(e => e.IdempotencyKey).HasMaxLength(191); entity.Property(e => e.Reason).HasColumnType("text"); entity.Property(e => e.Metadata).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.WaitlistEntryId, e.QueueVersion }).IsUnique().HasDatabaseName("uq_event_waitlist_history_version"); entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey }).IsUnique().HasDatabaseName("uq_event_waitlist_history_key"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.CapacityPoolKey, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_waitlist_history_event"); entity.HasIndex(e => new { e.TenantId, e.UserId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_waitlist_history_user");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventAttendance>(entity =>
        {
            entity.ToTable("event_attendance"); entity.Property(e => e.AttendanceStatus).HasMaxLength(32); entity.Property(e => e.HoursCredited).HasPrecision(10, 2); entity.Property(e => e.Notes).HasColumnType("text");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.UserId }).IsUnique().HasDatabaseName("uq_event_attendance_user");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.AttendanceStatus, e.Id }).HasDatabaseName("idx_event_attendance_tenant_event_status");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventAttendanceActivity>(entity =>
        {
            entity.ToTable("event_attendance_activity"); entity.Property(e => e.Action).HasMaxLength(50); entity.Property(e => e.FromStatus).HasMaxLength(32); entity.Property(e => e.ToStatus).HasMaxLength(32); entity.Property(e => e.IdempotencyKey).HasMaxLength(191); entity.Property(e => e.Reason).HasColumnType("text"); entity.Property(e => e.Metadata).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey }).IsUnique().HasDatabaseName("uq_event_attendance_activity_key"); entity.HasIndex(e => new { e.TenantId, e.AttendanceId, e.AttendanceVersion }).IsUnique().HasDatabaseName("uq_event_attendance_activity_version"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_attendance_activity_event"); entity.HasIndex(e => new { e.TenantId, e.UserId, e.CreatedAt }).HasDatabaseName("idx_event_attendance_activity_user");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventBroadcast>(entity =>
        {
            entity.ToTable("event_broadcasts"); entity.Property(e => e.Variant).HasMaxLength(32); entity.Property(e => e.Status).HasMaxLength(16);
            entity.Property(e => e.AudienceSegments).HasColumnType("jsonb"); entity.Property(e => e.Channels).HasColumnType("jsonb"); entity.Property(e => e.Body).HasColumnType("text"); entity.Property(e => e.ContentHash).HasMaxLength(64).IsFixedLength(); entity.Property(e => e.FailureCode).HasMaxLength(100);
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.Id }).IsUnique().HasDatabaseName("uq_event_broadcast_scope_id");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.Status, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_broadcast_event_status");
            entity.HasIndex(e => new { e.Status, e.ScheduledAt, e.Id }).HasDatabaseName("idx_event_broadcast_schedule");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventBroadcastHistory>(entity =>
        {
            entity.ToTable("event_broadcast_history"); entity.Property(e => e.Action).HasMaxLength(16); entity.Property(e => e.FromStatus).HasMaxLength(16); entity.Property(e => e.ToStatus).HasMaxLength(16); entity.Property(e => e.Metadata).HasColumnType("jsonb");
            foreach (var p in new[] { nameof(EventBroadcastHistory.IdempotencyHash), nameof(EventBroadcastHistory.RequestHash), nameof(EventBroadcastHistory.ContentHash) }) entity.Property(p).HasMaxLength(64).IsFixedLength();
            entity.HasIndex(e => new { e.TenantId, e.BroadcastId, e.BroadcastVersion }).IsUnique().HasDatabaseName("uq_event_broadcast_history_version"); entity.HasIndex(e => new { e.TenantId, e.IdempotencyHash }).IsUnique().HasDatabaseName("uq_event_broadcast_history_key"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.BroadcastId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_broadcast_history_event");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventBroadcastDelivery>(entity =>
        {
            entity.ToTable("event_broadcast_deliveries"); entity.Property(e => e.Channel).HasMaxLength(16); entity.Property(e => e.DeliveryKey).HasMaxLength(64).IsFixedLength(); entity.Property(e => e.Status).HasMaxLength(16); entity.Property(e => e.ClaimToken).HasMaxLength(36); entity.Property(e => e.PreferenceReason).HasMaxLength(100); entity.Property(e => e.SuppressionReason).HasMaxLength(100); entity.Property(e => e.Provider).HasMaxLength(50); entity.Property(e => e.ProviderEvidenceId).HasMaxLength(255); entity.Property(e => e.LastErrorCode).HasMaxLength(100);
            entity.HasIndex(e => new { e.TenantId, e.DeliveryKey }).IsUnique().HasDatabaseName("uq_event_broadcast_delivery_key"); entity.HasIndex(e => new { e.BroadcastId, e.RecipientUserId, e.Channel }).IsUnique().HasDatabaseName("uq_event_broadcast_recipient_channel"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.BroadcastId, e.Id }).IsUnique().HasDatabaseName("uq_event_broadcast_delivery_scope"); entity.HasIndex(e => new { e.Status, e.AvailableAt, e.NextAttemptAt, e.Id }).HasDatabaseName("idx_event_broadcast_delivery_claim"); entity.HasIndex(e => new { e.TenantId, e.BroadcastId, e.Status, e.Id }).HasDatabaseName("idx_event_broadcast_delivery_status");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventBroadcastDeliveryAttempt>(entity =>
        {
            entity.ToTable("event_broadcast_delivery_attempts"); entity.Property(e => e.Outcome).HasMaxLength(16); entity.Property(e => e.Provider).HasMaxLength(50); entity.Property(e => e.ProviderEvidenceId).HasMaxLength(255); entity.Property(e => e.ReasonCode).HasMaxLength(100); entity.Property(e => e.Metadata).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.DeliveryId, e.AttemptNumber, e.Outcome }).IsUnique().HasDatabaseName("uq_event_broadcast_attempt_outcome"); entity.HasIndex(e => new { e.TenantId, e.BroadcastId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_broadcast_attempt_parent");
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventSession>(entity =>
        {
            entity.ToTable("event_sessions"); entity.Property(e => e.Title).HasMaxLength(191); entity.Property(e => e.Description).HasColumnType("text"); entity.Property(e => e.SessionType).HasMaxLength(32); entity.Property(e => e.Visibility).HasMaxLength(24); entity.Property(e => e.Status).HasMaxLength(16); entity.Property(e => e.Timezone).HasMaxLength(64); entity.Property(e => e.TrackName).HasMaxLength(120); entity.Property(e => e.RoomName).HasMaxLength(120); entity.Property(e => e.RoomKey).HasMaxLength(64).IsFixedLength(); entity.Property(e => e.CancellationReason).HasMaxLength(500);
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.Status, e.StartsAtUtc, e.Position, e.Id }).HasDatabaseName("idx_event_sessions_event_time"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.RoomKey, e.Status, e.StartsAtUtc, e.EndsAtUtc }).HasDatabaseName("idx_event_sessions_room_time"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.Id }).IsUnique().HasDatabaseName("uq_event_sessions_tenant_event_id");
            entity.HasMany(e => e.Speakers).WithOne().HasForeignKey(e => e.SessionId).OnDelete(DeleteBehavior.Restrict); entity.HasMany(e => e.Resources).WithOne().HasForeignKey(e => e.SessionId).OnDelete(DeleteBehavior.Restrict); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventSessionSpeaker>(entity => { entity.ToTable("event_session_speakers"); entity.Property(e => e.DisplayName).HasMaxLength(191); entity.Property(e => e.RoleLabel).HasMaxLength(120); entity.HasIndex(e => new { e.TenantId, e.SessionId, e.UserId }).IsUnique().HasDatabaseName("uq_event_session_speaker_member"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.SessionId, e.Position, e.Id }).HasDatabaseName("idx_event_session_speakers_order"); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventSessionResource>(entity => { entity.ToTable("event_session_resources"); entity.Property(e => e.ResourceType).HasMaxLength(24); entity.Property(e => e.Visibility).HasMaxLength(24); entity.Property(e => e.Title).HasMaxLength(191); entity.Property(e => e.UrlCiphertext).HasColumnType("text"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.SessionId, e.Position, e.Id }).HasDatabaseName("idx_ev_session_resources_order"); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventSessionHistory>(entity => { entity.ToTable("event_session_history"); entity.Property(e => e.Action).HasMaxLength(32); entity.Property(e => e.IdempotencyKey).HasMaxLength(191); entity.Property(e => e.RequestHash).HasMaxLength(64).IsFixedLength(); entity.Property(e => e.ChangedFields).HasColumnType("jsonb"); entity.Property(e => e.AffectedSessionIds).HasColumnType("jsonb"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.AgendaVersion }).IsUnique().HasDatabaseName("uq_event_session_history_version"); entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey }).IsUnique().HasDatabaseName("uq_event_session_history_key"); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventSessionRegistration>(entity => { entity.ToTable("event_session_registrations"); entity.Property(e => e.Status).HasMaxLength(16); entity.HasIndex(e => new { e.TenantId, e.EventId, e.SessionId, e.UserId }).IsUnique().HasDatabaseName("uq_ev_session_reg_member"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.SessionId, e.Status, e.Id }).HasDatabaseName("idx_ev_session_reg_capacity"); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventSessionRegistrationHistory>(entity => { entity.ToTable("event_session_registration_history"); entity.Property(e => e.Action).HasMaxLength(16); entity.Property(e => e.IdempotencyKey).HasMaxLength(191); entity.Property(e => e.RequestHash).HasMaxLength(64).IsFixedLength(); entity.HasIndex(e => new { e.TenantId, e.RegistrationId, e.RegistrationVersion }).IsUnique().HasDatabaseName("uq_ev_session_reg_history_version"); entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey }).IsUnique().HasDatabaseName("uq_ev_session_reg_history_key"); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventStaffAssignment>(entity => { entity.ToTable("event_staff_assignments"); entity.Property(e => e.Role).HasMaxLength(40); entity.Property(e => e.Status).HasMaxLength(16); entity.HasIndex(e => new { e.TenantId, e.EventId, e.UserId, e.Role }).IsUnique().HasDatabaseName("uq_event_staff_assignment_subject"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.Status, e.ExpiresAt, e.Id }).HasDatabaseName("idx_event_staff_assignment_event"); entity.HasIndex(e => new { e.TenantId, e.UserId, e.Status, e.ExpiresAt }).HasDatabaseName("idx_event_staff_assignment_user"); entity.HasMany(e => e.History).WithOne().HasForeignKey(e => e.AssignmentId).OnDelete(DeleteBehavior.Restrict); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventStaffAssignmentHistory>(entity => { entity.ToTable("event_staff_assignment_history"); entity.Property(e => e.Role).HasMaxLength(40); entity.Property(e => e.Action).HasMaxLength(32); entity.Property(e => e.IdempotencyKey).HasMaxLength(191); entity.Property(e => e.FromStatus).HasMaxLength(16); entity.Property(e => e.ToStatus).HasMaxLength(16); entity.Property(e => e.Metadata).HasColumnType("jsonb"); entity.HasIndex(e => new { e.TenantId, e.AssignmentId, e.AssignmentVersion }).IsUnique().HasDatabaseName("uq_event_staff_history_version"); entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey }).IsUnique().HasDatabaseName("uq_event_staff_history_idempotency"); entity.HasIndex(e => new { e.TenantId, e.EventId, e.CreatedAt, e.Id }).HasDatabaseName("idx_event_staff_history_event"); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventCalendarFeedToken>(entity => { entity.ToTable("event_calendar_feed_tokens"); entity.Property(e => e.TokenHash).HasMaxLength(64).IsFixedLength(); entity.Property(e => e.TokenPrefix).HasMaxLength(16); entity.Property(e => e.Label).HasMaxLength(100); entity.Property(e => e.Locale).HasMaxLength(10); entity.HasIndex(e => e.TokenHash).IsUnique().HasDatabaseName("uq_event_calendar_feed_token_hash"); entity.HasIndex(e => new { e.TenantId, e.UserId, e.RevokedAt, e.Id }).HasDatabaseName("idx_event_calendar_feed_token_owner"); entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventCheckinCredential>(e => { e.ToTable("event_checkin_credentials"); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.TokenHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.TokenFingerprint).HasMaxLength(16).IsFixedLength(); e.Property(x => x.IssueIdempotencyHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.RegistrationId, x.Status }).HasDatabaseName("idx_event_checkin_credential_registration"); e.HasIndex(x => new { x.TenantId, x.IssueIdempotencyHash }).IsUnique().HasDatabaseName("uq_event_checkin_credential_idempotency"); e.HasIndex(x => new { x.TenantId, x.EventId, x.TokenFingerprint }).HasDatabaseName("idx_event_checkin_credential_fingerprint"); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventCheckinDevice>(e => { e.ToTable("event_checkin_devices"); e.Property(x => x.Label).HasMaxLength(120); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.SecretHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.SecretFingerprint).HasMaxLength(16).IsFixedLength(); e.Property(x => x.RegistrationIdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.LastRotationIdempotencyHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.EventId, x.PublicId }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.RegistrationIdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventOfflineSyncBatch>(e => { e.ToTable("event_offline_sync_batches"); e.Property(x => x.ClientBatchId).HasMaxLength(191); e.Property(x => x.PayloadHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.Status).HasMaxLength(16); e.HasIndex(x => new { x.TenantId, x.DeviceId, x.ClientBatchId }).IsUnique(); e.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.BatchId).OnDelete(DeleteBehavior.Restrict); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventOfflineSyncItem>(e => { e.ToTable("event_offline_sync_items"); e.Property(x => x.ClientNonce).HasMaxLength(191); e.Property(x => x.Operation).HasMaxLength(16); e.Property(x => x.CredentialFingerprint).HasMaxLength(16).IsFixedLength(); e.Property(x => x.CredentialHashReference).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.DeviceId, x.ClientNonce }).IsUnique(); e.HasMany(x => x.Decisions).WithOne().HasForeignKey(x => x.ItemId).OnDelete(DeleteBehavior.Restrict); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventOfflineSyncDecision>(e => { e.ToTable("event_offline_sync_decisions"); e.Property(x => x.Outcome).HasMaxLength(16); e.Property(x => x.Code).HasMaxLength(80); e.Property(x => x.ResolutionIdempotencyHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.ItemId, x.DecisionVersion }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.ResolutionIdempotencyHash }).IsUnique().HasFilter("\"ResolutionIdempotencyHash\" IS NOT NULL"); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventSafetyRequirement>(e => { e.ToTable("event_safety_requirements"); e.Property(x => x.Status).HasMaxLength(16); e.HasIndex(x => new { x.TenantId, x.EventId }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventSafetyRequirementVersion>(e => { e.ToTable("event_safety_requirement_versions"); e.Property(x => x.CodeOfConductText).HasColumnType("text"); e.Property(x => x.CodeOfConductTextVersion).HasMaxLength(64); e.Property(x => x.CodeOfConductTextHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.EligibilityPolicyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.IdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.RequirementsId, x.VersionNumber }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventSafetyRequirementHistory>(e => { e.ToTable("event_safety_requirement_history"); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.IdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.Metadata).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.RequirementsId, x.RequirementsRevision }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventSafetyCodeAcknowledgement>(e => { e.ToTable("event_safety_code_acknowledgements"); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.TextVersion).HasMaxLength(64); e.Property(x => x.TextHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.IdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.EventId, x.UserId, x.EvidenceSequence }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventGuardianConsent>(e => { e.ToTable("event_guardian_consents"); e.Property(x => x.GuardianEmailCiphertext).HasColumnType("text"); e.Property(x => x.GuardianIdentityCiphertext).HasColumnType("text"); e.Property(x => x.GuardianEmailBlindHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RelationshipCode).HasMaxLength(32); e.Property(x => x.ConsentTextHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.PolicyBindingHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.TokenHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.RequestIdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => x.TokenHash).IsUnique(); e.HasIndex(x => new { x.TenantId, x.RequestIdempotencyHash }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.MinorUserId, x.Status }); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventGuardianConsentHistory>(e => { e.ToTable("event_guardian_consent_history"); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.ActorType).HasMaxLength(24); e.Property(x => x.IdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.Evidence).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.ConsentId, x.ConsentVersion }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventParticipationDenial>(e => { e.ToTable("event_participation_denials"); e.Property(x => x.Decision).HasMaxLength(16); e.Property(x => x.ReasonCode).HasMaxLength(32); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.CreateIdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.CreateRequestHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.EventId, x.UserId, x.Status }); e.HasIndex(x => new { x.TenantId, x.CreateIdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventParticipationDenialHistory>(e => { e.ToTable("event_participation_denial_history"); e.Property(x => x.Decision).HasMaxLength(16); e.Property(x => x.ReasonCode).HasMaxLength(32); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.IdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.DenialId, x.DecisionVersion }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventTicketType>(e => { e.ToTable("event_ticket_types"); e.Property(x => x.OccurrenceKey).HasMaxLength(191); e.Property(x => x.Name).HasMaxLength(191); e.Property(x => x.Description).HasColumnType("text"); e.Property(x => x.Kind).HasMaxLength(24); e.Property(x => x.UnitPriceCredits).HasPrecision(10, 2); e.Property(x => x.EventTimezoneSnapshot).HasMaxLength(64); e.Property(x => x.EligibilityPolicy).HasColumnType("jsonb"); e.Property(x => x.Status).HasMaxLength(16); e.HasIndex(x => new { x.TenantId, x.EventId, x.Id }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.Name }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.Status, x.SalesOpensAt, x.SalesClosesAt, x.Id }); e.HasIndex(x => new { x.TenantId, x.EventId, x.Kind, x.Status, x.Id }); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventTicketTypeHistory>(e => { e.ToTable("event_ticket_type_history"); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.IdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.ChangedFields).HasColumnType("jsonb"); e.Property(x => x.Reason).HasMaxLength(500); e.HasIndex(x => new { x.TenantId, x.TicketTypeId, x.TicketVersion }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.CreatedAt, x.Id }); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventTicketEntitlement>(e => { e.ToTable("event_ticket_entitlements"); e.Property(x => x.TicketKindSnapshot).HasMaxLength(24); e.Property(x => x.UnitPriceCreditsSnapshot).HasPrecision(10, 2); e.Property(x => x.TotalPriceCreditsSnapshot).HasPrecision(12, 2); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.AllocationIdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.AllocationRequestHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.CancellationReason).HasMaxLength(500); e.HasIndex(x => new { x.TenantId, x.AllocationIdempotencyHash }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.Id }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.TicketTypeId, x.Id }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.TicketTypeId, x.RegistrationId, x.UserId, x.Id }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.TicketTypeId, x.Status, x.UserId, x.Id }); e.HasIndex(x => new { x.TenantId, x.UserId, x.Status, x.EventId, x.Id }); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventTicketEntitlementHistory>(e => { e.ToTable("event_ticket_entitlement_history"); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.TicketKindSnapshot).HasMaxLength(24); e.Property(x => x.UnitPriceCreditsSnapshot).HasPrecision(10, 2); e.Property(x => x.TotalPriceCreditsSnapshot).HasPrecision(12, 2); e.Property(x => x.IdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.Reason).HasMaxLength(500); e.Property(x => x.Metadata).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.EntitlementId, x.EntitlementVersion }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.TicketTypeId, x.CreatedAt, x.Id }); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventTicketInventoryHistory>(e => { e.ToTable("event_ticket_inventory_history"); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.IdempotencyHash).HasMaxLength(64).IsFixedLength(); e.Property(x => x.RequestHash).HasMaxLength(64).IsFixedLength(); e.HasIndex(x => new { x.TenantId, x.EntitlementId, x.EntitlementVersion }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.TicketTypeId, x.CreatedAt, x.Id }); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationSettings>(e => { e.ToTable("event_registration_settings"); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.ApprovalMode).HasMaxLength(16); e.Property(x => x.FormState).HasMaxLength(16); e.Property(x => x.EventTimezoneSnapshot).HasMaxLength(64); e.HasIndex(x => new { x.TenantId, x.EventId }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationSettingsHistory>(e => { e.ToTable("event_registration_settings_history"); e.Property(x => x.Action).HasMaxLength(32); Hash64(e.Property(x => x.IdempotencyHash)); Hash64(e.Property(x => x.RequestHash)); e.Property(x => x.Snapshot).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.SettingsId, x.SettingsRevision }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationFormVersion>(e => { e.ToTable("event_registration_form_versions"); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.Name).HasMaxLength(191); Hash64(e.Property(x => x.DefinitionHash)); Hash64(e.Property(x => x.CreateIdempotencyHash)); Hash64(e.Property(x => x.CreateRequestHash)); e.HasIndex(x => new { x.TenantId, x.EventId, x.VersionNumber }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.CreateIdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationFormQuestion>(e => { e.ToTable("event_registration_form_questions"); e.Property(x => x.StableKey).HasMaxLength(64); e.Property(x => x.QuestionType).HasMaxLength(32); e.Property(x => x.DataClassification).HasMaxLength(24); e.Property(x => x.Purpose).HasMaxLength(500); e.Property(x => x.DisplayedTextVersion).HasMaxLength(64); e.Property(x => x.ChoiceOptions).HasColumnType("jsonb"); e.Property(x => x.ValidationRules).HasColumnType("jsonb"); e.Property(x => x.VisibilityRules).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.FormVersionId, x.StableKey }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.FormVersionId, x.Position }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationFormSubmission>(e => { e.ToTable("event_registration_form_submissions"); e.Property(x => x.Status).HasMaxLength(16); Hash64(e.Property(x => x.SaveIdempotencyHash)); Hash64(e.Property(x => x.SaveRequestHash)); e.HasIndex(x => new { x.TenantId, x.SaveIdempotencyHash }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.RegistrationId, x.AttemptNumber }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.EventId, x.RegistrationId, x.EffectiveSlot }).IsUnique().HasFilter("\"EffectiveSlot\" IS NOT NULL"); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationFormAnswer>(e => { e.ToTable("event_registration_form_answers"); e.Property(x => x.StableKey).HasMaxLength(64); e.Property(x => x.DataClassification).HasMaxLength(24); e.Property(x => x.Purpose).HasMaxLength(500); Hash64(e.Property(x => x.ValueHash)); e.Property(x => x.ValueJson).HasColumnType("text"); e.HasIndex(x => new { x.TenantId, x.SubmissionId, x.QuestionId }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationSubmissionHistory>(e => { e.ToTable("event_registration_submission_history"); e.Property(x => x.Action).HasMaxLength(24); Hash64(e.Property(x => x.IdempotencyHash)); Hash64(e.Property(x => x.RequestHash)); e.Property(x => x.Snapshot).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.SubmissionId, x.SubmissionRevision }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationAnswerAccessAudit>(e => { e.ToTable("event_registration_answer_access_audits"); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.Purpose).HasMaxLength(500); Hash64(e.Property(x => x.CorrelationId)); e.Property(x => x.Metadata).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.SubmissionId, x.CreatedAt, x.Id }); e.HasIndex(x => new { x.TenantId, x.CorrelationId, x.Action }); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventInvitationCampaign>(e => { e.ToTable("event_invitation_campaigns"); e.Property(x => x.CampaignType).HasMaxLength(16); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.Source).HasColumnType("text"); Hash64(e.Property(x => x.SourceHash)); e.Property(x => x.SegmentCriteriaSummary).HasColumnType("jsonb"); e.Property(x => x.PreviewErrors).HasColumnType("jsonb"); e.Property(x => x.DefaultLocale).HasMaxLength(15); e.Property(x => x.CancellationReason).HasMaxLength(500); Hash64(e.Property(x => x.CreateIdempotencyHash)); Hash64(e.Property(x => x.CreateRequestHash)); e.HasIndex(x => new { x.TenantId, x.CreateIdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventInvitationCampaignHistory>(e => { e.ToTable("event_invitation_campaign_history"); e.Property(x => x.Action).HasMaxLength(24); Hash64(e.Property(x => x.IdempotencyHash)); Hash64(e.Property(x => x.RequestHash)); e.Property(x => x.Snapshot).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.CampaignId, x.CampaignRevision }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventInvitation>(e => { e.ToTable("event_invitations"); Hash64(e.Property(x => x.EmailBlindHash)); Hash64(e.Property(x => x.TokenHash)); e.Property(x => x.TokenPrefix).HasMaxLength(16); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.Locale).HasMaxLength(15); e.Property(x => x.RevocationReason).HasMaxLength(500); e.HasIndex(x => x.TokenHash).IsUnique(); e.HasIndex(x => new { x.TenantId, x.CampaignId, x.UserId }).IsUnique().HasFilter("\"UserId\" IS NOT NULL"); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventInvitationHistory>(e => { e.ToTable("event_invitation_history"); e.Property(x => x.Action).HasMaxLength(16); Hash64(e.Property(x => x.IdempotencyHash)); Hash64(e.Property(x => x.RequestHash)); e.Property(x => x.Metadata).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.InvitationId, x.InvitationVersion }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventInvitationDeliveryEvidence>(e => { e.ToTable("event_invitation_delivery_evidence"); e.Property(x => x.Channel).HasMaxLength(32); e.Property(x => x.Status).HasMaxLength(32); e.Property(x => x.RecipientLocale).HasMaxLength(15); e.Property(x => x.PreferenceDecision).HasMaxLength(32); e.Property(x => x.PreferenceReason).HasMaxLength(191); e.Property(x => x.ProviderEvidenceId).HasMaxLength(191); e.Property(x => x.FailureCode).HasMaxLength(64); Hash64(e.Property(x => x.RecipientHash)); Hash64(e.Property(x => x.IdempotencyHash)); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.InvitationId, x.Channel, x.EvidenceVersion }).IsUnique(); e.HasOne<EventNotificationDelivery>().WithMany().HasForeignKey(x => x.NotificationDeliveryId).OnDelete(DeleteBehavior.Restrict); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventNotificationPreferenceProduct>(e =>
        {
            e.ToTable("event_notification_preferences");
            e.Property(x => x.Cadence).HasMaxLength(16);
            e.Property(x => x.PreferenceVersion).HasDefaultValue(1L);
            e.HasIndex(x => new { x.TenantId, x.UserId, x.EventId }).IsUnique().HasFilter("\"EventId\" IS NOT NULL AND \"CategoryId\" IS NULL").HasDatabaseName("uq_event_notification_preference_event");
            e.HasIndex(x => new { x.TenantId, x.UserId, x.CategoryId }).IsUnique().HasFilter("\"CategoryId\" IS NOT NULL AND \"EventId\" IS NULL").HasDatabaseName("uq_event_notification_preference_category");
            e.HasIndex(x => new { x.TenantId, x.EventId, x.UserId }).HasDatabaseName("idx_event_notification_preference_event");
            e.HasIndex(x => new { x.TenantId, x.CategoryId, x.UserId }).HasDatabaseName("idx_event_notification_preference_category");
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Category>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
            e.ToTable(t =>
            {
                t.HasCheckConstraint("chk_event_notification_preference_scope", "(\"EventId\" IS NOT NULL AND \"CategoryId\" IS NULL) OR (\"EventId\" IS NULL AND \"CategoryId\" IS NOT NULL)");
                t.HasCheckConstraint("chk_event_notification_preference_cadence", "\"Cadence\" IS NULL OR \"Cadence\" IN ('instant','daily','monthly','off')");
            });
            e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventReminderRuleProduct>(e =>
        {
            e.ToTable("event_reminder_rules");
            e.Property(x => x.RuleVersion).HasDefaultValue(1L);
            e.HasIndex(x => new { x.TenantId, x.EventId, x.UserId, x.OffsetMinutes }).IsUnique().HasDatabaseName("uq_event_reminder_rule_offset");
            e.HasIndex(x => new { x.TenantId, x.UserId, x.Enabled, x.EventId }).HasDatabaseName("idx_event_reminder_rule_user");
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Event>().WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.ToTable(t =>
            {
                t.HasCheckConstraint("chk_event_reminder_rule_offset", "\"OffsetMinutes\" BETWEEN 5 AND 525600");
                t.HasCheckConstraint("chk_event_reminder_rule_version", "\"RuleVersion\" >= 1");
            });
            e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventRegistrationGuest>(e => { e.ToTable("event_registration_guests"); e.Property(x => x.Status).HasMaxLength(16); Hash64(e.Property(x => x.EmailBlindHash)); Hash64(e.Property(x => x.IdentityFingerprint)); e.Property(x => x.PreferredLocale).HasMaxLength(15); Hash64(e.Property(x => x.ConsentTextHash)); e.Property(x => x.ConsentTextVersion).HasMaxLength(64); Hash64(e.Property(x => x.NotificationConsentHash)); e.Property(x => x.NotificationConsentVersion).HasMaxLength(64); e.HasIndex(x => new { x.TenantId, x.RegistrationId, x.GuestNumber }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.RegistrationId, x.IdentityFingerprint }).IsUnique().HasFilter("\"Status\" = 'captured'"); e.HasIndex(x => new { x.TenantId, x.TicketEntitlementId }).IsUnique().HasFilter("\"TicketEntitlementId\" IS NOT NULL"); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationGuestAttendance>(e => { e.ToTable("event_registration_guest_attendance"); e.Property(x => x.Status).HasMaxLength(32); e.HasIndex(x => new { x.TenantId, x.EventId, x.GuestId }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationGuestAttendanceHistory>(e => { e.ToTable("event_registration_guest_attendance_history"); e.Property(x => x.Action).HasMaxLength(32); e.Property(x => x.FromStatus).HasMaxLength(32); e.Property(x => x.ToStatus).HasMaxLength(32); e.Property(x => x.Status).HasMaxLength(32); Hash64(e.Property(x => x.IdempotencyHash)); Hash64(e.Property(x => x.RequestHash)); e.Property(x => x.Reason).HasMaxLength(500); e.Property(x => x.Metadata).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.AttendanceId, x.AttendanceVersion }).IsUnique(); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationRetentionRun>(e => { e.ToTable("event_registration_retention_runs"); e.Property(x => x.Mode).HasMaxLength(16); e.Property(x => x.Status).HasMaxLength(16); Hash64(e.Property(x => x.IdempotencyHash)); Hash64(e.Property(x => x.RequestHash)); e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventRegistrationRetentionItem>(e => { e.ToTable("event_registration_retention_items"); e.Property(x => x.SubjectType).HasMaxLength(16); e.Property(x => x.Action).HasMaxLength(16); e.Property(x => x.Status).HasMaxLength(16); e.Property(x => x.Evidence).HasColumnType("jsonb"); e.HasIndex(x => new { x.TenantId, x.RetentionRunId, x.SubjectType, x.SubjectId, x.Action }).IsUnique(); e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId); });
        modelBuilder.Entity<EventAttendanceCreditClaim>(e =>
        {
            e.ToTable("event_attendance_credit_claims");
            e.Property(x => x.ClaimType).HasMaxLength(50);
            e.Property(x => x.IdempotencyKey).HasMaxLength(191);
            e.Property(x => x.FundingSourceType).HasMaxLength(32);
            e.Property(x => x.Amount).HasPrecision(10, 2);
            e.Property(x => x.Unit).HasMaxLength(32).HasDefaultValue("time_credit");
            e.Property(x => x.Status).HasMaxLength(32).HasDefaultValue("pending");
            e.Property(x => x.FailureCode).HasMaxLength(100);
            e.Property(x => x.ReversalCode).HasMaxLength(100);
            e.Property(x => x.Metadata).HasColumnType("jsonb");
            e.HasIndex(x => new { x.TenantId, x.EventId, x.UserId, x.ClaimType }).IsUnique().HasDatabaseName("uq_event_credit_claim_subject");
            e.HasIndex(x => new { x.TenantId, x.IdempotencyKey }).IsUnique().HasDatabaseName("uq_event_credit_claim_key");
            e.HasIndex(x => x.TransactionId).IsUnique().HasDatabaseName("uq_event_credit_claim_transaction");
            e.HasIndex(x => new { x.TenantId, x.Status, x.CreatedAt, x.Id }).HasDatabaseName("idx_event_credit_claim_status");
            e.HasIndex(x => new { x.TenantId, x.EventId, x.AttendanceId }).HasDatabaseName("idx_event_credit_claim_attendance");
            e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventAnalyticsOptionalFact>(e =>
        {
            e.ToTable("event_analytics_optional_facts", table =>
            {
                table.HasCheckConstraint("chk_event_analytics_fact_metric", "\"Metric\" IN ('event_viewed','registration_started')");
                table.HasCheckConstraint("chk_event_analytics_fact_time", "\"OccurredAt\" <= \"ReceivedAt\" + interval '5 minutes' AND \"RetentionDueAt\" > \"OccurredAt\"");
                table.HasCheckConstraint("chk_event_analytics_fact_status", "\"Status\" IN ('active','withdrawn')");
            });
            e.Property(x => x.OccurrenceKey).HasMaxLength(191);
            e.Property(x => x.Metric).HasMaxLength(64);
            Hash64(e.Property(x => x.DeduplicationHash));
            Hash64(e.Property(x => x.RequestHash));
            Hash64(e.Property(x => x.SubjectHash));
            e.Property(x => x.PseudonymKeyVersion).HasMaxLength(16).IsFixedLength();
            e.Property(x => x.ConsentVersion).HasMaxLength(20);
            e.Property(x => x.SourceSurface).HasMaxLength(32);
            e.Property(x => x.ClientPlatform).HasMaxLength(32);
            e.Property(x => x.Dimensions).HasColumnType("jsonb");
            e.Property(x => x.Status).HasMaxLength(16).HasDefaultValue("active");
            e.HasIndex(x => new { x.TenantId, x.DeduplicationHash }).IsUnique().HasDatabaseName("uq_event_analytics_fact_dedup");
            e.HasIndex(x => new { x.TenantId, x.EventId, x.Id }).IsUnique().HasDatabaseName("uq_event_analytics_fact_scope");
            e.HasIndex(x => new { x.TenantId, x.EventId, x.Metric, x.Status, x.OccurredAt, x.Id }).HasDatabaseName("idx_event_analytics_fact_event");
            e.HasIndex(x => new { x.TenantId, x.ConsentRecordId, x.Status, x.Id }).HasDatabaseName("idx_event_analytics_fact_consent");
            e.HasIndex(x => new { x.TenantId, x.RetentionDueAt, x.Status, x.Id }).HasDatabaseName("idx_event_analytics_fact_retention");
            e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventAnalyticsWithdrawalRun>(e =>
        {
            e.ToTable("event_analytics_withdrawal_runs");
            Hash64(e.Property(x => x.IdempotencyHash));
            Hash64(e.Property(x => x.RequestHash));
            e.HasIndex(x => new { x.TenantId, x.IdempotencyHash }).IsUnique().HasDatabaseName("uq_event_analytics_withdraw_key");
            e.HasIndex(x => new { x.TenantId, x.ActorUserId, x.CreatedAt, x.Id }).HasDatabaseName("idx_event_analytics_withdraw_actor");
            e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId);
        });
        modelBuilder.Entity<EventAnalyticsAccessAudit>(e =>
        {
            e.ToTable("event_analytics_access_audits", table =>
            {
                table.HasCheckConstraint("chk_event_analytics_access_scope", "\"AccessScope\" IN ('organizer_summary','tenant_summary','csv_export')");
                table.HasCheckConstraint("chk_event_analytics_access_threshold", "\"PrivacyThreshold\" >= 5 AND \"SuppressedCount\" <= \"ResultCount\"");
            });
            e.Property(x => x.AccessScope).HasMaxLength(32);
            e.Property(x => x.PurposeCode).HasMaxLength(64);
            Hash64(e.Property(x => x.QueryHash));
            e.Property(x => x.PrivacyThreshold).HasDefaultValue(5);
            e.HasIndex(x => new { x.TenantId, x.EventId, x.CreatedAt, x.Id }).HasDatabaseName("idx_event_analytics_access_event");
            e.HasIndex(x => new { x.TenantId, x.ActorUserId, x.CreatedAt, x.Id }).HasDatabaseName("idx_event_analytics_access_actor");
            e.HasQueryFilter(x => !TenantContext.IsResolved || x.TenantId == TenantContext.TenantId);
        });
    }

    private static void Hash64<T>(PropertyBuilder<T> property) =>
        property.HasMaxLength(64).IsFixedLength();
}
