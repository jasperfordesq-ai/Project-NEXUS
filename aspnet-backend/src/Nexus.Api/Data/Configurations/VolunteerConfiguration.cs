// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for volunteer and staffing entities:
/// VolunteerOpportunity, VolunteerShift, VolunteerApplication, VolunteerCheckIn,
/// VolunteerAvailability, StaffingPrediction.
/// </summary>
public class VolunteerConfiguration : TenantScopedConfiguration
{
    public VolunteerConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Dedicated volunteer organisations. Do not map these onto the generic
        // Organisation model: Laravel treats the two lifecycles independently.
        modelBuilder.Entity<VolunteerOrganisation>(entity =>
        {
            entity.ToTable("vol_organizations", table =>
            {
                table.HasCheckConstraint(
                    "CK_VolunteerOrganisations_Status",
                    "\"status\" IN ('pending', 'approved', 'active', 'declined', 'suspended')");
            });
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.OwnerUserId).HasColumnName("user_id");
            entity.Property(e => e.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            entity.Property(e => e.Slug).HasColumnName("slug").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(e => e.ContactEmail).HasColumnName("contact_email").HasMaxLength(255);
            entity.Property(e => e.Website).HasColumnName("website").HasMaxLength(500);
            entity.Property(e => e.LogoUrl).HasColumnName("logo_url").HasMaxLength(500);
            entity.Property(e => e.Location).HasColumnName("location").HasMaxLength(500);
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.OrgType).HasColumnName("org_type").HasMaxLength(50).HasDefaultValue("organisation");
            entity.Property(e => e.MeetingSchedule).HasColumnName("meeting_schedule").HasMaxLength(255);
            entity.Property(e => e.AutoPayEnabled).HasColumnName("auto_pay_enabled").HasDefaultValue(false);
            entity.Property(e => e.Balance).HasColumnName("balance").HasPrecision(10, 2).HasDefaultValue(0m);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.OrgType, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.OwnerUserId });
            entity.HasIndex(e => new { e.TenantId, e.Balance });
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.OwnerUser)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OwnerUserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerOrganisationMember>(entity =>
        {
            entity.ToTable("org_members", table =>
            {
                table.HasCheckConstraint(
                    "CK_VolunteerOrganisationMembers_Role",
                    "\"role\" IN ('owner', 'admin', 'manager', 'coordinator', 'member')");
                table.HasCheckConstraint(
                    "CK_VolunteerOrganisationMembers_Status",
                    "\"status\" IN ('active', 'pending', 'invited', 'removed')");
                table.HasCheckConstraint(
                    "CK_VolunteerOrganisationMembers_OrgType",
                    "\"org_type\" = 'volunteer'");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.VolunteerOrganisationId).HasColumnName("organization_id");
            entity.Property(e => e.OrgType).HasColumnName("org_type").HasMaxLength(20).HasDefaultValue("volunteer").IsRequired();
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.Role).HasColumnName("role").HasMaxLength(20).IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => new { e.TenantId, e.OrgType, e.VolunteerOrganisationId, e.UserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.VolunteerOrganisationId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.Status });
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.VolunteerOrganisation)
                .WithMany(e => e.Members)
                .HasForeignKey(e => new { e.TenantId, e.VolunteerOrganisationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.UserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VolunteerOrganisationTransaction>(entity =>
        {
            entity.ToTable("vol_org_transactions", table =>
            {
                table.HasCheckConstraint(
                    "CK_VolunteerOrganisationTransactions_Type",
                    "\"type\" IN ('deposit', 'withdrawal', 'volunteer_payment', 'admin_adjustment')");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.VolunteerOrganisationId).HasColumnName("vol_organization_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.VolunteerLogId).HasColumnName("vol_log_id");
            entity.Property(e => e.Type).HasColumnName("type").HasMaxLength(30).IsRequired();
            entity.Property(e => e.Amount).HasColumnName("amount").HasPrecision(10, 2);
            entity.Property(e => e.BalanceAfter).HasColumnName("balance_after").HasPrecision(10, 2);
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(e => new { e.TenantId, e.VolunteerOrganisationId });
            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasIndex(e => e.VolunteerLogId);
            entity.HasIndex(e => new { e.TenantId, e.VolunteerLogId, e.Type })
                .IsUnique()
                .HasFilter("\"vol_log_id\" IS NOT NULL");
            entity.HasIndex(e => e.CreatedAt);
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.VolunteerOrganisation)
                .WithMany(e => e.Transactions)
                .HasForeignKey(e => new { e.TenantId, e.VolunteerOrganisationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.UserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);
            entity.HasOne(e => e.VolunteerLog)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.VolunteerLogId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // VolunteerOpportunity
        modelBuilder.Entity<VolunteerOpportunity>(entity =>
        {
            entity.ToTable("volunteer_opportunities");
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnType("text");
            entity.Property(e => e.Location).HasMaxLength(500);
            entity.Property(e => e.SkillsRequired).HasColumnType("text");
            entity.Property(e => e.CreditReward).HasPrecision(10, 2);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(e => e.VolunteerOrganisationId).HasColumnName("organization_id");
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.OrganizerId);
            entity.HasIndex(e => new { e.TenantId, e.VolunteerOrganisationId });
            entity.HasIndex(e => new { e.TenantId, e.VolunteerOrganisationId, e.Id })
                .IsUnique()
                .HasDatabaseName("ux_volunteer_opportunities_tenant_org_id");
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.StartsAt);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Organizer)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OrganizerId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            // Nullable and deliberately not backfilled from OrganizerId: that
            // column is a user/created_by key, not an organisation identifier.
            entity.HasOne(e => e.VolunteerOrganisation)
                .WithMany(e => e.Opportunities)
                .HasForeignKey(e => new { e.TenantId, e.VolunteerOrganisationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Group).WithMany().HasForeignKey(e => e.GroupId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Category).WithMany().HasForeignKey(e => e.CategoryId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // VolunteerShift
        modelBuilder.Entity<VolunteerShift>(entity =>
        {
            entity.ToTable("volunteer_shifts");
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.HasAlternateKey(e => new { e.TenantId, e.OpportunityId, e.Id });
            entity.Property(e => e.Title).HasMaxLength(255);
            entity.Property(e => e.Location).HasMaxLength(500);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.OpportunityId);
            entity.HasIndex(e => e.StartsAt);
            entity.HasIndex(e => new { e.TenantId, e.RecurringPatternId, e.StartsAt })
                .IsUnique()
                .HasFilter("\"RecurringPatternId\" IS NOT NULL");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Opportunity)
                .WithMany(o => o.Shifts)
                .HasForeignKey(e => new { e.TenantId, e.OpportunityId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // RecurringShiftPattern
        modelBuilder.Entity<RecurringShiftPattern>(entity =>
        {
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_RecurringShiftPatterns_SpotsPerShift_NonNegative",
                    "\"SpotsPerShift\" >= 0");
                table.HasCheckConstraint(
                    "CK_RecurringShiftPatterns_Capacity_NonNegative",
                    "\"Capacity\" >= 0");
                table.HasCheckConstraint(
                    "CK_RecurringShiftPatterns_MaxOccurrences_NonNegative",
                    "\"MaxOccurrences\" IS NULL OR \"MaxOccurrences\" >= 0");
                table.HasCheckConstraint(
                    "CK_RecurringShiftPatterns_OccurrencesGenerated_NonNegative",
                    "\"OccurrencesGenerated\" >= 0");
            });
            // Keep database defaults for non-EF writers without treating CLR
            // zero as "unset"; Laravel accepts explicit zero values here.
            entity.Property(e => e.SpotsPerShift).HasDefaultValue(1).ValueGeneratedNever();
            entity.Property(e => e.Capacity).HasDefaultValue(1).ValueGeneratedNever();
            entity.HasIndex(e => e.CreatedBy);
            entity.HasIndex(e => new { e.TenantId, e.IsActive, e.EndDate });
            entity.HasOne(e => e.Creator)
                .WithMany()
                .HasForeignKey(e => e.CreatedBy)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // VolunteerApplication
        modelBuilder.Entity<VolunteerApplication>(entity =>
        {
            entity.ToTable("volunteer_applications");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Message).HasMaxLength(2000);
            entity.Property(e => e.OrgNote).HasMaxLength(2000);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.OpportunityId);
            entity.HasIndex(e => e.ShiftId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => new { e.TenantId, e.ShiftId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.OpportunityId, e.ShiftId });
            // Historical declined/withdrawn applications are retained and a
            // volunteer may reapply. Active duplicate prevention is serialized
            // by VolunteerService rather than a natural-key unique constraint.
            entity.HasIndex(e => new { e.TenantId, e.OpportunityId, e.UserId });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Opportunity)
                .WithMany(o => o.Applications)
                .HasForeignKey(e => new { e.TenantId, e.OpportunityId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Shift)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OpportunityId, e.ShiftId })
                .HasPrincipalKey(e => new { e.TenantId, e.OpportunityId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.UserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.ReviewedBy)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.ReviewedById })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // Capacity checks count active group reservations for one tenant/shift.
        modelBuilder.Entity<ShiftGroupReservation>(entity =>
        {
            entity.HasIndex(e => new { e.TenantId, e.ShiftId, e.Status });
        });

        // VolunteerCheckIn
        modelBuilder.Entity<VolunteerCheckIn>(entity =>
        {
            entity.ToTable("volunteer_check_ins", table =>
            {
                table.HasCheckConstraint(
                    "CK_VolunteerCheckIns_Status",
                    "\"Status\" IN ('pending', 'checked_in', 'checked_out', 'no_show')");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.QrToken).HasMaxLength(64);
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.HoursLogged).HasPrecision(10, 2);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.UpdatedAt).HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.HasIndex(e => new { e.TenantId, e.ShiftId });
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.ShiftId, e.UserId }).IsUnique();
            entity.HasIndex(e => e.QrToken)
                .IsUnique()
                .HasFilter("\"QrToken\" IS NOT NULL");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Shift)
                .WithMany(s => s.CheckIns)
                .HasForeignKey(e => new { e.TenantId, e.ShiftId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.UserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.CheckedInBy)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.CheckedInById })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.CheckedOutBy)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.CheckedOutById })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Transaction)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.TransactionId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // StaffingPrediction (Phase 36)
        modelBuilder.Entity<StaffingPrediction>(entity =>
        {
            entity.ToTable("staffing_predictions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ShortfallRisk).HasPrecision(5, 4);
            entity.Property(e => e.Factors).HasColumnType("text");
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.PredictedDate);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Opportunity).WithMany().HasForeignKey(e => e.OpportunityId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // VolunteerAvailability (Phase 36)
        modelBuilder.Entity<VolunteerAvailability>(entity =>
        {
            entity.ToTable("volunteer_availabilities");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.DayOfWeek });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
