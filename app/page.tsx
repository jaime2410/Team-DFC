'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Gift,
  Map,
  MapPin,
  MessageCircle,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';
import { BoardCardItem, BoardDetailModal, BoardItemKind } from '@/components/BoardDetailModal';
import { TrackIncidentModal } from '@/components/TrackIncidentModal';
import type { PublicMapIncidentItem } from '@/components/PublicTownMap';

const PublicTownMap = dynamic(() => import('@/components/PublicTownMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-80 rounded-3xl bg-superficie/70 animate-pulse" />
  ),
});

interface PublicBoardPayload {
  municipality: {
    id: string;
    slug: string;
    name: string;
    province: string;
    centerLat?: number;
    centerLng?: number;
  };
  streetAlerts: Array<{
    id: string;
    title: string;
    message: string;
    affectedStreets: string[];
    startDate: string;
    endDate: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
  }>;
  municipalAids: Array<{
    id: string;
    title: string;
    description: string;
    discountLabel: string;
    deadline: string | null;
  }>;
  resolvedIncidents: Array<{
    id: string;
    trackingCode: string;
    title: string;
    description: string;
    addressLabel: string | null;
    category: string;
    department: string;
    internalNotes: string | null;
  }>;
  publicMapIncidents?: PublicMapIncidentItem[];
  infoCards: Array<{
    id: string;
    title: string;
    summary: string;
    tag: string;
    details: string;
  }>;
  sampleCodes: string[];
}

type FilterKey = 'all' | BoardItemKind;

