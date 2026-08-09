// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/safeguarding")]
[Authorize(Policy = "BrokerOrAdmin")]
public class AdminSafeguardingController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions AuditJson = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };
    private static readonly Regex InvalidOptionKeyCharacters = new(
        "[^a-z0-9_]",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex HtmlTags = new(
        "<[^>]*>",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly IReadOnlySet<string> AllowedOptionTypes =
        new HashSet<string>(["checkbox", "info", "select"], StringComparer.Ordinal);
    private static readonly IReadOnlyDictionary<string, TriggerValueType> AllowedTriggerTypes =
        new Dictionary<string, TriggerValueType>(StringComparer.Ordinal)
        {
            ["requires_vetted_interaction"] = TriggerValueType.Boolean,
            ["requires_broker_approval"] = TriggerValueType.Boolean,
            ["restricts_messaging"] = TriggerValueType.Boolean,
            ["restricts_matching"] = TriggerValueType.Boolean,
            ["notify_admin_on_selection"] = TriggerValueType.Boolean,
            ["vetting_type_required"] = TriggerValueType.StringOrNull
        };
    private static readonly IReadOnlySet<string> ProtectiveTriggerKeys =
        new HashSet<string>(
        [
            "requires_vetted_interaction",
            "requires_broker_approval",
            "restricts_messaging",
            "restricts_matching"
        ], StringComparer.Ordinal);
    private static readonly IReadOnlySet<string> UpdateableOptionFields =
        new HashSet<string>(
        [
            "label", "description", "help_url", "sort_order", "is_active",
            "is_required", "option_type", "select_options", "triggers"
        ], StringComparer.Ordinal);
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly SafeguardingJurisdictionService _jurisdictions;
    private readonly OnboardingSafeguardingService _onboardingSafeguarding;
    private readonly ILogger<AdminSafeguardingController> _logger;

    public AdminSafeguardingController(
        NexusDbContext db,
        TenantContext tenant,
        SafeguardingJurisdictionService jurisdictions,
        OnboardingSafeguardingService onboardingSafeguarding,
        ILogger<AdminSafeguardingController> logger)
    {
        _db = db;
        _tenant = tenant;
        _jurisdictions = jurisdictions;
        _onboardingSafeguarding = onboardingSafeguarding;
        _logger = logger;
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard()
    {
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        var activeAssignments = await _db.SafeguardingAssignments.CountAsync(a => a.RevokedAt == null && a.Status == "active");
        var consentedWards = await _db.SafeguardingAssignments.CountAsync(a => a.RevokedAt == null && a.ConsentGivenAt != null);
        var unreviewedFlags = await _db.SafeguardingMessageReviews.CountAsync(r => r.IsFlagged && r.ReviewedAt == null);
        var flagsThisMonth = await _db.SafeguardingMessageReviews.CountAsync(r => r.IsFlagged && r.CreatedAt >= monthStart);
        var criticalFlags = await _db.SafeguardingMessageReviews.CountAsync(r =>
            r.IsFlagged && r.ReviewedAt == null && (r.Severity == "high" || r.Severity == "critical"));

        return Ok(new
        {
            data = new
            {
                active_assignments = activeAssignments,
                unreviewed_flags = unreviewedFlags,
                consented_wards = consentedWards,
                total_flags_this_month = flagsThisMonth,
                critical_flags = criticalFlags
            }
        });
    }

    [HttpGet("flagged-messages")]
    public async Task<IActionResult> FlaggedMessages(
        [FromQuery] string? status = null,
        [FromQuery] string? severity = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 200);

        var query = _db.SafeguardingMessageReviews
            .Include(r => r.Message).ThenInclude(m => m!.Conversation)
            .Include(r => r.Sender)
            .Include(r => r.Recipient)
            .Include(r => r.ReviewedBy)
            .Where(r => r.IsFlagged)
            .AsQueryable();

        if (status == "reviewed") query = query.Where(r => r.ReviewedAt != null);
        if (status == "unreviewed") query = query.Where(r => r.ReviewedAt == null);
        if (!string.IsNullOrWhiteSpace(severity)) query = query.Where(r => r.Severity == severity);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(r =>
                r.Message!.Content.ToLower().Contains(term) ||
                r.Sender!.Email.ToLower().Contains(term) ||
                (r.Recipient != null && r.Recipient.Email.ToLower().Contains(term)));
        }

        var total = await query.CountAsync();
        var rows = await query
            .OrderBy(r => r.ReviewedAt != null)
            .ThenByDescending(r => r.Severity == "critical")
            .ThenByDescending(r => r.Severity == "high")
            .ThenByDescending(r => r.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            data = rows.Select(MapMessageReview),
            pagination = new { page, limit, total, total_pages = (int)Math.Ceiling(total / (double)limit) }
        });
    }

    [HttpPost("flagged-messages/{id:int}/review")]
    public async Task<IActionResult> ReviewMessage(int id, [FromBody] ReviewMessageRequest request)
    {
        var review = await _db.SafeguardingMessageReviews.FirstOrDefaultAsync(r => r.Id == id);
        if (review == null) return NotFound(new { error = "Flagged message not found" });

        review.ReviewedAt = DateTime.UtcNow;
        review.ReviewedByUserId = User.GetUserId();
        review.ReviewNotes = request.Notes;
        review.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { data = MapMessageReview(review) });
    }

    [HttpGet("assignments")]
    public async Task<IActionResult> Assignments([FromQuery] string? status = null)
    {
        var query = _db.SafeguardingAssignments
            .Include(a => a.Ward)
            .Include(a => a.Guardian)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(a => a.Status == status);

        var rows = await query.OrderByDescending(a => a.AssignedAt).ToListAsync();
        return Ok(new { data = rows.Select(MapAssignment), meta = new { total = rows.Count } });
    }

    [HttpPost("assignments")]
    public async Task<IActionResult> CreateAssignment([FromBody] CreateSafeguardingAssignmentRequest request)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var ward = await ResolveUserAsync(request.WardUserId, request.WardEmail);
        if (ward == null) return BadRequest(new { error = "Ward user not found" });
        var guardian = await ResolveUserAsync(request.GuardianUserId, request.GuardianEmail);
        if (guardian == null) return BadRequest(new { error = "Guardian user not found" });
        if (ward.Id == guardian.Id) return BadRequest(new { error = "Ward and guardian must be different users" });

        var existing = await _db.SafeguardingAssignments.FirstOrDefaultAsync(a =>
            a.WardUserId == ward.Id && a.GuardianUserId == guardian.Id && a.RevokedAt == null);
        if (existing != null) return Conflict(new { error = "An active safeguarding assignment already exists for these users" });

        var assignment = new SafeguardingAssignment
        {
            TenantId = tenantId,
            WardUserId = ward.Id,
            GuardianUserId = guardian.Id,
            ConsentGivenAt = request.ConsentGiven ? DateTime.UtcNow : null,
            ExpiresAt = request.ExpiresAt,
            Notes = request.Notes
        };

        _db.SafeguardingAssignments.Add(assignment);
        await _db.SaveChangesAsync();
        assignment.Ward = ward;
        assignment.Guardian = guardian;

        return Created($"/api/admin/safeguarding/assignments/{assignment.Id}", new { data = MapAssignment(assignment) });
    }

    [HttpDelete("assignments/{id:int}")]
    public async Task<IActionResult> DeleteAssignment(int id)
    {
        var assignment = await _db.SafeguardingAssignments.FirstOrDefaultAsync(a => a.Id == id);
        if (assignment == null) return NotFound(new { error = "Assignment not found" });

        assignment.Status = "revoked";
        assignment.RevokedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { message = "Assignment revoked" });
    }

    [HttpGet("member-preferences")]
    public async Task<IActionResult> MemberPreferences()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var preferences = await _db.UserSafeguardingPreferences
            .Include(preference => preference.User)
            .Include(preference => preference.Option)
            .Where(preference =>
                preference.TenantId == tenantId
                && preference.RevokedAt == null
                && preference.Option != null
                && preference.Option.IsActive)
            .OrderByDescending(preference => preference.ConsentGivenAt)
            .ThenBy(preference => preference.UserId)
            .ThenBy(preference => preference.Option!.SortOrder)
            .ToListAsync();

        var grouped = preferences
            .GroupBy(preference => preference.UserId)
            .Select(group =>
            {
                var first = group.First();
                var options = group.Select(preference => new
                {
                    option_key = preference.Option!.OptionKey,
                    label = SafeguardingVettingCatalog.EnglishOptionLabel(
                        preference.Option.OptionKey,
                        preference.Option.Label,
                        preference.Option.PresetSource),
                    is_declination = preference.Option.OptionKey == "none_apply"
                }).ToList();

                return new
                {
                    user_id = group.Key,
                    user_name = Name(first.User),
                    user_avatar = first.User?.AvatarUrl,
                    consent_given_at = group.Max(preference => preference.ConsentGivenAt),
                    options,
                    has_triggers = group.Any(preference => HasEnabledBooleanTrigger(preference.Option!.TriggersJson)),
                    is_declination_only = options.All(option => option.is_declination)
                };
            })
            .ToList();

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = User.GetUserId(),
            Action = "safeguarding_preferences_list_viewed",
            EntityType = "tenant",
            EntityId = tenantId,
            Metadata = JsonSerializer.Serialize(new { members_count = grouped.Count }),
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.ToString(),
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();

        return Ok(new
        {
            data = grouped,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpGet("options")]
    public async Task<IActionResult> Options(CancellationToken cancellationToken)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var options = await _db.SafeguardingOptions.IgnoreQueryFilters().AsNoTracking()
            .Where(option => option.TenantId == tenantId)
            .OrderBy(option => option.SortOrder)
            .ThenBy(option => option.Id)
            .ToListAsync(cancellationToken);
        return await LaravelDataAsync(
            options.Select(option => MapOption(option)).ToArray(),
            tenantId,
            StatusCodes.Status200OK,
            cancellationToken);
    }

    [HttpPost("options")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingOptionMutationPolicy)]
    public async Task<IActionResult> CreateOption(CancellationToken cancellationToken)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var input = await AdminSafeguardingOptionInput.ReadAsync(Request, cancellationToken);
        var rawKey = input.ScalarString("option_key").Trim();
        if (IsPhpEmpty(rawKey))
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "option_key is required",
                "option_key",
                StatusCodes.Status422UnprocessableEntity,
                tenantId);
        }

        var rawLabel = input.ScalarString("label").Trim();
        if (IsPhpEmpty(rawLabel))
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "label is required",
                "label",
                StatusCodes.Status422UnprocessableEntity,
                tenantId);
        }

        var optionKey = InvalidOptionKeyCharacters.Replace(rawKey.ToLowerInvariant(), "_");
        var optionType = input.Contains("option_type")
            ? input.ScalarString("option_type")
            : "checkbox";
        if (!AllowedOptionTypes.Contains(optionType))
        {
            return InvalidOptionType(tenantId);
        }

        var selectOptions = input.ElementOrNull("select_options");
        if (optionType == "select"
            && ValidateSelectOptions(selectOptions, tenantId) is { } selectOptionsError)
        {
            return selectOptionsError;
        }

        await using var transaction = await BeginTransactionAsync(cancellationToken);
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);

        var triggers = ValidatedTriggers.Empty;
        if (input.TryGetElement("triggers", out var triggerElement) && !IsPhpEmpty(triggerElement))
        {
            var validation = await ValidateTriggersAsync(
                triggerElement,
                tenantId,
                cancellationToken);
            if (validation.Error is not null)
            {
                return validation.Error;
            }
            triggers = validation.Value!;
        }

        var existingCount = await _db.SafeguardingOptions.IgnoreQueryFilters()
            .CountAsync(option => option.TenantId == tenantId, cancellationToken);
        if (existingCount >= 50)
        {
            return LaravelError(
                "LIMIT_EXCEEDED",
                "Maximum 50 safeguarding options per tenant",
                null,
                StatusCodes.Status422UnprocessableEntity,
                tenantId);
        }
        if (await _db.SafeguardingOptions.IgnoreQueryFilters().AnyAsync(
                option => option.TenantId == tenantId && option.OptionKey == optionKey,
                cancellationToken))
        {
            return DuplicateOptionKey(optionKey, tenantId);
        }

        var now = DateTime.UtcNow;
        var option = new SafeguardingOption
        {
            TenantId = tenantId,
            OptionKey = optionKey,
            OptionType = optionType,
            Label = StripTags(rawLabel),
            Description = input.Contains("description") && !input.IsNull("description")
                ? StripTags(input.ScalarString("description").Trim())
                : null,
            HelpUrl = ValidateHelpUrl(input.NullableScalarString("help_url")),
            SortOrder = input.Contains("sort_order") ? input.PhpInt("sort_order") : 0,
            IsActive = !input.Contains("is_active") || input.PhpBool("is_active"),
            IsRequired = input.Contains("is_required") && input.PhpBool("is_required"),
            SelectOptionsJson = selectOptions?.GetRawText(),
            TriggersJson = triggers.Json,
            CreatedAt = now,
            UpdatedAt = null
        };
        _db.SafeguardingOptions.Add(option);
        await _db.SaveChangesAsync(cancellationToken);
        AddOptionAudit(
            tenantId,
            "safeguarding_option_created",
            "safeguarding_option",
            option.Id,
            new { option_key = option.OptionKey, label = option.Label });
        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return await LaravelDataAsync(
            MapOption(option, localize: false),
            tenantId,
            StatusCodes.Status201Created,
            cancellationToken);
    }

    [HttpPut("options/reorder")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingOptionMutationPolicy)]
    public async Task<IActionResult> ReorderOptions(CancellationToken cancellationToken)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var input = await AdminSafeguardingOptionInput.ReadAsync(Request, cancellationToken);
        if (!input.TryGetElement("order", out var orderElement)
            || orderElement.ValueKind != JsonValueKind.Object
            || !orderElement.EnumerateObject().Any())
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "order must be a non-empty object of {id: sort_order}",
                "order",
                StatusCodes.Status422UnprocessableEntity,
                tenantId);
        }

        var order = orderElement.EnumerateObject()
            .Select(item => new OptionOrder(PhpInt(item.Name), PhpInt(item.Value)))
            .ToArray();
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);

        var submittedIds = order.Select(item => item.OptionId).ToArray();
        var options = await _db.SafeguardingOptions.IgnoreQueryFilters()
            .Where(option => option.TenantId == tenantId && submittedIds.Contains(option.Id))
            .ToListAsync(cancellationToken);
        if (options.Count != submittedIds.Length)
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "One or more option IDs are invalid",
                "order",
                StatusCodes.Status422UnprocessableEntity,
                tenantId);
        }

        var byId = options.ToDictionary(option => option.Id);
        var now = DateTime.UtcNow;
        foreach (var item in order)
        {
            byId[item.OptionId].SortOrder = item.SortOrder;
            byId[item.OptionId].UpdatedAt = now;
        }
        AddOptionAudit(
            tenantId,
            "safeguarding_options_reordered",
            "tenant",
            tenantId,
            new
            {
                order = order.ToDictionary(item => item.OptionId.ToString(CultureInfo.InvariantCulture), item => item.SortOrder)
            });
        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return await LaravelDataAsync(
            new { message = "Options reordered" },
            tenantId,
            StatusCodes.Status200OK,
            cancellationToken);
    }

    [HttpPut("options/{id:int}")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingOptionMutationPolicy)]
    public async Task<IActionResult> UpdateOption(int id, CancellationToken cancellationToken)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var input = await AdminSafeguardingOptionInput.ReadAsync(Request, cancellationToken);
        input.Remove("id", "tenant_id", "option_key");
        if (input.IsEmpty)
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "No updateable fields provided",
                null,
                StatusCodes.Status422UnprocessableEntity,
                tenantId);
        }
        if (input.Contains("label") && string.IsNullOrWhiteSpace(input.ScalarString("label")))
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "label is required",
                "label",
                StatusCodes.Status422UnprocessableEntity,
                tenantId);
        }
        if (input.Contains("option_type")
            && !AllowedOptionTypes.Contains(input.ScalarString("option_type")))
        {
            return InvalidOptionType(tenantId);
        }

        await using var transaction = await BeginTransactionAsync(cancellationToken);
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);
        var option = await _db.SafeguardingOptions.IgnoreQueryFilters()
            .SingleOrDefaultAsync(
                candidate => candidate.TenantId == tenantId && candidate.Id == id,
                cancellationToken);
        if (option is null)
        {
            return OptionNotFound(tenantId);
        }

        ValidatedTriggers? validatedTriggers = null;
        if (input.TryGetElement("triggers", out var triggerElement))
        {
            var validation = await ValidateTriggersAsync(
                triggerElement,
                tenantId,
                cancellationToken);
            if (validation.Error is not null)
            {
                return validation.Error;
            }
            validatedTriggers = validation.Value;
        }

        JsonElement? submittedSelectOptions = null;
        if (input.TryGetElement("select_options", out var selectElement))
        {
            submittedSelectOptions = selectElement;
            if (selectElement.ValueKind != JsonValueKind.Null
                && ValidateSelectOptions(selectElement, tenantId) is { } selectOptionsError)
            {
                return selectOptionsError;
            }
        }

        var finalOptionType = input.Contains("option_type")
            ? input.ScalarString("option_type")
            : option.OptionType;
        var finalSelectOptions = input.Contains("select_options")
            ? submittedSelectOptions
            : ParseJsonElement(option.SelectOptionsJson);
        if (finalOptionType == "select"
            && ValidateSelectOptions(finalSelectOptions, tenantId) is { } finalSelectError)
        {
            return finalSelectError;
        }

        var activeSelectionUserIds = await _db.UserSafeguardingPreferences.IgnoreQueryFilters()
            .Where(preference => preference.TenantId == tenantId
                && preference.OptionId == option.Id
                && preference.RevokedAt == null)
            .Select(preference => preference.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);
        if (activeSelectionUserIds.Count > 0
            && MutationWeakensProtection(option, input, validatedTriggers))
        {
            return SafeguardingPolicyUnavailable(tenantId);
        }

        var changes = new List<string>();
        foreach (var key in input.Keys.Where(UpdateableOptionFields.Contains))
        {
            changes.Add(key);
            switch (key)
            {
                case "label":
                    option.Label = PreserveManagedCopy(
                        option,
                        "label",
                        StripTags(input.ScalarString(key).Trim()));
                    break;
                case "description":
                    option.Description = input.IsNull(key)
                        ? null
                        : PreserveManagedCopy(
                            option,
                            "description",
                            StripTags(input.ScalarString(key).Trim()));
                    break;
                case "help_url":
                    option.HelpUrl = ValidateHelpUrl(input.NullableScalarString(key));
                    break;
                case "sort_order":
                    option.SortOrder = input.PhpInt(key);
                    break;
                case "is_active":
                    option.IsActive = input.PhpBool(key);
                    break;
                case "is_required":
                    option.IsRequired = input.PhpBool(key);
                    break;
                case "option_type":
                    option.OptionType = input.ScalarString(key);
                    break;
                case "select_options":
                    option.SelectOptionsJson = input.IsNull(key)
                        ? null
                        : submittedSelectOptions?.GetRawText();
                    break;
                case "triggers":
                    option.TriggersJson = validatedTriggers!.Json;
                    break;
            }
        }
        option.UpdatedAt = DateTime.UtcNow;
        AddOptionAudit(
            tenantId,
            "safeguarding_option_updated",
            "safeguarding_option",
            option.Id,
            new { option_key = option.OptionKey, changes });
        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        if (changes.Contains("is_active", StringComparer.Ordinal)
            || changes.Contains("triggers", StringComparer.Ordinal))
        {
            foreach (var userId in activeSelectionUserIds)
            {
                await _onboardingSafeguarding.ReevaluateMemberTriggersAsync(
                    tenantId,
                    userId,
                    HttpContext.Connection.RemoteIpAddress?.ToString(),
                    cancellationToken);
            }
        }

        return await LaravelDataAsync(
            new { message = "Option updated" },
            tenantId,
            StatusCodes.Status200OK,
            cancellationToken);
    }

    [HttpDelete("options/{id:int}")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingOptionMutationPolicy)]
    public async Task<IActionResult> DeactivateOption(int id, CancellationToken cancellationToken)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);
        var option = await _db.SafeguardingOptions.IgnoreQueryFilters()
            .SingleOrDefaultAsync(
                candidate => candidate.TenantId == tenantId && candidate.Id == id,
                cancellationToken);
        if (option is null)
        {
            return OptionNotFound(tenantId);
        }

        var preferences = await _db.UserSafeguardingPreferences.IgnoreQueryFilters()
            .Where(preference => preference.TenantId == tenantId
                && preference.OptionId == option.Id
                && preference.RevokedAt == null)
            .ToListAsync(cancellationToken);
        var affectedUserIds = preferences.Select(preference => preference.UserId)
            .Distinct()
            .ToArray();
        if (affectedUserIds.Length > 0 && HasProtectiveTriggers(option.TriggersJson))
        {
            return SafeguardingPolicyUnavailable(tenantId);
        }

        var now = DateTime.UtcNow;
        option.IsActive = false;
        option.UpdatedAt = now;
        foreach (var preference in preferences)
        {
            preference.RevokedAt = now;
            preference.UpdatedAt = now;
        }
        AddOptionAudit(
            tenantId,
            "safeguarding_option_deleted",
            "safeguarding_option",
            option.Id,
            new { option_key = option.OptionKey, auto_revoked = affectedUserIds.Length });
        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        foreach (var userId in affectedUserIds)
        {
            try
            {
                await _onboardingSafeguarding.ReevaluateMemberTriggersAsync(
                    tenantId,
                    userId,
                    HttpContext.Connection.RemoteIpAddress?.ToString(),
                    cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                _logger.LogError(
                    exception,
                    "Safeguarding option delete trigger re-evaluation failed for tenant {TenantId}, option {OptionId}, user {UserId}",
                    tenantId,
                    option.Id,
                    userId);
            }
        }

        return await LaravelDataAsync(
            new { message = "Option deactivated" },
            tenantId,
            StatusCodes.Status200OK,
            cancellationToken);
    }

    private async Task<User?> ResolveUserAsync(int? userId, string? email)
    {
        if (userId.HasValue) return await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
        if (!string.IsNullOrWhiteSpace(email))
        {
            var normalized = email.Trim().ToLower();
            return await _db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == normalized);
        }
        return null;
    }

    private static object MapOption(SafeguardingOption option, bool localize = true) => new
    {
        option.Id,
        tenant_id = option.TenantId,
        option_key = option.OptionKey,
        option_type = option.OptionType,
        label = localize
            ? SafeguardingVettingCatalog.EnglishOptionLabel(
                option.OptionKey,
                option.Label,
                option.PresetSource)
            : option.Label,
        option.Description,
        help_url = option.HelpUrl,
        sort_order = option.SortOrder,
        is_active = option.IsActive,
        is_required = option.IsRequired,
        select_options = ParseJson(option.SelectOptionsJson),
        triggers = ParseJson(option.TriggersJson),
        preset_source = option.PresetSource,
        created_at = option.CreatedAt,
        updated_at = option.UpdatedAt
    };

    private async Task<ObjectResult> LaravelDataAsync(
        object data,
        int tenantId,
        int status,
        CancellationToken cancellationToken)
    {
        ApplyV2Headers(tenantId);
        var origin = $"{Request.Scheme}://{Request.Host}{Request.PathBase}";
        var baseUrl = await _onboardingSafeguarding.ResolveBaseUrlAsync(
            tenantId,
            origin,
            cancellationToken);
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = baseUrl }
        });
    }

    private ObjectResult LaravelError(
        string code,
        string message,
        string? field,
        int status,
        int tenantId)
    {
        ApplyV2Headers(tenantId);
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null)
        {
            error["field"] = field;
        }
        return StatusCode(status, new { errors = new[] { error } });
    }

    private void ApplyV2Headers(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString(CultureInfo.InvariantCulture);
    }

    private ObjectResult InvalidOptionType(int tenantId) => LaravelError(
        "VALIDATION_ERROR",
        "option_type must be one of: checkbox, info, select",
        "option_type",
        StatusCodes.Status422UnprocessableEntity,
        tenantId);

    private ObjectResult DuplicateOptionKey(string key, int tenantId) => LaravelError(
        "DUPLICATE",
        $"An option with key '{key}' already exists",
        "option_key",
        StatusCodes.Status409Conflict,
        tenantId);

    private ObjectResult OptionNotFound(int tenantId) => LaravelError(
        "NOT_FOUND",
        "Option not found",
        null,
        StatusCodes.Status404NotFound,
        tenantId);

    private ObjectResult SafeguardingPolicyUnavailable(int tenantId) => LaravelError(
        "SAFEGUARDING_POLICY_UNAVAILABLE",
        "The safeguarding policy is not available for this action.",
        null,
        StatusCodes.Status503ServiceUnavailable,
        tenantId);

    private async Task<TriggerValidation> ValidateTriggersAsync(
        JsonElement triggers,
        int tenantId,
        CancellationToken cancellationToken)
    {
        if (triggers.ValueKind == JsonValueKind.Array && triggers.GetArrayLength() == 0)
        {
            return new(ValidatedTriggers.Empty, null);
        }
        if (triggers.ValueKind != JsonValueKind.Object)
        {
            return new(null, LaravelError(
                "VALIDATION_ERROR",
                "triggers must be a JSON object",
                "triggers",
                StatusCodes.Status422UnprocessableEntity,
                tenantId));
        }

        var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in triggers.EnumerateObject())
        {
            if (!AllowedTriggerTypes.TryGetValue(property.Name, out var expectedType))
            {
                return new(null, LaravelError(
                    "VALIDATION_ERROR",
                    $"Unknown trigger key '{property.Name}'",
                    "triggers",
                    StatusCodes.Status422UnprocessableEntity,
                    tenantId));
            }
            var correctType = expectedType switch
            {
                TriggerValueType.Boolean => property.Value.ValueKind is JsonValueKind.True or JsonValueKind.False,
                TriggerValueType.StringOrNull => property.Value.ValueKind is JsonValueKind.String or JsonValueKind.Null,
                _ => false
            };
            if (!correctType)
            {
                return new(null, LaravelError(
                    "VALIDATION_ERROR",
                    $"Trigger '{property.Name}' has the wrong type — boolean fields must be true/false, vetting_type_required must be a string or null",
                    "triggers",
                    StatusCodes.Status422UnprocessableEntity,
                    tenantId));
            }
            values[property.Name] = property.Value.Clone();
        }

        var attestationCode = values.TryGetValue("vetting_type_required", out var attestation)
            && attestation.ValueKind == JsonValueKind.String
            ? attestation.GetString()
            : null;
        if (!string.IsNullOrEmpty(attestationCode)
            && !SafeguardingVettingCatalog.Policies.Values.Any(policy =>
                string.Equals(policy.AttestationCode, attestationCode, StringComparison.Ordinal)))
        {
            return new(null, LaravelError(
                "INVALID_VETTING_REQUIREMENT",
                "Choose a controlled vetting requirement for this safeguarding option.",
                "triggers.vetting_type_required",
                StatusCodes.Status422UnprocessableEntity,
                tenantId));
        }

        var requiresVettedInteraction = values.TryGetValue("requires_vetted_interaction", out var requiresVetted)
            && requiresVetted.ValueKind == JsonValueKind.True;
        if (requiresVettedInteraction && string.IsNullOrEmpty(attestationCode))
        {
            return new(null, LaravelError(
                "VETTING_REQUIREMENT_REQUIRED",
                "A vetted-contact option must specify the community policy requirement.",
                "triggers.vetting_type_required",
                StatusCodes.Status422UnprocessableEntity,
                tenantId));
        }
        if (requiresVettedInteraction)
        {
            var policy = await _jurisdictions.GetPolicyAsync(tenantId, cancellationToken);
            if (!policy.Configured
                || !policy.ContactPolicyAvailable
                || !string.Equals(policy.AttestationCode, attestationCode, StringComparison.Ordinal))
            {
                return new(null, LaravelError(
                    "VETTING_REQUIREMENT_POLICY_MISMATCH",
                    "This vetting requirement does not match the configured safeguarding jurisdiction.",
                    "triggers.vetting_type_required",
                    StatusCodes.Status422UnprocessableEntity,
                    tenantId));
            }
        }

        var json = values.Count == 0 ? "[]" : JsonSerializer.Serialize(values, JsonOptions);
        return new(new ValidatedTriggers(json, values), null);
    }

    private ObjectResult? ValidateSelectOptions(JsonElement? selectOptions, int tenantId)
    {
        if (selectOptions is null
            || selectOptions.Value.ValueKind != JsonValueKind.Array
            || selectOptions.Value.GetArrayLength() == 0)
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "select_options must be a non-empty array for select type",
                "select_options",
                StatusCodes.Status422UnprocessableEntity,
                tenantId);
        }

        var index = 0;
        foreach (var item in selectOptions.Value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object
                || !item.TryGetProperty("value", out var value)
                || value.ValueKind == JsonValueKind.Null
                || !item.TryGetProperty("label", out var label)
                || label.ValueKind == JsonValueKind.Null)
            {
                return LaravelError(
                    "VALIDATION_ERROR",
                    $"select_options[{index}] must have 'value' and 'label' keys",
                    "select_options",
                    StatusCodes.Status422UnprocessableEntity,
                    tenantId);
            }
            index++;
        }
        return null;
    }

    private static bool MutationWeakensProtection(
        SafeguardingOption option,
        AdminSafeguardingOptionInput input,
        ValidatedTriggers? nextTriggers)
    {
        var current = ParseTriggerValues(option.TriggersJson);
        if (!ProtectiveTriggerKeys.Any(key => IsTrue(current, key)))
        {
            return false;
        }
        if (input.Contains("is_active") && !input.PhpBool("is_active"))
        {
            return true;
        }
        if (nextTriggers is null)
        {
            return false;
        }
        foreach (var key in ProtectiveTriggerKeys)
        {
            if (IsTrue(current, key) && !IsTrue(nextTriggers.Values, key))
            {
                return true;
            }
        }
        if (IsTrue(current, "requires_vetted_interaction"))
        {
            var currentCode = TriggerString(current, "vetting_type_required");
            var nextCode = TriggerString(nextTriggers.Values, "vetting_type_required");
            if (!string.Equals(currentCode, nextCode, StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }

    private static bool HasProtectiveTriggers(string? triggersJson)
    {
        var triggers = ParseTriggerValues(triggersJson);
        return ProtectiveTriggerKeys.Any(key => IsTrue(triggers, key));
    }

    private static Dictionary<string, JsonElement> ParseTriggerValues(string? json)
    {
        var result = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(json))
        {
            return result;
        }
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in document.RootElement.EnumerateObject())
                {
                    result[property.Name] = property.Value.Clone();
                }
            }
        }
        catch (JsonException)
        {
            // Invalid legacy JSON has no enforceable trigger value.
        }
        return result;
    }

    private static bool IsTrue(IReadOnlyDictionary<string, JsonElement> values, string key)
        => values.TryGetValue(key, out var value) && value.ValueKind == JsonValueKind.True;

    private static string? TriggerString(IReadOnlyDictionary<string, JsonElement> values, string key)
        => values.TryGetValue(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string PreserveManagedCopy(
        SafeguardingOption option,
        string field,
        string submitted)
    {
        var current = field == "label" ? option.Label : option.Description;
        if (current is null)
        {
            return submitted;
        }
        if (field == "label")
        {
            var localized = SafeguardingVettingCatalog.EnglishOptionLabel(
                option.OptionKey,
                current,
                option.PresetSource);
            if (string.Equals(localized, submitted, StringComparison.Ordinal))
            {
                if (current.StartsWith("safeguarding.presets.", StringComparison.Ordinal))
                {
                    return current;
                }
                if (option.PresetSource is not null)
                {
                    var managed = SafeguardingVettingCatalog.PresetOptions(option.PresetSource)
                        .SingleOrDefault(candidate => candidate.OptionKey == option.OptionKey)?.Label;
                    if (managed?.StartsWith("safeguarding.presets.", StringComparison.Ordinal) == true)
                    {
                        return managed;
                    }
                }
            }
        }
        return submitted;
    }

    private static string StripTags(string value) => HtmlTags.Replace(value, string.Empty).Trim();

    private static string? ValidateHelpUrl(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }
        var value = raw.Trim();
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && uri.Host.Contains('.')
            ? value
            : null;
    }

    private static JsonElement? ParseJsonElement(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static bool IsPhpEmpty(string value) => value.Length == 0 || value == "0";

    private static bool IsPhpEmpty(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined or JsonValueKind.False => true,
        JsonValueKind.String => IsPhpEmpty(value.GetString() ?? string.Empty),
        JsonValueKind.Number => value.TryGetDecimal(out var number) && number == 0,
        JsonValueKind.Array => value.GetArrayLength() == 0,
        JsonValueKind.Object => !value.EnumerateObject().Any(),
        _ => false
    };

    private static int PhpInt(string value)
    {
        var trimmed = value.TrimStart();
        var match = Regex.Match(trimmed, "^[+-]?[0-9]+", RegexOptions.CultureInvariant);
        return match.Success
            && long.TryParse(match.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? (int)Math.Clamp(parsed, int.MinValue, int.MaxValue)
            : 0;
    }

    private static int PhpInt(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number
            && value.TryGetDecimal(out var number))
        {
            return (int)Math.Clamp(decimal.Truncate(number), int.MinValue, int.MaxValue);
        }
        return value.ValueKind switch
        {
            JsonValueKind.True => 1,
            JsonValueKind.String => PhpInt(value.GetString() ?? string.Empty),
            _ => 0
        };
    }

    private async Task<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction?> BeginTransactionAsync(
        CancellationToken cancellationToken)
        => _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;

    private void AddOptionAudit(
        int tenantId,
        string action,
        string entityType,
        int entityId,
        object details)
    {
        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = null,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Metadata = JsonSerializer.Serialize(details, AuditJson),
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.ToString(),
            Severity = AuditSeverity.Info,
            CreatedAt = DateTime.UtcNow
        });
    }

    private static object MapAssignment(SafeguardingAssignment a) => new
    {
        a.Id,
        ward = MapUser(a.Ward, a.WardUserId),
        guardian = MapUser(a.Guardian, a.GuardianUserId),
        a.Status,
        consent_given = a.ConsentGivenAt != null,
        consent_given_at = a.ConsentGivenAt,
        created_at = a.AssignedAt,
        expires_at = a.ExpiresAt,
        revoked_at = a.RevokedAt,
        a.Notes
    };

    private static object MapMessageReview(SafeguardingMessageReview r) => new
    {
        r.Id,
        message_id = r.MessageId,
        message_content = r.Message?.Content ?? string.Empty,
        sender = MapUser(r.Sender, r.SenderId),
        recipient = MapUser(r.Recipient, r.RecipientId),
        severity = r.Severity,
        flag_reason = r.FlagReason,
        is_reviewed = r.ReviewedAt != null,
        reviewed_by = Name(r.ReviewedBy),
        review_notes = r.ReviewNotes,
        reviewed_at = r.ReviewedAt,
        created_at = r.CreatedAt
    };

    private static object MapUser(User? user, int? id) => new
    {
        id = user?.Id ?? id,
        name = Name(user),
        email = user?.Email,
        avatar_url = user?.AvatarUrl
    };

    private static string Name(User? user)
    {
        if (user == null) return "Unknown user";
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private static object? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<JsonElement>(json, JsonOptions); }
        catch { return null; }
    }

    private static bool HasEnabledBooleanTrigger(string? triggersJson)
    {
        if (string.IsNullOrWhiteSpace(triggersJson)) return false;
        try
        {
            using var document = JsonDocument.Parse(triggersJson);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.EnumerateObject()
                    .Any(property => property.Value.ValueKind == JsonValueKind.True);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public class ReviewMessageRequest
    {
        [JsonPropertyName("notes"), MaxLength(4000)] public string? Notes { get; set; }
    }

    public class CreateSafeguardingAssignmentRequest
    {
        [JsonPropertyName("ward_user_id")] public int? WardUserId { get; set; }
        [JsonPropertyName("guardian_user_id")] public int? GuardianUserId { get; set; }
        [JsonPropertyName("ward_email")] public string? WardEmail { get; set; }
        [JsonPropertyName("guardian_email")] public string? GuardianEmail { get; set; }
        [JsonPropertyName("consent_given")] public bool ConsentGiven { get; set; }
        [JsonPropertyName("expires_at")] public DateTime? ExpiresAt { get; set; }
        [JsonPropertyName("notes"), MaxLength(2000)] public string? Notes { get; set; }
    }

    private enum TriggerValueType
    {
        Boolean,
        StringOrNull
    }

    private sealed record ValidatedTriggers(
        string Json,
        IReadOnlyDictionary<string, JsonElement> Values)
    {
        public static ValidatedTriggers Empty { get; } = new(
            "[]",
            new Dictionary<string, JsonElement>(StringComparer.Ordinal));
    }

    private sealed record TriggerValidation(ValidatedTriggers? Value, ObjectResult? Error);

    private readonly record struct OptionOrder(int OptionId, int SortOrder);

    private sealed class AdminSafeguardingOptionInput
    {
        private readonly Dictionary<string, JsonElement> _values = new(StringComparer.Ordinal);

        public IEnumerable<string> Keys => _values.Keys;
        public bool IsEmpty => _values.Count == 0;

        public static async Task<AdminSafeguardingOptionInput> ReadAsync(
            HttpRequest request,
            CancellationToken cancellationToken)
        {
            var result = new AdminSafeguardingOptionInput();
            foreach (var pair in request.Query)
            {
                result._values[pair.Key] = JsonSerializer.SerializeToElement(pair.Value.ToString());
            }

            if (request.HasFormContentType)
            {
                var form = await request.ReadFormAsync(cancellationToken);
                foreach (var pair in form)
                {
                    result._values[pair.Key] = JsonSerializer.SerializeToElement(pair.Value.ToString());
                }
                return result;
            }

            if (!IsJson(request.ContentType) || request.ContentLength == 0)
            {
                return result;
            }
            try
            {
                using var document = await JsonDocument.ParseAsync(
                    request.Body,
                    cancellationToken: cancellationToken);
                if (document.RootElement.ValueKind == JsonValueKind.Object)
                {
                    foreach (var property in document.RootElement.EnumerateObject())
                    {
                        result._values[property.Name] = property.Value.Clone();
                    }
                }
                else if (document.RootElement.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
                {
                    result._values["request"] = document.RootElement.Clone();
                }
            }
            catch (JsonException)
            {
                result._values["request"] = JsonSerializer.SerializeToElement<object?>(null);
            }
            return result;
        }

        public bool Contains(string key) => _values.ContainsKey(key);

        public bool TryGetElement(string key, out JsonElement value)
            => _values.TryGetValue(key, out value);

        public JsonElement? ElementOrNull(string key)
            => _values.TryGetValue(key, out var value) && value.ValueKind != JsonValueKind.Null
                ? value
                : null;

        public bool IsNull(string key)
            => _values.TryGetValue(key, out var value)
                && value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

        public string ScalarString(string key)
        {
            if (!_values.TryGetValue(key, out var value))
            {
                return string.Empty;
            }
            return value.ValueKind switch
            {
                JsonValueKind.String => value.GetString() ?? string.Empty,
                JsonValueKind.Number => value.GetRawText(),
                JsonValueKind.True => "1",
                JsonValueKind.False or JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
                _ => value.GetRawText()
            };
        }

        public string? NullableScalarString(string key)
            => IsNull(key) || !Contains(key) ? null : ScalarString(key);

        public bool PhpBool(string key)
        {
            if (!_values.TryGetValue(key, out var value))
            {
                return false;
            }
            if (value.ValueKind == JsonValueKind.True)
            {
                return true;
            }
            if (value.ValueKind is JsonValueKind.False or JsonValueKind.Null or JsonValueKind.Undefined)
            {
                return false;
            }
            if (value.ValueKind == JsonValueKind.Number)
            {
                return value.TryGetDecimal(out var number) && number == 1;
            }
            return ScalarString(key).Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
        }

        public int PhpInt(string key)
            => _values.TryGetValue(key, out var value)
                ? AdminSafeguardingController.PhpInt(value)
                : 0;

        public void Remove(params string[] keys)
        {
            foreach (var key in keys)
            {
                _values.Remove(key);
            }
        }

        private static bool IsJson(string? contentType)
        {
            if (string.IsNullOrWhiteSpace(contentType))
            {
                return false;
            }
            var mediaType = contentType.Split(';', 2)[0].Trim();
            return mediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)
                || mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase);
        }
    }
}
