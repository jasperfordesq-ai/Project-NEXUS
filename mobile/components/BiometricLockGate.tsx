// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Holds the app closed until the phone proves it is the member — journey 1.6.
 *
 * Protects an existing session when the member enabled the lock. If the sensor or saved
 * preference is unavailable, keep the session locked and offer retry or sign-out.
 *
 * The lock is an OVERLAY: `children` render from the very first frame and the lock is
 * painted on top of them — opaque, absolutely positioned, covering the screen while the
 * check runs as well, because content must never appear before the decision. The
 * navigation tree underneath is mounted throughout, which is the safer shape for anything
 * wrapping a navigator (compare `UpdateRequiredGate`, whose condition is false on the
 * first pass so the navigator always mounts).
 *
 * 🔴 A correction worth keeping, because the wrong version of it cost an hour: this gate
 * was briefly blamed for **breaking the tab bar** after four nightly device flows started
 * failing on assertions made after a tab tap. It was not the cause. The cause was a
 * LogBox error banner — raised by a missing theme variable — sitting over the bottom of the
 * screen and swallowing the tap. Measured on a device: dismiss the banner and the same tap
 * navigates immediately, gate and all. The bisect that pointed here was noise, because
 * whether the banner was up varied between runs.
 *
 * 🔴 It locks on a cold start, not on every return from the background. That is a
 * deliberate scope line for a first version rather than an oversight: "fingerprint
 * sign-in" is about getting in, and re-prompting on every app switch is the fastest way
 * to make a member turn the feature off. Recorded in the ledger as the next step.
 *
 * The escape hatch matters as much as the lock. If the phone's biometrics stop working —
 * a new fingerprint enrolled, a sensor that will not read, a lockout — the member can
 * still sign out from this screen and sign in with their password. Without that, a broken
 * sensor would mean a reinstall.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import {
  authenticate,
  biometricFailureKey,
  isBiometricLockEnabled,
  type BiometricFailure,
} from '@/lib/biometricLock';
import { useAuthContext } from '@/lib/context/AuthContext';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

type GateState = 'checking' | 'locked' | 'open';

export default function BiometricLockGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation(['settings', 'common']);
  const { isAuthenticated, isLoading, sessionRestoreFailed, logout } = useAuthContext();
  const theme = useTheme();
  const primary = usePrimaryColor();

  const [state, setState] = useState<GateState>('checking');
  const [failure, setFailure] = useState<BiometricFailure | null>(null);
  const [isPrompting, setIsPrompting] = useState(false);
  /** One decision per app start. Re-deciding on every auth change would re-lock a member. */
  const decided = useRef(false);

  const unlock = useCallback(async () => {
    setIsPrompting(true);
    const result = await authenticate(t('settings:biometricLock.prompt'));
    setIsPrompting(false);
    if (result.ok) {
      setFailure(null);
      setState('open');
      return;
    }
    setFailure(result.reason ?? 'failed');
  }, [t]);

  /**
   * Nothing stored to protect: never stand in the way of signing in.
   *
   * 🔴 Deliberately its own effect, and deliberately NOT behind `decided.current`. This
   * used to be the first branch of the effect below, which returns early once the one-time
   * decision has been made — so it covered the member who arrives at the app signed out,
   * and missed the member who becomes signed out. Cancelling the fingerprint prompt and
   * tapping Sign out did end the session, but `state` stayed `locked` and the opaque
   * overlay went on covering the login form underneath it. The escape hatch led nowhere:
   * the one member it exists for — whose sensor has stopped reading — could not reach the
   * password field, and a reinstall was the only way back in.
   *
   * Losing a session must open the gate at ANY point in the app's life, not only at the
   * start of it.
   */
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    // A failed restore can later recover the stored session without a password.
    // Only a real signed-out state completes the startup decision.
    decided.current = !sessionRestoreFailed;
    setIsPrompting(false);
    setFailure(null);
    setState('open');
  }, [isAuthenticated, isLoading, sessionRestoreFailed]);

  useEffect(() => {
    if (decided.current || isLoading || !isAuthenticated) return;

    let cancelled = false;
    void (async () => {
      let enabled: boolean;
      try {
        enabled = await isBiometricLockEnabled();
      } catch {
        if (cancelled) return;
        decided.current = true;
        setFailure('unavailable');
        setState('locked');
        return;
      }
      if (cancelled) return;
      decided.current = true;

      if (!enabled) {
        setState('open');
        return;
      }

      setState('locked');
      void unlock();
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, unlock]);

  const covered = state !== 'open' || (isAuthenticated && !decided.current);

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {!covered ? null : (
        /*
          Opaque and absolutely positioned. React Native hands a touch to the topmost view,
          so this also swallows taps meant for the screen underneath — without needing a
          `pointerEvents` prop, which is just as well: that prop is inert in this app's
          setup (see the bottom-sheet notes).
        */
        <SafeAreaView
          testID="biometric-lock-gate"
          accessibilityViewIsModal
          style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.bg }]}
        >
          <View className="flex-1 items-center justify-center gap-5 px-8" style={{ flex: 1 }}>
            <View
              className="size-20 items-center justify-center rounded-full"
              style={{ backgroundColor: withAlpha(primary, 0.14) }}
            >
              <Ionicons name="finger-print-outline" size={38} color={primary} />
            </View>
            {state === 'locked' ? (
              <>
                <Text className="text-center text-2xl font-bold" style={{ color: theme.text }}>
                  {t('settings:biometricLock.lockedTitle')}
                </Text>
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('settings:biometricLock.lockedSubtitle')}
                </Text>
                {failure ? (
                  <Text
                    testID="biometric-lock-error"
                    className="text-center text-sm leading-5"
                    style={{ color: theme.error }}
                  >
                    {t(`settings:biometricLock.errors.${biometricFailureKey(failure)}`)}
                  </Text>
                ) : null}
                {/*
                  No `backgroundColor` override: the fill and the label must both come from
                  the theme's accent pair, or the dark-mode accent lift leaves dark ink on the
                  un-lifted colour. `components/accentOverride.test.ts` caught this here.
                */}
                <HeroButton
                  variant="primary"
                  isDisabled={isPrompting}
                  style={{ alignSelf: 'stretch' }}
                  onPress={() => void unlock()}
                >
                  <HeroButton.Label>{t('settings:biometricLock.unlock')}</HeroButton.Label>
                </HeroButton>
                {/*
                  Always offered, never hidden behind a failure count: a member whose sensor
                  has stopped reading needs a way back into their account tonight, not after
                  enough failed attempts.
                */}
                <HeroButton variant="ghost" onPress={() => void logout()}>
                  <HeroButton.Label>{t('common:labels.signOut')}</HeroButton.Label>
                </HeroButton>
              </>
            ) : null}
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}
