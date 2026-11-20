'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Droplets,
  Lightbulb,
  LocateFixed,
  Mic,
  MicOff,
  Send,
  Trash2,
  TreePine,
  Construction,
  Users,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

const IncidentMap = dynamic(() => import('@/components/IncidentMap'), {
  ssr: false,
  loading: () => <div className="w-full h-72 sm:h-96 rounded-3xl bg-superficie/70 animate-pulse" />,
});

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

interface NearbyIncident {
  id: string;
  tracking_code: string;
  title: string;
  category: string;
  status: string;
  upvotes: number;
  distance_m: number;
}

interface CreatedIncident {
  tracking_code: string;
  title: string;
  category: string;
  urgency: string;
  department: string;
  ai_reasoning: string;
}

const SPEECH_LANGS: Record<string, string> = { es: 'es-ES', en: 'en-GB', fr: 'fr-FR', ar: 'ar-SA' };

const QUICK_CARDS = [
  { key: 'lighting', category: 'Alumbrado', icon: Lightbulb, color: 'bg-solAlmeria text-tinta' },
  { key: 'waste', category: 'Limpieza y Basura', icon: Trash2, color: 'bg-verdeCabo text-tarjeta' },
  { key: 'roads', category: 'Baches y Vía Pública', icon: Construction, color: 'bg-terracota text-tarjeta' },
  { key: 'water', category: 'Agua y Averías', icon: Droplets, color: 'bg-azulMed text-tarjeta' },
  { key: 'parks', category: 'Parques y Jardines', icon: TreePine, color: 'bg-buganvilla text-tarjeta' },
] as const;

function urgencyClass(urgency: string): string {
  switch (urgency) {
    case 'CRITICA':
      return 'bg-terracota text-tarjeta';
    case 'ALTA':
      return 'bg-solAlmeria text-tinta';
    case 'MEDIA':
      return 'bg-azulMed text-tarjeta';
    default:
      return 'bg-verdeCabo text-tarjeta';
  }
}

