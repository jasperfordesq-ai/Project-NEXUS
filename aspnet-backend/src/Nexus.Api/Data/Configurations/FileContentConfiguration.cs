// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for file uploads and content management:
/// FileUpload, KnowledgeArticle, LegalDocument, LegalDocumentAcceptance, UserPreference.
/// </summary>
public class FileContentConfiguration : TenantScopedConfiguration
{
    public FileContentConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FileUpload>(entity =>
        {
            entity.ToTable("file_uploads");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.OriginalFilename).HasMaxLength(500).IsRequired();
            entity.Property(e => e.StoredFilename).HasMaxLength(500).IsRequired();
            entity.Property(e => e.FilePath).HasMaxLength(1000).IsRequired();
            entity.Property(e => e.ContentType).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Category).HasConversion<string>().HasMaxLength(30);
            entity.Property(e => e.EntityType).HasMaxLength(50);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(e => new { e.EntityType, e.EntityId });
            entity.HasIndex(e => e.UserId);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<KnowledgeArticle>(entity =>
        {
            entity.ToTable("knowledge_articles");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();
            entity.Property(e => e.Category).HasMaxLength(100);
            entity.Property(e => e.Tags).HasMaxLength(500);
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.Category);
            entity.HasIndex(e => e.IsPublished);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<LegalDocument>(entity =>
        {
            entity.ToTable("legal_documents");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();
            entity.Property(e => e.Version).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.Slug, e.Version }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<LegalDocumentAcceptance>(entity =>
        {
            entity.ToTable("legal_document_acceptances");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.IpAddress).HasMaxLength(50);
            entity.Property(e => e.UserAgent).HasMaxLength(500);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.LegalDocumentId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.LegalDocument).WithMany().HasForeignKey(e => e.LegalDocumentId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<UserPreference>(entity =>
        {
            entity.ToTable("user_preferences");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Theme).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Language).HasMaxLength(10).IsRequired();
            entity.Property(e => e.Timezone).HasMaxLength(100).IsRequired();
            entity.Property(e => e.EmailDigestFrequency).HasMaxLength(20).IsRequired();
            entity.Property(e => e.ProfileVisibility).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.UserId }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
