// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for GDPR compliance: data export, data deletion (right to be forgotten), and consent management.
/// </summary>
public class GdprService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<GdprService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;

    public GdprService(NexusDbContext db, TenantContext tenantContext, ILogger<GdprService> logger, IServiceScopeFactory scopeFactory)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    #region Data Export

    /// <summary>
    /// Create a new data export request. Limits to one pending request at a time.
    /// </summary>
    public async Task<DataExportRequest> RequestDataExportAsync(int userId, string format)
    {
        format = format.ToLowerInvariant();
        if (format != "json" && format != "csv")
        {
            throw new ArgumentException("Format must be 'json' or 'csv'.");
        }

        // Check for existing pending/processing request
        var existing = await _db.Set<DataExportRequest>()
            .FirstOrDefaultAsync(r => r.UserId == userId &&
                (r.Status == ExportStatus.Pending || r.Status == ExportStatus.Processing));

        if (existing != null)
        {
            throw new InvalidOperationException("You already have a pending export request.");
        }

        var request = new DataExportRequest
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId,
            Format = format,
            Status = ExportStatus.Pending,
            RequestedAt = DateTime.UtcNow
        };

        _db.Set<DataExportRequest>().Add(request);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Data export requested by user {UserId} in format {Format}", userId, format);

        // Process in background with its own DI scope.
        // The scoped NexusDbContext from the HTTP request will be disposed when the
        // request ends, so the background task must create its own scope.
        var requestId = request.Id;
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var bgGdpr = scope.ServiceProvider.GetRequiredService<GdprService>();
                await bgGdpr.ProcessDataExportAsync(requestId);
            }
            catch (DbUpdateException ex)
            {
                _logger.LogError(ex, "Failed to process data export {RequestId}", requestId);
            }
            catch (JsonException ex)
            {
                _logger.LogError(ex, "Failed to process data export {RequestId}", requestId);
            }
            catch (IOException ex)
            {
                _logger.LogError(ex, "Failed to process data export {RequestId}", requestId);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError(ex, "Failed to process data export {RequestId}", requestId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process data export {RequestId}", requestId);
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                    var req = await db.Set<DataExportRequest>().FindAsync(requestId);
                    if (req != null)
                    {
                        req.Status = ExportStatus.Failed;
                        req.ErrorMessage = ex.Message;
                        await db.SaveChangesAsync();
                    }
                }
                catch (Exception inner)
                {
                    _logger.LogError(inner, "Failed to update export request {RequestId} status to failed", requestId);
                }
            }
        });

        return request;
    }

    /// <summary>
    /// Gather all user data and generate the export file.
    /// </summary>
    public async Task ProcessDataExportAsync(int requestId)
    {
        var request = await _db.Set<DataExportRequest>()
            .FirstOrDefaultAsync(r => r.Id == requestId);

        if (request == null)
        {
            throw new InvalidOperationException("Export request not found.");
        }

        request.Status = ExportStatus.Processing;
        await _db.SaveChangesAsync();

        try
        {
            // Gather user data
            var userData = await GatherUserDataAsync(request.UserId);

            string content;
            if (request.Format == "json")
            {
                content = JsonSerializer.Serialize(userData, new JsonSerializerOptions
                {
                    WriteIndented = true,
                    PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
                });
            }
            else
            {
                content = ConvertToCsv(userData);
            }

            // In production, this would upload to secure storage and set FileUrl.
            // For now, store as a data URI placeholder indicating the size.
            var bytes = System.Text.Encoding.UTF8.GetBytes(content);
            request.FileSizeBytes = bytes.Length;
            request.FileUrl = $"/api/privacy/export/{request.Id}/download";
            request.Status = ExportStatus.Ready;
            request.CompletedAt = DateTime.UtcNow;
            request.ExpiresAt = DateTime.UtcNow.AddDays(7); // Expires in 7 days

            await _db.SaveChangesAsync();

            _logger.LogInformation("Data export {RequestId} completed for user {UserId}, size: {Size} bytes",
                requestId, request.UserId, request.FileSizeBytes);
        }
        catch (DbUpdateException ex)
        {
            request.Status = ExportStatus.Failed;
            request.ErrorMessage = ex.Message;
            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Data export {RequestId} failed for user {UserId}", requestId, request.UserId);
            throw;
        }
        catch (JsonException ex)
        {
            request.Status = ExportStatus.Failed;
            request.ErrorMessage = ex.Message;
            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Data export {RequestId} failed for user {UserId}", requestId, request.UserId);
            throw;
        }
        catch (IOException ex)
        {
            request.Status = ExportStatus.Failed;
            request.ErrorMessage = ex.Message;
            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Data export {RequestId} failed for user {UserId}", requestId, request.UserId);
            throw;
        }
        catch (InvalidOperationException ex)
        {
            request.Status = ExportStatus.Failed;
            request.ErrorMessage = ex.Message;
            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Data export {RequestId} failed for user {UserId}", requestId, request.UserId);
            throw;
        }
    }

    /// <summary>
    /// Get all export requests for a user.
    /// </summary>
    public async Task<List<DataExportRequest>> GetExportRequestsAsync(int userId)
    {
        return await _db.Set<DataExportRequest>()
            .Where(r => r.UserId == userId)
            .OrderByDescending(r => r.RequestedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Mark an export as downloaded.
    /// </summary>
    public async Task<DataExportRequest?> DownloadExportAsync(int requestId, int userId)
    {
        var request = await _db.Set<DataExportRequest>()
            .FirstOrDefaultAsync(r => r.Id == requestId && r.UserId == userId);

        if (request == null) return null;

        if (request.Status != ExportStatus.Ready)
        {
            throw new InvalidOperationException($"Export is not ready. Current status: {request.Status}");
        }

        if (request.ExpiresAt.HasValue && request.ExpiresAt.Value < DateTime.UtcNow)
        {
            request.Status = ExportStatus.Expired;
            await _db.SaveChangesAsync();
            throw new InvalidOperationException("Export has expired. Please request a new export.");
        }

        request.DownloadedAt = DateTime.UtcNow;
        request.Status = ExportStatus.Downloaded;
        await _db.SaveChangesAsync();

        return request;
    }

    private async Task<Dictionary<string, object>> GatherUserDataAsync(int userId)
    {
        var data = new Dictionary<string, object>();

        // Profile
        var user = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new
            {
                u.Id, u.Email, u.FirstName, u.LastName, u.Role,
                u.IsActive, u.CreatedAt, u.UpdatedAt, u.LastLoginAt,
                u.TotalXp, u.Level
            })
            .FirstOrDefaultAsync();

        if (user != null) data["profile"] = user;

        // Listings
        var listings = await _db.Listings
            .AsNoTracking()
            .Where(l => l.UserId == userId)
            .Select(l => new
            {
                l.Id, l.Title, l.Description, l.Type, l.Status,
                l.Location, l.EstimatedHours, l.CreatedAt
            })
            .ToListAsync();

        data["listings"] = listings;

        // Transactions
        var transactions = await _db.Transactions
            .AsNoTracking()
            .ExcludeInternalWalletAdapters()
            .Where(t => t.SenderId == userId || t.ReceiverId == userId)
            .Select(t => new
            {
                t.Id, t.SenderId, t.ReceiverId, t.Amount,
                t.Description, t.Status, t.CreatedAt
            })
            .ToListAsync();

        data["transactions"] = transactions;

        // Messages
        var messages = await _db.Messages
            .AsNoTracking()
            .Where(m => m.SenderId == userId)
            .Select(m => new
            {
                m.Id, m.ConversationId, m.Content, m.CreatedAt
            })
            .ToListAsync();

        data["messages_sent"] = messages;

        // Connections
        var connections = await _db.Connections
            .AsNoTracking()
            .Where(c => c.RequesterId == userId || c.AddresseeId == userId)
            .Select(c => new
            {
                c.Id, c.RequesterId, c.AddresseeId, c.Status, c.CreatedAt
            })
            .ToListAsync();

        data["connections"] = connections;

        // Reviews
        var reviews = await _db.Reviews
            .AsNoTracking()
            .Where(r => r.ReviewerId == userId || r.TargetUserId == userId)
            .Select(r => new
            {
                r.Id, r.ReviewerId, r.TargetUserId, r.Rating, r.Comment, r.CreatedAt
            })
            .ToListAsync();

        data["reviews"] = reviews;

        // Feed posts
        var posts = await _db.FeedPosts
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => new
            {
                p.Id, p.Content, p.CreatedAt
            })
            .ToListAsync();

        data["feed_posts"] = posts;

        // Consent records
        var consents = await _db.Set<ConsentRecord>()
            .AsNoTracking()
            .Where(c => c.UserId == userId)
            .Select(c => new
            {
                c.ConsentType, c.IsGranted, c.GrantedAt, c.RevokedAt
            })
            .ToListAsync();

        data["consents"] = consents;

        // Gamification
        var badges = await _db.UserBadges
            .AsNoTracking()
            .Where(ub => ub.UserId == userId)
            .Select(ub => new
            {
                badge_name = ub.Badge!.Name,
                ub.EarnedAt
            })
            .ToListAsync();

        data["badges"] = badges;

        var xpHistory = await _db.XpLogs
            .AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => new
            {
                x.Amount, x.Source, x.Description, x.CreatedAt
            })
            .ToListAsync();

        data["xp_history"] = xpHistory;

        data["exported_at"] = DateTime.UtcNow;

        return data;
    }

    private static string ConvertToCsv(Dictionary<string, object> data)
    {
        var lines = new List<string> { "section,data" };

        foreach (var (key, value) in data)
        {
            var json = JsonSerializer.Serialize(value, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
            });
            // Escape CSV: wrap in quotes, escape internal quotes
            lines.Add($"\"{key}\",\"{json.Replace("\"", "\"\"")}\"");
        }

        return string.Join(Environment.NewLine, lines);
    }

    #endregion

    #region Data Deletion

    /// <summary>
    /// Request account deletion (right to be forgotten).
    /// </summary>
    public async Task<DataDeletionRequest> RequestDataDeletionAsync(int userId, string? reason)
    {
        // Check for existing pending request
        var existing = await _db.Set<DataDeletionRequest>()
            .FirstOrDefaultAsync(r => r.UserId == userId &&
                (r.Status == DeletionStatus.Pending || r.Status == DeletionStatus.Approved || r.Status == DeletionStatus.Processing));

        if (existing != null)
        {
            throw new InvalidOperationException("You already have a pending deletion request.");
        }

        var request = new DataDeletionRequest
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId,
            Reason = reason,
            Status = DeletionStatus.Pending
        };

        _db.Set<DataDeletionRequest>().Add(request);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Data deletion requested by user {UserId}", userId);

        return request;
    }

    /// <summary>
    /// Admin reviews a deletion request (approve or reject).
    /// </summary>
    public async Task<DataDeletionRequest?> ReviewDeletionRequestAsync(
        int requestId, int adminId, bool approved, string? retainedReason = null)
    {
        var request = await _db.Set<DataDeletionRequest>()
            .FirstOrDefaultAsync(r => r.Id == requestId);

        if (request == null) return null;

        if (request.Status != DeletionStatus.Pending)
        {
            throw new InvalidOperationException($"Request is not pending. Current status: {request.Status}");
        }

        request.ReviewedById = adminId;
        request.ReviewedAt = DateTime.UtcNow;

        if (approved)
        {
            request.Status = DeletionStatus.Approved;
            request.DataRetainedReason = retainedReason;
            await _db.SaveChangesAsync();

            // Process immediately (in production, this would be a background job)
            await ProcessDataDeletionAsync(request.Id);
        }
        else
        {
            request.Status = DeletionStatus.Rejected;
            request.DataRetainedReason = retainedReason;
            await _db.SaveChangesAsync();
        }

        _logger.LogInformation("Deletion request {RequestId} {Action} by admin {AdminId}",
            requestId, approved ? "approved" : "rejected", adminId);

        return request;
    }

    /// <summary>
    /// Process data deletion: anonymize user data rather than hard delete
    /// to preserve referential integrity and transaction history.
    /// </summary>
    public async Task ProcessDataDeletionAsync(int requestId)
    {
        var request = await _db.Set<DataDeletionRequest>()
            .FirstOrDefaultAsync(r => r.Id == requestId);

        if (request == null)
        {
            throw new InvalidOperationException("Deletion request not found.");
        }

        request.Status = DeletionStatus.Processing;
        await _db.SaveChangesAsync();

        try
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId);
            if (user == null)
            {
                request.Status = DeletionStatus.Completed;
                request.CompletedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
                return;
            }

            // Anonymize user profile
            user.Email = $"deleted-{user.Id}@anonymized.local";
            user.FirstName = "Deleted";
            user.LastName = "User";
            user.PasswordHash = "DELETED";
            user.IsActive = false;
            user.UpdatedAt = DateTime.UtcNow;

            // Delete personal messages content (keep structure for conversation integrity)
            var userMessages = await _db.Messages
                .Where(m => m.SenderId == request.UserId)
                .ToListAsync();

            foreach (var message in userMessages)
            {
                message.Content = "[Message deleted per GDPR request]";
            }

            // Delete feed posts
            var posts = await _db.FeedPosts
                .Where(p => p.UserId == request.UserId)
                .ToListAsync();

            foreach (var post in posts)
            {
                post.Content = "[Content deleted per GDPR request]";
            }

            // Revoke all consents
            var consents = await _db.Set<ConsentRecord>()
                .Where(c => c.UserId == request.UserId)
                .ToListAsync();

            foreach (var consent in consents)
            {
                consent.IsGranted = false;
                consent.RevokedAt = DateTime.UtcNow;
                consent.UpdatedAt = DateTime.UtcNow;
            }

            // Delete user location
            var location = await _db.Set<UserLocation>()
                .FirstOrDefaultAsync(l => l.UserId == request.UserId);

            if (location != null)
            {
                _db.Set<UserLocation>().Remove(location);
            }

            // Remove connections
            var connections = await _db.Connections
                .Where(c => c.RequesterId == request.UserId || c.AddresseeId == request.UserId)
                .ToListAsync();

            _db.Connections.RemoveRange(connections);

            // Remove notifications
            var notifications = await _db.Notifications
                .Where(n => n.UserId == request.UserId)
                .ToListAsync();

            _db.Notifications.RemoveRange(notifications);

            // Invalidate refresh tokens
            var tokens = await _db.RefreshTokens
                .Where(t => t.UserId == request.UserId)
                .ToListAsync();

            _db.RefreshTokens.RemoveRange(tokens);

            request.Status = DeletionStatus.Completed;
            request.CompletedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            _logger.LogInformation("Data deletion completed for user {UserId}, request {RequestId}",
                request.UserId, requestId);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            request.Status = DeletionStatus.Approved; // Revert to approved so it can be retried
            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Data deletion failed for request {RequestId}", requestId);
            throw;
        }
        catch (DbUpdateException ex)
        {
            request.Status = DeletionStatus.Approved; // Revert to approved so it can be retried
            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Data deletion failed for request {RequestId}", requestId);
            throw;
        }
        catch (InvalidOperationException ex)
        {
            request.Status = DeletionStatus.Approved; // Revert to approved so it can be retried
            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Data deletion failed for request {RequestId}", requestId);
            throw;
        }
        catch (OperationCanceledException ex)
        {
            request.Status = DeletionStatus.Approved; // Revert to approved so it can be retried
            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Data deletion failed for request {RequestId}", requestId);
            throw;
        }
    }

    #endregion

    #region Consent Management

    /// <summary>
    /// Record or update a user's consent for a specific type.
    /// </summary>
    public async Task<ConsentRecord> RecordConsentAsync(int userId, string consentType, bool granted, string? ipAddress = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var existing = await _db.Set<ConsentRecord>()
            .FirstOrDefaultAsync(c => c.UserId == userId && c.ConsentType == consentType);

        if (existing != null)
        {
            existing.IsGranted = granted;
            existing.IpAddress = ipAddress;
            existing.UpdatedAt = DateTime.UtcNow;

            if (granted)
            {
                existing.GrantedAt = DateTime.UtcNow;
                existing.RevokedAt = null;
            }
            else
            {
                existing.RevokedAt = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync();

            _logger.LogInformation("Consent '{ConsentType}' {Action} for user {UserId}",
                consentType, granted ? "granted" : "revoked", userId);

            return existing;
        }

        var record = new ConsentRecord
        {
            TenantId = tenantId,
            UserId = userId,
            ConsentType = consentType,
            IsGranted = granted,
            GrantedAt = granted ? DateTime.UtcNow : null,
            RevokedAt = granted ? null : DateTime.UtcNow,
            IpAddress = ipAddress
        };

        _db.Set<ConsentRecord>().Add(record);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Consent '{ConsentType}' {Action} for user {UserId}",
            consentType, granted ? "granted" : "revoked", userId);

        return record;
    }

    /// <summary>
    /// Get all consent records for a user.
    /// </summary>
    public async Task<List<ConsentRecord>> GetUserConsentsAsync(int userId)
    {
        return await _db.Set<ConsentRecord>()
            .Where(c => c.UserId == userId)
            .OrderBy(c => c.ConsentType)
            .ToListAsync();
    }

    /// <summary>
    /// Revoke a specific consent type for a user.
    /// </summary>
    public async Task<ConsentRecord?> RevokeConsentAsync(int userId, string consentType)
    {
        var record = await _db.Set<ConsentRecord>()
            .FirstOrDefaultAsync(c => c.UserId == userId && c.ConsentType == consentType);

        if (record == null) return null;

        record.IsGranted = false;
        record.RevokedAt = DateTime.UtcNow;
        record.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Consent '{ConsentType}' revoked for user {UserId}", consentType, userId);

        return record;
    }

    #endregion
}
