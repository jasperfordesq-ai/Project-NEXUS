// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
/**
 * PromotionSelector — Modal for selecting a promotion type for a marketplace listing.
 * Shows available promotion products, prices, durations, and a confirm button.
 */

import { useState, useEffect } from 'react';

import Zap from 'lucide-react/icons/zap';
import Star from 'lucide-react/icons/star';
import ArrowUpCircle from 'lucide-react/icons/circle-arrow-up';
import LayoutGrid from 'lucide-react/icons/layout-grid';
import Clock from 'lucide-react/icons/clock';
import Check from 'lucide-react/icons/check';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import type { MarketplacePromotionProduct } from '@/types/marketplace';

interface PromotionSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  listingId: number;
  listingTitle: string;
  onPromoted?: () => void;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  bump: ArrowUpCircle,
  featured: Star,
  top_of_category: LayoutGrid,
  homepage_carousel: Zap,
};

const TYPE_COLORS: Record<string, 'primary' | 'warning' | 'secondary' | 'success'> = {
  bump: 'primary',
  featured: 'warning',
  top_of_category: 'secondary',
  homepage_carousel: 'success',
};

function formatPromotionPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(getFormattingLocale(), {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
}

export function PromotionSelector({
  isOpen,
  onClose,
  listingId,
  listingTitle,
  onPromoted,
}: PromotionSelectorProps) {
  const { t } = useTranslation('marketplace');
  const [products, setProducts] = useState<MarketplacePromotionProduct[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load products when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const loadProducts = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.get<MarketplacePromotionProduct[]>('/v2/marketplace/promotions/products');
        if (!cancelled && response.success && response.data) {
          setProducts(response.data);
        }
      } catch (err) {
        logError('Failed to load promotion products', err);
        if (!cancelled) {
          setError(t('promotions.load_error'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadProducts();
    return () => { cancelled = true; };
  }, [isOpen, t]);

  const handleConfirm = async () => {
    if (!selectedType) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await api.post(`/v2/marketplace/listings/${listingId}/promote`, {
        promotion_type: selectedType,
      });
      if (response.success) {
        onPromoted?.();
        onClose();
      } else {
        setError(t('promotions.create_error'));
      }
    } catch (err) {
      logError('Failed to create promotion', err);
      setError(t('promotions.create_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedProduct = products.find((p) => p.type === selectedType);
  const selectedPrice = selectedProduct
    ? selectedProduct.price > 0
      ? formatPromotionPrice(Number(selectedProduct.price), selectedProduct.currency)
      : t('promotions.free_label')
    : '';

  const formatPromotionDuration = (hours: number): string => {
    if (hours >= 24) {
      return t('promotions.duration_days', { count: Math.round(hours / 24) });
    }

    return t('promotions.duration_hours', { count: hours });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span>{t('promotions.title')}</span>
          <span className="text-sm font-normal text-muted truncate">{listingTitle}</span>
        </ModalHeader>

        <ModalBody>
          {isLoading ? (
            <div className="flex justify-center py-8" role="status" aria-busy="true" aria-label={t('common:loading')}>
              <Spinner size="lg" color="accent" />
            </div>
          ) : error && products.length === 0 ? (
            <p className="text-center text-danger py-4">{error}</p>
          ) : (
            <div className="space-y-3">
              {products.map((product) => {
                const Icon = TYPE_ICONS[product.type] ?? Zap;
                const color = TYPE_COLORS[product.type] ?? 'primary';
                const isSelected = selectedType === product.type;

                return (
                  <Card
                    key={product.type}
                    isPressable
                    onPress={() => setSelectedType(product.type)}
                    className={`border-2 transition-colors ${
                      isSelected
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-border'
                    }`}
                  >
                    <CardBody className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg bg-${color}/10`}>
                          <Icon aria-hidden="true" className={`w-5 h-5 text-${color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-semibold text-foreground">{product.label}</h4>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground">
                                {product.price > 0
                                  ? formatPromotionPrice(Number(product.price), product.currency)
                                  : t('promotions.free_label')}
                              </span>
                              {isSelected && <Check aria-hidden="true" className="w-5 h-5 text-accent" />}
                            </div>
                          </div>
                          <p className="text-sm text-muted mt-1">{product.description}</p>
                          <div className="flex items-center gap-1 mt-2">
                            <Clock aria-hidden="true" className="w-3.5 h-3.5 text-muted" />
                            <span className="text-xs text-muted">
                              {formatPromotionDuration(product.duration_hours)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}

          {error && products.length > 0 && (
            <p role="alert" className="text-sm text-danger mt-2">{error}</p>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>
            {t('promotions.cancel')}
          </Button>
          <Button

            isDisabled={!selectedType}
            isLoading={isSubmitting}
            onPress={handleConfirm}
          >
            {selectedProduct
              ? t('promotions.confirm_promote', { price: selectedPrice })
              : t('promotions.select_type')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default PromotionSelector;
