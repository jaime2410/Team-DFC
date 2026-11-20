'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Calendar, CheckCircle2, MapPin, MessageCircle, Tag, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';

export type BoardItemKind = 'alerts' | 'aids' | 'resolved' | 'procedures';

export interface BoardCardItem {
  id: string;
  kind: BoardItemKind;
  badge: string;
  title: string;
  body: string;
  extraMeta?: string;
  streets?: string[];
  dates?: string;
  deadline?: string | null;
  department?: string;
  location?: string | null;
  note?: string | null;
  assistantQuery: string;
}

interface BoardDetailModalProps {
  item: BoardCardItem | null;
  onClose: () => void;
}

export function BoardDetailModal({ item, onClose }: BoardDetailModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-tinta/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-2xl a11y-card flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-superficie text-tinta text-xs font-bold uppercase tracking-wide">
            <Tag className="w-3.5 h-3.5" aria-hidden="true" />
            {item.badge}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('home.detailModal.close')}
            className="min-w-[44px] min-h-[44px] rounded-2xl bg-superficie/70 hover:bg-superficie text-tinta flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <h2
            id="detail-modal-title"
            className="font-heading font-bold text-2xl text-tinta leading-snug"
          >
            {item.title}
          </h2>
          {item.extraMeta && (
            <p className="inline-block mt-2 px-3 py-1 rounded-full bg-solAlmeria text-tinta text-sm font-bold">
              {item.extraMeta}
            </p>
          )}
          <p className="mt-3 text-base text-tinta/85 leading-relaxed">{item.body}</p>
        </div>

        {item.streets && item.streets.length > 0 && (
          <div className="rounded-2xl bg-arena/80 border border-superficie p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-tinta/65 mb-2 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-terracota" aria-hidden="true" />
              {t('home.detailModal.affectedStreets')}
            </p>
            <div className="flex flex-wrap gap-2">
              {item.streets.map((street) => (
                <span
                  key={street}
                  className="px-3 py-1 rounded-full bg-tarjeta border border-superficie text-sm font-semibold text-tinta"
                >
                  {street}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {item.dates && (
            <div className="rounded-2xl bg-arena/80 border border-superficie p-3.5">
              <p className="text-xs font-semibold text-tinta/65 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-azulMed" aria-hidden="true" />
                {t('home.detailModal.dates')}
              </p>
              <p className="font-semibold text-tinta mt-1">{item.dates}</p>
            </div>
          )}
          {item.deadline && (
            <div className="rounded-2xl bg-arena/80 border border-superficie p-3.5">
              <p className="text-xs font-semibold text-tinta/65 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-terracota" aria-hidden="true" />
                {t('home.detailModal.deadline')}
              </p>
              <p className="font-semibold text-tinta mt-1">{item.deadline}</p>
            </div>
          )}
          {item.department && (
            <div className="rounded-2xl bg-arena/80 border border-superficie p-3.5">
              <p className="text-xs font-semibold text-tinta/65">
                {t('home.detailModal.department')}
              </p>
              <p className="font-semibold text-tinta mt-1">{item.department}</p>
            </div>
          )}
          {item.location && (
            <div className="rounded-2xl bg-arena/80 border border-superficie p-3.5">
              <p className="text-xs font-semibold text-tinta/65">
                {t('home.detailModal.location')}
              </p>
              <p className="font-semibold text-tinta mt-1">{item.location}</p>
            </div>
          )}
        </div>

        {item.note && (
          <div className="rounded-2xl bg-verdeCabo/10 border border-verdeCabo/30 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-verdeCabo mb-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              {t('home.detailModal.municipalNote')}
            </p>
            <p className="text-sm text-tinta/85">{item.note}</p>
          </div>
        )}

        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <Link
            href={`/asistente?q=${encodeURIComponent(item.assistantQuery)}`}
            className="flex-1 min-h-[50px] px-6 py-3 rounded-2xl bg-verdeCabo text-tarjeta font-semibold inline-flex items-center justify-center gap-2 hover:opacity-95 transition-opacity text-center"
          >
            <MessageCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{t('home.detailModal.askAssistant')}</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[50px] px-5 py-3 rounded-2xl bg-superficie text-tinta font-semibold hover:bg-superficie/80 transition-colors"
          >
            {t('home.detailModal.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
