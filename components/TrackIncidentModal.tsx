'use client';

import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  Star,
  Wrench,
  X,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';

export type IncidentStatus =
  | 'RECIBIDO'
  | 'VISTO'
  | 'ASIGNADO'
  | 'EN_CURSO'
  | 'RESUELTO'
  | 'PENDIENTE'
  | 'EN_REVISION'
  | 'RESUELTA';

export interface IncidentHistoryItem {
  status: string;
  timestamp: string;
  actor: string;
  note?: string;
}

export interface TrackedIncident {
  id: string;
  tracking_code: string;
  title: string;
  description: string;
  address_label: string | null;
  category: string;
  urgency: string;
  department: string;
  status: IncidentStatus;
  upvotes: number;
  internal_notes: string | null;
  resolved_photo_url?: string | null;
  citizen_rating?: number | null;
  citizen_feedback?: string | null;
  reopened_count?: number;
  viewed_at?: string | null;
  resolved_at?: string | null;
  history?: IncidentHistoryItem[];
  created_at: string;
  updated_at: string;
}

interface TrackIncidentModalProps {
  open: boolean;
  onClose: () => void;
  municipalitySlug: string;
  municipalityName: string;
  sampleCodes: string[];
}

const STATUS_ORDER = [
  'RECIBIDO',
  'VISTO',
  'ASIGNADO',
  'EN_CURSO',
  'RESUELTO',
] as const;

function normalizeStatus(status: IncidentStatus): (typeof STATUS_ORDER)[number] {
  switch (status) {
    case 'PENDIENTE':
    case 'RECIBIDO':
      return 'RECIBIDO';
    case 'EN_REVISION':
    case 'VISTO':
      return 'VISTO';
    case 'ASIGNADO':
      return 'ASIGNADO';
    case 'EN_CURSO':
      return 'EN_CURSO';
    case 'RESUELTA':
    case 'RESUELTO':
      return 'RESUELTO';
    default:
      return 'RECIBIDO';
  }
}

function urgencyBadgeClass(urgency: string): string {
  switch (urgency) {
    case 'EMERGENCIA_112':
    case 'URGENTE':
    case 'CRITICA':
      return 'bg-terracota text-tarjeta';
    case 'ALTA':
      return 'bg-solAlmeria text-tinta';
    case 'MEDIA':
      return 'bg-azulMed/15 text-azulMed';
    default:
      return 'bg-superficie text-tinta';
  }
}

