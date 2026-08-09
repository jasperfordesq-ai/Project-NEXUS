// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for tenant-related entities:
/// Tenant, TenantConfig, TenantRegistrationPolicy, IdentityVerificationSession, IdentityVerificationEvent.
/// </summary>
public class TenantConfiguration : TenantScopedConfiguration
{
    public TenantConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Tenant configuration
        modelBuilder.Entity<Tenant>(entity =>
        {
            entity.ToTable("tenants");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Slug).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Name).HasMaxLength(255).IsRequired();
            entity.HasIndex(e => e.Slug).IsUnique();
        });

        // TenantConfig configuration with tenant filter
        modelBuilder.Entity<TenantConfig>(entity =>
        {
            entity.ToTable("tenant_configs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Key).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Value).HasColumnType("text").IsRequired();

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.Key);
            // Unique constraint: key per tenant
            entity.HasIndex(e => new { e.TenantId, e.Key }).IsUnique();

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // TenantSsoProvider configuration with tenant filter
        modelBuilder.Entity<TenantSsoProvider>(entity =>
        {
            entity.ToTable("tenant_sso_providers");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProviderKey).HasMaxLength(20).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Preset).HasMaxLength(32).HasDefaultValue("generic").IsRequired();
            entity.Property(e => e.IssuerUrl).HasMaxLength(500).IsRequired();
            entity.Property(e => e.ClientId).HasMaxLength(255).IsRequired();
            entity.Property(e => e.ClientSecretEncrypted).HasColumnType("text");
            entity.Property(e => e.Scopes).HasMaxLength(255).HasDefaultValue("openid profile email").IsRequired();
            entity.Property(e => e.AllowedEmailDomains).HasColumnType("jsonb");
            entity.HasIndex(e => e.TenantId).HasDatabaseName("sso_tenant_idx");
            entity.HasIndex(e => new { e.TenantId, e.ProviderKey })
                .IsUnique()
                .HasDatabaseName("sso_tenant_provider_unique");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // TenantRegistrationPolicy configuration
        modelBuilder.Entity<TenantRegistrationPolicy>(entity =>
        {
            entity.ToTable("tenant_registration_policies");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Mode)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(e => e.Provider)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(e => e.VerificationLevel)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(e => e.PostVerificationAction)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(e => e.FallbackMode)
                .HasMaxLength(50)
                .HasDefaultValue("none");

            // One active policy per tenant
            entity.HasIndex(e => new { e.TenantId, e.IsActive })
                .HasFilter("\"IsActive\" = true")
                .IsUnique();

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<OAuthIdentity>(entity =>
        {
            entity.ToTable("oauth_identities");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Provider).HasMaxLength(64).IsRequired();
            entity.Property(e => e.ProviderUserId).HasMaxLength(191).IsRequired();
            entity.Property(e => e.ProviderEmail).HasMaxLength(191);
            entity.Property(e => e.AvatarUrl).HasMaxLength(500);
            entity.Property(e => e.RawPayload).HasColumnType("jsonb");
            entity.HasIndex(e => new { e.Provider, e.ProviderUserId })
                .IsUnique()
                .HasDatabaseName("oauth_identities_provider_uid_unique");
            entity.HasIndex(e => new { e.UserId, e.Provider })
                .IsUnique()
                .HasDatabaseName("oauth_identities_user_provider_unique");
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.ProviderUserId);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<SsoOidcFlow>(entity =>
        {
            entity.ToTable("sso_oidc_flows");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProviderKey).HasMaxLength(20).IsRequired();
            entity.Property(e => e.StateNonceHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.CodeVerifierCiphertext).HasColumnType("text").IsRequired();
            entity.Property(e => e.OidcNonce).HasMaxLength(128).IsRequired();
            entity.Property(e => e.BrowserChallenge).HasMaxLength(43).IsRequired();
            entity.Property(e => e.RedirectUri).HasMaxLength(1000).IsRequired();
            entity.HasIndex(e => e.StateNonceHash).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.ProviderKey, e.ExpiresAt });
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<OAuthCallbackGrant>(entity =>
        {
            entity.ToTable("oauth_callback_grants");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.CodeHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.Provider).HasMaxLength(64).IsRequired();
            entity.Property(e => e.BrowserChallenge).HasMaxLength(43).IsRequired();
            entity.Property(e => e.PendingIdentityCiphertext).HasColumnType("text");
            entity.HasIndex(e => e.CodeHash).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.UserId, e.ExpiresAt });
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // Laravel-compatible tenant invite codes for /api/v2/admin/invite-codes
        modelBuilder.Entity<TenantInviteCode>(entity =>
        {
            entity.ToTable("tenant_invite_codes");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.TenantId).HasColumnName("tenant_id");
            entity.Property(e => e.Code).HasColumnName("code").HasMaxLength(12).IsRequired();
            entity.Property(e => e.CreatedBy).HasColumnName("created_by");
            entity.Property(e => e.MaxUses).HasColumnName("max_uses").HasDefaultValue(1);
            entity.Property(e => e.UsesCount).HasColumnName("uses_count");
            entity.Property(e => e.ExpiresAt).HasColumnName("expires_at");
            entity.Property(e => e.Note).HasColumnName("note").HasMaxLength(255);
            entity.Property(e => e.IsActive).HasColumnName("is_active").HasDefaultValue(true);
            entity.Property(e => e.LastUsedAt).HasColumnName("last_used_at");
            entity.Property(e => e.LastUsedBy).HasColumnName("last_used_by");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");

            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => new { e.TenantId, e.Code })
                .IsUnique()
                .HasDatabaseName("tenant_invite_codes_tenant_code_unique");
            entity.HasIndex(e => new { e.TenantId, e.IsActive, e.CreatedAt })
                .HasDatabaseName("tenant_invite_codes_tenant_active_created_idx");

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.CreatedByUser)
                .WithMany()
                .HasForeignKey(e => e.CreatedBy)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.LastUsedByUser)
                .WithMany()
                .HasForeignKey(e => e.LastUsedBy)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // TenantProviderCredential configuration
        modelBuilder.Entity<TenantProviderCredential>(entity =>
        {
            entity.ToTable("tenant_provider_credentials");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProviderSlug).HasMaxLength(100).IsRequired();
            entity.Property(e => e.CredentialsEncrypted).HasColumnType("text").IsRequired();
            entity.HasIndex(e => new { e.TenantId, e.ProviderSlug }).IsUnique();

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // IdentityVerificationSession configuration
        modelBuilder.Entity<IdentityVerificationSession>(entity =>
        {
            entity.ToTable("identity_verification_sessions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Provider)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(e => e.Level)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(e => e.Status)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.HasIndex(e => new { e.TenantId, e.UserId });
            entity.HasIndex(e => e.ExternalSessionId);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // IdentityVerificationEvent configuration
        modelBuilder.Entity<IdentityVerificationEvent>(entity =>
        {
            entity.ToTable("identity_verification_events");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.PreviousStatus)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(e => e.NewStatus)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.HasIndex(e => e.SessionId);

            entity.HasOne(e => e.Session)
                .WithMany(s => s.Events)
                .HasForeignKey(e => e.SessionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
