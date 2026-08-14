// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for the partner-venues subsystem:
/// PartnerVenue, PartnerMemberPass, PartnerVenueVisit, PartnerVenueStaffMember.
/// Mirrors the Laravel tables from 2026_08_01_000001_create_partner_venue_tables
/// (partner_venue_staff is a deliberate internal divergence — see the entity doc).
/// </summary>
public class PartnerVenueConfiguration : TenantScopedConfiguration
{
    public PartnerVenueConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PartnerVenue>(entity =>
        {
            entity.ToTable("partner_venues");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Name).HasColumnName("name").HasMaxLength(255).IsRequired();
            entity.Property(e => e.Slug).HasColumnName("slug").HasMaxLength(255);
            entity.Property(e => e.Description).HasColumnName("description").HasColumnType("text");
            entity.Property(e => e.Category).HasColumnName("category").HasMaxLength(50);
            entity.Property(e => e.OfferSummary).HasColumnName("offer_summary").HasMaxLength(255);
            entity.Property(e => e.AddressLine).HasColumnName("address_line").HasMaxLength(255);
            entity.Property(e => e.City).HasColumnName("city").HasMaxLength(100);
            entity.Property(e => e.Postcode).HasColumnName("postcode").HasMaxLength(20);
            entity.Property(e => e.Latitude).HasColumnName("latitude").HasPrecision(10, 7);
            entity.Property(e => e.Longitude).HasColumnName("longitude").HasPrecision(10, 7);
            entity.Property(e => e.Website).HasColumnName("website").HasMaxLength(255);
            entity.Property(e => e.ContactEmail).HasColumnName("contact_email").HasMaxLength(255);
            entity.Property(e => e.LogoUrl).HasColumnName("logo_url").HasMaxLength(255);
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20)
                .HasDefaultValue(PartnerVenue.StatusActive).IsRequired();
            entity.Property(e => e.PosterToken).HasColumnName("poster_token").HasMaxLength(64);
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.Slug }).IsUnique();
            entity.HasIndex(e => e.PosterToken).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.Status });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Creator).WithMany().HasForeignKey(e => e.CreatedBy)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PartnerMemberPass>(entity =>
        {
            entity.ToTable("partner_member_passes");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.Token).HasColumnName("token").HasMaxLength(64).IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20)
                .HasDefaultValue(PartnerMemberPass.StatusActive).IsRequired();
            entity.Property(e => e.LastUsedAt).HasColumnName("last_used_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            // Token uniqueness is global, exactly as in Laravel — tenant
            // isolation on lookup comes from the query filter, never the index.
            entity.HasIndex(e => e.Token).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.UserId }).IsUnique();

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PartnerVenueVisit>(entity =>
        {
            entity.ToTable("partner_venue_visits");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.VenueId).HasColumnName("venue_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.RecordedByUserId).HasColumnName("recorded_by_user_id");
            entity.Property(e => e.Source).HasColumnName("source").HasMaxLength(20)
                .HasDefaultValue(PartnerVenueVisit.SourceMemberPass).IsRequired();
            entity.Property(e => e.VisitedOn).HasColumnName("visited_on");
            entity.Property(e => e.VisitedAt).HasColumnName("visited_at");
            entity.Property(e => e.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            // Load-bearing: idempotency key AND the one-visit-per-day ceiling.
            entity.HasIndex(e => new { e.TenantId, e.VenueId, e.UserId, e.VisitedOn }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.VenueId, e.VisitedAt });
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.VisitedAt });
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.VisitedOn });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Venue).WithMany().HasForeignKey(e => e.VenueId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.RecordedByUser).WithMany().HasForeignKey(e => e.RecordedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PartnerVenueStaffMember>(entity =>
        {
            entity.ToTable("partner_venue_staff", table =>
            {
                table.HasCheckConstraint("CK_PartnerVenueStaff_Role",
                    "\"role\" IN ('owner', 'admin', 'member')");
                table.HasCheckConstraint("CK_PartnerVenueStaff_Status",
                    "\"status\" IN ('active', 'pending', 'invited', 'removed')");
            });
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.VenueId).HasColumnName("venue_id");
            entity.Property(e => e.UserId).HasColumnName("user_id");
            entity.Property(e => e.Role).HasColumnName("role").HasMaxLength(20)
                .HasDefaultValue("member").IsRequired();
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(20)
                .HasDefaultValue("active").IsRequired();
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => new { e.TenantId, e.VenueId, e.UserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.Status });

            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Venue).WithMany().HasForeignKey(e => e.VenueId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
