// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for webauthn.ts
 *
 * Covers: feature detection, platform detection, registration flow,
 * authentication flow, conditional mediation, credential management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// ─── Mocks (must be hoisted before imports) ─────────────────────────────────────────────

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  platformAuthenticatorIsAvailable: vi.fn(),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────────────────────

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";

import { api } from "@/lib/api";

import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  isBiometricAvailable,
  detectPlatform,
  registerBiometric,
  authenticateWithBiometric,
  isConditionalMediationAvailable,
  startConditionalAuthentication,
  getWebAuthnStatus,
  getWebAuthnCredentials,
  confirmWebAuthnSecurity,
  removeWebAuthnCredential,
  renameWebAuthnCredential,
  removeAllWebAuthnCredentials,
} from "./webauthn";

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

const mockBrowserSupports = browserSupportsWebAuthn as Mock;
const mockPlatformAvailable = platformAuthenticatorIsAvailable as Mock;
const mockStartRegistration = startRegistration as Mock;
const mockStartAuthentication = startAuthentication as Mock;
const mockCancelCeremony = WebAuthnAbortService.cancelCeremony as Mock;
const mockApiGet = api.get as Mock;
const mockApiPost = api.post as Mock;

const MOCK_CHALLENGE_DATA = {
  challenge: "base64-challenge",
  challenge_id: "chal-123",
  rp: { name: "Project NEXUS", id: "project-nexus.ie" },
  user: { id: "user-1", name: "test@example.com", displayName: "Test User" },
  pubKeyCredParams: [{ type: "public-key" as const, alg: -7 }],
  authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
  timeout: 60000,
  attestation: "none",
  excludeCredentials: [],
};

const MOCK_CREDENTIAL = {
  id: "cred-id-abc",
  rawId: "cred-raw-id",
  type: "public-key" as const,
  response: {
    clientDataJSON: "base64-client-data",
    attestationObject: "base64-attestation",
  },
  authenticatorAttachment: "platform" as const,
  clientExtensionResults: {},
};

const MOCK_AUTH_CHALLENGE = {
  challenge: "auth-challenge-base64",
  challenge_id: "chal-456",
  rpId: "project-nexus.ie",
  timeout: 60000,
  userVerification: "preferred",
  allowCredentials: [{ type: "public-key" as const, id: "cred-id-abc" }],
};

const MOCK_ASSERTION = {
  id: "cred-id-abc",
  rawId: "cred-raw-id",
  type: "public-key" as const,
  response: {
    clientDataJSON: "base64-client-data",
    authenticatorData: "base64-auth-data",
    signature: "base64-sig",
  },
  authenticatorAttachment: "platform" as const,
  clientExtensionResults: {},
};

const MOCK_AUTH_RESULT = {
  user: { id: 1, first_name: "Test", last_name: "User", email: "test@example.com" },
  access_token: "token-abc",
  refresh_token: "refresh-abc",
  expires_in: 3600,
};

// Reset all mocks before every test (clears mockResolvedValueOnce queues)
beforeEach(() => { vi.resetAllMocks(); });

// -------- Feature Detection

describe("isWebAuthnSupported", () => {
  it("returns true when browser supports WebAuthn", () => {
    mockBrowserSupports.mockReturnValue(true);
    expect(isWebAuthnSupported()).toBe(true);
  });

  it("returns false when browser does not support WebAuthn", () => {
    mockBrowserSupports.mockReturnValue(false);
    expect(isWebAuthnSupported()).toBe(false);
  });
});

describe("isPlatformAuthenticatorAvailable", () => {
  it("returns false immediately when WebAuthn not supported", async () => {
    mockBrowserSupports.mockReturnValue(false);
    expect(await isPlatformAuthenticatorAvailable()).toBe(false);
    expect(mockPlatformAvailable).not.toHaveBeenCalled();
  });

  it("delegates to platformAuthenticatorIsAvailable when supported", async () => {
    mockBrowserSupports.mockReturnValue(true);
    mockPlatformAvailable.mockResolvedValue(true);
    expect(await isPlatformAuthenticatorAvailable()).toBe(true);
  });

  it("returns false when platform authenticator not available", async () => {
    mockBrowserSupports.mockReturnValue(true);
    mockPlatformAvailable.mockResolvedValue(false);
    expect(await isPlatformAuthenticatorAvailable()).toBe(false);
  });
});

