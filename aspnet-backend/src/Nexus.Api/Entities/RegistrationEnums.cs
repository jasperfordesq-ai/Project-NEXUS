// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Registration method configured per tenant.
/// </summary>
public enum RegistrationMode
{
    /// <summary>Standard Project NEXUS registration (email + password).</summary>
    Standard = 0,

    /// <summary>Standard registration followed by admin approval before activation.</summary>
    StandardWithApproval = 1,

    /// <summary>Registration requires identity verification via a third-party provider.</summary>
    VerifiedIdentity = 2,

    /// <summary>Registration via government/eID provider (future-ready).</summary>
    GovernmentId = 3,

    /// <summary>Invite-only — registration is closed to the public.</summary>
    InviteOnly = 4
}

/// <summary>
/// Supported identity verification providers.
/// </summary>
public enum VerificationProvider
{
    None = 0,
    Mock = 1,
    Veriff = 10,
    Jumio = 11,
    Persona = 12,
    Entrust = 13,
    Trulioo = 14,
    Yoti = 15,
    StripeIdentity = 16,
    UkCertified = 17,
    EudiWallet = 18,
    Onfido = 19,
    Idenfy = 20,
    Custom = 99
}

/// <summary>
/// Level of identity verification required.
/// </summary>
public enum VerificationLevel
{
    None = 0,
    DocumentOnly = 1,
    DocumentAndSelfie = 2,
    AuthoritativeDataMatch = 3,
    ReusableDigitalId = 4,
    ManualReviewFallback = 5
}

/// <summary>
/// What happens after identity verification completes successfully.
/// </summary>
public enum PostVerificationAction
{
    ActivateAutomatically = 0,
    SendToAdminForApproval = 1,
    GrantLimitedAccess = 2,
    RejectOnFailure = 3
}

/// <summary>
/// User registration lifecycle state.
/// </summary>
public enum RegistrationStatus
{
    /// <summary>Initial registration submitted, not yet complete.</summary>
    PendingRegistration = 0,

    /// <summary>Awaiting identity verification from provider.</summary>
    PendingVerification = 1,

    /// <summary>Verification passed, awaiting admin review.</summary>
    PendingAdminReview = 2,

    /// <summary>Fully activated account.</summary>
    Active = 3,

    /// <summary>Registration rejected by admin or policy.</summary>
    Rejected = 4,

    /// <summary>Identity verification failed.</summary>
    VerificationFailed = 5,

    /// <summary>Limited access granted pending full approval.</summary>
    LimitedAccess = 6
}

/// <summary>
/// Status of an identity verification session.
/// </summary>
public enum VerificationSessionStatus
{
    Created = 0,
    InProgress = 1,
    Completed = 2,
    Failed = 3,
    Expired = 4,
    Cancelled = 5
}
