// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Buffers.Text;
using Fido2NetLib;
using Fido2NetLib.Objects;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Support;

namespace Nexus.Api.Services;

/// <summary>
/// Handles WebAuthn/passkey registration and authentication using fido2-net-lib.
/// Manages challenge generation, credential storage, and assertion verification.
/// </summary>
public class PasskeyService
{
    private readonly IFido2 _fido2;
    private readonly NexusDbContext _db;
    private readonly ILogger<PasskeyService> _logger;
    private readonly AuthenticationConfigurationService _authenticationConfiguration;

    public PasskeyService(
        IFido2 fido2,
        NexusDbContext db,
        ILogger<PasskeyService> logger,
        AuthenticationConfigurationService authenticationConfiguration)
    {
        _fido2 = fido2;
        _db = db;
        _logger = logger;
        _authenticationConfiguration = authenticationConfiguration;
    }

    /// <summary>
    /// Begin passkey registration for an authenticated user.
    /// Returns options that the browser passes to navigator.credentials.create().
    /// </summary>
    public async Task<CredentialCreateOptions> BeginRegistrationAsync(User user)
    {
        if (!await IsBiometricLoginEnabledAsync(user.TenantId))
            throw new InvalidOperationException("Passkey authentication is disabled for this community");
        if (!await _authenticationConfiguration.GetBooleanAsync(
                AuthenticationConfigurationService.PasskeysEnrollmentEnabled,
                user.TenantId))
        {
            throw new InvalidOperationException("Passkey enrollment is disabled for this community");
        }

        if (!await IsEligibleUserAsync(user.Id, user.TenantId))
        {
            throw new InvalidOperationException("User account is not eligible for passkey registration");
        }

        // Enforce passkey count limit
        var existingCount = await _db.UserPasskeys
            .IgnoreQueryFilters()
            .CountAsync(p => p.UserId == user.Id && p.TenantId == user.TenantId);

        var maxPasskeysPerUser = await _authenticationConfiguration.GetIntegerAsync(
            AuthenticationConfigurationService.PasskeysMaxCredentials,
            user.TenantId);
        if (existingCount >= maxPasskeysPerUser)
        {
            throw new InvalidOperationException(
                $"Maximum of {maxPasskeysPerUser} passkeys per user reached. Remove an existing passkey first.");
        }

        // Build the Fido2User from our domain user
        var fido2User = new Fido2User
        {
            Id = GetOrCreateUserHandle(user),
            Name = user.Email,
            DisplayName = $"{user.FirstName} {user.LastName}"
        };

        // Get existing credentials to exclude (prevent re-registration)
        var existingCredentials = await _db.UserPasskeys
            .IgnoreQueryFilters()
            .Where(p => p.UserId == user.Id && p.TenantId == user.TenantId)
            .Select(p => new PublicKeyCredentialDescriptor(p.CredentialId))
            .ToListAsync();

        // Create registration options
        var options = _fido2.RequestNewCredential(
            new RequestNewCredentialParams
            {
                User = fido2User,
                ExcludeCredentials = existingCredentials,
                AuthenticatorSelection = new AuthenticatorSelection
                {
                    ResidentKey = ResidentKeyRequirement.Required,
                    UserVerification = UserVerificationRequirement.Required,
                },
                AttestationPreference = AttestationConveyancePreference.None,
                Extensions = new AuthenticationExtensionsClientInputs
                {
                    CredProps = true
                }
            }
        );

        return options;
    }

