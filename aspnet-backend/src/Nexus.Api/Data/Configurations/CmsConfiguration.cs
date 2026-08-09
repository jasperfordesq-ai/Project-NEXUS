// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for blog and CMS content:
/// BlogPost, BlogCategory, Page, PageVersion.
/// </summary>
public class CmsConfiguration : TenantScopedConfiguration
{
    public CmsConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BlogPost>(entity =>
        {
            entity.ToTable("blog_posts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Status).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Excerpt).HasMaxLength(1000);
            entity.Property(e => e.FeaturedImageUrl).HasMaxLength(1000);
            entity.Property(e => e.Tags).HasMaxLength(500);
            entity.Property(e => e.MetaTitle).HasMaxLength(200);
            entity.Property(e => e.MetaDescription).HasMaxLength(500);
            entity.Property(e => e.CanonicalUrl).HasMaxLength(1000);
            entity.Property(e => e.OgImageUrl).HasMaxLength(1000);
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Author).WithMany().HasForeignKey(e => e.AuthorId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Category).WithMany(c => c.Posts).HasForeignKey(e => e.CategoryId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<BlogCategory>(entity =>
        {
            entity.ToTable("blog_categories");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.Property(e => e.Color).HasMaxLength(20);
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<Page>(entity =>
        {
            entity.ToTable("pages");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(500).IsRequired();
            entity.Property(e => e.MenuLocation).HasMaxLength(50);
            entity.Property(e => e.MetaTitle).HasMaxLength(200);
            entity.Property(e => e.MetaDescription).HasMaxLength(500);
            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Parent).WithMany(p => p.Children).HasForeignKey(e => e.ParentId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PageVersion>(entity =>
        {
            entity.ToTable("page_versions");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Slug).HasMaxLength(500).IsRequired();
            entity.HasIndex(e => new { e.PageId, e.VersionNumber }).IsUnique();
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Page).WithMany(p => p.Versions).HasForeignKey(e => e.PageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.CreatedBy).WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
