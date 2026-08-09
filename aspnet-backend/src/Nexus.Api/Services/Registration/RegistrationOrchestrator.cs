// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Contracts.Events;
using Nexus.Messaging;

namespace Nexus.Api.Services.Registration;

/// <summary>
/// Orchestrates the registration flow based on tenant policy.
/// Drives the user through the correct state machine path depending on
/// the tenant's RegistrationMode, VerificationProvider, and PostVerificationAction.
/// </summary>
public class RegistrationOrchestrator
{
    private readonly NexusDbContext _db;
    private readonly IdentityVerificationProviderFactory _providerFactory;
    private readonly ProviderConfigEncryption _encryption;
    private readonly IEventPublisher _eventPublisher;
    private readonly EmailNotificationService _emailNotification;
    private readonly IConfiguration _config;
    private readonly ILogger<RegistrationOrchestrator> _logger;

    // Valid state transitions for the registration state machine
    private static readonly Dictionary<RegistrationStatus, HashSet<RegistrationStatus>> ValidTransitions = new()
    {
        [RegistrationStatus.PendingRegistration] = new() { RegistrationStatus.PendingVerification, RegistrationStatus.PendingAdminReview, RegistrationStatus.Active, RegistrationStatus.Rejected },
        [RegistrationStatus.PendingVerification] = new() { RegistrationStatus.Active, RegistrationStatus.PendingAdminReview, RegistrationStatus.VerificationFailed, RegistrationStatus.LimitedAccess, RegistrationStatus.Rejected },
        [RegistrationStatus.PendingAdminReview] = new() { RegistrationStatus.Active, RegistrationStatus.Rejected },
        [RegistrationStatus.VerificationFailed] = new() { RegistrationStatus.PendingVerification, RegistrationStatus.Rejected },
        [RegistrationStatus.LimitedAccess] = new() { RegistrationStatus.Active, RegistrationStatus.Rejected },
        [RegistrationStatus.Active] = new() { }, // Terminal (suspension is a different mechanism)
        [RegistrationStatus.Rejected] = new() { }, // Terminal
    };

    public RegistrationOrchestrator(
        NexusDbContext db,
        IdentityVerificationProviderFactory providerFactory,
        ProviderConfigEncryption encryption,
        IEventPublisher eventPublisher,
        EmailNotificationService emailNotification,
        IConfiguration config,
        ILogger<RegistrationOrchestrator> logger)
    {
        _db = db;
        _providerFactory = providerFactory;
        _encryption = encryption;
        _eventPublisher = eventPublisher;
        _emailNotification = emailNotification;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Validates whether a state transition is allowed.
    /// </summary>
    public static bool IsValidTransition(RegistrationStatus from, RegistrationStatus to)
    {
        return ValidTransitions.TryGetValue(from, out var allowed) && allowed.Contains(to);
    }

    /// <summary>
    /// Gets the active registration policy for a tenant.
    /// Returns the default (Standard) policy if none is configured.
    /// </summary>
    public async Task<TenantRegistrationPolicy> GetPolicyAsync(int tenantId)
    {
        var policy = await _db.TenantRegistrationPolicies
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.IsActive);

        return policy ?? new TenantRegistrationPolicy
        {
            TenantId = tenantId,
            Mode = RegistrationMode.Standard,
            Provider = VerificationProvider.None,
            VerificationLevel = VerificationLevel.None,
            PostVerificationAction = PostVerificationAction.ActivateAutomatically
        };
    }

