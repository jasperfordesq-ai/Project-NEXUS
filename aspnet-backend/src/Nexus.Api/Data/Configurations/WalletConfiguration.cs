// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for wallet and exchange entities:
/// Transaction, Exchange, TransactionCategory, TransactionLimit, BalanceAlert, CreditDonation.
/// </summary>
public class WalletConfiguration : TenantScopedConfiguration
{
    public WalletConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Transaction configuration with tenant filter
        modelBuilder.Entity<Transaction>(entity =>
        {
            entity.ToTable("transactions");
            entity.HasKey(e => e.Id);
            // Tenant-aware financial evidence can only point at a transaction
            // from the same isolation boundary.
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Amount).HasPrecision(10, 2);
            entity.Property(e => e.Description).HasColumnType("text");
            entity.Property(e => e.TransactionType)
                .HasMaxLength(50)
                .HasDefaultValue("transfer");
            entity.Property(e => e.VolunteerLogId).HasColumnName("VolunteerLogId");
            entity.Property(e => e.DeletedForSender).HasDefaultValue(false);
            entity.Property(e => e.DeletedForReceiver).HasDefaultValue(false);

            // Optimistic concurrency control
            entity.Property(e => e.RowVersion)
                .IsRowVersion();

            // Enum conversion
            entity.Property(e => e.Status)
                .HasConversion<string>()
                .HasMaxLength(20);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.SenderId);
            entity.HasIndex(e => e.ReceiverId);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasIndex(e => new { e.TenantId, e.VolunteerLogId })
                .IsUnique()
                .HasFilter("\"VolunteerLogId\" IS NOT NULL")
                .HasDatabaseName("ux_transactions_volunteer_log");

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Sender)
                .WithMany()
                .HasForeignKey(e => e.SenderId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Receiver)
                .WithMany()
                .HasForeignKey(e => e.ReceiverId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Listing)
                .WithMany()
                .HasForeignKey(e => e.ListingId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.VolunteerLog)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.VolunteerLogId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.ClientSetNull);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // Exchange configuration with tenant filter
        modelBuilder.Entity<Exchange>(entity =>
        {
            entity.ToTable("exchanges");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RequestMessage).HasMaxLength(2000);
            entity.Property(e => e.DeclineReason).HasMaxLength(1000);
            entity.Property(e => e.Notes).HasColumnType("text");
            entity.Property(e => e.AgreedHours).HasPrecision(10, 2);
            entity.Property(e => e.ActualHours).HasPrecision(10, 2);

            entity.Property(e => e.Status)
                .HasConversion<string>()
                .HasMaxLength(20);

            entity.Property(e => e.RowVersion)
                .IsRowVersion();

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.ListingId);
            entity.HasIndex(e => e.InitiatorId);
            entity.HasIndex(e => e.ListingOwnerId);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasIndex(e => e.GroupId);

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Listing)
                .WithMany()
                .HasForeignKey(e => e.ListingId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Initiator)
                .WithMany()
                .HasForeignKey(e => e.InitiatorId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.ListingOwner)
                .WithMany()
                .HasForeignKey(e => e.ListingOwnerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Provider)
                .WithMany()
                .HasForeignKey(e => e.ProviderId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Receiver)
                .WithMany()
                .HasForeignKey(e => e.ReceiverId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Transaction)
                .WithMany()
                .HasForeignKey(e => e.TransactionId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(e => e.Group)
                .WithMany()
                .HasForeignKey(e => e.GroupId)
                .OnDelete(DeleteBehavior.SetNull);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // TransactionCategory
        modelBuilder.Entity<TransactionCategory>(entity =>
        {
            entity.ToTable("transaction_categories");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.Property(e => e.Color).HasMaxLength(7);
            entity.Property(e => e.Icon).HasMaxLength(50);
            entity.HasIndex(e => e.TenantId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // TransactionLimit
        modelBuilder.Entity<TransactionLimit>(entity =>
        {
            entity.ToTable("transaction_limits");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.MaxDailyAmount).HasPrecision(10, 2);
            entity.Property(e => e.MaxSingleAmount).HasPrecision(10, 2);
            entity.Property(e => e.MinBalance).HasPrecision(10, 2);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // BalanceAlert
        modelBuilder.Entity<BalanceAlert>(entity =>
        {
            entity.ToTable("balance_alerts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ThresholdAmount).HasPrecision(10, 2);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // CreditDonation
        modelBuilder.Entity<CreditDonation>(entity =>
        {
            entity.ToTable("credit_donations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Amount).HasPrecision(10, 2);
            entity.Property(e => e.Message).HasMaxLength(500);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.DonorId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Donor).WithMany().HasForeignKey(e => e.DonorId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Recipient).WithMany().HasForeignKey(e => e.RecipientId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Transaction).WithMany().HasForeignKey(e => e.TransactionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
