// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { Share, StatusBar, View } from 'react-native';
import { Image } from 'expo-image';
import { ResumableZoom } from 'react-native-zoom-toolkit';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useAppToast } from '@/components/ui/AppToast';
import ErrorState from '@/components/ui/ErrorState';

function ImageViewerScreenInner() {
  const { t } = useTranslation('home');
  const { show: showToast } = useAppToast();
  const { uri, title } = useLocalSearchParams<{ uri: string; title?: string }>();

  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setFailed(false); setAttempt(0); }, [uri]);

  async function handleShare() {
    if (!uri) return;
    const message = title ? `${title}\n${uri}` : uri;
    try {
      await Share.share({ message, url: uri });
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('common:errors.generic'), variant: 'danger' });
    }
  }

  function handleClose() {
    router.back();
  }

  useEffect(() => {
    if (!uri) {
      router.back();
    }
  }, [uri]);

  if (!uri) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <Surface
          variant="default"
          className="mx-4 mt-2 flex-row items-center justify-between rounded-panel-inner px-2 py-2"
          style={{ backgroundColor: 'rgba(0,0,0,0.52)' }}
        >
          <HeroButton
            isIconOnly
            variant="secondary"
            onPress={handleClose}
            accessibilityLabel={t('imageViewer.close')}
            style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </HeroButton>
          <HeroButton
            isIconOnly
            variant="secondary"
            onPress={() => void handleShare()}
            accessibilityLabel={t('imageViewer.share')}
            style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
          >
            <Ionicons name="share-outline" size={20} color="#FFFFFF" />
          </HeroButton>
        </Surface>

        <View
          testID="viewer-canvas"
          style={{ flex: 1, overflow: 'hidden' }}
          onLayout={({ nativeEvent: { layout } }) => {
            setCanvas({ width: layout.width, height: layout.height });
          }}
        >
          {failed ? (
            <Surface className="m-4 rounded-panel">
              <ErrorState onRetry={() => { setFailed(false); setAttempt((value) => value + 1); }} />
            </Surface>
          ) : canvas.width > 0 && canvas.height > 0 ? (
            <ResumableZoom key={[uri, attempt, canvas.width, canvas.height].join(':')} maxScale={5}>
              <Image
                testID="viewer-image"
                onError={() => setFailed(true)}
                source={{ uri }}
                style={canvas}
                contentFit="contain"
                accessibilityRole="image"
                accessibilityLabel={title?.trim() || t('imageViewer.image')}
              />
            </ResumableZoom>
          ) : null}
        </View>

        <View className="pb-3" />
      </SafeAreaView>
    </View>
  );
}

export default function ImageViewerScreen() {
  return (
    <ModalErrorBoundary>
      <ImageViewerScreenInner />
    </ModalErrorBoundary>
  );
}
