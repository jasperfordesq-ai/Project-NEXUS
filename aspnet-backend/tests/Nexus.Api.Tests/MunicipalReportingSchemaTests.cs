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

public sealed class MunicipalReportingSchemaTests
{
    [Fact]
    public void MunicipalReportTemplate_MapsLaravelReportTemplatesTable()
    {
        var type = Resolve("Nexus.Api.Entities.MunicipalReportTemplate, Nexus.Api");
        typeof(ITenantEntity).IsAssignableFrom(type).Should().BeTrue();

        using var db = CreateDbContext(CreateTenantContext(42));
        var entity = db.Model.FindEntityType(type);

        entity.Should().NotBeNull("municipal_report_templates is a Laravel schema parity table");
        var mappedEntity = entity!;
        mappedEntity.GetTableName().Should().Be("municipal_report_templates");
        mappedEntity.GetQueryFilter().Should().NotBeNull("municipal report templates must stay tenant isolated");

        Column(mappedEntity, "Id").Should().Be("id");
        Column(mappedEntity, "TenantId").Should().Be("tenant_id");
        Column(mappedEntity, "Name").Should().Be("name");
        Column(mappedEntity, "Description").Should().Be("description");
        Column(mappedEntity, "Audience").Should().Be("audience");
        Column(mappedEntity, "DatePreset").Should().Be("date_preset");
        Column(mappedEntity, "IncludeSocialValue").Should().Be("include_social_value");
        Column(mappedEntity, "HourValueChf").Should().Be("hour_value_chf");
        Column(mappedEntity, "Sections").Should().Be("sections");
        Column(mappedEntity, "CreatedBy").Should().Be("created_by");
        Column(mappedEntity, "UpdatedBy").Should().Be("updated_by");
        Column(mappedEntity, "CreatedAt").Should().Be("created_at");
        Column(mappedEntity, "UpdatedAt").Should().Be("updated_at");

        mappedEntity.FindProperty("Name")!.GetMaxLength().Should().Be(160);
        mappedEntity.FindProperty("Audience")!.GetMaxLength().Should().Be(40);
        mappedEntity.FindProperty("Audience")!.GetDefaultValue().Should().Be("municipality");
        mappedEntity.FindProperty("DatePreset")!.GetMaxLength().Should().Be(40);
        mappedEntity.FindProperty("DatePreset")!.GetDefaultValue().Should().Be("last_90_days");
        mappedEntity.FindProperty("IncludeSocialValue")!.GetDefaultValue().Should().Be(true);
        mappedEntity.FindProperty("Sections")!.GetColumnType().Should().Be("jsonb");

        HasIndex(mappedEntity, unique: true, "TenantId", "Name").Should().BeTrue();
    }

    [Fact]
    public void MunicipalVerification_MapsLaravelVerificationsTable()
    {
        var type = Resolve("Nexus.Api.Entities.MunicipalVerification, Nexus.Api");
        typeof(ITenantEntity).IsAssignableFrom(type).Should().BeTrue();

        using var db = CreateDbContext(CreateTenantContext(42));
        var entity = db.Model.FindEntityType(type);

        entity.Should().NotBeNull("municipal_verifications is a Laravel schema parity table");
        var mappedEntity = entity!;
        mappedEntity.GetTableName().Should().Be("municipal_verifications");
        mappedEntity.GetQueryFilter().Should().NotBeNull("municipal verifications must stay tenant isolated");

        Column(mappedEntity, "Id").Should().Be("id");
        Column(mappedEntity, "TenantId").Should().Be("tenant_id");
        Column(mappedEntity, "Domain").Should().Be("domain");
        Column(mappedEntity, "Method").Should().Be("method");
        Column(mappedEntity, "Status").Should().Be("status");
        Column(mappedEntity, "DnsRecordName").Should().Be("dns_record_name");
        Column(mappedEntity, "DnsRecordValue").Should().Be("dns_record_value");
        Column(mappedEntity, "RequestedBy").Should().Be("requested_by");
        Column(mappedEntity, "VerifiedBy").Should().Be("verified_by");
        Column(mappedEntity, "VerifiedAt").Should().Be("verified_at");
        Column(mappedEntity, "RevokedAt").Should().Be("revoked_at");
        Column(mappedEntity, "AttestationNote").Should().Be("attestation_note");
        Column(mappedEntity, "Metadata").Should().Be("metadata");
        Column(mappedEntity, "CreatedAt").Should().Be("created_at");
        Column(mappedEntity, "UpdatedAt").Should().Be("updated_at");

        mappedEntity.FindProperty("Domain")!.GetMaxLength().Should().Be(253);
        mappedEntity.FindProperty("Method")!.GetMaxLength().Should().Be(32);
        mappedEntity.FindProperty("Method")!.GetDefaultValue().Should().Be("dns_txt");
        mappedEntity.FindProperty("Status")!.GetMaxLength().Should().Be(32);
        mappedEntity.FindProperty("Status")!.GetDefaultValue().Should().Be("pending");
        mappedEntity.FindProperty("DnsRecordName")!.GetMaxLength().Should().Be(253);
        mappedEntity.FindProperty("DnsRecordValue")!.GetMaxLength().Should().Be(255);
        mappedEntity.FindProperty("AttestationNote")!.GetMaxLength().Should().Be(1000);
        mappedEntity.FindProperty("Metadata")!.GetColumnType().Should().Be("jsonb");

        HasIndex(mappedEntity, unique: true, "TenantId", "Domain").Should().BeTrue();
        HasIndex(mappedEntity, unique: false, "TenantId", "Status").Should().BeTrue();
    }

    private static bool HasIndex(
        Microsoft.EntityFrameworkCore.Metadata.IEntityType entity,
        bool unique,
        params string[] propertyNames)
    {
        return entity.GetIndexes().Any(index =>
            index.IsUnique == unique
            && index.Properties.Select(property => property.Name).SequenceEqual(propertyNames));
    }

    private static string? Column(Microsoft.EntityFrameworkCore.Metadata.IEntityType entity, string propertyName)
    {
        var table = StoreObjectIdentifier.Table(entity.GetTableName()!, entity.GetSchema());
        return entity.FindProperty(propertyName)?.GetColumnName(table);
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseNpgsql("Host=localhost;Database=nexus_schema_metadata;Username=nexus;Password=nexus")
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"{typeName} should exist for Laravel schema parity");
        return type!;
    }
}