    /// <summary>
    /// Registers a user according to the tenant's policy.
    /// Returns the created user and their initial registration status.
    /// </summary>
    public async Task<RegistrationResult> RegisterAsync(
        int tenantId,
        string email,
        string passwordHash,
        string firstName,
        string lastName,
        string? inviteCode,
        string? clientIp)
    {
        var policy = await GetPolicyAsync(tenantId);

        // Validate invite code for InviteOnly mode
        if (policy.Mode == RegistrationMode.InviteOnly)
        {
            if (string.IsNullOrEmpty(inviteCode) || inviteCode != policy.InviteCode)
            {
                return RegistrationResult.Fail("Invalid or missing invite code.");
            }

            if (policy.MaxInviteUses.HasValue && policy.InviteUsesCount >= policy.MaxInviteUses.Value)
            {
                return RegistrationResult.Fail("Invite code has reached its maximum usage limit.");
            }
        }

        // Determine initial status based on policy
        var (initialStatus, isActive) = policy.Mode switch
        {
            RegistrationMode.Standard => (RegistrationStatus.Active, true),
            RegistrationMode.StandardWithApproval => (RegistrationStatus.PendingAdminReview, false),
            RegistrationMode.VerifiedIdentity => (RegistrationStatus.PendingVerification, false),
            RegistrationMode.GovernmentId => (RegistrationStatus.PendingVerification, false),
            RegistrationMode.InviteOnly => (RegistrationStatus.Active, true),
            _ => (RegistrationStatus.Active, true)
        };

        var user = new User
        {
            TenantId = tenantId,
            Email = email,
            PasswordHash = passwordHash,
            FirstName = firstName,
            LastName = lastName,
            Role = "member",
            IsActive = isActive,
            IsApproved = initialStatus == RegistrationStatus.Active,
            RegistrationStatus = initialStatus,
            CreatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);

        // Increment invite counter
        if (policy.Mode == RegistrationMode.InviteOnly && policy.Id > 0)
        {
            policy.InviteUsesCount++;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "User {UserId} registered in tenant {TenantId} with status {Status} (mode={Mode})",
            user.Id, tenantId, initialStatus, policy.Mode);

        // Publish event
        await _eventPublisher.PublishAsync(new UserCreatedEvent
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            Email = user.Email,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Role = user.Role,
            IsActive = user.IsActive
        });

        // Send registration status email
        if (initialStatus == RegistrationStatus.PendingAdminReview)
            await SendStatusChangeEmailAsync(user, "pending_approval");
        else if (initialStatus == RegistrationStatus.PendingVerification)
            await SendStatusChangeEmailAsync(user, "pending_verification");

