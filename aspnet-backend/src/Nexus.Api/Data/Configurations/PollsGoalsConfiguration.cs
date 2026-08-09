// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for polls and goals:
/// Poll, PollOption, PollVote, Goal, GoalMilestone.
/// </summary>
public class PollsGoalsConfiguration : TenantScopedConfiguration
{
    public PollsGoalsConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Poll>(entity =>
        {
            entity.ToTable("polls");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.PollType).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Group).WithMany().HasForeignKey(e => e.GroupId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PollOption>(entity =>
        {
            entity.ToTable("poll_options");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Text).HasMaxLength(255).IsRequired();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Poll).WithMany(p => p.Options).HasForeignKey(e => e.PollId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PollVote>(entity =>
        {
            entity.ToTable("poll_votes");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.TenantId, e.PollId, e.UserId, e.OptionId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Poll).WithMany(p => p.Votes).HasForeignKey(e => e.PollId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Option).WithMany(o => o.Votes).HasForeignKey(e => e.OptionId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<Goal>(entity =>
        {
            entity.ToTable("goals");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.GoalType).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<GoalMilestone>(entity =>
        {
            entity.ToTable("goal_milestones");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Goal).WithMany(g => g.Milestones).HasForeignKey(e => e.GoalId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
