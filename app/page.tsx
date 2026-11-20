'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Globe, MapPin, Sparkles } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

export default function HomePage() {
  const { lang, dir, t } = useTranslation();
  const { currentMunicipality, isLoading } = useMunicipality();
  const [activeModes, setActiveModes] = useState<string[]>([]);

  useEffect(() => {
    const syncModes = () => {
      const root = document.documentElement;
      const modes: string[] = [];
      if (root.classList.contains('a11y-large-text')) modes.push(t('nav.largeText'));
      if (root.classList.contains('a11y-high-contrast')) modes.push(t('nav.highContrast'));
      if (root.classList.contains('a11y-easy-read')) modes.push(t('nav.easyRead'));
      setActiveModes(modes);
    };
    syncModes();
    const observer = new MutationObserver(syncModes);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, [t]);

  const muniName = currentMunicipality?.name ?? 'Almería';
  const muniProvince = currentMunicipality?.province ?? 'Almería';

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-sm a11y-card">
        <div className="inline-flex items-center gap-2 rounded-full bg-solAlmeria/30 text-tinta px-4 py-1.5 text-sm font-semibold mb-4">
          <Sparkles className="w-4 h-4 text-terracota" aria-hidden="true" />
          <span>{t('phase0.badge')}</span>
        </div>

        <h1 className="font-heading font-bold text-3xl sm:text-4xl text-tinta mb-3">
          {t('phase0.welcomeTitle', { municipality: muniName })}
        </h1>
        <p className="text-base sm:text-lg text-tinta/80 max-w-3xl leading-relaxed">
          {t('phase0.welcomeSubtitle', {
            municipality: muniName,
            province: muniProvince,
          })}
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-sm a11y-card flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-terracota/15 text-terracota flex items-center justify-center shrink-0">
              <MapPin className="w-6 h-6" aria-hidden="true" />
            </span>
            <h2 className="font-heading font-bold text-xl text-tinta">
              {t('phase0.streetsTitle')}
            </h2>
          </div>

          {isLoading ? (
            <div className="h-24 rounded-2xl bg-superficie/60 animate-pulse" />
          ) : (
            <ul className="flex flex-wrap gap-3">
              {(currentMunicipality?.streets ?? []).map((street) => (
                <li
                  key={street}
                  className="px-4 py-2 rounded-2xl bg-arena border border-superficie text-sm font-medium text-tinta"
                >
                  {street}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto pt-3 flex items-center gap-2 text-sm font-semibold text-verdeCabo">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('phase0.dbReady')}</span>
          </div>
        </section>

        <section className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-sm a11y-card flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-azulMed/15 text-azulMed flex items-center justify-center shrink-0">
              <Globe className="w-6 h-6" aria-hidden="true" />
            </span>
            <h2 className="font-heading font-bold text-xl text-tinta">
              {t('phase0.statusTitle')}
            </h2>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-arena/70 border border-superficie p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-tinta/70">
                {t('phase0.langActive')}
              </dt>
              <dd className="mt-1 font-heading font-bold text-lg text-tinta uppercase">
                {lang}
              </dd>
            </div>
            <div className="rounded-2xl bg-arena/70 border border-superficie p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-tinta/70">
                {t('phase0.directionActive')}
              </dt>
              <dd className="mt-1 font-heading font-bold text-lg text-tinta uppercase">
                {dir}
              </dd>
            </div>
          </dl>

          <div className="rounded-2xl bg-superficie/50 border border-superficie p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-tinta/70 mb-2">
              {t('phase0.a11yActive')}
            </p>
            <p className="text-sm font-semibold text-tinta">
              {activeModes.length > 0 ? activeModes.join(' · ') : t('phase0.a11yNone')}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
