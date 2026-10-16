// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * StripePaymentForm - Stripe Elements payment form component
 *
 * Wraps Stripe PaymentElement in an Elements provider and handles
 * payment confirmation with loading/error states.
 */

import { useMemo, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';import CreditCard from 'lucide-react/icons/credit-card';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { Button, Chip } from '@/components/ui';

/* ───────────────────────── Stripe init (one instance per account) ───────────────────────── */

/**
 * A PaymentIntent created on a community's own Stripe account (Stripe Connect,
 * direct charge) can only be confirmed by a Stripe.js instance initialised
 * with that account's id. Confirming it through the platform instance fails
 * with "No such payment_intent", so each connected account gets its own
 * instance, created once and reused.
 *
 * The publishable key is read when first needed, not at import, so a test
 * can set it and so a missing key degrades to "no Stripe" rather than a
 * crash.
 */
const stripeInstances = new Map<string, Promise<Stripe | null>>();

function getStripePromise(stripeAccountId: string | null | undefined): Promise<Stripe | null> | null {
  const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
  if (!stripeKey) return null;
  const accountKey = stripeAccountId || '';
  const cacheKey = `${stripeKey}|${accountKey}`;
  let promise = stripeInstances.get(cacheKey);
  if (!promise) {
    promise = accountKey
      ? loadStripe(stripeKey, { stripeAccount: accountKey })
      : loadStripe(stripeKey);
    stripeInstances.set(cacheKey, promise);
  }
  return promise;
}

/* ───────────────────────── Props ───────────────────────── */

interface StripePaymentFormProps {
  clientSecret: string;
  /** The connected account the client_secret belongs to; null/undefined for the platform account. */
  stripeAccountId?: string | null;
  onSuccess: () => void;
  onError: (error: string) => void;
}

/* ───────────────────────── Inner form (must be inside Elements) ───────────────────────── */

function PaymentForm({ onSuccess, onError }: Pick<StripePaymentFormProps, 'onSuccess' | 'onError'>) {
  const { t } = useTranslation('volunteering');
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    try {
      setIsProcessing(true);
      setErrorMessage(null);

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (error) {
        const msg = error.message || t('donations.payment_failed');
        setErrorMessage(msg);
        onError(msg);
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        onSuccess();
      } else if (paymentIntent && paymentIntent.status === 'requires_action') {
        // 3D Secure or other action — Stripe handles this automatically
        setErrorMessage(t('donations.payment_action_required'));
      } else {
        const msg = t('donations.payment_unexpected');
        setErrorMessage(msg);
        onError(msg);
      }
    } catch {
      const msg = t('donations.payment_error');
      setErrorMessage(msg);
      onError(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: 'tabs',
        }}
      />

      {errorMessage && (
        <Chip
          color="danger"
          variant="flat"
          startContent={<AlertTriangle aria-hidden="true" className="w-3 h-3" />}
          className="w-full max-w-full"
        >
          {errorMessage}
        </Chip>
      )}

      <Button
        type="submit"
        className="w-full bg-gradient-to-r from-rose-500 to-pink-600 text-white"
        isLoading={isProcessing}
        isDisabled={!stripe || !elements || isProcessing}
        startContent={!isProcessing ? <CreditCard className="w-4 h-4" aria-hidden="true" /> : undefined}
      >
        {isProcessing
          ? t('donations.processing')
          : t('donations.pay_now')}
      </Button>
    </form>
  );
}

/* ───────────────────────── Exported wrapper ───────────────────────── */

export function StripePaymentForm({ clientSecret, stripeAccountId, onSuccess, onError }: StripePaymentFormProps) {
  const stripePromise = useMemo(() => getStripePromise(stripeAccountId), [stripeAccountId]);

  return (
    <Elements
      // Elements must be remounted when the account changes: the provider
      // binds to the Stripe instance it was first given.
      key={stripeAccountId || 'platform'}
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            borderRadius: '8px',
          },
        },
      }}
    >
      <PaymentForm onSuccess={onSuccess} onError={onError} />
    </Elements>
  );
}

export default StripePaymentForm;
