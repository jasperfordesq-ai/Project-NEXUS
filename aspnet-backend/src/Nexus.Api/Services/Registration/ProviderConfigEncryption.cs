// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;

namespace Nexus.Api.Services.Registration;

/// <summary>
/// Encrypts and decrypts provider configuration (API keys, secrets).
/// Uses AES-256-GCM with a key derived from the application's encryption key.
/// The encryption key must be configured via environment variable or appsettings.
/// </summary>
public class ProviderConfigEncryption
{
    private readonly byte[] _key;
    private readonly ILogger<ProviderConfigEncryption> _logger;

    public ProviderConfigEncryption(IConfiguration config, ILogger<ProviderConfigEncryption> logger)
    {
        _logger = logger;
        var keyString = config["Registration:EncryptionKey"];

        if (string.IsNullOrEmpty(keyString))
        {
            _logger.LogWarning("Registration:EncryptionKey not configured. Provider configs will be stored in plaintext.");
            _key = Array.Empty<byte>();
        }
        else
        {
            // Derive a 256-bit key from the configured string using SHA-256
            _key = SHA256.HashData(Encoding.UTF8.GetBytes(keyString));
        }
    }

    /// <summary>
    /// Returns true if encryption is enabled (key is configured).
    /// </summary>
    public bool IsEnabled => _key.Length == 32;

    /// <summary>
    /// Encrypts a plaintext string. Returns base64-encoded ciphertext.
    /// If encryption is not enabled, returns the plaintext unchanged.
    /// </summary>
    public string Encrypt(string plaintext)
    {
        if (!IsEnabled) return plaintext;

        var plaintextBytes = Encoding.UTF8.GetBytes(plaintext);
        var nonce = new byte[AesGcm.NonceByteSizes.MaxSize]; // 12 bytes
        RandomNumberGenerator.Fill(nonce);

        var ciphertext = new byte[plaintextBytes.Length];
        var tag = new byte[AesGcm.TagByteSizes.MaxSize]; // 16 bytes

        using var aes = new AesGcm(_key, AesGcm.TagByteSizes.MaxSize);
        aes.Encrypt(nonce, plaintextBytes, ciphertext, tag);

        // Format: nonce (12) + tag (16) + ciphertext
        var result = new byte[nonce.Length + tag.Length + ciphertext.Length];
        nonce.CopyTo(result, 0);
        tag.CopyTo(result, nonce.Length);
        ciphertext.CopyTo(result, nonce.Length + tag.Length);

        return Convert.ToBase64String(result);
    }

    /// <summary>
    /// Decrypts a base64-encoded ciphertext string.
    /// If encryption is not enabled, returns the input unchanged.
    /// </summary>
    public string Decrypt(string encryptedBase64)
    {
        if (!IsEnabled) return encryptedBase64;

        byte[] data;
        try
        {
            data = Convert.FromBase64String(encryptedBase64);
        }
        catch (FormatException)
        {
            // Not base64 — probably plaintext from before encryption was enabled
            _logger.LogWarning("Provider config is not base64-encoded — returning as plaintext");
            return encryptedBase64;
        }

        var nonceSize = AesGcm.NonceByteSizes.MaxSize; // 12
        var tagSize = AesGcm.TagByteSizes.MaxSize;      // 16

        if (data.Length < nonceSize + tagSize)
        {
            _logger.LogWarning("Provider config too short to be encrypted — returning as plaintext");
            return encryptedBase64;
        }

        var nonce = data[..nonceSize];
        var tag = data[nonceSize..(nonceSize + tagSize)];
        var ciphertext = data[(nonceSize + tagSize)..];
        var plaintext = new byte[ciphertext.Length];

        using var aes = new AesGcm(_key, AesGcm.TagByteSizes.MaxSize);
        aes.Decrypt(nonce, ciphertext, tag, plaintext);

        return Encoding.UTF8.GetString(plaintext);
    }
}
