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

public sealed class SafeguardingAttestationMigrationContractTests
{
    private const string MigrationSuffix = "_SafeguardingVettingAttestationParity";

    [Fact]
    public void Migration112_CreatesCanonicalMetadataOnlyTables()
    {
        var migration = Migration112();
        var tables = migration.UpOperations
            .OfType<CreateTableOperation>()
            .ToDictionary(operation => operation.Name, StringComparer.Ordinal);

        tables.Keys.Should().BeEquivalentTo(
            "tenant_safeguarding_settings",
            "member_vetting_attestations",
            "member_vetting_attestation_events",
            "safeguarding_vetting_review_requests",
            "safeguarding_policy_rotation_events");

        AssertColumns(tables["tenant_safeguarding_settings"],
            "tenant_id", "jurisdiction", "policy_version", "configured_by",
            "configured_at", "created_at", "updated_at");
        AssertColumns(tables["member_vetting_attestations"],
            "id", "tenant_id", "user_id", "scheme_code", "attestation_code",
            "purpose_code", "scope_type", "scope_identifier", "decision",
            "confirmed_by", "confirmed_at", "revoked_by", "revoked_at",
            "revocation_reason_code", "policy_version", "created_at", "updated_at");
        AssertColumns(tables["member_vetting_attestation_events"],
            "id", "attestation_id", "tenant_id", "user_id", "scheme_code",
            "attestation_code", "purpose_code", "scope_type", "scope_identifier",
            "event_type", "decision_before", "decision_after", "reason_code",
            "actor_user_id", "policy_version", "created_at");
        AssertColumns(tables["safeguarding_vetting_review_requests"],
            "id", "tenant_id", "user_id", "jurisdiction", "scheme_code",
            "attestation_code", "purpose_code", "scope_type", "scope_identifier",
            "policy_version", "status", "request_source", "requested_by",
            "requested_at", "handled_by", "handled_at", "resolution_code",
            "created_at", "updated_at");
        AssertColumns(tables["safeguarding_policy_rotation_events"],
            "id", "tenant_id", "jurisdiction", "scheme_code", "attestation_code",
            "purpose_code", "scope_type", "scope_identifier", "previous_policy_version",
            "new_policy_version", "reason_code", "actor_user_id",
            "affected_member_count", "created_at");

        var prohibitedFragments = new[]
        {
            "certificate", "document", "evidence", "reference", "issue_date",
            "expiry_date", "identity", "free_text", "notes"
        };
        tables.Values
            .SelectMany(table => table.Columns)
            .Select(column => column.Name)
            .Should().NotContain(column => prohibitedFragments.Any(fragment =>
                column.Contains(fragment, StringComparison.OrdinalIgnoreCase)));
    }

    [Fact]
    public void Migration112_PreservesLaravelNullabilityDefaultsIndexesAndDeletes()
    {
        var migration = Migration112();
        var tables = migration.UpOperations
            .OfType<CreateTableOperation>()
            .ToDictionary(operation => operation.Name, StringComparer.Ordinal);

        var settings = tables["tenant_safeguarding_settings"];
        settings.PrimaryKey!.Columns.Should().Equal("tenant_id");
        Column(settings, "policy_version").DefaultValue.Should().Be("1");
        Column(settings, "configured_at").IsNullable.Should().BeFalse();
        Column(settings, "created_at").IsNullable.Should().BeTrue();
        Column(settings, "updated_at").IsNullable.Should().BeTrue();
        AssertForeignKey(settings, "tenants", ReferentialAction.Cascade, "tenant_id");
        AssertForeignKey(settings, "users", ReferentialAction.SetNull, "configured_by");

        var attestation = tables["member_vetting_attestations"];
        Column(attestation, "scope_type").DefaultValue.Should().Be("tenant");
        Column(attestation, "scope_identifier").DefaultValue.Should().Be(string.Empty);
        Column(attestation, "policy_version").DefaultValue.Should().Be("1");
        Column(attestation, "created_at").IsNullable.Should().BeTrue();
        Column(attestation, "updated_at").IsNullable.Should().BeTrue();
        AssertForeignKey(attestation, "tenants", ReferentialAction.Cascade, "tenant_id");
        AssertForeignKey(attestation, "users", ReferentialAction.Cascade, "user_id");
        AssertForeignKey(attestation, "users", ReferentialAction.SetNull, "confirmed_by");
        AssertForeignKey(attestation, "users", ReferentialAction.SetNull, "revoked_by");

        var auditEvent = tables["member_vetting_attestation_events"];
        Column(auditEvent, "scope_identifier").DefaultValue.Should().Be(string.Empty);
        Column(auditEvent, "created_at").IsNullable.Should().BeFalse();
        AssertForeignKey(auditEvent, "member_vetting_attestations", ReferentialAction.Cascade, "attestation_id");
        AssertForeignKey(auditEvent, "tenants", ReferentialAction.Cascade, "tenant_id");
        AssertForeignKey(auditEvent, "users", ReferentialAction.Cascade, "user_id");
        AssertForeignKey(auditEvent, "users", ReferentialAction.SetNull, "actor_user_id");

        var review = tables["safeguarding_vetting_review_requests"];
        Column(review, "scope_type").DefaultValue.Should().Be("tenant");
        Column(review, "scope_identifier").DefaultValue.Should().Be(string.Empty);
        Column(review, "status").DefaultValue.Should().Be("pending");
        Column(review, "request_source").DefaultValue.Should().Be("member_request");
        Column(review, "requested_at").IsNullable.Should().BeFalse();
        Column(review, "created_at").IsNullable.Should().BeTrue();
        Column(review, "updated_at").IsNullable.Should().BeTrue();
        AssertForeignKey(review, "tenants", ReferentialAction.Cascade, "tenant_id");
        AssertForeignKey(review, "users", ReferentialAction.Cascade, "user_id");
        AssertForeignKey(review, "users", ReferentialAction.SetNull, "requested_by");
        AssertForeignKey(review, "users", ReferentialAction.SetNull, "handled_by");

        var rotation = tables["safeguarding_policy_rotation_events"];
        Column(rotation, "scope_identifier").DefaultValue.Should().Be(string.Empty);
        Column(rotation, "affected_member_count").DefaultValue.Should().Be(0);
        Column(rotation, "created_at").IsNullable.Should().BeFalse();
        AssertForeignKey(rotation, "tenants", ReferentialAction.Cascade, "tenant_id");
        AssertForeignKey(rotation, "users", ReferentialAction.SetNull, "actor_user_id");

        var indexes = migration.UpOperations
            .OfType<CreateIndexOperation>()
            .ToDictionary(operation => operation.Name, StringComparer.Ordinal);
        AssertIndex(indexes, "uq_member_vetting_attestation_scope", true,
            "tenant_id", "user_id", "scheme_code", "attestation_code",
            "purpose_code", "scope_type", "scope_identifier");
        AssertIndex(indexes, "idx_member_vetting_policy_status", false,
            "tenant_id", "user_id", "attestation_code", "purpose_code", "decision");
        AssertIndex(indexes, "idx_vetting_event_member_history", false,
            "tenant_id", "user_id", "created_at");
        AssertIndex(indexes, "idx_vetting_event_actor_history", false,
            "tenant_id", "actor_user_id", "created_at");
        AssertIndex(indexes, "idx_vetting_review_queue", false,
            "tenant_id", "status", "requested_at");
        AssertIndex(indexes, "idx_vetting_review_member", false,
            "tenant_id", "user_id", "purpose_code");
        AssertIndex(indexes, "uq_vetting_review_member_scope", true,
            "tenant_id", "user_id", "purpose_code", "scope_type", "scope_identifier");
        AssertIndex(indexes, "idx_safeguarding_policy_rotation_tenant", false,
            "tenant_id", "created_at");
    }

