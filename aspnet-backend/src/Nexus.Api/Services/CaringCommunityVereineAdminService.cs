// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;

namespace Nexus.Api.Services;

/// <summary>
/// Admin Verein membership actions backed by the .NET organisation model.
/// Mirrors Laravel's Caring Community Verein admin-assignment contract.
/// </summary>
public sealed class CaringCommunityVereineAdminService
{
    private readonly NexusDbContext _db;

    public CaringCommunityVereineAdminService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "features.caring_community")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return IsTruthy(raw);
    }

    public async Task<VereinAdminAssignmentResult> PreviewVereinMemberImportAsync(
        int tenantId,
        int organizationId,
        string csv,
        CancellationToken ct)
    {
        var organization = await LoadVereinAsync(tenantId, organizationId, ct);
        if (organization is null)
        {
            return VereinAdminAssignmentResult.Fail("VALIDATION_ERROR");
        }

        var parsed = ParseCsv(csv);
        if (!parsed.Succeeded)
        {
            return VereinAdminAssignmentResult.Fail("VALIDATION_ERROR");
        }

        var preview = await BuildPreviewAsync(tenantId, organization, parsed.Rows, ct);
        return VereinAdminAssignmentResult.Success(PreviewPayload(preview));
    }

    public async Task<VereinAdminAssignmentResult> ImportVereinMembersAsync(
        int tenantId,
        int organizationId,
        int actorId,
        string csv,
        CancellationToken ct)
    {
        var organization = await LoadVereinAsync(tenantId, organizationId, ct);
        if (organization is null)
        {
            return VereinAdminAssignmentResult.Fail("VALIDATION_ERROR");
        }

        var parsed = ParseCsv(csv);
        if (!parsed.Succeeded)
        {
            return VereinAdminAssignmentResult.Fail("VALIDATION_ERROR");
        }

        var preview = await BuildPreviewAsync(tenantId, organization, parsed.Rows, ct);
        var items = preview.Items;
        if (items.Any(item => item.Action == "invalid"))
        {
            return VereinAdminAssignmentResult.Fail("VALIDATION_ERROR");
        }

        var created = 0;
        var linked = 0;
        var skipped = 0;
        var members = new List<Dictionary<string, object?>>();

        foreach (var item in items)
        {
            if (item.Action == "already_member")
            {
                skipped++;
                continue;
            }

            var userId = item.ExistingUserId;
            string? tempPassword = null;
            if (userId is null)
            {
                tempPassword = GenerateTemporaryPassword();
                var user = new User
                {
                    TenantId = tenantId,
                    Email = item.Email,
                    PasswordHash = $"imported:{Convert.ToBase64String(RandomNumberGenerator.GetBytes(18))}",
                    FirstName = item.FirstName,
                    LastName = item.LastName,
                    Role = Role.Names.Member,
                    IsActive = true,
                    EmailVerified = false,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };
                _db.Users.Add(user);
                await _db.SaveChangesAsync(ct);
                userId = user.Id;
                created++;
            }
            else
            {
                linked++;
            }

            var member = await _db.OrganisationMembers
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(row =>
                    row.TenantId == tenantId
                    && row.OrganisationId == organizationId
                    && row.UserId == userId.Value,
                    ct);
            if (member is null)
            {
                _db.OrganisationMembers.Add(new OrganisationMember
                {
                    TenantId = tenantId,
                    OrganisationId = organizationId,
                    UserId = userId.Value,
                    Role = item.Role,
                    JoinedAt = DateTime.UtcNow
                });
            }
            else
            {
                member.Role = item.Role;
            }

            members.Add(new Dictionary<string, object?>
            {
                ["user_id"] = userId.Value,
                ["email"] = item.Email,
                ["created"] = tempPassword is not null,
                ["temporary_password"] = tempPassword
            });
        }

        await _db.SaveChangesAsync(ct);

        return VereinAdminAssignmentResult.Success(new Dictionary<string, object?>
        {
            ["organization"] = OrganizationPayload(organization),
            ["created"] = created,
            ["linked"] = linked,
            ["skipped"] = skipped,
            ["members"] = members,
            ["imported_by"] = actorId
        });
    }

    public async Task<VereinAdminAssignmentResult> AssignVereinAdminAsync(
        int tenantId,
        int organizationId,
        int userId,
        int actorId,
        CancellationToken ct)
    {
        var organisationExists = await _db.Organisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(organisation =>
                organisation.TenantId == tenantId
                && organisation.Id == organizationId
                && organisation.Type == "club",
                ct);
        if (!organisationExists)
        {
            return VereinAdminAssignmentResult.Fail("VALIDATION_ERROR");
        }

        var userExists = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId && user.Id == userId, ct);
        if (!userExists)
        {
            return VereinAdminAssignmentResult.Fail("VALIDATION_ERROR");
        }

        var member = await _db.OrganisationMembers
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.OrganisationId == organizationId
                && row.UserId == userId,
                ct);
        if (member is null)
        {
            _db.OrganisationMembers.Add(new OrganisationMember
            {
                TenantId = tenantId,
                OrganisationId = organizationId,
                UserId = userId,
                Role = "admin",
                JobTitle = "Verein admin",
                JoinedAt = DateTime.UtcNow
            });
        }
        else
        {
            member.Role = "admin";
            member.JobTitle ??= "Verein admin";
        }

        await _db.SaveChangesAsync(ct);

        return VereinAdminAssignmentResult.Success(new
        {
            user_id = userId,
            organization_id = organizationId,
            role = "verein_admin",
            scope_organization_id = organizationId,
            assigned_by = actorId
        });
    }

    private async Task<Organisation?> LoadVereinAsync(int tenantId, int organizationId, CancellationToken ct)
    {
        return await _db.Organisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(organisation =>
                organisation.TenantId == tenantId
                && organisation.Id == organizationId
                && organisation.Type == "club",
                ct);
    }

    private async Task<VereinImportPreview> BuildPreviewAsync(
        int tenantId,
        Organisation organization,
        IReadOnlyList<VereinCsvRow> rows,
        CancellationToken ct)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var items = new List<VereinImportPreviewItem>();
        var summary = new Dictionary<string, int>
        {
            ["total_rows"] = rows.Count,
            ["ready_to_create"] = 0,
            ["ready_to_link"] = 0,
            ["duplicates"] = 0,
            ["invalid"] = 0
        };

        foreach (var row in rows)
        {
            var email = row.Value("email").Trim().ToLowerInvariant();
            var errors = new List<string>();

            if (!IsValidEmail(email))
            {
                errors.Add("Invalid email address.");
            }

            var duplicateInFile = email.Length > 0 && !seen.Add(email);
            if (duplicateInFile)
            {
                errors.Add("Duplicate email in import file.");
            }

            var existingUser = email.Length > 0
                ? await _db.Users
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(user => user.TenantId == tenantId && user.Email == email)
                    .Select(user => new { user.Id })
                    .FirstOrDefaultAsync(ct)
                : null;

            var alreadyMember = existingUser is not null
                && await _db.OrganisationMembers
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .AnyAsync(member =>
                        member.TenantId == tenantId
                        && member.OrganisationId == organization.Id
                        && member.UserId == existingUser.Id,
                        ct);

            var action = existingUser is null ? "create" : "link_existing";
            if (alreadyMember)
            {
                action = "already_member";
            }
            if (errors.Count > 0)
            {
                action = "invalid";
            }

            if (action == "create")
            {
                summary["ready_to_create"]++;
            }
            else if (action == "link_existing")
            {
                summary["ready_to_link"]++;
            }
            else if (alreadyMember || duplicateInFile)
            {
                summary["duplicates"]++;
            }
            else
            {
                summary["invalid"]++;
            }

            items.Add(new VereinImportPreviewItem(
                row.RowNumber,
                email,
                CleanName(row.Value("first_name")),
                CleanName(row.Value("last_name")),
                NullIfWhiteSpace(row.Value("phone")),
                NormalizeMemberRole(row.Value("role")),
                action,
                existingUser?.Id,
                errors));
        }

        return new VereinImportPreview(OrganizationPayload(organization), summary, items);
    }

    private static VereinCsvParseResult ParseCsv(string csv)
    {
        csv = csv.Trim();
        if (csv.Length == 0)
        {
            return VereinCsvParseResult.Fail();
        }

        var records = CsvRecords(csv).ToList();
        if (records.Count == 0)
        {
            return VereinCsvParseResult.Fail();
        }

        var headers = records[0]
            .Select(header => header.Trim().ToLowerInvariant())
            .ToArray();
        if (!headers.Contains("email"))
        {
            return VereinCsvParseResult.Fail();
        }

        var rows = new List<VereinCsvRow>();
        for (var index = 1; index < records.Count; index++)
        {
            var values = records[index];
            if (values.All(string.IsNullOrWhiteSpace))
            {
                continue;
            }

            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var column = 0; column < headers.Length; column++)
            {
                map[headers[column]] = column < values.Count ? values[column] : string.Empty;
            }
            rows.Add(new VereinCsvRow(index + 1, map));
        }

        return rows.Count > 500
            ? VereinCsvParseResult.Fail()
            : VereinCsvParseResult.Success(rows);
    }

    private static IEnumerable<List<string>> CsvRecords(string csv)
    {
        var record = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < csv.Length; i++)
        {
            var ch = csv[i];
            if (ch == '"')
            {
                if (inQuotes && i + 1 < csv.Length && csv[i + 1] == '"')
                {
                    field.Append('"');
                    i++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (ch == ',' && !inQuotes)
            {
                record.Add(field.ToString());
                field.Clear();
                continue;
            }

            if ((ch == '\n' || ch == '\r') && !inQuotes)
            {
                if (ch == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n')
                {
                    i++;
                }

                record.Add(field.ToString());
                field.Clear();
                yield return record;
                record = new List<string>();
                continue;
            }

            field.Append(ch);
        }

        record.Add(field.ToString());
        yield return record;
    }

    private static Dictionary<string, object?> OrganizationPayload(Organisation organization)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = organization.Id,
            ["name"] = organization.Name,
            ["org_type"] = organization.Type
        };
    }

    private static Dictionary<string, object?> PreviewPayload(VereinImportPreview preview)
    {
        return new Dictionary<string, object?>
        {
            ["organization"] = preview.Organization,
            ["summary"] = preview.Summary,
            ["items"] = preview.Items.Select(ItemPayload).ToList()
        };
    }

    private static Dictionary<string, object?> ItemPayload(VereinImportPreviewItem item)
    {
        return new Dictionary<string, object?>
        {
            ["row"] = item.Row,
            ["email"] = item.Email,
            ["first_name"] = item.FirstName,
            ["last_name"] = item.LastName,
            ["phone"] = item.Phone,
            ["role"] = item.Role,
            ["action"] = item.Action,
            ["existing_user_id"] = item.ExistingUserId,
            ["errors"] = item.Errors
        };
    }

    private static string CleanName(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length <= 100 ? trimmed : trimmed[..100];
    }

    private static string NormalizeMemberRole(string value)
    {
        var role = value.Trim();
        return role is "owner" or "admin" or "member" ? role : "member";
    }

    private static string? NullIfWhiteSpace(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static bool IsValidEmail(string email)
    {
        try
        {
            var parsed = new MailAddress(email);
            return parsed.Address.Equals(email, StringComparison.OrdinalIgnoreCase)
                && email.Contains('@', StringComparison.Ordinal);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string GenerateTemporaryPassword()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(12))
            .Replace("+", "A", StringComparison.Ordinal)
            .Replace("/", "b", StringComparison.Ordinal)
            .TrimEnd('=');
    }

    private static bool IsTruthy(string? value)
    {
        return value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on" or "enabled";
    }
}

