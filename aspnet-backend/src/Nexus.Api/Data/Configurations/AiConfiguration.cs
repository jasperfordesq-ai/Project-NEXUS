// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for AI-related entities:
/// AiConversation, AiMessage.
/// </summary>
public class AiConfiguration : TenantScopedConfiguration
{
    public AiConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AiConversation>(entity =>
        {
            entity.ToTable("ai_conversations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(255);
            entity.Property(e => e.Context).HasMaxLength(500);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasIndex(e => e.IsActive);

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

        // AiMessage configuration with tenant filter (defense-in-depth)
        modelBuilder.Entity<AiMessage>(entity =>
        {
            entity.ToTable("ai_messages");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Role).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.ConversationId);
            entity.HasIndex(e => e.CreatedAt);

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Conversation)
                .WithMany(c => c.Messages)
                .HasForeignKey(e => e.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ─── Knowledge index chunks ─────────────────────────────────────────
        modelBuilder.Entity<KnowledgeChunk>(entity =>
        {
            entity.ToTable("knowledge_chunks");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.SourceType).HasMaxLength(32).IsRequired();
            entity.Property(e => e.Title).HasMaxLength(255).IsRequired();
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();
            entity.Property(e => e.EmbeddingProvider).HasMaxLength(32).IsRequired();
            entity.Property(e => e.EmbeddingModel).HasMaxLength(64).IsRequired();
            entity.Property(e => e.ContentHash).HasMaxLength(64).IsRequired();
            entity.Property(e => e.MetadataJson).HasColumnType("jsonb").HasDefaultValue("{}");
            entity.Property(e => e.Embedding).HasColumnType("real[]");

            entity.HasIndex(e => new { e.TenantId, e.SourceType, e.SourceId, e.ChunkIndex }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.SourceType });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ─── AI message feedback (thumbs up / down) ─────────────────────────
        modelBuilder.Entity<AiMessageFeedback>(entity =>
        {
            entity.ToTable("ai_message_feedback");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Comment).HasMaxLength(2000);
            entity.Property(e => e.ReasonCode).HasMaxLength(64);

            entity.HasIndex(e => new { e.TenantId, e.AiMessageId, e.UserId }).IsUnique();
            entity.HasIndex(e => new { e.TenantId, e.CreatedAt });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.AiMessage)
                .WithMany()
                .HasForeignKey(e => e.AiMessageId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ─── AI request audit log ───────────────────────────────────────────
        modelBuilder.Entity<AiRequestAuditLog>(entity =>
        {
            entity.ToTable("ai_request_audit_logs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RequestType).HasMaxLength(32).IsRequired();
            entity.Property(e => e.Provider).HasMaxLength(32).IsRequired();
            entity.Property(e => e.Model).HasMaxLength(64).IsRequired();
            entity.Property(e => e.ToolsInvoked).HasMaxLength(512);
            entity.Property(e => e.Outcome).HasMaxLength(32).IsRequired();
            entity.Property(e => e.Notes).HasMaxLength(500);

            entity.HasIndex(e => new { e.TenantId, e.CreatedAt });
            entity.HasIndex(e => new { e.TenantId, e.Outcome });

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // ─── AI conversation long-memory (rolling summary) ──────────────────
        modelBuilder.Entity<AiConversationLongMemory>(entity =>
        {
            entity.ToTable("ai_conversation_long_memory");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Summary).HasColumnType("text").IsRequired();

            entity.HasIndex(e => new { e.TenantId, e.ConversationId }).IsUnique();

            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Conversation)
                .WithMany()
                .HasForeignKey(e => e.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });
    }
}