describe("isBiometricAvailable", () => {
  it("returns false when WebAuthn not supported", async () => {
    mockBrowserSupports.mockReturnValue(false);
    expect(await isBiometricAvailable()).toBe(false);
  });

  it("returns true for ordinary WebAuthn even without a platform authenticator", async () => {
    mockBrowserSupports.mockReturnValue(true);
    mockPlatformAvailable.mockResolvedValue(false);
    expect(await isBiometricAvailable()).toBe(true);
    expect(mockPlatformAvailable).not.toHaveBeenCalled();
  });
});

// -------- Platform Detection

describe("detectPlatform", () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { value: originalUserAgent, configurable: true });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
  });

  function setUA(ua: string) {
    Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  }

  it("detects iPhone", () => { setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"); expect(detectPlatform()).toBe("iphone"); });
  it("detects iPad (explicit UA)", () => { setUA("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"); expect(detectPlatform()).toBe("ipad"); });
  it("detects iPad (macOS + touch)", () => { setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"); Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true }); expect(detectPlatform()).toBe("ipad"); });
  it("detects Android", () => { setUA("Mozilla/5.0 (Linux; Android 14; Pixel 8)"); expect(detectPlatform()).toBe("android"); });
  it("detects Windows", () => { setUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"); expect(detectPlatform()).toBe("windows"); });
  it("detects Mac", () => { setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"); expect(detectPlatform()).toBe("mac"); });
  it("detects Linux", () => { setUA("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"); expect(detectPlatform()).toBe("linux"); });
  it("returns unknown for unrecognised UA", () => { setUA("SomeWeirdBot/1.0"); expect(detectPlatform()).toBe("unknown"); });
});

// -------- Registration

describe("registerBiometric", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", configurable: true });
  });

  it("returns success on happy path", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: true });
    mockStartRegistration.mockResolvedValue(MOCK_CREDENTIAL);
    const result = await registerBiometric("My PC", "platform");
    expect(result).toEqual({ success: true });
  });

  it("passes device name to verify endpoint", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: true });
    mockStartRegistration.mockResolvedValue(MOCK_CREDENTIAL);
    await registerBiometric("Custom Name", "platform");
    expect(mockApiPost.mock.calls[1][1]).toMatchObject({ device_name: "Custom Name" });
  });

  it("passes the security confirmation token to both registration steps", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: true });
    mockStartRegistration.mockResolvedValue(MOCK_CREDENTIAL);

    await registerBiometric("Custom Name", "platform", "security-token");

    expect(mockApiPost.mock.calls[0][1]).toEqual({ security_confirmation_token: "security-token" });
    expect(mockApiPost.mock.calls[1][1]).toMatchObject({ security_confirmation_token: "security-token" });
  });

  it("does not persist an untranslated device name when none is supplied", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: true });
    mockStartRegistration.mockResolvedValue(MOCK_CREDENTIAL);
    await registerBiometric(undefined, "platform");
    expect(mockApiPost.mock.calls[1][1]).not.toHaveProperty("device_name");
  });

  it("sets hints=[client-device] for platform attachment", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: true });
    mockStartRegistration.mockResolvedValue(MOCK_CREDENTIAL);
    await registerBiometric("PC", "platform");
    const opts = mockStartRegistration.mock.calls[0][0].optionsJSON;
    expect(opts.hints).toEqual(["client-device"]);
  });

  it("sets hints=[hybrid,security-key] for cross-platform attachment", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: true });
    mockStartRegistration.mockResolvedValue(MOCK_CREDENTIAL);
    await registerBiometric("Key", "cross-platform");
    const opts = mockStartRegistration.mock.calls[0][0].optionsJSON;
    expect(opts.hints).toEqual(["hybrid", "security-key"]);
  });

  it("sets no hints when attachment is undefined", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: true });
    mockStartRegistration.mockResolvedValue(MOCK_CREDENTIAL);
    await registerBiometric("PC");
    const opts = mockStartRegistration.mock.calls[0][0].optionsJSON;
    expect(opts.hints).toBeUndefined();
  });

  it("returns error when challenge request fails", async () => {
    mockApiPost.mockResolvedValueOnce({ success: false, error: "Server error" });
    const result = await registerBiometric();
    expect(result).toEqual({ success: false, error: "Server error" });
  });

  it("returns error when challenge returns no data", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: null });
    const result = await registerBiometric();
    expect(result.success).toBe(false);
  });

  it("returns error when verify step fails", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: false, error: "Invalid credential" });
    mockStartRegistration.mockResolvedValue(MOCK_CREDENTIAL);
    const result = await registerBiometric();
    expect(result).toEqual({ success: false, error: "Invalid credential" });
  });

  it("respects cancellation without opening a second platform registration prompt", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA }).mockResolvedValueOnce({ success: true });
    mockStartRegistration.mockRejectedValueOnce(new Error("NotAllowedError: operation not allowed")).mockResolvedValueOnce(MOCK_CREDENTIAL);
    const result = await registerBiometric("PC", "platform");
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('cancelled');
    expect(mockStartRegistration).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on NotAllowedError with cross-platform attachment", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA });
    mockStartRegistration.mockRejectedValueOnce(new Error("NotAllowedError: not allowed"));
    const result = await registerBiometric("Key", "cross-platform");
    expect(result.success).toBe(false);
    expect(mockStartRegistration).toHaveBeenCalledTimes(1);
  });

  it("treats user cancellation as cancelled error", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA });
    mockStartRegistration.mockRejectedValueOnce(new Error("The operation was cancelled"));
    const result = await registerBiometric("PC", "platform");
    expect(result).toEqual({ success: false, error: "Biometric registration was cancelled.", errorCode: "cancelled" });
  });

  it("treats denied as cancelled error", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA });
    mockStartRegistration.mockRejectedValueOnce(new Error("User denied the request"));
    const result = await registerBiometric();
    expect(result).toEqual({ success: false, error: "Biometric registration was cancelled.", errorCode: "cancelled" });
  });

  it("classifies SimpleWebAuthn ERROR_INVALID_RP_ID as domain_not_allowed", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA });
    const rpIdError = Object.assign(new Error('The RP ID "project-nexus.ie" is invalid for this domain'), {
      code: "ERROR_INVALID_RP_ID",
    });
    mockStartRegistration.mockRejectedValueOnce(rpIdError);
    const result = await registerBiometric();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("domain_not_allowed");
  });

  it("classifies NotAllowedError carried on error.cause as cancelled", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA });
    const cause = new Error("The operation either timed out or was not allowed");
    cause.name = "NotAllowedError";
    const wrapped = Object.assign(new Error("Registration failed"), {
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause,
    });
    mockStartRegistration.mockRejectedValueOnce(wrapped);
    const result = await registerBiometric();
    expect(result.errorCode).toBe("cancelled");
  });

  it("returns generic error message for unknown errors", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA });
    mockStartRegistration.mockRejectedValueOnce(new Error("Some unknown failure"));
    const result = await registerBiometric();
    expect(result).toEqual({ success: false, error: "Some unknown failure", errorCode: "unknown" });
  });

  it("returns fallback message for non-Error throws", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_CHALLENGE_DATA });
    mockStartRegistration.mockRejectedValueOnce("string error");
    const result = await registerBiometric();
    expect(result).toEqual({ success: false, error: "Biometric registration failed", errorCode: "unknown" });
  });
});

