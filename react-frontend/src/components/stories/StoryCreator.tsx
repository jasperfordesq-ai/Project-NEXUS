// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * StoryCreator — Fullscreen modal for creating stories.
 *
 * Supports three modes:
 * - Photo: upload/take a photo with optional text overlay
 * - Text: text on a gradient background
 * - Poll: question with 2-4 answer options
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import X from 'lucide-react/icons/x';
import Camera from 'lucide-react/icons/camera';
import Type from 'lucide-react/icons/type';
import BarChart3 from 'lucide-react/icons/chart-column';
import ImagePlus from 'lucide-react/icons/image-plus';
import Video from 'lucide-react/icons/video';
import Send from 'lucide-react/icons/send';
import Trash2 from 'lucide-react/icons/trash-2';
import Plus from 'lucide-react/icons/plus';
import Minus from 'lucide-react/icons/minus';
import Globe from 'lucide-react/icons/globe';
import Users from 'lucide-react/icons/users';
import Heart from 'lucide-react/icons/heart';
import SwitchCamera from 'lucide-react/icons/switch-camera';
import Circle from 'lucide-react/icons/circle';
import Square from 'lucide-react/icons/square';
import Pencil from 'lucide-react/icons/pencil';
import Eraser from 'lucide-react/icons/eraser';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { compressImage } from '@/lib/compress-image';
import { Button, Input, Modal, ModalBody, ModalContent, Textarea } from '@/components/ui';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

type StoryMode = 'photo' | 'video' | 'text' | 'poll';

const GRADIENT_PRESETS = [
  { labelKey: 'creator.gradient_purple_blue', class: 'from-accent to-blue-500', css: 'linear-gradient(135deg, #9333ea, #3b82f6)' },
  { labelKey: 'creator.gradient_orange_pink', class: 'from-orange-500 to-pink-500', css: 'linear-gradient(135deg, #f97316, #ec4899)' },
  { labelKey: 'creator.gradient_green_teal', class: 'from-green-500 to-teal-500', css: 'linear-gradient(135deg, #22c55e, #14b8a6)' },
  { labelKey: 'creator.gradient_blue_indigo', class: 'from-blue-600 to-accent-gradient-end', css: 'linear-gradient(135deg, #2563eb, #6366f1)' },
  { labelKey: 'creator.gradient_red_yellow', class: 'from-red-500 to-yellow-500', css: 'linear-gradient(135deg, #ef4444, #eab308)' },
  { labelKey: 'creator.gradient_dark', class: 'from-gray-700 to-gray-900', css: 'linear-gradient(135deg, #374151, #111827)' },
  { labelKey: 'creator.gradient_pink_rose', class: 'from-pink-500 to-rose-400', css: 'linear-gradient(135deg, #ec4899, #fb7185)' },
  { labelKey: 'creator.gradient_cyan_blue', class: 'from-cyan-500 to-blue-500', css: 'linear-gradient(135deg, #06b6d4, #3b82f6)' },
];

const FONT_STYLES = [
  { labelKey: 'creator.font_sans', family: 'sans-serif' },
  { labelKey: 'creator.font_serif', family: 'serif' },
  { labelKey: 'creator.font_mono', family: 'monospace' },
];

