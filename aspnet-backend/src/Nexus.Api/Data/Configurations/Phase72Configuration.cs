// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Phase 72 — entity configurations for the long-tail subsystem
/// (MoneyDonation, Bookmark, BookmarkCollection, PeerEndorsement, UserPresence).
/// </summary>
public class Phase72Configuration : TenantScopedConfiguration
{
    public Phase72Configuration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<MoneyDonation>(entity =>
        {
            entity.ToTable("money_donations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.DonorUserId);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.StripeCheckoutSessionId);
            entity.HasIndex(e => e.StripePaymentIntentId);
            // Filtered-unique index on Stripe top-level event id for idempotent
            // webhook dedup. Stripe retries the same evt_ id on delivery failure;
            // the unique constraint makes the second delivery a no-op via the
            // catch-on-unique-violation path in MoneyDonationService.ApplyWebhookAsync.
            entity.HasIndex(e => e.StripeWebhookEventId)
                .IsUnique()
                .HasFilter("\"StripeWebhookEventId\" IS NOT NULL");
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<BookmarkCollection>(entity =>
        {
            entity.ToTable("bookmark_collections");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<Bookmark>(entity =>
        {
            entity.ToTable("bookmarks");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ContentType).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.CollectionId);
            entity.HasIndex(e => new { e.ContentType, e.ContentId });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Collection).WithMany(c => c.Bookmarks).HasForeignKey(e => e.CollectionId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<PeerEndorsement>(entity =>
        {
            entity.ToTable("peer_endorsements");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.EndorserId);
            entity.HasIndex(e => e.EndorsedUserId);
            entity.HasIndex(e => e.IsHidden);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<UserPresence>(entity =>
        {
            entity.ToTable("user_presence");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.LastSeenAt);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
