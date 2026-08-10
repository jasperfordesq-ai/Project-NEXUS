// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configuration for Caring Community parity tables.
/// </summary>
public class CaringCommunityConfiguration : TenantScopedConfiguration
{
    public CaringCommunityConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CaringEmergencyAlert>(entity =>
        {
            entity.ToTable("caring_emergency_alerts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Body).HasColumnType("text").IsRequired();
            entity.Property(e => e.Severity).HasMaxLength(20).HasDefaultValue("warning").IsRequired();
            entity.Property(e => e.GeographicScope).HasColumnType("jsonb");
            entity.Property(e => e.TargetUserIds).HasColumnType("jsonb");
            entity.Property(e => e.PushResult).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.TenantId, e.IsActive });
            entity.HasIndex(e => new { e.TenantId, e.ExpiresAt });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringFederationPeer>(entity =>
        {
            entity.ToTable("caring_federation_peers");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.PeerSlug).HasMaxLength(100).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(255).IsRequired();
            entity.Property(e => e.BaseUrl).HasMaxLength(500).IsRequired();
            entity.Property(e => e.SharedSecret).HasMaxLength(128).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.Notes).HasColumnType("text");
            entity.HasIndex(e => new { e.TenantId, e.PeerSlug }).IsUnique();

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringSubRegion>(entity =>
        {
            entity.ToTable("caring_sub_regions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Type).HasMaxLength(30).HasDefaultValue("quartier").IsRequired();
            entity.Property(e => e.Description).HasColumnType("text");
            entity.Property(e => e.PostalCodes).HasColumnType("jsonb");
            entity.Property(e => e.BoundaryGeoJson).HasColumnType("jsonb");
            entity.Property(e => e.CenterLatitude).HasPrecision(10, 7);
            entity.Property(e => e.CenterLongitude).HasPrecision(10, 7);
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("active").IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.Type });
            entity.HasIndex(e => new { e.TenantId, e.Status });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringCareProvider>(entity =>
        {
            entity.ToTable("caring_care_providers");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Type).HasMaxLength(30).IsRequired();
            entity.Property(e => e.Description).HasColumnType("text");
            entity.Property(e => e.Categories).HasColumnType("jsonb");
            entity.Property(e => e.Address).HasMaxLength(255);
            entity.Property(e => e.ContactPhone).HasMaxLength(50);
            entity.Property(e => e.ContactEmail).HasMaxLength(255);
            entity.Property(e => e.WebsiteUrl).HasMaxLength(255);
            entity.Property(e => e.OpeningHours).HasColumnType("jsonb");
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("active").IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.Type });
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.SubRegionId });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringCaregiverLink>(entity =>
        {
            entity.ToTable("caring_caregiver_links");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RelationshipType).HasMaxLength(30).HasDefaultValue("family").IsRequired();
            entity.Property(e => e.StartDate).HasColumnType("date").IsRequired();
            entity.Property(e => e.Notes).HasColumnType("text");
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("pending").IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.CaregiverId });
            entity.HasIndex(e => new { e.TenantId, e.CaredForId });
            entity.HasIndex(e => new { e.TenantId, e.CaregiverId, e.CaredForId, e.Status })
                .IsUnique()
                .HasDatabaseName("ccl_tenant_caregiver_recipient_status_unique");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Caregiver)
                .WithMany()
                .HasForeignKey(e => e.CaregiverId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.CaredFor)
                .WithMany()
                .HasForeignKey(e => e.CaredForId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringCoverRequest>(entity =>
        {
            entity.ToTable("caring_cover_requests");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.CaregiverLinkId).HasColumnName("caregiver_link_id");
            entity.Property(e => e.CaregiverId).HasColumnName("caregiver_id");
            entity.Property(e => e.CaredForId).HasColumnName("cared_for_id");
            entity.Property(e => e.SupportRelationshipId).HasColumnName("support_relationship_id");
            entity.Property(e => e.MatchedSupporterId).HasColumnName("matched_supporter_id");
            entity.Property(e => e.Title).HasColumnName("title").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Briefing).HasColumnName("briefing").HasColumnType("text");
            entity.Property(e => e.RequiredSkillsJson).HasColumnName("required_skills").HasColumnType("jsonb");
            entity.Property(e => e.StartsAt).HasColumnName("starts_at");
            entity.Property(e => e.EndsAt).HasColumnName("ends_at");
            entity.Property(e => e.ExpectedHours).HasColumnName("expected_hours").HasPrecision(5, 2);
            entity.Property(e => e.MinimumTrustTier).HasColumnName("minimum_trust_tier").HasDefaultValue(1);
            entity.Property(e => e.Urgency).HasColumnName("urgency").HasMaxLength(20).HasDefaultValue("planned").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("open").IsRequired();
            entity.Property(e => e.MatchedAt).HasColumnName("matched_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.CaregiverId, e.Status })
                .HasDatabaseName("idx_ccr_tenant_caregiver_status");
            entity.HasIndex(e => new { e.TenantId, e.CaredForId, e.StartsAt })
                .HasDatabaseName("idx_ccr_tenant_cared_for_starts");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.StartsAt })
                .HasDatabaseName("idx_ccr_tenant_status_starts");
            entity.HasIndex(e => e.SupportRelationshipId)
                .HasDatabaseName("idx_ccr_support_relationship");
            entity.HasIndex(e => e.MatchedSupporterId);

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.CaregiverLink)
                .WithMany()
                .HasForeignKey(e => e.CaregiverLinkId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Caregiver)
                .WithMany()
                .HasForeignKey(e => e.CaregiverId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.CaredFor)
                .WithMany()
                .HasForeignKey(e => e.CaredForId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.MatchedSupporter)
                .WithMany()
                .HasForeignKey(e => e.MatchedSupporterId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.SupportRelationship)
                .WithMany()
                .HasForeignKey(e => e.SupportRelationshipId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringSupportCategory>(entity =>
        {
            entity.ToTable("caring_support_categories");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Name).HasColumnName("name").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Slug).HasColumnName("slug").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(e => e.Color).HasColumnName("color").HasMaxLength(32);
            entity.Property(e => e.Icon).HasColumnName("icon").HasMaxLength(64);
            entity.Property(e => e.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            entity.Property(e => e.SortOrder).HasColumnName("sort_order").HasDefaultValue(0);
            entity.Property(e => e.SubstitutionCoefficient)
                .HasColumnName("substitution_coefficient")
                .HasPrecision(3, 2)
                .HasDefaultValue(1m);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Slug })
                .IsUnique()
                .HasDatabaseName("caring_support_categories_tenant_slug_unique");
            entity.HasIndex(e => new { e.TenantId, e.IsActive, e.SortOrder })
                .HasDatabaseName("caring_support_categories_tenant_active_sort_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringSupportRelationship>(entity =>
        {
            entity.ToTable("caring_support_relationships");
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.SupporterId).HasColumnName("supporter_id");
            entity.Property(e => e.RecipientId).HasColumnName("recipient_id");
            entity.Property(e => e.CoordinatorId).HasColumnName("coordinator_id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.CategoryId).HasColumnName("category_id");
            entity.Property(e => e.Title).HasColumnName("title").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(e => e.Frequency).HasColumnName("frequency").HasMaxLength(20).HasDefaultValue("weekly").IsRequired();
            entity.Property(e => e.ExpectedHours).HasColumnName("expected_hours").HasPrecision(5, 2).HasDefaultValue(1m);
            entity.Property(e => e.StartDate).HasColumnName("start_date").HasColumnType("date").IsRequired();
            entity.Property(e => e.EndDate).HasColumnName("end_date").HasColumnType("date");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("active").IsRequired();
            entity.Property(e => e.LastLoggedAt).HasColumnName("last_logged_at");
            entity.Property(e => e.NextCheckInAt).HasColumnName("next_check_in_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Status }).HasDatabaseName("idx_csr_tenant_status");
            entity.HasIndex(e => new { e.TenantId, e.RecipientId, e.Status }).HasDatabaseName("idx_csr_recipient_status");
            entity.HasIndex(e => new { e.TenantId, e.SupporterId, e.Status }).HasDatabaseName("idx_csr_supporter_status");
            entity.HasIndex(e => new { e.TenantId, e.NextCheckInAt }).HasDatabaseName("idx_csr_next_check_in");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Supporter)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.SupporterId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Recipient)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.RecipientId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Coordinator)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.CoordinatorId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);

            entity.HasOne(e => e.Organization)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OrganizationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringTandemSuggestionLog>(entity =>
        {
            entity.ToTable("caring_tandem_suggestion_log");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.SupporterUserId).HasColumnName("supporter_user_id");
            entity.Property(e => e.RecipientUserId).HasColumnName("recipient_user_id");
            entity.Property(e => e.Action).HasColumnName("action").HasMaxLength(32).IsRequired();
            entity.Property(e => e.CreatedByUserId).HasColumnName("created_by_user_id");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasIndex(e => new { e.TenantId, e.SupporterUserId, e.RecipientUserId })
                .IsUnique()
                .HasDatabaseName("idx_ctsl_tenant_pair_unique");
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt })
                .HasDatabaseName("idx_ctsl_tenant_created");

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringHelpRequest>(entity =>
        {
            entity.ToTable("caring_help_requests");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.What).HasColumnName("what").HasColumnType("text").IsRequired();
            entity.Property(e => e.WhenNeeded).HasColumnName("when_needed").HasMaxLength(200).IsRequired();
            entity.Property(e => e.ContactPreference).HasColumnName("contact_preference").HasMaxLength(20).HasDefaultValue("either").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.IsOnBehalf).HasColumnName("is_on_behalf").HasDefaultValue(false);
            entity.Property(e => e.RequestedById).HasColumnName("requested_by_id");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at");

            entity.HasIndex(e => new { e.TenantId, e.Status }).HasDatabaseName("idx_chr_tenant_status");
            entity.HasIndex(e => new { e.TenantId, e.UserId }).HasDatabaseName("idx_chr_tenant_user");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.RequestedBy)
                .WithMany()
                .HasForeignKey(e => e.RequestedById)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerLog>(entity =>
        {
            entity.ToTable("vol_logs", table =>
            {
                table.HasCheckConstraint(
                    "CK_VolunteerLogs_Hours",
                    "\"hours\" >= 0 AND \"hours\" <= 24 AND (\"caring_support_relationship_id\" IS NOT NULL OR \"hours\" >= 0.25)");
                table.HasCheckConstraint(
                    "CK_VolunteerLogs_Status",
                    "\"status\" IN ('pending', 'approved', 'declined', 'rejected')");
                table.HasCheckConstraint(
                    "CK_VolunteerLogs_OpportunityOrganisation",
                    "\"opportunity_id\" IS NULL OR \"organization_id\" IS NOT NULL");
            });
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.OpportunityId).HasColumnName("opportunity_id");
            entity.Property(e => e.CaringSupportRelationshipId).HasColumnName("caring_support_relationship_id");
            entity.Property(e => e.SupportRecipientId).HasColumnName("support_recipient_id");
            entity.Property(e => e.DateLogged).HasColumnName("date_logged").HasColumnType("date").IsRequired();
            entity.Property(e => e.Hours).HasColumnName("hours").HasPrecision(5, 2);
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(e => e.Feedback).HasColumnName("feedback").HasColumnType("text");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.AssignedTo).HasColumnName("assigned_to");
            entity.Property(e => e.AssignedAt).HasColumnName("assigned_at");
            entity.Property(e => e.EscalatedAt).HasColumnName("escalated_at");
            entity.Property(e => e.EscalationNote).HasColumnName("escalation_note").HasColumnType("text");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.OrganizationId);
            entity.HasIndex(e => e.OpportunityId);
            entity.HasIndex(e => e.CaringSupportRelationshipId).HasDatabaseName("idx_vol_logs_caring_relationship");
            entity.HasIndex(e => e.SupportRecipientId).HasDatabaseName("idx_vol_logs_support_recipient");
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.DateLogged });
            entity.HasIndex(e => new { e.TenantId, e.Status, e.CreatedAt })
                .HasDatabaseName("idx_vol_logs_tenant_status_created");
            entity.HasIndex(e => new { e.TenantId, e.OrganizationId, e.OpportunityId })
                .HasDatabaseName("idx_vol_logs_tenant_org_opportunity");
            entity.HasIndex(e => new
                {
                    e.TenantId,
                    e.UserId,
                    e.OrganizationId,
                    e.DateLogged,
                    e.OpportunityId
                })
                .IsUnique()
                .HasFilter("\"status\" NOT IN ('declined', 'rejected') AND \"opportunity_id\" IS NOT NULL")
                .HasDatabaseName("ux_vol_logs_active_with_opportunity");
            entity.HasIndex(e => new
                {
                    e.TenantId,
                    e.UserId,
                    e.OrganizationId,
                    e.DateLogged
                })
                .IsUnique()
                .HasFilter("\"status\" NOT IN ('declined', 'rejected') AND \"opportunity_id\" IS NULL AND \"caring_support_relationship_id\" IS NULL AND \"organization_id\" IS NOT NULL")
                .HasDatabaseName("ux_vol_logs_active_without_opportunity");
            entity.HasIndex(e => new
                {
                    e.TenantId,
                    e.UserId,
                    e.CaringSupportRelationshipId,
                    e.DateLogged
                })
                .IsUnique()
                .HasFilter("\"status\" NOT IN ('declined', 'rejected') AND \"caring_support_relationship_id\" IS NOT NULL")
                .HasDatabaseName("ux_vol_logs_active_caring_relationship");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.UserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Organization)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OrganizationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                // PostgreSQL migration 111 installs a column-specific SET NULL
                // action so tenant_id remains intact when the optional parent is
                // removed. ClientSetNull keeps EF from generating an unsafe
                // composite SET NULL that would also null the tenant key.
                .OnDelete(DeleteBehavior.ClientSetNull);

            entity.HasOne(e => e.Opportunity)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OpportunityId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);

            entity.HasOne(e => e.SupportRecipient)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.SupportRecipientId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);

            entity.HasOne(e => e.AssignedUser)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.AssignedTo })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);

            entity.HasOne(e => e.CaringSupportRelationship)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.CaringSupportRelationshipId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SafeguardingReport>(entity =>
        {
            entity.ToTable("safeguarding_reports");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.ReporterUserId).HasColumnName("reporter_user_id");
            entity.Property(e => e.SubjectUserId).HasColumnName("subject_user_id");
            entity.Property(e => e.SubjectOrganisationId).HasColumnName("subject_organisation_id");
            entity.Property(e => e.Category).HasColumnName("category").HasMaxLength(60).IsRequired();
            entity.Property(e => e.Severity).HasColumnName("severity").HasMaxLength(20).HasDefaultValue("medium").IsRequired();
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text").IsRequired();
            entity.Property(e => e.EvidenceUrl).HasColumnName("evidence_url").HasMaxLength(500);
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(30).HasDefaultValue("submitted").IsRequired();
            entity.Property(e => e.AssignedToUserId).HasColumnName("assigned_to_user_id");
            entity.Property(e => e.ReviewDueAt).HasColumnName("review_due_at");
            entity.Property(e => e.Escalated).HasColumnName("escalated").HasDefaultValue(false);
            entity.Property(e => e.EscalatedAt).HasColumnName("escalated_at");
            entity.Property(e => e.ResolutionNotes).HasColumnName("resolution_notes").HasColumnType("text");
            entity.Property(e => e.ResolvedAt).HasColumnName("resolved_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Status }).HasDatabaseName("idx_safeguard_tenant_status");
            entity.HasIndex(e => new { e.TenantId, e.Severity }).HasDatabaseName("idx_safeguard_tenant_severity");
            entity.HasIndex(e => new { e.TenantId, e.AssignedToUserId }).HasDatabaseName("idx_safeguard_tenant_assigned");
            entity.HasIndex(e => new { e.TenantId, e.ReviewDueAt }).HasDatabaseName("idx_safeguard_tenant_review_due");
            entity.HasIndex(e => new { e.TenantId, e.ReporterUserId }).HasDatabaseName("idx_safeguard_tenant_reporter");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Reporter)
                .WithMany()
                .HasForeignKey(e => e.ReporterUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.SubjectUser)
                .WithMany()
                .HasForeignKey(e => e.SubjectUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.AssignedTo)
                .WithMany()
                .HasForeignKey(e => e.AssignedToUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SafeguardingReportAction>(entity =>
        {
            entity.ToTable("safeguarding_report_actions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.ReportId).HasColumnName("report_id");
            entity.Property(e => e.ActorUserId).HasColumnName("actor_user_id");
            entity.Property(e => e.Action).HasColumnName("action").HasMaxLength(30).IsRequired();
            entity.Property(e => e.Notes).HasColumnName("notes").HasColumnType("text");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasIndex(e => new { e.TenantId, e.ReportId, e.CreatedAt })
                .HasDatabaseName("idx_safeguard_action_tenant_report");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Report)
                .WithMany(e => e.Actions)
                .HasForeignKey(e => e.ReportId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.ActorUser)
                .WithMany()
                .HasForeignKey(e => e.ActorUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringProjectAnnouncement>(entity =>
        {
            entity.ToTable("caring_project_announcements");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Summary).HasColumnType("text");
            entity.Property(e => e.Location).HasMaxLength(255);
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("draft").IsRequired();
            entity.Property(e => e.CurrentStage).HasMaxLength(120);
            entity.Property(e => e.ProgressPercent).HasDefaultValue(0);
            entity.Property(e => e.SubscriberCount).HasDefaultValue(0);
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.PublishedAt });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Creator)
                .WithMany()
                .HasForeignKey(e => e.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringProjectUpdate>(entity =>
        {
            entity.ToTable("caring_project_updates");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.StageLabel).HasMaxLength(120);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Body).HasColumnType("text");
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("draft").IsRequired();
            entity.Property(e => e.NotificationCount).HasDefaultValue(0);
            entity.HasIndex(e => new { e.ProjectId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.PublishedAt });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Project)
                .WithMany(e => e.Updates)
                .HasForeignKey(e => e.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Creator)
                .WithMany()
                .HasForeignKey(e => e.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringProjectSubscription>(entity =>
        {
            entity.ToTable("caring_project_subscriptions");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.ProjectId, e.UserId })
                .IsUnique()
                .HasDatabaseName("caring_project_subscriptions_project_user_unique");
            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasIndex(e => new { e.ProjectId, e.UnsubscribedAt });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Project)
                .WithMany(e => e.Subscriptions)
                .HasForeignKey(e => e.ProjectId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringSmartNudge>(entity =>
        {
            entity.ToTable("caring_smart_nudges");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.TargetUserId).HasColumnName("target_user_id");
            entity.Property(e => e.RelatedUserId).HasColumnName("related_user_id");
            entity.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(64).HasDefaultValue("tandem_candidate").IsRequired();
            entity.Property(e => e.DispatchKey).HasColumnName("dispatch_key").HasMaxLength(96);
            entity.Property(e => e.Score).HasColumnName("score").HasPrecision(5, 3).HasDefaultValue(0m);
            entity.Property(e => e.Signals).HasColumnName("signals").HasColumnType("jsonb");
            entity.Property(e => e.NotificationId).HasColumnName("notification_id");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("sent").IsRequired();
            entity.Property(e => e.SentAt).HasColumnName("sent_at");
            entity.Property(e => e.ConvertedAt).HasColumnName("converted_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.TargetUserId, e.SentAt })
                .HasDatabaseName("caring_nudges_target_sent_idx");
            entity.HasIndex(e => new { e.TenantId, e.RelatedUserId, e.SentAt })
                .HasDatabaseName("caring_nudges_related_sent_idx");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.SentAt })
                .HasDatabaseName("caring_nudges_status_sent_idx");
            entity.HasIndex(e => new { e.TenantId, e.DispatchKey })
                .IsUnique()
                .HasDatabaseName("uq_caring_nudges_dispatch_key");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.TargetUser)
                .WithMany()
                .HasForeignKey(e => e.TargetUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.RelatedUser)
                .WithMany()
                .HasForeignKey(e => e.RelatedUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringPaperOnboardingIntake>(entity =>
        {
            entity.ToTable("caring_paper_onboarding_intakes");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UploadedBy).HasColumnName("uploaded_by");
            entity.Property(e => e.ReviewedBy).HasColumnName("reviewed_by");
            entity.Property(e => e.CreatedUserId).HasColumnName("created_user_id");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("pending_review").IsRequired();
            entity.Property(e => e.OriginalFilename).HasColumnName("original_filename").HasMaxLength(255).IsRequired();
            entity.Property(e => e.StoredPath).HasColumnName("stored_path").HasMaxLength(512).IsRequired();
            entity.Property(e => e.MimeType).HasColumnName("mime_type").HasMaxLength(120);
            entity.Property(e => e.FileSize).HasColumnName("file_size");
            entity.Property(e => e.OcrProvider).HasColumnName("ocr_provider").HasMaxLength(60).HasDefaultValue("manual_review_stub").IsRequired();
            entity.Property(e => e.ExtractedFields).HasColumnName("extracted_fields").HasColumnType("jsonb");
            entity.Property(e => e.CorrectedFields).HasColumnName("corrected_fields").HasColumnType("jsonb");
            entity.Property(e => e.CoordinatorNotes).HasColumnName("coordinator_notes").HasColumnType("text");
            entity.Property(e => e.ConfirmedAt).HasColumnName("confirmed_at");
            entity.Property(e => e.RejectedAt).HasColumnName("rejected_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at");

            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UploadedBy);
            entity.HasIndex(e => e.ReviewedBy);
            entity.HasIndex(e => e.CreatedUserId);
            entity.HasIndex(e => new { e.TenantId, e.Status })
                .HasDatabaseName("caring_paper_onboarding_tenant_status_idx");
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt })
                .HasDatabaseName("caring_paper_onboarding_tenant_created_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringInviteCode>(entity =>
        {
            entity.ToTable("caring_invite_codes");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Code).HasColumnName("code").HasMaxLength(10).IsRequired();
            entity.Property(e => e.Label).HasColumnName("label").HasMaxLength(200);
            entity.Property(e => e.CreatedByUserId).HasColumnName("created_by_user_id");
            entity.Property(e => e.ExpiresAt).HasColumnName("expires_at");
            entity.Property(e => e.UsedAt).HasColumnName("used_at");
            entity.Property(e => e.UsedByUserId).HasColumnName("used_by_user_id");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.CreatedByUserId);
            entity.HasIndex(e => new { e.TenantId, e.Code })
                .IsUnique()
                .HasDatabaseName("caring_invite_codes_tenant_code_unique");
            entity.HasIndex(e => new { e.TenantId, e.CreatedByUserId })
                .HasDatabaseName("caring_invite_codes_tenant_created_by_idx");
            entity.HasIndex(e => new { e.TenantId, e.ExpiresAt })
                .HasDatabaseName("caring_invite_codes_tenant_expires_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.CreatedByUser)
                .WithMany()
                .HasForeignKey(e => e.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.UsedByUser)
                .WithMany()
                .HasForeignKey(e => e.UsedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringKpiBaseline>(entity =>
        {
            entity.ToTable("caring_kpi_baselines");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Label).HasColumnName("label").HasMaxLength(255).IsRequired();
            entity.Property(e => e.BaselinePeriod).HasColumnName("baseline_period").HasColumnType("jsonb").IsRequired();
            entity.Property(e => e.CapturedAt).HasColumnName("captured_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(e => e.Metrics).HasColumnName("metrics").HasColumnType("jsonb").IsRequired();
            entity.Property(e => e.Notes).HasColumnName("notes").HasColumnType("text");
            entity.Property(e => e.CapturedBy).HasColumnName("captured_by");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.CapturedAt })
                .HasDatabaseName("idx_caring_kpi_baselines_tenant_captured");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringFavour>(entity =>
        {
            entity.ToTable("caring_favours");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.OfferedByUserId).HasColumnName("offered_by_user_id");
            entity.Property(e => e.ReceivedByUserId).HasColumnName("received_by_user_id");
            entity.Property(e => e.Category).HasColumnName("category").HasMaxLength(100);
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text").IsRequired();
            entity.Property(e => e.FavourDate).HasColumnName("favour_date").HasColumnType("date").IsRequired();
            entity.Property(e => e.IsAnonymous).HasColumnName("is_anonymous").HasDefaultValue(false);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at");
            entity.HasIndex(e => new { e.TenantId, e.OfferedByUserId });
            entity.HasIndex(e => new { e.TenantId, e.FavourDate });
            entity.HasIndex(e => new { e.TenantId, e.ReceivedByUserId })
                .HasDatabaseName("caring_favours_tenant_received_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.OfferedByUser)
                .WithMany()
                .HasForeignKey(e => e.OfferedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.ReceivedByUser)
                .WithMany()
                .HasForeignKey(e => e.ReceivedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringMunicipalityFeedback>(entity =>
        {
            entity.ToTable("caring_municipality_feedback");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.SubmitterUserId).HasColumnName("submitter_user_id");
            entity.Property(e => e.SubRegionId).HasColumnName("sub_region_id");
            entity.Property(e => e.Category).HasColumnName("category").HasMaxLength(32).HasDefaultValue("question").IsRequired();
            entity.Property(e => e.Subject).HasColumnName("subject").HasMaxLength(200).IsRequired();
            entity.Property(e => e.Body).HasColumnName("body").HasColumnType("text").IsRequired();
            entity.Property(e => e.SentimentTag).HasColumnName("sentiment_tag").HasMaxLength(32);
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("new").IsRequired();
            entity.Property(e => e.AssignedUserId).HasColumnName("assigned_user_id");
            entity.Property(e => e.AssignedRole).HasColumnName("assigned_role").HasMaxLength(64);
            entity.Property(e => e.TriageNotes).HasColumnName("triage_notes").HasColumnType("text");
            entity.Property(e => e.ResolutionNotes).HasColumnName("resolution_notes").HasColumnType("text");
            entity.Property(e => e.IsAnonymous).HasColumnName("is_anonymous").HasDefaultValue(false);
            entity.Property(e => e.IsPublic).HasColumnName("is_public").HasDefaultValue(false);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at");
            entity.HasIndex(e => e.SubmitterUserId);
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.Category });
            entity.HasIndex(e => new { e.TenantId, e.SubRegionId });
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MunicipalReportTemplate>(entity =>
        {
            entity.ToTable("municipal_report_templates");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Name).HasColumnName("name").HasMaxLength(160).IsRequired();
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(e => e.Audience).HasColumnName("audience").HasMaxLength(40).HasDefaultValue("municipality").IsRequired();
            entity.Property(e => e.DatePreset).HasColumnName("date_preset").HasMaxLength(40).HasDefaultValue("last_90_days").IsRequired();
            entity.Property(e => e.IncludeSocialValue).HasColumnName("include_social_value").HasDefaultValue(true);
            entity.Property(e => e.HourValueChf).HasColumnName("hour_value_chf");
            entity.Property(e => e.Sections).HasColumnName("sections").HasColumnType("jsonb");
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.UpdatedBy).HasColumnName("updated_by");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Name })
                .IsUnique()
                .HasDatabaseName("municipal_report_templates_tenant_name_unique");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MunicipalVerification>(entity =>
        {
            entity.ToTable("municipal_verifications");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Domain).HasColumnName("domain").HasMaxLength(253).IsRequired();
            entity.Property(e => e.Method).HasColumnName("method").HasMaxLength(32).HasDefaultValue("dns_txt").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.DnsRecordName).HasColumnName("dns_record_name").HasMaxLength(253);
            entity.Property(e => e.DnsRecordValue).HasColumnName("dns_record_value").HasMaxLength(255);
            entity.Property(e => e.RequestedBy).HasColumnName("requested_by");
            entity.Property(e => e.VerifiedBy).HasColumnName("verified_by");
            entity.Property(e => e.VerifiedAt).HasColumnName("verified_at");
            entity.Property(e => e.RevokedAt).HasColumnName("revoked_at");
            entity.Property(e => e.AttestationNote).HasColumnName("attestation_note").HasMaxLength(1000);
            entity.Property(e => e.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Domain })
                .IsUnique()
                .HasDatabaseName("municipal_verifications_tenant_domain_unique");
            entity.HasIndex(e => new { e.TenantId, e.Status })
                .HasDatabaseName("municipal_verifications_tenant_status_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MunicipalitySurvey>(entity =>
        {
            entity.ToTable("municipality_surveys");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.Title).HasColumnName("title").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("draft").IsRequired();
            entity.Property(e => e.IsAnonymous).HasColumnName("is_anonymous").HasDefaultValue(false);
            entity.Property(e => e.TargetAudience).HasColumnName("target_audience").HasColumnType("jsonb");
            entity.Property(e => e.StartsAt).HasColumnName("starts_at");
            entity.Property(e => e.EndsAt).HasColumnName("ends_at");
            entity.Property(e => e.ResponseCount).HasColumnName("response_count").HasDefaultValue(0);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Status })
                .HasDatabaseName("municipality_surveys_tenant_status_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Creator)
                .WithMany()
                .HasForeignKey(e => e.CreatedBy)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MunicipalitySurveyQuestion>(entity =>
        {
            entity.ToTable("municipality_survey_questions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SurveyId).HasColumnName("survey_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.QuestionText).HasColumnName("question_text").HasMaxLength(500).IsRequired();
            entity.Property(e => e.QuestionType).HasColumnName("question_type").HasMaxLength(30).IsRequired();
            entity.Property(e => e.Options).HasColumnName("options").HasColumnType("jsonb");
            entity.Property(e => e.IsRequired).HasColumnName("is_required").HasDefaultValue(true);
            entity.Property(e => e.SortOrder).HasColumnName("sort_order").HasDefaultValue(0);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.SurveyId, e.SortOrder })
                .HasDatabaseName("municipality_survey_questions_survey_sort_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Survey)
                .WithMany(e => e.Questions)
                .HasForeignKey(e => e.SurveyId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MunicipalitySurveyResponse>(entity =>
        {
            entity.ToTable("municipality_survey_responses");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SurveyId).HasColumnName("survey_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.SessionToken).HasColumnName("session_token").HasMaxLength(64);
            entity.Property(e => e.Answers).HasColumnName("answers").HasColumnType("jsonb").IsRequired();
            entity.Property(e => e.SubmittedAt).HasColumnName("submitted_at");
            entity.Property(e => e.IpHash).HasColumnName("ip_hash").HasMaxLength(64);

            entity.HasIndex(e => new { e.TenantId, e.SurveyId, e.UserId })
                .IsUnique()
                .HasDatabaseName("msr_tenant_survey_user_unique");
            entity.HasIndex(e => new { e.TenantId, e.SurveyId, e.SessionToken })
                .IsUnique()
                .HasDatabaseName("msr_tenant_survey_session_unique");
            entity.HasIndex(e => new { e.TenantId, e.SubmittedAt })
                .HasDatabaseName("municipality_survey_responses_tenant_submitted_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Survey)
                .WithMany(e => e.Responses)
                .HasForeignKey(e => e.SurveyId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringHourEstate>(entity =>
        {
            entity.ToTable("caring_hour_estates");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.MemberUserId).HasColumnName("member_user_id");
            entity.Property(e => e.BeneficiaryUserId).HasColumnName("beneficiary_user_id");
            entity.Property(e => e.PolicyAction).HasColumnName("policy_action").HasMaxLength(40).HasDefaultValue("donate_to_solidarity").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("nominated").IsRequired();
            entity.Property(e => e.ReportedBalanceHours).HasColumnName("reported_balance_hours").HasPrecision(8, 2);
            entity.Property(e => e.SettledHours).HasColumnName("settled_hours").HasPrecision(8, 2);
            entity.Property(e => e.SettlementTransactionId).HasColumnName("settlement_transaction_id");
            entity.Property(e => e.PolicyDocumentReference).HasColumnName("policy_document_reference").HasMaxLength(255);
            entity.Property(e => e.MemberNotes).HasColumnName("member_notes").HasColumnType("text");
            entity.Property(e => e.CoordinatorNotes).HasColumnName("coordinator_notes").HasColumnType("text");
            entity.Property(e => e.NominatedAt).HasColumnName("nominated_at");
            entity.Property(e => e.ReportedDeceasedAt).HasColumnName("reported_deceased_at");
            entity.Property(e => e.SettledAt).HasColumnName("settled_at");
            entity.Property(e => e.ReportedBy).HasColumnName("reported_by");
            entity.Property(e => e.SettledBy).HasColumnName("settled_by");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.MemberUserId);
            entity.HasIndex(e => e.BeneficiaryUserId);
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.MemberUserId })
                .IsUnique()
                .HasDatabaseName("caring_hour_estates_tenant_member_unique");
            entity.HasIndex(e => new { e.TenantId, e.SettlementTransactionId })
                .IsUnique()
                .HasFilter("\"settlement_transaction_id\" IS NOT NULL");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.MemberUser)
                .WithMany()
                .HasForeignKey(e => e.MemberUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.BeneficiaryUser)
                .WithMany()
                .HasForeignKey(e => e.BeneficiaryUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.SettlementTransaction)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.SettlementTransactionId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringHourTransfer>(entity =>
        {
            entity.ToTable("caring_hour_transfers");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.CounterpartTenantSlug).HasColumnName("counterpart_tenant_slug").HasMaxLength(50).IsRequired();
            entity.Property(e => e.Role).HasColumnName("role").HasMaxLength(20).IsRequired();
            entity.Property(e => e.MemberUserId).HasColumnName("member_user_id");
            entity.Property(e => e.CounterpartMemberEmail).HasColumnName("counterpart_member_email").HasMaxLength(255).IsRequired();
            entity.Property(e => e.HoursTransferred).HasColumnName("hours_transferred").HasPrecision(8, 2);
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.Reason).HasColumnName("reason").HasColumnType("text");
            entity.Property(e => e.Signature).HasColumnName("signature").HasMaxLength(128);
            entity.Property(e => e.PayloadJson).HasColumnName("payload_json").HasColumnType("jsonb");
            entity.Property(e => e.LinkedTransferId).HasColumnName("linked_transfer_id");
            entity.Property(e => e.RemoteIdempotencyKey).HasColumnName("remote_idempotency_key").HasMaxLength(160);
            entity.Property(e => e.IsRemote).HasColumnName("is_remote").HasDefaultValue(false);
            entity.Property(e => e.RemoteDeliveryStatus).HasColumnName("remote_delivery_status").HasMaxLength(32);
            entity.Property(e => e.RemoteDeliveryAttempts).HasColumnName("remote_delivery_attempts").HasDefaultValue(0);
            entity.Property(e => e.RemoteDeliveryLastError).HasColumnName("remote_delivery_last_error").HasColumnType("text");
            entity.Property(e => e.RemoteDeliveryNextRetryAt).HasColumnName("remote_delivery_next_retry_at");
            entity.Property(e => e.RemoteDeliveredAt).HasColumnName("remote_delivered_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Role, e.Status })
                .HasDatabaseName("idx_caring_hour_xfer_tenant_role_status");
            entity.HasIndex(e => new { e.TenantId, e.MemberUserId })
                .HasDatabaseName("idx_caring_hour_xfer_tenant_member");
            entity.HasIndex(e => e.LinkedTransferId)
                .HasDatabaseName("idx_caring_hour_xfer_linked");
            entity.HasIndex(e => new { e.TenantId, e.RemoteIdempotencyKey })
                .IsUnique()
                .HasDatabaseName("uq_caring_hour_xfer_remote_idem_tenant");
            entity.HasIndex(e => new { e.TenantId, e.Role, e.IsRemote, e.Status, e.RemoteDeliveryNextRetryAt })
                .HasDatabaseName("idx_caring_hour_remote_outbox_due");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.MemberUser)
                .WithMany()
                .HasForeignKey(e => e.MemberUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringHourGift>(entity =>
        {
            entity.ToTable("caring_hour_gifts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.SenderUserId).HasColumnName("sender_user_id");
            entity.Property(e => e.RecipientUserId).HasColumnName("recipient_user_id");
            entity.Property(e => e.ReservationTransactionId).HasColumnName("reservation_transaction_id");
            entity.Property(e => e.SettlementTransactionId).HasColumnName("settlement_transaction_id");
            entity.Property(e => e.Hours).HasColumnName("hours").HasPrecision(8, 2);
            entity.Property(e => e.Message).HasColumnName("message").HasColumnType("text");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.DeclineReason).HasColumnName("decline_reason").HasColumnType("text");
            entity.Property(e => e.AcceptedAt).HasColumnName("accepted_at");
            entity.Property(e => e.DeclinedAt).HasColumnName("declined_at");
            entity.Property(e => e.RevertedAt).HasColumnName("reverted_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.SenderUserId })
                .HasDatabaseName("caring_hour_gifts_tenant_sender_idx");
            entity.HasIndex(e => new { e.TenantId, e.RecipientUserId })
                .HasDatabaseName("caring_hour_gifts_tenant_recipient_idx");
            entity.HasIndex(e => new { e.TenantId, e.Status })
                .HasDatabaseName("caring_hour_gifts_tenant_status_idx");
            entity.HasIndex(e => new { e.TenantId, e.ReservationTransactionId })
                .IsUnique()
                .HasFilter("\"reservation_transaction_id\" IS NOT NULL");
            entity.HasIndex(e => new { e.TenantId, e.SettlementTransactionId })
                .IsUnique()
                .HasFilter("\"settlement_transaction_id\" IS NOT NULL");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.SenderUser)
                .WithMany()
                .HasForeignKey(e => e.SenderUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.RecipientUser)
                .WithMany()
                .HasForeignKey(e => e.RecipientUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.SettlementTransaction)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.SettlementTransactionId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.ReservationTransaction)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.ReservationTransactionId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringKissTreffen>(entity =>
        {
            entity.ToTable("caring_kiss_treffen");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.EventId).HasColumnName("event_id");
            entity.Property(e => e.TreffenType).HasColumnName("treffen_type").HasMaxLength(40).HasDefaultValue("monthly_stamm").IsRequired();
            entity.Property(e => e.MembersOnly).HasColumnName("members_only").HasDefaultValue(true);
            entity.Property(e => e.QuorumRequired).HasColumnName("quorum_required");
            entity.Property(e => e.FondationHeader).HasColumnName("fondation_header").HasMaxLength(255);
            entity.Property(e => e.MinutesDocumentUrl).HasColumnName("minutes_document_url").HasMaxLength(512);
            entity.Property(e => e.MinutesUploadedAt).HasColumnName("minutes_uploaded_at");
            entity.Property(e => e.MinutesUploadedBy).HasColumnName("minutes_uploaded_by");
            entity.Property(e => e.CoordinatorNotes).HasColumnName("coordinator_notes").HasColumnType("text");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.EventId })
                .IsUnique()
                .HasDatabaseName("caring_kiss_treffen_tenant_event_unique");
            entity.HasIndex(e => new { e.TenantId, e.TreffenType })
                .HasDatabaseName("caring_kiss_treffen_tenant_type_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Event)
                .WithMany()
                .HasForeignKey(e => e.EventId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringRegionalPointAccount>(entity =>
        {
            entity.ToTable("caring_regional_point_accounts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.Balance).HasColumnName("balance").HasPrecision(12, 2).HasDefaultValue(0m);
            entity.Property(e => e.LifetimeEarned).HasColumnName("lifetime_earned").HasPrecision(12, 2).HasDefaultValue(0m);
            entity.Property(e => e.LifetimeSpent).HasColumnName("lifetime_spent").HasPrecision(12, 2).HasDefaultValue(0m);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.UserId })
                .IsUnique()
                .HasDatabaseName("crpa_tenant_user_unique");
            entity.HasIndex(e => new { e.TenantId, e.Balance })
                .HasDatabaseName("crpa_tenant_balance_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringRegionalPointTransaction>(entity =>
        {
            entity.ToTable("caring_regional_point_transactions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.AccountId).HasColumnName("account_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.ActorUserId).HasColumnName("actor_user_id");
            entity.Property(e => e.Type).HasColumnName("type").HasMaxLength(40).IsRequired();
            entity.Property(e => e.Direction).HasColumnName("direction").HasMaxLength(10).IsRequired();
            entity.Property(e => e.Points).HasColumnName("points").HasPrecision(12, 2);
            entity.Property(e => e.BalanceAfter).HasColumnName("balance_after").HasPrecision(12, 2);
            entity.Property(e => e.ReferenceType).HasColumnName("reference_type").HasMaxLength(80);
            entity.Property(e => e.ReferenceId).HasColumnName("reference_id");
            entity.Property(e => e.Description).HasColumnName("description").HasMaxLength(500);
            entity.Property(e => e.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasIndex(e => new { e.TenantId, e.UserId, e.CreatedAt })
                .HasDatabaseName("crpt_tenant_user_created_idx");
            entity.HasIndex(e => new { e.TenantId, e.Type, e.CreatedAt })
                .HasDatabaseName("crpt_tenant_type_created_idx");
            entity.HasIndex(e => new { e.TenantId, e.ReferenceType, e.ReferenceId })
                .HasDatabaseName("crpt_tenant_ref_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Account)
                .WithMany(e => e.Transactions)
                .HasForeignKey(e => e.AccountId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.ActorUser)
                .WithMany()
                .HasForeignKey(e => e.ActorUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MarketplaceSellerRegionalPointSetting>(entity =>
        {
            entity.ToTable("marketplace_seller_regional_point_settings");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.SellerUserId).HasColumnName("seller_user_id");
            entity.Property(e => e.AcceptsRegionalPoints).HasColumnName("accepts_regional_points").HasDefaultValue(false);
            entity.Property(e => e.RegionalPointsPerChf).HasColumnName("regional_points_per_chf").HasPrecision(10, 2).HasDefaultValue(10m);
            entity.Property(e => e.RegionalPointsMaxDiscountPct).HasColumnName("regional_points_max_discount_pct").HasDefaultValue(25);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.SellerUserId })
                .IsUnique()
                .HasDatabaseName("msrps_tenant_seller_unique");
            entity.HasIndex(e => new { e.TenantId, e.AcceptsRegionalPoints })
                .HasDatabaseName("msrps_tenant_accepts_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.SellerUser)
                .WithMany()
                .HasForeignKey(e => e.SellerUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringResearchPartner>(entity =>
        {
            entity.ToTable("caring_research_partners");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Name).HasColumnName("name").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Institution).HasColumnName("institution").HasMaxLength(255).IsRequired();
            entity.Property(e => e.ContactEmail).HasColumnName("contact_email").HasMaxLength(255);
            entity.Property(e => e.AgreementReference).HasColumnName("agreement_reference").HasMaxLength(255);
            entity.Property(e => e.MethodologyUrl).HasColumnName("methodology_url").HasMaxLength(255);
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("draft").IsRequired();
            entity.Property(e => e.DataScope).HasColumnName("data_scope").HasColumnType("jsonb");
            entity.Property(e => e.StartsAt).HasColumnName("starts_at").HasColumnType("date");
            entity.Property(e => e.EndsAt).HasColumnName("ends_at").HasColumnType("date");
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.Status });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Creator)
                .WithMany()
                .HasForeignKey(e => e.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringResearchConsent>(entity =>
        {
            entity.ToTable("caring_research_consents");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.ConsentStatus).HasColumnName("consent_status").HasMaxLength(20).HasDefaultValue("opted_out").IsRequired();
            entity.Property(e => e.ConsentVersion).HasColumnName("consent_version").HasMaxLength(40).HasDefaultValue("research-v1").IsRequired();
            entity.Property(e => e.ConsentedAt).HasColumnName("consented_at");
            entity.Property(e => e.RevokedAt).HasColumnName("revoked_at");
            entity.Property(e => e.Notes).HasColumnName("notes").HasColumnType("text");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at");

            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => new { e.TenantId, e.UserId })
                .IsUnique()
                .HasDatabaseName("caring_research_consents_tenant_user_unique");
            entity.HasIndex(e => new { e.TenantId, e.ConsentStatus })
                .HasDatabaseName("idx_caring_research_consents_tenant_status");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringResearchDatasetExport>(entity =>
        {
            entity.ToTable("caring_research_dataset_exports");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.PartnerId).HasColumnName("partner_id");
            entity.Property(e => e.RequestedBy).HasColumnName("requested_by");
            entity.Property(e => e.DatasetKey).HasColumnName("dataset_key").HasMaxLength(255).HasDefaultValue("caring_community_aggregate_v1").IsRequired();
            entity.Property(e => e.PeriodStart).HasColumnName("period_start").HasColumnType("date").IsRequired();
            entity.Property(e => e.PeriodEnd).HasColumnName("period_end").HasColumnType("date").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("generated").IsRequired();
            entity.Property(e => e.RowCount).HasColumnName("row_count").HasDefaultValue(0);
            entity.Property(e => e.AnonymizationVersion).HasColumnName("anonymization_version").HasMaxLength(255).HasDefaultValue("aggregate-v1").IsRequired();
            entity.Property(e => e.DataHash).HasColumnName("data_hash").HasMaxLength(64).IsRequired();
            entity.Property(e => e.GeneratedAt).HasColumnName("generated_at");
            entity.Property(e => e.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.PartnerId);
            entity.HasIndex(e => new { e.TenantId, e.PartnerId, e.GeneratedAt })
                .HasDatabaseName("caring_research_exports_partner_generated_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Partner)
                .WithMany(e => e.DatasetExports)
                .HasForeignKey(e => e.PartnerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.RequestedByUser)
                .WithMany()
                .HasForeignKey(e => e.RequestedBy)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VereinFederationConsent>(entity =>
        {
            entity.ToTable("verein_federation_consents");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.SharingScope).HasColumnName("sharing_scope").HasMaxLength(20).HasDefaultValue("none").IsRequired();
            entity.Property(e => e.MunicipalityCode).HasColumnName("municipality_code").HasMaxLength(64);
            entity.Property(e => e.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            entity.Property(e => e.OptedInByAdminId).HasColumnName("opted_in_by_admin_id");
            entity.Property(e => e.OptedInAt).HasColumnName("opted_in_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.OrganizationId)
                .IsUnique()
                .HasDatabaseName("verein_fed_consent_org_unique");
            entity.HasIndex(e => new { e.TenantId, e.MunicipalityCode, e.IsActive })
                .HasDatabaseName("verein_fed_consent_lookup_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Organisation)
                .WithMany()
                .HasForeignKey(e => e.OrganizationId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.OptedInByAdmin)
                .WithMany()
                .HasForeignKey(e => e.OptedInByAdminId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<CaringTrustTierConfig>(entity =>
        {
            entity.ToTable("caring_trust_tier_config");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Criteria).HasColumnName("criteria").HasColumnType("jsonb").IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.TenantId)
                .IsUnique()
                .HasDatabaseName("caring_trust_tier_config_tenant_id_unique");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