// -------- Authentication

describe("authenticateWithBiometric", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns success with user data on happy path", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE }).mockResolvedValueOnce({ success: true, data: MOCK_AUTH_RESULT });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);
    const result = await authenticateWithBiometric("test@example.com");
    expect(result).toEqual({ success: true, data: MOCK_AUTH_RESULT });
  });

  it("does not disclose the email in the public challenge request", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE }).mockResolvedValueOnce({ success: true, data: MOCK_AUTH_RESULT });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);
    await authenticateWithBiometric("user@test.com");
    expect(mockApiPost.mock.calls[0][1]).toEqual({});
  });

  it("maps allowCredentials to SimpleWebAuthn format", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE }).mockResolvedValueOnce({ success: true, data: MOCK_AUTH_RESULT });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);
    await authenticateWithBiometric();
    const opts = mockStartAuthentication.mock.calls[0][0].optionsJSON;
    expect(opts.allowCredentials).toEqual([{ id: "cred-id-abc", type: "public-key" }]);
  });

  it("returns error when challenge request fails", async () => {
    mockApiPost.mockResolvedValueOnce({ success: false, error: "Unauthorised", code: "FEATURE_DISABLED" });
    const result = await authenticateWithBiometric();
    expect(result).toEqual({ success: false, error: "Unauthorised", errorCode: "FEATURE_DISABLED" });
  });

  it("returns error when verify step fails", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE }).mockResolvedValueOnce({ success: false, error: "Signature invalid" });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);
    const result = await authenticateWithBiometric();
    expect(result).toEqual({ success: false, error: "Signature invalid" });
  });

  it("returns cancelled error on NotAllowedError", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockRejectedValueOnce(new Error("NotAllowedError: not allowed"));
    const result = await authenticateWithBiometric();
    expect(result).toEqual({ success: false, error: "Biometric login was cancelled.", errorCode: "cancelled" });
  });

  it("returns cancelled error on cancelled message", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockRejectedValueOnce(new Error("The operation was cancelled"));
    const result = await authenticateWithBiometric();
    expect(result).toEqual({ success: false, error: "Biometric login was cancelled.", errorCode: "cancelled" });
  });

  it("classifies SimpleWebAuthn ERROR_INVALID_RP_ID as domain_not_allowed", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    const rpIdError = Object.assign(new Error('The RP ID "project-nexus.ie" is invalid for this domain'), {
      code: "ERROR_INVALID_RP_ID",
    });
    mockStartAuthentication.mockRejectedValueOnce(rpIdError);
    const result = await authenticateWithBiometric();
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("domain_not_allowed");
  });

  it("returns generic error for unknown failures", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockRejectedValueOnce(new Error("Hardware failure"));
    const result = await authenticateWithBiometric();
    expect(result).toEqual({ success: false, error: "Hardware failure", errorCode: "unknown" });
  });

  it("cancels an explicit browser ceremony through the caller signal", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    let rejectGet!: (error: Error) => void;
    mockStartAuthentication.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectGet = reject; }),
    );
    const controller = new AbortController();
    const pending = authenticateWithBiometric(undefined, controller.signal);
    await vi.waitFor(() => expect(mockStartAuthentication).toHaveBeenCalled());

    controller.abort();
    expect(mockCancelCeremony).toHaveBeenCalledTimes(1);
    rejectGet(new DOMException("Aborted", "AbortError"));
    await expect(pending).resolves.toMatchObject({ success: false, errorCode: "cancelled" });
  });

  it("does not return tokens when aborted during verification", async () => {
    const controller = new AbortController();
    mockApiPost
      .mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE })
      .mockImplementationOnce(async () => {
        controller.abort();
        return { success: true, data: MOCK_AUTH_RESULT };
      });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);

    expect(await authenticateWithBiometric(undefined, controller.signal)).toEqual({
      success: false,
      errorCode: "cancelled",
    });
  });
});

