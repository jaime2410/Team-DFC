'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Camera, MapPin, Send } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

interface BubbleMessage {
  from: 'me' | 'bot';
  text: string;
}

const DEMO_WA_ID = '34600112233';

type OutgoingMessage =
  | { type: 'text'; text: { body: string } }
  | { type: 'location'; location: { latitude: number; longitude: number; name: string } }
  | { type: 'image'; image: { id: string; mime_type: string; caption: string } };

export default function WhatsAppDemoPage() {
  const { t } = useTranslation();
  const { currentMunicipality } = useMunicipality();
  const [bubbles, setBubbles] = useState<BubbleMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastPayload, setLastPayload] = useState<unknown>(null);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const muniName = currentMunicipality?.name ?? 'Almería';

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
                contacts: [{ profile: { name: 'Vecino Demo' }, wa_id: DEMO_WA_ID }],
                messages: [
                  {
                    from: DEMO_WA_ID,
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
      <section className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 a11y-card">
        <h1 className="font-heading font-bold text-3xl text-tinta">{t('whatsappDemo.title')}</h1>
        <p className="mt-2 text-base text-tinta/80 max-w-3xl">
          {t('whatsappDemo.subtitle', { municipality: muniName })}
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Móvil simulado */}
        <div className="mx-auto w-full max-w-sm rounded-[2.5rem] bg-tinta p-3 shadow-xl">
          <div className="rounded-[2rem] overflow-hidden bg-[#E8DFCF] flex flex-col h-[560px]">
            <div className="bg-verdeCabo text-tarjeta px-5 py-4 font-heading font-bold">
              {t('whatsappDemo.contact', { municipality: muniName })}
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
                  placeholder={t('whatsappDemo.placeholder')}
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
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() =>
                    void sendToWebhook(t('whatsappDemo.photoLabel'), {
                      type: 'image',
                      image: {
                        id: 'demo-image-id',
                        mime_type: 'image/jpeg',
                        caption: t('whatsappDemo.photoLabel'),
                      },
                    })
                  }
                  className="flex-1 min-h-[44px] rounded-full bg-tarjeta text-tinta text-sm font-semibold inline-flex items-center justify-center gap-2"
                >
                  <Camera className="w-4 h-4" aria-hidden="true" />
                  {t('whatsappDemo.sendPhoto')}
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
                  className="flex-1 min-h-[44px] rounded-full bg-tarjeta text-tinta text-sm font-semibold inline-flex items-center justify-center gap-2"
                >
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                  {t('whatsappDemo.sendLocation')}
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
