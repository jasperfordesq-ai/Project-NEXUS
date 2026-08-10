// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for jobs module entities:
/// JobVacancy, JobApplication, SavedJob.
/// </summary>
public class JobsConfiguration : TenantScopedConfiguration
{
    public JobsConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // JobVacancy
        modelBuilder.Entity<JobVacancy>(entity =>
        {
            entity.ToTable("job_vacancies");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Description).HasColumnType("text");
            entity.Property(e => e.Category).HasMaxLength(100).IsRequired();
            entity.Property(e => e.JobType).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Location).HasMaxLength(255);
            entity.Property(e => e.TimeCreditsPerHour).HasPrecision(10, 2);
            entity.Property(e => e.RequiredSkills).HasMaxLength(1000);
            entity.Property(e => e.ContactEmail).HasMaxLength(255);
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired();

            entity.HasIndex(e => new { e.TenantId, e.Status });
            entity.HasIndex(e => new { e.TenantId, e.Category });
            entity.HasIndex(e => new { e.TenantId, e.PostedByUserId });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.PostedBy).WithMany().HasForeignKey(e => e.PostedByUserId).OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // JobApplication
        modelBuilder.Entity<JobApplication>(entity =>
        {
            entity.ToTable("job_applications");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.CoverLetter).HasColumnType("text");
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired();
            entity.Property(e => e.ReviewNotes).HasColumnType("text");

            entity.HasIndex(e => new { e.TenantId, e.JobId, e.ApplicantUserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.ApplicantUserId });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Job).WithMany(j => j.Applications).HasForeignKey(e => e.JobId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Applicant).WithMany().HasForeignKey(e => e.ApplicantUserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.ReviewedBy).WithMany().HasForeignKey(e => e.ReviewedByUserId).OnDelete(DeleteBehavior.SetNull);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // SavedJob
        modelBuilder.Entity<SavedJob>(entity =>
        {
            entity.ToTable("saved_jobs");
            entity.HasKey(e => e.Id);

            entity.HasIndex(e => new { e.TenantId, e.UserId, e.JobId }).IsUnique();

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Job).WithMany(j => j.SavedJobs).HasForeignKey(e => e.JobId).OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
