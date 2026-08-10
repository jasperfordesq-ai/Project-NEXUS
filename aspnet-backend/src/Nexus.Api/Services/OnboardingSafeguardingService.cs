// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Canonical Laravel-compatible safeguarding step for member onboarding.
/// Preferences are tenant-scoped consent records; trigger details never leave
/// this service through the member-facing options response.
/// </summary>
public sealed class OnboardingSafeguardingService
{
    private const string LegacyMonitoringReason =
        "Safeguarding: self-identified during onboarding";
    private const string ManagedTranslationPrefix = "safeguarding.presets.";
    private static readonly JsonSerializerOptions AuditJson = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    private static readonly IReadOnlyDictionary<string, string> EnglishManagedCopy =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["safeguarding.presets.common.options.is_vulnerable_adult.label"] =
                "I consider myself a vulnerable adult and may need additional safeguarding support",
            ["safeguarding.presets.common.options.is_vulnerable_adult.description"] =
                "This lets our coordinators know you may need extra support when arranging exchanges. A coordinator will be in touch to discuss how we can help. This information is confidential.",
            ["safeguarding.presets.common.options.requires_vetted_partners.label"] =
                "I would prefer to only interact with members who have been appropriately vetted",
            ["safeguarding.presets.common.options.requires_coordinator_contact.label"] =
                "I would like a coordinator to help arrange my exchanges rather than being contacted directly",
            ["safeguarding.presets.common.options.requires_coordinator_contact.description"] =
                "A coordinator will mediate all contact and help arrange exchanges on your behalf. Other members will not be able to message you directly.",
            ["safeguarding.presets.common.options.no_home_visits.label"] =
                "I do not want members visiting my home without coordinator arrangement",
            ["safeguarding.presets.common.options.no_home_visits.description"] =
                "All home visits will be arranged through a coordinator who can ensure appropriate safeguards are in place.",
            ["safeguarding.presets.common.options.works_with_children.label"] =
                "I plan to offer services that may involve children or young people (under 18)",
            ["safeguarding.presets.common.options.works_with_vulnerable_adults.label"] =
                "I plan to offer services that may involve vulnerable adults",
            ["safeguarding.presets.common.options.none_apply.label"] = "None of these apply to me",
            ["safeguarding.presets.common.options.none_apply.description"] =
                "I have reviewed the options above and none of them apply to my situation. This is recorded so coordinators know I have seen and considered this step.",
            ["safeguarding.presets.ireland.options.requires_vetted_partners.description"] =
                "In Ireland, this means Garda Vetted members. Our coordinators will ensure you are only matched with vetted members.",
            ["safeguarding.presets.ireland.options.requires_coordinator_contact.description"] =
                "A coordinator (broker) will mediate all contact and help arrange exchanges on your behalf. Other members will not be able to message you directly.",
            ["safeguarding.presets.ireland.options.works_with_children.description"] =
                "A coordinator may discuss Garda Vetting requirements with you. In Ireland, certain activities involving children require vetting under the National Vetting Bureau Act 2012.",
            ["safeguarding.presets.ireland.options.works_with_vulnerable_adults.description"] =
                "A coordinator may discuss Garda Vetting requirements with you. Activities involving vulnerable adults may require vetting.",
            ["safeguarding.presets.england_wales.options.requires_vetted_partners.description"] =
                "In England & Wales, this means DBS-checked members. Our coordinators will ensure you are only matched with vetted members.",
            ["safeguarding.presets.england_wales.options.works_with_children.description"] =
                "A coordinator may discuss DBS check requirements with you.",
            ["safeguarding.presets.scotland.options.is_vulnerable_adult.label"] =
                "I consider myself a vulnerable or protected adult and may need additional safeguarding support",
            ["safeguarding.presets.scotland.options.requires_vetted_partners.description"] =
                "In Scotland, this means PVG scheme members. Our coordinators will ensure you are only matched with vetted members.",
            ["safeguarding.presets.scotland.options.works_with_children.description"] =
                "A coordinator may discuss PVG scheme membership with you.",
            ["safeguarding.presets.scotland.options.works_with_vulnerable_adults.label"] =
                "I plan to offer services that may involve protected adults",
            ["safeguarding.presets.northern_ireland.options.requires_vetted_partners.description"] =
                "In Northern Ireland, this means AccessNI-checked members. Our coordinators will ensure you are only matched with vetted members.",
            ["safeguarding.presets.northern_ireland.options.works_with_children.description"] =
                "A coordinator may discuss AccessNI checking with you."
        };

    // ASP.NET currently ships seven UI locales. Irish built-in safeguarding
    // copy is included here so managed preset rows localize without requiring a
    // tenant override; every locale can additionally override the same keys in
    // the tenant-scoped translations table.
    private static readonly IReadOnlyDictionary<string, string> IrishManagedCopy =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["safeguarding.presets.common.options.is_vulnerable_adult.label"] =
                "Measaim gur duine fásta leochaileach mé agus d’fhéadfadh tacaíocht bhreise chosanta a bheith ag teastáil uaim",
            ["safeguarding.presets.common.options.is_vulnerable_adult.description"] =
                "Cuireann sé seo in iúl dár gcomhordaitheoirí go bhféadfadh tacaíocht bhreise a bheith uait agus malartuithe á n-eagrú. Rachaidh comhordaitheoir i dteagmháil leat chun plé a dhéanamh ar an gcaoi ar féidir linn cabhrú leat. Tá an fhaisnéis seo faoi rún.",
            ["safeguarding.presets.common.options.requires_vetted_partners.label"] =
                "B’fhearr liom gan idirghníomhú ach le baill a ndearnadh grinnfhiosrúchán cuí orthu",
            ["safeguarding.presets.common.options.requires_coordinator_contact.label"] =
                "Ba mhaith liom go gcabhródh comhordaitheoir liom mo mhalartuithe a eagrú seachas teagmháil dhíreach a dhéanamh liom",
            ["safeguarding.presets.common.options.requires_coordinator_contact.description"] =
                "Déanfaidh comhordaitheoir idirghabháil i ngach teagmháil agus cabhróidh sé nó sí le malartuithe a eagrú ar do shon. Ní bheidh baill eile in ann teachtaireacht a chur chugat go díreach.",
            ["safeguarding.presets.common.options.no_home_visits.label"] =
                "Ní theastaíonn uaim go dtabharfadh baill cuairt ar mo theach gan socrú ó chomhordaitheoir",
            ["safeguarding.presets.common.options.no_home_visits.description"] =
                "Socrófar gach cuairt baile trí chomhordaitheoir ar féidir leis nó léi a chinntiú go bhfuil cosaintí cuí i bhfeidhm.",
            ["safeguarding.presets.common.options.works_with_children.label"] =
                "Tá sé beartaithe agam seirbhísí a thairiscint a bhféadfadh leanaí nó daoine óga (faoi 18) a bheith bainteach leo",
            ["safeguarding.presets.common.options.works_with_vulnerable_adults.label"] =
                "Tá sé beartaithe agam seirbhísí a thairiscint a bhféadfadh daoine fásta leochaileacha a bheith bainteach leo",
            ["safeguarding.presets.common.options.none_apply.label"] = "Ní bhaineann aon cheann díobh seo liom",
            ["safeguarding.presets.common.options.none_apply.description"] =
                "Tá na roghanna thuas athbhreithnithe agam agus ní bhaineann aon cheann díobh le mo chás. Déantar é seo a thaifeadadh ionas go mbeidh a fhios ag comhordaitheoirí go bhfaca mé an chéim seo agus gur smaoinigh mé uirthi.",
            ["safeguarding.presets.ireland.options.requires_vetted_partners.description"] =
                "In Éirinn, ciallaíonn sé seo baill a bhfuil Grinnfhiosrúchán an Gharda Síochána déanta orthu. Cinnteoidh ár gcomhordaitheoirí nach ndéanfar tú a mheaitseáil ach le baill a ndearnadh grinnfhiosrúchán orthu.",
            ["safeguarding.presets.ireland.options.requires_coordinator_contact.description"] =
                "Déanfaidh comhordaitheoir (bróicéir) idirghabháil i ngach teagmháil agus cabhróidh sé nó sí le malartuithe a eagrú ar do shon. Ní bheidh baill eile in ann teachtaireacht a chur chugat go díreach.",
            ["safeguarding.presets.ireland.options.works_with_children.description"] =
                "D’fhéadfadh comhordaitheoir riachtanais Ghrinnfhiosrúchán an Gharda Síochána a phlé leat. In Éirinn, tá grinnfhiosrúchán de dhíth le haghaidh gníomhaíochtaí áirithe a bhaineann le leanaí faoin Acht um an mBiúró Náisiúnta Grinnfhiosrúcháin, 2012.",
            ["safeguarding.presets.ireland.options.works_with_vulnerable_adults.description"] =
                "D’fhéadfadh comhordaitheoir riachtanais Ghrinnfhiosrúchán an Gharda Síochána a phlé leat. D’fhéadfadh grinnfhiosrúchán a bheith de dhíth le haghaidh gníomhaíochtaí a bhaineann le daoine fásta leochaileacha."
        };

    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _interactionPolicy;
    private readonly ILogger<OnboardingSafeguardingService> _logger;

    public OnboardingSafeguardingService(
        NexusDbContext db,
        SafeguardingInteractionPolicy interactionPolicy,
        ILogger<OnboardingSafeguardingService> logger)
    {
        _db = db;
        _interactionPolicy = interactionPolicy;
        _logger = logger;
    }

    public async Task<IReadOnlyList<OnboardingSafeguardingOptionView>> GetOptionsAsync(
        int tenantId,
        string locale,
        CancellationToken cancellationToken = default)
    {
        var options = await _db.SafeguardingOptions.IgnoreQueryFilters().AsNoTracking()
            .Where(option => option.TenantId == tenantId && option.IsActive)
            .OrderBy(option => option.SortOrder)
            .ThenBy(option => option.Id)
            .ToListAsync(cancellationToken);
        var translations = await LoadTranslationsAsync(tenantId, locale, options, cancellationToken);

        return options.Select(option => new OnboardingSafeguardingOptionView(
                option.Id,
                option.OptionKey,
                option.OptionType,
                LocalizeManagedCopy(option, "label", option.Label, locale, translations) ?? option.Label,
                LocalizeManagedCopy(option, "description", option.Description, locale, translations),
                option.HelpUrl,
                option.IsRequired,
                ParseSelectOptions(option.SelectOptionsJson)))
            .ToArray();
    }

    public async Task SavePreferencesAsync(
        int tenantId,
        int userId,
        IReadOnlyList<OnboardingSafeguardingPreferenceInput> submittedPreferences,
        string? ipAddress,
        string locale,
        CancellationToken cancellationToken = default)
    {
        await using (var transaction = await BeginTransactionAsync(cancellationToken))
        {
            await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);

            var activeOptions = await _db.SafeguardingOptions.IgnoreQueryFilters()
                .Where(option => option.TenantId == tenantId && option.IsActive)
                .OrderBy(option => option.Id)
                .ToListAsync(cancellationToken);
            var optionsById = activeOptions.ToDictionary(option => option.Id);
            var validated = ValidatePreferences(submittedPreferences, optionsById);

            var submittedValues = validated
                .GroupBy(preference => preference.OptionId)
                .ToDictionary(group => group.Key, group => group.Last().Value);
            var translations = await LoadTranslationsAsync(tenantId, locale, activeOptions, cancellationToken);
            foreach (var option in activeOptions.Where(option => option.IsRequired && option.OptionType != "info"))
            {
                submittedValues.TryGetValue(option.Id, out var value);
                var missing = option.OptionType == "select"
                    ? string.IsNullOrWhiteSpace(value)
                    : !IsTruthyPreferenceValue(value);
                if (missing)
                {
                    var label = LocalizeManagedCopy(option, "label", option.Label, locale, translations)
                        ?? option.Label;
                    throw new OnboardingSafeguardingValidationException(
                        $"Please respond to the required safeguarding option '{label}'.");
                }
            }

            // Match Laravel's post-validation mutual exclusivity rule: a real
            // selection wins over none_apply, while required-option validation
            // still sees the original submitted payload.
            var noneApplyIds = activeOptions
                .Where(option => option.OptionKey == "none_apply")
                .Select(option => option.Id)
                .ToHashSet();
            if (validated.Any(preference => noneApplyIds.Contains(preference.OptionId))
                && validated.Any(preference => !noneApplyIds.Contains(preference.OptionId)))
            {
                validated = validated
                    .Where(preference => !noneApplyIds.Contains(preference.OptionId))
                    .ToList();
            }

            var optionIds = validated.Select(preference => preference.OptionId).Distinct().ToArray();
            var existingRows = optionIds.Length == 0
                ? new List<UserSafeguardingPreference>()
                : await _db.UserSafeguardingPreferences.IgnoreQueryFilters()
                    .Where(preference => preference.TenantId == tenantId
                        && preference.UserId == userId
                        && optionIds.Contains(preference.OptionId))
                    .OrderBy(preference => preference.Id)
                    .ToListAsync(cancellationToken);
            var existingByOption = existingRows
                .GroupBy(preference => preference.OptionId)
                .ToDictionary(group => group.Key, group => group.First());
            var now = DateTime.UtcNow;

            foreach (var input in validated)
            {
                if (!optionsById.TryGetValue(input.OptionId, out var lockedOption) || !lockedOption.IsActive)
                {
                    throw InvalidOption();
                }

                if (!existingByOption.TryGetValue(input.OptionId, out var preference))
                {
                    preference = new UserSafeguardingPreference
                    {
                        TenantId = tenantId,
                        UserId = userId,
                        OptionId = input.OptionId,
                        CreatedAt = now
                    };
                    _db.UserSafeguardingPreferences.Add(preference);
                    existingByOption[input.OptionId] = preference;
                }

                preference.SelectedValue = input.Value;
                preference.Notes = input.Notes;
                preference.ConsentGivenAt = now;
                preference.ConsentIp = ipAddress;
                preference.RevokedAt = null;
                preference.PolicyReviewRequiredAt = null;
                preference.PolicyReviewReasonCode = null;
                preference.UpdatedAt = now;
            }

            _db.AuditLogs.Add(new AuditLog
            {
                TenantId = tenantId,
                UserId = userId,
                Action = "safeguarding_preferences_updated",
                EntityType = "user",
                EntityId = userId,
                IpAddress = ipAddress,
                Metadata = JsonSerializer.Serialize(new { options_count = validated.Count }, AuditJson),
                Severity = AuditSeverity.Info,
                CreatedAt = now
            });

            await _db.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }

        // Laravel commits consent first and treats trigger activation as a
        // post-commit side effect. The authoritative ASP interaction gate reads
        // the preference rows directly, so an ancillary notification failure
        // can never roll back or hide the member's consent.
        try
        {
            await ApplyTriggerSideEffectsAsync(tenantId, userId, ipAddress, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Onboarding safeguarding trigger activation failed after consent commit for tenant {TenantId}, user {UserId}",
                tenantId,
                userId);
        }
    }

    public async Task<string> ResolveLocaleAsync(
        int tenantId,
        int userId,
        string? requestedLocale,
        CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeLocale(requestedLocale);
        if (normalized is not null)
        {
            return normalized;
        }

        var preferred = await _db.UserLanguagePreferences.IgnoreQueryFilters().AsNoTracking()
            .Where(preference => preference.TenantId == tenantId && preference.UserId == userId)
            .Select(preference => preference.PreferredLocale)
            .FirstOrDefaultAsync(cancellationToken);
        normalized = NormalizeLocale(preferred);
        if (normalized is not null)
        {
            return normalized;
        }

        var tenantDefault = await _db.SupportedLocales.IgnoreQueryFilters().AsNoTracking()
            .Where(locale => locale.TenantId == tenantId && locale.IsActive && locale.IsDefault)
            .Select(locale => locale.Locale)
            .FirstOrDefaultAsync(cancellationToken);
        return NormalizeLocale(tenantDefault) ?? "en";
    }

    /// <summary>
    /// Rebuild the authoritative trigger projection after an administrator
    /// changes an option that is already selected by this member.
    /// </summary>
    public Task ReevaluateMemberTriggersAsync(
        int tenantId,
        int userId,
        string? ipAddress,
        CancellationToken cancellationToken = default)
        => ApplyTriggerSideEffectsAsync(tenantId, userId, ipAddress, cancellationToken);

    public async Task<string> ResolveBaseUrlAsync(
        int tenantId,
        string requestOrigin,
        CancellationToken cancellationToken = default)
    {
        var domain = await _db.Tenants.AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Domain)
            .SingleOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(domain))
        {
            return requestOrigin.TrimEnd('/');
        }

        var trimmed = domain.Trim().TrimEnd('/');
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute)
            ? absolute.ToString().TrimEnd('/')
            : $"https://{trimmed}";
    }

    private List<OnboardingSafeguardingPreferenceInput> ValidatePreferences(
        IReadOnlyList<OnboardingSafeguardingPreferenceInput> submitted,
        IReadOnlyDictionary<int, SafeguardingOption> activeOptions)
    {
        var validated = new List<OnboardingSafeguardingPreferenceInput>(submitted.Count);
        foreach (var preference in submitted)
        {
            if (preference.OptionId <= 0 || !activeOptions.TryGetValue(preference.OptionId, out var option))
            {
                throw InvalidOption();
            }
            if (preference.Value.Length > 255 || preference.Notes?.Length > 2000)
            {
                throw new OnboardingSafeguardingValidationException(
                    "The selected safeguarding value is invalid.");
            }

            if (option.OptionType == "select")
            {
                var allowed = AllowedSelectValues(option.SelectOptionsJson);
                if (allowed.Count > 0 && !allowed.Contains(preference.Value, StringComparer.Ordinal))
                {
                    throw new OnboardingSafeguardingValidationException(
                        "The selected safeguarding value is invalid.");
                }
            }
            validated.Add(preference);
        }
        return validated;
    }

    private async Task ApplyTriggerSideEffectsAsync(
        int tenantId,
        int userId,
        string? ipAddress,
        CancellationToken cancellationToken)
    {
        var triggers = await _interactionPolicy.GetActiveTriggerStateAsync(
            userId,
            tenantId,
            cancellationToken);
        var now = DateTime.UtcNow;
        var legacyRows = await _db.UserMonitoringRestrictions.IgnoreQueryFilters()
            .Where(restriction => restriction.TenantId == tenantId
                && restriction.UserId == userId
                && restriction.Reason == LegacyMonitoringReason)
            .ToListAsync(cancellationToken);
        foreach (var restriction in legacyRows)
        {
            restriction.UnderMonitoring = false;
            restriction.RequiresBrokerApproval = false;
            restriction.UpdatedAt = now;
        }

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = userId,
            Action = "safeguarding_triggers_activated",
            EntityType = "user",
            EntityId = userId,
            IpAddress = ipAddress,
            Metadata = JsonSerializer.Serialize(new
            {
                needs_monitoring = false,
                needs_broker_approval = triggers.RequiresBrokerApproval,
                triggers = new
                {
                    requires_vetted_interaction = triggers.RequiresVettedInteraction,
                    requires_broker_approval = triggers.RequiresBrokerApproval,
                    restricts_messaging = triggers.RestrictsMessaging,
                    restricts_matching = triggers.RestrictsMatching,
                    notify_admin_on_selection = triggers.NotifyAdminOnSelection,
                    vetting_types_required = triggers.VettingTypesRequired
                }
            }, AuditJson),
            Severity = AuditSeverity.Info,
            CreatedAt = now
        });
        await _db.SaveChangesAsync(cancellationToken);

        if (triggers.NotifyAdminOnSelection)
        {
            await NotifyStaffAsync(tenantId, userId, now, cancellationToken);
        }
    }

    private async Task NotifyStaffAsync(
        int tenantId,
        int memberId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var member = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(user => user.TenantId == tenantId && user.Id == memberId, cancellationToken);
        var memberName = member is null
            ? "Unknown member"
            : string.Join(' ', new[] { member.FirstName, member.LastName }
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim()));
        if (memberName.Length == 0)
        {
            memberName = "Unknown member";
        }

        var options = await (
                from preference in _db.UserSafeguardingPreferences.IgnoreQueryFilters().AsNoTracking()
                join option in _db.SafeguardingOptions.IgnoreQueryFilters().AsNoTracking()
                    on new { preference.TenantId, Id = preference.OptionId }
                    equals new { option.TenantId, Id = option.Id }
                where preference.TenantId == tenantId
                    && preference.UserId == memberId
                    && preference.RevokedAt == null
                    && option.IsActive
                orderby option.SortOrder, option.Id
                select option)
            .ToListAsync(cancellationToken);
        var staff = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(user => user.TenantId == tenantId
                && user.IsActive
                && user.SuspendedAt == null
                && (user.Role == "admin"
                    || user.Role == "tenant_admin"
                    || user.Role == "broker"
                    || user.Role == "super_admin"))
            .Select(user => user.Id)
            .Distinct()
            .ToListAsync(cancellationToken);
        var link = $"/broker/safeguarding?user={memberId}";
        var cutoff = now.AddMinutes(-10);
        var alreadyNotified = await _db.Notifications.IgnoreQueryFilters().AsNoTracking()
            .Where(notification => notification.TenantId == tenantId
                && staff.Contains(notification.UserId)
                && notification.Type == "safeguarding_flag"
                && notification.Link == link
                && notification.CreatedAt >= cutoff
                && notification.Title.StartsWith("Safeguarding flag:"))
            .Select(notification => notification.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);
        var alreadyNotifiedSet = alreadyNotified.ToHashSet();

        foreach (var staffUserId in staff.Where(id => !alreadyNotifiedSet.Contains(id)))
        {
            var locale = await ResolveLocaleAsync(tenantId, staffUserId, null, cancellationToken);
            var translations = await LoadTranslationsAsync(tenantId, locale, options, cancellationToken);
            var labels = options.Select(option =>
                    LocalizeManagedCopy(option, "label", option.Label, locale, translations) ?? option.Label)
                .ToArray();
            var summary = labels.Length == 0 ? "Selected support options" : string.Join(", ", labels);
            _db.Notifications.Add(new Notification
            {
                TenantId = tenantId,
                UserId = staffUserId,
                Type = "safeguarding_flag",
                Title = Truncate(
                    $"Safeguarding flag: {memberName} indicated support needs during onboarding — {summary}",
                    255),
                Link = link,
                IsRead = false,
                CreatedAt = now
            });
        }
        await _db.SaveChangesAsync(cancellationToken);
    }

    private async Task<Dictionary<string, string>> LoadTranslationsAsync(
        int tenantId,
        string locale,
        IReadOnlyCollection<SafeguardingOption> options,
        CancellationToken cancellationToken)
    {
        var keys = options.SelectMany(option => new[]
            {
                ManagedTranslationKey(option, "label", option.Label),
                ManagedTranslationKey(option, "description", option.Description)
            })
            .Where(key => key is not null)
            .Select(key => key!)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (keys.Length == 0)
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }

        var rows = await _db.Translations.IgnoreQueryFilters().AsNoTracking()
            .Where(translation => translation.TenantId == tenantId
                && translation.Locale == locale
                && translation.IsApproved
                && keys.Contains(translation.Key))
            .OrderByDescending(translation => translation.UpdatedAt ?? translation.CreatedAt)
            .ToListAsync(cancellationToken);
        return rows.GroupBy(translation => translation.Key, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().Value, StringComparer.Ordinal);
    }

    private static string? LocalizeManagedCopy(
        SafeguardingOption option,
        string field,
        string? value,
        string locale,
        IReadOnlyDictionary<string, string> tenantTranslations)
    {
        var key = ManagedTranslationKey(option, field, value);
        if (key is null)
        {
            return value;
        }
        if (tenantTranslations.TryGetValue(key, out var tenantTranslation))
        {
            return tenantTranslation;
        }
        if (locale == "ga" && IrishManagedCopy.TryGetValue(key, out var irish))
        {
            return irish;
        }
        return EnglishManagedCopy.TryGetValue(key, out var english) ? english : value;
    }

    private static string? ManagedTranslationKey(
        SafeguardingOption option,
        string field,
        string? value)
    {
        if (value is null)
        {
            return null;
        }
        if (value.StartsWith(ManagedTranslationPrefix, StringComparison.Ordinal))
        {
            return value;
        }
        if (option.PresetSource is null)
        {
            return null;
        }

        var definition = SafeguardingVettingCatalog.PresetOptions(option.PresetSource)
            .FirstOrDefault(candidate => candidate.OptionKey == option.OptionKey);
        var candidate = field == "label" ? definition?.Label : definition?.Description;
        if (candidate is null
            || !candidate.StartsWith(ManagedTranslationPrefix, StringComparison.Ordinal)
            || !EnglishManagedCopy.TryGetValue(candidate, out var legacyEnglish)
            || !string.Equals(value, legacyEnglish, StringComparison.Ordinal))
        {
            return null;
        }
        return candidate;
    }

    private static JsonElement? ParseSelectOptions(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Array
                ? document.RootElement.Clone()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static IReadOnlyList<string> AllowedSelectValues(string? json)
    {
        var parsed = ParseSelectOptions(json);
        if (parsed is null)
        {
            return Array.Empty<string>();
        }

        return parsed.Value.EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.Object
                && item.TryGetProperty("value", out _))
            .Select(item => ScalarString(item.GetProperty("value")))
            .Where(value => !string.IsNullOrEmpty(value))
            .Select(value => value!)
            .ToArray();
    }

    private static string? ScalarString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "1",
        JsonValueKind.False or JsonValueKind.Null => string.Empty,
        _ => null
    };

    private static bool IsTruthyPreferenceValue(string? value)
        => value is not null
            && new[] { "1", "true", "yes", "on" }.Contains(
                value.Trim().ToLowerInvariant(),
                StringComparer.Ordinal);

    private static string Truncate(string value, int maxLength)
        => value.Length <= maxLength ? value : value[..maxLength];

    private async Task<IDbContextTransaction?> BeginTransactionAsync(CancellationToken cancellationToken)
    {
        if (!_db.Database.IsRelational() || _db.Database.CurrentTransaction is not null)
        {
            return null;
        }
        return await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
    }

    private static string? NormalizeLocale(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }
        var first = raw.Split(',', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        if (first is null)
        {
            return null;
        }
        var withoutQuality = first.Split(';', 2)[0].Trim();
        var language = withoutQuality.Split('-', 2)[0].Trim().ToLowerInvariant();
        return language.Length is > 0 and <= 10 && language.All(char.IsLetter)
            ? language
            : null;
    }

    private static OnboardingSafeguardingValidationException InvalidOption()
        => new("One or more safeguarding options are invalid.");
}

public sealed record OnboardingSafeguardingOptionView(
    int Id,
    string OptionKey,
    string OptionType,
    string Label,
    string? Description,
    string? HelpUrl,
    bool IsRequired,
    JsonElement? SelectOptions);

public sealed record OnboardingSafeguardingPreferenceInput(
    int OptionId,
    string Value,
    string? Notes);

public sealed class OnboardingSafeguardingValidationException : Exception
{
    public OnboardingSafeguardingValidationException(string message)
        : base(message)
    {
    }
}
