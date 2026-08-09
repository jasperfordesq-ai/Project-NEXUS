// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// EF mapping for <see cref="ScheduledJobRun"/>. Global table — no tenant
/// query filter (operators across tenants need the same view).
/// </summary>
public class ScheduledJobRunConfiguration : IEntityGroupConfiguration
{
    public void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ScheduledJobRun>(entity =>
        {
            entity.ToTable("scheduled_job_runs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.JobName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(e => e.ErrorMessage).HasMaxLength(2000);
            entity.HasIndex(e => e.JobName);
            entity.HasIndex(e => new { e.JobName, e.StartedAt });
            entity.HasIndex(e => e.StartedAt);
        });
    }
}
