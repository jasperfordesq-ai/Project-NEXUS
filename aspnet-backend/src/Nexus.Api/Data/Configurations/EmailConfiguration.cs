// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for email entities:
/// EmailTemplate, EmailLog, EmailVerificationToken.
/// </summary>
public class EmailConfiguration : TenantScopedConfiguration
{
    public EmailConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // EmailTemplate
        modelBuilder.Entity<EmailTemplate>(entity =>
        {
            entity.ToTable("email_templates");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Subject).HasMaxLength(500).IsRequired();
            entity.Property(e => e.BodyHtml).HasColumnType("text").IsRequired();
            entity.Property(e => e.BodyText).HasColumnType("text");
            entity.HasIndex(e => e.TenantId);
            // Multi-version templates: unique on (tenant, key, version). Active flag picks
            // which version is current. Without Version in the index, CreateVersionAsync's
            // maxVersion+1 insert violates the constraint and rolls back.
            entity.HasIndex(e => new { e.TenantId, e.Key, e.Version }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // EmailLog
        modelBuilder.Entity<EmailLog>(entity =>
        {
            entity.ToTable("email_logs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ToEmail).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Subject).HasMaxLength(500).IsRequired();
            entity.Property(e => e.TemplateKey).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Provider).HasMaxLength(50).IsRequired().HasDefaultValue("local");
            entity.Property(e => e.ProviderMessageId).HasMaxLength(500);
            entity.Property(e => e.IdempotencyKey).HasMaxLength(191);
            entity.Property(e => e.Source).HasMaxLength(255);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(e => e.ErrorMessage).HasMaxLength(2000);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasIndex(e => new { e.TenantId, e.IdempotencyKey })
                .IsUnique()
                .HasFilter("\"IdempotencyKey\" IS NOT NULL");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // EmailVerificationToken
        modelBuilder.Entity<EmailVerificationToken>(entity =>
        {
            entity.ToTable("email_verification_tokens");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Token).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Email).HasMaxLength(255).IsRequired();
            entity.HasIndex(e => e.Token).IsUnique();
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
