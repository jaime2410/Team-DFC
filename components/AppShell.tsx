'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Accessibility,
  BookOpen,
  ChevronDown,
  Contrast,
  Globe,
  MapPin,
  ShieldCheck,
  Sun,
  Type,
  UserCircle2,
} from 'lucide-react';
import { SupportedLang, useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

interface A11yState {
  largeText: boolean;
  highContrast: boolean;
  easyRead: boolean;
}

interface AuthSessionInfo {
  userId: string;
  name: string;
  email: string;
  role: 'CITIZEN' | 'ADMIN' | 'DEPARTMENT';
  municipalitySlug: string;
  municipalityName: string;
}

const A11Y_STORAGE_KEY = 'almeriacerca_a11y';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { lang, setLang, t } = useTranslation();
  const { municipalities, currentMunicipality, setMunicipalityBySlug } = useMunicipality();
  const pathname = usePathname();

  const [a11yOpen, setA11yOpen] = useState(false);
  const [a11y, setA11y] = useState<A11yState>({
    largeText: false,
    highContrast: false,
    easyRead: false,
  });
  const [sessionUser, setSessionUser] = useState<AuthSessionInfo | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok) {
        setSessionUser(null);
        return;
      }
      const data = (await res.json()) as { user?: AuthSessionInfo | null };
      setSessionUser(data.user ?? null);
    } catch {
      setSessionUser(null);
    }
  }, []);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession, pathname]);

  useEffect(() => {
    const handler = () => {
      void fetchSession();
    };
    window.addEventListener('almeriacerca-auth-changed', handler);
    return () => window.removeEventListener('almeriacerca-auth-changed', handler);
  }, [fetchSession]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(A11Y_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<A11yState>;
        setA11y({
          largeText: Boolean(parsed.largeText),
          highContrast: Boolean(parsed.highContrast),
          easyRead: Boolean(parsed.easyRead),
        });
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('a11y-large-text', a11y.largeText);
    root.classList.toggle('a11y-high-contrast', a11y.highContrast);
    root.classList.toggle('a11y-easy-read', a11y.easyRead);
    try {
      window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(a11y));
    } catch {
      // Ignore storage errors
    }
  }, [a11y]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setA11yOpen(false);
      }
    }
    if (a11yOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [a11yOpen]);

  const activeCount = [a11y.largeText, a11y.highContrast, a11y.easyRead].filter(Boolean).length;
  const isAdmin =
    sessionUser?.role === 'ADMIN' || sessionUser?.role === 'DEPARTMENT';

  return (
    <div className="min-h-screen flex flex-col bg-arena text-tinta">
      <header className="sticky top-0 z-40 bg-tarjeta/95 backdrop-blur-md border-b border-superficie shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Identidad */}
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-terracota rounded-2xl p-1"
            >
              <span className="w-11 h-11 rounded-2xl bg-terracota text-tarjeta flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform shrink-0">
                <Sun className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <p className="font-heading font-bold text-xl leading-tight text-tinta">
                  {t('appName')}
                </p>
                <p className="text-xs sm:text-sm text-tinta/75 truncate">
                  {t('appTagline')}
                </p>
              </div>
            </Link>
          </div>

          {/* Controles espaciados y accesibles */}
          <nav
            aria-label="Controles principales"
            className="flex flex-wrap items-center gap-3 sm:gap-4"
          >
            {/* Selector de Municipio */}
            <div className="flex items-center gap-2 bg-superficie/70 border border-superficie rounded-2xl px-3 py-2 min-h-[44px] flex-1 sm:flex-initial">
              <MapPin className="w-4 h-4 text-terracota shrink-0" aria-hidden="true" />
              <label htmlFor="municipality-select" className="sr-only">
                {t('nav.municipalityLabel')}
              </label>
              <select
                id="municipality-select"
                value={currentMunicipality?.slug ?? ''}
                onChange={(e) => setMunicipalityBySlug(e.target.value)}
                className="bg-transparent text-sm font-semibold text-tinta focus:outline-none cursor-pointer w-full sm:w-auto pr-2"
              >
                {municipalities.map((m) => (
                  <option key={m.id} value={m.slug} className="bg-tarjeta text-tinta">
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Selector de Idioma */}
            <div className="flex items-center gap-2 bg-superficie/70 border border-superficie rounded-2xl px-3 py-2 min-h-[44px]">
              <Globe className="w-4 h-4 text-azulMed shrink-0" aria-hidden="true" />
              <label htmlFor="language-select" className="sr-only">
                {t('nav.languageLabel')}
              </label>
              <select
                id="language-select"
                value={lang}
                onChange={(e) => setLang(e.target.value as SupportedLang)}
                className="bg-transparent text-sm font-semibold text-tinta focus:outline-none cursor-pointer"
              >
                <option value="es" className="bg-tarjeta text-tinta">ES</option>
                <option value="en" className="bg-tarjeta text-tinta">EN</option>
                <option value="fr" className="bg-tarjeta text-tinta">FR</option>
                <option value="ar" className="bg-tarjeta text-tinta">AR (العربية)</option>
              </select>
            </div>

            {/* Menú Desplegable de Accesibilidad */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-expanded={a11yOpen}
                aria-haspopup="true"
                onClick={() => setA11yOpen((prev) => !prev)}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 min-h-[44px] text-sm font-semibold border transition-colors ${
                  activeCount > 0
                    ? 'bg-verdeCabo text-tarjeta border-verdeCabo'
                    : 'bg-tarjeta text-tinta border-superficie hover:bg-superficie/60'
                }`}
              >
                <Accessibility className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t('nav.accessibility')}</span>
                {activeCount > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-tarjeta text-verdeCabo">
                    {activeCount}
                  </span>
                )}
                <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>

              {a11yOpen && (
                <div
                  role="dialog"
                  aria-label={t('nav.accessibility')}
                  className="absolute end-0 mt-3 w-72 sm:w-80 rounded-3xl bg-tarjeta border border-superficie shadow-xl p-5 flex flex-col gap-3 z-50 a11y-card"
                >
                  <button
                    type="button"
                    aria-pressed={a11y.largeText}
                    onClick={() =>
                      setA11y((prev) => ({ ...prev, largeText: !prev.largeText }))
                    }
                    className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl border text-start transition-colors ${
                      a11y.largeText
                        ? 'bg-verdeCabo/15 border-verdeCabo text-tinta font-semibold'
                        : 'bg-arena/60 border-superficie text-tinta hover:bg-superficie/60'
                    }`}
                  >
                    <span className="flex items-center gap-3 text-sm">
                      <Type className="w-5 h-5 text-verdeCabo shrink-0" />
                      {t('nav.largeText')}
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-tarjeta border border-superficie">
                      {a11y.largeText ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={a11y.highContrast}
                    onClick={() =>
                      setA11y((prev) => ({ ...prev, highContrast: !prev.highContrast }))
                    }
                    className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl border text-start transition-colors ${
                      a11y.highContrast
                        ? 'bg-tinta text-tarjeta border-tinta font-semibold'
                        : 'bg-arena/60 border-superficie text-tinta hover:bg-superficie/60'
                    }`}
                  >
                    <span className="flex items-center gap-3 text-sm">
                      <Contrast className="w-5 h-5 shrink-0" />
                      {t('nav.highContrast')}
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-tarjeta text-tinta border border-superficie">
                      {a11y.highContrast ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={a11y.easyRead}
                    onClick={() =>
                      setA11y((prev) => ({ ...prev, easyRead: !prev.easyRead }))
                    }
                    className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl border text-start transition-colors ${
                      a11y.easyRead
                        ? 'bg-azulMed/15 border-azulMed text-tinta font-semibold'
                        : 'bg-arena/60 border-superficie text-tinta hover:bg-superficie/60'
                    }`}
                  >
                    <span className="flex items-center gap-3 text-sm">
                      <BookOpen className="w-5 h-5 text-azulMed shrink-0" />
                      {t('nav.easyRead')}
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-tarjeta border border-superficie">
                      {a11y.easyRead ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {isAdmin && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 min-h-[44px] text-sm font-semibold bg-tinta text-tarjeta hover:opacity-95 transition-opacity shadow-sm"
              >
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t('nav.adminPanel')}</span>
              </Link>
            )}

            {/* Enlace limpio Entrar / Mi Perfil */}
            <Link
              href="/mi-perfil"
              className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 min-h-[44px] text-sm font-semibold bg-buganvilla text-tarjeta hover:opacity-95 transition-opacity shadow-sm"
            >
              <UserCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="max-w-[160px] truncate">
                {sessionUser ? sessionUser.name : t('nav.loginOrProfile')}
              </span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