export default function HomePage() {
  const { t } = useTranslation();
  const { currentMunicipality } = useMunicipality();

  const [board, setBoard] = useState<PublicBoardPayload | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [showTownMap, setShowTownMap] = useState(false);
  const [selectedCard, setSelectedCard] = useState<BoardCardItem | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);

  const muniSlug = currentMunicipality?.slug ?? 'lucainena';
  const muniName = currentMunicipality?.name ?? board?.municipality.name ?? 'Almería';

  useEffect(() => {
    let active = true;
    async function loadBoard() {
      setLoadingBoard(true);
      try {
        const res = await fetch(
          `/api/public/board?municipalityId=${encodeURIComponent(muniSlug)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error('Failed to load board');
        const data = (await res.json()) as PublicBoardPayload;
        if (active) setBoard(data);
      } catch (err) {
        console.error('Error loading public board:', err);
      } finally {
        if (active) setLoadingBoard(false);
      }
    }
    void loadBoard();
    return () => {
      active = false;
    };
  }, [muniSlug]);

  const allCards = useMemo<BoardCardItem[]>(() => {
    if (!board) return [];

    const cards: BoardCardItem[] = [];

    board.streetAlerts.forEach((alert) => {
      cards.push({
        id: alert.id,
        kind: 'alerts',
        badge: t('home.cardTags.alert'),
        title: alert.title,
        body: alert.message,
        streets: alert.affectedStreets,
        dates: `${alert.startDate} → ${alert.endDate}`,
        extraMeta: alert.severity === 'CRITICAL' ? 'Aviso prioritario' : undefined,
        assistantQuery: `Información sobre ${alert.title}`,
      });
    });

    board.municipalAids.forEach((aid) => {
      cards.push({
        id: aid.id,
        kind: 'aids',
        badge: t('home.cardTags.aid'),
        title: aid.title,
        body: aid.description,
        extraMeta: aid.discountLabel,
        deadline: aid.deadline,
        assistantQuery: `Requisitos y cómo solicitar ${aid.title} en ${board.municipality.name}`,
      });
    });

    board.resolvedIncidents.forEach((inc) => {
      cards.push({
        id: inc.id,
        kind: 'resolved',
        badge: `${t('home.cardTags.resolved')} · ${inc.trackingCode}`,
        title: inc.title,
        body: inc.description,
        department: inc.department,
        location: inc.addressLabel,
        note: inc.internalNotes,
        assistantQuery: `Consulta sobre el arreglo ${inc.trackingCode} (${inc.title})`,
      });
    });

    board.infoCards.forEach((info) => {
      cards.push({
        id: info.id,
        kind: 'procedures',
        badge: `${t('home.cardTags.procedure')} · ${info.tag}`,
        title: info.title,
        body: `${info.summary} ${info.details}`,
        assistantQuery: `Explícame paso a paso: ${info.title}`,
      });
    });

    return cards;
  }, [board, t]);

  const visibleCards = useMemo(() => {
    if (activeFilter === 'all') return allCards;
    return allCards.filter((card) => card.kind === activeFilter);
  }, [allCards, activeFilter]);

  const sampleCode = board?.sampleCodes?.[0] ?? 'SOL-101';

  const filterChips: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: t('home.filters.all') },
    { key: 'alerts', label: t('home.filters.alerts') },
    { key: 'aids', label: t('home.filters.aids') },
    { key: 'resolved', label: t('home.filters.resolved') },
    { key: 'procedures', label: t('home.filters.procedures') },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Cabecera cercana sin login */}
      <section className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-sm a11y-card">
        <div className="inline-flex items-center gap-2 rounded-full bg-solAlmeria/30 text-tinta px-4 py-1.5 text-sm font-semibold mb-4">
          <Sparkles className="w-4 h-4 text-terracota shrink-0" aria-hidden="true" />
          <span>{t('home.greetingBadge')}</span>
        </div>

        <h1 className="font-heading font-bold text-3xl sm:text-4xl text-tinta">
          {t('home.heroTitle', { municipality: muniName })}
        </h1>
        <p className="mt-3 text-base sm:text-lg text-tinta/80 max-w-3xl leading-relaxed">
          {t('home.heroSubtitle')}
        </p>
      </section>

      {/* 3 Tarjetas Gigantes Principales + 1 Tarjeta Opcional de Personalización */}
      <section aria-labelledby="main-actions-heading" className="flex flex-col gap-6">
        <h2
          id="main-actions-heading"
          className="font-heading font-bold text-2xl text-tinta"
        >
          {t('home.actionsTitle')}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 1. Verde Cabo: Preguntar al Ayuntamiento */}
          <Link
            href="/asistente"
            className="group rounded-3xl bg-verdeCabo text-tarjeta p-7 sm:p-8 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-6 min-h-[220px] a11y-card"
          >
            <div className="flex flex-col gap-4">
              <span className="w-14 h-14 rounded-2xl bg-tarjeta/20 flex items-center justify-center shrink-0">
                <MessageCircle className="w-8 h-8" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-heading font-bold text-2xl leading-tight">
                  {t('home.cardAskTitle')}
                </h3>
                <p className="mt-2 text-sm sm:text-base text-tarjeta/90 leading-relaxed">
                  {t('home.cardAskDesc')}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 font-semibold text-base group-hover:translate-x-1 transition-transform">
              <span>{t('home.cardAskCta')}</span>
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </span>
          </Link>

          {/* 2. Terracota: Avisar de un problema */}
          <Link
            href="/incidencia"
            className="group rounded-3xl bg-terracota text-tarjeta p-7 sm:p-8 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-6 min-h-[220px] a11y-card"
          >
            <div className="flex flex-col gap-4">
              <span className="w-14 h-14 rounded-2xl bg-tarjeta/20 flex items-center justify-center shrink-0">
                <Wrench className="w-8 h-8" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-heading font-bold text-2xl leading-tight">
                  {t('home.cardReportTitle')}
                </h3>
                <p className="mt-2 text-sm sm:text-base text-tarjeta/90 leading-relaxed">
                  {t('home.cardReportDesc')}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 font-semibold text-base group-hover:translate-x-1 transition-transform">
              <span>{t('home.cardReportCta')}</span>
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </span>
          </Link>

          {/* 3. Azul Mediterráneo: Ver cómo va mi aviso */}
          <button
            type="button"
            onClick={() => setTrackOpen(true)}
            className="group text-start rounded-3xl bg-azulMed text-tarjeta p-7 sm:p-8 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-6 min-h-[220px] a11y-card"
          >
            <div className="flex flex-col gap-4">
              <span className="w-14 h-14 rounded-2xl bg-tarjeta/20 flex items-center justify-center shrink-0">
                <Search className="w-8 h-8" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-heading font-bold text-2xl leading-tight">
                  {t('home.cardTrackTitle')}
                </h3>
                <p className="mt-2 text-sm sm:text-base text-tarjeta/90 leading-relaxed">
                  {t('home.cardTrackDesc', { sample: sampleCode })}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 font-semibold text-base group-hover:translate-x-1 transition-transform">
              <span>{t('home.cardTrackCta')}</span>
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </span>
          </button>
        </div>

        {/* Tarjeta Destacada Opcional: Buganvilla */}
        <Link
          href="/mi-perfil"
          className="group rounded-3xl bg-buganvilla text-tarjeta p-6 sm:p-8 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-6 a11y-card"
        >
          <div className="flex items-start sm:items-center gap-4">
            <span className="w-14 h-14 rounded-2xl bg-tarjeta/20 flex items-center justify-center shrink-0">
              <BellRing className="w-7 h-7" aria-hidden="true" />
            </span>
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-tarjeta/20 text-xs font-bold uppercase tracking-wide mb-2">
                {t('home.personalizeBadge')}
              </span>
              <h3 className="font-heading font-bold text-xl sm:text-2xl">
                {t('home.personalizeTitle')}
              </h3>
              <p className="mt-1 text-sm sm:text-base text-tarjeta/90 max-w-2xl">
                {t('home.personalizeDesc')}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-tarjeta text-buganvilla font-bold text-sm sm:text-base shrink-0 group-hover:scale-[1.02] transition-transform">
            <span>{t('home.personalizeCta')}</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </span>
        </Link>
      </section>

      {/* Tablón Visual del Pueblo (Masonry estilo Pinterest) + Mapa Público Anonimizado */}
      <section aria-labelledby="board-heading" className="flex flex-col gap-6 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 id="board-heading" className="font-heading font-bold text-2xl sm:text-3xl text-tinta">
              {t('home.boardTitle', { municipality: muniName })}
            </h2>
            <p className="text-base text-tinta/75">{t('home.boardSubtitle')}</p>
          </div>

          <button
            type="button"
            aria-pressed={showTownMap}
            onClick={() => setShowTownMap((prev) => !prev)}
            className={`min-h-[48px] px-5 py-2.5 rounded-2xl font-heading font-bold text-sm sm:text-base inline-flex items-center justify-center gap-2 border transition-all shrink-0 a11y-card ${showTownMap
                ? 'bg-azulMed text-tarjeta border-azulMed shadow-sm'
                : 'bg-tarjeta text-tinta border-superficie hover:bg-superficie/70'
              }`}
          >
            <Map className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{showTownMap ? 'Ocultar mapa del pueblo' : '🗺️ Mapa del pueblo'}</span>
          </button>
        </div>

        {showTownMap && (
          <PublicTownMap
            center={[
              currentMunicipality?.center_lat ?? board?.municipality.centerLat ?? 37.0408,
              currentMunicipality?.center_lng ?? board?.municipality.centerLng ?? -2.1995,
            ]}
            municipalitySlug={muniSlug}
            municipalityName={muniName}
            incidents={board?.publicMapIncidents ?? []}
            onUpvoted={(incidentId, nextVotes) => {
              if (!board?.publicMapIncidents) return;
              setBoard({
                ...board,
                publicMapIncidents: board.publicMapIncidents.map((item) =>
                  item.id === incidentId ? { ...item, upvotes: nextVotes } : item
                ),
              });
            }}
          />
        )}

        {/* Chips grandes y espaciados */}
        <div className="flex flex-wrap gap-3" role="tablist" aria-label={t('home.boardTitle', { municipality: muniName })}>
          {filterChips.map((chip) => {
            const active = activeFilter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveFilter(chip.key)}
                className={`min-h-[44px] px-5 py-2.5 rounded-full text-sm sm:text-base font-semibold border transition-colors ${active
                    ? 'bg-tinta text-tarjeta border-tinta shadow-sm'
                    : 'bg-tarjeta text-tinta border-superficie hover:bg-superficie/70'
                  }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {loadingBoard ? (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="break-inside-avoid mb-6 h-48 rounded-3xl bg-superficie/70 animate-pulse"
              />
            ))}
          </div>
        ) : visibleCards.length === 0 ? (
          <div className="rounded-3xl bg-tarjeta border border-superficie p-8 text-center text-tinta/75">
            {t('home.emptyBoard')}
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-6">
            {visibleCards.map((card) => {
              const cardTheme =
                card.kind === 'alerts'
                  ? 'bg-tarjeta border-2 border-terracota/35'
                  : card.kind === 'aids'
                    ? 'bg-[#FDF5DF] border border-solAlmeria/70'
                    : card.kind === 'resolved'
                      ? 'bg-[#EAF6F3] border border-verdeCabo/40'
                      : 'bg-superficie/80 border border-superficie';

              const badgeTheme =
                card.kind === 'alerts'
                  ? 'bg-terracota/15 text-terracota'
                  : card.kind === 'aids'
                    ? 'bg-solAlmeria text-tinta'
                    : card.kind === 'resolved'
                      ? 'bg-verdeCabo text-tarjeta'
                      : 'bg-azulMed/15 text-azulMed';

              const KindIcon =
                card.kind === 'alerts'
                  ? AlertTriangle
                  : card.kind === 'aids'
                    ? Gift
                    : card.kind === 'resolved'
                      ? CheckCircle2
                      : ClipboardList;

              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setSelectedCard(card)}
                  className={`break-inside-avoid mb-6 w-full text-start rounded-3xl p-6 sm:p-7 shadow-sm hover:shadow-md transition-all flex flex-col gap-4 a11y-card ${cardTheme}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${badgeTheme}`}
                    >
                      <KindIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{card.badge}</span>
                    </span>
                  </div>

                  <div>
                    <h3 className="font-heading font-bold text-xl text-tinta leading-snug">
                      {card.title}
                    </h3>
                    {card.extraMeta && (
                      <p className="inline-block mt-2 px-3 py-1 rounded-full bg-tarjeta border border-superficie text-xs font-bold text-tinta">
                        {card.extraMeta}
                      </p>
                    )}
                    <p className="mt-2.5 text-sm sm:text-base text-tinta/80 leading-relaxed">
                      {card.body}
                    </p>
                  </div>

                  {card.streets && card.streets.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {card.streets.map((street) => (
                        <span
                          key={street}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-arena border border-superficie text-xs font-semibold text-tinta"
                        >
                          <MapPin className="w-3 h-3 text-terracota shrink-0" aria-hidden="true" />
                          {street}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="pt-2 border-t border-tinta/10 flex items-center justify-between text-xs font-semibold text-tinta/65">
                    <span>{card.dates || card.deadline || card.department || muniName}</span>
                    <span>{t('home.cardTapHint')} →</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <BoardDetailModal item={selectedCard} onClose={() => setSelectedCard(null)} />

      <TrackIncidentModal
        open={trackOpen}
        onClose={() => setTrackOpen(false)}
        municipalitySlug={muniSlug}
        municipalityName={muniName}
        sampleCodes={board?.sampleCodes ?? []}
      />
    </div>
  );
}