// -------- Conditional Mediation

describe("isConditionalMediationAvailable", () => {
  it("returns false when WebAuthn not supported", async () => {
    mockBrowserSupports.mockReturnValue(false);
    expect(await isConditionalMediationAvailable()).toBe(false);
  });

  it("returns false when PublicKeyCredential is undefined", async () => {
    mockBrowserSupports.mockReturnValue(true);
    const orig = (globalThis as Record<string, unknown>).PublicKeyCredential;
    (globalThis as Record<string, unknown>).PublicKeyCredential = undefined;
    expect(await isConditionalMediationAvailable()).toBe(false);
    (globalThis as Record<string, unknown>).PublicKeyCredential = orig;
  });

  it("returns false when isConditionalMediationAvailable is not a function", async () => {
    mockBrowserSupports.mockReturnValue(true);
    const orig = (globalThis as Record<string, unknown>).PublicKeyCredential;
    (globalThis as Record<string, unknown>).PublicKeyCredential = {};
    expect(await isConditionalMediationAvailable()).toBe(false);
    (globalThis as Record<string, unknown>).PublicKeyCredential = orig;
  });

  it("returns true when API reports available", async () => {
    mockBrowserSupports.mockReturnValue(true);
    (globalThis as Record<string, unknown>).PublicKeyCredential = { isConditionalMediationAvailable: vi.fn().mockResolvedValue(true) };
    expect(await isConditionalMediationAvailable()).toBe(true);
  });

  it("returns false when API throws", async () => {
    mockBrowserSupports.mockReturnValue(true);
    (globalThis as Record<string, unknown>).PublicKeyCredential = { isConditionalMediationAvailable: vi.fn().mockRejectedValue(new Error("Not supported")) };
    expect(await isConditionalMediationAvailable()).toBe(false);
  });
});

