'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Accessibility,
  AlertTriangle,
  Baby,
  BellRing,
  CheckCircle2,
  Gift,
  HeartHandshake,
  Home,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  Minus,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

type IncomeBracket = 'LOW' | 'MEDIUM' | 'HIGH';

interface MatchedAidItem {
  id: string;
  title: string;
  description: string;
  discountLabel: string;
  deadline: string | null;
  matchReasons: string[];
}

interface StreetAlertItem {
  id: string;
  title: string;
  message: string;
  affectedStreets: string[];
  startDate: string;
  endDate: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

interface NotificationItem {
  id: string;
  type: 'STREET_ALERT' | 'AID_MATCH' | 'INCIDENT_UPDATE';
  title: string;
  body: string;
  ref_id: string | null;
  is_read: number;
  created_at: string;
}

interface UserIncidentItem {
  id: string;
  tracking_code: string;
  title: string;
  address_label: string | null;
  category: string;
  urgency: string;
  department: string;
  status: string;
  internal_notes: string | null;
  viewed_at?: string | null;
  resolved_at?: string | null;
  history?: Array<{
    status: string;
    timestamp: string;
    actor: string;
    note?: string;
  }>;
}

interface ProfileApiPayload {
  authenticated: boolean;
  user?: {
    userId: string;
    name: string;
    email: string;
    role: 'CITIZEN' | 'ADMIN' | 'DEPARTMENT';
    municipalityId: string;
    municipalitySlug: string;
    municipalityName: string;
  };
  municipality?: {
    id: string;
    slug: string;
    name: string;
    province: string;
    streets: string[];
  };
  profile?: {
    streetName: string;
    neighborhood: string;
    householdSize: number;
    hasChildren: boolean;
    largeFamily: boolean;
    hasSeniorsOrDependents: boolean;
    reducedMobility: boolean;
    incomeBracket: IncomeBracket;
    whatsappPhone: string;
    notificationsOptIn: boolean;
  };
  matchedAids?: MatchedAidItem[];
  matchingStreetAlerts?: StreetAlertItem[];
  notifications?: NotificationItem[];
  myIncidents?: UserIncidentItem[];
}

export default function MiPerfilPage() {
  const { t } = useTranslation();
  const { setMunicipalityBySlug } = useMunicipality();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirmDeleteRgpd, setConfirmDeleteRgpd] = useState(false);
  const [deletingRgpd, setDeletingRgpd] = useState(false);
  const [deletedBanner, setDeletedBanner] = useState<string | null>(null);
  const [data, setData] = useState<ProfileApiPayload | null>(null);

  // Estado editable de la encuesta de hogar
  const [streetSelect, setStreetSelect] = useState('');
  const [customStreet, setCustomStreet] = useState('');
  const [householdSize, setHouseholdSize] = useState(2);
  const [largeFamily, setLargeFamily] = useState(false);
  const [hasChildren, setHasChildren] = useState(false);
  const [hasSeniorsOrDependents, setHasSeniorsOrDependents] = useState(false);
  const [reducedMobility, setReducedMobility] = useState(false);
  const [incomeBracket, setIncomeBracket] = useState<IncomeBracket>('MEDIUM');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [notificationsOptIn, setNotificationsOptIn] = useState(true);

