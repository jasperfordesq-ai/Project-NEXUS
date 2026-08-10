// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

public sealed class SalaryBenchmarkConfiguration : IEntityGroupConfiguration
{
    public void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SalaryBenchmark>(entity =>
        {
            entity.ToTable("salary_benchmarks", table =>
                table.HasCheckConstraint("CK_salary_benchmarks_salary_type",
                    "salary_type IN ('hourly', 'monthly', 'annual')"));
            entity.HasKey(benchmark => benchmark.Id);
            entity.Property(benchmark => benchmark.Id).HasColumnName("id");
            entity.Property(benchmark => benchmark.TenantId).HasColumnName("tenant_id");
            entity.Property(benchmark => benchmark.RoleKeyword).HasColumnName("role_keyword").HasMaxLength(100).IsRequired();
            entity.Property(benchmark => benchmark.Industry).HasColumnName("industry").HasMaxLength(100);
            entity.Property(benchmark => benchmark.Location).HasColumnName("location").HasMaxLength(100);
            entity.Property(benchmark => benchmark.SalaryMin).HasColumnName("salary_min").HasPrecision(10, 2);
            entity.Property(benchmark => benchmark.SalaryMax).HasColumnName("salary_max").HasPrecision(10, 2);
            entity.Property(benchmark => benchmark.SalaryMedian).HasColumnName("salary_median").HasPrecision(10, 2);
            entity.Property(benchmark => benchmark.SalaryType).HasColumnName("salary_type").HasMaxLength(10).HasDefaultValue("annual");
            entity.Property(benchmark => benchmark.Currency).HasColumnName("currency").HasMaxLength(10).HasDefaultValue("EUR");
            entity.Property(benchmark => benchmark.Year).HasColumnName("year").HasDefaultValue((short)2026);
            entity.Property(benchmark => benchmark.Source).HasColumnName("source").HasMaxLength(200);
            entity.Property(benchmark => benchmark.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("CURRENT_TIMESTAMP");

            entity.HasIndex(benchmark => benchmark.RoleKeyword).HasDatabaseName("idx_benchmark_role");
            entity.HasIndex(benchmark => benchmark.TenantId).HasDatabaseName("salary_benchmarks_tenant_id_index");
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(benchmark => benchmark.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            // NULL tenant_id denotes a global benchmark. Matching code must
            // combine global rows with tenant-specific rows explicitly.
        });
    }
}