describe("startConditionalAuthentication", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns null when challenge request fails", async () => {
    mockApiPost.mockResolvedValueOnce({ success: false });
    expect(await startConditionalAuthentication()).toBeNull();
  });

  it("returns null when challenge returns no data", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: null });
    expect(await startConditionalAuthentication()).toBeNull();
  });

  it("starts authentication with useBrowserAutofill=true", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE }).mockResolvedValueOnce({ success: true, data: MOCK_AUTH_RESULT });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);
    await startConditionalAuthentication();
    expect(mockStartAuthentication).toHaveBeenCalledWith(expect.objectContaining({ useBrowserAutofill: true }));
  });

  it("returns success result on happy path", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE }).mockResolvedValueOnce({ success: true, data: MOCK_AUTH_RESULT });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);
    const result = await startConditionalAuthentication();
    expect(result).toEqual({ success: true, data: MOCK_AUTH_RESULT });
  });

  it("returns null when abort signal is already aborted", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE }).mockResolvedValueOnce({ success: true, data: MOCK_AUTH_RESULT });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);
    const controller = new AbortController();
    controller.abort();
    expect(await startConditionalAuthentication(controller.signal)).toBeNull();
  });

  it("returns null on AbortError", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    expect(await startConditionalAuthentication()).toBeNull();
  });

  it("returns null on NotAllowedError", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockRejectedValueOnce(new Error("NotAllowedError"));
    expect(await startConditionalAuthentication()).toBeNull();
  });

  it("returns null on generic errors (silent failure)", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockRejectedValueOnce(new Error("Some hardware error"));
    expect(await startConditionalAuthentication()).toBeNull();
  });

  it("returns error shape when verify fails", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE }).mockResolvedValueOnce({ success: false, error: "Verification failed" });
    mockStartAuthentication.mockResolvedValue(MOCK_ASSERTION);
    const result = await startConditionalAuthentication();
    expect(result).toEqual({ success: false, error: "Verification failed" });
  });

  // The page's AbortController must reach the actual browser ceremony.
  // Pre-fix, the signal was only checked AFTER the assertion resolved, so a
  // pending navigator.credentials.get() leaked past unmount for the life of
  // the document (the cause of stray native passkey dialogs).
  it("cancels the pending browser ceremony when the signal aborts mid-request", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    let rejectGet!: (e: Error) => void;
    mockStartAuthentication.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectGet = reject; }),
    );
    const controller = new AbortController();
    const pending = startConditionalAuthentication(controller.signal);
    await vi.waitFor(() => expect(mockStartAuthentication).toHaveBeenCalled());

    controller.abort();
    expect(mockCancelCeremony).toHaveBeenCalledTimes(1);

    // The cancelled ceremony rejects with AbortError → resolves to null
    rejectGet(new DOMException("Aborted", "AbortError"));
    expect(await pending).toBeNull();
  });

  it("does not start a credential request when the signal aborts during the challenge fetch", async () => {
    const controller = new AbortController();
    mockApiPost.mockImplementationOnce(async () => {
      controller.abort();
      return { success: true, data: MOCK_AUTH_CHALLENGE };
    });
    expect(await startConditionalAuthentication(controller.signal)).toBeNull();
    expect(mockStartAuthentication).not.toHaveBeenCalled();
  });

  it("cancels pending conditional auth even when the explicit challenge fetch fails", async () => {
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    void startConditionalAuthentication(controller.signal);
    await vi.waitFor(() => expect(mockStartAuthentication).toHaveBeenCalledTimes(1));

    mockApiPost.mockResolvedValueOnce({ success: false, code: "AUTH_WEBAUTHN_UNAVAILABLE" });
    const result = await authenticateWithBiometric("user@example.com");

    expect(result.errorCode).toBe("AUTH_WEBAUTHN_UNAVAILABLE");
    expect(mockCancelCeremony).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(mockCancelCeremony).toHaveBeenCalledTimes(1);
  });

  it("cancels conditional auth immediately and ignores its stale unmount after modal takeover", async () => {
    // Conditional request pending…
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    void startConditionalAuthentication(controller.signal);
    await vi.waitFor(() => expect(mockStartAuthentication).toHaveBeenCalledTimes(1));

    // …then the user clicks the explicit passkey button (modal ceremony)
    mockApiPost.mockResolvedValueOnce({ success: true, data: MOCK_AUTH_CHALLENGE });
    mockStartAuthentication.mockImplementationOnce(() => new Promise(() => {}));
    void authenticateWithBiometric("user@example.com");
    await vi.waitFor(() => expect(mockStartAuthentication).toHaveBeenCalledTimes(2));
    expect(mockCancelCeremony).toHaveBeenCalledTimes(1);

    // The login page unmounting now must NOT cancel the user's modal ceremony
    controller.abort();
    expect(mockCancelCeremony).toHaveBeenCalledTimes(1);
  });
});