async function fileToCompressedDataUrl(file: File, maxSide = 960, quality = 0.72): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_error'));
    image.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function IncidentWizard() {
  const { t, lang } = useTranslation();
  const { currentMunicipality } = useMunicipality();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [photo, setPhoto] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [quickCategory, setQuickCategory] = useState<string | null>(null);
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [street, setStreet] = useState('');
  const [locating, setLocating] = useState(false);
  const [nearby, setNearby] = useState<NearbyIncident[]>([]);
  const [voted, setVoted] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedIncident | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const muniSlug = currentMunicipality?.slug ?? 'lucainena';
  const center = useMemo<[number, number]>(
    () => [currentMunicipality?.center_lat ?? 37.0408, currentMunicipality?.center_lng ?? -2.1995],
    [currentMunicipality]
  );
  const effective: [number, number] = position ?? center;

  useEffect(() => {
    const desc = searchParams.get('desc');
    if (desc) setDescription(desc);
  }, [searchParams]);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setVoiceSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    setPosition(null);
    setNearby([]);
    setVoted(null);
  }, [muniSlug]);

  // Avisos cercanos (< 150 m) para evitar duplicados
  useEffect(() => {
    if (step !== 2) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          municipalityId: muniSlug,
          lat: String(effective[0]),
          lng: String(effective[1]),
        });
        if (quickCategory) params.set('category', quickCategory);
        const res = await fetch(`/api/incidents/nearby?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('nearby');
        const data = (await res.json()) as { incidents: NearbyIncident[] };
        if (active) setNearby(data.incidents ?? []);
      } catch {
        if (active) setNearby([]);
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [step, muniSlug, effective[0], effective[1], quickCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMapChange = useCallback((lat: number, lng: number) => {
    setPosition([lat, lng]);
    setVoted(null);
  }, []);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await fileToCompressedDataUrl(file));
    } catch {
      setError(t('incident.errorGeneric'));
    }
    e.target.value = '';
  }

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
      | (new () => SpeechRecognitionLike)
      | undefined;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = SPEECH_LANGS[lang] ?? 'es-ES';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const transcript = ev.results[0]?.[0]?.transcript ?? '';
      if (transcript) setDescription((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  function useGps() {
    if (!('geolocation' in navigator)) {
      setError(t('incident.gpsError'));
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        setVoted(null);
        setLocating(false);
      },
      () => {
        setError(t('incident.gpsError'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function goNext() {
    if (description.trim().length < 5) {
      setError(t('incident.descTooShort'));
      return;
    }
    setError(null);
    setStep(2);
  }

  async function confirmSame(incident: NearbyIncident) {
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(incident.id)}/upvote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ municipalityId: muniSlug }),
      });
      if (!res.ok) throw new Error('vote');
      setVoted(incident.tracking_code);
    } catch {
      setError(t('incident.errorGeneric'));
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          municipalityId: muniSlug,
          description: description.trim(),
          lat: effective[0],
          lng: effective[1],
          addressLabel: street.trim(),
          imageBase64: photo ?? undefined,
          categoryHint: quickCategory ?? undefined,
        }),
      });
      const data = (await res.json()) as { incident?: CreatedIncident; error?: string };
      if (!res.ok || !data.incident) throw new Error(data.error || 'error');
      setResult(data.incident);
      setStep(3);
    } catch {
      setError(t('incident.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setStep(1);
    setPhoto(null);
    setDescription('');
    setQuickCategory(null);
    setPosition(null);
    setStreet('');
    setNearby([]);
    setVoted(null);
    setResult(null);
    setError(null);
  }

  const primaryBtn =
    'min-h-[56px] px-8 rounded-2xl font-bold text-lg inline-flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 hover:opacity-95';

  return (
    <div className="flex flex-col gap-8 max-w-3xl mx-auto w-full">
      <section className="rounded-3xl bg-terracota text-tarjeta p-6 sm:p-8 a11y-card">
        <p className="text-sm font-bold uppercase tracking-wide text-tarjeta/85">
          {t('incident.stepLabel', { n: step })}
        </p>
        <h1 className="font-heading font-bold text-3xl mt-1">
          {step === 1 ? t('incident.step1Title') : step === 2 ? t('incident.step2Title') : t('incident.step3Title')}
        </h1>
        <div className="mt-4 flex gap-2" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`h-2 flex-1 rounded-full ${n <= step ? 'bg-tarjeta' : 'bg-tarjeta/30'}`} />
          ))}
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-2xl bg-terracota/10 border border-terracota/40 p-4 font-semibold text-terracota">
          {error}
        </div>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-6">
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-4 a11y-card">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
            {photo ? (
              <div className="flex flex-col gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt={t('incident.photoAlt')} className="w-full max-h-72 object-cover rounded-2xl" />
                <div className="flex flex-wrap gap-4">
                  <button type="button" onClick={() => fileRef.current?.click()} className={`${primaryBtn} bg-superficie text-tinta`}>
                    <Camera className="w-5 h-5" aria-hidden="true" />
                    {t('incident.photoChange')}
                  </button>
                  <button type="button" onClick={() => setPhoto(null)} className={`${primaryBtn} bg-tarjeta border border-superficie text-tinta`}>
                    {t('incident.photoRemove')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="min-h-[120px] rounded-3xl bg-terracota/10 border-2 border-dashed border-terracota text-terracota font-heading font-bold text-xl flex flex-col items-center justify-center gap-3 hover:bg-terracota/15 transition-colors"
              >
                <Camera className="w-10 h-10" aria-hidden="true" />
                {t('incident.photoBtn')}
              </button>
            )}

            <label htmlFor="incident-desc" className="font-semibold text-tinta">
              {t('incident.descLabel')}
            </label>
            <textarea
              id="incident-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder={t('incident.descPlaceholder')}
              className="w-full rounded-2xl bg-arena border border-superficie p-4 text-lg text-tinta placeholder:text-tinta/50 focus:outline-none focus:ring-2 focus:ring-terracota"
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleDictation}
                aria-pressed={listening}
                className={`${primaryBtn} ${listening ? 'bg-terracota text-tarjeta' : 'bg-superficie text-tinta'}`}
              >
                {listening ? <MicOff className="w-5 h-5" aria-hidden="true" /> : <Mic className="w-5 h-5" aria-hidden="true" />}
                {listening ? t('incident.dictating') : t('incident.dictate')}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <h2 className="font-heading font-bold text-xl text-tinta">{t('incident.quickTitle')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {QUICK_CARDS.map((card) => {
                const Icon = card.icon;
                const active = quickCategory === card.category;
                return (
                  <button
                    key={card.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setQuickCategory(active ? null : card.category)}
                    className={`min-h-[110px] rounded-3xl p-4 flex flex-col items-center justify-center gap-2 font-semibold text-center transition-all ${card.color} ${
                      active ? 'ring-4 ring-tinta scale-[1.02]' : 'opacity-90 hover:opacity-100'
                    }`}
                  >
                    <Icon className="w-8 h-8" aria-hidden="true" />
                    {t(`incident.quick.${card.key}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={goNext} className={`${primaryBtn} bg-terracota text-tarjeta`}>
              {t('incident.next')}
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-6">
          <button type="button" onClick={useGps} disabled={locating} className={`${primaryBtn} bg-azulMed text-tarjeta w-full`}>
            <LocateFixed className="w-6 h-6" aria-hidden="true" />
            {locating ? t('incident.gpsLocating') : t('incident.gpsBtn')}
          </button>

          <div className="flex flex-col gap-3">
            <IncidentMap center={center} position={effective} onChange={handleMapChange} />
            <p className="text-sm text-tinta/70">{t('incident.mapHint')}</p>
          </div>

          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-col gap-3 a11y-card">
            <label htmlFor="incident-street" className="font-semibold text-tinta">
              {t('incident.streetLabel')}
            </label>
            <input
              id="incident-street"
              type="text"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder={t('incident.streetPlaceholder')}
              className="min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 text-base text-tinta placeholder:text-tinta/50 focus:outline-none focus:ring-2 focus:ring-terracota"
            />
          </div>

          {nearby.length > 0 && (
            <div className="rounded-3xl bg-solAlmeria/25 border-2 border-solAlmeria p-6 flex flex-col gap-4 a11y-card">
              <h2 className="font-heading font-bold text-xl text-tinta flex items-center gap-2">
                <Users className="w-6 h-6 shrink-0" aria-hidden="true" />
                {t('incident.similarTitle')}
              </h2>
              {nearby.slice(0, 2).map((inc) => (
                <div key={inc.id} className="rounded-2xl bg-tarjeta p-4 flex flex-col gap-3">
                  <p className="font-semibold text-tinta">
                    {inc.tracking_code} · {inc.title}
                  </p>
                  <p className="text-sm text-tinta/75">
                    {t('incident.similarVotes', { n: inc.upvotes })} · {inc.distance_m} m
                  </p>
                  {voted === inc.tracking_code ? (
                    <p className="font-semibold text-verdeCabo flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                      {t('incident.similarThanks', { code: inc.tracking_code })}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void confirmSame(inc)}
                      className={`${primaryBtn} bg-verdeCabo text-tarjeta`}
                    >
                      {t('incident.similarBtn')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-4">
            <button type="button" onClick={() => setStep(1)} className={`${primaryBtn} bg-superficie text-tinta`}>
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              {t('incident.back')}
            </button>
            <button type="button" onClick={() => void submit()} disabled={submitting} className={`${primaryBtn} bg-terracota text-tarjeta`}>
              <Send className="w-5 h-5" aria-hidden="true" />
              {submitting ? t('incident.sending') : t('incident.sendBtn')}
            </button>
          </div>
        </section>
      )}

      {step === 3 && result && (
        <section className="flex flex-col gap-6">
          <div className="rounded-3xl bg-tarjeta border-2 border-azulMed p-8 text-center flex flex-col gap-3 a11y-card">
            <p className="font-semibold text-tinta/75">{t('incident.codeLabel')}</p>
            <p className="font-heading font-bold text-5xl sm:text-6xl text-azulMed tracking-wide break-all">
              {result.tracking_code}
            </p>
            <p className="text-tinta/80">{t('incident.codeHint')}</p>
          </div>

          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-4 a11y-card">
            <h2 className="font-heading font-bold text-xl text-tinta">{t('incident.summaryTitle')}</h2>
            <p className="text-lg font-semibold text-tinta">{result.title}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-arena p-4">
                <dt className="text-xs font-semibold uppercase text-tinta/65">{t('incident.category')}</dt>
                <dd className="mt-1 font-bold text-tinta">{result.category}</dd>
              </div>
              <div className="rounded-2xl bg-arena p-4">
                <dt className="text-xs font-semibold uppercase text-tinta/65">{t('incident.urgency')}</dt>
                <dd className="mt-1">
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${urgencyClass(result.urgency)}`}>
                    {t(`incident.urgencyLevels.${result.urgency}`)}
                  </span>
                </dd>
              </div>
              <div className="rounded-2xl bg-arena p-4">
                <dt className="text-xs font-semibold uppercase text-tinta/65">{t('incident.department')}</dt>
                <dd className="mt-1 font-bold text-tinta">{result.department}</dd>
              </div>
            </dl>
            {result.ai_reasoning && (
              <p className="rounded-2xl bg-verdeCabo/10 border border-verdeCabo/30 p-4 text-sm text-tinta/85">
                <strong>{t('incident.reason')}: </strong>
                {result.ai_reasoning}
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/" className={`${primaryBtn} bg-azulMed text-tarjeta`}>
              {t('incident.backHome')}
            </Link>
            <button type="button" onClick={reset} className={`${primaryBtn} bg-superficie text-tinta`}>
              {t('incident.newReport')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export default function IncidentPage() {
  return (
    <Suspense fallback={null}>
      <IncidentWizard />
    </Suspense>
  );
}