    /// <summary>
    /// Complete passkey registration by verifying the authenticator response.
    /// Stores the credential in the database.
    /// </summary>
    public async Task<UserPasskey> FinishRegistrationAsync(
        CredentialCreateOptions options,
        AuthenticatorAttestationRawResponse attestationResponse,
        User user,
        string? displayName,
        DateTime? registrationStartedAt = null)
    {
        var expectedCutoff = user.AuthenticationInvalidatedAt;
        await using var transaction = await _db.Database.BeginTransactionAsync();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM users WHERE \"Id\" = {user.Id} AND \"TenantId\" = {user.TenantId} FOR UPDATE");
        await _db.Entry(user).ReloadAsync();
        if (user.AuthenticationInvalidatedAt != expectedCutoff
            || user.AuthenticationInvalidatedAt is { } cutoff
                && (registrationStartedAt is null || registrationStartedAt <= cutoff))
            throw new InvalidOperationException("Registration challenge expired after account security changed");
        if (!await IsBiometricLoginEnabledAsync(user.TenantId)
            || !await _authenticationConfiguration.GetBooleanAsync(
                AuthenticationConfigurationService.PasskeysEnrollmentEnabled, user.TenantId))
            throw new InvalidOperationException("Passkey enrollment is disabled for this community");
        var count = await _db.UserPasskeys.IgnoreQueryFilters()
            .CountAsync(p => p.UserId == user.Id && p.TenantId == user.TenantId);
        var maximum = await _authenticationConfiguration.GetIntegerAsync(
            AuthenticationConfigurationService.PasskeysMaxCredentials, user.TenantId);
        if (count >= maximum) throw new InvalidOperationException("Maximum passkey count reached");
        // Re-check the account after the challenge ceremony. An administrator
        // may have suspended the user or tenant while the browser prompt was
        // open, and a stale challenge must not create a credential afterwards.
        if (!await IsEligibleUserAsync(user.Id, user.TenantId))
        {
            throw new InvalidOperationException("User account is not eligible for passkey registration");
        }

        // Reject in-flight ceremonies created under an older, weaker policy.
        options.AuthenticatorSelection.UserVerification = UserVerificationRequirement.Required;

        // Verify the attestation response
        var credential = await _fido2.MakeNewCredentialAsync(
            new MakeNewCredentialParams
            {
                AttestationResponse = attestationResponse,
                OriginalOptions = options,
                IsCredentialIdUniqueToUserCallback = async (args, ct) =>
                {
                    var existing = await _db.UserPasskeys
                        .IgnoreQueryFilters()
                        .AnyAsync(p => p.CredentialId == args.CredentialId, ct);
                    return !existing;
                }
            }
        );

        // Infer discoverability: if we requested resident key and the authenticator
        // didn't explicitly reject it, treat the credential as discoverable.
        // fido2-net-lib v4 doesn't expose credProps from the response, so we infer
        // from the original request's ResidentKey setting.
        var isDiscoverable = options.AuthenticatorSelection?.ResidentKey is
            ResidentKeyRequirement.Required or ResidentKeyRequirement.Preferred;

        // Extract transports if available
        string? transports = null;
        if (attestationResponse.Response.Transports != null && attestationResponse.Response.Transports.Length > 0)
        {
            transports = string.Join(",", attestationResponse.Response.Transports.Select(t => t.ToString().ToLowerInvariant()));
        }

