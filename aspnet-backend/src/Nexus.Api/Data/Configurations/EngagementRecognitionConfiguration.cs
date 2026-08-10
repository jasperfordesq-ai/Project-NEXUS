// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

public sealed class EngagementRecognitionConfiguration(TenantContext tenantContext)
    : TenantScopedConfiguration(tenantContext)
{
    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MonthlyEngagement>(entity =>
        {
            entity.ToTable("monthly_engagement", table =>
                table.HasCheckConstraint("CK_monthly_engagement_activity_count", "activity_count >= 0"));
            entity.HasKey(engagement => engagement.Id);
            entity.Property(engagement => engagement.Id).HasColumnName("id");
            entity.Property(engagement => engagement.TenantId).HasColumnName("tenant_id");
            entity.Property(engagement => engagement.UserId).HasColumnName("user_id");
            entity.Property(engagement => engagement.YearMonth).HasColumnName("year_month").HasMaxLength(7).IsRequired();
            entity.Property(engagement => engagement.WasActive).HasColumnName("was_active").HasDefaultValue(false);
            entity.Property(engagement => engagement.ActivityCount).HasColumnName("activity_count").HasDefaultValue(0);
            entity.Property(engagement => engagement.RecognizedAt).HasColumnName("recognized_at");
            entity.Property(engagement => engagement.CreatedAt).HasColumnName("created_at");
            entity.Property(engagement => engagement.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(engagement => new { engagement.TenantId, engagement.UserId, engagement.YearMonth })
                .IsUnique()
                .HasDatabaseName("uniq_monthly_engagement");
            entity.HasIndex(engagement => engagement.TenantId)
                .HasDatabaseName("idx_me_tenant");
            entity.HasIndex(engagement => new { engagement.UserId, engagement.YearMonth })
                .HasDatabaseName("idx_me_user_month");

            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(engagement => engagement.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>()
                .WithMany()
                .HasForeignKey(engagement => new { engagement.TenantId, engagement.UserId })
                .HasPrincipalKey(user => new { user.TenantId, user.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<SeasonalRecognition>(entity =>
        {
            entity.ToTable("seasonal_recognition", table =>
                table.HasCheckConstraint("CK_seasonal_recognition_months_active", "months_active >= 0"));
            entity.HasKey(recognition => recognition.Id);
            entity.Property(recognition => recognition.Id).HasColumnName("id");
            entity.Property(recognition => recognition.TenantId).HasColumnName("tenant_id");
            entity.Property(recognition => recognition.UserId).HasColumnName("user_id");
            entity.Property(recognition => recognition.Season).HasColumnName("season").HasMaxLength(20).IsRequired();
            entity.Property(recognition => recognition.MonthsActive).HasColumnName("months_active").HasDefaultValue((short)0);
            entity.Property(recognition => recognition.RecognizedAt).HasColumnName("recognized_at");
            entity.Property(recognition => recognition.CreatedAt).HasColumnName("created_at");
            entity.Property(recognition => recognition.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(recognition => new { recognition.TenantId, recognition.UserId, recognition.Season })
                .IsUnique()
                .HasDatabaseName("uniq_seasonal_recognition");
            entity.HasIndex(recognition => recognition.TenantId)
                .HasDatabaseName("idx_sr_tenant");

            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(recognition => recognition.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>()
                .WithMany()
                .HasForeignKey(recognition => new { recognition.TenantId, recognition.UserId })
                .HasPrincipalKey(user => new { user.TenantId, user.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
