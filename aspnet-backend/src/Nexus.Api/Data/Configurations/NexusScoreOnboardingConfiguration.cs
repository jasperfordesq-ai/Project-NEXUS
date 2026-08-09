// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for NexusScore reputation and onboarding:
/// NexusScore, NexusScoreHistory, OnboardingStep, OnboardingProgress.
/// </summary>
public class NexusScoreOnboardingConfiguration : TenantScopedConfiguration
{
    public NexusScoreOnboardingConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<NexusScore>(entity =>
        {
            entity.ToTable("nexus_scores");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Tier).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.UserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.Score });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<NexusScoreHistory>(entity =>
        {
            entity.ToTable("nexus_score_histories");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.PreviousTier).HasMaxLength(20);
            entity.Property(e => e.NewTier).HasMaxLength(20);
            entity.Property(e => e.Reason).HasMaxLength(200);
            entity.HasIndex(e => new { e.UserId, e.CreatedAt });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<OnboardingStep>(entity =>
        {
            entity.ToTable("onboarding_steps");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Title).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<OnboardingProgress>(entity =>
        {
            entity.ToTable("onboarding_progress");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.UserId, e.StepId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Step).WithMany().HasForeignKey(e => e.StepId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