export function TrackIncidentModal({
  open,
  onClose,
  municipalitySlug,
  municipalityName,
  sampleCodes,
}: TrackIncidentModalProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incident, setIncident] = useState<TrackedIncident | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    setIncident(null);
    setError(null);
    setCode('');
    setFeedbackMsg(null);
  }, [municipalitySlug]);

  if (!open) return null;

  async function lookupCode(targetCode: string) {
    const clean = targetCode.trim().toUpperCase();
    if (!clean) return;
    setCode(clean);
    setLoading(true);
    setError(null);
    setIncident(null);
    setFeedbackMsg(null);

    try {
      const params = new URLSearchParams({
        code: clean,
        municipalityId: municipalitySlug,
      });
      const res = await fetch(`/api/incidents/track?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        found?: boolean;
        incident?: TrackedIncident;
        error?: string;
      };

      if (!res.ok || !data.found || !data.incident) {
        setError(data.error || t('home.trackModal.notFound'));
      } else {
        setIncident(data.incident);
      }
    } catch {
      setError(t('home.trackModal.notFound'));
    } finally {
      setLoading(false);
    }
  }

  async function handleRate(stars: number) {
    if (!incident || ratingBusy) return;
    setRatingBusy(true);
    try {
      const res = await fetch(
        `/api/incidents/${encodeURIComponent(incident.id)}/feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'RATE',
            rating: stars,
            municipalityId: municipalitySlug,
          }),
        }
      );
      if (res.ok) {
        setIncident({ ...incident, citizen_rating: stars });
        setFeedbackMsg(`¡Gracias por valorar con ${stars}/5 estrellas!`);
      }
    } finally {
      setRatingBusy(false);
    }
  }

  async function handleReopen() {
    if (!incident || ratingBusy) return;
    setRatingBusy(true);
    try {
      const res = await fetch(
        `/api/incidents/${encodeURIComponent(incident.id)}/feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'REOPEN',
            feedback: 'Sigue sin funcionar correctamente',
            municipalityId: municipalitySlug,
          }),
        }
      );
      if (res.ok) {
        setIncident({
          ...incident,
          status: 'EN_CURSO',
          urgency: 'URGENTE',
          reopened_count: (incident.reopened_count ?? 0) + 1,
        });
        setFeedbackMsg(
          'Hemos reabierto el aviso con prioridad URGENTE para que el equipo vuelva a revisarlo.'
        );
      }
    } finally {
      setRatingBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void lookupCode(code);
  }

  const normalizedStatus = incident ? normalizeStatus(incident.status) : null;
  const activeStepIndex = normalizedStatus
    ? STATUS_ORDER.indexOf(normalizedStatus)
    : -1;

  const timelineSteps = [
    { key: 'RECIBIDO', label: t('home.trackModal.steps.received'), icon: Clock },
    { key: 'VISTO', label: 'Visto', icon: Eye },
    { key: 'ASIGNADO', label: 'Asignado', icon: ClipboardCheck },
    { key: 'EN_CURSO', label: t('home.trackModal.steps.inProgress'), icon: Wrench },
    { key: 'RESUELTO', label: t('home.trackModal.steps.resolved'), icon: CheckCircle2 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-tinta/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="track-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-2xl a11y-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h2
              id="track-modal-title"
              className="font-heading font-bold text-2xl text-tinta"
            >
              {t('home.trackModal.title')}
            </h2>
            <p className="text-sm sm:text-base text-tinta/75 mt-1">
              {t('home.trackModal.subtitle')} ·{' '}
              <strong className="text-tinta">{municipalityName}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('home.detailModal.close')}
            className="min-w-[44px] min-h-[44px] rounded-2xl bg-superficie/70 hover:bg-superficie text-tinta flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 mb-5">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t('home.trackModal.placeholder')}
            aria-label={t('home.trackModal.title')}
            className="flex-1 min-h-[50px] rounded-2xl bg-arena border border-superficie px-4 text-lg font-heading font-bold tracking-wide text-tinta placeholder:text-tinta/40 focus:outline-none focus:ring-2 focus:ring-azulMed"
          />
          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="min-h-[50px] px-6 rounded-2xl bg-azulMed text-tarjeta font-semibold inline-flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 transition-opacity shrink-0"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t('home.trackModal.searching')}</span>
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                <span>{t('home.trackModal.searchBtn')}</span>
              </>
            )}
          </button>
        </form>

        {sampleCodes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 mb-6">
            <span className="text-xs sm:text-sm font-medium text-tinta/70">
              {t('home.trackModal.trySamples')}
            </span>
            {sampleCodes.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => void lookupCode(sample)}
                className="px-3.5 py-1.5 rounded-full bg-superficie/80 hover:bg-azulMed hover:text-tarjeta text-xs sm:text-sm font-bold text-tinta transition-colors"
              >
                {sample}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-terracota/10 border border-terracota/40 p-4 text-sm font-semibold text-terracota">
            {error}
          </div>
        )}

        {incident && (
          <div className="rounded-3xl bg-arena/70 border border-superficie p-5 sm:p-6 flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="px-3.5 py-1.5 rounded-full bg-azulMed text-tarjeta font-heading font-bold text-sm">
                {incident.tracking_code}
              </span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${urgencyBadgeClass(
                  incident.urgency
                )}`}
              >
                {t('home.trackModal.urgency')}: {incident.urgency}
              </span>
            </div>

            <div>
              <h3 className="font-heading font-bold text-xl text-tinta">
                {incident.title}
              </h3>
              <p className="text-sm sm:text-base text-tinta/80 mt-1 leading-relaxed">
                {incident.description}
              </p>
            </div>

            {incident.urgency === 'EMERGENCIA_112' && (
              <div
                role="alert"
                className="rounded-2xl bg-terracota text-tarjeta p-4 font-heading font-bold text-sm sm:text-base shadow-sm"
              >
                ⚠️ Peligro inmediato: llama al 112 ahora mismo (Policía Local asignada)
              </div>
            )}

            {/* Línea temporal visual de 5 estados */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {timelineSteps.map((step, idx) => {
                const Icon = step.icon;
                const isDone = idx <= activeStepIndex;
                const isCurrent = idx === activeStepIndex;
                return (
                  <div
                    key={step.key}
                    className={`rounded-2xl p-3 border flex flex-col items-center text-center gap-1.5 transition-colors ${
                      isCurrent
                        ? 'bg-verdeCabo text-tarjeta border-verdeCabo shadow-sm'
                        : isDone
                        ? 'bg-verdeCabo/15 text-tinta border-verdeCabo/40'
                        : 'bg-tarjeta text-tinta/50 border-superficie'
                    }`}
                  >
                    <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                    <span className="text-xs font-bold leading-tight">
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-2xl bg-tarjeta border border-superficie p-3">
                <dt className="text-xs font-semibold text-tinta/60">
                  {t('home.trackModal.category')}
                </dt>
                <dd className="font-semibold text-tinta mt-0.5">{incident.category}</dd>
              </div>
              <div className="rounded-2xl bg-tarjeta border border-superficie p-3">
                <dt className="text-xs font-semibold text-tinta/60">
                  {t('home.trackModal.department')}
                </dt>
                <dd className="font-semibold text-tinta mt-0.5">{incident.department}</dd>
              </div>
              <div className="rounded-2xl bg-tarjeta border border-superficie p-3">
                <dt className="text-xs font-semibold text-tinta/60">
                  {t('home.trackModal.location')}
                </dt>
                <dd className="font-semibold text-tinta mt-0.5 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-terracota shrink-0" />
                  <span className="truncate">
                    {incident.address_label || municipalityName}
                  </span>
                </dd>
              </div>
            </dl>

            {incident.internal_notes && (
              <div className="rounded-2xl bg-tarjeta border border-verdeCabo/30 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-verdeCabo mb-1">
                  {t('home.trackModal.note')}
                </p>
                <p className="text-sm text-tinta/85">{incident.internal_notes}</p>
              </div>
            )}

            {incident.history && incident.history.length > 0 && (
              <div className="rounded-2xl bg-tarjeta border border-superficie p-4 flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-tinta/70">
                  Historial de auditoría y cambios de estado
                </p>
                <ul className="flex flex-col gap-1.5 text-xs text-tinta/85">
                  {incident.history.map((h, idx) => (
                    <li
                      key={`${h.status}-${idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-arena px-3 py-2"
                    >
                      <span>
                        <strong>{h.status}</strong> · {h.actor}
                        {h.note ? ` — ${h.note}` : ''}
                      </span>
                      <span className="text-tinta/65 font-semibold">
                        {new Date(h.timestamp).toLocaleString('es-ES', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {incident.resolved_photo_url && (
              <div className="rounded-2xl bg-tarjeta border border-superficie p-4 flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-verdeCabo">
                  Foto de cierre adjuntada por el operario
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={incident.resolved_photo_url}
                  alt="Foto de resolución"
                  className="w-full max-h-56 object-cover rounded-xl"
                />
              </div>
            )}

            {normalizedStatus === 'RESUELTO' && (
              <div className="rounded-2xl bg-tarjeta border border-superficie p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-tinta">
                      ¿Ha quedado bien resuelto?
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          disabled={ratingBusy}
                          onClick={() => void handleRate(star)}
                          aria-label={`Valorar con ${star} estrellas`}
                          className={`p-1.5 rounded-xl transition-colors ${
                            (incident.citizen_rating ?? 0) >= star
                              ? 'text-solAlmeria bg-solAlmeria/15'
                              : 'text-tinta/40 hover:text-solAlmeria'
                          }`}
                        >
                          <Star className="w-5 h-5 fill-current" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={ratingBusy}
                    onClick={() => void handleReopen()}
                    className="min-h-[44px] px-4 py-2 rounded-2xl bg-terracota text-tarjeta text-sm font-bold inline-flex items-center gap-2 hover:opacity-95 transition-opacity"
                  >
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    <span>Sigue sin funcionar</span>
                  </button>
                </div>

                {feedbackMsg && (
                  <p className="text-xs font-semibold text-verdeCabo">{feedbackMsg}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
