// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class SafeguardingAttestationAppendOnlyTests
{
    [Fact]
    public void Attestation_DirectDelete_IsRejectedBeforeItsEventHistoryCanCascade()
    {
        using var db = Context();
        var attestation = new MemberVettingAttestation
        {
            Id = 6001,
            TenantId = 42,
            UserId = 1001,
            SchemeCode = "dbs_england_wales",
            AttestationCode = "dbs_enhanced",
            PurposeCode = "safeguarded_member_contact",
            ScopeType = "tenant",
            ScopeIdentifier = "42",
            Decision = MemberVettingAttestation.ConfirmedDecision,
            PolicyVersion = "safeguarded-contact-v1:test"
        };
        db.Attach(attestation);
        db.Remove(attestation);

        Action action = () => db.SaveChanges();

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*attestations are retained audit evidence*");
    }

    [Fact]
    public void AttestationEvent_DirectUpdate_IsRejectedBeforePersistence()
    {
        using var db = Context();
        var auditEvent = AttestationEvent();
        db.Attach(auditEvent);
        auditEvent.EventType = "revoked";

        Action action = () => db.SaveChanges(acceptAllChangesOnSuccess: false);

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*attestation events are append-only*");
    }

    [Fact]
    public void AttestationEvent_DirectDelete_IsRejectedBeforePersistence()
    {
        using var db = Context();
        var auditEvent = AttestationEvent();
        db.Attach(auditEvent);
        db.Remove(auditEvent);

        Action action = () => db.SaveChanges();

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*attestation events are append-only*");
    }

    [Fact]
    public async Task PolicyRotationEvent_DirectUpdate_IsRejectedBeforePersistence()
    {
        using var db = Context();
        var rotation = RotationEvent();
        db.Attach(rotation);
        rotation.ReasonCode = "policy_changed";

        Func<Task> action = () => db.SaveChangesAsync(
            acceptAllChangesOnSuccess: false,
            cancellationToken: CancellationToken.None);

        await action.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*policy rotation events are append-only*");
    }

    [Fact]
    public void PolicyRotationEvent_DirectDelete_IsRejectedBeforePersistence()
    {
        using var db = Context();
        var rotation = RotationEvent();
        db.Attach(rotation);
        db.Remove(rotation);

        Action action = () => db.SaveChanges();

        action.Should().Throw<InvalidOperationException>()
            .WithMessage("*policy rotation events are append-only*");
    }

    private static MemberVettingAttestationEvent AttestationEvent()
    {
        return new MemberVettingAttestationEvent
        {
            Id = 7001,
            AttestationId = 6001,
            TenantId = 42,
            UserId = 1001,
            SchemeCode = "dbs_england_wales",
            AttestationCode = "dbs_enhanced",
            PurposeCode = "safeguarded_member_contact",
            ScopeType = "tenant",
            EventType = "confirmed",
            DecisionAfter = "confirmed",
            PolicyVersion = "safeguarded-contact-v1:test",
            CreatedAt = DateTime.UtcNow
        };
    }

    private static SafeguardingPolicyRotationEvent RotationEvent()
    {
        return new SafeguardingPolicyRotationEvent
        {
            Id = 8001,
            TenantId = 42,
            Jurisdiction = "england_wales",
            SchemeCode = "dbs_england_wales",
            AttestationCode = "dbs_enhanced",
            PurposeCode = "safeguarded_member_contact",
            ScopeType = "tenant",
            PreviousPolicyVersion = "safeguarded-contact-v1:old",
            NewPolicyVersion = "safeguarded-contact-v1:new",
            ReasonCode = "scheduled_review",
            CreatedAt = DateTime.UtcNow
        };
    }

    private static NexusDbContext Context()
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new NexusDbContext(options, new TenantContext());
    }
}
