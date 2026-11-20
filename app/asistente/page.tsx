'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Mic, MicOff, Send, Square, Volume2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  providerUsed?: string;
  tokensSaved?: boolean;
  usedRag?: boolean;
  suggestIncident?: boolean;
  prefillDescription?: string | null;
}

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

const SPEECH_LANGS: Record<string, string> = {
  es: 'es-ES',
  en: 'en-GB',
  fr: 'fr-FR',
  ar: 'ar-SA',
};

function AssistantContent() {
  const { t, lang } = useTranslation();
  const { currentMunicipality } = useMunicipality();
  const searchParams = useSearchParams();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const muniSlug = currentMunicipality?.slug ?? 'lucainena';
  const muniName = currentMunicipality?.name ?? 'Almería';

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) setInput(q);
  }, [searchParams]);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setVoiceSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || loading) return;

      const history = messages.slice(-4).map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, { role: 'user', content: clean }]);
      setInput('');
      setLoading(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            municipalityId: muniSlug,
            message: clean,
            history,
            lang,
            channel: 'WEB',
          }),
        });
        const data = (await res.json()) as {
          answer?: string;
          providerUsed?: string;
          tokensSaved?: boolean;
          usedRag?: boolean;
          suggestIncident?: boolean;
          prefillDescription?: string | null;
          error?: string;
        };
        if (!res.ok || !data.answer) throw new Error(data.error || 'error');
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.answer as string,
            providerUsed: data.providerUsed,
            tokensSaved: data.tokensSaved,
            usedRag: data.usedRag,
            suggestIncident: data.suggestIncident,
            prefillDescription: data.prefillDescription,
          },
        ]);
      } catch {
        setMessages((prev) => [...prev, { role: 'assistant', content: t('assistant.error') }]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, muniSlug, lang, t]
  );

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
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  function toggleSpeak(index: number, text: string) {
    if (!('speechSynthesis' in window)) return;
    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = SPEECH_LANGS[lang] ?? 'es-ES';
    utter.onend = () => setSpeakingIndex(null);
    utter.onerror = () => setSpeakingIndex(null);
    setSpeakingIndex(index);
    window.speechSynthesis.speak(utter);
  }

  function badgeLabel(m: ChatMessage): string {
    if (m.providerUsed === 'FAQ_CACHE') return t('assistant.badgeCache');
    if (m.providerUsed === 'LOCAL_INTENT') return t('assistant.badgeIntent');
    if (m.usedRag) return t('assistant.badgeRag');
    return m.providerUsed ?? '';
  }

  const faqs = [t('assistant.faq1'), t('assistant.faq2'), t('assistant.faq3'), t('assistant.faq4')];

  return (
    <div className="flex flex-col gap-8 max-w-3xl mx-auto w-full">
      <section className="rounded-3xl bg-verdeCabo text-tarjeta p-6 sm:p-8 a11y-card">
        <h1 className="font-heading font-bold text-3xl">{t('assistant.title')}</h1>
        <p className="mt-2 text-base sm:text-lg text-tarjeta/90 leading-relaxed">
          {t('assistant.subtitle', { municipality: muniName })}
        </p>
      </section>

      {messages.length === 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading font-bold text-xl text-tinta">{t('assistant.faqTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {faqs.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void sendMessage(q)}
                className="text-start min-h-[64px] rounded-3xl bg-tarjeta border border-superficie p-5 font-semibold text-tinta hover:bg-superficie/60 transition-colors a11y-card"
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      )}

      <section
        aria-live="polite"
        className="flex flex-col gap-5"
        aria-label={t('assistant.title')}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex flex-col gap-3 ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[92%] rounded-3xl p-5 text-base leading-relaxed a11y-card ${
                m.role === 'user'
                  ? 'bg-azulMed text-tarjeta'
                  : 'bg-tarjeta border border-superficie text-tinta'
              }`}
            >
              <p className="whitespace-pre-line">{m.content}</p>

              {m.role === 'assistant' && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {badgeLabel(m) && (
                    <span className="px-3 py-1 rounded-full bg-superficie text-xs font-semibold text-tinta/80">
                      {badgeLabel(m)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleSpeak(i, m.content)}
                    className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full bg-verdeCabo/15 text-verdeCabo text-sm font-semibold hover:bg-verdeCabo/25 transition-colors"
                  >
                    {speakingIndex === i ? (
                      <Square className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Volume2 className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>{t('assistant.listen')}</span>
                  </button>
                </div>
              )}
            </div>

            {m.role === 'assistant' && m.suggestIncident && (
              <div className="max-w-[92%] rounded-3xl bg-terracota text-tarjeta p-5 flex flex-col gap-3 a11y-card">
                <p className="flex items-center gap-2 font-heading font-bold text-lg">
                  <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
                  {t('assistant.incidentCardTitle')}
                </p>
                <Link
                  href={`/incidencia?desc=${encodeURIComponent(m.prefillDescription ?? '')}`}
                  className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-2xl bg-tarjeta text-terracota font-bold hover:opacity-95 transition-opacity"
                >
                  {t('assistant.incidentCardCta')}
                </Link>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="self-start rounded-3xl bg-tarjeta border border-superficie p-5 text-tinta/70 a11y-card">
            {t('assistant.thinking')}
          </div>
        )}
        <div ref={bottomRef} />
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input);
        }}
        className="sticky bottom-4 rounded-3xl bg-tarjeta border border-superficie shadow-lg p-4 flex flex-col sm:flex-row gap-3 a11y-card"
      >
        <label htmlFor="assistant-input" className="sr-only">
          {t('assistant.placeholder')}
        </label>
        <input
          id="assistant-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('assistant.placeholder')}
          className="flex-1 min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 text-base text-tinta placeholder:text-tinta/50 focus:outline-none focus:ring-2 focus:ring-verdeCabo"
        />
        <div className="flex gap-3">
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleDictation}
              aria-pressed={listening}
              className={`min-h-[52px] px-5 rounded-2xl font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                listening
                  ? 'bg-terracota text-tarjeta'
                  : 'bg-superficie text-tinta hover:bg-superficie/80'
              }`}
            >
              {listening ? (
                <MicOff className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Mic className="w-5 h-5" aria-hidden="true" />
              )}
              <span>{listening ? t('assistant.dictating') : t('assistant.dictate')}</span>
            </button>
          )}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="min-h-[52px] px-6 rounded-2xl bg-verdeCabo text-tarjeta font-semibold inline-flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 transition-opacity flex-1 sm:flex-initial"
          >
            <Send className="w-5 h-5" aria-hidden="true" />
            <span>{t('assistant.send')}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantContent />
    </Suspense>
  );
}