        return RegistrationResult.Success(user, initialStatus, policy.RegistrationMessage);
    }

    /// <summary>
    /// Starts an identity verification session for a user.
    /// Only valid when user is in PendingVerification status.
    /// </summary>
    public async Task<VerificationStartResult> StartVerificationAsync(int userId, int tenantId)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);

        if (user == null)
            return VerificationStartResult.Fail("User not found.");

        if (user.RegistrationStatus != RegistrationStatus.PendingVerification)
            return VerificationStartResult.Fail($"User is not in PendingVerification status (current: {user.RegistrationStatus}).");

        var policy = await GetPolicyAsync(tenantId);

        if (policy.Provider == VerificationProvider.None)
            return VerificationStartResult.Fail("No verification provider configured for this tenant.");

        if (!_providerFactory.IsProviderRegistered(policy.Provider))
            return VerificationStartResult.Fail($"Provider '{policy.Provider}' is not available.");

        var provider = _providerFactory.GetProvider(policy.Provider);
        var callbackUrl = BuildWebhookCallbackUrl(tenantId);

        var decryptedConfig = await ResolveProviderConfigAsync(policy, tenantId);

        var sessionResult = await provider.CreateSessionAsync(
            userId, tenantId, policy.VerificationLevel, callbackUrl, decryptedConfig);

        var session = new IdentityVerificationSession
        {
            TenantId = tenantId,
            UserId = userId,
            Provider = policy.Provider,
            Level = policy.VerificationLevel,
            Status = VerificationSessionStatus.Created,
            ExternalSessionId = sessionResult.ExternalSessionId,
            RedirectUrl = sessionResult.RedirectUrl,
            ExpiresAt = sessionResult.ExpiresAt,
            CreatedAt = DateTime.UtcNow
        };

        _db.IdentityVerificationSessions.Add(session);
        await _db.SaveChangesAsync();

        // Log event
        await LogVerificationEventAsync(session, "session.created", null, VerificationSessionStatus.Created);

        _logger.LogInformation(
            "Verification session {SessionId} created for user {UserId} with provider {Provider}",
            session.Id, userId, policy.Provider);

        return VerificationStartResult.Success(session, sessionResult);
    }

    /// <summary>
    /// Retries identity verification for a user whose previous attempt failed or expired.
    /// Transitions VerificationFailed -> PendingVerification and creates a new session.
    /// </summary>
    public async Task<VerificationStartResult> RetryVerificationAsync(int userId, int tenantId)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);

        if (user == null)
            return VerificationStartResult.Fail("User not found.");

        if (user.RegistrationStatus != RegistrationStatus.VerificationFailed)
            return VerificationStartResult.Fail($"User is not in VerificationFailed status (current: {user.RegistrationStatus}).");

        // Enforce retry limit (max 3 attempts)
        const int maxRetries = 3;
        var failedAttempts = await _db.IdentityVerificationSessions
            .IgnoreQueryFilters()
            .CountAsync(s => s.UserId == userId && s.TenantId == tenantId
                && (s.Status == VerificationSessionStatus.Failed
                    || s.Status == VerificationSessionStatus.Cancelled));

        if (failedAttempts >= maxRetries)
            return VerificationStartResult.Fail($"Maximum verification attempts ({maxRetries}) exceeded. Contact support.");

        if (!IsValidTransition(RegistrationStatus.VerificationFailed, RegistrationStatus.PendingVerification))
            return VerificationStartResult.Fail("State transition not allowed.");

        // Transition back to PendingVerification
        user.RegistrationStatus = RegistrationStatus.PendingVerification;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} retrying verification (VerificationFailed -> PendingVerification)", userId);

        // Start a new verification session
        return await StartVerificationAsync(userId, tenantId);
    }

    /// <summary>
    /// Gets the current verification session status for a user.
    /// </summary>
    public async Task<IdentityVerificationSession?> GetVerificationSessionAsync(int userId, int tenantId)
    {
        return await _db.IdentityVerificationSessions
            .IgnoreQueryFilters()
            .Where(s => s.UserId == userId && s.TenantId == tenantId)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Processes a webhook callback from a verification provider.
    /// </summary>
    public async Task<bool> ProcessWebhookAsync(
        int tenantId,
        VerificationProvider providerType,
        WebhookPayload payload)
    {
        var policy = await GetPolicyAsync(tenantId);

        if (!_providerFactory.IsProviderRegistered(providerType))
        {
            _logger.LogWarning("Webhook received for unregistered provider {Provider}", providerType);
            return false;
        }

        var provider = _providerFactory.GetProvider(providerType);

        var providerConfig = await ResolveProviderConfigAsync(policy, tenantId);

        // Verify signature
        if (!provider.VerifyWebhookSignature(payload, providerConfig))
        {
            _logger.LogWarning("Webhook signature verification failed for provider {Provider} in tenant {TenantId}",
                providerType, tenantId);
            return false;
        }

        var result = await provider.ProcessWebhookAsync(payload, providerConfig);
        if (result == null)
        {
            _logger.LogWarning("Provider {Provider} could not process webhook payload", providerType);
            return false;
        }

        // Match session by ExternalSessionId when provider returns it, otherwise fall back to latest active
        IdentityVerificationSession? session;
        if (!string.IsNullOrEmpty(result.ExternalSessionId))
        {
            session = await _db.IdentityVerificationSessions
                .IgnoreQueryFilters()
                .Include(s => s.User)
                .FirstOrDefaultAsync(s => s.TenantId == tenantId
                    && s.Provider == providerType
                    && s.ExternalSessionId == result.ExternalSessionId);
        }
        else
        {
            session = await _db.IdentityVerificationSessions
                .IgnoreQueryFilters()
                .Include(s => s.User)
                .Where(s => s.TenantId == tenantId
                         && s.Provider == providerType
                         && (s.Status == VerificationSessionStatus.Created
                             || s.Status == VerificationSessionStatus.InProgress))
                .OrderByDescending(s => s.CreatedAt)
                .FirstOrDefaultAsync();
        }

        if (session == null)
        {
            _logger.LogWarning("No active verification session found for webhook in tenant {TenantId}", tenantId);
            return false;
        }

        return await ApplyVerificationResultAsync(session, result, policy);
    }

    /// <summary>
    /// Admin approves a user registration (for StandardWithApproval or PostVerification approval).
    /// </summary>
    public async Task<bool> AdminApproveAsync(int userId, int tenantId, int adminUserId)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);

        if (user == null) return false;

        if (!IsValidTransition(user.RegistrationStatus, RegistrationStatus.Active))
        {
            _logger.LogWarning("Cannot approve user {UserId}: invalid transition from {Status} to Active",
                userId, user.RegistrationStatus);
            return false;
        }

        user.RegistrationStatus = RegistrationStatus.Active;
        user.IsActive = true;
        user.IsApproved = true;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} approved registration for user {UserId}", adminUserId, userId);

        await _eventPublisher.PublishAsync(new UserActivatedEvent
        {
            TenantId = tenantId,
            UserId = userId,
            ActivatedByUserId = adminUserId
        });

        await SendStatusChangeEmailAsync(user, "approved");

        return true;
    }

    /// <summary>
    /// Admin rejects a user registration.
    /// </summary>
    public async Task<bool> AdminRejectAsync(int userId, int tenantId, int adminUserId, string? reason)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);

        if (user == null) return false;

        if (!IsValidTransition(user.RegistrationStatus, RegistrationStatus.Rejected))
        {
            _logger.LogWarning("Cannot reject user {UserId}: invalid transition from {Status} to Rejected",
                userId, user.RegistrationStatus);
            return false;
        }

        user.RegistrationStatus = RegistrationStatus.Rejected;
        user.IsActive = false;
        user.IsApproved = false;
        user.SuspensionReason = reason;
        user.SuspendedByUserId = adminUserId;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} rejected registration for user {UserId}. Reason: {Reason}",
            adminUserId, userId, reason);

        await SendStatusChangeEmailAsync(user, "rejected", reason);

        return true;
    }

    #region Private Helpers

    private async Task<bool> ApplyVerificationResultAsync(
        IdentityVerificationSession session,
        VerificationStatusResult result,
        TenantRegistrationPolicy policy)
    {
        var previousStatus = session.Status;
        session.Status = result.Status;
        session.ProviderDecision = result.Decision;
        session.DecisionReason = result.DecisionReason;
        session.ConfidenceScore = result.ConfidenceScore;

        if (result.Status is VerificationSessionStatus.Completed or VerificationSessionStatus.Failed)
        {
            session.CompletedAt = DateTime.UtcNow;
        }

        await LogVerificationEventAsync(session, "webhook.processed", previousStatus, result.Status);

        // Update user status based on verification outcome
        if (session.User != null)
        {
            if (result.Status == VerificationSessionStatus.Completed && result.Decision == "approved")
            {
                switch (policy.PostVerificationAction)
                {
                    case PostVerificationAction.ActivateAutomatically:
                        session.User.RegistrationStatus = RegistrationStatus.Active;
                        session.User.IsActive = true;
                        session.User.IsApproved = true;
                        break;
                    case PostVerificationAction.SendToAdminForApproval:
                        session.User.RegistrationStatus = RegistrationStatus.PendingAdminReview;
                        session.User.IsApproved = false;
                        break;
                    case PostVerificationAction.GrantLimitedAccess:
                        session.User.RegistrationStatus = RegistrationStatus.LimitedAccess;
                        session.User.IsActive = true;
                        session.User.IsApproved = false;
                        break;
                    case PostVerificationAction.RejectOnFailure:
                        session.User.RegistrationStatus = RegistrationStatus.Active;
                        session.User.IsActive = true;
                        session.User.IsApproved = true;
                        break;
                }
            }
            else if (result.Status == VerificationSessionStatus.Failed)
            {
                if (policy.PostVerificationAction == PostVerificationAction.RejectOnFailure)
                {
                    session.User.RegistrationStatus = RegistrationStatus.Rejected;
                    session.User.IsActive = false;
                    session.User.IsApproved = false;
                }
                else
                {
                    session.User.RegistrationStatus = RegistrationStatus.VerificationFailed;
                }
            }
            else if (result.Status == VerificationSessionStatus.Cancelled)
            {
                // Cancelled sessions allow the user to retry verification
                session.User.RegistrationStatus = RegistrationStatus.VerificationFailed;
            }

            session.User.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Verification session {SessionId} updated: {PreviousStatus} -> {NewStatus}, decision={Decision}",
            session.Id, previousStatus, result.Status, result.Decision);

        // Send email notification about verification outcome
        if (session.User != null)
        {
            var emailStatus = result.Status == VerificationSessionStatus.Completed && result.Decision == "approved"
                ? "verification_approved"
                : result.Status is VerificationSessionStatus.Failed or VerificationSessionStatus.Cancelled
                    ? "verification_failed"
                    : null;

            if (emailStatus != null)
                await SendStatusChangeEmailAsync(session.User, emailStatus, result.DecisionReason);
        }

        return true;
    }

    private async Task LogVerificationEventAsync(
        IdentityVerificationSession session,
        string eventType,
        VerificationSessionStatus? previousStatus,
        VerificationSessionStatus? newStatus,
        string? metadata = null,
        int? actorUserId = null)
    {
        var evt = new IdentityVerificationEvent
        {
            TenantId = session.TenantId,
            SessionId = session.Id,
            EventType = eventType,
            PreviousStatus = previousStatus,
            NewStatus = newStatus,
            Metadata = metadata,
            ActorUserId = actorUserId,
            CreatedAt = DateTime.UtcNow
        };

        _db.IdentityVerificationEvents.Add(evt);
        await _db.SaveChangesAsync();
    }

    private async Task SendStatusChangeEmailAsync(User user, string status, string? reason = null)
    {
        try
        {
            var placeholders = new Dictionary<string, string>
            {
                ["user_name"] = user.FirstName ?? "User",
                ["email"] = user.Email,
                ["status"] = status
            };
            if (reason != null)
                placeholders["reason"] = reason;

            await _emailNotification.SendTemplatedEmailAsync(user.Id, $"registration_{status}", placeholders);
        }
        catch (Exception ex) // Broad catch intentional: email is fire-and-forget, must never break registration
        {
            _logger.LogWarning(ex, "Failed to send registration status email to user {UserId} for status {Status}",
                user.Id, status);
        }
    }

    private string BuildWebhookCallbackUrl(int tenantId)
    {
        var baseUrl = _config["App:BaseUrl"] ?? "http://localhost:5080";
        return $"{baseUrl}/api/registration/webhook/{tenantId}";
    }

    private async Task<string?> ResolveProviderConfigAsync(TenantRegistrationPolicy policy, int tenantId)
    {
        var providerSlug = ToProviderSlug(policy.Provider);
        if (!string.IsNullOrWhiteSpace(providerSlug))
        {
            var credentials = await _db.TenantProviderCredentials
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstOrDefaultAsync(c =>
                    c.TenantId == tenantId
                    && c.ProviderSlug == providerSlug
                    && c.IsActive);

            if (credentials != null)
                return _encryption.Decrypt(credentials.CredentialsEncrypted);
        }

        return !string.IsNullOrEmpty(policy.ProviderConfigEncrypted)
            ? _encryption.Decrypt(policy.ProviderConfigEncrypted)
            : null;
    }

    private static string? ToProviderSlug(VerificationProvider provider) => provider switch
    {
        VerificationProvider.None => null,
        VerificationProvider.Mock => "mock",
        VerificationProvider.StripeIdentity => "stripe_identity",
        VerificationProvider.UkCertified => "uk_certified",
        VerificationProvider.EudiWallet => "eudi_wallet",
        VerificationProvider.Idenfy => "idenfy",
        _ => provider.ToString().ToLowerInvariant()
    };

    #endregion
}

/// <summary>
/// Result of a registration attempt.
/// </summary>
public record RegistrationResult
{
    public bool IsSuccess { get; init; }
    public User? User { get; init; }
    public RegistrationStatus Status { get; init; }
    public string? Message { get; init; }
    public string? Error { get; init; }

    public static RegistrationResult Success(User user, RegistrationStatus status, string? message = null)
        => new() { IsSuccess = true, User = user, Status = status, Message = message };

    public static RegistrationResult Fail(string error)
        => new() { IsSuccess = false, Error = error };
}

/// <summary>
/// Result of starting a verification session.
/// </summary>
public record VerificationStartResult
{
    public bool IsSuccess { get; init; }
    public IdentityVerificationSession? Session { get; init; }
    public VerificationSessionResult? ProviderResult { get; init; }
    public string? Error { get; init; }

    public static VerificationStartResult Success(IdentityVerificationSession session, VerificationSessionResult providerResult)
        => new() { IsSuccess = true, Session = session, ProviderResult = providerResult };

    public static VerificationStartResult Fail(string error)
        => new() { IsSuccess = false, Error = error };
}