// -------- Credential Management

describe("getWebAuthnStatus", () => {
  it("returns status from API", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { registered: true, count: 2 } });
    const result = await getWebAuthnStatus();
    expect(result).toEqual({ registered: true, count: 2 });
    expect(mockApiGet).toHaveBeenCalledWith("/webauthn/status");
  });

  it("returns default when API returns no data", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: null });
    const result = await getWebAuthnStatus();
    expect(result).toEqual({ registered: false, count: 0 });
  });
});

describe("getWebAuthnCredentials", () => {
  it("returns credentials array from API", async () => {
    const creds = [{
      credential_id: "cred-1",
      device_name: "Windows PC",
      authenticator_type: "platform",
      created_at: "2026-01-01T00:00:00Z",
      last_used_at: "2026-03-01T00:00:00Z",
      rp_id: "hour-timebank.ie",
      backup_eligible: true,
      backup_state: true,
      user_verified: true,
    }];
    mockApiGet.mockResolvedValue({ success: true, data: { credentials: creds, count: 1 } });
    const result = await getWebAuthnCredentials();
    expect(result).toEqual(creds);
    expect(mockApiGet).toHaveBeenCalledWith("/webauthn/credentials");
  });

  it("returns empty array when API returns no data", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: null });
    expect(await getWebAuthnCredentials()).toEqual([]);
  });

  it("returns empty array when credentials key missing", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { count: 0 } });
    expect(await getWebAuthnCredentials()).toEqual([]);
  });

  it("throws on a resolved API failure so settings can show a retry state", async () => {
    mockApiGet.mockResolvedValue({ success: false, code: "FEATURE_DISABLED" });
    await expect(getWebAuthnCredentials()).rejects.toThrow("FEATURE_DISABLED");
  });
});

describe("confirmWebAuthnSecurity", () => {
  it("returns a short-lived security confirmation token", async () => {
    mockApiPost.mockResolvedValue({
      success: true,
      data: { security_confirmation_token: "security-token", expires_in: 300 },
    });

    expect(await confirmWebAuthnSecurity({ current_password: "secret" })).toEqual({
      success: true,
      securityConfirmationToken: "security-token",
      expiresIn: 300,
      errorCode: undefined,
      error: undefined,
    });
    expect(mockApiPost).toHaveBeenCalledWith("/webauthn/security-confirm", {
      current_password: "secret",
    });
  });
});

