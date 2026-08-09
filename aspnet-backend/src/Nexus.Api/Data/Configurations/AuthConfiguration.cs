// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for authentication-related entities:
/// User, RefreshToken, PasswordResetToken, UserPasskey, TotpBackupCode.
/// </summary>
public class AuthConfiguration : TenantScopedConfiguration
{
    public AuthConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // User configuration with tenant filter
        // NOTE: Each ITenantEntity must have its query filter configured here.
        // The filter ensures users can only see data from their own tenant.
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(e => e.Id);
            // Redundant with the global primary key, but required as the
            // principal for tenant-aware relationships whose FK includes the
            // isolation boundary as well as the user id.
            entity.HasAlternateKey(e => new { e.TenantId, e.Id });
            entity.Property(e => e.Email).HasMaxLength(255).IsRequired();
            entity.Property(e => e.PasswordHash).HasMaxLength(255).IsRequired();
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Username)
                .HasColumnName("username")
                .HasMaxLength(50);
            entity.Property(e => e.Role).HasMaxLength(50).IsRequired();
            entity.Property(e => e.IsAdmin)
                .HasColumnName("is_admin")
                .HasDefaultValue(false);
            entity.Property(e => e.IsSuperAdmin)
                .HasColumnName("is_super_admin")
                .HasDefaultValue(false);
            entity.Property(e => e.IsTenantSuperAdmin)
                .HasColumnName("is_tenant_super_admin")
                .HasDefaultValue(false);
            entity.Property(e => e.IsGod)
                .HasColumnName("is_god")
                .HasDefaultValue(false);
            entity.Property(e => e.IsApproved)
                .HasColumnName("is_approved")
                .HasDefaultValue(false);
            entity.Property(e => e.PreferredLanguage)
                .HasColumnName("preferred_language")
                .HasMaxLength(5)
                .HasDefaultValue("en")
                .IsRequired();
            entity.Property(e => e.NotificationPreferences)
                .HasColumnName("notification_preferences")
                .HasColumnType("text");
            entity.Property(e => e.FederationNotificationsEnabled)
                .HasColumnName("federation_notifications_enabled")
                .HasDefaultValue(true);
            entity.Property(e => e.ShowOnLeaderboard)
                .HasColumnName("show_on_leaderboard")
                .HasDefaultValue(true);
            entity.Property(e => e.TrustTier)
                .HasColumnName("trust_tier")
                .HasDefaultValue(0);

            // Composite unique: email per tenant
            entity.HasIndex(e => new { e.TenantId, e.Email }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.Username })
                .IsUnique()
                .HasDatabaseName("idx_tenant_username");

            // Laravel parity: privileged lookups and tenant role filters are
            // frequent authorization paths, so keep the same supporting indexes.
            entity.HasIndex(e => e.Role).HasDatabaseName("idx_users_role");
            entity.HasIndex(e => e.IsSuperAdmin).HasDatabaseName("idx_users_is_super_admin");
            entity.HasIndex(e => e.IsGod).HasDatabaseName("idx_users_is_god");
            entity.HasIndex(e => new { e.TenantId, e.Role }).HasDatabaseName("idx_users_tenant_role");
            entity.HasIndex(e => new { e.TenantId, e.IsApproved, e.CreatedAt }).HasDatabaseName("idx_users_created_tenant");

            // Relationship
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            // Registration status stored as string for readability
            entity.Property(e => e.RegistrationStatus)
                .HasConversion<string>()
                .HasMaxLength(30)
                .HasDefaultValue(RegistrationStatus.Active);

            // Optimistic concurrency control
            entity.Property(e => e.RowVersion)
                .IsRowVersion();

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // RefreshToken configuration with tenant filter
        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.ToTable("refresh_tokens");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TokenHash).HasMaxLength(255).IsRequired();
            entity.Property(e => e.RevokedReason).HasMaxLength(100);
            entity.Property(e => e.ClientType).HasMaxLength(50);
            entity.Property(e => e.CreatedByIp).HasMaxLength(50);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.TokenHash);
            entity.HasIndex(e => e.ExpiresAt);

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // PasswordResetToken configuration with tenant filter
        modelBuilder.Entity<PasswordResetToken>(entity =>
        {
            entity.ToTable("password_reset_tokens");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TokenHash).HasMaxLength(255).IsRequired();

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.TokenHash);
            entity.HasIndex(e => e.ExpiresAt);

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // WebAuthn/Passkeys
        modelBuilder.Entity<UserPasskey>(entity =>
        {
            entity.ToTable("user_passkeys");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.CredentialId).IsRequired();
            entity.Property(e => e.PublicKey).IsRequired();
            entity.Property(e => e.UserHandle).IsRequired();
            entity.Property(e => e.CredType).HasMaxLength(32);
            entity.Property(e => e.DisplayName).HasMaxLength(255);
            entity.Property(e => e.Transports).HasMaxLength(255);
            entity.HasIndex(e => e.CredentialId).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasIndex(e => e.UserHandle);
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // TOTP Backup Codes
        modelBuilder.Entity<TotpBackupCode>(entity =>
        {
            entity.ToTable("totp_backup_codes");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.UserId).HasColumnName("user_id").IsRequired();
            entity.Property(e => e.TenantId).HasColumnName("tenant_id").IsRequired();
            entity.Property(e => e.CodeHash).HasColumnName("code_hash").IsRequired();
            entity.Property(e => e.IsUsed).HasColumnName("is_used").HasDefaultValue(false);
            entity.Property(e => e.UsedAt).HasColumnName("used_at");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("NOW()");

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => e.UserId);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // Role configuration with tenant filter
        modelBuilder.Entity<Role>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Name).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500);
            entity.Property(e => e.Permissions).HasColumnType("text").IsRequired();

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.Name);
            // Unique constraint: name per tenant
            entity.HasIndex(e => new { e.TenantId, e.Name }).IsUnique();

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
