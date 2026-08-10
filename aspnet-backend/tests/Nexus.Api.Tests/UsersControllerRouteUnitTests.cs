// Copyright 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Reflection;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Controllers;

namespace Nexus.Api.Tests;

public class UsersControllerRouteUnitTests
{
    [Fact]
    public void DeleteMe_ExposesLaravelReactV2AccountDeletionRoute()
    {
        var method = typeof(UsersController)
            .GetMethod("DeleteMe", BindingFlags.Instance | BindingFlags.Public);

        method.Should().NotBeNull();
        method!
            .GetCustomAttribute<HttpDeleteAttribute>()?.Template
            .Should().Be("me");

        typeof(UsersController)
            .GetCustomAttributes<RouteAttribute>()
            .Select(route => route.Template)
            .Should().Contain("api/v2/users");
    }
}
