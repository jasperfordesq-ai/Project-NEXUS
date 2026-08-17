// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.AspNetCore.Mvc.ActionConstraints;

namespace Nexus.Api.Routing;

/// <summary>
/// Adds Laravel React /api/v2 aliases for existing ASP.NET compatibility controllers.
/// </summary>
public sealed class AdminV2RouteAliasConvention : IApplicationModelConvention
{
    private static readonly string[] AliasedPrefixes =
    [
        "api/admin/caring-community",
        "api/admin/safeguarding"
    ];

    public void Apply(ApplicationModel application)
    {
        var existingRoutes = ApplicationRouteKeys(application)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var controller in application.Controllers)
        {
            AddAdminControllerAliases(controller, existingRoutes);
            AddUsersControllerAliases(controller, existingRoutes);
            AddJobsControllerAliases(controller, existingRoutes);
            AddFederationControllerAliases(controller, existingRoutes);
            AddGoalsControllerAliases(controller, existingRoutes);
            AddCaringCommunityControllerAliases(controller, existingRoutes);
            AddSimpleV2ControllerAliases(controller, existingRoutes);
            AddSimpleV2ControllerActionAliases(controller, existingRoutes);
            AddGroupsControllerActionAliases(controller, existingRoutes);
            AddIdeationControllerActionAliases(controller, existingRoutes);
            AddUsersMeActionAliases(controller, existingRoutes);
            AddGroupsActionAliases(controller, existingRoutes);
            AddJobsActionAliases(controller, existingRoutes);
            AddFederationActionAliases(controller, existingRoutes);
            AddGoalsActionAliases(controller, existingRoutes);
            AddIdeationActionAliases(controller, existingRoutes);
            AddCaringCommunityActionAliases(controller, existingRoutes);
            AddVolunteeringActionAliases(controller, existingRoutes);
            AddSimpleV2ActionAliases(controller, existingRoutes);
        }
    }

    private static void AddAdminControllerAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        if (controller.Actions
            .SelectMany(action => action.Selectors)
            .Any(selector => Normalize(selector.AttributeRouteModel?.Template).StartsWith(
                "api/v2/admin/",
                StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        var aliases = controller.Selectors
            .Where(selector => selector.AttributeRouteModel?.Template is not null)
            .Where(selector => IsAliasedAdminPrefix(selector.AttributeRouteModel!.Template!))
            .Select(selector => new
            {
                Selector = selector,
                Alias = ToV2AdminAlias(selector.AttributeRouteModel!.Template!)
            })
            .DistinctBy(item => item.Alias, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var item in aliases)
        {
            AddControllerAlias(controller, existingRoutes, item.Selector, item.Alias!);
        }
    }

    private static void AddUsersMeActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToUsersMeV2Alias(selector.AttributeRouteModel!.Template)
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddGroupsActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToGroupsV2Alias(selector.AttributeRouteModel!.Template)
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddJobsActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToJobsV2Alias(selector.AttributeRouteModel!.Template)
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddFederationActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToFederationV2Alias(selector.AttributeRouteModel!.Template)
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddGoalsActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToGoalsV2Alias(selector.AttributeRouteModel!.Template)
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddIdeationActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToIdeationV2Alias(selector.AttributeRouteModel!.Template)
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddCaringCommunityActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToCaringCommunityV2Alias(selector.AttributeRouteModel!.Template)
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddVolunteeringActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        // Focused controllers that already own an explicit V2 volunteering
        // prefix may also expose absolute legacy compatibility selectors.
        // Re-aliasing those legacy selectors would register the same V2 action
        // twice and make money-critical routes ambiguous at runtime.
        if (controller.Selectors
            .Select(selector => Normalize(selector.AttributeRouteModel?.Template))
            .Any(template => template.Equals("api/v2/volunteering", StringComparison.OrdinalIgnoreCase)
                || template.StartsWith("api/v2/volunteering/", StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        var controllerPrefixes = controller.Selectors
            .Select(selector => Normalize(selector.AttributeRouteModel?.Template))
            .Where(template => template.Equals("api/volunteering", StringComparison.OrdinalIgnoreCase)
                || template.StartsWith("api/volunteering/", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .SelectMany(selector => controllerPrefixes
                    .Select(prefix => new
                    {
                        Selector = selector,
                        Alias = ToVolunteeringV2Alias(CombineRoute(
                            prefix,
                            selector.AttributeRouteModel!.Template))
                    })
                    .Append(new
                    {
                        Selector = selector,
                        Alias = ToVolunteeringV2Alias(selector.AttributeRouteModel!.Template)
                    }))
                .Where(item => item.Alias is not null)
                .DistinctBy(item => Normalize(item.Alias), StringComparer.OrdinalIgnoreCase)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddSimpleV2ActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToSimpleV2Alias(selector.AttributeRouteModel!.Template)
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddGroupsControllerActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var groupPrefixes = controller.Selectors
            .Select(selector => Normalize(selector.AttributeRouteModel?.Template))
            .Where(template => template.Equals("api/groups", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (groupPrefixes.Length == 0)
        {
            return;
        }

        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToGroupsV2Alias(CombineRoute("api/groups", selector.AttributeRouteModel!.Template))
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddSimpleV2ControllerActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var controllerPrefixes = controller.Selectors
            .Select(selector => Normalize(selector.AttributeRouteModel?.Template))
            .Where(template => template.Equals("api", StringComparison.OrdinalIgnoreCase))
            .Concat(controller.Selectors
                .Select(selector => Normalize(selector.AttributeRouteModel?.Template))
                .Where(template => template.Equals("api/auth", StringComparison.OrdinalIgnoreCase) || template.Equals("api/skills", StringComparison.OrdinalIgnoreCase) || template.Equals("api/search", StringComparison.OrdinalIgnoreCase)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (controllerPrefixes.Length == 0)
        {
            return;
        }

        foreach (var action in controller.Actions)
        {
            var aliases = controllerPrefixes
                .SelectMany(prefix => action.Selectors
                    .Where(selector => selector.AttributeRouteModel is not null)
                    .Select(selector => new
                    {
                        Selector = selector,
                        Alias = ToSimpleV2Alias(CombineRoute(prefix, selector.AttributeRouteModel!.Template))
                    }))
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddIdeationControllerActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var apiPrefixes = controller.Selectors
            .Select(selector => Normalize(selector.AttributeRouteModel?.Template))
            .Where(template => template.Equals("api", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (apiPrefixes.Length == 0)
        {
            return;
        }

        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToIdeationV2Alias(CombineRoute("api", selector.AttributeRouteModel!.Template))
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddJobsControllerActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var jobPrefixes = controller.Selectors
            .Select(selector => Normalize(selector.AttributeRouteModel?.Template))
            .Where(template => template.Equals("api/jobs", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (jobPrefixes.Length == 0)
        {
            return;
        }

        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToJobsV2Alias(CombineRoute("api/jobs", selector.AttributeRouteModel!.Template))
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static void AddFederationControllerActionAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var federationPrefixes = controller.Selectors
            .Select(selector => Normalize(selector.AttributeRouteModel?.Template))
            .Where(template => template.Equals("api/federation", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (federationPrefixes.Length == 0)
        {
            return;
        }

        foreach (var action in controller.Actions)
        {
            var aliases = action.Selectors
                .Where(selector => selector.AttributeRouteModel is not null)
                .Select(selector => new
                {
                    Selector = selector,
                    Alias = ToFederationV2Alias(CombineRoute("api/federation", selector.AttributeRouteModel!.Template))
                })
                .Where(item => item.Alias is not null)
                .ToArray();

            foreach (var item in aliases)
            {
                if (HasRoute(action.Selectors, item.Alias!) || HasExistingActionRoute(existingRoutes, item.Selector, item.Alias!))
                {
                    continue;
                }

                var aliasSelector = new SelectorModel(item.Selector)
                {
                    AttributeRouteModel = new AttributeRouteModel(item.Selector.AttributeRouteModel!)
                    {
                        Template = item.Alias
                    }
                };

                action.Selectors.Add(aliasSelector);
                AddRouteKeys(existingRoutes, aliasSelector);
            }
        }
    }

    private static string CombineRoute(string prefix, string? child)
    {
        var normalizedChild = Normalize(child);
        if (normalizedChild.Length == 0)
        {
            return Normalize(prefix);
        }

        if (normalizedChild.StartsWith("api/", StringComparison.OrdinalIgnoreCase))
        {
            return normalizedChild;
        }

        return Normalize(prefix) + "/" + normalizedChild;
    }

    private static void AddUsersControllerAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var aliases = controller.Selectors
            .Where(selector => Normalize(selector.AttributeRouteModel?.Template)
                .Equals("api/users", StringComparison.OrdinalIgnoreCase))
            .Select(selector => new { Selector = selector, Alias = "api/v2/users" })
            .DistinctBy(item => item.Alias, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var item in aliases)
        {
            AddControllerAlias(controller, existingRoutes, item.Selector, item.Alias!);
        }
    }

    private static void AddJobsControllerAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var aliases = controller.Selectors
            .Where(selector => Normalize(selector.AttributeRouteModel?.Template)
                .Equals("api/jobs", StringComparison.OrdinalIgnoreCase))
            .Select(selector => new { Selector = selector, Alias = "api/v2/jobs" })
            .DistinctBy(item => item.Alias, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var item in aliases)
        {
            AddControllerAlias(controller, existingRoutes, item.Selector, item.Alias!);
        }
    }

    private static void AddFederationControllerAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var aliases = controller.Selectors
            .Where(selector => Normalize(selector.AttributeRouteModel?.Template)
                .Equals("api/federation", StringComparison.OrdinalIgnoreCase))
            .Select(selector => new { Selector = selector, Alias = "api/v2/federation" })
            .DistinctBy(item => item.Alias, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var item in aliases)
        {
            AddControllerAlias(controller, existingRoutes, item.Selector, item.Alias!);
        }
    }

    private static void AddGoalsControllerAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var aliases = controller.Selectors
            .Where(selector => Normalize(selector.AttributeRouteModel?.Template)
                .Equals("api/goals", StringComparison.OrdinalIgnoreCase))
            .Select(selector => new { Selector = selector, Alias = "api/v2/goals" })
            .DistinctBy(item => item.Alias, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var item in aliases)
        {
            AddControllerAlias(controller, existingRoutes, item.Selector, item.Alias!);
        }
    }

    private static void AddCaringCommunityControllerAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var aliases = controller.Selectors
            .Select(selector => new { Selector = selector, Template = Normalize(selector.AttributeRouteModel?.Template) })
            .Where(item =>
                item.Template.Equals("api/caring-community", StringComparison.OrdinalIgnoreCase)
                || item.Template.StartsWith("api/caring-community/", StringComparison.OrdinalIgnoreCase))
            .Select(item => new
            {
                item.Selector,
                Alias = "api/v2/caring-community" + item.Template["api/caring-community".Length..]
            })
            .DistinctBy(item => item.Alias, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var item in aliases)
        {
            AddControllerAlias(controller, existingRoutes, item.Selector, item.Alias!);
        }
    }

    private static void AddSimpleV2ControllerAliases(ControllerModel controller, ISet<string> existingRoutes)
    {
        var aliases = controller.Selectors
            .Select(selector => new { Selector = selector, Alias = ToSimpleV2Alias(selector.AttributeRouteModel?.Template) })
            .Where(item => item.Alias is not null)
            .Select(item => new { item.Selector, Alias = Normalize(item.Alias) })
            .DistinctBy(item => item.Alias, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var item in aliases)
        {
            AddControllerAlias(controller, existingRoutes, item.Selector, item.Alias!);
        }
    }

    private static bool IsAliasedAdminPrefix(string template) =>
        AliasedPrefixes.Any(prefix =>
            template.Equals(prefix, StringComparison.OrdinalIgnoreCase)
            || template.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase));

    private static string ToV2AdminAlias(string template) =>
        "api/v2/admin/" + template["api/admin/".Length..];

    private static string? ToUsersMeV2Alias(string? template)
    {
        var normalized = Normalize(template);
        return normalized.StartsWith("api/users/me", StringComparison.OrdinalIgnoreCase)
            ? "/api/v2/users/me" + normalized["api/users/me".Length..]
            : null;
    }

    private static string? ToGroupsV2Alias(string? template)
    {
        var normalized = Normalize(template);
        return normalized.StartsWith("api/groups", StringComparison.OrdinalIgnoreCase)
            ? "/api/v2/groups" + normalized["api/groups".Length..]
            : null;
    }

    private static string? ToJobsV2Alias(string? template)
    {
        var normalized = Normalize(template);
        return normalized.StartsWith("api/jobs", StringComparison.OrdinalIgnoreCase)
            ? "/api/v2/jobs" + normalized["api/jobs".Length..]
            : null;
    }

    private static string? ToFederationV2Alias(string? template)
    {
        var normalized = Normalize(template);
        return normalized.StartsWith("api/federation", StringComparison.OrdinalIgnoreCase)
            ? "/api/v2/federation" + normalized["api/federation".Length..]
            : null;
    }

    private static string? ToGoalsV2Alias(string? template)
    {
        var normalized = Normalize(template);
        return normalized.StartsWith("api/goals", StringComparison.OrdinalIgnoreCase)
            ? "/api/v2/goals" + normalized["api/goals".Length..]
            : null;
    }

    private static string? ToIdeationV2Alias(string? template)
    {
        var normalized = Normalize(template);
        if (normalized.StartsWith("api/ideation-challenges", StringComparison.OrdinalIgnoreCase))
        {
            return "/api/v2/ideation-challenges" + normalized["api/ideation-challenges".Length..];
        }

        return normalized.StartsWith("api/ideation-ideas", StringComparison.OrdinalIgnoreCase)
            ? "/api/v2/ideation-ideas" + normalized["api/ideation-ideas".Length..]
            : null;
    }

    private static string? ToCaringCommunityV2Alias(string? template)
    {
        var normalized = Normalize(template);
        return normalized.StartsWith("api/caring-community", StringComparison.OrdinalIgnoreCase)
            ? "/api/v2/caring-community" + normalized["api/caring-community".Length..]
            : null;
    }

    private static string? ToVolunteeringV2Alias(string? template)
    {
        var normalized = Normalize(template);
        return normalized.StartsWith("api/volunteering", StringComparison.OrdinalIgnoreCase)
            ? "/api/v2/volunteering" + normalized["api/volunteering".Length..]
            : null;
    }

    private static string? ToSimpleV2Alias(string? template)
    {
        var normalized = Normalize(template);
        foreach (var prefix in new[]
        {
            "api/stories",
            "api/ads/active",
            "api/appreciations",
            "api/billing/plans",
            "api/categories",
            "api/clubs",
            "api/config",
            "api/users",
            "api/connections",
            "api/exchanges",
            "api/group-collections",
            "api/group-tags",
            "api/group-templates",
            "api/group-chatroom-messages",
            "api/help/faqs",
            "api/identity",
            "api/matches",
            "api/member-premium",
            "api/mentions",
            "api/merchant-onboarding",
            "api/messages",
            "api/municipality",
            "api/newsletter/click",
            "api/newsletter/pixel",
            "api/onboarding",
            "api/pages",
            "api/platform/stats",
            "api/polls",
            "api/pusher/config",
            "api/realtime/config",
            "api/safeguarding/my-preferences",
            "api/search/trending",
            "api/seo",
            "api/members",
            "api/kb",
            "api/bookmarks",
            "api/bookmark-collections",
            "api/gamification",
            "api/ads/impression",
            "api/ideation-categories",
            "api/ideation-comments",
            "api/ideation-media",
            "api/ideation-tags",
            "api/legal",
            "api/link-preview",
            "api/newsletter/unsubscribe",
            "api/reactions",
            "api/reviews",
            "api/shares",
            "api/me/collections",
            "api/me/saved-items",
            "api/me/push-campaigns",
            "api/me/ad-campaigns",
            "api/me/verein-dues",
            "api/me/fadp",
            "api/me/residency-verification",
            "api/me/verein-invitations",
            "api/comments",
            "api/skills",
            "api/group-chatrooms",
            "api/team-tasks",
            "api/team-documents",
            "api/skills/categories",
            "api/search/saved",
            "api/ideation-campaigns",
            "api/ideation-templates",
            "api/auth/2fa",
            "api/admin/reports",
            "api/admin/crm",
            "api/admin/feed",
            "api/admin/pages",
            "api/admin/federation",
            "api/admin/sso",
            "api/admin/gamification",
            "api/admin/audit-log",
            "api/admin/groups",
            "api/admin/identity",
            "api/admin/enterprise",
            "api/admin/matching",
            "api/admin/moderation",
            "api/admin/subscriptions",
            "api/admin/tools",
            "api/admin/polls",
            "api/admin/resources",
            "api/admin/goals",
            "api/admin/ideation",
            "api/admin/events",
            "api/admin/members",
            "api/community/stats",
            "api/csrf-token",
            "api/donations",
            "api/ideation-outcomes",
            "api/me/appreciations",
            "api/me/stats",
            "api/contact",
            "api/pilot-inquiry",
            "api/safeguarding/revoke",
            "api/ugc-translate",
            "api/webhooks"
        })
        {
            if (normalized.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return "/api/v2/" + normalized["api/".Length..];
            }
        }

        return null;
    }

    /// <summary>
    /// Adds a controller-level <c>/api/v2</c> alias that keeps the source
    /// selector's endpoint metadata.
    ///
    /// 🔴 Copying the selector is the whole point — do not "simplify" this back
    /// to <c>new SelectorModel { AttributeRouteModel = … }</c>.
    ///
    /// Under endpoint routing a controller-level <c>[Authorize]</c> is not a
    /// filter. <c>AuthorizationApplicationModelProvider</c> only registers an
    /// <c>AuthorizeFilter</c> when <c>EnableEndpointRouting</c> is false; on the
    /// default path the attribute is carried as ENDPOINT METADATA on the
    /// controller's selector, and each action descriptor inherits it from the
    /// controller selector it was built from. A hand-made selector starts with
    /// an empty metadata collection, so the alias route it produces has no
    /// <c>IAuthorizeData</c> at all and <c>AuthorizationMiddleware</c> never
    /// challenges.
    ///
    /// The effect is not a cosmetic status-code difference. It is anonymous
    /// execution of the action body. Measured on the running API before this
    /// fix:
    ///
    /// <code>
    /// GET /api/caring-community/sub-regions      → 401 (no endpoint executed)
    /// GET /api/v2/caring-community/sub-regions   → 403 FEATURE_DISABLED
    ///     …"Executing endpoint CaringCommunitySubRegionsController.Index"
    /// </code>
    ///
    /// The alias reached the controller body with no user. It returned 403
    /// rather than data only because <c>caring_community</c> happened to be
    /// switched off for that tenant — with the feature on, the same anonymous
    /// request would have been served the tenant's sub-regions. Laravel answers
    /// 401 on both paths.
    ///
    /// It was invisible because the action-level alias helpers in this same file
    /// have always used <c>new SelectorModel(source)</c> and are therefore
    /// correct, so most aliases behaved. Only controllers that carry their route
    /// AND their <c>[Authorize]</c> at CONTROLLER level were exposed, and route
    /// inventories counted the alias as present either way.
    /// </summary>
    private static void AddControllerAlias(
        ControllerModel controller,
        ISet<string> existingRoutes,
        SelectorModel source,
        string alias)
    {
        if (HasRoute(controller.Selectors, alias))
        {
            return;
        }

        // The route model is deliberately fresh rather than copied: an alias
        // must not inherit the source route's Name, or two endpoints would
        // share one attribute-route name with different templates.
        controller.Selectors.Add(new SelectorModel(source)
        {
            AttributeRouteModel = new AttributeRouteModel
            {
                Template = alias
            }
        });

        existingRoutes.Add(Normalize(alias));
    }

    private static bool HasRoute(IList<SelectorModel> selectors, string template) =>
        selectors.Any(selector =>
            string.Equals(
                Normalize(selector.AttributeRouteModel?.Template),
                Normalize(template),
                StringComparison.OrdinalIgnoreCase));

    private static string Normalize(string? template) =>
        (template ?? string.Empty).Trim().TrimStart('/');

    private static bool HasExistingActionRoute(ISet<string> existingRoutes, SelectorModel sourceSelector, string alias) =>
        RouteKeys(sourceSelector, alias).Any(existingRoutes.Contains)
        || existingRoutes.Contains(RouteKey("*", alias));

    private static IEnumerable<string> ApplicationRouteKeys(ApplicationModel application)
    {
        foreach (var controller in application.Controllers)
        {
            foreach (var selector in controller.Selectors)
            {
                foreach (var key in RouteKeys(selector))
                {
                    yield return key;
                }
            }

            foreach (var action in controller.Actions)
            {
                foreach (var actionSelector in action.Selectors)
                {
                    if (controller.Selectors.Count == 0)
                    {
                        foreach (var key in RouteKeys(actionSelector))
                        {
                            yield return key;
                        }

                        continue;
                    }

                    foreach (var controllerSelector in controller.Selectors)
                    {
                        var combined = AttributeRouteModel.CombineAttributeRouteModel(
                            controllerSelector.AttributeRouteModel,
                            actionSelector.AttributeRouteModel);
                        foreach (var key in RouteKeys(actionSelector, combined?.Template))
                        {
                            yield return key;
                        }
                    }
                }
            }
        }
    }

    private static IEnumerable<string> RouteKeys(SelectorModel selector) =>
        RouteKeys(selector, selector.AttributeRouteModel?.Template);

    private static IEnumerable<string> RouteKeys(SelectorModel selector, string? template)
    {
        var normalized = Normalize(template);
        if (normalized.Length == 0)
        {
            yield break;
        }

        var methods = selector.ActionConstraints
            .OfType<HttpMethodActionConstraint>()
            .SelectMany(constraint => constraint.HttpMethods)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (methods.Length == 0)
        {
            yield return RouteKey("*", normalized);
            yield break;
        }

        foreach (var method in methods)
        {
            yield return RouteKey(method, normalized);
        }
    }

    private static void AddRouteKeys(ISet<string> existingRoutes, SelectorModel selector)
    {
        foreach (var key in RouteKeys(selector))
        {
            existingRoutes.Add(key);
        }
    }

    private static string RouteKey(string method, string? template) =>
        $"{method.ToUpperInvariant()} {Normalize(template)}";
}