const STORY_TEMPLATES = [
  { labelKey: 'creator.template_ama', text: 'Ask me anything!', gradient: 0, font: 0 },
  { labelKey: 'creator.template_morning', text: 'Good morning! \u2600\uFE0F', gradient: 1, font: 1 },
  { labelKey: 'creator.template_grateful', text: "I'm grateful for...", gradient: 2, font: 0 },
  { labelKey: 'creator.template_hot_take', text: 'Hot take: ', gradient: 4, font: 2 },
  { labelKey: 'creator.template_reading', text: 'Currently reading: ', gradient: 5, font: 1 },
  { labelKey: 'creator.template_this_that', text: 'This or That?', gradient: 6, font: 0 },
  { labelKey: 'creator.template_unpopular', text: 'Unpopular opinion: ', gradient: 3, font: 2 },
  { labelKey: 'creator.template_weekend', text: 'Weekend plans: ', gradient: 7, font: 0 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface StoryCreatorProps {
  onClose: () => void;
  onCreated: () => void;
}

export function StoryCreator({ onClose, onCreated }: StoryCreatorProps) {
  const { t } = useTranslation('stories');
  const toast = useToast();
  const [mode, setMode] = useState<StoryMode>('text');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Photo mode state
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [photoText, setPhotoText] = useState('');
  // The photo's description for screen-reader users (AWID report, point 6).
  const [photoAlt, setPhotoAlt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video mode state
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  // Camera capture state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [isRecording, setIsRecording] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Image filter state
  const [imageFilter, setImageFilter] = useState('none');

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingActive, setDrawingActive] = useState(false);
  const [drawColor, setDrawColor] = useState('#ffffff');
  const [drawSize, setDrawSize] = useState(3);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Audience selection
  const [audience, setAudience] = useState<'everyone' | 'connections' | 'close_friends'>('everyone');

  // Text mode state
  const [textContent, setTextContent] = useState('');
  const [selectedGradient, setSelectedGradient] = useState(0);
  const [selectedFont, setSelectedFont] = useState(0);

  // Poll mode state
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollGradient, setPollGradient] = useState(3);

  // Handle image selection
  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('creator.error_image_type'));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('creator.error_image_size'));
      return;
    }

    try {
      const compressed = await compressImage(file, 1080, 0.85);
      setSelectedImage(compressed);

      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(compressed);
    } catch (err) {
      logError('Failed to process image', err);
      toast.error(t('creator.error_process'));
    }
  }, [toast, t])

  // Handle video selection
  const handleVideoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      toast.error(t('creator.error_video_type'));
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast.error(t('creator.error_video_size'));
      return;
    }

    setSelectedVideo(file);
    const url = URL.createObjectURL(file);
    setVideoPreview(url);

    // Get video duration
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      setVideoDuration(video.duration);
      URL.revokeObjectURL(video.src);
    };
    video.src = url;
  }, [toast, t])

  // Camera functions
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 1080 }, height: { ideal: 1920 } },
        audio: mode === 'video',
      });
      setCameraStream(stream);
      setCameraActive(true);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      logError('Camera access failed', err);
      const error = err as { name?: string };
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        toast.error(t('creator.error_camera_permission'));
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        toast.error(t('creator.error_camera_not_found'));
      } else {
        toast.error(t('creator.error_camera'));
      }
    }
  }, [cameraFacing, mode, toast, t])

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    setCameraActive(false);
    setIsRecording(false);
  }, [cameraStream]);

  // The <video> only mounts after cameraActive flips true, so startCamera's
  // synchronous ref assignment misses it — attach the stream once it exists.
  useEffect(() => {
    const video = cameraVideoRef.current;
    if (cameraActive && cameraStream && video && video.srcObject !== cameraStream) {
      video.srcObject = cameraStream;
      video.play().catch(() => {
        // Autoplay is already requested via the autoPlay attribute; a rejected
        // play() here (e.g. transient AbortError) resolves on user interaction.
      });
    }
  }, [cameraActive, cameraStream, mode]);

  const flipCamera = useCallback(() => {
    // Keep cameraActive true so the facing-change effect restarts the stream.
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    setCameraFacing((prev) => (prev === 'user' ? 'environment' : 'user'));
  }, [cameraStream]);

  // Restart camera when facing changes
  useEffect(() => {
    if (cameraActive && !cameraStream) {
      startCamera();
    }
  }, [cameraFacing]); // eslint-disable-line react-hooks/exhaustive-deps -- restart camera on facing change; startCamera excluded to avoid loop

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraStream]);

  const capturePhoto = useCallback(() => {
    if (!cameraVideoRef.current || !cameraCanvasRef.current) return;

    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mirror if front camera
    if (cameraFacing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
        setSelectedImage(file);
        setImagePreview(canvas.toDataURL('image/jpeg', 0.9));
        stopCamera();
      },
      'image/jpeg',
      0.9,
    );
  }, [cameraFacing, stopCamera]);

  const startRecording = useCallback(() => {
    if (!cameraStream) return;

    recordedChunksRef.current = [];
    // iOS Safari records mp4 and throws on webm mime types — probe for the
    // first container the browser actually supports.
    const supportedMimeType = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = supportedMimeType
      ? new MediaRecorder(cameraStream, { mimeType: supportedMimeType })
      : new MediaRecorder(cameraStream);
    const isMp4 = (supportedMimeType ?? recorder.mimeType).includes('mp4');
    const containerType = isMp4 ? 'video/mp4' : 'video/webm';
    const containerExt = isMp4 ? 'mp4' : 'webm';

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: containerType });
      const file = new File([blob], `recording_${Date.now()}.${containerExt}`, { type: containerType });
      setSelectedVideo(file);
      setVideoPreview(URL.createObjectURL(blob));

      // Get duration
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.onloadedmetadata = () => {
        setVideoDuration(tempVideo.duration);
        URL.revokeObjectURL(tempVideo.src);
      };
      tempVideo.src = URL.createObjectURL(blob);

      stopCamera();
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
  }, [cameraStream, stopCamera]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  // Image filter definitions
  const IMAGE_FILTERS = [
    { labelKey: 'creator.filter_none', value: 'none', css: 'none' },
    { labelKey: 'creator.filter_warm', value: 'warm', css: 'sepia(0.3) saturate(1.4) brightness(1.1)' },
    { labelKey: 'creator.filter_cool', value: 'cool', css: 'saturate(0.8) hue-rotate(15deg) brightness(1.05)' },
    { labelKey: 'creator.filter_bw', value: 'bw', css: 'grayscale(1)' },
    { labelKey: 'creator.filter_vivid', value: 'vivid', css: 'saturate(1.8) contrast(1.1)' },
    { labelKey: 'creator.filter_fade', value: 'fade', css: 'contrast(0.85) brightness(1.15) saturate(0.7)' },
    { labelKey: 'creator.filter_drama', value: 'drama', css: 'contrast(1.3) brightness(0.9) saturate(1.2)' },
  ];

  const activeFilterCss = IMAGE_FILTERS.find((f) => f.value === imageFilter)?.css || 'none';

  const DRAW_COLORS = ['#ffffff', '#000000', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#8b5cf6'];

  const initDrawCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    drawCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawCtxRef.current = ctx;
    }
  }, []);

  const handleDrawStart = useCallback((e: React.PointerEvent) => {
    if (!drawingActive || !drawCtxRef.current) return;
    setIsDrawing(true);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    drawCtxRef.current.beginPath();
    drawCtxRef.current.moveTo(x, y);
    drawCtxRef.current.strokeStyle = drawColor;
    drawCtxRef.current.lineWidth = drawSize;
  }, [drawingActive, drawColor, drawSize]);

  const handleDrawMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawing || !drawCtxRef.current) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    drawCtxRef.current.lineTo(x, y);
    drawCtxRef.current.stroke();
  }, [isDrawing]);

  const handleDrawEnd = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const clearDrawing = useCallback(() => {
    if (!drawCanvasRef.current || !drawCtxRef.current) return;
    drawCtxRef.current.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height);
  }, []);

  // Add/remove poll options
  const addPollOption = () => {
    if (pollOptions.length < 4) {
      setPollOptions([...pollOptions, '']);
    }
  };

  const removePollOption = (index: number) => {
    if (pollOptions.length > 2) {
      setPollOptions(pollOptions.filter((_, i) => i !== index));
    }
  };

  const updatePollOption = (index: number, value: string) => {
    const newOptions = [...pollOptions];
    newOptions[index] = value;
    setPollOptions(newOptions);
  };

  // Submit story
  const handleSubmit = async () => {
    if (isSubmitting) return;

    // Validation
    if (mode === 'photo' && !selectedImage) {
      toast.error(t('creator.error_select_image'));
      return;
    }
    if (mode === 'video' && !selectedVideo) {
      toast.error(t('creator.error_select_video'));
      return;
    }
    if (mode === 'text' && !textContent.trim()) {
      toast.error(t('creator.error_enter_text'));
      return;
    }
    if (mode === 'poll') {
      if (!pollQuestion.trim()) {
        toast.error(t('creator.error_poll_question'));
        return;
      }
      const filledOptions = pollOptions.filter((o) => o.trim());
      if (filledOptions.length < 2) {
        toast.error(t('creator.error_poll_options'));
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (mode === 'photo') {
        // Use FormData for image upload
        const formData = new FormData();
        formData.append('media_type', 'image');
        formData.append('media', selectedImage!);
        if (photoText.trim()) {
          formData.append('text_content', photoText.trim());
        }
        if (photoAlt.trim()) {
          formData.append('media_alt', photoAlt.trim());
        }
        formData.append('duration', '5');
        formData.append('audience', audience);

        const response = await api.upload('/v2/stories', formData);
        if (!response.success) {
          throw new Error(response.error || 'Failed to create story');
        }
      } else if (mode === 'video') {
        const formData = new FormData();
        formData.append('media_type', 'video');
        formData.append('media', selectedVideo!);
        if (videoDuration > 0) {
          formData.append('video_duration', String(videoDuration));
        }
        formData.append('duration', String(Math.min(Math.ceil(videoDuration || 10), 30)));
        formData.append('audience', audience);

        const response = await api.upload('/v2/stories', formData);
        if (!response.success) {
          throw new Error(response.error || 'Failed to create story');
        }
      } else if (mode === 'text') {
        const gradient = GRADIENT_PRESETS[selectedGradient] ?? GRADIENT_PRESETS[0];
        const font = FONT_STYLES[selectedFont] ?? FONT_STYLES[0];
        if (!gradient || !font) return;

        const response = await api.post('/v2/stories', {
          media_type: 'text',
          text_content: textContent.trim(),
          background_gradient: gradient.class,
          text_style: { fontFamily: font.family },
          duration: 5,
          audience,
        });
        if (!response.success) {
          throw new Error(response.error || 'Failed to create story');
        }
      } else if (mode === 'poll') {
        const gradient = GRADIENT_PRESETS[pollGradient] ?? GRADIENT_PRESETS[0] ?? { label: '', class: '', css: '' };
        const filledOptions = pollOptions.filter((o) => o.trim());

        const response = await api.post('/v2/stories', {
          media_type: 'poll',
          poll_question: pollQuestion.trim(),
          poll_options: filledOptions,
          background_gradient: gradient.class,
          duration: 10,
          audience,
        });
        if (!response.success) {
          throw new Error(response.error || 'Failed to create story');
        }
      }

      toast.success(t('creator.success'));
      onCreated();
    } catch (err) {
      logError('Failed to create story', err);
      toast.error(err instanceof Error ? err.message : t('creator.error_create'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Discard
  const handleDiscard = () => {
    if (mode === 'photo' && selectedImage) {
      setSelectedImage(null);
      setImagePreview(null);
      setPhotoText('');
      setPhotoAlt('');
      return;
    }
    if (mode === 'video' && selectedVideo) {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      setSelectedVideo(null);
      setVideoPreview(null);
      setVideoDuration(0);
      return;
    }
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="full"
      backdrop="opaque"
      hideCloseButton
      classNames={{
        base: 'h-dvh max-h-dvh border-0 bg-black p-0 text-white shadow-none',
        backdrop: 'bg-black',
        body: 'p-0',
        wrapper: 'p-0',
      }}
    >
      <ModalContent aria-label={t('creator.title')}>
        <ModalBody className="flex h-dvh flex-col overflow-hidden" aria-label={t('creator.title')}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 z-10">
        <Button
          isIconOnly
          variant="tertiary"
          className="size-9 min-h-9 rounded-full p-2 transition-colors hover:bg-white/10"
          onPress={onClose}
          aria-label={t('creator.close')}
        >
          <X className="w-5 h-5 text-white" />
        </Button>

        <h2 className="text-white font-semibold text-lg">{t('creator.title')}</h2>

        <div className="w-9" /> {/* Spacer for centering */}
      </div>

      {/* Mode tabs */}
      <div className="flex items-center gap-1 px-4 pb-3">
        {([
          { key: 'photo' as StoryMode, icon: Camera, label: t('creator.mode_photo') },
          { key: 'video' as StoryMode, icon: Video, label: t('creator.mode_video') },
          { key: 'text' as StoryMode, icon: Type, label: t('creator.mode_text') },
          { key: 'poll' as StoryMode, icon: BarChart3, label: t('creator.mode_poll') },
        ]).map(({ key, icon: Icon, label }) => (
          <Button
            key={key}
            variant="secondary"
            onPress={() => setMode(key)}
            className={`flex min-h-[40px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${
              mode === key
                ? 'bg-white text-black'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
            aria-label={`${label} mode`}
            aria-pressed={mode === key}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Photo Mode */}
        {mode === 'photo' && (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-4">
            {imagePreview ? (
              <>
                <div className="relative w-full max-w-sm aspect-[9/16] rounded-2xl overflow-hidden">
                  <img
                    src={imagePreview}
                    alt={t('creator.preview_alt')}
                    className="w-full h-full object-cover"
                    style={{ filter: activeFilterCss }}
                  />
                  {/* Drawing canvas overlay */}
                  <canvas
                    ref={initDrawCanvas}
                    width={1080}
                    height={1920}
                    className={`absolute inset-0 w-full h-full ${drawingActive ? 'cursor-crosshair z-20' : 'pointer-events-none z-10'}`}
                    onPointerDown={handleDrawStart}
                    onPointerMove={handleDrawMove}
                    onPointerUp={handleDrawEnd}
                    onPointerLeave={handleDrawEnd}
                  />
                  {/* Drawing toolbar */}
                  <div className="absolute top-3 right-3 flex flex-col gap-2 z-30">
                    <Button
                      isIconOnly
                      variant="tertiary"
                      className={`size-9 min-h-9 rounded-full p-2 backdrop-blur transition-colors ${
                        drawingActive ? 'bg-white text-black' : 'bg-black/40 text-white hover:bg-black/60'
                      }`}
                      onPress={() => setDrawingActive(!drawingActive)}
                      aria-label={t('creator.draw_toggle')}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    {drawingActive && (
                      <>
                        <Button
                          isIconOnly
                          variant="tertiary"
                          className="size-9 min-h-9 rounded-full bg-black/40 p-2 text-white backdrop-blur transition-colors hover:bg-black/60"
                          onPress={clearDrawing}
                          aria-label={t('creator.draw_clear')}
                        >
                          <Eraser className="w-4 h-4" />
                        </Button>
                        <div className="flex flex-col gap-1 bg-black/40 backdrop-blur rounded-full p-1.5">
                          {DRAW_COLORS.map((c) => (
                            <Button
                              key={c}
                              isIconOnly
                              variant="secondary"
                              onPress={() => setDrawColor(c)}
                              className={`w-5 h-5 rounded-full transition-all min-w-0 p-0 ${
                                drawColor === c ? 'ring-2 ring-white scale-110' : ''
                              }`}
                              style={{ backgroundColor: c }}
                              aria-label={`Draw color ${c}`}
                            />
                          ))}
                        </div>
                        <div className="flex flex-col gap-1 bg-black/40 backdrop-blur rounded-full p-1.5">
                          {[2, 4, 8].map((s) => (
                            <Button
                              key={s}
                              isIconOnly
                              variant="secondary"
                              onPress={() => setDrawSize(s)}
                              className={`w-5 h-5 rounded-full transition-all min-w-0 p-0 ${
                                drawSize === s ? 'bg-white/30' : ''
                              }`}
                              aria-label={`Brush size ${s}`}
                            >
                              <div className="rounded-full bg-white" style={{ width: s + 2, height: s + 2 }} />
                            </Button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Text overlay input */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent z-30">
                    <Input
                      value={photoText}
                      onValueChange={setPhotoText}
                      placeholder={t('creator.text_overlay')}
                      aria-label={t('creator.text_overlay')}
                      variant="secondary"
                      size="sm"
                      classNames={{
                        input: 'text-white placeholder:text-white/50',
                        inputWrapper: 'border-white/30 bg-white/10 backdrop-blur',
                      }}
                      maxLength={200}
                    />
                  </div>
                </div>
                {/* What the photo shows, for screen-reader users (AWID report, point 6) */}
                <div className="w-full max-w-sm">
                  <Input
                    value={photoAlt}
                    onValueChange={setPhotoAlt}
                    label={t('creator.photo_alt_label')}
                    aria-label={t('creator.photo_alt_label')}
                    variant="secondary"
                    size="sm"
                    classNames={{
                      label: 'text-white/70',
                      input: 'text-white placeholder:text-white/50',
                      inputWrapper: 'border-white/30 bg-white/10',
                    }}
                    maxLength={255}
                  />
                </div>
                {/* Image filters */}
                <div className="w-full max-w-sm">
                  <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">{t('creator.filter_label')}</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {IMAGE_FILTERS.map((f) => (
                      <Button
                        key={f.value}
                        variant="ghost"
                        onPress={() => setImageFilter(f.value)}
                        className={`flex min-h-[76px] flex-shrink-0 flex-col items-center gap-1 p-0 ${
                          imageFilter === f.value ? 'opacity-100' : 'opacity-60 hover:opacity-80'
                        }`}
                        aria-label={`${t(f.labelKey)} filter`}
                        aria-pressed={imageFilter === f.value}
                      >
                        <div
                          className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                            imageFilter === f.value ? 'border-white' : 'border-transparent'
                          }`}
                        >
                          <img
                            src={imagePreview ?? ''}
                            alt={`${t(f.labelKey)} filter preview`}
                            className="w-full h-full object-cover"
                            style={{ filter: f.css }}
                          />
                        </div>
                        <span className="text-white text-[10px]">{t(f.labelKey)}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </>
            ) : cameraActive ? (
              <div className="relative w-full max-w-sm aspect-[9/16] rounded-2xl overflow-hidden bg-black">
                <video
                  ref={cameraVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none' }}
                />
                <canvas ref={cameraCanvasRef} className="hidden" />

                {/* Camera controls */}
                <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-8">
                  <Button
                    isIconOnly
                    variant="tertiary"
                    className="size-11 min-h-11 rounded-full bg-white/20 p-3 backdrop-blur transition-colors hover:bg-white/30"
                    onPress={flipCamera}
                    aria-label={t('creator.flip_camera')}
                  >
                    <SwitchCamera className="w-5 h-5 text-white" />
                  </Button>
                  <Button
                    isIconOnly
                    variant="secondary"
                    className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/40 transition-colors active:scale-90 min-w-0"
                    onPress={capturePhoto}
                    aria-label={t('creator.capture')}
                  />
                  <Button
                    isIconOnly
                    variant="tertiary"
                    className="size-11 min-h-11 rounded-full bg-white/20 p-3 backdrop-blur transition-colors hover:bg-white/30"
                    onPress={stopCamera}
                    aria-label={t('creator.close_camera')}
                  >
                    <X className="w-5 h-5 text-white" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 w-full max-w-sm">
                <Button
                  variant="secondary"
                  onPress={startCamera}
                  className="flex min-h-[180px] w-full cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-white/20 p-10 transition-colors hover:border-white/40"
                  aria-label={t('creator.open_camera')}
                >
                  <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                    <Camera className="w-8 h-8 text-white/70" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-medium">{t('creator.take_photo_title')}</p>
                    <p className="text-white/50 text-sm mt-1">{t('creator.use_your_camera')}</p>
                  </div>
                </Button>
                <div className="text-white/30 text-xs uppercase tracking-wider">{t('creator.or_divider')}</div>
                <Button
                  variant="secondary"
                  onPress={() => fileInputRef.current?.click()}
                  className="flex min-h-[148px] w-full cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-white/20 p-8 transition-colors hover:border-white/40"
                  aria-label={t('creator.select_image')}
                >
                  <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                    <ImagePlus className="w-6 h-6 text-white/70" />
                  </div>
                  <p className="text-white/70 text-sm">{t('creator.choose_from_gallery')}</p>
                </Button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
              aria-label={t('creator.choose_image_file')}
            />
          </div>
        )}

        {/* Video Mode */}
        {mode === 'video' && (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-4">
            {videoPreview ? (
              <div className="relative w-full max-w-sm aspect-[9/16] rounded-2xl overflow-hidden bg-black">
                <video
                  ref={videoPreviewRef}
                  src={videoPreview}
                  className="w-full h-full object-cover"
                  controls
                  muted
                  playsInline
                />
                {videoDuration > 0 && (
                  <div className="absolute top-3 right-3 bg-black/60 backdrop-blur rounded-full px-2.5 py-1 text-white text-xs font-medium">
                    {t('creator.video_duration_seconds', { count: Math.round(videoDuration) })}
                  </div>
                )}
                {videoDuration > 60 && (
                  <div className="absolute bottom-3 left-3 right-3 bg-red-500/80 backdrop-blur rounded-lg px-3 py-2 text-white text-xs text-center">
                    {t('creator.videos_trimmed_notice')}
                  </div>
                )}
              </div>
            ) : cameraActive ? (
              <div className="relative w-full max-w-sm aspect-[9/16] rounded-2xl overflow-hidden bg-black">
                <video
                  ref={cameraVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none' }}
                />
                {isRecording && (
                  <div className="absolute top-4 left-4 flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-white text-sm font-medium">{t('creator.recording_indicator')}</span>
                  </div>
                )}
                <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-8">
                  <Button
                    isIconOnly
                    variant="tertiary"
                    className="size-11 min-h-11 rounded-full bg-white/20 p-3 backdrop-blur transition-colors hover:bg-white/30"
                    onPress={flipCamera}
                    aria-label={t('creator.flip_camera')}
                  >
                    <SwitchCamera className="w-5 h-5 text-white" />
                  </Button>
                  {isRecording ? (
                    <Button
                      isIconOnly
                      variant="secondary"
                      className="w-16 h-16 rounded-full border-4 border-red-500 bg-red-500/30 hover:bg-red-500/50 transition-colors min-w-0"
                      onPress={stopRecording}
                      aria-label={t('creator.stop_recording')}
                    >
                      <Square className="w-6 h-6 text-white fill-white" />
                    </Button>
                  ) : (
                    <Button
                      isIconOnly
                      variant="secondary"
                      className="w-16 h-16 rounded-full border-4 border-red-500 bg-red-500/20 hover:bg-red-500/40 transition-colors min-w-0"
                      onPress={startRecording}
                      aria-label={t('creator.start_recording')}
                    >
                      <Circle className="w-6 h-6 text-[var(--color-error)] fill-red-500" />
                    </Button>
                  )}
                  <Button
                    isIconOnly
                    variant="tertiary"
                    className="size-11 min-h-11 rounded-full bg-white/20 p-3 backdrop-blur transition-colors hover:bg-white/30"
                    onPress={stopCamera}
                    aria-label={t('creator.close_camera')}
                  >
                    <X className="w-5 h-5 text-white" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 w-full max-w-sm">
                <Button
                  variant="secondary"
                  onPress={startCamera}
                  className="flex min-h-[180px] w-full cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-white/20 p-10 transition-colors hover:border-white/40"
                  aria-label={t('creator.record_video')}
                >
                  <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                    <Video className="w-8 h-8 text-white/70" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-medium">{t('creator.record_video_title')}</p>
                    <p className="text-white/50 text-sm mt-1">{t('creator.use_your_camera')}</p>
                  </div>
                </Button>
                <div className="text-white/30 text-xs uppercase tracking-wider">{t('creator.or_divider')}</div>
                <Button
                  variant="secondary"
                  onPress={() => videoInputRef.current?.click()}
                  className="flex min-h-[148px] w-full cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-white/20 p-8 transition-colors hover:border-white/40"
                  aria-label={t('creator.select_video')}
                >
                  <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                    <ImagePlus className="w-6 h-6 text-white/70" />
                  </div>
                  <p className="text-white/70 text-sm">{t('creator.choose_from_gallery')}</p>
                </Button>
              </div>
            )}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/webm,video/ogg,video/quicktime"
              onChange={handleVideoSelect}
              className="hidden"
              aria-label={t('creator.choose_video_file')}
            />
          </div>
        )}

        {/* Text Mode */}
        {mode === 'text' && (
          <div className="flex flex-col h-full">
            {/* Preview */}
            <div
              className="flex-1 flex items-center justify-center px-8 py-12 mx-4 rounded-2xl min-h-[300px]"
              style={{ background: (GRADIENT_PRESETS[selectedGradient] ?? GRADIENT_PRESETS[0])?.css }}
            >
              {textContent ? (
                <p
                  className="max-w-sm text-center text-2xl leading-[1.4] text-white drop-shadow-lg"
                  style={{
                    fontFamily: (FONT_STYLES[selectedFont] ?? FONT_STYLES[0])?.family,
                  }}
                >
                  {textContent}
                </p>
              ) : (
                <p className="text-white/40 text-lg">{t('creator.text_placeholder')}</p>
              )}
            </div>

            {/* Controls */}
            <div className="px-4 py-4 space-y-4">
              {/* Templates */}
              {!textContent && (
                <div>
                  <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">{t('creator.templates_label')}</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {STORY_TEMPLATES.map((tpl) => (
                      <Button
                        key={tpl.labelKey}
                        variant="secondary"
                        onPress={() => {
                          setTextContent(tpl.text);
                          setSelectedGradient(tpl.gradient);
                          setSelectedFont(tpl.font);
                        }}
                        className="min-h-[32px] flex-shrink-0 whitespace-nowrap rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/20"
                      >
                        {t(tpl.labelKey)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <Textarea
                value={textContent}
                onValueChange={setTextContent}
                placeholder={t('creator.compose_placeholder')}
                variant="secondary"
                maxLength={500}
                minRows={2}
                maxRows={4}
                description={`${textContent.length}/500`}
                classNames={{
                  input: 'text-white',
                  inputWrapper: 'border-white/20 bg-white/5',
                  description: 'text-white/40 text-right',
                }}
              />

              {/* Gradient picker */}
              <div>
                <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">{t('creator.background_label')}</p>
                <div className="flex gap-2 flex-wrap">
                  {GRADIENT_PRESETS.map((g, idx) => (
                    <Button
                      key={g.labelKey}
                      isIconOnly
                      variant="secondary"
                      onPress={() => setSelectedGradient(idx)}
                      className={`w-8 h-8 rounded-full transition-all min-w-0 p-0 ${
                        selectedGradient === idx ? 'ring-2 ring-white ring-offset-2 ring-offset-black scale-110' : 'hover:scale-105'
                      }`}
                      style={{ background: g.css }}
                      aria-label={t(g.labelKey)}
                      aria-pressed={selectedGradient === idx}
                    />
                  ))}
                </div>
              </div>

              {/* Font picker */}
              <div>
                <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">{t('creator.font_label')}</p>
                <div className="flex gap-2">
                  {FONT_STYLES.map((f, idx) => (
                    <Button
                      key={f.labelKey}
                      variant="secondary"
                      onPress={() => setSelectedFont(idx)}
                      className={`min-h-[34px] rounded-full px-4 py-1.5 text-sm transition-all ${
                        selectedFont === idx
                          ? 'bg-white text-black font-medium'
                          : 'bg-white/10 text-white/70 hover:bg-white/20'
                      }`}
                      style={{ fontFamily: f.family }}
                      aria-label={`${t(f.labelKey)} font`}
                      aria-pressed={selectedFont === idx}
                    >
                      {t(f.labelKey)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Poll Mode */}
        {mode === 'poll' && (
          <div className="flex flex-col h-full">
            {/* Preview */}
            <div
              className="flex flex-col items-center justify-center px-8 py-12 mx-4 rounded-2xl min-h-[250px] gap-4"
              style={{ background: (GRADIENT_PRESETS[pollGradient] ?? GRADIENT_PRESETS[0])?.css }}
            >
              {pollQuestion ? (
                <h3 className="text-white text-xl font-bold text-center">{pollQuestion}</h3>
              ) : (
                <p className="text-white/40 text-lg">{t('creator.poll_question_placeholder')}</p>
              )}
              <div className="w-full max-w-sm flex flex-col gap-2">
                {pollOptions.filter((o) => o.trim()).map((option, idx) => (
                  <div
                    key={idx}
                    className="w-full px-4 py-3 rounded-xl bg-white/30 text-white text-sm font-medium"
                  >
                    {option}
                  </div>
                ))}
              </div>
            </div>

            {/* Poll Controls */}
            <div className="px-4 py-4 space-y-4">
              <Input
                value={pollQuestion}
                onValueChange={setPollQuestion}
                placeholder={t('creator.poll_question_placeholder')}
                variant="secondary"
                maxLength={255}
                classNames={{
                  input: 'text-white',
                  inputWrapper: 'border-white/20 bg-white/5',
                }}
                aria-label={t('creator.aria_poll_question')}
              />

              <div className="space-y-2">
                <p className="text-white/50 text-xs uppercase tracking-wider">{t('creator.options_label')}</p>
                {pollOptions.map((option, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      value={option}
                      onValueChange={(v) => updatePollOption(idx, v)}
                      placeholder={`Option ${idx + 1}`}
                      variant="secondary"
                      maxLength={100}
                      classNames={{
                        input: 'text-white',
                        inputWrapper: 'border-white/20 bg-white/5',
                      }}
                      aria-label={`Poll option ${idx + 1}`}
                    />
                    {pollOptions.length > 2 && (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="tertiary"
                        className="bg-white/10 text-white/70"
                        onPress={() => removePollOption(idx)}
                        aria-label={`Remove option ${idx + 1}`}
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {pollOptions.length < 4 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="bg-white/10 text-white/70"
                    startContent={<Plus className="w-4 h-4" />}
                    onPress={addPollOption}
                  >
                    {t('creator.poll_add_option_button')}
                  </Button>
                )}
              </div>

              {/* Background picker for poll */}
              <div>
                <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">{t('creator.background_label')}</p>
                <div className="flex gap-2 flex-wrap">
                  {GRADIENT_PRESETS.map((g, idx) => (
                    <Button
                      key={g.labelKey}
                      isIconOnly
                      variant="secondary"
                      onPress={() => setPollGradient(idx)}
                      className={`w-8 h-8 rounded-full transition-all min-w-0 p-0 ${
                        pollGradient === idx ? 'ring-2 ring-white ring-offset-2 ring-offset-black scale-110' : 'hover:scale-105'
                      }`}
                      style={{ background: g.css }}
                      aria-label={t(g.labelKey)}
                      aria-pressed={pollGradient === idx}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="px-4 py-4 border-t border-white/10 space-y-3">
        {/* Audience selector */}
        <div className="flex items-center gap-2 justify-center">
          {([
            { key: 'everyone' as const, icon: Globe, labelKey: 'creator.audience_everyone' },
            { key: 'connections' as const, icon: Users, labelKey: 'creator.audience_connections' },
            { key: 'close_friends' as const, icon: Heart, labelKey: 'creator.audience_close_friends' },
          ]).map(({ key, icon: Icon, labelKey }) => (
            <Button
              key={key}
              variant="secondary"
              onPress={() => setAudience(key)}
              className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                audience === key
                  ? 'bg-white text-black'
                  : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
              aria-label={t(labelKey)}
              aria-pressed={audience === key}
            >
              <Icon className="w-3.5 h-3.5" />
              {t(labelKey)}
            </Button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="tertiary"
            className="bg-white/10 text-white/70"
            onPress={handleDiscard}
            startContent={<Trash2 className="w-4 h-4" />}
          >
            {t('creator.discard')}
          </Button>

          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white font-medium"
            onPress={handleSubmit}
            isLoading={isSubmitting}
            startContent={!isSubmitting ? <Send className="w-4 h-4" /> : undefined}
          >
            {t('creator.share_story')}
          </Button>
        </div>
      </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default StoryCreator;
