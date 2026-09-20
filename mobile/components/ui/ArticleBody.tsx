// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import RenderHTML from '@native-html/render';
import { marked } from 'marked';
import { useTheme } from '@/lib/hooks/useTheme';
import { useOpenExternalUrl } from './useOpenExternalUrl';

const ignoredTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'];
const textProps = { selectable: true, allowFontScaling: true };

/** Preserve article structure while rendering native views and routing link taps through the shared opener. */
export default function ArticleBody({ content, contentType, baseUrl }: { content: string; contentType?: string | null; baseUrl: string }) {
  const theme = useTheme();
  const openExternal = useOpenExternalUrl();
  const { width, fontScale } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const source = useMemo(() => ({
    html: contentType === 'markdown' ? marked.parse(content, { async: false }) : content,
    baseUrl,
  }), [content, contentType, baseUrl]);
  const baseStyle = useMemo(() => ({ color: theme.textSecondary, fontSize: 16, lineHeight: 26 }), [theme.textSecondary]);
  const tagsStyles = useMemo(() => ({
    a: { color: theme.info, textDecorationLine: 'underline' as const },
    h1: { color: theme.text }, h2: { color: theme.text }, h3: { color: theme.text },
    h4: { color: theme.text }, h5: { color: theme.text }, h6: { color: theme.text },
    pre: { backgroundColor: theme.surface, padding: 12 },
  }), [theme.info, theme.text, theme.surface]);
  const renderersProps = useMemo(() => ({ a: { onPress: (_event: unknown, href: string) => {
    void openExternal(href, { allowSchemes: ['mailto:', 'tel:'] });
  } } }), [openExternal]);

  if (contentType === 'plain') return <Text selectable style={baseStyle}>{content}</Text>;
  return (
    <View onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}>
      {/* Recreate memoized native text when Android changes font scale in place. */}
      <RenderHTML key={fontScale} contentWidth={Math.max(1, measuredWidth ?? width - 64)} source={source}
        baseStyle={baseStyle} tagsStyles={tagsStyles} defaultTextProps={textProps}
        enableCSSInlineProcessing={false} ignoredDomTags={ignoredTags} renderersProps={renderersProps} />
    </View>
  );
}
