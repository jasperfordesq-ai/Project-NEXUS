// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for skill entities:
/// Skill, UserSkill, Endorsement.
/// </summary>
public class SkillConfiguration : TenantScopedConfiguration
{
    public SkillConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Skill
        modelBuilder.Entity<Skill>(entity =>
        {
            entity.ToTable("skills");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Category).WithMany().HasForeignKey(e => e.CategoryId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // UserSkill
        modelBuilder.Entity<UserSkill>(entity =>
        {
            entity.ToTable("user_skills");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProficiencyLevel).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.SkillId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Skill).WithMany().HasForeignKey(e => e.SkillId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // Endorsement
        modelBuilder.Entity<Endorsement>(entity =>
        {
            entity.ToTable("endorsements");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Comment).HasMaxLength(500);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.UserSkillId, e.EndorserId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.UserSkill).WithMany(us => us.Endorsements).HasForeignKey(e => e.UserSkillId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Endorser).WithMany().HasForeignKey(e => e.EndorserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.EndorsedUser).WithMany().HasForeignKey(e => e.EndorsedUserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
