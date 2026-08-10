// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configuration for ApiPartner — external API consumers.
/// </summary>
public class ApiPartnerConfiguration : TenantScopedConfiguration
{
    public ApiPartnerConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ApiPartner>(entity =>
        {
            entity.ToTable("api_partners");
            entity.HasKey(e => e.Id);
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.ContactEmail).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(2000);
            entity.Property(e => e.ApiKeyHash).HasMaxLength(128).IsRequired();
            entity.Property(e => e.ApiKeyPrefix).HasMaxLength(16).IsRequired();
            entity.Property(e => e.Scopes).HasMaxLength(500).IsRequired();
            entity.Property(e => e.IsSandbox).HasDefaultValue(true);
            entity.Property(e => e.AllowedIpCidrs).HasColumnType("jsonb");
            entity.Property(e => e.RevokedReason).HasMaxLength(1000);
            entity.Property(e => e.Status).HasConversion<int>();
            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => e.ApiKeyHash).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<ApiPartnerAccessToken>(entity =>
        {
            entity.ToTable("api_partner_access_tokens");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.AccessTokenHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Scopes).HasMaxLength(500).IsRequired();
            entity.HasIndex(e => e.AccessTokenHash).IsUnique();
            entity.HasIndex(e => new { e.PartnerId, e.ExpiresAt });
            entity.HasOne(e => e.Partner)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.PartnerId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<ApiPartnerWalletCredit>(entity =>
        {
            entity.ToTable("api_partner_wallet_credits");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Reference).HasMaxLength(191).IsRequired();
            entity.Property(e => e.ReferenceNormalized).HasMaxLength(191).IsRequired();
            entity.Property(e => e.Hours).HasPrecision(10, 2);
            entity.Property(e => e.Status).HasMaxLength(20).HasDefaultValue("processing").IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.PartnerId, e.ReferenceNormalized })
                .IsUnique()
                .HasDatabaseName("uk_partner_wallet_credit_reference");
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.CompletedAt })
                .HasDatabaseName("idx_partner_wallet_credit_user");
            entity.HasIndex(e => e.TransactionId)
                .IsUnique()
                .HasFilter("\"TransactionId\" IS NOT NULL")
                .HasDatabaseName("idx_partner_wallet_credit_transaction");
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_api_partner_wallet_credits_completion",
                "\"Status\" <> 'completed' OR (\"TransactionId\" IS NOT NULL AND \"CompletedAt\" IS NOT NULL)"));
            entity.HasOne(e => e.Partner)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.PartnerId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.UserId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Transaction)
                .WithMany()
                .HasForeignKey(e => new { e.TenantId, e.TransactionId })
                .HasPrincipalKey(e => new { e.TenantId, e.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