        // Store the credential
        var passkey = new UserPasskey
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            CredentialId = credential.Id,
            PublicKey = credential.PublicKey,
            UserHandle = credential.User.Id,
            SignCount = credential.SignCount,
            CredType = credential.Type.ToString(),
            AaGuid = credential.AaGuid,
            DisplayName = displayName,
            Transports = transports,
            IsDiscoverable = isDiscoverable,
            CreatedAt = DateTime.UtcNow
        };

        _db.UserPasskeys.Add(passkey);
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        _logger.LogInformation(
            "Passkey registered for user {UserId} in tenant {TenantId} (credId={CredIdPrefix}...)",
            user.Id, user.TenantId, Convert.ToBase64String(passkey.CredentialId)[..8]);

        return passkey;
    }

    /// <summary>
    /// Begin passkey authentication. Can be called with or without knowing the user.
    /// For conditional UI / autofill, call without specifying allowed credentials.
    /// </summary>
    public async Task<AssertionOptions> BeginAuthenticationAsync(int? tenantId, string? email)
    {
        if (tenantId is > 0 && !await IsBiometricLoginEnabledAsync(tenantId.Value))
            throw new InvalidOperationException("Passkey authentication is disabled for this community");
        List<PublicKeyCredentialDescriptor>? allowedCredentials = null;

        if (tenantId.HasValue && !string.IsNullOrEmpty(email))
        {
            var tenantIsActive = await _db.Tenants
                .AsNoTracking()
                .AnyAsync(tenant => tenant.Id == tenantId.Value && tenant.IsActive);

            if (tenantIsActive)
            {
                var normalizedEmail = email.Trim().ToLowerInvariant();

                // User-specific challenges expose only credentials belonging to
                // an account that is currently allowed to authenticate.
                var userPasskeys = await _db.UserPasskeys
                    .IgnoreQueryFilters()
                    .Where(passkey =>
                        passkey.TenantId == tenantId.Value
                        && passkey.User != null
                        && passkey.User.TenantId == tenantId.Value
                        && passkey.User.Email.ToLower() == normalizedEmail
                        && passkey.User.IsActive
                        && passkey.User.SuspendedAt == null
                        && passkey.User.RegistrationStatus == RegistrationStatus.Active)
                    .ToListAsync();

                allowedCredentials = userPasskeys
                    .Select(passkey => new PublicKeyCredentialDescriptor(passkey.CredentialId))
                    .ToList();
            }
        }

        var options = _fido2.GetAssertionOptions(
            new GetAssertionOptionsParams
            {
                AllowedCredentials = allowedCredentials ?? new List<PublicKeyCredentialDescriptor>(),
                UserVerification = UserVerificationRequirement.Required,
            }
        );

        return options;
    }

    /// <summary>
    /// Complete passkey authentication by verifying the assertion.
    /// Returns the authenticated user if successful.
    /// </summary>
    public async Task<User> FinishAuthenticationAsync(
        AssertionOptions options,
        AuthenticatorAssertionRawResponse assertionResponse,
        int? expectedTenantId = null,
        DateTime? authenticationStartedAt = null)
    {
        // Look up the stored credential by credential ID
        // In fido2-net-lib v4, assertionResponse.Id is base64url-encoded
        var credentialId = Base64UrlEncoder.DecodeBytes(assertionResponse.Id);
        await using var transaction = _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync() : null;
        var owner = await _db.UserPasskeys.IgnoreQueryFilters().AsNoTracking()
            .Where(p => p.CredentialId == credentialId && (!expectedTenantId.HasValue || p.TenantId == expectedTenantId.Value))
            .Select(p => new { p.UserId, p.TenantId }).FirstOrDefaultAsync();
        if (owner is null) throw new InvalidOperationException("Unknown credential");
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM users WHERE \"Id\" = {owner.UserId} AND \"TenantId\" = {owner.TenantId} FOR UPDATE");
        var passkeyQuery = _db.UserPasskeys
            .IgnoreQueryFilters()
            .Include(p => p.User)
            .AsQueryable();

        if (expectedTenantId.HasValue)
        {
            passkeyQuery = passkeyQuery.Where(passkey => passkey.TenantId == expectedTenantId.Value);
        }

        var passkey = await passkeyQuery
            .FirstOrDefaultAsync(stored => stored.CredentialId == credentialId);

        if (passkey == null)
        {
            throw new InvalidOperationException("Unknown credential");
        }

        if (passkey.User is not null)
            await _db.Entry(passkey.User).ReloadAsync();
        if (passkey.User?.AuthenticationInvalidatedAt is { } cutoff
            && (authenticationStartedAt is null || authenticationStartedAt <= cutoff))
            throw new InvalidOperationException("Authentication challenge expired after account security changed");

        var tenantIsActive = await _db.Tenants
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == passkey.TenantId && tenant.IsActive);
        if (!tenantIsActive
            || !await IsBiometricLoginEnabledAsync(passkey.TenantId)
            || passkey.User == null
            || passkey.User.TenantId != passkey.TenantId
            || !passkey.User.IsActive
            || passkey.User.SuspendedAt != null
            || passkey.User.RegistrationStatus != RegistrationStatus.Active)
        {
            throw new InvalidOperationException("Passkey authentication is unavailable for this account");
        }

        // Every token from this path claims local user verification, including
        // ceremonies started before the policy was tightened.
        options.UserVerification = UserVerificationRequirement.Required;

        // Verify the assertion
        var result = await _fido2.MakeAssertionAsync(
            new MakeAssertionParams
            {
                AssertionResponse = assertionResponse,
                OriginalOptions = options,
                StoredPublicKey = passkey.PublicKey,
                StoredSignatureCounter = passkey.SignCount,
                IsUserHandleOwnerOfCredentialIdCallback = async (args, ct) =>
                {
                    var owned = await _db.UserPasskeys
                        .IgnoreQueryFilters()
                        .AnyAsync(p =>
                            p.TenantId == passkey.TenantId
                            && p.UserId == passkey.UserId
                            && p.UserHandle == args.UserHandle
                            && p.CredentialId == args.CredentialId,
                            ct);
                    return owned;
                }
            }
        );

        // Update sign count for replay protection
        passkey.SignCount = result.SignCount;
        passkey.LastUsedAt = DateTime.UtcNow;
        passkey.User.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();

        _logger.LogInformation(
            "Passkey authentication successful for user {UserId} in tenant {TenantId}",
            passkey.UserId, passkey.TenantId);

        return passkey.User;
    }

    /// <summary>
    /// Get all passkeys for a user (for management UI).
    /// </summary>
    public async Task<List<UserPasskey>> GetUserPasskeysAsync(int userId, int tenantId)
    {
        return await _db.UserPasskeys
            .IgnoreQueryFilters()
            .Where(p => p.UserId == userId && p.TenantId == tenantId)
            .OrderByDescending(p => p.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Delete a passkey (user must own it).
    /// </summary>
    public async Task<(bool Success, string? Error)> DeletePasskeyAsync(int passkeyId, int userId, int tenantId, DateTime? expectedInvalidatedAt = null)
    {
        var count = await RemovePasskeysAsync(userId, tenantId, p => p.Id == passkeyId, expectedInvalidatedAt, true);
        return count > 0 ? (true, null) : (false, "Passkey not found");
    }

    /// <summary>
    /// Rename a passkey.
    /// </summary>
    public async Task<(bool Success, string? Error)> RenamePasskeyAsync(int passkeyId, int userId, int tenantId, string displayName)
    {
        var passkey = await _db.UserPasskeys
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == passkeyId && p.UserId == userId && p.TenantId == tenantId);

        if (passkey == null) return (false, "Passkey not found");

        passkey.DisplayName = displayName;
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>
    /// Delete a canonical WebAuthn credential by its opaque browser credential
    /// ID. The user and tenant predicates are intentionally part of the lookup.
    /// </summary>
    public async Task<bool> DeleteCredentialAsync(
        string credentialId,
        int userId,
        int tenantId,
        DateTime? expectedInvalidatedAt = null)
    {
        if (!TryDecodeCredentialId(credentialId, out var decodedCredentialId))
        {
            return false;
        }

        return await RemovePasskeysAsync(userId, tenantId,
            p => p.CredentialId.SequenceEqual(decodedCredentialId), expectedInvalidatedAt, true) > 0;
    }

    /// <summary>
    /// Rename a canonical WebAuthn credential owned by the current user in the
    /// current tenant.
    /// </summary>
    public async Task<bool> RenameCredentialAsync(
        string credentialId,
        int userId,
        int tenantId,
        string displayName)
    {
        if (!TryDecodeCredentialId(credentialId, out var decodedCredentialId))
        {
            return false;
        }

        var passkey = await _db.UserPasskeys
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(candidate =>
                candidate.CredentialId == decodedCredentialId
                && candidate.UserId == userId
                && candidate.TenantId == tenantId);
        if (passkey is null)
        {
            return false;
        }

        passkey.DisplayName = displayName;
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>
    /// Remove every credential owned by one user in one tenant.
    /// </summary>
    public Task<int> RemoveAllUserPasskeysAsync(int userId, int tenantId, DateTime? expectedInvalidatedAt = null)
        => RemovePasskeysAsync(userId, tenantId, _ => true, expectedInvalidatedAt, true);

    private async Task<int> RemovePasskeysAsync(int userId, int tenantId,
        Func<UserPasskey, bool> select, DateTime? expectedInvalidatedAt = null, bool checkEpoch = false)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync();
        // Serialize all passkey removals for a member, including the numeric-ID
        // compatibility endpoint. Reload after locking: the controller may have
        // already loaded this user before another request revoked its proof.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM users WHERE \"Id\" = {userId} AND \"TenantId\" = {tenantId} FOR UPDATE");
        var user = await _db.Users.IgnoreQueryFilters()
            .SingleAsync(u => u.Id == userId && u.TenantId == tenantId);
        await _db.Entry(user).ReloadAsync();
        if (checkEpoch && user.AuthenticationInvalidatedAt != expectedInvalidatedAt)
            throw new InvalidOperationException("Security confirmation expired. Confirm your identity again.");

        var passkeys = await _db.UserPasskeys
            .IgnoreQueryFilters()
            .Where(passkey => passkey.UserId == userId && passkey.TenantId == tenantId)
            .ToListAsync();

        var selected = passkeys.Where(select).ToList();
        if (selected.Count == 0) return 0;
        if (selected.Count == passkeys.Count && string.IsNullOrWhiteSpace(user.PasswordHash))
            throw new InvalidOperationException(
                "Cannot delete your only sign-in method. Add a password or another passkey first.");

        _db.UserPasskeys.RemoveRange(selected);
        var now = DateTime.UtcNow;
        user.AuthenticationInvalidatedAt = now;
        await _db.RefreshTokens.IgnoreQueryFilters()
            .Where(t => t.UserId == userId && t.TenantId == tenantId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now)
                .SetProperty(t => t.RevokedReason, "passkey_removed"));
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        return selected.Count;
    }

    /// <summary>
    /// Get or create a stable user handle for WebAuthn.
    /// The user handle is a random opaque identifier (not the DB user ID)
    /// that's consistent across all of a user's credentials.
    /// </summary>
    private byte[] GetOrCreateUserHandle(User user)
    {
        // If user already has passkeys, reuse the same user handle
        var existingHandle = _db.UserPasskeys
            .IgnoreQueryFilters()
            .Where(p => p.UserId == user.Id && p.TenantId == user.TenantId)
            .Select(p => p.UserHandle)
            .FirstOrDefault();

        if (existingHandle != null && existingHandle.Length > 0)
        {
            return existingHandle;
        }

        // Generate a new random user handle (64 bytes)
        var handle = new byte[64];
        System.Security.Cryptography.RandomNumberGenerator.Fill(handle);
        return handle;
    }

    private async Task<bool> IsBiometricLoginEnabledAsync(int tenantId)
    {
        var keys = TenantFeatureKeys.BothKeys("biometric_login");
        var flags = await _db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.TenantId == tenantId && keys.Contains(c.Key))
            .ToDictionaryAsync(c => c.Key, c => c.Value);
        return TenantFeatureKeys.Read(flags, "biometric_login", true);
    }

    private async Task<bool> IsEligibleUserAsync(int userId, int tenantId)
    {
        var tenantIsActive = await _db.Tenants
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == tenantId && tenant.IsActive);
        if (!tenantIsActive)
        {
            return false;
        }

        return await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(user =>
                user.Id == userId
                && user.TenantId == tenantId
                && user.IsActive
                && user.SuspendedAt == null
                && user.RegistrationStatus == RegistrationStatus.Active);
    }

    private static bool TryDecodeCredentialId(string? credentialId, out byte[] decoded)
    {
        decoded = Array.Empty<byte>();
        if (string.IsNullOrWhiteSpace(credentialId))
        {
            return false;
        }

        try
        {
            decoded = Base64UrlEncoder.DecodeBytes(credentialId.Trim());
            return decoded.Length > 0;
        }
        catch (Exception exception) when (exception is FormatException or ArgumentException)
        {
            return false;
        }
    }
}