public sealed record VereinAdminAssignmentResult(
    bool Succeeded,
    object? Payload,
    string? ErrorCode)
{
    public static VereinAdminAssignmentResult Success(object payload)
    {
        return new VereinAdminAssignmentResult(true, payload, null);
    }

    public static VereinAdminAssignmentResult Fail(string code)
    {
        return new VereinAdminAssignmentResult(false, null, code);
    }
}

internal sealed record VereinCsvRow(int RowNumber, IReadOnlyDictionary<string, string> Values)
{
    public string Value(string key)
    {
        return Values.TryGetValue(key, out var value) ? value : string.Empty;
    }
}

internal sealed record VereinCsvParseResult(bool Succeeded, IReadOnlyList<VereinCsvRow> Rows)
{
    public static VereinCsvParseResult Success(IReadOnlyList<VereinCsvRow> rows)
    {
        return new VereinCsvParseResult(true, rows);
    }

    public static VereinCsvParseResult Fail()
    {
        return new VereinCsvParseResult(false, Array.Empty<VereinCsvRow>());
    }
}

internal sealed record VereinImportPreview(
    IReadOnlyDictionary<string, object?> Organization,
    IReadOnlyDictionary<string, int> Summary,
    IReadOnlyList<VereinImportPreviewItem> Items);

internal sealed record VereinImportPreviewItem(
    int Row,
    string Email,
    string FirstName,
    string LastName,
    string? Phone,
    string Role,
    string Action,
    int? ExistingUserId,
    IReadOnlyList<string> Errors);
