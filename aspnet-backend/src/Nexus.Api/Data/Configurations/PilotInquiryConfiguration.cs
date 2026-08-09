// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

public sealed class PilotInquiryConfiguration(TenantContext tenantContext)
    : TenantScopedConfiguration(tenantContext)
{
    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PilotInquiry>(entity =>
        {
            entity.ToTable("pilot_inquiries", table =>
            {
                table.HasCheckConstraint("CK_pilot_inquiries_population", "population IS NULL OR population >= 0");
                table.HasCheckConstraint("CK_pilot_inquiries_timeline_months", "timeline_months IS NULL OR timeline_months >= 0");
                table.HasCheckConstraint("CK_pilot_inquiries_has_kiss_cooperative", "has_kiss_cooperative IN (0, 1)");
                table.HasCheckConstraint("CK_pilot_inquiries_has_existing_digital_tool", "has_existing_digital_tool IN (0, 1)");
                table.HasCheckConstraint("CK_pilot_inquiries_fit_score", "fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)");
                table.HasCheckConstraint("CK_pilot_inquiries_stage",
                    "stage IN ('new', 'qualified', 'proposal_sent', 'pilot_agreed', 'live', 'rejected', 'dormant')");
            });
            entity.HasKey(inquiry => inquiry.Id);
            entity.Property(inquiry => inquiry.Id).HasColumnName("id");
            entity.Property(inquiry => inquiry.TenantId).HasColumnName("tenant_id");
            entity.Property(inquiry => inquiry.MunicipalityName).HasColumnName("municipality_name").HasMaxLength(255).IsRequired();
            entity.Property(inquiry => inquiry.Region).HasColumnName("region").HasMaxLength(255);
            entity.Property(inquiry => inquiry.Country).HasColumnName("country").HasMaxLength(2).IsFixedLength().HasDefaultValue("CH").IsRequired();
            entity.Property(inquiry => inquiry.Population).HasColumnName("population");
            entity.Property(inquiry => inquiry.ContactName).HasColumnName("contact_name").HasMaxLength(255).IsRequired();
            entity.Property(inquiry => inquiry.ContactEmail).HasColumnName("contact_email").HasMaxLength(255).IsRequired();
            entity.Property(inquiry => inquiry.ContactPhone).HasColumnName("contact_phone").HasMaxLength(50);
            entity.Property(inquiry => inquiry.ContactRole).HasColumnName("contact_role").HasMaxLength(100);
            entity.Property(inquiry => inquiry.HasKissCooperative).HasColumnName("has_kiss_cooperative").HasDefaultValue((short)0);
            entity.Property(inquiry => inquiry.HasExistingDigitalTool).HasColumnName("has_existing_digital_tool").HasDefaultValue((short)0);
            entity.Property(inquiry => inquiry.ExistingToolName).HasColumnName("existing_tool_name").HasMaxLength(255);
            entity.Property(inquiry => inquiry.TimelineMonths).HasColumnName("timeline_months");
            entity.Property(inquiry => inquiry.InterestModulesJson).HasColumnName("interest_modules").HasColumnType("jsonb");
            entity.Property(inquiry => inquiry.BudgetIndication).HasColumnName("budget_indication").HasMaxLength(50);
            entity.Property(inquiry => inquiry.Notes).HasColumnName("notes").HasColumnType("text");
            entity.Property(inquiry => inquiry.FitScore).HasColumnName("fit_score").HasPrecision(4, 1);
            entity.Property(inquiry => inquiry.FitBreakdownJson).HasColumnName("fit_breakdown").HasColumnType("jsonb");
            entity.Property(inquiry => inquiry.Stage).HasColumnName("stage").HasMaxLength(20).HasDefaultValue("new").IsRequired();
            entity.Property(inquiry => inquiry.AssignedTo).HasColumnName("assigned_to");
            entity.Property(inquiry => inquiry.ProposalSentAt).HasColumnName("proposal_sent_at");
            entity.Property(inquiry => inquiry.PilotAgreedAt).HasColumnName("pilot_agreed_at");
            entity.Property(inquiry => inquiry.WentLiveAt).HasColumnName("went_live_at");
            entity.Property(inquiry => inquiry.RejectionReason).HasColumnName("rejection_reason").HasColumnType("text");
            entity.Property(inquiry => inquiry.InternalNotes).HasColumnName("internal_notes").HasColumnType("text");
            entity.Property(inquiry => inquiry.Source).HasColumnName("source").HasMaxLength(50);
            entity.Property(inquiry => inquiry.CreatedAt).HasColumnName("created_at");
            entity.Property(inquiry => inquiry.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(inquiry => inquiry.TenantId);
            entity.HasIndex(inquiry => new { inquiry.TenantId, inquiry.Stage });
            entity.HasIndex(inquiry => inquiry.ContactEmail);

            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(inquiry => inquiry.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>()
                .WithMany()
                .HasForeignKey(inquiry => new { inquiry.TenantId, inquiry.AssignedTo })
                .HasPrincipalKey(user => new { user.TenantId, user.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
