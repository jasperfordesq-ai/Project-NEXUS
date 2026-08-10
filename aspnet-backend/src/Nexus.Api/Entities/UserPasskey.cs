// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Stores a WebAuthn/passkey credential for a user.
/// Each user can have multiple passkeys (e.g. Windows Hello + phone).
/// Tenant-scoped via the user relationship.
/// </summary>
public class UserPasskey : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// The credential ID returned by the authenticator (base64url-encoded).
    /// Used to look up the credential during authentication.
    /// </summary>
    public byte[] CredentialId { get; set; } = Array.Empty<byte>();

    /// <summary>
    /// The public key returned by the authenticator (COSE-encoded).
    /// Used to verify assertion signatures.
    /// </summary>
    public byte[] PublicKey { get; set; } = Array.Empty<byte>();

    /// <summary>
    /// The user handle sent to the authenticator (used for resident/discoverable credentials).
    /// This is a random identifier, NOT the database user ID.
    /// </summary>
    public byte[] UserHandle { get; set; } = Array.Empty<byte>();

    /// <summary>
    /// Signature counter for replay protection.
    /// Incremented by the authenticator on each use.
    /// </summary>
    public uint SignCount { get; set; }

    /// <summary>
    /// The credential type (typically "public-key").
    /// </summary>
    public string CredType { get; set; } = "public-key";

    /// <summary>
    /// The attestation format used during registration.
    /// </summary>
    public Guid AaGuid { get; set; }

    /// <summary>
    /// Friendly name for this passkey (e.g. "Windows Hello", "iPhone").
    /// Set by the user for management purposes.
    /// </summary>
    public string? DisplayName { get; set; }

    /// <summary>
    /// Transports reported by the authenticator (e.g. "internal", "hybrid", "usb", "ble", "nfc").
    /// Stored as comma-separated values.
    /// </summary>
    public string? Transports { get; set; }

    /// <summary>
    /// Whether this credential is a resident/discoverable credential.
    /// Discoverable credentials support username-less / autofill flows.
    /// </summary>
    public bool IsDiscoverable { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastUsedAt { get; set; }

    // Navigation
    public User? User { get; set; }
    public Tenant? Tenant { get; set; }
}
