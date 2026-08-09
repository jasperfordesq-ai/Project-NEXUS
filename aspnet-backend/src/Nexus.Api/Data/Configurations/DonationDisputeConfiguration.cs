// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

public sealed class DonationDisputeConfiguration(TenantContext tenantContext)
    : TenantScopedConfiguration(tenantContext)
{
    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DonationDispute>(entity =>
        {
            entity.ToTable("donation_disputes", table =>
                table.HasCheckConstraint("CK_donation_disputes_amount", "amount >= 0"));
            entity.HasKey(dispute => dispute.Id);
            entity.Property(dispute => dispute.Id).HasColumnName("id");
            entity.Property(dispute => dispute.TenantId).HasColumnName("tenant_id");
            entity.Property(dispute => dispute.VolDonationId).HasColumnName("vol_donation_id");
            entity.Property(dispute => dispute.StripeDisputeId).HasColumnName("stripe_dispute_id").HasMaxLength(120).IsRequired();
            entity.Property(dispute => dispute.PaymentIntentId).HasColumnName("payment_intent_id").HasMaxLength(120);
            entity.Property(dispute => dispute.ChargeId).HasColumnName("charge_id").HasMaxLength(120);
            entity.Property(dispute => dispute.Amount).HasColumnName("amount").HasDefaultValue(0);
            entity.Property(dispute => dispute.Currency).HasColumnName("currency").HasMaxLength(3).HasDefaultValue("gbp").IsRequired();
            entity.Property(dispute => dispute.Status).HasColumnName("status").HasMaxLength(64).HasDefaultValue("needs_response").IsRequired();
            entity.Property(dispute => dispute.Reason).HasColumnName("reason").HasMaxLength(120);
            entity.Property(dispute => dispute.EvidenceDueAt).HasColumnName("evidence_due_at");
            entity.Property(dispute => dispute.PaymentRoute).HasColumnName("payment_route").HasMaxLength(50).HasDefaultValue("platform_default").IsRequired();
            entity.Property(dispute => dispute.StripeAccountId).HasColumnName("stripe_account_id").HasMaxLength(100);
            entity.Property(dispute => dispute.PayloadJson).HasColumnName("payload").HasColumnType("jsonb");
            entity.Property(dispute => dispute.CreatedAt).HasColumnName("created_at");
            entity.Property(dispute => dispute.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(dispute => dispute.StripeDisputeId).IsUnique();
            entity.HasIndex(dispute => new { dispute.TenantId, dispute.Status });
            entity.HasIndex(dispute => new { dispute.TenantId, dispute.CreatedAt });
            entity.HasIndex(dispute => dispute.PaymentIntentId);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(dispute => dispute.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
