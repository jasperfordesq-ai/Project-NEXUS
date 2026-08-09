// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Nexus.Api.Clients;
using Nexus.Api.Configuration;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for AI-powered features in the timebanking platform.
/// </summary>
public class AiService
{
    private readonly ILlamaClient _llamaClient;
    private readonly NexusDbContext _db;
    private readonly LlamaServiceOptions _options;
    private readonly ILogger<AiService> _logger;

    private static readonly System.Text.Json.JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public AiService(
        ILlamaClient llamaClient,
        NexusDbContext db,
        IOptions<LlamaServiceOptions> options,
        ILogger<AiService> logger)
    {
        _llamaClient = llamaClient;
        _db = db;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// Generate smart suggestions for a listing (title, description, tags, time estimate).
    /// </summary>
    public async Task<ListingSuggestions> SuggestListingImprovements(
        string title,
        string? description,
        ListingType type,
        CancellationToken ct = default)
    {
        var typeStr = type == ListingType.Offer ? "offering a service" : "requesting a service";

        var prompt = $@"You are helping a user improve their timebanking listing. They are {typeStr}.

Current title: {title}
Current description: {description ?? "(none provided)"}

Provide suggestions in this exact JSON format (no markdown, just raw JSON):
{{
  ""improvedTitle"": ""a clearer, more engaging title (max 60 chars)"",
  ""improvedDescription"": ""an improved description that is clear and appealing (2-3 sentences)"",
  ""suggestedTags"": [""tag1"", ""tag2"", ""tag3""],
  ""estimatedHours"": 1.5,
  ""tips"": [""tip for better listing"", ""another tip""]
}}

Only respond with the JSON, nothing else.";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            // Parse the JSON response
            var suggestions = System.Text.Json.JsonSerializer.Deserialize<ListingSuggestions>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return suggestions ?? new ListingSuggestions();
        }
        catch (System.Text.Json.JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse AI listing suggestions");
            return new ListingSuggestions
            {
                ImprovedTitle = title,
                ImprovedDescription = description ?? "",
                SuggestedTags = new List<string>(),
                EstimatedHours = 1.0m,
                Tips = new List<string> { "Try adding more details to your listing" }
            };
        }
    }

