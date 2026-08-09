// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Entities;

namespace Nexus.Api.Services.Registration;

/// <summary>
/// Resolves the correct identity verification provider adapter by type.
/// All providers are registered in DI and resolved here by VerificationProvider enum.
/// </summary>
public class IdentityVerificationProviderFactory
{
    private readonly Dictionary<VerificationProvider, IIdentityVerificationProvider> _providers;

    public IdentityVerificationProviderFactory(IEnumerable<IIdentityVerificationProvider> providers)
    {
        _providers = providers.ToDictionary(p => p.ProviderType);
    }

    public IIdentityVerificationProvider GetProvider(VerificationProvider providerType)
    {
        if (_providers.TryGetValue(providerType, out var provider))
            return provider;

        throw new InvalidOperationException(
            $"No identity verification provider registered for type '{providerType}'.");
    }

    public bool IsProviderRegistered(VerificationProvider providerType)
        => _providers.ContainsKey(providerType);

    public IReadOnlyList<VerificationProvider> GetRegisteredProviders()
        => _providers.Keys.ToList();
}