    [Fact]
    public void Migration112_AddsContentFreeMarkersAndDeactivatesLegacyOfferTrustSignals()
    {
        var migration = Migration112();
        var additions = migration.UpOperations.OfType<AddColumnOperation>().ToArray();

        var requiredAt = additions.Single(operation =>
            operation.Table == "user_safeguarding_preferences"
            && operation.Name == "policy_review_required_at");
        requiredAt.IsNullable.Should().BeTrue();

        var reason = additions.Single(operation =>
            operation.Table == "user_safeguarding_preferences"
            && operation.Name == "policy_review_reason_code");
        reason.IsNullable.Should().BeTrue();
        reason.MaxLength.Should().Be(64);

        var marker = additions.Single(operation =>
            operation.Table == "vetting_records"
            && operation.Name == "legacy_sensitive_metadata_redacted");
        marker.IsNullable.Should().BeFalse();
        marker.DefaultValue.Should().Be(false);

        var dataSql = migration.UpOperations.OfType<SqlOperation>()
            .Should().ContainSingle().Which.Sql;
        dataSql.Should().Contain("tenant_configs");
        dataSql.Should().Contain("attributes.catalog");
        dataSql.Should().Contain("Background Checked");
        dataSql.Should().Contain("Garda Vetted");
        dataSql.Should().Contain("target_type");
        dataSql.Should().Contain("jsonb_set");
        dataSql.Should().NotContain("member_vetting_attestations",
            "legacy catalog claims may be deactivated but must never be promoted into attestation authority");
        dataSql.Should().NotMatchRegex("(?i)\\binsert\\b",
            "the containment step must not manufacture authority rows");
    }

    [Fact]
    public void Migration112_IsForwardOnlyBecauseAuditHistoryMustNotBeDestroyed()
    {
        var migration = Migration112();

        Action inspectRollback = () => _ = migration.DownOperations;

        inspectRollback.Should().Throw<NotSupportedException>();
    }

    private static Migration Migration112()
    {
        using var db = Context();
        var migrations = db.GetService<IMigrationsAssembly>();
        var match = migrations.Migrations.Single(pair =>
            pair.Key.EndsWith(MigrationSuffix, StringComparison.Ordinal));
        return migrations.CreateMigration(match.Value, db.Database.ProviderName!);
    }

    private static void AssertColumns(CreateTableOperation table, params string[] expected)
    {
        table.Columns.Select(column => column.Name).Should().BeEquivalentTo(expected);
    }

    private static AddColumnOperation Column(CreateTableOperation table, string name)
    {
        return table.Columns.Single(column => column.Name == name);
    }

    private static void AssertForeignKey(
        CreateTableOperation table,
        string principalTable,
        ReferentialAction deleteAction,
        params string[] columns)
    {
        var foreignKey = table.ForeignKeys.Single(candidate =>
            candidate.Columns.SequenceEqual(columns));
        foreignKey.PrincipalTable.Should().Be(principalTable);
        foreignKey.OnDelete.Should().Be(deleteAction);
    }

    private static void AssertIndex(
        IReadOnlyDictionary<string, CreateIndexOperation> indexes,
        string name,
        bool unique,
        params string[] columns)
    {
        indexes.Should().ContainKey(name);
        indexes[name].IsUnique.Should().Be(unique);
        indexes[name].Columns.Should().Equal(columns);
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
