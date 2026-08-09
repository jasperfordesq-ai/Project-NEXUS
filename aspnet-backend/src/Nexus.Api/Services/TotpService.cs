// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using OtpNet;

namespace Nexus.Api.Services;

/// <summary>
/// Service for TOTP-based two-factor authentication.
/// Secrets are encrypted at rest using AES-256-GCM via a key derived from the JWT secret.
/// </summary>
public class TotpService
{
    private readonly NexusDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<TotpService> _logger;

    private const int TotpStep = 30; // 30-second window
    private const int TotpDigits = 6;
    private const int BackupCodeLength = 8; // 8-digit numeric codes
    private readonly AuthenticationConfigurationService _authenticationConfiguration;

    public TotpService(
        NexusDbContext db,
        IConfiguration config,
        ILogger<TotpService> logger,
        AuthenticationConfigurationService authenticationConfiguration)
    {
        _db = db;
        _config = config;
        _logger = logger;
        _authenticationConfiguration = authenticationConfiguration;
    }

    /// <summary>
    /// Generate a new TOTP secret for setup. Returns the secret and provisioning URI.
    /// Does NOT enable 2FA yet — call VerifyAndEnable after user confirms with a code.
    /// </summary>
    public async Task<(string Secret, string QrUri, string? Error)> GenerateSetupAsync(int userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return (string.Empty, string.Empty, "User not found");

        if (user.TwoFactorEnabled)
            return (string.Empty, string.Empty, "Two-factor authentication is already enabled");

        // Generate a new 20-byte secret
        var secretBytes = KeyGeneration.GenerateRandomKey(20);
        var base32Secret = Base32Encoding.ToString(secretBytes);

        // Store encrypted (not yet enabled)
        user.TotpSecretEncrypted = EncryptSecret(base32Secret);
        user.TwoFactorEnabled = false;
        await _db.SaveChangesAsync();

        // Build otpauth:// URI for QR code
        var issuer = Uri.EscapeDataString("Project NEXUS");
        var account = Uri.EscapeDataString(user.Email);
        var qrUri = $"otpauth://totp/{issuer}:{account}?secret={base32Secret}&issuer={issuer}&digits={TotpDigits}&period={TotpStep}";

        _logger.LogInformation("TOTP setup initiated for user {UserId}", userId);

        return (base32Secret, qrUri, null);
    }

    /// <summary>
    /// Verify a TOTP code and enable 2FA if valid. Returns backup codes.
    /// </summary>
    public async Task<(bool Success, List<string>? BackupCodes, string? Error)> VerifyAndEnableAsync(int userId, int tenantId, string code)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return (false, null, "User not found");

        if (user.TwoFactorEnabled)
            return (false, null, "Two-factor authentication is already enabled");

        if (string.IsNullOrEmpty(user.TotpSecretEncrypted))
            return (false, null, "No TOTP secret found. Call setup first.");

        var secret = DecryptSecret(user.TotpSecretEncrypted);
        if (secret == null)
            return (false, null, "Failed to decrypt TOTP secret");

        if (!ValidateCode(secret, code))
            return (false, null, "Invalid verification code");

        user.TwoFactorEnabled = true;
        user.TwoFactorEnabledAt = DateTime.UtcNow;

        // Generate and persist the enabled state plus backup codes in the
        // same SaveChanges call. A failure cannot leave 2FA enabled without
        // recovery codes.
        var (backupCodes, backupError) = await GenerateBackupCodesAsync(userId, tenantId);
        if (backupCodes is null)
        {
            user.TwoFactorEnabled = false;
            user.TwoFactorEnabledAt = null;
            return (false, null, backupError ?? "Failed to generate backup codes");
        }