    /// <summary>
    /// Find matching users for a listing based on skills and activity.
    /// </summary>
    public async Task<List<MatchedUser>> FindMatchesForListing(
        int listingId,
        int maxResults = 5,
        CancellationToken ct = default)
    {
        var listing = await _db.Listings
            .Include(l => l.User)
            .FirstOrDefaultAsync(l => l.Id == listingId, ct);

        if (listing == null)
            return new List<MatchedUser>();

        // Get other users in the same tenant who have complementary listings
        var otherUsers = await _db.Users
            .Where(u => u.Id != listing.UserId && u.IsActive)
            .Select(u => new
            {
                u.Id,
                u.FirstName,
                u.LastName,
                u.Level,
                u.TotalXp,
                // Get their listings (opposite type to match)
                Listings = _db.Listings
                    .Where(l => l.UserId == u.Id && l.Status == ListingStatus.Active)
                    .Select(l => new { l.Title, l.Description, l.Type })
                    .Take(5)
                    .ToList()
            })
            .Take(20)
            .ToListAsync(ct);

        if (!otherUsers.Any())
            return new List<MatchedUser>();

        // Build context for AI matching
        var usersContext = string.Join("\n", otherUsers.Select(u =>
            $"User {u.Id} ({u.FirstName} {u.LastName}, Level {u.Level}): " +
            string.Join("; ", u.Listings.Select(l => $"{l.Type}: {l.Title}"))));

        var prompt = $@"You are matching users for a timebanking platform.

The listing to match:
Type: {listing.Type}
Title: {listing.Title}
Description: {listing.Description ?? "N/A"}

Available users and their listings:
{usersContext}

Find the best matches. Respond with JSON array of user IDs and match reasons:
[
  {{""userId"": 123, ""score"": 0.95, ""reason"": ""They offer exactly what you need""}},
  {{""userId"": 456, ""score"": 0.80, ""reason"": ""Similar skills available""}}
]

Return up to {maxResults} matches, sorted by score. Only JSON, no markdown.";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var matches = System.Text.Json.JsonSerializer.Deserialize<List<AiMatch>>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new List<AiMatch>();

            // Enrich with user data
            var result = new List<MatchedUser>();
            foreach (var match in matches.Take(maxResults))
            {
                var user = otherUsers.FirstOrDefault(u => u.Id == match.UserId);
                if (user != null)
                {
                    result.Add(new MatchedUser
                    {
                        UserId = user.Id,
                        Name = $"{user.FirstName} {user.LastName}",
                        Level = user.Level,
                        MatchScore = match.Score,
                        MatchReason = match.Reason
                    });
                }
            }
            return result;
        }
        catch (System.Text.Json.JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse AI matches");
            return new List<MatchedUser>();
        }
    }

    /// <summary>
    /// Natural language search across listings.
    /// </summary>
    public async Task<List<SearchResult>> SmartSearch(
        string query,
        int maxResults = 10,
        CancellationToken ct = default)
    {
        // First, get active listings from the database
        var listings = await _db.Listings
            .Include(l => l.User)
            .Where(l => l.Status == ListingStatus.Active)
            .OrderByDescending(l => l.CreatedAt)
            .Take(50) // Limit to recent listings for AI context
            .Select(l => new
            {
                l.Id,
                l.Title,
                l.Description,
                l.Type,
                l.EstimatedHours,
                l.Location,
                UserName = l.User != null ? $"{l.User.FirstName} {l.User.LastName}" : "Unknown"
            })
            .ToListAsync(ct);

        if (!listings.Any())
            return new List<SearchResult>();

        var listingsContext = string.Join("\n", listings.Select(l =>
            $"[{l.Id}] {l.Type}: \"{l.Title}\" - {(l.Description != null ? l.Description[..Math.Min(100, l.Description.Length)] : "No description")} (by {l.UserName})"));

        var prompt = $@"You are a search assistant for a timebanking platform.

User's search query: ""{query}""

Available listings:
{listingsContext}

Find listings that match the user's intent. Consider:
- Semantic meaning (e.g., ""fix bike"" matches ""bicycle repair"")
- Related services
- User's likely needs

Respond with a JSON array of matching listing IDs with relevance scores:
[
  {{""listingId"": 123, ""relevance"": 0.95, ""reason"": ""Exact match for bike repair""}},
  {{""listingId"": 456, ""relevance"": 0.70, ""reason"": ""Related cycling service""}}
]

Return up to {maxResults} results sorted by relevance. Only JSON, no markdown.";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var aiResults = System.Text.Json.JsonSerializer.Deserialize<List<AiSearchResult>>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            ) ?? new List<AiSearchResult>();

            var results = new List<SearchResult>();
            foreach (var aiResult in aiResults.Take(maxResults))
            {
                var listing = listings.FirstOrDefault(l => l.Id == aiResult.ListingId);
                if (listing != null)
                {
                    results.Add(new SearchResult
                    {
                        ListingId = listing.Id,
                        Title = listing.Title,
                        Description = listing.Description,
                        Type = listing.Type.ToString(),
                        UserName = listing.UserName,
                        Relevance = aiResult.Relevance,
                        MatchReason = aiResult.Reason
                    });
                }
            }
            return results;
        }
        catch (System.Text.Json.JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse AI search results");
            return new List<SearchResult>();
        }
    }

    /// <summary>
    /// Moderate content for appropriateness.
    /// </summary>
    public virtual async Task<ModerationResult> ModerateContent(
        string content,
        string contentType = "listing",
        CancellationToken ct = default)
    {
        var prompt = $@"You are a content moderator for a community timebanking platform.

Review this {contentType} content for:
1. Inappropriate language or content
2. Spam or scam indicators
3. Safety concerns
4. Quality issues

Content to review:
""{content}""

Respond with JSON:
{{
  ""isApproved"": true,
  ""flaggedIssues"": [],
  ""severity"": ""none"",
  ""suggestions"": [""optional improvement suggestions""]
}}

Severity levels: none, low, medium, high, critical
Only JSON, no markdown.";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var result = System.Text.Json.JsonSerializer.Deserialize<ModerationResult>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return result ?? new ModerationResult { IsApproved = true, Severity = "none" };
        }
        catch (System.Text.Json.JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse AI moderation result");
            return new ModerationResult { IsApproved = true, Severity = "unknown" };
        }
    }

    /// <summary>
    /// Generate profile enhancement suggestions.
    /// </summary>
    public async Task<ProfileSuggestions> SuggestProfileEnhancements(
        int userId,
        CancellationToken ct = default)
    {
        var user = await _db.Users
            .Include(u => u.UserBadges)
                .ThenInclude(ub => ub.Badge)
            .FirstOrDefaultAsync(u => u.Id == userId, ct);

        if (user == null)
            return new ProfileSuggestions();

        // Get user's listings and activity
        var userListings = await _db.Listings
            .Where(l => l.UserId == userId)
            .Select(l => new { l.Title, l.Type, l.Status })
            .Take(10)
            .ToListAsync(ct);

        var badges = user.UserBadges.Select(ub => ub.Badge?.Name ?? "Unknown").ToList();
        var listingsSummary = string.Join(", ", userListings.Select(l => $"{l.Type}: {l.Title}"));

        var prompt = $@"You are helping a timebanking user improve their profile.

User info:
- Name: {user.FirstName} {user.LastName}
- Level: {user.Level}
- XP: {user.TotalXp}
- Badges earned: {string.Join(", ", badges)}
- Their listings: {listingsSummary}

Suggest profile improvements. Respond with JSON:
{{
  ""suggestedSkills"": [""skill1"", ""skill2"", ""skill3""],
  ""bioSuggestion"": ""A suggested bio based on their activity"",
  ""nextBadgeGoal"": ""Name of a badge they could work toward"",
  ""tips"": [""actionable tip 1"", ""actionable tip 2""]
}}

Only JSON, no markdown.";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var suggestions = System.Text.Json.JsonSerializer.Deserialize<ProfileSuggestions>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return suggestions ?? new ProfileSuggestions();
        }
        catch (System.Text.Json.JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse AI profile suggestions");
            return new ProfileSuggestions();
        }
    }

    /// <summary>
    /// Generate community insights and trends.
    /// </summary>
    public async Task<CommunityInsights> GetCommunityInsights(CancellationToken ct = default)
    {
        // Gather community statistics
        var totalUsers = await _db.Users.CountAsync(u => u.IsActive, ct);
        var totalListings = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Active, ct);

        var recentListings = await _db.Listings
            .Where(l => l.CreatedAt > DateTime.UtcNow.AddDays(-30))
            .GroupBy(l => l.Type)
            .Select(g => new { Type = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var activeTitles = await _db.Listings
            .Where(l => l.Status == ListingStatus.Active)
            .Select(l => l.Title)
            .ToListAsync(ct);

        var topCategories = activeTitles
            .GroupBy(t => t.ToLower().Substring(0, Math.Min(20, t.Length)))
            .OrderByDescending(g => g.Count())
            .Take(5)
            .Select(g => new { Category = g.Key, Count = g.Count() })
            .ToList();

        var prompt = $@"You are analyzing a timebanking community.

Community stats:
- Active users: {totalUsers}
- Active listings: {totalListings}
- New offers (30 days): {recentListings.FirstOrDefault(r => r.Type == ListingType.Offer)?.Count ?? 0}
- New requests (30 days): {recentListings.FirstOrDefault(r => r.Type == ListingType.Request)?.Count ?? 0}
- Popular listing types: {string.Join(", ", topCategories.Select(c => c.Category))}

Generate community insights. Respond with JSON:
{{
  ""summary"": ""A 2-sentence summary of the community health"",
  ""trendingServices"": [""trending service 1"", ""trending service 2""],
  ""skillGaps"": [""services that are needed but not offered""],
  ""recommendations"": [""actionable recommendation for community growth""],
  ""healthScore"": 85
}}

Health score is 0-100. Only JSON, no markdown.";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var insights = System.Text.Json.JsonSerializer.Deserialize<CommunityInsights>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            if (insights != null)
            {
                insights.TotalActiveUsers = totalUsers;
                insights.TotalActiveListings = totalListings;
            }
            return insights ?? new CommunityInsights();
        }
        catch (System.Text.Json.JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse AI community insights");
            return new CommunityInsights
            {
                TotalActiveUsers = totalUsers,
                TotalActiveListings = totalListings,
                Summary = "Unable to generate insights at this time."
            };
        }
    }

    /// <summary>
    /// Translate text to another language.
    /// </summary>
    public async Task<TranslationResult> Translate(
        string text,
        string targetLanguage,
        CancellationToken ct = default)
    {
        var prompt = $@"Translate the following text to {targetLanguage}.
Preserve the original meaning and tone. Only respond with the translation, nothing else.

Text to translate:
""{text}""";

        var response = await CallAiAsync(prompt, ct);

        return new TranslationResult
        {
            OriginalText = text,
            TranslatedText = response.Trim().Trim('"'),
            TargetLanguage = targetLanguage
        };
    }

    // =========================================================================
    // CONVERSATIONAL AI WITH MEMORY
    // =========================================================================

    /// <summary>
    /// Start a new AI conversation.
    /// </summary>
    public async Task<AiConversation> StartConversation(
        int userId,
        string? title = null,
        string? context = null,
        CancellationToken ct = default)
    {
        var conversation = new AiConversation
        {
            UserId = userId,
            Title = title,
            Context = context,
            CreatedAt = DateTime.UtcNow,
            IsActive = true
        };

        _db.AiConversations.Add(conversation);
        await _db.SaveChangesAsync(ct);

        return conversation;
    }

    /// <summary>
    /// Send a message in an existing conversation and get AI response.
    /// </summary>
    public async Task<ConversationResponse> SendMessage(
        int conversationId,
        string userMessage,
        CancellationToken ct = default,
        int? userId = null)
    {
        var query = _db.AiConversations
            .Include(c => c.Messages.OrderBy(m => m.CreatedAt).Take(20)); // Last 20 messages for context

        var conversation = userId.HasValue
            ? await query.FirstOrDefaultAsync(c => c.Id == conversationId && c.IsActive && c.UserId == userId.Value, ct)
            : await query.FirstOrDefaultAsync(c => c.Id == conversationId && c.IsActive, ct);

        if (conversation == null)
            throw new InvalidOperationException("Conversation not found or inactive");

        // Add user message
        var userMsg = new AiMessage
        {
            ConversationId = conversationId,
            Role = "user",
            Content = userMessage,
            CreatedAt = DateTime.UtcNow
        };
        _db.AiMessages.Add(userMsg);

        // Build messages array with history
        var messages = new List<OllamaChatMessage>
        {
            new("system", BuildSystemPrompt(conversation.Context))
        };

        // Add conversation history
        foreach (var msg in conversation.Messages)
        {
            messages.Add(new OllamaChatMessage(msg.Role, msg.Content));
        }

        // Add current user message
        messages.Add(new OllamaChatMessage("user", userMessage));

        // Get AI response
        var request = new OllamaChatRequest(_options.Model, messages, false);
        var response = await _llamaClient.ChatAsync(request, ct);

        // Save AI response
        var aiMsg = new AiMessage
        {
            ConversationId = conversationId,
            Role = "assistant",
            Content = response.Message.Content,
            TokensUsed = response.EvalCount,
            CreatedAt = DateTime.UtcNow
        };
        _db.AiMessages.Add(aiMsg);

        // Update conversation metadata
        conversation.LastMessageAt = DateTime.UtcNow;
        conversation.TotalTokensUsed += response.EvalCount;

        // Auto-generate title if not set (first message)
        if (string.IsNullOrEmpty(conversation.Title) && conversation.Messages.Count == 0)
        {
            conversation.Title = await GenerateConversationTitle(userMessage, response.Message.Content, ct);
        }

        await _db.SaveChangesAsync(ct);

        return new ConversationResponse
        {
            ConversationId = conversationId,
            Response = response.Message.Content,
            TokensUsed = response.EvalCount,
            Title = conversation.Title
        };
    }

    /// <summary>
    /// Get conversation history.
    /// </summary>
    public async Task<List<ConversationMessage>> GetConversationHistory(
        int conversationId,
        int limit = 50,
        CancellationToken ct = default,
        int? userId = null)
    {
        // If userId provided, verify conversation ownership
        if (userId.HasValue)
        {
            var ownsConversation = await _db.AiConversations
                .AnyAsync(c => c.Id == conversationId && c.UserId == userId.Value, ct);
            if (!ownsConversation)
                return new List<ConversationMessage>();
        }

        var messages = await _db.AiMessages
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.CreatedAt)
            .Take(limit)
            .Select(m => new ConversationMessage
            {
                Id = m.Id,
                Role = m.Role,
                Content = m.Content,
                CreatedAt = m.CreatedAt
            })
            .ToListAsync(ct);

        messages.Reverse(); // Return in chronological order
        return messages;
    }

    /// <summary>
    /// List user's conversations.
    /// </summary>
    public async Task<List<ConversationSummary>> ListConversations(
        int userId,
        int limit = 20,
        CancellationToken ct = default)
    {
        return await _db.AiConversations
            .Where(c => c.UserId == userId && c.IsActive)
            .OrderByDescending(c => c.LastMessageAt ?? c.CreatedAt)
            .Take(limit)
            .Select(c => new ConversationSummary
            {
                Id = c.Id,
                Title = c.Title ?? "New Conversation",
                Context = c.Context,
                MessageCount = c.Messages.Count,
                TotalTokensUsed = c.TotalTokensUsed,
                CreatedAt = c.CreatedAt,
                LastMessageAt = c.LastMessageAt
            })
            .ToListAsync(ct);
    }

    /// <summary>
    /// Archive (soft delete) a conversation.
    /// </summary>
    public async Task<bool> ArchiveConversation(int conversationId, int userId, CancellationToken ct = default)
    {
        var conversation = await _db.AiConversations
            .FirstOrDefaultAsync(c => c.Id == conversationId && c.UserId == userId, ct);

        if (conversation == null)
            return false;

        conversation.IsActive = false;
        await _db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Generate a title for the conversation based on the first exchange.
    /// </summary>
    private async Task<string> GenerateConversationTitle(string userMessage, string aiResponse, CancellationToken ct)
    {
        try
        {
            var prompt = $@"Generate a very short title (3-6 words) for this conversation:
User: {userMessage.Substring(0, Math.Min(100, userMessage.Length))}
Assistant: {aiResponse.Substring(0, Math.Min(100, aiResponse.Length))}

Just respond with the title, nothing else.";

            var response = await CallAiAsync(prompt, ct);
            var trimmed = response.Trim().Trim('"');
            return trimmed[..Math.Min(100, trimmed.Length)];
        }
        catch
        {
            return "New Conversation";
        }
    }

    private static string BuildSystemPrompt(string? context)
    {
        var basePrompt = "You are a helpful AI assistant for a timebanking community platform. " +
                        "Help users with questions about timebanking, community services, and platform features. " +
                        "Be friendly, concise, and helpful. Remember the conversation context.";

        if (!string.IsNullOrEmpty(context))
        {
            basePrompt += $"\n\nConversation context: {context}";
        }

        return basePrompt;
    }

    /// <summary>
    /// Helper method to call the AI with a prompt.
    /// Enforces MaxPromptLength to prevent excessive resource usage.
    /// </summary>
    private async Task<string> CallAiAsync(string prompt, CancellationToken ct)
    {
        // Enforce prompt length limit
        if (prompt.Length > _options.MaxPromptLength)
        {
            _logger.LogWarning("Prompt truncated from {OriginalLength} to {MaxLength} characters",
                prompt.Length, _options.MaxPromptLength);
            prompt = prompt[.._options.MaxPromptLength];
        }

        var messages = new List<OllamaChatMessage>
        {
            new("system", "You are a helpful AI assistant for a timebanking community platform. Always respond with valid JSON when asked for JSON. Be concise and accurate."),
            new("user", prompt)
        };

        var request = new OllamaChatRequest(_options.Model, messages, false);
        var response = await _llamaClient.ChatAsync(request, ct);

        return response.Message?.Content
            ?? throw new InvalidOperationException("AI returned empty response");
    }

    /// <summary>
    /// Sanitizes user input for inclusion in AI prompts.
    /// Wraps content in clear delimiters to reduce prompt injection risk.
    /// </summary>
    private static string SanitizeForPrompt(string userInput, int maxLength = 500)
    {
        if (string.IsNullOrEmpty(userInput))
            return string.Empty;

        // Truncate to max length
        if (userInput.Length > maxLength)
            userInput = userInput[..maxLength];

        // Wrap in delimiters to separate user content from system instructions
        return $"```\n{userInput}\n```";
    }

    // =========================================================================
    // SMART REPLY SUGGESTIONS
    // =========================================================================

    /// <summary>
    /// Generate smart reply suggestions for a message conversation.
    /// </summary>
    public async Task<SmartReplySuggestions> GenerateSmartReplies(
        string lastMessage,
        string? conversationContext = null,
        int suggestionCount = 3,
        CancellationToken ct = default)
    {
        var contextPart = string.IsNullOrEmpty(conversationContext)
            ? ""
            : $"\nConversation context: {conversationContext}";

        var prompt = $@"You are helping a timebanking community member respond to a message.
{contextPart}
Last message received: ""{lastMessage}""

Generate {suggestionCount} short, friendly reply suggestions. Each should be 1-2 sentences.
Consider these scenarios: accepting an offer, asking for details, declining politely, scheduling.

Respond with JSON only:
{{
  ""suggestions"": [
    {{""text"": ""reply text"", ""tone"": ""friendly/professional/casual"", ""intent"": ""accept/inquire/decline/schedule""}}
  ]
}}";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var result = System.Text.Json.JsonSerializer.Deserialize<SmartReplySuggestions>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return result ?? new SmartReplySuggestions();
        }
        catch
        {
            return new SmartReplySuggestions
            {
                Suggestions = new List<ReplySuggestion>
                {
                    new() { Text = "Thanks for reaching out! I'd love to help.", Tone = "friendly", Intent = "accept" },
                    new() { Text = "Could you tell me more about what you need?", Tone = "friendly", Intent = "inquire" },
                    new() { Text = "When would work best for you?", Tone = "friendly", Intent = "schedule" }
                }
            };
        }
    }

    // =========================================================================
    // LISTING DESCRIPTION GENERATOR
    // =========================================================================

    /// <summary>
    /// Generate a complete listing from minimal input.
    /// </summary>
    public async Task<GeneratedListing> GenerateListingFromKeywords(
        string keywords,
        ListingType type,
        CancellationToken ct = default)
    {
        var typeStr = type == ListingType.Offer ? "offering a service" : "looking for help";

        var prompt = $@"Create a timebanking listing for someone {typeStr}.

Keywords/idea: ""{keywords}""

Generate a compelling listing. Respond with JSON only:
{{
  ""title"": ""catchy title (max 60 chars)"",
  ""description"": ""detailed description (2-4 sentences explaining the service, what's included, and any requirements)"",
  ""suggestedTags"": [""tag1"", ""tag2"", ""tag3""],
  ""estimatedHours"": 1.5,
  ""category"": ""suggested category name""
}}";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var result = System.Text.Json.JsonSerializer.Deserialize<GeneratedListing>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return result ?? new GeneratedListing { Title = keywords, Description = "" };
        }
        catch
        {
            return new GeneratedListing
            {
                Title = keywords,
                Description = $"I am {typeStr} related to: {keywords}",
                SuggestedTags = new List<string>(),
                EstimatedHours = 1.0m
            };
        }
    }

    // =========================================================================
    // MESSAGE SENTIMENT ANALYSIS
    // =========================================================================

    /// <summary>
    /// Analyze the sentiment and tone of a message.
    /// </summary>
    public async Task<SentimentAnalysis> AnalyzeSentiment(
        string text,
        CancellationToken ct = default)
    {
        var prompt = $@"Analyze the sentiment and tone of this message from a timebanking community platform.

Message: ""{text}""

Respond with JSON only:
{{
  ""sentiment"": ""positive/negative/neutral"",
  ""confidence"": 0.85,
  ""tone"": ""friendly/professional/frustrated/excited/concerned"",
  ""emotions"": [""gratitude"", ""enthusiasm""],
  ""isUrgent"": false,
  ""summary"": ""brief one-line summary of the message intent""
}}";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var result = System.Text.Json.JsonSerializer.Deserialize<SentimentAnalysis>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return result ?? new SentimentAnalysis { Sentiment = "neutral" };
        }
        catch
        {
            return new SentimentAnalysis
            {
                Sentiment = "neutral",
                Confidence = 0.5,
                Tone = "unknown"
            };
        }
    }

    // =========================================================================
    // BIO GENERATOR
    // =========================================================================

    /// <summary>
    /// Generate a member bio based on their activity and interests.
    /// </summary>
    public async Task<GeneratedBio> GenerateBio(
        int userId,
        string? interests = null,
        string? tone = "friendly",
        CancellationToken ct = default)
    {
        var user = await _db.Users
            .Include(u => u.UserBadges)
                .ThenInclude(ub => ub.Badge)
            .FirstOrDefaultAsync(u => u.Id == userId, ct);

        if (user == null)
            return new GeneratedBio();

        var userListings = await _db.Listings
            .Where(l => l.UserId == userId && l.Status == ListingStatus.Active)
            .Select(l => new { l.Title, l.Type })
            .Take(5)
            .ToListAsync(ct);

        var badges = user.UserBadges.Select(ub => ub.Badge?.Name ?? "").Where(n => !string.IsNullOrEmpty(n)).ToList();
        var offers = userListings.Where(l => l.Type == ListingType.Offer).Select(l => l.Title).ToList();
        var requests = userListings.Where(l => l.Type == ListingType.Request).Select(l => l.Title).ToList();

        var prompt = $@"Generate a friendly bio for a timebanking community member.

Member info:
- Name: {user.FirstName}
- Level: {user.Level}
- XP: {user.TotalXp}
- Badges earned: {string.Join(", ", badges)}
- Services they offer: {string.Join(", ", offers)}
- Help they're seeking: {string.Join(", ", requests)}
- Additional interests: {interests ?? "not specified"}
- Desired tone: {tone}

Generate 3 bio options of different lengths. Respond with JSON only:
{{
  ""short"": ""1-2 sentence bio"",
  ""medium"": ""3-4 sentence bio"",
  ""long"": ""5-6 sentence detailed bio"",
  ""tagline"": ""catchy one-liner for profile headline""
}}";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var result = System.Text.Json.JsonSerializer.Deserialize<GeneratedBio>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return result ?? new GeneratedBio();
        }
        catch
        {
            return new GeneratedBio
            {
                Short = $"Hi, I'm {user.FirstName}! I love helping my community.",
                Medium = $"Hi, I'm {user.FirstName}! I'm a Level {user.Level} member who loves connecting with neighbors and sharing skills.",
                Long = $"Hi, I'm {user.FirstName}! As a Level {user.Level} community member, I believe in the power of mutual aid. I enjoy {(offers.Any() ? $"offering {offers.First()}" : "helping others")} and am always looking to learn new things.",
                Tagline = "Neighbor helping neighbor!"
            };
        }
    }

    // =========================================================================
    // PERSONALIZED CHALLENGES
    // =========================================================================

    /// <summary>
    /// Generate personalized challenges/quests for a user.
    /// </summary>
    public async Task<PersonalizedChallenges> GenerateChallenges(
        int userId,
        int count = 3,
        CancellationToken ct = default)
    {
        var user = await _db.Users
            .Include(u => u.UserBadges)
            .FirstOrDefaultAsync(u => u.Id == userId, ct);

        if (user == null)
            return new PersonalizedChallenges();

        // Get user's recent activity
        var recentListings = await _db.Listings
            .Where(l => l.UserId == userId)
            .CountAsync(ct);

        var recentTransactions = await _db.Transactions
            .ExcludeInternalWalletAdapters()
            .Where(t => t.SenderId == userId || t.ReceiverId == userId)
            .Where(t => t.CreatedAt > DateTime.UtcNow.AddDays(-30))
            .CountAsync(ct);

        var connections = await _db.Connections
            .Where(c => (c.RequesterId == userId || c.AddresseeId == userId) && c.Status == "accepted")
            .CountAsync(ct);

        var earnedBadges = user.UserBadges.Count;

        var prompt = $@"Generate {count} personalized challenges for a timebanking community member.

Member stats:
- Level: {user.Level}
- Total XP: {user.TotalXp}
- Listings created: {recentListings}
- Exchanges in last 30 days: {recentTransactions}
- Connections: {connections}
- Badges earned: {earnedBadges}

Create achievable challenges that encourage engagement. Mix easy, medium, and stretch goals.

Respond with JSON only:
{{
  ""challenges"": [
    {{
      ""title"": ""Challenge title"",
      ""description"": ""What they need to do"",
      ""xpReward"": 50,
      ""difficulty"": ""easy/medium/hard"",
      ""category"": ""social/listings/exchanges/profile"",
      ""target"": 3,
      ""unit"": ""connections/listings/exchanges/etc""
    }}
  ],
  ""motivationalMessage"": ""Encouraging message for the user""
}}";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var result = System.Text.Json.JsonSerializer.Deserialize<PersonalizedChallenges>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return result ?? GenerateDefaultChallenges(user.Level);
        }
        catch
        {
            return GenerateDefaultChallenges(user.Level);
        }
    }

    private static PersonalizedChallenges GenerateDefaultChallenges(int level)
    {
        return new PersonalizedChallenges
        {
            Challenges = new List<AiChallengeSuggestion>
            {
                new() { Title = "Make a Connection", Description = "Connect with a new community member", XpReward = 25, Difficulty = "easy", Category = "social", Target = 1, Unit = "connection" },
                new() { Title = "Share Your Skills", Description = "Create a new listing offering your help", XpReward = 50, Difficulty = "medium", Category = "listings", Target = 1, Unit = "listing" },
                new() { Title = "Community Helper", Description = "Complete an exchange with another member", XpReward = 100, Difficulty = "hard", Category = "exchanges", Target = 1, Unit = "exchange" }
            },
            MotivationalMessage = $"You're doing great at Level {level}! Keep contributing to make our community stronger."
        };
    }

    // =========================================================================
    // CONVERSATION SUMMARIZER
    // =========================================================================

    /// <summary>
    /// Summarize a conversation thread.
    /// </summary>
    public async Task<ConversationSummaryResult> SummarizeConversation(
        List<string> messages,
        CancellationToken ct = default)
    {
        if (!messages.Any())
            return new ConversationSummaryResult { Summary = "No messages to summarize." };

        var messagesText = string.Join("\n", messages.Take(20).Select((m, i) => $"{i + 1}. {m}"));

        var prompt = $@"Summarize this conversation between timebanking community members.

Messages:
{messagesText}

Respond with JSON only:
{{
  ""summary"": ""2-3 sentence summary of the conversation"",
  ""topic"": ""main topic discussed"",
  ""status"": ""ongoing/resolved/needs_response"",
  ""keyPoints"": [""key point 1"", ""key point 2""],
  ""nextSteps"": ""suggested next action if any""
}}";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var result = System.Text.Json.JsonSerializer.Deserialize<ConversationSummaryResult>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return result ?? new ConversationSummaryResult { Summary = "Unable to summarize." };
        }
        catch
        {
            return new ConversationSummaryResult { Summary = "Unable to summarize conversation." };
        }
    }

    // =========================================================================
    // SKILL RECOMMENDATIONS
    // =========================================================================

    /// <summary>
    /// Get personalized skill/service recommendations for a user.
    /// </summary>
    public async Task<SkillRecommendations> GetSkillRecommendations(
        int userId,
        CancellationToken ct = default)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user == null)
            return new SkillRecommendations();

        // Get user's current offerings
        var userOffers = await _db.Listings
            .Where(l => l.UserId == userId && l.Type == ListingType.Offer && l.Status == ListingStatus.Active)
            .Select(l => l.Title)
            .ToListAsync(ct);

        // Get community demand (what people are requesting)
        var requestTitles = await _db.Listings
            .Where(l => l.Type == ListingType.Request && l.Status == ListingStatus.Active)
            .Select(l => l.Title)
            .ToListAsync(ct);

        var communityRequests = requestTitles
            .GroupBy(t => t.ToLower().Substring(0, Math.Min(30, t.Length)))
            .OrderByDescending(g => g.Count())
            .Take(10)
            .Select(g => g.Key)
            .ToList();

        var prompt = $@"Recommend skills/services for a timebanking community member.

Their current offerings: {string.Join(", ", userOffers)}
Community is looking for: {string.Join(", ", communityRequests)}

Suggest skills they could develop or offer based on:
1. Related to their existing skills
2. High demand in community
3. Easy to learn/offer

Respond with JSON only:
{{
  ""recommendations"": [
    {{
      ""skill"": ""skill name"",
      ""reason"": ""why this would be good for them"",
      ""demandLevel"": ""high/medium/low"",
      ""relatedToExisting"": true,
      ""learningTip"": ""how to get started""
    }}
  ],
  ""communityNeeds"": [""top need 1"", ""top need 2""]
}}";

        var response = await CallAiAsync(prompt, ct);

        try
        {
            var result = System.Text.Json.JsonSerializer.Deserialize<SkillRecommendations>(
                response,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return result ?? new SkillRecommendations();
        }
        catch
        {
            return new SkillRecommendations();
        }
    }
}

// ============================================================================
// DTOs for AI Service
// ============================================================================

public class ListingSuggestions
{
    public string ImprovedTitle { get; set; } = "";
    public string ImprovedDescription { get; set; } = "";
    public List<string> SuggestedTags { get; set; } = new();
    public decimal EstimatedHours { get; set; }
    public List<string> Tips { get; set; } = new();
}

public class MatchedUser
{
    public int UserId { get; set; }
    public string Name { get; set; } = "";
    public int Level { get; set; }
    public double MatchScore { get; set; }
    public string MatchReason { get; set; } = "";
}

public class AiMatch
{
    public int UserId { get; set; }
    public double Score { get; set; }
    public string Reason { get; set; } = "";
}

public class SearchResult
{
    public int ListingId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string Type { get; set; } = "";
    public string UserName { get; set; } = "";
    public double Relevance { get; set; }
    public string MatchReason { get; set; } = "";
}

public class AiSearchResult
{
    public int ListingId { get; set; }
    public double Relevance { get; set; }
    public string Reason { get; set; } = "";
}

public class ModerationResult
{
    public bool IsApproved { get; set; }
    public List<string> FlaggedIssues { get; set; } = new();
    public string Severity { get; set; } = "none";
    public List<string> Suggestions { get; set; } = new();
}

public class ProfileSuggestions
{
    public List<string> SuggestedSkills { get; set; } = new();
    public string BioSuggestion { get; set; } = "";
    public string NextBadgeGoal { get; set; } = "";
    public List<string> Tips { get; set; } = new();
}

public class CommunityInsights
{
    public string Summary { get; set; } = "";
    public List<string> TrendingServices { get; set; } = new();
    public List<string> SkillGaps { get; set; } = new();
    public List<string> Recommendations { get; set; } = new();
    public int HealthScore { get; set; }
    public int TotalActiveUsers { get; set; }
    public int TotalActiveListings { get; set; }
}

public class TranslationResult
{
    public string OriginalText { get; set; } = "";
    public string TranslatedText { get; set; } = "";
    public string TargetLanguage { get; set; } = "";
}

// Conversation DTOs
public class ConversationResponse
{
    public int ConversationId { get; set; }
    public string Response { get; set; } = "";
    public int TokensUsed { get; set; }
    public string? Title { get; set; }
}

public class ConversationMessage
{
    public int Id { get; set; }
    public string Role { get; set; } = "";
    public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public class ConversationSummary
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Context { get; set; }
    public int MessageCount { get; set; }
    public int TotalTokensUsed { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastMessageAt { get; set; }
}

// Smart Reply DTOs
public class SmartReplySuggestions
{
    public List<ReplySuggestion> Suggestions { get; set; } = new();
}

public class ReplySuggestion
{
    public string Text { get; set; } = "";
    public string Tone { get; set; } = "friendly";
    public string Intent { get; set; } = "general";
}

// Generated Listing DTO
public class GeneratedListing
{
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public List<string> SuggestedTags { get; set; } = new();
    public decimal EstimatedHours { get; set; }
    public string? Category { get; set; }
}

// Sentiment Analysis DTO
public class SentimentAnalysis
{
    public string Sentiment { get; set; } = "neutral";
    public double Confidence { get; set; }
    public string Tone { get; set; } = "";
    public List<string> Emotions { get; set; } = new();
    public bool IsUrgent { get; set; }
    public string? Summary { get; set; }
}

// Generated Bio DTO
public class GeneratedBio
{
    public string Short { get; set; } = "";
    public string Medium { get; set; } = "";
    public string Long { get; set; } = "";
    public string Tagline { get; set; } = "";
    public string Bio => Medium; // Default
}

// Personalized Challenges DTOs
public class PersonalizedChallenges
{
    public List<AiChallengeSuggestion> Challenges { get; set; } = new();
    public string MotivationalMessage { get; set; } = "";
}

public class AiChallengeSuggestion
{
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public int XpReward { get; set; }
    public string Difficulty { get; set; } = "medium";
    public string Category { get; set; } = "general";
    public int Target { get; set; } = 1;
    public string Unit { get; set; } = "";
}

// Conversation Summary Result DTO
public class ConversationSummaryResult
{
    public string Summary { get; set; } = "";
    public string? Topic { get; set; }
    public string Status { get; set; } = "ongoing";
    public List<string> KeyPoints { get; set; } = new();
    public string? NextSteps { get; set; }
}

// Skill Recommendations DTOs
public class SkillRecommendations
{
    public List<SkillRecommendation> Recommendations { get; set; } = new();
    public List<string> CommunityNeeds { get; set; } = new();
}

public class SkillRecommendation
{
    public string Skill { get; set; } = "";
    public string Reason { get; set; } = "";
    public string DemandLevel { get; set; } = "medium";
    public bool RelatedToExisting { get; set; }
    public string? LearningTip { get; set; }
}
