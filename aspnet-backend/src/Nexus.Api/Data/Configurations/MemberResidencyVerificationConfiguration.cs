// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

public sealed class MemberResidencyVerificationConfiguration(TenantContext tenantContext)
    : TenantScopedConfiguration(tenantContext)
{
    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MemberResidencyVerification>(entity =>
        {
            entity.ToTable("member_residency_verifications", table =>
                table.HasCheckConstraint("CK_member_residency_verifications_status",
                    "status IN ('pending', 'approved', 'rejected')"));
            entity.HasKey(verification => verification.Id);
            entity.Property(verification => verification.Id).HasColumnName("id");
            entity.Property(verification => verification.TenantId).HasColumnName("tenant_id");
            entity.Property(verification => verification.UserId).HasColumnName("user_id");
            entity.Property(verification => verification.DeclaredMunicipality).HasColumnName("declared_municipality").HasMaxLength(120).IsRequired();
            entity.Property(verification => verification.DeclaredPostcode).HasColumnName("declared_postcode").HasMaxLength(24).IsRequired();
            entity.Property(verification => verification.DeclaredAddress).HasColumnName("declared_address").HasMaxLength(255);
            entity.Property(verification => verification.EvidenceNote).HasColumnName("evidence_note").HasColumnType("text");
            entity.Property(verification => verification.Status).HasColumnName("status").HasMaxLength(16).HasDefaultValue("pending");
            entity.Property(verification => verification.AttestedBy).HasColumnName("attested_by");
            entity.Property(verification => verification.AttestedAt).HasColumnName("attested_at");
            entity.Property(verification => verification.RejectionReason).HasColumnName("rejection_reason").HasMaxLength(255);
            entity.Property(verification => verification.CreatedAt).HasColumnName("created_at");
            entity.Property(verification => verification.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(verification => verification.TenantId);
            entity.HasIndex(verification => verification.UserId);
            entity.HasIndex(verification => verification.Status);
            entity.HasIndex(verification => verification.AttestedBy);
            entity.HasIndex(verification => new { verification.TenantId, verification.UserId, verification.Status });
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(verification => verification.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>()
                .WithMany()
                .HasForeignKey(verification => new { verification.TenantId, verification.UserId })
                .HasPrincipalKey(user => new { user.TenantId, user.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>()
                .WithMany()
                .HasForeignKey(verification => new { verification.TenantId, verification.AttestedBy })
                .HasPrincipalKey(user => new { user.TenantId, user.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
