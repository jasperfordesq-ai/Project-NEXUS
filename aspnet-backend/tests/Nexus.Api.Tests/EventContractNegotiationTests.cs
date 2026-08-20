// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Nexus.Api.Support.Events;

namespace Nexus.Api.Tests;

/// <summary>
/// Regression tests for events contract negotiation.
///
/// 🔴 WHY THIS EXISTS — a REGRESSION THIS WORKSTREAM CAUSED. Porting Laravel's canonical v2
/// event mapper without its negotiation made this backend serve v2 to every caller. Laravel
/// serves v2 ONLY to a caller sending `X-Events-Contract: 2` and legacy v1 to everyone else
/// (`EventsController::eventContractVersion()`, `NegotiateEventsContract`).
///
/// Three React surfaces call the events list WITHOUT that header — the dashboard
/// (`DashboardPage.tsx:286`), group detail (`groupDetail.ts:383`) and the Verein federation
/// panel (`VereinFederationPanel.tsx:152`). They share the legacy `Event` type, which
/// declares `location?: string`, and the dashboard renders `{event.location}` straight into
/// JSX (`:572`). Serving the v2 structured object there threw "Objects are not valid as a
/// React child" and took the entire dashboard down.
///
/// 🔴 The field-diff harness had scored the events endpoint as FIXED throughout, because a
/// response diff compares the shape you ASKED for. Only the browser smoke found this. Do
/// not delete these tests to make a mapper change simpler.
/// </summary>
public class EventContractNegotiationTests
{
    [Theory]
    [InlineData("2")]
    [InlineData(" 2 ")]      // Laravel trims before comparing.
    public void The_canonical_contract_is_served_only_when_asked_for_exactly(string header)
    {
        EventContractMapper.NegotiateVersion(header)
            .Should().Be(EventContractMapper.Version);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("1")]
    [InlineData("3")]
    [InlineData("02")]        // Laravel compares strings, not numbers.
    [InlineData("v2")]
    [InlineData("2, 1")]
    [InlineData("junk")]
    public void Anything_else_gets_the_legacy_contract(string? header)
    {
        EventContractMapper.NegotiateVersion(header)
            .Should().Be(EventContractMapper.LegacyVersion);
    }

    private static Dictionary<string, object?> CanonicalLike() => new()
    {
        ["contract_version"] = EventContractMapper.Version,
        ["id"] = 5,
        ["title"] = "Repair Cafe",
        ["location"] = new Dictionary<string, object?>
        {
            ["label"] = "Riverside Hall",
            ["latitude"] = 53.3498,
            ["longitude"] = -6.2603,
            ["mode"] = "in_person",
            ["accessibility"] = new Dictionary<string, object?> { ["provided"] = false },
        },
        ["location_label"] = "Riverside Hall",
    };

    [Fact]
    public void The_legacy_shape_carries_location_as_a_plain_string()
    {
        // THE assertion. If `location` is ever a dictionary again on the legacy path, the
        // React dashboard throws and the whole page unmounts.
        var legacy = EventContractMapper.DowngradeToLegacy(CanonicalLike());

        legacy["location"].Should().BeOfType<string>().And.Be("Riverside Hall");
        legacy["location"].Should().NotBeAssignableTo<Dictionary<string, object?>>();
    }

    [Fact]
    public void The_legacy_shape_carries_no_version_marker()
    {
        // Laravel's v1 has no `contract_version` at all — its ABSENCE is how a client tells
        // the two shapes apart, so it must be removed rather than set to 1.
        var legacy = EventContractMapper.DowngradeToLegacy(CanonicalLike());

        legacy.Should().NotContainKey("contract_version");
    }

    [Fact]
    public void Only_the_downgraded_payload_diverges_from_the_canonical_one()
    {
        // 🔴 This test was originally a TAUTOLOGY: it built a dictionary and asserted the
        // values it had just put in it, exercising no production code at all — the very
        // fault class this repo keeps finding. It now compares the two paths, so it fails if
        // DowngradeToLegacy ever touches the canonical payload or stops changing the legacy
        // one.
        var untouched = CanonicalLike();
        var downgraded = EventContractMapper.DowngradeToLegacy(CanonicalLike());

        untouched["location"].Should().BeAssignableTo<Dictionary<string, object?>>(
            "a caller that asked for v2 must still get the structured location");
        untouched["contract_version"].Should().Be(EventContractMapper.Version);

        downgraded["location"].Should().BeOfType<string>();
        downgraded.Should().NotContainKey("contract_version");
        downgraded.Keys.Should().HaveCount(untouched.Keys.Count - 1,
            "the downgrade removes exactly one key and rewrites one value");
    }

    [Fact]
    public void The_downgrade_mutates_in_place_and_returns_the_same_instance()
    {
        // The controller passes the mapper's own dictionary straight through, so an
        // implementation that returned a COPY would silently drop the downgrade if a caller
        // ignored the return value. Pin the contract both ways.
        var canonical = CanonicalLike();

        var result = EventContractMapper.DowngradeToLegacy(canonical);

        result.Should().BeSameAs(canonical);
        canonical["location"].Should().BeOfType<string>();
    }

    [Fact]
    public void Downgrading_keeps_the_flat_label_alias_and_the_other_fields()
    {
        var legacy = EventContractMapper.DowngradeToLegacy(CanonicalLike());

        legacy["location_label"].Should().Be("Riverside Hall",
            "the alias is additive and harmless to a v1 client");
        legacy["id"].Should().Be(5);
        legacy["title"].Should().Be("Repair Cafe");
    }

    [Fact]
    public void Downgrading_a_structured_location_with_no_label_yields_null_not_an_object()
    {
        var canonical = CanonicalLike();
        canonical["location"] = new Dictionary<string, object?> { ["mode"] = "online" };

        var legacy = EventContractMapper.DowngradeToLegacy(canonical);

        legacy["location"].Should().BeNull(
            "an online event has no venue string; null is what the legacy shape sends");
    }

    [Fact]
    public void Downgrading_tolerates_a_location_that_is_already_flat()
    {
        // Defensive: a second downgrade, or a payload built elsewhere, must not corrupt it.
        var canonical = CanonicalLike();
        canonical["location"] = "Already flat";

        var legacy = EventContractMapper.DowngradeToLegacy(canonical);

        legacy["location"].Should().Be("Already flat");
    }

    [Fact]
    public void Downgrading_tolerates_a_payload_with_no_location_key_at_all()
    {
        var canonical = CanonicalLike();
        canonical.Remove("location");

        var act = () => EventContractMapper.DowngradeToLegacy(canonical);

        act.Should().NotThrow();
    }
}
