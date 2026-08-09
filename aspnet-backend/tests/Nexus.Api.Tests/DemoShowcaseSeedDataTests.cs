// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Data;

namespace Nexus.Api.Tests;

public class DemoShowcaseSeedDataTests
{
    [Fact]
    public void DemoPassword_IsStrongAndReplacesLegacySeedPassword()
    {
        var password = DemoShowcaseSeedData.DemoPassword;

        Assert.True(password.Length >= 16);
        Assert.Contains(password, char.IsUpper);
        Assert.Contains(password, char.IsLower);
        Assert.Contains(password, char.IsDigit);
        Assert.Contains(password, c => !char.IsLetterOrDigit(c));
        Assert.NotEqual("Test123!", password);
    }
}
