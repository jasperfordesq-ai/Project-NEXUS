// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class DirectMessageStateSchemaTests
{
    [Fact]
    public void Message_MapsCanonicalLaravelLifecycleColumnsAndDefaults()
    {
        using var db = Context(tenantId: 42);
        var message = Entity<Message>(db);

        message.GetTableName().Should().Be("messages");
        message.GetQueryFilter().Should().NotBeNull();

        AssertColumn(message, nameof(Message.IsEdited), "is_edited", nullable: false, defaultValue: false);
        AssertColumn(message, nameof(Message.EditedAt), "edited_at", nullable: true);
        AssertColumn(message, nameof(Message.IsDeleted), "is_deleted", nullable: false, defaultValue: false);
        AssertColumn(message, nameof(Message.DeletedAt), "deleted_at", nullable: true);
        AssertColumn(message, nameof(Message.DeletedByUserId), "deleted_by_user_id", nullable: true);
        AssertColumn(message, nameof(Message.IsDeletedSender), "is_deleted_sender", nullable: false, defaultValue: false);
        AssertColumn(message, nameof(Message.IsDeletedReceiver), "is_deleted_receiver", nullable: false, defaultValue: false);
        AssertColumn(message, nameof(Message.ArchivedBySender), "archived_by_sender", nullable: true);
        AssertColumn(message, nameof(Message.ArchivedByReceiver), "archived_by_receiver", nullable: true);

        // The Laravel dump permits null in the two legacy global flags, but every
        // read treats null as false. The additive .NET migration converges both to
        // non-null false so new and predecessor rows have one unambiguous state.
        message.FindProperty(nameof(Message.IsEdited))!.ClrType.Should().Be(typeof(bool));
        message.FindProperty(nameof(Message.IsDeleted))!.ClrType.Should().Be(typeof(bool));
    }

    [Fact]
    public void Message_UsesCanonicalAndDocumentedNormalizedLifecycleIndexes()
    {
        using var db = Context(tenantId: 42);
        var message = Entity<Message>(db);

        AssertIndex(message, "idx_messages_deleted", nameof(Message.IsDeleted));
        AssertIndex(message, "idx_messages_sender_archived",
            nameof(Message.SenderId), nameof(Message.ArchivedBySender));
        AssertIndex(message, "idx_messages_is_deleted_sender",
            nameof(Message.TenantId), nameof(Message.SenderId), nameof(Message.IsDeletedSender));

        // ASP.NET normalizes direct-message receiver identity through Conversation;
        // unlike Laravel, it does not duplicate receiver_id on every message row.
        // ConversationId is therefore the receiver-side lookup/index equivalent.
        message.FindProperty("ReceiverId").Should().BeNull();
        AssertIndex(message, "idx_messages_conversation_receiver_archived",
            nameof(Message.ConversationId), nameof(Message.ArchivedByReceiver));
        AssertIndex(message, "idx_messages_is_deleted_receiver",
            nameof(Message.TenantId), nameof(Message.ConversationId), nameof(Message.IsDeletedReceiver));
    }

    [Fact]
    public void Message_PreservesTenantConversationAttachmentAndActorDeleteBehavior()
    {
        using var db = Context(tenantId: 42);
        var message = Entity<Message>(db);

        AssertForeignKey<Message, Tenant>(db, DeleteBehavior.Restrict, nameof(Message.TenantId));
        AssertForeignKey<Message, Conversation>(db, DeleteBehavior.Cascade, nameof(Message.ConversationId));
        AssertForeignKey<Message, User>(db, DeleteBehavior.Restrict, nameof(Message.SenderId));
        AssertForeignKey<Message, User>(db, DeleteBehavior.SetNull, nameof(Message.DeletedByUserId));

        var attachment = Entity<MessageAttachment>(db);
        AssertForeignKey<MessageAttachment, Message>(db, DeleteBehavior.Cascade,
            nameof(MessageAttachment.MessageId));

        var voice = Entity<VoiceMessage>(db);
        voice.GetTableName().Should().Be("voice_messages");
        voice.GetQueryFilter().Should().NotBeNull();
        voice.FindProperty(nameof(VoiceMessage.AudioUrl)).Should().NotBeNull();
    }

    private static void AssertColumn(
        IEntityType entity,
        string propertyName,
        string columnName,
        bool nullable,
        object? defaultValue = null)
    {
        var property = entity.FindProperty(propertyName);
        property.Should().NotBeNull();
        property!.IsNullable.Should().Be(nullable);

        var table = StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema());
        property.GetColumnName(table).Should().Be(columnName);

        if (defaultValue is not null)
        {
            property.GetDefaultValue().Should().Be(defaultValue);
        }
    }

    private static void AssertIndex(IEntityType entity, string databaseName, params string[] properties)
    {
        var index = entity.GetIndexes().Single(candidate =>
            candidate.Properties.Select(property => property.Name).SequenceEqual(properties));
        index.GetDatabaseName().Should().Be(databaseName);
        index.IsUnique.Should().BeFalse();
    }

    private static void AssertForeignKey<TEntity, TPrincipal>(
        NexusDbContext db,
        DeleteBehavior behavior,
        params string[] properties)
        where TEntity : class
        where TPrincipal : class
    {
        var foreignKey = Entity<TEntity>(db).GetForeignKeys().Single(candidate =>
            candidate.Properties.Select(property => property.Name).SequenceEqual(properties));
        foreignKey.PrincipalEntityType.ClrType.Should().Be(typeof(TPrincipal));
        foreignKey.DeleteBehavior.Should().Be(behavior);
    }

    private static IEntityType Entity<TEntity>(NexusDbContext db) where TEntity : class
    {
        return db.Model.FindEntityType(typeof(TEntity))
            ?? throw new InvalidOperationException($"Missing EF mapping for {typeof(TEntity).Name}.");
    }

    private static NexusDbContext Context(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql(
                "Host=127.0.0.1;Port=1;Database=nexus_model_only;Username=postgres;Password=postgres;Timeout=1")
            .Options;
        return new NexusDbContext(options, tenant);
    }
}
