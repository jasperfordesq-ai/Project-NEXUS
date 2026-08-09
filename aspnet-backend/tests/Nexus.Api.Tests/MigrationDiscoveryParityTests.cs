// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Nexus.Api.Data;
using Xunit.Abstractions;

namespace Nexus.Api.Tests;

/// <summary>
/// Fails closed when a migration class silently falls out of EF discovery.
/// The explicit quarantine records legacy source that requires history/schema
/// reconciliation before its metadata can safely be restored.
/// </summary>
public sealed class MigrationDiscoveryParityTests
{
    private static readonly Regex MigrationIdPattern = new(
        "^[0-9]{14}_[A-Za-z0-9_]+$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly IReadOnlyDictionary<string, string> LegacyQuarantine =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["FederationCoreExpansion"] = "20260307181700_FederationCoreExpansion",
            ["AddTenantUpdatedAt"] = "20260305120000_AddTenantUpdatedAt"
        };

    private readonly ITestOutputHelper _output;

    public MigrationDiscoveryParityTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void EveryMigrationClass_IsRuntimeDiscoveredOrExplicitlyQuarantined()
    {
        var migrationTypes = typeof(NexusDbContext).Assembly
            .GetTypes()
            .Where(type => typeof(Migration).IsAssignableFrom(type))
            .OrderBy(type => type.Name, StringComparer.Ordinal)
            .ToArray();
        var sourceByName = migrationTypes.ToDictionary(type => type.Name, StringComparer.Ordinal);

        migrationTypes
            .Where(type => type.IsAbstract)
            .Select(type => type.Name)
            .Should().BeEmpty(
                "migration types must be concrete so EF can discover them");

        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=nexus_discovery_only;Username=postgres;Password=postgres;Timeout=1")
            .Options;
        using var db = new NexusDbContext(options, new TenantContext());
        var discovered = db.GetService<IMigrationsAssembly>().Migrations;
        var discoveredTypes = discovered.Values
            .Select(typeInfo => typeInfo.AsType())
            .ToHashSet();

        var missingQuarantineTypes = LegacyQuarantine.Keys
            .Where(typeName => !sourceByName.ContainsKey(typeName))
            .ToArray();
        missingQuarantineTypes.Should().BeEmpty(
            "every legacy quarantine entry must resolve to one concrete Migration class");

        var unclassified = migrationTypes
            .Where(type => !discoveredTypes.Contains(type) && !LegacyQuarantine.ContainsKey(type.Name))
            .Select(type => type.Name)
            .ToArray();
        unclassified.Should().BeEmpty(
            "new migration classes must be runtime-discovered or deliberately reviewed into quarantine");

        var quarantinedButDiscovered = migrationTypes
            .Where(type => discoveredTypes.Contains(type) && LegacyQuarantine.ContainsKey(type.Name))
            .Select(type => type.Name)
            .ToArray();
        quarantinedButDiscovered.Should().BeEmpty(
            "restoring discovery metadata can replay non-idempotent legacy DDL and requires explicit reconciliation");

        foreach (var (migrationId, typeInfo) in discovered)
        {
            var type = typeInfo.AsType();
            var migrationAttribute = type.GetCustomAttribute<MigrationAttribute>();
            var contextAttribute = type.GetCustomAttribute<DbContextAttribute>();

            migrationAttribute.Should().NotBeNull($"discovered migration {type.Name} needs an explicit id");
            contextAttribute.Should().NotBeNull($"discovered migration {type.Name} needs an explicit DbContext");
            contextAttribute!.ContextType.Should().Be(typeof(NexusDbContext));
            migrationAttribute!.Id.Should().Be(migrationId);
            MigrationIdPattern.IsMatch(migrationId).Should().BeTrue(
                $"discovered migration id {migrationId} must use the timestamp_name format");
        }

        LegacyQuarantine.Values.Should().OnlyHaveUniqueItems();
        foreach (var (typeName, migrationId) in LegacyQuarantine)
        {
            MigrationIdPattern.IsMatch(migrationId).Should().BeTrue(
                $"quarantined intended id {migrationId} must use the timestamp_name format");
            migrationId.EndsWith($"_{typeName}", StringComparison.Ordinal).Should().BeTrue(
                $"quarantined intended id {migrationId} must belong to migration type {typeName}");
        }

        discovered.Keys
            .Concat(LegacyQuarantine.Values)
            .Should().OnlyHaveUniqueItems(
                "discovered and quarantined intended migration ids must never collide");

        migrationTypes.Should().HaveCount(discovered.Count + LegacyQuarantine.Count);

        _output.WriteLine(
            "Migration discovery: source={0}, discovered={1}, quarantined={2}",
            migrationTypes.Length,
            discovered.Count,
            LegacyQuarantine.Count);
        _output.WriteLine("Discovered ids:\n{0}", string.Join("\n", discovered.Keys.OrderBy(id => id, StringComparer.Ordinal)));
        _output.WriteLine(
            "Quarantined ids:\n{0}",
            string.Join("\n", LegacyQuarantine.Values.OrderBy(id => id, StringComparer.Ordinal)));
    }
}
