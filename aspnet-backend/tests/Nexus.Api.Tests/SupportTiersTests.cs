// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Nexus.Api.Support.Safeguarding;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins the SupportTiers port against the Laravel behaviours its own tests
/// pin (SubAccountServiceTest, MessageAccessConsentTest): the permanently
/// dead can_view_messages boolean, boolean floors vs tier overrides, the
/// drop-not-clamp cap rule, expansion detection, and the staff cap.
/// </summary>
public sealed class SupportTiersTests
{
    [Fact]
    public void DeadBoolean_NeverActivatesTheMessagesCapability()
    {
        var resolved = SupportTiers.Resolve(
            new Dictionary<string, bool> { ["can_view_messages"] = true }, null);

        resolved["messages"].Should().Be(SupportTiers.None,
            "historical rows stored can_view_messages=true from the years the switch did nothing");
    }

    [Fact]
    public void ToLegacyBooleans_AlwaysWritesCanViewMessagesFalse()
    {
        var booleans = SupportTiers.ToLegacyBooleans(new Dictionary<string, string>
        {
            ["messages"] = SupportTiers.Assist
        });

        booleans["can_view_messages"].Should().BeFalse(
            "the legacy boolean stays permanently dead even when the real capability is granted");
    }

    [Fact]
    public void LegacyBooleans_SetTheFloor()
    {
        var resolved = SupportTiers.Resolve(new Dictionary<string, bool>
        {
            ["can_view_activity"] = true,
            ["can_manage_listings"] = true,
            ["can_transact"] = false
        }, null);

        resolved["activity"].Should().Be(SupportTiers.Assist);
        resolved["listings"].Should().Be(SupportTiers.Represent);
        resolved["credits"].Should().Be(SupportTiers.None);
    }

    [Fact]
    public void TiersObject_OverridesTheBooleanFloor()
    {
        var resolved = SupportTiers.Resolve(
            new Dictionary<string, bool> { ["can_manage_listings"] = true },
            new Dictionary<string, string> { ["listings"] = SupportTiers.CoDecide });

        resolved["listings"].Should().Be(SupportTiers.CoDecide,
            "the explicit tiers object wins over the coarse boolean");
    }

    [Fact]
    public void AboveCapValues_AreDroppedNotClamped()
    {
        var resolved = SupportTiers.Resolve(null,
            new Dictionary<string, string> { ["messages"] = SupportTiers.Represent });
        resolved["messages"].Should().Be(SupportTiers.None,
            "an out-of-policy stored value must degrade toward LESS power, not be clamped to assist");

        var sanitized = SupportTiers.SanitizeTiers(
            new Dictionary<string, string> { ["messages"] = SupportTiers.CoDecide });
        sanitized.Should().NotContainKey("messages");

        SupportTiers.SanitizeTiers(
                new Dictionary<string, string> { ["messages"] = SupportTiers.Assist })
            .Should().ContainKey("messages", "assist is within the messages cap");
    }

    [Fact]
    public void Sanitize_DropsUnknownCapabilitiesAndTiers()
    {
        var sanitized = SupportTiers.SanitizeTiers(new Dictionary<string, string>
        {
            ["listings"] = "represent",
            ["nonsense"] = "represent",
            ["credits"] = "maximum"
        });

        sanitized.Should().HaveCount(1);
        sanitized["listings"].Should().Be(SupportTiers.Represent);
    }

    [Fact]
    public void IsExpansion_DetectsAnyGainAndIgnoresShrink()
    {
        var before = new Dictionary<string, string> { ["listings"] = SupportTiers.CoDecide };
        SupportTiers.IsExpansion(before,
            new Dictionary<string, string> { ["listings"] = SupportTiers.Represent })
            .Should().BeTrue();
        SupportTiers.IsExpansion(before,
            new Dictionary<string, string> { ["listings"] = SupportTiers.None })
            .Should().BeFalse();
        SupportTiers.IsExpansion(before, before).Should().BeFalse();
    }

    [Fact]
    public void AtLeast_TreatsMissingCapabilityAsNone()
    {
        SupportTiers.AtLeast(new Dictionary<string, string>(), "credits", SupportTiers.Assist)
            .Should().BeFalse();
        SupportTiers.AtLeast(new Dictionary<string, string>(), "credits", SupportTiers.None)
            .Should().BeTrue();
    }

    [Fact]
    public void CapForStaff_ClampsToCoDecideAndRemovesMessages()
    {
        var capped = SupportTiers.CapForStaff(new Dictionary<string, string>
        {
            ["listings"] = SupportTiers.Represent,
            ["activity"] = SupportTiers.Assist,
            ["messages"] = SupportTiers.Assist
        });

        capped["listings"].Should().Be(SupportTiers.CoDecide, "staff grants are capped at co_decide");
        capped["activity"].Should().Be(SupportTiers.Assist);
        capped.Should().NotContainKey("messages", "staff never hold the messages capability");
    }
}
