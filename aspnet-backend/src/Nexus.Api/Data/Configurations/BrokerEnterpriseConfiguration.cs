// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for broker assignments and enterprise config:
/// BrokerAssignment, BrokerNote, EnterpriseConfig (not tenant-scoped via query filter).
/// </summary>
public class BrokerEnterpriseConfiguration : TenantScopedConfiguration
{
    public BrokerEnterpriseConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BrokerAssignment>(entity =>
        {
            entity.ToTable("broker_assignments");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasMaxLength(30).IsRequired();
            entity.HasIndex(e => new { e.BrokerId, e.Status });
            entity.HasOne(e => e.Broker).WithMany().HasForeignKey(e => e.BrokerId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Member).WithMany().HasForeignKey(e => e.MemberId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<BrokerNote>(entity =>
        {
            entity.ToTable("broker_notes");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Content).IsRequired();
            entity.HasOne(e => e.Broker).WithMany().HasForeignKey(e => e.BrokerId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Member).WithMany().HasForeignKey(e => e.MemberId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SafeguardingOption>(entity =>
        {
            entity.ToTable("safeguarding_options");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.OptionKey).HasMaxLength(120).IsRequired();
            entity.Property(e => e.OptionType).HasMaxLength(40).IsRequired();
            entity.Property(e => e.Label).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(2000);
            entity.Property(e => e.HelpUrl).HasMaxLength(500);
            entity.Property(e => e.PresetSource).HasMaxLength(80);
            entity.HasIndex(e => new { e.TenantId, e.OptionKey }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<UserSafeguardingPreference>(entity =>
        {
            entity.ToTable("user_safeguarding_preferences");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SelectedValue).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.ConsentIp).HasMaxLength(64);
            entity.Property(e => e.ConsentGivenAt).IsRequired();
            entity.Property(e => e.PolicyReviewRequiredAt)
                .HasColumnName("policy_review_required_at");
            entity.Property(e => e.PolicyReviewReasonCode)
                .HasColumnName("policy_review_reason_code")
                .HasMaxLength(64);
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.OptionId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.ReviewReminderSentAt });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Option).WithMany().HasForeignKey(e => e.OptionId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SafeguardingAssignment>(entity =>
        {
            entity.ToTable("safeguarding_assignments");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasMaxLength(30).IsRequired();
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.HasIndex(e => new { e.TenantId, e.WardUserId, e.GuardianUserId, e.RevokedAt });
            entity.HasOne(e => e.Ward).WithMany().HasForeignKey(e => e.WardUserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Guardian).WithMany().HasForeignKey(e => e.GuardianUserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SafeguardingMessageReview>(entity =>
        {
            entity.ToTable("safeguarding_message_reviews");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Severity).HasMaxLength(30).IsRequired();
            entity.Property(e => e.FlagReason).HasMaxLength(120).IsRequired();
            entity.Property(e => e.ReviewNotes).HasMaxLength(4000);
            entity.HasIndex(e => new { e.TenantId, e.MessageId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.IsFlagged, e.ReviewedAt });
            entity.HasOne(e => e.Message).WithMany().HasForeignKey(e => e.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Sender).WithMany().HasForeignKey(e => e.SenderId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Recipient).WithMany().HasForeignKey(e => e.RecipientId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.ReviewedBy).WithMany().HasForeignKey(e => e.ReviewedByUserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<BrokerRiskTag>(entity =>
        {
            entity.ToTable("broker_risk_tags");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RiskLevel).HasMaxLength(30).IsRequired();
            entity.Property(e => e.RiskType).HasMaxLength(120).IsRequired();
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.HasIndex(e => new { e.TenantId, e.ListingId }).IsUnique();
            entity.HasOne(e => e.Listing).WithMany().HasForeignKey(e => e.ListingId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<UserMonitoringRestriction>(entity =>
        {
            entity.ToTable("user_monitoring_restrictions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RequiresBrokerApproval).HasDefaultValue(false);
            entity.Property(e => e.MessagingDisabled)
                .HasColumnName("messaging_disabled")
                .HasDefaultValue(false);
            entity.Property(e => e.Reason).HasMaxLength(2000);
            entity.HasIndex(e => new { e.TenantId, e.UserId }).IsUnique();
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.SetBy).WithMany().HasForeignKey(e => e.SetByUserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // EnterpriseConfig uses TenantId as a partition key but does NOT use a global query filter
        modelBuilder.Entity<EnterpriseConfig>(entity =>
        {
            entity.ToTable("enterprise_configs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Value).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
        });
    }
}