        _logger.LogInformation("TOTP 2FA enabled for user {UserId}", userId);
        return (true, backupCodes, null);
    }

    /// <summary>
    /// Validate a TOTP code for login. Allows ±1 time step for clock drift.
    /// </summary>
    public async Task<(bool Valid, string? Error)> ValidateLoginCodeAsync(int userId, string code)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return (false, "User not found");

        if (!user.TwoFactorEnabled || string.IsNullOrEmpty(user.TotpSecretEncrypted))
            return (false, "Two-factor authentication is not enabled");

        var secret = DecryptSecret(user.TotpSecretEncrypted);
        if (secret == null)
            return (false, "Failed to decrypt TOTP secret");

        if (!ValidateCode(secret, code))
            return (false, "Invalid verification code");

        return (true, null);
    }

    /// <summary>
    /// Disable 2FA for a user.
    /// </summary>
    public async Task<(bool Success, string? Error)> DisableAsync(int userId, string code)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return (false, "User not found");

        if (!user.TwoFactorEnabled)
            return (false, "Two-factor authentication is not enabled");

        // Require a valid code to disable
        if (!string.IsNullOrEmpty(user.TotpSecretEncrypted))
        {
            var secret = DecryptSecret(user.TotpSecretEncrypted);
            if (secret == null || !ValidateCode(secret, code))
                return (false, "Invalid verification code");
        }

        return await DisableForUserAsync(user);
    }

    /// <summary>
    /// Laravel-compatible settings flow: disabling 2FA requires the account
    /// password, not a current TOTP code.
    /// </summary>
    public async Task<(bool Success, string? Error)> DisableWithPasswordAsync(int userId, string password)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return (false, "User not found");

        if (!user.TwoFactorEnabled)
            return (false, "Two-factor authentication is not enabled");

        if (string.IsNullOrWhiteSpace(password)
            || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
        {
            return (false, "Invalid password");
        }

        return await DisableForUserAsync(user);
    }

    private async Task<(bool Success, string? Error)> DisableForUserAsync(User user)
    {
        user.TwoFactorEnabled = false;
        user.TotpSecretEncrypted = null;
        user.TwoFactorEnabledAt = null;

        // Remove backup codes (include tenant check to prevent cross-tenant deletion)
        var backupCodes = await _db.TotpBackupCodes
            .IgnoreQueryFilters()
            .Where(c => c.UserId == user.Id && c.TenantId == user.TenantId)
            .ToListAsync();
        _db.TotpBackupCodes.RemoveRange(backupCodes);

        await _db.SaveChangesAsync();

        _logger.LogInformation("TOTP 2FA disabled for user {UserId}", user.Id);
        return (true, null);
    }

    /// <summary>
    /// Check if a user has 2FA enabled.
    /// </summary>
    public async Task<bool> IsTwoFactorEnabledAsync(int userId)
    {
        return await _db.Users.AnyAsync(u => u.Id == userId && u.TwoFactorEnabled);
    }

    private static bool ValidateCode(string base32Secret, string code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length != TotpDigits)
            return false;

        var secretBytes = Base32Encoding.ToBytes(base32Secret);
        var totp = new Totp(secretBytes, step: TotpStep, totpSize: TotpDigits);

        // VerificationWindow of 1 allows ±1 step (±30s) for clock drift
        return totp.VerifyTotp(code, out _, new VerificationWindow(previous: 1, future: 1));
    }

    #region Backup Codes

    /// <summary>
    /// Generate backup codes for a user. Replaces any existing codes.
    /// Returns the plaintext codes (only shown once).
    /// </summary>
    public async Task<(List<string>? Codes, string? Error)> GenerateBackupCodesAsync(int userId, int tenantId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return (null, "User not found");

        if (!user.TwoFactorEnabled)
            return (null, "Two-factor authentication must be enabled first");

        // Remove existing backup codes
        var existing = await _db.TotpBackupCodes
            .IgnoreQueryFilters()
            .Where(c => c.UserId == userId && c.TenantId == tenantId)
            .ToListAsync();
        _db.TotpBackupCodes.RemoveRange(existing);

        var backupCodeCount = await _authenticationConfiguration.GetIntegerAsync(
            AuthenticationConfigurationService.TwoFactorBackupCodeCount,
            tenantId);

        // Generate new codes
        var plaintextCodes = new List<string>();
        for (int i = 0; i < backupCodeCount; i++)
        {
            var code = GenerateNumericCode(BackupCodeLength);
            plaintextCodes.Add(code);

            _db.TotpBackupCodes.Add(new TotpBackupCode
            {
                UserId = userId,
                TenantId = tenantId,
                CodeHash = BCrypt.Net.BCrypt.HashPassword(code),
                IsUsed = false,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();
        _logger.LogInformation("Generated {Count} backup codes for user {UserId}", backupCodeCount, userId);

        return (plaintextCodes, null);
    }

    /// <summary>
    /// Validate a backup code for login. Each code can only be used once.
    /// </summary>
    public async Task<(bool Valid, string? Error)> ValidateBackupCodeAsync(int userId, int tenantId, string code)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return (false, "User not found");

        if (!user.TwoFactorEnabled)
            return (false, "Two-factor authentication is not enabled");

        var unusedCodes = await _db.TotpBackupCodes
            .IgnoreQueryFilters()
            .Where(c => c.UserId == userId && c.TenantId == tenantId && !c.IsUsed)
            .ToListAsync();

        var normalizedInput = code.Replace("-", "").Replace(" ", "").Trim();

        foreach (var backupCode in unusedCodes)
        {
            if (BCrypt.Net.BCrypt.Verify(normalizedInput, backupCode.CodeHash))
            {
                backupCode.IsUsed = true;
                backupCode.UsedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();

                _logger.LogInformation("Backup code used for user {UserId}, {Remaining} remaining",
                    userId, unusedCodes.Count - 1);
                return (true, null);
            }
        }

        return (false, "Invalid backup code");
    }

    /// <summary>
    /// Get count of remaining (unused) backup codes.
    /// </summary>
    public async Task<int> GetRemainingBackupCodeCountAsync(int userId, int tenantId)
    {
        return await _db.TotpBackupCodes
            .IgnoreQueryFilters()
            .CountAsync(c => c.UserId == userId && c.TenantId == tenantId && !c.IsUsed);
    }

    private static string GenerateNumericCode(int length)
    {
        var bytes = new byte[4];
        var code = new char[length];
        for (int i = 0; i < length; i++)
        {
            RandomNumberGenerator.Fill(bytes);
            code[i] = (char)('0' + (BitConverter.ToUInt32(bytes) % 10));
        }
        return new string(code);
    }

    #endregion

    #region Secret Encryption (AES-256-GCM)

    private string EncryptSecret(string plaintext)
    {
        var key = DeriveEncryptionKey();
        var nonce = new byte[12]; // 96-bit nonce for AES-GCM
        RandomNumberGenerator.Fill(nonce);

        var plaintextBytes = System.Text.Encoding.UTF8.GetBytes(plaintext);
        var ciphertext = new byte[plaintextBytes.Length];
        var tag = new byte[16]; // 128-bit auth tag

        using var aes = new AesGcm(key, 16);
        aes.Encrypt(nonce, plaintextBytes, ciphertext, tag);

        // Format: nonce(12) + tag(16) + ciphertext
        var result = new byte[nonce.Length + tag.Length + ciphertext.Length];
        Buffer.BlockCopy(nonce, 0, result, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, result, nonce.Length, tag.Length);
        Buffer.BlockCopy(ciphertext, 0, result, nonce.Length + tag.Length, ciphertext.Length);

        return Convert.ToBase64String(result);
    }

    private string? DecryptSecret(string encrypted)
    {
        try
        {
            var key = DeriveEncryptionKey();
            var data = Convert.FromBase64String(encrypted);

            if (data.Length < 28) // 12 nonce + 16 tag minimum
                return null;

            var nonce = data[..12];
            var tag = data[12..28];
            var ciphertext = data[28..];
            var plaintext = new byte[ciphertext.Length];

            using var aes = new AesGcm(key, 16);
            aes.Decrypt(nonce, ciphertext, tag, plaintext);

            return System.Text.Encoding.UTF8.GetString(plaintext);
        }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or ArgumentException or FormatException)
        {
            _logger.LogError(ex, "Failed to decrypt TOTP secret");
            return null;
        }
    }

    private byte[] DeriveEncryptionKey()
    {
        var jwtSecret = _config["Jwt:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");

        // Derive a 256-bit key from the JWT secret using HKDF
        var ikm = System.Text.Encoding.UTF8.GetBytes(jwtSecret);
        var info = System.Text.Encoding.UTF8.GetBytes("nexus-totp-encryption");
        return HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 32, info: info);
    }

    #endregion
}
