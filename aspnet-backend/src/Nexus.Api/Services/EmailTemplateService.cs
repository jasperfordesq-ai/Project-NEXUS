// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using System.Text.RegularExpressions;

namespace Nexus.Api.Services;

/// <summary>
/// Phase 64 — email template management with native versioning + rendering.
///
/// Replaces V1's Mailchimp template flow (project owner directive 2026-05-09).
/// Stores one row per template version; activation atomically deactivates the
/// previous active row. Render uses simple mustache-style {{ var }} interpolation
/// against a flat dictionary; nested keys via dot notation supported (e.g.
/// {{ user.first_name }} resolves to dict["user.first_name"]).
/// </summary>
public class EmailTemplateService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<EmailTemplateService> _logger;

    // {{ key }} or {{ key.with.dots }}, whitespace tolerant.
    private static readonly Regex VariablePattern = new(@"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}", RegexOptions.Compiled);

    public EmailTemplateService(NexusDbContext db, TenantContext tenant, ILogger<EmailTemplateService> logger)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
    }

    /// <summary>List ALL versions of every template for the current tenant.</summary>
    public async Task<List<EmailTemplate>> ListAllVersionsAsync(string? key = null)
    {
        var q = _db.EmailTemplates.AsQueryable();
        if (!string.IsNullOrWhiteSpace(key)) q = q.Where(t => t.Key == key);
        return await q.OrderBy(t => t.Key).ThenByDescending(t => t.Version).ToListAsync();
    }

    /// <summary>Active row per template key for the current tenant.</summary>
    public async Task<List<EmailTemplate>> ListActiveAsync()
    {
        return await _db.EmailTemplates.Where(t => t.IsActive).OrderBy(t => t.Key).ToListAsync();
    }

    /// <summary>Get a specific version by id.</summary>
    public async Task<EmailTemplate?> GetByIdAsync(int id) =>
        await _db.EmailTemplates.FirstOrDefaultAsync(t => t.Id == id);

    /// <summary>Get the currently-active version for a key.</summary>
    public async Task<EmailTemplate?> GetActiveAsync(string key) =>
        await _db.EmailTemplates.FirstOrDefaultAsync(t => t.Key == key && t.IsActive);

    /// <summary>
    /// Create a new version of a template. Increments <see cref="EmailTemplate.Version"/>
    /// from the highest existing for (Tenant, Key) and (optionally) sets it active,
    /// deactivating any prior active version.
    /// </summary>
    public async Task<EmailTemplate> CreateVersionAsync(
        string key,
        string subject,
        string bodyHtml,
        string? bodyText,
        string? changeNote,
        int? createdByUserId,
        bool activate)
    {
        if (string.IsNullOrWhiteSpace(key))
            throw new ArgumentException("Key is required", nameof(key));
        if (string.IsNullOrWhiteSpace(subject))
            throw new ArgumentException("Subject is required", nameof(subject));
        if (string.IsNullOrWhiteSpace(bodyHtml))
            throw new ArgumentException("BodyHtml is required", nameof(bodyHtml));

        var tenantId = _tenant.GetTenantIdOrThrow();
        var maxVersion = await _db.EmailTemplates
            .Where(t => t.Key == key)
            .MaxAsync(t => (int?)t.Version) ?? 0;

        if (activate)
        {
            // Deactivate any prior active rows.
            var prior = await _db.EmailTemplates.Where(t => t.Key == key && t.IsActive).ToListAsync();
            foreach (var row in prior)
            {
                row.IsActive = false;
                row.UpdatedAt = DateTime.UtcNow;
            }
        }

        var entity = new EmailTemplate
        {
            TenantId = tenantId,
            Key = key,
            Version = maxVersion + 1,
            IsActive = activate,
            Subject = subject,
            BodyHtml = bodyHtml,
            BodyText = bodyText,
            ChangeNote = changeNote,
            CreatedByUserId = createdByUserId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.EmailTemplates.Add(entity);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Email template version created: tenant={TenantId} key={Key} version={Version} active={Active}",
            tenantId, key, entity.Version, activate);
        return entity;
    }

    /// <summary>Activate a specific version, deactivating its siblings.</summary>
    public async Task<EmailTemplate?> ActivateVersionAsync(int id)
    {
        var target = await _db.EmailTemplates.FirstOrDefaultAsync(t => t.Id == id);
        if (target == null) return null;

        if (target.IsActive) return target;

        var siblings = await _db.EmailTemplates.Where(t => t.Key == target.Key && t.Id != id).ToListAsync();
        foreach (var s in siblings) { s.IsActive = false; s.UpdatedAt = DateTime.UtcNow; }
        target.IsActive = true;
        target.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Email template activated: tenant={TenantId} key={Key} version={Version}",
            target.TenantId, target.Key, target.Version);
        return target;
    }

    /// <summary>
    /// Delete a non-active version. Active versions cannot be deleted (must be
    /// superseded by activating a different version first).
    /// </summary>
    public async Task<(bool Deleted, string? Error)> DeleteVersionAsync(int id)
    {
        var target = await _db.EmailTemplates.FirstOrDefaultAsync(t => t.Id == id);
        if (target == null) return (false, "not_found");
        if (target.IsActive) return (false, "cannot_delete_active_version");
        _db.EmailTemplates.Remove(target);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>
    /// Render a template by interpolating {{ var }} placeholders against the
    /// provided variables. Missing variables render as empty string. Use the
    /// active version for the current tenant.
    /// </summary>
    public async Task<(string Subject, string BodyHtml, string? BodyText)?> RenderActiveAsync(
        string key, IReadOnlyDictionary<string, string?> variables)
    {
        var template = await GetActiveAsync(key);
        if (template == null) return null;

        var subject = Interpolate(template.Subject, variables);
        var bodyHtml = Interpolate(template.BodyHtml, variables);
        var bodyText = template.BodyText == null ? null : Interpolate(template.BodyText, variables);
        return (subject, bodyHtml, bodyText);
    }

    /// <summary>Pure interpolation — exposed for previewing in the admin UI.</summary>
    public static string Interpolate(string source, IReadOnlyDictionary<string, string?> variables)
    {
        if (string.IsNullOrEmpty(source)) return source;
        return VariablePattern.Replace(source, m =>
        {
            var name = m.Groups[1].Value;
            return variables.TryGetValue(name, out var v) ? v ?? string.Empty : string.Empty;
        });
    }
}
