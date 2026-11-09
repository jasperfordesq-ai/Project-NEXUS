// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VoiceInput — Web Speech API button for dictating text.
 * Renders a mic button that toggles speech recognition on/off.
 * Returns null when the browser does not support the Web Speech API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';import Mic from 'lucide-react/icons/mic';
import MicOff from 'lucide-react/icons/mic-off';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  isDisabled?: boolean;
}

/**
 * Minimal SpeechRecognition typing for cross-browser support.
 * The full Web Speech API types are not bundled with all TS configs.
 */
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionResultEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const win = window as unknown as Record<string, unknown>;
  const Ctor =
    (win.SpeechRecognition as SpeechRecognitionConstructor | undefined) ??
    (win.webkitSpeechRecognition as SpeechRecognitionConstructor | undefined);
  return Ctor ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function VoiceInput({ onTranscript, isDisabled }: VoiceInputProps) {
  const { t } = useTranslation('feed');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Check browser support once
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor();

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event: SpeechRecognitionResultEvent) => {
      const results = event.results;
      if (results.length > 0) {
        const transcript = results[0]?.[0]?.transcript;
        if (transcript) {
          onTranscript(transcript);
        }
      }
    };

    recognition.onerror = () => {
      // Handle errors silently — just stop recording and reset
      stopListening();
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setIsListening(true);

    try {
      recognition.start();
    } catch {
      // start() can throw if already started or if permission denied
      stopListening();
    }
  }, [SpeechRecognitionCtor, onTranscript, stopListening]);

  const handleToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  // Don't render if browser doesn't support Web Speech API
  if (!SpeechRecognitionCtor) {
    return null;
  }

  return (
    <div role="status" aria-live="polite" className="contents">
      <Button
        isIconOnly
        size="sm"
        variant={isListening ? 'solid' : 'light'}
        className={
          isListening
            ? 'animate-pulse bg-red-600 text-white min-w-11 w-11 h-11'
            : 'min-w-11 w-11 h-11'
        }
        onPress={handleToggle}
        isDisabled={isDisabled}
        aria-label={isListening ? t('compose.voice_stop') : t('compose.voice_start')}
      >
        {isListening ? (
          <MicOff className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Mic className="w-4 h-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
