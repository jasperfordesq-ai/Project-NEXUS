// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services;

/// <summary>
/// Interface for tracking user-to-SignalR-connection mappings.
/// Uses a composite (tenantId, userId) key to ensure tenant isolation.
/// </summary>
public interface IUserConnectionService
{
    /// <summary>
    /// Register a connection for a user within a tenant.
    /// </summary>
    void AddConnection(int tenantId, int userId, string connectionId);

    /// <summary>
    /// Remove a connection for a user within a tenant.
    /// </summary>
    void RemoveConnection(int tenantId, int userId, string connectionId);

    /// <summary>
    /// Get all connection IDs for a user within a tenant (they may have multiple tabs/devices).
    /// </summary>
    IReadOnlyList<string> GetConnections(int tenantId, int userId);

    /// <summary>
    /// Check if a user has any active connections within a tenant.
    /// </summary>
    bool IsUserConnected(int tenantId, int userId);
}

/// <summary>
/// Thread-safe in-memory service for tracking user-to-SignalR-connection mappings.
/// Singleton lifetime - shared across all requests.
///
/// Uses a composite (tenantId, userId) key to prevent cross-tenant connection lookups.
/// Supports multiple connections per user (multiple browser tabs, devices).
/// Tracks connection timestamps to enable cleanup of stale entries.
/// </summary>
public class UserConnectionService : IUserConnectionService
{
    // (tenantId, userId) -> set of connectionIds
    private readonly Dictionary<(int TenantId, int UserId), HashSet<string>> _userConnections = new();
    // connectionId -> timestamp when added (for stale connection cleanup)
    private readonly Dictionary<string, DateTime> _connectionTimestamps = new();
    private readonly object _lock = new();

    /// <summary>
    /// Maximum age of a connection before it's considered stale (24 hours).
    /// SignalR connections should be refreshed more frequently than this.
    /// </summary>
    private static readonly TimeSpan StaleConnectionThreshold = TimeSpan.FromHours(24);

    public void AddConnection(int tenantId, int userId, string connectionId)
    {
        lock (_lock)
        {
            var key = (tenantId, userId);
            if (!_userConnections.TryGetValue(key, out var connections))
            {
                connections = new HashSet<string>();
                _userConnections[key] = connections;
            }
            connections.Add(connectionId);
            _connectionTimestamps[connectionId] = DateTime.UtcNow;
        }
    }

    public void RemoveConnection(int tenantId, int userId, string connectionId)
    {
        lock (_lock)
        {
            var key = (tenantId, userId);
            if (_userConnections.TryGetValue(key, out var connections))
            {
                connections.Remove(connectionId);
                _connectionTimestamps.Remove(connectionId);

                // Clean up empty entries
                if (connections.Count == 0)
                {
                    _userConnections.Remove(key);
                }
            }
        }
    }

    public IReadOnlyList<string> GetConnections(int tenantId, int userId)
    {
        lock (_lock)
        {
            var key = (tenantId, userId);
            if (_userConnections.TryGetValue(key, out var connections))
            {
                return connections.ToList();
            }
            return Array.Empty<string>();
        }
    }

    public bool IsUserConnected(int tenantId, int userId)
    {
        lock (_lock)
        {
            var key = (tenantId, userId);
            return _userConnections.TryGetValue(key, out var connections) && connections.Count > 0;
        }
    }

    /// <summary>
    /// Remove connections that are older than the stale threshold.
    /// Should be called periodically (e.g., via a background service) to prevent memory leaks
    /// from connections that were never properly cleaned up (e.g., abrupt disconnects).
    /// </summary>
    /// <returns>Number of stale connections removed.</returns>
    public int PurgeStaleConnections()
    {
        lock (_lock)
        {
            var cutoff = DateTime.UtcNow - StaleConnectionThreshold;
            var staleConnections = _connectionTimestamps
                .Where(kvp => kvp.Value < cutoff)
                .Select(kvp => kvp.Key)
                .ToList();

            foreach (var connectionId in staleConnections)
            {
                _connectionTimestamps.Remove(connectionId);

                // Find and remove from user connections
                var keysToClean = new List<(int, int)>();
                foreach (var (key, connections) in _userConnections)
                {
                    if (connections.Remove(connectionId) && connections.Count == 0)
                    {
                        keysToClean.Add(key);
                    }
                }

                foreach (var key in keysToClean)
                {
                    _userConnections.Remove(key);
                }
            }

            return staleConnections.Count;
        }
    }

    /// <summary>
    /// Get the total number of tracked connections (for diagnostics).
    /// </summary>
    public int GetTotalConnectionCount()
    {
        lock (_lock)
        {
            return _connectionTimestamps.Count;
        }
    }
}
