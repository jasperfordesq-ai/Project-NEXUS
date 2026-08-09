// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for email verification flow. Generates tokens, sends verification emails,
/// and marks user emails as verified.
/// </summary>
public class EmailVerificationService
{
    private readonly NexusDbContext _db;
    private readonly IEmailService _emailService;
    private readonly ILogger<EmailVerificationService> _logger;
    private readonly IConfiguration _configuration;

    private const int TokenExpirationHours = 24;
    private const int ResendCooldownMinutes = 2;

    public EmailVerificationService(NexusDbContext db, IEmailService emailService,
        ILogger<EmailVerificationService> logger, IConfiguration configuration)
    {
        _db = db;
        _emailService = emailService;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>
    /// Send a verification email to the user. Generates token and emails it.
    /// </summary>
    public async Task<(bool Success, string? Error)> SendVerificationEmailAsync(int userId, string email)
    {
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId);
        if (user == null) return (false, "User not found");
        if (user.EmailVerified) return (false, "Email is already verified");

        // Check cooldown
        var recentToken = await _db.Set<EmailVerificationToken>()
            .Where(t => t.UserId == userId && !t.IsUsed)
            .OrderByDescending(t => t.CreatedAt)
            .FirstOrDefaultAsync();
        if (recentToken != null && recentToken.CreatedAt > DateTime.UtcNow.AddMinutes(-ResendCooldownMinutes))
            return (false, "Please wait before requesting another verification email");

        // Invalidate old tokens
        var oldTokens = await _db.Set<EmailVerificationToken>()
            .Where(t => t.UserId == userId && !t.IsUsed).ToListAsync();
        foreach (var old in oldTokens) old.IsUsed = true;

        // Generate new token
        var token = GenerateToken();
        var verificationToken = new EmailVerificationToken
        {
            TenantId = user.TenantId, UserId = userId, Email = email,
            Token = token, ExpiresAt = DateTime.UtcNow.AddHours(TokenExpirationHours),
            CreatedAt = DateTime.UtcNow
        };
        _db.Set<EmailVerificationToken>().Add(verificationToken);
        await _db.SaveChangesAsync();

        // Build verification URL and send email
        var baseUrl = _configuration["App:FrontendUrl"] ?? "http://localhost:5173";
        var verifyUrl = $"{baseUrl}/verify-email?token={token}";
        var subject = "Verify your email address";
        var htmlBody = $"<h2>Email Verification</h2><p>Hi {user.FirstName},</p>"
            + $"<p>Please click the link below to verify your email address:</p>"
            + $"<p><a href=\"{verifyUrl}\">Verify Email</a></p>"
            + $"<p>This link expires in {TokenExpirationHours} hours.</p>"
            + "<p>If you did not request this, please ignore this email.</p>";

        var sent = await _emailService.SendEmailAsync(email, subject, htmlBody);
        if (!sent)
        {
            _logger.LogWarning("Failed to send verification email to {Email}", email);
            return (false, "Failed to send verification email");
        }

        _logger.LogInformation("Verification email sent to {Email} for user {UserId}", email, userId);
        return (true, null);
    }

    /// <summary>
    /// Verify an email token and mark the user as verified.
    /// </summary>
    public async Task<(bool Success, string? Error)> VerifyEmailAsync(string token)
    {
        if (string.IsNullOrWhiteSpace(token))
            return (false, "Token is required");
        var verificationToken = await _db.Set<EmailVerificationToken>()
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.Token == token);
        if (verificationToken == null) return (false, "Invalid verification token");
        if (verificationToken.IsUsed) return (false, "Token has already been used");
        if (verificationToken.ExpiresAt < DateTime.UtcNow) return (false, "Token has expired");
        verificationToken.IsUsed = true;
        if (verificationToken.User != null)
        {
            verificationToken.User.EmailVerified = true;
            verificationToken.User.EmailVerifiedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        _logger.LogInformation("Email verified for user {UserId}", verificationToken.UserId);
        return (true, null);
    }

    /// <summary>
    /// Resend verification email to the user.
    /// </summary>
    public async Task<(bool Success, string? Error)> ResendVerificationAsync(int userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId);
        if (user == null) return (false, "User not found");
        if (user.EmailVerified) return (false, "Email is already verified");
        return await SendVerificationEmailAsync(userId, user.Email);
    }

    /// <summary>
    /// Check if user email is verified.
    /// </summary>
    public async Task<bool> IsEmailVerifiedAsync(int userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        return user?.EmailVerified ?? false;
    }

    private static string GenerateToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
            .Replace("+", "-").Replace("/", "_").Replace("=", "");
    }
}