describe("removeWebAuthnCredential", () => {
  it("returns a successful result", async () => {
    mockApiPost.mockResolvedValue({ success: true });
    expect(await removeWebAuthnCredential("cred-1")).toEqual({
      success: true,
      errorCode: undefined,
      error: undefined,
    });
    expect(mockApiPost).toHaveBeenCalledWith("/webauthn/remove", { credential_id: "cred-1" });
  });

  it("preserves the API error code on failure", async () => {
    mockApiPost.mockResolvedValue({ success: false, code: "LAST_SIGN_IN_METHOD", error: "Blocked" });
    expect(await removeWebAuthnCredential("cred-1")).toEqual({
      success: false,
      errorCode: "LAST_SIGN_IN_METHOD",
      error: "Blocked",
    });
  });

  it("passes confirmation and exposes session revocation", async () => {
    mockApiPost.mockResolvedValue({ success: true, data: { sessions_revoked: true } });
    expect(await removeWebAuthnCredential("cred-1", "security-token")).toMatchObject({
      success: true,
      sessionsRevoked: true,
    });
    expect(mockApiPost).toHaveBeenCalledWith("/webauthn/remove", {
      credential_id: "cred-1",
      security_confirmation_token: "security-token",
    });
  });
});

describe("renameWebAuthnCredential", () => {
  it("returns a structured success", async () => {
    mockApiPost.mockResolvedValue({ success: true });
    expect(await renameWebAuthnCredential("cred-1", "My YubiKey")).toEqual({
      success: true,
      errorCode: undefined,
      error: undefined,
    });
    expect(mockApiPost).toHaveBeenCalledWith("/webauthn/rename", { credential_id: "cred-1", device_name: "My YubiKey" });
  });

  it("preserves the API error on failure", async () => {
    mockApiPost.mockResolvedValue({ success: false, code: "SECURITY_CONFIRMATION_REQUIRED", error: "Denied" });
    expect(await renameWebAuthnCredential("cred-1", "My YubiKey")).toEqual({
      success: false,
      errorCode: "SECURITY_CONFIRMATION_REQUIRED",
      error: "Denied",
    });
  });

  it("passes the security confirmation token", async () => {
    mockApiPost.mockResolvedValue({ success: true });
    await renameWebAuthnCredential("cred-1", "My YubiKey", "security-token");
    expect(mockApiPost).toHaveBeenCalledWith("/webauthn/rename", {
      credential_id: "cred-1",
      device_name: "My YubiKey",
      security_confirmation_token: "security-token",
    });
  });
});

describe("removeAllWebAuthnCredentials", () => {
  it("returns success with removed count", async () => {
    mockApiPost.mockResolvedValue({ success: true, data: { removed_count: 3 } });
    const result = await removeAllWebAuthnCredentials();
    expect(result).toEqual({ success: true, removedCount: 3, errorCode: undefined, error: undefined });
    expect(mockApiPost).toHaveBeenCalledWith("/webauthn/remove-all", {});
  });

  it("returns 0 count when API returns no data", async () => {
    mockApiPost.mockResolvedValue({ success: true, data: null });
    expect(await removeAllWebAuthnCredentials()).toEqual({ success: true, removedCount: 0, errorCode: undefined, error: undefined });
  });

  it("returns failure on API error", async () => {
    mockApiPost.mockResolvedValue({ success: false, data: null, code: "LAST_SIGN_IN_METHOD" });
    expect(await removeAllWebAuthnCredentials()).toEqual({
      success: false,
      removedCount: 0,
      errorCode: "LAST_SIGN_IN_METHOD",
      error: undefined,
    });
  });

  it("passes confirmation and exposes session revocation", async () => {
    mockApiPost.mockResolvedValue({
      success: true,
      data: { removed_count: 2, sessions_revoked: true },
    });
    expect(await removeAllWebAuthnCredentials("security-token")).toMatchObject({
      success: true,
      removedCount: 2,
      sessionsRevoked: true,
    });
    expect(mockApiPost).toHaveBeenCalledWith("/webauthn/remove-all", {
      security_confirmation_token: "security-token",
    });
  });
});