  const hydrateForm = useCallback((payload: ProfileApiPayload) => {
    setData(payload);
    if (payload.profile && payload.municipality) {
      const streets = payload.municipality.streets ?? [];
      const currentStreet = payload.profile.streetName ?? '';
      if (!currentStreet || streets.includes(currentStreet)) {
        setStreetSelect(currentStreet || streets[0] || '');
        setCustomStreet('');
      } else {
        setStreetSelect('__CUSTOM__');
        setCustomStreet(currentStreet);
      }
      setHouseholdSize(payload.profile.householdSize || 1);
      setLargeFamily(payload.profile.largeFamily);
      setHasChildren(payload.profile.hasChildren);
      setHasSeniorsOrDependents(payload.profile.hasSeniorsOrDependents);
      setReducedMobility(payload.profile.reducedMobility);
      setIncomeBracket(payload.profile.incomeBracket || 'MEDIUM');
      setWhatsappPhone(payload.profile.whatsappPhone || '');
      setNotificationsOptIn(payload.profile.notificationsOptIn);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/profile', { cache: 'no-store' });
      if (res.status === 401) {
        setData({ authenticated: false });
        return;
      }
      const json = (await res.json()) as ProfileApiPayload;
      hydrateForm(json);
    } catch {
      setData({ authenticated: false });
    } finally {
      setLoading(false);
    }
  }, [hydrateForm]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function handleQuickDemo(email: string, muniSlug: string) {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: '1234',
          municipalityId: muniSlug,
        }),
      });
      if (res.ok) {
        setMunicipalityBySlug(muniSlug);
        window.dispatchEvent(new Event('almeriacerca-auth-changed'));
        await loadProfile();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('almeriacerca-auth-changed'));
    setData({ authenticated: false });
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);

    const finalStreet =
      streetSelect === '__CUSTOM__' ? customStreet.trim() : streetSelect;

    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streetName: finalStreet,
          householdSize,
          largeFamily,
          hasChildren,
          hasSeniorsOrDependents,
          reducedMobility,
          incomeBracket,
          whatsappPhone,
          notificationsOptIn,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as ProfileApiPayload;
        hydrateForm(updated);
        setSaveSuccess(true);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkAllRead() {
    await fetch('/api/notifications/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (data?.notifications) {
      setData({
        ...data,
        notifications: data.notifications.map((n) => ({ ...n, is_read: 1 })),
      });
    }
  }

  async function handleDeleteMyDataRgpd() {
    setDeletingRgpd(true);
    try {
      const res = await fetch('/api/profile', { method: 'DELETE' });
      const json = (await res.json()) as { message?: string };
      window.dispatchEvent(new Event('almeriacerca-auth-changed'));
      setConfirmDeleteRgpd(false);
      setDeletedBanner(
        json.message ||
          'Tus datos personales, perfil de hogar y notificaciones han sido eliminados conforme al RGPD.'
      );
      setData({ authenticated: false });
    } finally {
      setDeletingRgpd(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6 max-w-5xl mx-auto">
        <div className="h-40 rounded-3xl bg-superficie/70 animate-pulse" />
        <div className="h-64 rounded-3xl bg-superficie/70 animate-pulse" />
      </div>
    );
  }

  if (!data?.authenticated || !data.user) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-8">
        {deletedBanner && (
          <div
            role="status"
            className="rounded-3xl bg-verdeCabo text-tarjeta p-5 font-semibold flex items-center gap-3 shadow-sm a11y-card"
          >
            <CheckCircle2 className="w-6 h-6 shrink-0" aria-hidden="true" />
            <span>{deletedBanner}</span>
          </div>
        )}
        <section className="rounded-3xl bg-buganvilla text-tarjeta p-7 sm:p-10 shadow-sm flex flex-col gap-5 a11y-card">
          <span className="w-14 h-14 rounded-2xl bg-tarjeta/20 flex items-center justify-center">
            <BellRing className="w-8 h-8" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-heading font-bold text-3xl">
              {t('profile.guestTitle')}
            </h1>
            <p className="mt-2 text-base sm:text-lg text-tarjeta/90 leading-relaxed">
              {t('profile.guestSubtitle')}
            </p>
          </div>
          <div className="flex flex-wrap gap-4 pt-2">
            <Link
              href="/login"
              className="min-h-[54px] px-7 rounded-2xl bg-tarjeta text-buganvilla font-heading font-bold text-lg inline-flex items-center justify-center gap-2 hover:opacity-95 transition-opacity"
            >
              <LogIn className="w-5 h-5" aria-hidden="true" />
              <span>{t('profile.guestLoginCta')}</span>
            </Link>
          </div>
        </section>

        <section className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-col gap-4 a11y-card">
          <p className="text-sm font-bold text-tinta/80 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-terracota" aria-hidden="true" />
            <span>{t('login.demoTitle')}</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void handleQuickDemo('vecino@lucainena.es', 'lucainena')}
              className="min-h-[48px] px-4 py-2.5 rounded-2xl bg-arena border border-superficie hover:bg-buganvilla hover:text-tarjeta font-semibold text-sm text-tinta transition-colors"
            >
              Entrar como Vecino Lucainena
            </button>
            <button
              type="button"
              onClick={() => void handleQuickDemo('vecino@nijar.es', 'nijar')}
              className="min-h-[48px] px-4 py-2.5 rounded-2xl bg-arena border border-superficie hover:bg-buganvilla hover:text-tarjeta font-semibold text-sm text-tinta transition-colors"
            >
              Entrar como Vecino Níjar
            </button>
          </div>
        </section>
      </div>
    );
  }

  const streets = data.municipality?.streets ?? [];
  const matchedAids = data.matchedAids ?? [];
  const streetAlerts = data.matchingStreetAlerts ?? [];
  const notifications = data.notifications ?? [];
  const myIncidents = data.myIncidents ?? [];
  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const isAdmin =
    data.user.role === 'ADMIN' || data.user.role === 'DEPARTMENT';

  return (
    <div className="flex flex-col gap-10">
      {/* Cabecera de Perfil */}
      <section className="rounded-3xl bg-buganvilla text-tarjeta p-6 sm:p-8 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 a11y-card">
        <div>
          <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-tarjeta/20 text-xs font-bold uppercase tracking-wide mb-2">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            {data.user.municipalityName}
          </span>
          <h1 className="font-heading font-bold text-3xl">
            {t('profile.welcomeUser', { name: data.user.name })}
          </h1>
          <p className="mt-1 text-base text-tarjeta/90">
            {t('profile.welcomeSubtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <Link
              href="/admin"
              className="min-h-[48px] px-5 rounded-2xl bg-tinta text-tarjeta font-semibold inline-flex items-center gap-2 hover:opacity-95 transition-opacity"
            >
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              <span>{t('nav.adminPanel')}</span>
            </Link>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="min-h-[48px] px-5 rounded-2xl bg-tarjeta text-buganvilla font-bold inline-flex items-center gap-2 hover:opacity-95 transition-opacity"
          >
            <LogOut className="w-5 h-5" aria-hidden="true" />
            <span>{t('profile.logout')}</span>
          </button>
        </div>
      </section>

      {saveSuccess && (
        <div
          role="status"
          className="rounded-3xl bg-verdeCabo text-tarjeta p-5 font-semibold flex items-center gap-3 shadow-sm a11y-card"
        >
          <CheckCircle2 className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>{t('profile.savedBanner')}</span>
        </div>
      )}

      {/* SECCIÓN 1 — Tus Avisos Personalizados */}
      <section aria-labelledby="section-alerts-title" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2
              id="section-alerts-title"
              className="font-heading font-bold text-2xl text-tinta flex items-center gap-2.5"
            >
              <BellRing className="w-6 h-6 text-terracota" aria-hidden="true" />
              <span>{t('profile.section1Title')}</span>
            </h2>
            <p className="text-sm sm:text-base text-tinta/75 mt-1">
              {t('profile.section1Subtitle', {
                street: data.profile?.streetName || data.user.municipalityName,
              })}
            </p>
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="min-h-[44px] px-4 rounded-2xl bg-superficie text-tinta text-sm font-semibold hover:bg-superficie/80 transition-colors"
            >
              {t('profile.markAllRead')} ({unreadCount})
            </button>
          )}
        </div>

        {/* Alertas de corte en su calle */}
        {streetAlerts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {streetAlerts.map((alert) => (
              <div
                key={alert.id}
                className="rounded-3xl bg-tarjeta border-2 border-terracota p-6 shadow-sm flex flex-col gap-3 a11y-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-terracota text-tarjeta text-xs font-bold uppercase">
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('profile.streetAlertBadge')}
                  </span>
                  <span className="text-xs font-semibold text-tinta/70">
                    {alert.startDate} → {alert.endDate}
                  </span>
                </div>
                <h3 className="font-heading font-bold text-xl text-tinta">
                  {alert.title}
                </h3>
                <p className="text-sm sm:text-base text-tinta/85 leading-relaxed">
                  {alert.message}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {alert.affectedStreets.map((st) => (
                    <span
                      key={st}
                      className="px-3 py-1 rounded-full bg-arena border border-superficie text-xs font-bold text-tinta"
                    >
                      {st}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 text-tinta/75 a11y-card">
            {t('profile.noStreetAlerts', {
              street: data.profile?.streetName || 'tu calle',
            })}
          </div>
        )}

        {/* Incidencias reportadas por este vecino */}
        {myIncidents.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myIncidents.map((inc) => (
              <div
                key={inc.id}
                className="rounded-3xl bg-tarjeta border border-superficie p-5 flex flex-col gap-2 a11y-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="px-3 py-1 rounded-full bg-azulMed text-tarjeta text-xs font-bold">
                    {inc.tracking_code}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-superficie text-tinta text-xs font-bold">
                    {inc.status}
                  </span>
                </div>
                <p className="font-heading font-bold text-lg text-tinta">{inc.title}</p>
                <p className="text-xs text-tinta/70">
                  {inc.department} · {inc.address_label || data.user?.municipalityName}
                </p>
                {inc.internal_notes && (
                  <p className="text-sm text-verdeCabo font-medium mt-1">
                    {inc.internal_notes}
                  </p>
                )}
                {inc.history && inc.history.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-superficie flex flex-col gap-1">
                    <p className="text-[11px] font-bold uppercase text-tinta/60">
                      Historial de estados
                    </p>
                    {inc.history.map((h, hIdx) => (
                      <div
                        key={`${h.status}-${hIdx}`}
                        className="flex items-center justify-between text-xs text-tinta/80"
                      >
                        <span>
                          <strong>{h.status}</strong> · {h.actor}
                        </span>
                        <span className="text-tinta/60">
                          {new Date(h.timestamp).toLocaleString('es-ES', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECCIÓN 2 — Ayudas y Descuentos para Ti */}
      <section aria-labelledby="section-aids-title" className="flex flex-col gap-5">
        <div>
          <h2
            id="section-aids-title"
            className="font-heading font-bold text-2xl text-tinta flex items-center gap-2.5"
          >
            <Gift className="w-6 h-6 text-verdeCabo" aria-hidden="true" />
            <span>{t('profile.section2Title')}</span>
          </h2>
          <p className="text-sm sm:text-base text-tinta/75 mt-1">
            Información orientativa: estas convocatorias municipales <strong>podrían encajar contigo</strong> según tu encuesta de hogar (sujetas a verificación en el Ayuntamiento).
          </p>
        </div>

        {matchedAids.length === 0 ? (
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 text-tinta/75 a11y-card">
            {t('profile.noAidsMatched')}
          </div>
        ) : (
          <div className="columns-1 md:columns-2 lg:columns-3 gap-6">
            {matchedAids.map((aid) => (
              <div
                key={aid.id}
                className="break-inside-avoid mb-6 rounded-3xl bg-[#FDF5DF] border border-solAlmeria/80 p-6 shadow-sm flex flex-col gap-4 a11y-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="px-3.5 py-1.5 rounded-full bg-solAlmeria text-tinta font-heading font-bold text-sm">
                    {aid.discountLabel}
                  </span>
                  {aid.deadline && (
                    <span className="text-xs font-semibold text-tinta/70">
                      {aid.deadline}
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="font-heading font-bold text-xl text-tinta leading-snug">
                    {aid.title}
                  </h3>
                  <p className="mt-2 text-sm sm:text-base text-tinta/80 leading-relaxed">
                    {aid.description}
                  </p>
                </div>

                <ul className="flex flex-col gap-2">
                  {aid.matchReasons.map((reason) => (
                    <li
                      key={reason}
                      className="flex items-start gap-2 rounded-2xl bg-tarjeta/90 border border-superficie px-3.5 py-2 text-xs sm:text-sm font-semibold text-verdeCabo"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/asistente?q=${encodeURIComponent(
                    `Cómo pedir la ayuda ${aid.title} en ${data.user?.municipalityName}`
                  )}`}
                  className="min-h-[48px] px-5 py-2.5 rounded-2xl bg-verdeCabo text-tarjeta font-semibold text-sm inline-flex items-center justify-center gap-2 hover:opacity-95 transition-opacity"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{t('profile.askAssistantAid')}</span>
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECCIÓN 3 — Tu Encuesta de Hogar (Visual y Fácil) */}
      <section
        aria-labelledby="section-survey-title"
        className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-sm flex flex-col gap-6 a11y-card"
      >
        <div>
          <h2
            id="section-survey-title"
            className="font-heading font-bold text-2xl text-tinta flex items-center gap-2.5"
          >
            <Home className="w-6 h-6 text-buganvilla" aria-hidden="true" />
            <span>{t('profile.section3Title')}</span>
          </h2>
          <p className="text-sm sm:text-base text-tinta/75 mt-1">
            {t('profile.section3Subtitle')}
          </p>
        </div>

        <form onSubmit={handleSaveProfile} className="flex flex-col gap-6">
          {/* Calle y Contador de Integrantes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label htmlFor="profile-street" className="font-semibold text-tinta">
                {t('profile.streetLabel')}
              </label>
              <select
                id="profile-street"
                value={streetSelect}
                onChange={(e) => setStreetSelect(e.target.value)}
                className="min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 text-base font-semibold text-tinta focus:outline-none focus:ring-2 focus:ring-buganvilla"
              >
                {streets.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
                <option value="__CUSTOM__">{t('profile.streetCustomOption')}</option>
              </select>

              {streetSelect === '__CUSTOM__' && (
                <input
                  type="text"
                  value={customStreet}
                  onChange={(e) => setCustomStreet(e.target.value)}
                  placeholder={t('profile.streetCustomPlaceholder')}
                  className="mt-2 min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 text-base text-tinta focus:outline-none focus:ring-2 focus:ring-buganvilla"
                />
              )}
            </div>

            {/* Contador visual - / + de integrantes */}
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-tinta">
                {t('profile.householdSizeLabel')}
              </span>
              <div className="min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 py-2 flex items-center justify-between gap-4">
                <button
                  type="button"
                  aria-label="Restar integrante"
                  onClick={() => setHouseholdSize((n) => Math.max(1, n - 1))}
                  className="w-11 h-11 rounded-xl bg-tarjeta border border-superficie flex items-center justify-center text-tinta hover:bg-superficie transition-colors"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <span className="font-heading font-bold text-2xl text-tinta">
                  {householdSize}
                </span>
                <button
                  type="button"
                  aria-label="Sumar integrante"
                  onClick={() => setHouseholdSize((n) => Math.min(20, n + 1))}
                  className="w-11 h-11 rounded-xl bg-tarjeta border border-superficie flex items-center justify-center text-tinta hover:bg-superficie transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* 4 Tarjetas Toggle Grandes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              type="button"
              aria-pressed={largeFamily}
              onClick={() => setLargeFamily((v) => !v)}
              className={`min-h-[88px] rounded-3xl p-5 border-2 text-start flex items-center justify-between gap-4 transition-all ${
                largeFamily
                  ? 'bg-buganvilla/15 border-buganvilla text-tinta font-bold'
                  : 'bg-arena/70 border-superficie text-tinta hover:bg-superficie/60'
              }`}
            >
              <span className="flex items-center gap-3.5">
                <Users className="w-7 h-7 text-buganvilla shrink-0" aria-hidden="true" />
                <span className="text-base sm:text-lg">{t('profile.toggleLargeFamily')}</span>
              </span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  largeFamily ? 'bg-buganvilla text-tarjeta' : 'bg-tarjeta text-tinta/70'
                }`}
              >
                {largeFamily ? 'SÍ' : 'NO'}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={hasChildren}
              onClick={() => setHasChildren((v) => !v)}
              className={`min-h-[88px] rounded-3xl p-5 border-2 text-start flex items-center justify-between gap-4 transition-all ${
                hasChildren
                  ? 'bg-verdeCabo/15 border-verdeCabo text-tinta font-bold'
                  : 'bg-arena/70 border-superficie text-tinta hover:bg-superficie/60'
              }`}
            >
              <span className="flex items-center gap-3.5">
                <Baby className="w-7 h-7 text-verdeCabo shrink-0" aria-hidden="true" />
                <span className="text-base sm:text-lg">{t('profile.toggleChildren')}</span>
              </span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  hasChildren ? 'bg-verdeCabo text-tarjeta' : 'bg-tarjeta text-tinta/70'
                }`}
              >
                {hasChildren ? 'SÍ' : 'NO'}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={hasSeniorsOrDependents}
              onClick={() => setHasSeniorsOrDependents((v) => !v)}
              className={`min-h-[88px] rounded-3xl p-5 border-2 text-start flex items-center justify-between gap-4 transition-all ${
                hasSeniorsOrDependents
                  ? 'bg-azulMed/15 border-azulMed text-tinta font-bold'
                  : 'bg-arena/70 border-superficie text-tinta hover:bg-superficie/60'
              }`}
            >
              <span className="flex items-center gap-3.5">
                <HeartHandshake className="w-7 h-7 text-azulMed shrink-0" aria-hidden="true" />
                <span className="text-base sm:text-lg">{t('profile.toggleSeniors')}</span>
              </span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  hasSeniorsOrDependents ? 'bg-azulMed text-tarjeta' : 'bg-tarjeta text-tinta/70'
                }`}
              >
                {hasSeniorsOrDependents ? 'SÍ' : 'NO'}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={reducedMobility}
              onClick={() => setReducedMobility((v) => !v)}
              className={`min-h-[88px] rounded-3xl p-5 border-2 text-start flex items-center justify-between gap-4 transition-all ${
                reducedMobility
                  ? 'bg-terracota/15 border-terracota text-tinta font-bold'
                  : 'bg-arena/70 border-superficie text-tinta hover:bg-superficie/60'
              }`}
            >
              <span className="flex items-center gap-3.5">
                <Accessibility className="w-7 h-7 text-terracota shrink-0" aria-hidden="true" />
                <span className="text-base sm:text-lg">{t('profile.toggleMobility')}</span>
              </span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  reducedMobility ? 'bg-terracota text-tarjeta' : 'bg-tarjeta text-tinta/70'
                }`}
              >
                {reducedMobility ? 'SÍ' : 'NO'}
              </span>
            </button>
          </div>

          {/* Tramo orientativo de renta */}
          <div className="flex flex-col gap-2">
            <span className="font-semibold text-tinta">{t('profile.incomeLabel')}</span>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  { key: 'LOW', label: t('profile.incomeLow') },
                  { key: 'MEDIUM', label: t('profile.incomeMedium') },
                  { key: 'HIGH', label: t('profile.incomeHigh') },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={incomeBracket === opt.key}
                  onClick={() => setIncomeBracket(opt.key)}
                  className={`min-h-[50px] rounded-2xl font-semibold border transition-colors ${
                    incomeBracket === opt.key
                      ? 'bg-tinta text-tarjeta border-tinta'
                      : 'bg-arena text-tinta border-superficie hover:bg-superficie/60'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* WhatsApp opcional + toggle */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
            <div className="flex flex-col gap-2">
              <label htmlFor="profile-whatsapp" className="font-semibold text-tinta flex items-center gap-2">
                <Phone className="w-4 h-4 text-verdeCabo" aria-hidden="true" />
                {t('profile.whatsappLabel')}
              </label>
              <input
                id="profile-whatsapp"
                type="tel"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="+34 600 11 22 33"
                className="min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 text-base text-tinta focus:outline-none focus:ring-2 focus:ring-buganvilla"
              />
            </div>

            <button
              type="button"
              aria-pressed={notificationsOptIn}
              onClick={() => setNotificationsOptIn((v) => !v)}
              className={`min-h-[52px] rounded-2xl px-5 border font-semibold flex items-center justify-between gap-3 transition-colors ${
                notificationsOptIn
                  ? 'bg-verdeCabo/15 border-verdeCabo text-tinta'
                  : 'bg-arena border-superficie text-tinta/75'
              }`}
            >
              <span>{t('profile.whatsappOptIn')}</span>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-tarjeta border border-superficie">
                {notificationsOptIn ? 'SÍ' : 'NO'}
              </span>
            </button>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="w-full sm:w-auto min-h-[56px] px-8 rounded-2xl bg-buganvilla text-tarjeta font-heading font-bold text-lg inline-flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 transition-opacity"
            >
              {saving ? (
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="w-5 h-5" aria-hidden="true" />
              )}
              <span>{saving ? t('profile.saving') : t('profile.saveBtn')}</span>
            </button>
          </div>
        </form>
      </section>

      {/* SECCIÓN 4 — Privacidad y Derecho al Olvido (RGPD) */}
      <section
        aria-labelledby="section-rgpd-title"
        className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-6 a11y-card"
      >
        <div className="max-w-2xl">
          <h2
            id="section-rgpd-title"
            className="font-heading font-bold text-xl text-tinta flex items-center gap-2"
          >
            <Trash2 className="w-5 h-5 text-terracota" aria-hidden="true" />
            <span>Privacidad y Derecho al Olvido (RGPD)</span>
          </h2>
          <p className="text-sm text-tinta/75 mt-1">
            Puedes eliminar tus datos personales, perfil de hogar y alertas en cualquier momento con un solo clic (o escribiendo &ldquo;borrar mis datos&rdquo; en el asistente).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {!confirmDeleteRgpd ? (
            <button
              type="button"
              onClick={() => setConfirmDeleteRgpd(true)}
              className="min-h-[48px] px-6 rounded-2xl bg-terracota/15 text-terracota hover:bg-terracota hover:text-tarjeta font-bold text-sm inline-flex items-center gap-2 transition-colors"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              <span>Borrar mis datos</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={deletingRgpd}
                onClick={() => void handleDeleteMyDataRgpd()}
                className="min-h-[48px] px-6 rounded-2xl bg-terracota text-tarjeta font-bold text-sm inline-flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>
                  {deletingRgpd ? 'Eliminando...' : 'Confirmar borrado definitivo'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteRgpd(false)}
                className="min-h-[48px] px-4 rounded-2xl bg-superficie text-tinta font-semibold text-sm"
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
