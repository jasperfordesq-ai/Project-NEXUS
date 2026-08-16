// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Volunteer records that belong to a member rather than to an organisation:
/// accessibility needs, credentials, and reviews (R-27).
///
/// 🔴 All three had client screens and no table, so each returned an empty list
/// that was indistinguishable from "you have none". Table names mirror
/// Laravel's <c>vol_accessibility_needs</c>, <c>vol_credentials</c> and
/// <c>vol_reviews</c>.
/// 🔴 Column names are Laravel's snake_case, NOT EF's default PascalCase. Two
/// reasons, both discovered the hard way. Existing code already reads
/// <c>vol_reviews</c> with raw SQL using Laravel's names
/// (<c>VolunteerOrganisationService</c>), guarded by "does this table exist" —
/// so creating the table with PascalCase columns broke every organisation
/// listing with <c>column "rating" does not exist</c>. And a test deliberately
/// creates a Laravel-shaped table to prove that path still works. Matching
/// Laravel here also serves the carbon-copy-database goal. Do not tidy these
/// into PascalCase.
/// </summary>
public class VolunteerMemberRecordsConfiguration : TenantScopedConfiguration
{
    public VolunteerMemberRecordsConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<VolunteerAccessibilityNeed>(entity =>
        {
            entity.ToTable("vol_accessibility_needs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.NeedType).HasColumnName("need_type");
            entity.Property(e => e.Description).HasColumnName("description");
            entity.Property(e => e.AccommodationsRequired).HasColumnName("accommodations_required");
            entity.Property(e => e.EmergencyContactName).HasColumnName("emergency_contact_name");
            entity.Property(e => e.EmergencyContactPhone).HasColumnName("emergency_contact_phone");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => e.TenantId);

            // One row per (member, need type) — Laravel's uk_vol_accessibility.
            // Recording the same need twice must update, not duplicate, or the
            // organiser reads contradictory copies of the same requirement.
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.NeedType }).IsUnique();

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerCredential>(entity =>
        {
            entity.ToTable("vol_credentials");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.CredentialType).HasColumnName("credential_type");
            entity.Property(e => e.FileUrl).HasColumnName("file_url");
            entity.Property(e => e.FileName).HasColumnName("file_name");
            entity.Property(e => e.Status).HasColumnName("status");
            entity.Property(e => e.VerifiedBy).HasColumnName("verified_by");
            entity.Property(e => e.VerifiedAt).HasColumnName("verified_at");
            entity.Property(e => e.ExpiresAt).HasColumnName("expires_at");
            entity.Property(e => e.Notes).HasColumnName("notes");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.UserId, e.TenantId });
            entity.HasIndex(e => new { e.Status, e.TenantId });

            // Expiry drives whether someone may work with children and at-risk
            // adults, so it is queried on its own.
            entity.HasIndex(e => e.ExpiresAt);

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);

            // 🔴 SetNull, not Cascade: deleting the staff member who verified a
            // credential must not delete the credential. The record of who
            // cleared someone is a safeguarding artefact.
            entity.HasOne(e => e.Verifier).WithMany().HasForeignKey(e => e.VerifiedBy).OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerReview>(entity =>
        {
            entity.ToTable("vol_reviews");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.ReviewerId).HasColumnName("reviewer_id");
            entity.Property(e => e.TargetType).HasColumnName("target_type");
            entity.Property(e => e.TargetId).HasColumnName("target_id");
            entity.Property(e => e.Rating).HasColumnName("rating");
            entity.Property(e => e.Comment).HasColumnName("comment");
            entity.Property(e => e.Approved).HasColumnName("approved");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TargetType, e.TargetId });
            entity.HasIndex(e => new { e.TenantId, e.ReviewerId });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Reviewer).WithMany().HasForeignKey(e => e.ReviewerId).OnDelete(DeleteBehavior.Cascade);

            // A rating outside 1–5 makes every average meaningless, and an
            // average is the whole reason this table is read. Enforced in the
            // database as well as in validation, because the API is not the
            // only thing that will ever write here.
            entity.ToTable(t => t.HasCheckConstraint("chk_vol_review_rating", "rating BETWEEN 1 AND 5"));

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
