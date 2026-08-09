// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configuration for Laravel-compatible Verein dues and federation storage.
/// </summary>
public sealed class VereinConfiguration : TenantScopedConfiguration
{
    public VereinConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<VereinMembershipFee>(entity =>
        {
            entity.ToTable("verein_membership_fees", table =>
            {
                table.HasCheckConstraint("CK_verein_membership_fees_amount", "fee_amount_cents > 0");
                table.HasCheckConstraint("CK_verein_membership_fees_billing_cycle", "billing_cycle IN ('annual', 'biennial', 'monthly')");
                table.HasCheckConstraint("CK_verein_membership_fees_grace_period", "grace_period_days BETWEEN 0 AND 65535");
                table.HasCheckConstraint("CK_verein_membership_fees_late_fee", "late_fee_cents IS NULL OR late_fee_cents >= 0");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.FeeAmountCents).HasColumnName("fee_amount_cents");
            entity.Property(e => e.Currency).HasColumnName("currency").HasMaxLength(3).HasDefaultValue("CHF").IsRequired();
            entity.Property(e => e.BillingCycle).HasColumnName("billing_cycle").HasMaxLength(16).HasDefaultValue("annual").IsRequired();
            entity.Property(e => e.GracePeriodDays).HasColumnName("grace_period_days").HasDefaultValue(30);
            entity.Property(e => e.LateFeeCents).HasColumnName("late_fee_cents");
            entity.Property(e => e.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => e.OrganizationId).IsUnique().HasDatabaseName("verein_fees_org_unique");
            entity.HasIndex(e => new { e.TenantId, e.IsActive }).HasDatabaseName("verein_fees_tenant_active_idx");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Organization).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OrganizationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VereinMemberDue>(entity =>
        {
            entity.ToTable("verein_member_dues", table =>
            {
                table.HasCheckConstraint("CK_verein_member_dues_year", "membership_year BETWEEN 0 AND 65535");
                table.HasCheckConstraint("CK_verein_member_dues_amount", "amount_cents >= 0");
                table.HasCheckConstraint("CK_verein_member_dues_status", "status IN ('pending', 'paid', 'overdue', 'waived', 'refunded')");
                table.HasCheckConstraint("CK_verein_member_dues_reminders", "reminder_count >= 0");
            });
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.MembershipYear).HasColumnName("membership_year");
            entity.Property(e => e.AmountCents).HasColumnName("amount_cents");
            entity.Property(e => e.Currency).HasColumnName("currency").HasMaxLength(3).HasDefaultValue("CHF").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(16).HasDefaultValue("pending").IsRequired();
            entity.Property(e => e.DueDate).HasColumnName("due_date").HasColumnType("date");
            entity.Property(e => e.PaidAt).HasColumnName("paid_at");
            entity.Property(e => e.StripePaymentIntentId).HasColumnName("stripe_payment_intent_id").HasMaxLength(191);
            entity.Property(e => e.ReminderCount).HasColumnName("reminder_count").HasDefaultValue(0);
            entity.Property(e => e.LastReminderAt).HasColumnName("last_reminder_at");
            entity.Property(e => e.ReminderEmailFailedAt).HasColumnName("reminder_email_failed_at");
            entity.Property(e => e.ReminderEmailLastError).HasColumnName("reminder_email_last_error").HasColumnType("text");
            entity.Property(e => e.GeneratedEmailSentAt).HasColumnName("generated_email_sent_at");
            entity.Property(e => e.GeneratedEmailFailedAt).HasColumnName("generated_email_failed_at");
            entity.Property(e => e.PaidEmailSentAt).HasColumnName("paid_email_sent_at");
            entity.Property(e => e.PaidEmailFailedAt).HasColumnName("paid_email_failed_at");
            entity.Property(e => e.WaivedByAdminId).HasColumnName("waived_by_admin_id");
            entity.Property(e => e.WaivedReason).HasColumnName("waived_reason").HasMaxLength(500);
            entity.Property(e => e.RefundedAt).HasColumnName("refunded_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => new { e.OrganizationId, e.UserId, e.MembershipYear }).IsUnique().HasDatabaseName("verein_dues_org_user_year_unique");
            entity.HasIndex(e => new { e.OrganizationId, e.MembershipYear }).HasDatabaseName("verein_dues_org_year_idx");
            entity.HasIndex(e => new { e.UserId, e.Status }).HasDatabaseName("verein_dues_user_status_idx");
            entity.HasIndex(e => new { e.TenantId, e.Status }).HasDatabaseName("verein_dues_tenant_status_idx");
            entity.HasIndex(e => e.StripePaymentIntentId).HasDatabaseName("verein_dues_pi_idx");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Organization).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.OrganizationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.UserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.WaivedByAdmin).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.WaivedByAdminId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VereinDuesPayment>(entity =>
        {
            entity.ToTable("verein_dues_payments", table =>
                table.HasCheckConstraint("CK_verein_dues_payments_amount", "amount_cents >= 0"));
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.DuesId).HasColumnName("dues_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.StripePaymentIntentId).HasColumnName("stripe_payment_intent_id").HasMaxLength(191).IsRequired();
            entity.Property(e => e.AmountCents).HasColumnName("amount_cents");
            entity.Property(e => e.Currency).HasColumnName("currency").HasMaxLength(3).HasDefaultValue("CHF").IsRequired();
            entity.Property(e => e.PaidAt).HasColumnName("paid_at");
            entity.Property(e => e.PaymentMethod).HasColumnName("payment_method").HasMaxLength(50);
            entity.Property(e => e.ReceiptUrl).HasColumnName("receipt_url").HasMaxLength(500);
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => e.StripePaymentIntentId).IsUnique().HasDatabaseName("verein_dues_pmts_pi_unique");
            entity.HasIndex(e => new { e.TenantId, e.PaidAt }).HasDatabaseName("verein_dues_pmts_tenant_paid_idx");
            entity.HasIndex(e => e.DuesId).HasDatabaseName("verein_dues_pmts_dues_idx");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Due).WithMany(e => e.Payments)
                .HasForeignKey(e => new { e.TenantId, e.DuesId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VereinEventShare>(entity =>
        {
            entity.ToTable("verein_event_shares", table =>
                table.HasCheckConstraint("CK_verein_event_shares_status", "status IN ('active', 'withdrawn')"));
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SourceOrganizationId).HasColumnName("source_organization_id");
            entity.Property(e => e.TargetOrganizationId).HasColumnName("target_organization_id");
            entity.Property(e => e.EventId).HasColumnName("event_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.SharedAt).HasColumnName("shared_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(16).HasDefaultValue("active").IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => new { e.TargetOrganizationId, e.Status }).HasDatabaseName("verein_event_shares_target_idx");
            entity.HasIndex(e => e.EventId).HasDatabaseName("verein_event_shares_event_idx");
            entity.HasIndex(e => new { e.TenantId, e.SourceOrganizationId }).HasDatabaseName("verein_event_shares_source_idx");
            entity.HasIndex(e => new { e.TenantId, e.EventId, e.TargetOrganizationId }).IsUnique().HasDatabaseName("verein_event_shares_unique_target");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.SourceOrganization).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.SourceOrganizationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.TargetOrganization).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.TargetOrganizationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Event).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.EventId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<VereinCrossInvitation>(entity =>
        {
            entity.ToTable("verein_cross_invitations", table =>
                table.HasCheckConstraint("CK_verein_cross_invitations_status", "status IN ('sent', 'accepted', 'declined', 'expired')"));
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SourceOrganizationId).HasColumnName("source_organization_id");
            entity.Property(e => e.TargetOrganizationId).HasColumnName("target_organization_id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.InviterUserId).HasColumnName("inviter_user_id");
            entity.Property(e => e.InviteeUserId).HasColumnName("invitee_user_id");
            entity.Property(e => e.Message).HasColumnName("message").HasColumnType("text");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(16).HasDefaultValue("sent").IsRequired();
            entity.Property(e => e.SentAt).HasColumnName("sent_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(e => e.RespondedAt).HasColumnName("responded_at");
            entity.Property(e => e.ExpiresAt).HasColumnName("expires_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(e => new { e.TargetOrganizationId, e.Status }).HasDatabaseName("verein_cross_inv_target_idx");
            entity.HasIndex(e => new { e.InviteeUserId, e.Status }).HasDatabaseName("verein_cross_inv_invitee_idx");
            entity.HasIndex(e => new { e.TenantId, e.Status, e.ExpiresAt }).HasDatabaseName("verein_cross_inv_expiry_idx");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.SourceOrganization).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.SourceOrganizationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.TargetOrganization).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.TargetOrganizationId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.InviterUser).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.InviterUserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.InviteeUser).WithMany()
                .HasForeignKey(e => new { e.TenantId, e.InviteeUserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
