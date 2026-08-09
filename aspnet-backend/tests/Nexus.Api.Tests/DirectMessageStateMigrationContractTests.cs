// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Nexus.Api.Data;

namespace Nexus.Api.Tests;

public sealed class DirectMessageStateMigrationContractTests
{
    private const string PredecessorId = "20260712023810_SafeguardingPreferenceDependencyParity";
    private const string MigrationId = "20260712060051_DirectMessageStateParity";

    [Fact]
    public void Migration115_IsImmediatelyAfterTheProvenRuntime114Predecessor()
    {
        using var db = Context();
        var ids = db.GetService<IMigrationsAssembly>().Migrations.Keys.ToArray();
        var index = Array.IndexOf(ids, MigrationId);

        index.Should().Be(114, "this is runtime migration 115 in the maintained chain");
        ids[index - 1].Should().Be(PredecessorId);
    }

    [Fact]
    public void Migration_AddsOnlyContentPreservingMessageLifecycleState()
    {
        var migration = Migration();
        var additions = migration.UpOperations.OfType<AddColumnOperation>().ToArray();

        additions.Should().HaveCount(9);
        additions.Should().OnlyContain(operation => operation.Table == "messages");
        additions.Select(operation => operation.Name).Should().BeEquivalentTo(
            "archived_by_receiver",
            "archived_by_sender",
            "deleted_at",
            "deleted_by_user_id",
            "edited_at",
            "is_deleted",
            "is_deleted_receiver",
            "is_deleted_sender",
            "is_edited");

        var booleans = additions.Where(operation => operation.ClrType == typeof(bool)).ToArray();
        booleans.Should().HaveCount(4);
        booleans.Should().OnlyContain(operation =>
            !operation.IsNullable && Equals(operation.DefaultValue, false));

        additions.Where(operation => operation.ClrType != typeof(bool))
            .Should().OnlyContain(operation => operation.IsNullable);

        migration.UpOperations.Select(operation => operation.GetType()).Distinct()
            .Should().BeEquivalentTo(new[]
            {
                typeof(AddColumnOperation),
                typeof(CreateIndexOperation),
                typeof(AddForeignKeyOperation)
            });
    }

    [Fact]
    public void Migration_MapsCanonicalIndexesAndNullableActorAuditForeignKey()
    {
        var migration = Migration();
        var indexes = migration.UpOperations.OfType<CreateIndexOperation>().ToArray();

        AssertIndex(indexes, "idx_messages_deleted", "is_deleted");
        AssertIndex(indexes, "idx_messages_sender_archived", "SenderId", "archived_by_sender");
        AssertIndex(indexes, "idx_messages_is_deleted_sender",
            "TenantId", "SenderId", "is_deleted_sender");
        AssertIndex(indexes, "idx_messages_conversation_receiver_archived",
            "ConversationId", "archived_by_receiver");
        AssertIndex(indexes, "idx_messages_is_deleted_receiver",
            "TenantId", "ConversationId", "is_deleted_receiver");
        AssertIndex(indexes, "IX_messages_deleted_by_user_id", "deleted_by_user_id");

        var actor = migration.UpOperations.OfType<AddForeignKeyOperation>()
            .Should().ContainSingle().Which;
        actor.Name.Should().Be("FK_messages_users_deleted_by_user_id");
        actor.Table.Should().Be("messages");
        actor.Columns.Should().Equal("deleted_by_user_id");
        actor.PrincipalTable.Should().Be("users");
        actor.PrincipalColumns.Should().Equal("Id");
        actor.OnDelete.Should().Be(ReferentialAction.SetNull);
    }

    [Fact]
    public void PredecessorUpgradeScript_DoesNotRewriteMessagesVoiceOrAttachments()
    {
        using var db = Context();
        var script = db.GetService<IMigrator>().GenerateScript(PredecessorId, MigrationId);

        script.Should().Contain("ADD archived_by_sender timestamp with time zone;");
        script.Should().Contain("ADD is_deleted_sender boolean NOT NULL DEFAULT FALSE");
        script.Should().Contain("FK_messages_users_deleted_by_user_id");
        script.Should().NotContain("UPDATE messages");
        script.Should().NotContain("DELETE FROM messages");
        script.Should().NotContain("DROP COLUMN");
        script.Should().NotContain("voice_messages");
        script.Should().NotContain("message_attachments");
    }

    [Fact]
    public void BlankScript_ReachesMessageStateMigrationWithoutDestructiveFallback()
    {
        using var db = Context();
        var script = db.GetService<IMigrator>().GenerateScript("0", MigrationId);

        script.Should().Contain("CREATE TABLE messages");
        script.Should().Contain(MigrationId);
        script.Should().Contain("ADD archived_by_receiver timestamp with time zone;");
        script.Should().Contain("ADD is_edited boolean NOT NULL DEFAULT FALSE");
    }

    [Fact]
    public void Migration_IsForwardOnlyBecauseRollbackWouldReExposeHiddenHistory()
    {
        var migration = Migration();

        Action inspectRollback = () => _ = migration.DownOperations;

        inspectRollback.Should().Throw<NotSupportedException>()
            .WithMessage("*re-expose participant-hidden messages*");
    }

    private static void AssertIndex(
        IEnumerable<CreateIndexOperation> indexes,
        string name,
        params string[] columns)
    {
        var index = indexes.Single(operation => operation.Name == name);
        index.Table.Should().Be("messages");
        index.Columns.Should().Equal(columns);
        index.IsUnique.Should().BeFalse();
    }

    private static Migration Migration()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        return migrations.CreateMigration(
            migrations.Migrations[MigrationId],
            db.Database.ProviderName!);
    }

    private static NexusDbContext Context()
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql(
                "Host=127.0.0.1;Port=1;Database=nexus_discovery_only;Username=postgres;Password=postgres;Timeout=1")
            .Options;
        return new NexusDbContext(options, new TenantContext());
    }
}
