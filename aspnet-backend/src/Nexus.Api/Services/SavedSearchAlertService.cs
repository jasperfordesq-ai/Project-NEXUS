// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Background service that periodically checks saved searches with NotifyOnNewResults=true
/// and creates notifications when new results are found.
/// </summary>
public class SavedSearchAlertService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<SavedSearchAlertService> _logger;
    private readonly IConfiguration _configuration;
    private readonly TimeSpan _checkInterval = TimeSpan.FromMinutes(15);

    public SavedSearchAlertService(
        IServiceScopeFactory scopeFactory,
        ILogger<SavedSearchAlertService> logger,
        IConfiguration configuration)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _configuration = configuration;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_configuration.GetValue<bool>("BackgroundServices:SuppressAutomaticExecution"))
        {
            _logger.LogInformation(
                "SavedSearchAlertService automatic execution suppressed by configuration");
            return;
        }

        _logger.LogInformation("SavedSearchAlertService started. Check interval: {Interval}", _checkInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckSavedSearchesAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // Graceful shutdown
                break;
            }
            catch (DbUpdateException ex)
            {
                _logger.LogError(ex, "Error checking saved searches for alerts");
            }
            catch (IOException ex)
            {
                _logger.LogError(ex, "Error checking saved searches for alerts");
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogError(ex, "Error checking saved searches for alerts");
            }

            await Task.Delay(_checkInterval, stoppingToken);
        }

        _logger.LogInformation("SavedSearchAlertService stopped");
    }

    private async Task CheckSavedSearchesAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var savedSearches = await db.SavedSearches
            .IgnoreQueryFilters()
            .Where(s => s.NotifyOnNewResults)
            .ToListAsync(cancellationToken);

        if (savedSearches.Count == 0)
            return;

        _logger.LogDebug("Checking {Count} saved searches for new results", savedSearches.Count);

        foreach (var search in savedSearches)
        {
            try
            {
                var sinceDate = search.LastRunAt ?? search.CreatedAt;
                var newCount = await CountNewResultsAsync(db, search.SearchType, sinceDate, cancellationToken);

                if (newCount > (search.LastResultCount ?? 0))
                {
                    var notification = new Notification
                    {
                        TenantId = search.TenantId,
                        UserId = search.UserId,
                        Type = "saved_search_alert",
                        Title = $"New results for '{search.Name}'",
                        Body = $"{newCount} new results found",
                        IsRead = false,
                        CreatedAt = DateTime.UtcNow
                    };

                    db.Notifications.Add(notification);

                    _logger.LogInformation(
                        "Created saved search alert for user {UserId}: '{SearchName}' has {NewCount} new results",
                        search.UserId, search.Name, newCount);
                }

                search.LastRunAt = DateTime.UtcNow;
                search.LastResultCount = newCount;
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "Failed to check saved search {SearchId} for user {UserId}",
                    search.Id, search.UserId);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Failed to check saved search {SearchId} for user {UserId}",
                    search.Id, search.UserId);
            }
            catch (OperationCanceledException ex)
            {
                _logger.LogWarning(ex, "Failed to check saved search {SearchId} for user {UserId}",
                    search.Id, search.UserId);
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task<int> CountNewResultsAsync(
        NexusDbContext db, string searchType, DateTime sinceDate, CancellationToken cancellationToken)
    {
        return searchType.ToLowerInvariant() switch
        {
            "listings" => await db.Listings
                .IgnoreQueryFilters()
                .CountAsync(l => l.CreatedAt > sinceDate, cancellationToken),

            "events" => await db.Events
                .IgnoreQueryFilters()
                .CountAsync(e => e.CreatedAt > sinceDate, cancellationToken),

            "users" => await db.Users
                .IgnoreQueryFilters()
                .CountAsync(u => u.CreatedAt > sinceDate, cancellationToken),

            "groups" => await db.Groups
                .IgnoreQueryFilters()
                .CountAsync(g => g.CreatedAt > sinceDate, cancellationToken),

            _ => 0
        };
    }
}
