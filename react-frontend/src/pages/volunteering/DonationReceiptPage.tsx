// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useParams } from 'react-router-dom';
import Receipt from 'lucide-react/icons/receipt';
import { DonationReceipt } from '@/components/donations/DonationReceipt';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { PageMeta } from '@/components/seo/PageMeta';
import { usePageTitle } from '@/hooks';
import { useTranslation } from 'react-i18next';

export default function DonationReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('volunteering');
  usePageTitle(t('donations.receipt_title'));

  return (
    <>
      <PageMeta title={t('donations.receipt_title')} noIndex />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {/* The same soft panel in the community colour that opens the other
            pages. Left out of a printed receipt. */}
        <div className="print:hidden">
          <PublicPageHero
            size="compact"
            title={t('donations.receipt_title')}
            icon={<Receipt className="h-6 w-6" aria-hidden="true" />}
          />
        </div>
        <DonationReceipt donationId={Number(id ?? 0)} />
      </div>
    </>
  );
}
