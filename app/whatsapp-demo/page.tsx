'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Camera, CheckCircle2, MapPin, Mic, Send, User, Wrench } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

interface BubbleMessage {
  from: 'me' | 'bot';
  text: string;
}

const DEMO_WA_ID = '34600112233';
const OPERATOR_WA_ID = '34699887766';
const SAMPLE_CLOSURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

type OutgoingMessage =
  | { type: 'text'; text: { body: string } }
  | { type: 'location'; location: { latitude: number; longitude: number; name: string } }
  | {
      type: 'image';
      image: { id: string; mime_type: string; caption?: string; data_url?: string };
    }
  | {
      type: 'audio';
      audio: { id: string; mime_type: string; transcript?: string };
    };

export default function WhatsAppDemoPage() {
  const { t } = useTranslation();
  const { currentMunicipality } = useMunicipality();
  const [roleMode, setRoleMode] = useState<'CITIZEN' | 'OPERATOR'>('CITIZEN');
  const [bubbles, setBubbles] = useState<BubbleMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastPayload, setLastPayload] = useState<unknown>(null);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const muniName = currentMunicipality?.name ?? 'Almería';
  const activeWaId = roleMode === 'OPERATOR' ? OPERATOR_WA_ID : DEMO_WA_ID;
  const activeProfileName =
    roleMode === 'OPERATOR' ? 'Operario Brigada Municipal' : 'Vecino Demo';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  async function sendToWebhook(label: string, content: OutgoingMessage) {
    if (sending) return;
    setSending(true);
    setBubbles((prev) => [...prev, { from: 'me', text: label }]);

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'DEMO_WABA_ID',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '34950000000',
                  phone_number_id: currentMunicipality?.whatsapp_phone_id ?? '',
                },
                contacts: [
                  { profile: { name: activeProfileName }, wa_id: activeWaId },
                ],
                messages: [
                  {
                    from: activeWaId,
                    id: `wamid.${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    ...content,
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    setLastPayload(payload);

    try {
      const res = await fetch('/api/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { reply?: string };
      setLastResponse(data);
      if (data.reply) {
        setBubbles((prev) => [...prev, { from: 'bot', text: data.reply as string }]);
      }
    } catch {
      setLastResponse({ ok: false, error: 'network_error' });
    } finally {
      setSending(false);
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    void sendToWebhook(text, { type: 'text', text: { body: text } });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4 a11y-card">
        <div>
          <h1 className="font-heading font-bold text-3xl text-tinta">
            {t('whatsappDemo.title')}
          </h1>
          <p className="mt-2 text-base text-tinta/80 max-w-2xl">
            {t('whatsappDemo.subtitle', { municipality: muniName })}
          </p>
        </div>

        {/* Selector de Rol: Vecino vs Operario Municipal */}
        <div
          className="inline-flex rounded-2xl bg-arena border border-superficie p-1.5 gap-1.5 shrink-0"
          role="group"
          aria-label="Selector de rol en simulador WhatsApp"
        >
          <button
            type="button"
            onClick={() => setRoleMode('CITIZEN')}
            className={`min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center gap-2 transition-colors ${
              roleMode === 'CITIZEN'
                ? 'bg-verdeCabo text-tarjeta shadow-sm'
                : 'text-tinta hover:bg-superficie'
            }`}
          >
            <User className="w-4 h-4" aria-hidden="true" />
            <span>Modo Vecino</span>
          </button>
          <button
            type="button"
            onClick={() => setRoleMode('OPERATOR')}
            className={`min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center gap-2 transition-colors ${
              roleMode === 'OPERATOR'
                ? 'bg-tinta text-tarjeta shadow-sm'
                : 'text-tinta hover:bg-superficie'
            }`}
          >
            <Wrench className="w-4 h-4" aria-hidden="true" />
            <span>Modo Operario Municipal</span>
          </button>
        </div>
      </section>

      {roleMode === 'OPERATOR' && (
        <section className="rounded-3xl bg-[#FDF5DF] border-2 border-solAlmeria p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 a11y-card">
          <div>
            <p className="font-heading font-bold text-lg text-tinta flex items-center gap-2">
              <Wrench className="w-5 h-5 text-terracota" aria-hidden="true" />
              <span>Comandos de Operario por WhatsApp ({muniName})</span>
            </p>
            <p className="text-sm text-tinta/80 mt-0.5">
              Un operario a pie de calle puede cerrar o actualizar una incidencia enviando{' '}
              <code>SOL-101 resuelto [nota]</code> con foto opcional. Actualiza el historial y notifica a los vecinos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5 shrink-0">
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                void sendToWebhook(
                  '📷 SOL-101 resuelto Luminaria LED reparada y verificada por brigada',
                  {
                    type: 'image',
                    image: {
                      id: 'closure-photo-101',
                      mime_type: 'image/png',
                      caption:
                        'SOL-101 resuelto Luminaria LED reparada y verificada por brigada',
                      data_url: SAMPLE_CLOSURE_DATA_URL,
                    },
                  }
                )
              }
              className="min-h-[44px] px-4 rounded-2xl bg-verdeCabo text-tarjeta text-xs sm:text-sm font-bold inline-flex items-center gap-2 hover:opacity-95"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span>Cerrar SOL-101 como Resuelto + Foto</span>
            </button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Móvil simulado */}
        <div className="mx-auto w-full max-w-sm rounded-[2.5rem] bg-tinta p-3 shadow-xl">
          <div className="rounded-[2rem] overflow-hidden bg-[#E8DFCF] flex flex-col h-[580px]">
            <div className="bg-verdeCabo text-tarjeta px-5 py-4 flex items-center justify-between">
              <span className="font-heading font-bold">
                {t('whatsappDemo.contact', { municipality: muniName })}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-tarjeta/20 text-[11px] font-bold">
                {roleMode === 'OPERATOR' ? 'Operario' : 'Vecino'}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {bubbles.map((b, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                    b.from === 'me'
                      ? 'self-end bg-[#D9F2C9] text-tinta'
                      : 'self-start bg-tarjeta text-tinta'
                  }`}
                >
                  {b.text}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={handleSend} className="bg-superficie p-3 flex flex-col gap-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    roleMode === 'OPERATOR'
                      ? 'Ej: SOL-101 resuelto Farola reparada'
                      : t('whatsappDemo.placeholder')
                  }
                  aria-label={t('whatsappDemo.placeholder')}
                  className="flex-1 min-h-[44px] rounded-full bg-tarjeta px-4 text-sm text-tinta focus:outline-none focus:ring-2 focus:ring-verdeCabo"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label={t('whatsappDemo.send')}
                  className="min-w-[44px] min-h-[44px] rounded-full bg-verdeCabo text-tarjeta flex items-center justify-center disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() =>
                    void sendToWebhook(t('whatsappDemo.photoLabel'), {
                      type: 'image',
                      image: {
                        id: 'demo-image-id',
                        mime_type: 'image/png',
                        caption: '',
                        data_url: SAMPLE_CLOSURE_DATA_URL,
                      },
                    })
                  }
                  className="min-h-[42px] rounded-full bg-tarjeta text-tinta text-xs font-semibold inline-flex items-center justify-center gap-1.5 px-2"
                >
                  <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('whatsappDemo.sendPhoto')}</span>
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() =>
                    void sendToWebhook(t('whatsappDemo.locationLabel'), {
                      type: 'location',
                      location: {
                        latitude: currentMunicipality?.center_lat ?? 37.0408,
                        longitude: currentMunicipality?.center_lng ?? -2.1995,
                        name: muniName,
                      },
                    })
                  }
                  className="min-h-[42px] rounded-full bg-tarjeta text-tinta text-xs font-semibold inline-flex items-center justify-center gap-1.5 px-2"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('whatsappDemo.sendLocation')}</span>
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() =>
                    void sendToWebhook('🎤 Nota de voz (0:06): "¿Cuál es el horario de recogida de muebles?"', {
                      type: 'audio',
                      audio: {
                        id: 'demo-audio-id',
                        mime_type: 'audio/ogg',
                        transcript: '¿Cuál es el horario de recogida de muebles y enseres?',
                      },
                    })
                  }
                  className="min-h-[42px] rounded-full bg-tarjeta text-tinta text-xs font-semibold inline-flex items-center justify-center gap-1.5 px-2"
                >
                  <Mic className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Nota de Voz</span>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Payload / respuesta real */}
        <div className="flex flex-col gap-6">
          <div className="rounded-3xl bg-tarjeta border border-superficie p-5 a11y-card">
            <h2 className="font-heading font-bold text-lg text-tinta mb-3">
              {t('whatsappDemo.payloadTitle')}
            </h2>
            <pre className="text-xs bg-arena rounded-2xl p-4 overflow-auto max-h-72 text-tinta">
              {lastPayload ? JSON.stringify(lastPayload, null, 2) : '—'}
            </pre>
          </div>
          <div className="rounded-3xl bg-tarjeta border border-superficie p-5 a11y-card">
            <h2 className="font-heading font-bold text-lg text-tinta mb-3">
              {t('whatsappDemo.responseTitle')}
            </h2>
            <pre className="text-xs bg-arena rounded-2xl p-4 overflow-auto max-h-72 text-tinta">
              {lastResponse ? JSON.stringify(lastResponse, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
