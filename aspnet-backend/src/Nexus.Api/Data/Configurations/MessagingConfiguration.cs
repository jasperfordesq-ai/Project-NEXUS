// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;

namespace Nexus.Api.Data.Configurations;

/// <summary>
/// Entity configurations for messaging entities:
/// Conversation, Message, VoiceMessage, MessageAttachment.
/// </summary>
public class MessagingConfiguration : TenantScopedConfiguration
{
    public MessagingConfiguration(TenantContext tenantContext) : base(tenantContext) { }

    public override void Configure(ModelBuilder modelBuilder)
    {
        // Conversation configuration with tenant filter
        modelBuilder.Entity<Conversation>(entity =>
        {
            entity.ToTable("conversations");
            entity.HasKey(e => e.Id);

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.Participant1Id);
            entity.HasIndex(e => e.Participant2Id);
            entity.HasIndex(e => new { e.TenantId, e.Participant1Id, e.Participant2Id }).IsUnique();

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Participant1)
                .WithMany()
                .HasForeignKey(e => e.Participant1Id)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Participant2)
                .WithMany()
                .HasForeignKey(e => e.Participant2Id)
                .OnDelete(DeleteBehavior.Restrict);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // Message configuration with tenant filter
        modelBuilder.Entity<Message>(entity =>
        {
            entity.ToTable("messages");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Content).HasColumnType("text").IsRequired();
            entity.Property(e => e.IsEdited).HasColumnName("is_edited").HasDefaultValue(false);
            entity.Property(e => e.EditedAt).HasColumnName("edited_at");
            entity.Property(e => e.IsDeleted).HasColumnName("is_deleted").HasDefaultValue(false);
            entity.Property(e => e.DeletedAt).HasColumnName("deleted_at");
            entity.Property(e => e.DeletedByUserId).HasColumnName("deleted_by_user_id");
            entity.Property(e => e.IsDeletedSender).HasColumnName("is_deleted_sender").HasDefaultValue(false);
            entity.Property(e => e.IsDeletedReceiver).HasColumnName("is_deleted_receiver").HasDefaultValue(false);
            entity.Property(e => e.ArchivedBySender).HasColumnName("archived_by_sender");
            entity.Property(e => e.ArchivedByReceiver).HasColumnName("archived_by_receiver");

            // Indexes
            entity.HasIndex(e => e.TenantId);
            entity.HasIndex(e => e.ConversationId);
            entity.HasIndex(e => e.SenderId);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasIndex(e => new { e.ConversationId, e.IsRead });
            entity.HasIndex(e => e.IsDeleted)
                .HasDatabaseName("idx_messages_deleted");
            entity.HasIndex(e => new { e.SenderId, e.ArchivedBySender })
                .HasDatabaseName("idx_messages_sender_archived");
            // ASP.NET stores the receiver through Conversation rather than duplicating
            // Laravel's receiver_id on every message. ConversationId is therefore the
            // documented receiver-side lookup equivalent for archive filtering.
            entity.HasIndex(e => new { e.ConversationId, e.ArchivedByReceiver })
                .HasDatabaseName("idx_messages_conversation_receiver_archived");
            entity.HasIndex(e => new { e.TenantId, e.SenderId, e.IsDeletedSender })
                .HasDatabaseName("idx_messages_is_deleted_sender");
            entity.HasIndex(e => new { e.TenantId, e.ConversationId, e.IsDeletedReceiver })
                .HasDatabaseName("idx_messages_is_deleted_receiver");

            // Relationships
            entity.HasOne(e => e.Tenant)
                .WithMany()
                .HasForeignKey(e => e.TenantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Conversation)
                .WithMany(c => c.Messages)
                .HasForeignKey(e => e.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Sender)
                .WithMany()
                .HasForeignKey(e => e.SenderId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.DeletedByUser)
                .WithMany()
                .HasForeignKey(e => e.DeletedByUserId)
                .OnDelete(DeleteBehavior.SetNull);

            // CRITICAL: Global query filter for tenant isolation
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        modelBuilder.Entity<MessageReaction>(entity =>
        {
            entity.ToTable("message_reactions");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.TenantId).HasColumnName("tenant_id");
            entity.Property(row => row.MessageId).HasColumnName("message_id");
            entity.Property(row => row.UserId).HasColumnName("user_id");
            entity.Property(row => row.Emoji).HasColumnName("emoji").HasMaxLength(10).IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(row => row.TenantId).HasDatabaseName("idx_mr_tenant_id");
            entity.HasIndex(row => row.MessageId).HasDatabaseName("idx_mr_message_id");
            entity.HasIndex(row => row.UserId).HasDatabaseName("idx_mr_user_id");
            entity.HasIndex(row => new { row.TenantId, row.MessageId, row.UserId, row.Emoji })
                .IsUnique()
                .HasDatabaseName("unique_reaction_tenant");
            entity.HasOne(row => row.Message).WithMany(message => message.Reactions)
                .HasForeignKey(row => row.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(row => row.User).WithMany()
                .HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(row => row.Tenant).WithMany()
                .HasForeignKey(row => row.TenantId).OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(row => !TenantContext.IsResolved || row.TenantId == TenantContext.TenantId);
        });

        // Voice Messages
        modelBuilder.Entity<VoiceMessage>(entity =>
        {
            entity.ToTable("voice_messages");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.AudioUrl).HasMaxLength(1000).IsRequired();
            entity.Property(e => e.Format).HasMaxLength(10).IsRequired();
            entity.HasIndex(e => new { e.ConversationId, e.CreatedAt });
            entity.HasOne(e => e.Tenant).WithMany().HasForeignKey(e => e.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Sender).WithMany().HasForeignKey(e => e.SenderId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Conversation).WithMany().HasForeignKey(e => e.ConversationId).OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(e => !TenantContext.IsResolved || e.TenantId == TenantContext.TenantId);
        });

        // --- Message Attachments ---
        modelBuilder.Entity<MessageAttachment>(entity =>
        {
            entity.ToTable("message_attachments");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.MessageId);
            entity.HasOne(e => e.Message).WithMany().HasForeignKey(e => e.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.FileUpload).WithMany().HasForeignKey(e => e.FileUploadId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.UploadedBy).WithMany().HasForeignKey(e => e.UploadedById).OnDelete(DeleteBehavior.Restrict);
            // No tenant query filter - MessageAttachment is not tenant-scoped
        });
    }
}
