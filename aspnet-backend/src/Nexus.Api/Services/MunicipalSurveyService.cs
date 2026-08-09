// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class MunicipalSurveyService
{
    private static readonly string[] SurveyStatuses = ["draft", "active", "closed"];
    private static readonly string[] QuestionTypes = ["single_choice", "multi_choice", "likert", "open_text", "yes_no"];

    private readonly NexusDbContext _db;

    public MunicipalSurveyService(NexusDbContext db)
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

        return ParseBool(raw) == true;
    }

    public async Task<IReadOnlyList<MunicipalSurveyRow>> ListSurveysAsync(
        int tenantId,
        string? status,
        CancellationToken ct)
    {
        var query = _db.MunicipalitySurveys
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(survey => survey.TenantId == tenantId);

        if (SurveyStatuses.Contains(status, StringComparer.Ordinal))
        {
            query = query.Where(survey => survey.Status == status);
        }

        var surveys = await query
            .OrderByDescending(survey => survey.CreatedAt)
            .ToListAsync(ct);

        var questionCounts = await QuestionCountsAsync(tenantId, surveys.Select(survey => survey.Id), ct);

        return surveys
            .Select(survey => MapSurvey(survey, null, questionCounts.GetValueOrDefault(survey.Id), null))
            .ToArray();
    }

    public async Task<IReadOnlyList<MunicipalSurveyRow>> ActiveSurveysAsync(int tenantId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var surveys = await _db.MunicipalitySurveys
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(survey =>
                survey.TenantId == tenantId
                && survey.Status == "active"
                && (survey.EndsAt == null || survey.EndsAt > now))
            .OrderByDescending(survey => survey.CreatedAt)
            .ToListAsync(ct);

        return surveys.Select(survey => MapSurvey(survey, null, null, null)).ToArray();
    }

    public async Task<MunicipalSurveyRow?> GetSurveyAsync(
        int tenantId,
        long id,
        bool includeDrafts,
        bool includeAnalytics,
        CancellationToken ct)
    {
        var survey = await _db.MunicipalitySurveys
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.Id == id)
            .FirstOrDefaultAsync(ct);

        if (survey is null)
        {
            return null;
        }

        if (!includeDrafts && survey.Status is not ("active" or "closed"))
        {
            return null;
        }

        var questions = await QuestionsForSurveyAsync(tenantId, id, ct);
        var analytics = includeAnalytics
            ? await AnalyticsAsync(tenantId, id, questions, ct)
            : null;

        return MapSurvey(survey, questions, questions.Count, analytics);
    }

    public async Task<MunicipalSurveyRow> CreateSurveyAsync(
        int tenantId,
        int userId,
        MunicipalSurveyRequest request,
        CancellationToken ct)
    {
        ValidateSurveyRequest(request, requireTitle: true);

        var now = DateTime.UtcNow;
        var survey = new MunicipalitySurvey
        {
            TenantId = tenantId,
            CreatedBy = userId,
            Title = TrimTo(request.Title!, 255),
            Description = request.Description,
            Status = "draft",
            IsAnonymous = request.IsAnonymous ?? false,
            TargetAudience = request.TargetAudience is null ? null : JsonSerializer.Serialize(request.TargetAudience),
            StartsAt = request.StartsAt,
            EndsAt = request.EndsAt,
            ResponseCount = 0,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.MunicipalitySurveys.Add(survey);
        await _db.SaveChangesAsync(ct);

        if (request.Questions is { Count: > 0 })
        {
            AddQuestions(survey.Id, tenantId, request.Questions, now);
            await _db.SaveChangesAsync(ct);
        }

        return (await GetSurveyAsync(tenantId, survey.Id, includeDrafts: true, includeAnalytics: false, ct))!;
    }

    public async Task<MunicipalSurveyRow?> UpdateSurveyAsync(
        int tenantId,
        long id,
        MunicipalSurveyRequest request,
        CancellationToken ct)
    {
        ValidateSurveyRequest(request, requireTitle: false);

        var survey = await _db.MunicipalitySurveys
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId && row.Id == id)
            .FirstOrDefaultAsync(ct);

        if (survey is null)
        {
            return null;
        }

        if (request.Title is not null)
        {
            survey.Title = TrimTo(request.Title, 255);
        }
        if (request.DescriptionSet)
        {
            survey.Description = request.Description;
        }
        if (request.IsAnonymous.HasValue)
        {
            survey.IsAnonymous = request.IsAnonymous.Value;
        }
        if (request.StartsAtSet)
        {
            survey.StartsAt = request.StartsAt;
        }
        if (request.EndsAtSet)
        {
            survey.EndsAt = request.EndsAt;
        }
        if (request.TargetAudience is not null)
        {
            survey.TargetAudience = JsonSerializer.Serialize(request.TargetAudience);
        }

        survey.UpdatedAt = DateTime.UtcNow;

        if (request.Questions is not null)
        {
            var existing = await _db.MunicipalitySurveyQuestions
                .IgnoreQueryFilters()
                .Where(question => question.TenantId == tenantId && question.SurveyId == id)
                .ToListAsync(ct);
            _db.MunicipalitySurveyQuestions.RemoveRange(existing);
            AddQuestions(id, tenantId, request.Questions, DateTime.UtcNow);
        }

        await _db.SaveChangesAsync(ct);
        return await GetSurveyAsync(tenantId, id, includeDrafts: true, includeAnalytics: false, ct);
    }

    public async Task<MunicipalSurveyLifecycleResult> PublishSurveyAsync(int tenantId, long id, CancellationToken ct)
    {
        var survey = await FindSurveyAsync(tenantId, id, tracking: true, ct);
        if (survey is null)
        {
            return MunicipalSurveyLifecycleResult.Error("SERVICE_ERROR", "Survey not found");
        }

        if (survey.Status != "draft")
        {
            return MunicipalSurveyLifecycleResult.Error("SERVICE_ERROR", "Only draft surveys can be published");
        }

        var questionCount = await _db.MunicipalitySurveyQuestions
            .IgnoreQueryFilters()
            .CountAsync(question => question.TenantId == tenantId && question.SurveyId == id, ct);
        if (questionCount == 0)
        {
            return MunicipalSurveyLifecycleResult.Error("SERVICE_ERROR", "Survey must have at least one question before publishing");
        }

        survey.Status = "active";
        survey.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return MunicipalSurveyLifecycleResult.Success();
    }

    public async Task<MunicipalSurveyLifecycleResult> CloseSurveyAsync(int tenantId, long id, CancellationToken ct)
    {
        var survey = await FindSurveyAsync(tenantId, id, tracking: true, ct);
        if (survey is null)
        {
            return MunicipalSurveyLifecycleResult.Error("SERVICE_ERROR", "Survey not found");
        }

        if (survey.Status != "active")
        {
            return MunicipalSurveyLifecycleResult.Error("SERVICE_ERROR", "Only active surveys can be closed");
        }

        survey.Status = "closed";
        survey.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return MunicipalSurveyLifecycleResult.Success();
    }

    public async Task<MunicipalSurveySubmitResult> SubmitSurveyAsync(
        int tenantId,
        long id,
        int userId,
        MunicipalSurveySubmitRequest request,
        string? ipHash,
        CancellationToken ct)
    {
        if (request.Answers is null)
        {
            return MunicipalSurveySubmitResult.Error("VALIDATION_ERROR", "Validation failed.", "answers");
        }

        var survey = await FindSurveyAsync(tenantId, id, tracking: true, ct);
        if (survey is null)
        {
            return MunicipalSurveySubmitResult.Error("SUBMIT_ERROR", "Survey not found");
        }

        if (survey.Status != "active")
        {
            return MunicipalSurveySubmitResult.Error("SUBMIT_ERROR", "Survey is not accepting responses");
        }

        if (survey.EndsAt is not null && survey.EndsAt <= DateTime.UtcNow)
        {
            return MunicipalSurveySubmitResult.Error("SUBMIT_ERROR", "Survey is closed");
        }

        var sessionToken = MakeSessionToken(userId, id);
        var alreadyResponded = await _db.MunicipalitySurveyResponses
            .IgnoreQueryFilters()
            .AnyAsync(response =>
                response.TenantId == tenantId
                && response.SurveyId == id
                && (response.UserId == userId || response.SessionToken == sessionToken), ct);
        if (alreadyResponded)
        {
            return MunicipalSurveySubmitResult.Error("SUBMIT_ERROR", "Already responded");
        }

        var questions = await _db.MunicipalitySurveyQuestions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(question => question.TenantId == tenantId && question.SurveyId == id)
            .OrderBy(question => question.SortOrder)
            .ThenBy(question => question.Id)
            .ToListAsync(ct);

        var answers = NormalizeAnswers(request.Answers);
        foreach (var question in questions.Where(question => question.IsRequired))
        {
            if (!answers.ContainsKey(question.Id.ToString()))
            {
                return MunicipalSurveySubmitResult.Error(
                    "VALIDATION_ERROR",
                    $"Question {question.Id} is required.");
            }
        }

        _db.MunicipalitySurveyResponses.Add(new MunicipalitySurveyResponse
        {
            TenantId = tenantId,
            SurveyId = id,
            UserId = survey.IsAnonymous ? null : userId,
            SessionToken = sessionToken,
            Answers = JsonSerializer.Serialize(answers),
            SubmittedAt = DateTime.UtcNow,
            IpHash = ipHash
        });
        survey.ResponseCount += 1;
        survey.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return MunicipalSurveySubmitResult.Success();
    }

    public async Task<string?> ExportCsvAsync(int tenantId, long id, CancellationToken ct)
    {
        var survey = await GetSurveyAsync(tenantId, id, includeDrafts: true, includeAnalytics: false, ct);
        if (survey is null)
        {
            return null;
        }

        var responses = await _db.MunicipalitySurveyResponses
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(response => response.TenantId == tenantId && response.SurveyId == id)
            .OrderBy(response => response.SubmittedAt)
            .ThenBy(response => response.Id)
            .ToListAsync(ct);

        var questions = survey.Questions ?? [];
        var builder = new StringBuilder();
        AppendCsvRow(builder, ["response_id", "submitted_at", "respondent", .. questions.Select(q => q.QuestionText)]);

        foreach (var response in responses)
        {
            var answers = ParseAnswerJson(response.Answers);
            var row = new List<string>
            {
                response.Id.ToString(),
                FormatDate(response.SubmittedAt),
                response.UserId?.ToString() ?? "anonymous"
            };

            foreach (var question in questions)
            {
                row.Add(AnswerToCsv(answers.GetValueOrDefault(question.Id.ToString())));
            }

            AppendCsvRow(builder, row);
        }

        return builder.ToString().TrimEnd('\n');
    }

    private async Task<MunicipalitySurvey?> FindSurveyAsync(int tenantId, long id, bool tracking, CancellationToken ct)
    {
        var query = _db.MunicipalitySurveys
            .IgnoreQueryFilters()
            .Where(survey => survey.TenantId == tenantId && survey.Id == id);

        if (!tracking)
        {
            query = query.AsNoTracking();
        }

        return await query.FirstOrDefaultAsync(ct);
    }

    private async Task<IReadOnlyList<MunicipalSurveyQuestionRow>> QuestionsForSurveyAsync(
        int tenantId,
        long id,
        CancellationToken ct)
    {
        var questions = await _db.MunicipalitySurveyQuestions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(question => question.TenantId == tenantId && question.SurveyId == id)
            .OrderBy(question => question.SortOrder)
            .ThenBy(question => question.Id)
            .ToListAsync(ct);

        return questions.Select(MapQuestion).ToArray();
    }

    private async Task<Dictionary<long, int>> QuestionCountsAsync(
        int tenantId,
        IEnumerable<long> surveyIds,
        CancellationToken ct)
    {
        var ids = surveyIds.ToArray();
        if (ids.Length == 0)
        {
            return [];
        }

        return await _db.MunicipalitySurveyQuestions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(question => question.TenantId == tenantId && ids.Contains(question.SurveyId))
            .GroupBy(question => question.SurveyId)
            .ToDictionaryAsync(group => group.Key, group => group.Count(), ct);
    }

    private async Task<MunicipalSurveyAnalytics> AnalyticsAsync(
        int tenantId,
        long id,
        IReadOnlyList<MunicipalSurveyQuestionRow> questions,
        CancellationToken ct)
    {
        var responses = await _db.MunicipalitySurveyResponses
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(response => response.TenantId == tenantId && response.SurveyId == id)
            .OrderBy(response => response.SubmittedAt)
            .ToListAsync(ct);

        var daily = responses
            .Where(response => response.SubmittedAt >= DateTime.UtcNow.AddDays(-30))
            .GroupBy(response => response.SubmittedAt.Date)
            .OrderBy(group => group.Key)
            .Select(group => new MunicipalSurveyDailyCount(group.Key.ToString("yyyy-MM-dd"), group.Count()))
            .ToArray();

        var questionAnalytics = new List<MunicipalSurveyQuestionAnalytics>();
        foreach (var question in questions)
        {
            if (question.QuestionType == "open_text")
            {
                var verbatims = responses
                    .OrderByDescending(response => response.SubmittedAt)
                    .Select(response => ParseAnswerJson(response.Answers).GetValueOrDefault(question.Id.ToString()))
                    .Where(value => !string.IsNullOrWhiteSpace(AnswerToCsv(value)))
                    .Select(AnswerToCsv)
                    .Take(10)
                    .ToArray();

                questionAnalytics.Add(new MunicipalSurveyQuestionAnalytics(
                    question.Id,
                    question.QuestionText,
                    question.QuestionType,
                    verbatims.Length,
                    null,
                    verbatims));
                continue;
            }

            var options = question.Options?.ToList() ?? [];
            if (question.QuestionType == "yes_no" && options.Count == 0)
            {
                options = ["Yes", "No"];
            }

            var tallies = options.ToDictionary(option => option, _ => 0, StringComparer.Ordinal);
            var answeredCount = 0;
            foreach (var response in responses)
            {
                var answers = ParseAnswerJson(response.Answers);
                if (!answers.TryGetValue(question.Id.ToString(), out var value) || value.ValueKind == JsonValueKind.Null)
                {
                    continue;
                }

                answeredCount++;
                if (question.QuestionType == "multi_choice" && value.ValueKind == JsonValueKind.Array)
                {
                    foreach (var selected in value.EnumerateArray())
                    {
                        Increment(tallies, selected.ToString());
                    }
                }
                else
                {
                    Increment(tallies, value.ToString());
                }
            }

            var breakdown = tallies
                .Select(pair => new MunicipalSurveyOptionBreakdown(
                    pair.Key,
                    pair.Value,
                    answeredCount > 0
                        ? Math.Round(pair.Value / (double)answeredCount * 100, 1, MidpointRounding.AwayFromZero)
                        : 0.0))
                .ToArray();

            questionAnalytics.Add(new MunicipalSurveyQuestionAnalytics(
                question.Id,
                question.QuestionText,
                question.QuestionType,
                answeredCount,
                breakdown,
                null));
        }

        return new MunicipalSurveyAnalytics(id, responses.Count, daily, questionAnalytics);
    }

    private void AddQuestions(long surveyId, int tenantId, IReadOnlyList<MunicipalSurveyQuestionRequest> questions, DateTime now)
    {
        foreach (var question in questions)
        {
            if (string.IsNullOrWhiteSpace(question.QuestionText) || string.IsNullOrWhiteSpace(question.QuestionType))
            {
                continue;
            }

            _db.MunicipalitySurveyQuestions.Add(new MunicipalitySurveyQuestion
            {
                TenantId = tenantId,
                SurveyId = surveyId,
                QuestionText = TrimTo(question.QuestionText, 500),
                QuestionType = question.QuestionType,
                Options = question.Options is { Count: > 0 } ? JsonSerializer.Serialize(question.Options) : null,
                IsRequired = question.IsRequired ?? false,
                SortOrder = question.SortOrder ?? 0,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
    }

    private static void ValidateSurveyRequest(MunicipalSurveyRequest request, bool requireTitle)
    {
        if (requireTitle && string.IsNullOrWhiteSpace(request.Title))
        {
            throw new MunicipalSurveyValidationException("title is required", "title");
        }

        if (!string.IsNullOrWhiteSpace(request.Title) && request.Title.Length > 255)
        {
            throw new MunicipalSurveyValidationException("title is too long", "title");
        }

        if (request.Questions is null)
        {
            return;
        }

        foreach (var question in request.Questions)
        {
            if (string.IsNullOrWhiteSpace(question.QuestionText))
            {
                throw new MunicipalSurveyValidationException("question_text is required", "question_text");
            }

            if (!QuestionTypes.Contains(question.QuestionType, StringComparer.Ordinal))
            {
                throw new MunicipalSurveyValidationException("question_type is invalid", "question_type");
            }
        }
    }

    private static MunicipalSurveyRow MapSurvey(
        MunicipalitySurvey survey,
        IReadOnlyList<MunicipalSurveyQuestionRow>? questions,
        int? questionCount,
        MunicipalSurveyAnalytics? analytics)
    {
        return new MunicipalSurveyRow(
            survey.Id,
            survey.TenantId,
            survey.CreatedBy,
            survey.Title,
            survey.Description,
            survey.Status,
            survey.IsAnonymous,
            ParseJsonObject(survey.TargetAudience),
            FormatNullableDate(survey.StartsAt),
            FormatNullableDate(survey.EndsAt),
            survey.ResponseCount,
            FormatDate(survey.CreatedAt),
            survey.UpdatedAt.HasValue ? FormatDate(survey.UpdatedAt.Value) : null,
            questionCount,
            questions,
            analytics);
    }

    private static MunicipalSurveyQuestionRow MapQuestion(MunicipalitySurveyQuestion question)
    {
        return new MunicipalSurveyQuestionRow(
            question.Id,
            question.SurveyId,
            question.TenantId,
            question.QuestionText,
            question.QuestionType,
            ParseStringArray(question.Options),
            question.IsRequired,
            question.SortOrder,
            FormatDate(question.CreatedAt),
            question.UpdatedAt.HasValue ? FormatDate(question.UpdatedAt.Value) : null);
    }

    private static Dictionary<string, object?> NormalizeAnswers(IReadOnlyDictionary<string, object?> answers)
    {
        return answers.ToDictionary(
            pair => pair.Key,
            pair => NormalizeAnswerValue(pair.Value),
            StringComparer.Ordinal);
    }

    private static object? NormalizeAnswerValue(object? value)
    {
        if (value is JsonElement element)
        {
            return element.ValueKind switch
            {
                JsonValueKind.String => element.GetString(),
                JsonValueKind.Number => element.TryGetInt64(out var integer) ? integer : element.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Array => element.EnumerateArray().Select(item => NormalizeAnswerValue(item)).ToArray(),
                JsonValueKind.Object => element.EnumerateObject().ToDictionary(
                    property => property.Name,
                    property => NormalizeAnswerValue(property.Value)),
                _ => null
            };
        }

        if (value is System.Collections.IEnumerable enumerable && value is not string)
        {
            var items = new List<object?>();
            foreach (var item in enumerable)
            {
                items.Add(NormalizeAnswerValue(item));
            }

            return items;
        }

        return value;
    }

    private static Dictionary<string, JsonElement> ParseAnswerJson(string raw)
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(raw) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static IReadOnlyList<string>? ParseStringArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<IReadOnlyList<string>>(raw);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static object? ParseJsonObject(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<object>(raw);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string AnswerToCsv(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.Array => string.Join("; ", value.EnumerateArray().Select(item => item.ToString())),
            JsonValueKind.Null or JsonValueKind.Undefined => "",
            _ => value.ToString()
        };
    }

    private static void AppendCsvRow(StringBuilder builder, IReadOnlyList<string> cells)
    {
        for (var index = 0; index < cells.Count; index++)
        {
            if (index > 0)
            {
                builder.Append(',');
            }

            builder.Append(EscapeCsvCell(cells[index]));
        }

        builder.Append('\n');
    }

    private static string EscapeCsvCell(string raw)
    {
        var value = raw;
        if (value.Length > 0 && "=+-@".Contains(value[0], StringComparison.Ordinal))
        {
            value = "'" + value;
        }

        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? "\"" + value.Replace("\"", "\"\"") + "\""
            : value;
    }

    private static void Increment(IDictionary<string, int> tallies, string key)
    {
        if (!tallies.ContainsKey(key))
        {
            tallies[key] = 0;
        }

        tallies[key]++;
    }

    private static string MakeSessionToken(int userId, long surveyId)
    {
        var input = $"{userId}|{surveyId}|{DateTime.UtcNow:yyyy-MM-dd}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string TrimTo(string value, int maxLength)
    {
        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private static string FormatDate(DateTime value)
    {
        return value.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss");
    }

    private static string? FormatNullableDate(DateTime? value)
    {
        return value.HasValue ? FormatDate(value.Value) : null;
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }
}

public sealed class MunicipalSurveyValidationException : Exception
{
    public MunicipalSurveyValidationException(string message, string? field = null) : base(message)
    {
        Field = field;
    }

    public string? Field { get; }
}

public sealed class MunicipalSurveyRequest
{
    private string? _description;
    private DateTime? _startsAt;
    private DateTime? _endsAt;

    [JsonPropertyName("title")] public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description
    {
        get => _description;
        set
        {
            _description = value;
            DescriptionSet = true;
        }
    }

    [JsonIgnore] public bool DescriptionSet { get; private set; }
    [JsonPropertyName("is_anonymous")] public bool? IsAnonymous { get; set; }
    [JsonPropertyName("target_audience")] public Dictionary<string, object?>? TargetAudience { get; set; }

    [JsonPropertyName("starts_at")]
    public DateTime? StartsAt
    {
        get => _startsAt;
        set
        {
            _startsAt = value;
            StartsAtSet = true;
        }
    }

    [JsonIgnore] public bool StartsAtSet { get; private set; }

    [JsonPropertyName("ends_at")]
    public DateTime? EndsAt
    {
        get => _endsAt;
        set
        {
            _endsAt = value;
            EndsAtSet = true;
        }
    }

    [JsonIgnore] public bool EndsAtSet { get; private set; }
    [JsonPropertyName("questions")] public List<MunicipalSurveyQuestionRequest>? Questions { get; set; }
}

public sealed class MunicipalSurveyQuestionRequest
{
    [JsonPropertyName("question_text")] public string? QuestionText { get; set; }
    [JsonPropertyName("question_type")] public string? QuestionType { get; set; }
    [JsonPropertyName("options")] public List<string>? Options { get; set; }
    [JsonPropertyName("is_required")] public bool? IsRequired { get; set; }
    [JsonPropertyName("sort_order")] public int? SortOrder { get; set; }
}

public sealed class MunicipalSurveySubmitRequest
{
    [JsonPropertyName("answers")] public Dictionary<string, object?>? Answers { get; set; }
}

public sealed record MunicipalSurveyLifecycleResult(bool Ok, string? ErrorCode = null, string? Message = null)
{
    public static MunicipalSurveyLifecycleResult Success() => new(true);

    public static MunicipalSurveyLifecycleResult Error(string code, string message) => new(false, code, message);
}

public sealed record MunicipalSurveySubmitResult(bool Ok, string? ErrorCode = null, string? Message = null, string? Field = null)
{
    public static MunicipalSurveySubmitResult Success() => new(true);

    public static MunicipalSurveySubmitResult Error(string code, string message, string? field = null) => new(false, code, message, field);
}

public sealed record MunicipalSurveyRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("created_by")] int CreatedBy,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("is_anonymous")] bool IsAnonymous,
    [property: JsonPropertyName("target_audience")] object? TargetAudience,
    [property: JsonPropertyName("starts_at")] string? StartsAt,
    [property: JsonPropertyName("ends_at")] string? EndsAt,
    [property: JsonPropertyName("response_count")] int ResponseCount,
    [property: JsonPropertyName("created_at")] string CreatedAt,
    [property: JsonPropertyName("updated_at")] string? UpdatedAt,
    [property: JsonPropertyName("question_count")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? QuestionCount,
    [property: JsonPropertyName("questions")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<MunicipalSurveyQuestionRow>? Questions,
    [property: JsonPropertyName("analytics")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    MunicipalSurveyAnalytics? Analytics);

public sealed record MunicipalSurveyQuestionRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("survey_id")] long SurveyId,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("question_text")] string QuestionText,
    [property: JsonPropertyName("question_type")] string QuestionType,
    [property: JsonPropertyName("options")] IReadOnlyList<string>? Options,
    [property: JsonPropertyName("is_required")] bool IsRequired,
    [property: JsonPropertyName("sort_order")] int SortOrder,
    [property: JsonPropertyName("created_at")] string CreatedAt,
    [property: JsonPropertyName("updated_at")] string? UpdatedAt);

public sealed record MunicipalSurveyAnalytics(
    [property: JsonPropertyName("survey_id")] long SurveyId,
    [property: JsonPropertyName("response_count")] int ResponseCount,
    [property: JsonPropertyName("daily_chart")] IReadOnlyList<MunicipalSurveyDailyCount> DailyChart,
    [property: JsonPropertyName("questions")] IReadOnlyList<MunicipalSurveyQuestionAnalytics> Questions);

public sealed record MunicipalSurveyDailyCount(
    [property: JsonPropertyName("day")] string Day,
    [property: JsonPropertyName("count")] int Count);

public sealed record MunicipalSurveyQuestionAnalytics(
    [property: JsonPropertyName("question_id")] long QuestionId,
    [property: JsonPropertyName("question_text")] string QuestionText,
    [property: JsonPropertyName("question_type")] string QuestionType,
    [property: JsonPropertyName("answer_count")] int AnswerCount,
    [property: JsonPropertyName("breakdown")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<MunicipalSurveyOptionBreakdown>? Breakdown,
    [property: JsonPropertyName("verbatims")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? Verbatims);

public sealed record MunicipalSurveyOptionBreakdown(
    [property: JsonPropertyName("option")] string Option,
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("percentage")] double Percentage);
