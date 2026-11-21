'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  FileText,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  Send,
  Square,
  UserCheck,
  Volume2,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

interface RagSourceDetail {
  filename: string;
  sourceUrl: string | null;
  validUntil: string | null;
  createdAt: string | null;
  dateLabel: string;
}

type MessageOrigin = 'voice' | 'text';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  origin?: MessageOrigin;
  userQuestion?: string;
  consultationId?: string;
  providerUsed?: string;
  tokensSaved?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  usedRag?: boolean;
  sourceDetails?: RagSourceDetail[];
  suggestIncident?: boolean;
  prefillDescription?: string | null;
  suggestHumanEscalation?: boolean;
  emergency112Alert?: boolean;
  escalatedMsg?: string | null;
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
  const [voiceAutoSending, setVoiceAutoSending] = useState(false);
  const [escalatingIdx, setEscalatingIdx] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptRef = useRef<string>('');
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  }, [messages, loading, voiceAutoSending]);

  useEffect(() => {
    return () => {
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
      recognitionRef.current?.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingIndex(null);
  }, []);

  const speakText = useCallback(
    (index: number, text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = SPEECH_LANGS[lang] ?? 'es-ES';
      utter.onend = () => setSpeakingIndex(null);
      utter.onerror = () => setSpeakingIndex(null);
      setSpeakingIndex(index);
      window.speechSynthesis.speak(utter);
    },
    [lang]
  );

  const sendMessage = useCallback(
    async (text: string, origin: MessageOrigin = 'text') => {
      const clean = text.trim();
      if (!clean || loading) return;

      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current);
        autoSendTimerRef.current = null;
      }
      setVoiceAutoSending(false);

      const history = messages.slice(-4).map((m) => ({ role: m.role, content: m.content }));
      const nextAssistantIndex = messages.length + 1;
      setMessages((prev) => [...prev, { role: 'user', content: clean, origin }]);
      setInput('');
      voiceTranscriptRef.current = '';
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
          consultationId?: string;
          providerUsed?: string;
          tokensSaved?: boolean;
          inputTokens?: number;
          outputTokens?: number;
          usedRag?: boolean;
          sourceDetails?: RagSourceDetail[];
          suggestIncident?: boolean;
          prefillDescription?: string | null;
          suggestHumanEscalation?: boolean;
          emergency112Alert?: boolean;
          error?: string;
        };
        if (!res.ok || !data.answer) throw new Error(data.error || 'error');

        const answerText = data.answer as string;
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: answerText,
            origin,
            userQuestion: clean,
            consultationId: data.consultationId,
            providerUsed: data.providerUsed,
            tokensSaved: data.tokensSaved,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            usedRag: data.usedRag,
            sourceDetails: data.sourceDetails,
            suggestIncident: data.suggestIncident,
            prefillDescription: data.prefillDescription,
            suggestHumanEscalation: data.suggestHumanEscalation,
            emergency112Alert: data.emergency112Alert,
          },
        ]);

        // Si el mensaje entró por micrófono (voz), reproducir respuesta automáticamente en voz alta
        if (origin === 'voice') {
          speakText(nextAssistantIndex, answerText);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: t('assistant.error'), origin },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, muniSlug, lang, t, speakText]
  );

  async function handleEscalateToHuman(index: number, msg: ChatMessage) {
    if (escalatingIdx !== null) return;
    setEscalatingIdx(index);
    try {
      const res = await fetch('/api/chat/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultationId: msg.consultationId,
          municipalityId: muniSlug,
          question: msg.userQuestion || 'Consulta derivada a atención humana',
        }),
      });
      const data = (await res.json()) as { message?: string };
      setMessages((prev) =>
        prev.map((m, idx) =>
          idx === index
            ? {
                ...m,
                escalatedMsg:
                  data.message ||
                  `Tu consulta se ha enviado al equipo de Atención Ciudadana de ${muniName}.`,
              }
            : m
        )
      );
    } finally {
      setEscalatingIdx(null);
    }
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

    stopSpeaking();
    voiceTranscriptRef.current = '';
    const rec = new Ctor();
    rec.lang = SPEECH_LANGS[lang] ?? 'es-ES';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      if (transcript) {
        const combined = voiceTranscriptRef.current
          ? `${voiceTranscriptRef.current} ${transcript}`
          : transcript;
        voiceTranscriptRef.current = combined.trim();
        setInput(voiceTranscriptRef.current);
      }
    };
    rec.onend = () => {
      setListening(false);
      const captured = voiceTranscriptRef.current.trim();
      if (captured) {
        setVoiceAutoSending(true);
        if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
        autoSendTimerRef.current = setTimeout(() => {
          void sendMessage(captured, 'voice');
        }, 1000);
      }
    };
    rec.onerror = () => {
      setListening(false);
      setVoiceAutoSending(false);
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  function toggleSpeak(index: number, text: string) {
    if (speakingIndex === index) {
      stopSpeaking();
      return;
    }
    speakText(index, text);
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
      <section className="rounded-3xl bg-verdeCabo text-tarjeta p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 a11y-card">
        <div>
          <h1 className="font-heading font-bold text-3xl">{t('assistant.title')}</h1>
          <p className="mt-2 text-base sm:text-lg text-tarjeta/90 leading-relaxed">
            {t('assistant.subtitle', { municipality: muniName })}
          </p>
        </div>

        {speakingIndex !== null && (
          <button
            type="button"
            onClick={stopSpeaking}
            className="min-h-[48px] px-5 rounded-2xl bg-terracota text-tarjeta font-heading font-bold text-sm inline-flex items-center gap-2 shadow-md shrink-0 animate-pulse"
          >
            <Square className="w-4 h-4 fill-current" aria-hidden="true" />
            <span>Detener voz</span>
          </button>
        )}
      </section>

      {messages.length === 0 && !loading && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading font-bold text-xl text-tinta">{t('assistant.faqTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {faqs.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void sendMessage(q, 'text')}
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
            {m.role === 'assistant' && m.emergency112Alert && (
              <div
                role="alert"
                className="max-w-[92%] rounded-3xl bg-terracota text-tarjeta p-5 font-heading font-bold text-base shadow-md flex items-center gap-3 a11y-card"
              >
                <PhoneCall className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>⚠️ Peligro inmediato: llama al 112 ahora mismo</span>
              </div>
            )}

            <div
              className={`max-w-[92%] rounded-3xl p-5 text-base leading-relaxed a11y-card ${
                m.role === 'user'
                  ? 'bg-azulMed text-tarjeta'
                  : 'bg-tarjeta border border-superficie text-tinta'
              }`}
            >
              <p className="whitespace-pre-line">{m.content}</p>

              {/* Fuentes oficiales RAG con fecha de vigencia y enlace clicable */}
              {m.role === 'assistant' && m.sourceDetails && m.sourceDetails.length > 0 && (
                <div className="mt-4 rounded-2xl bg-arena border border-superficie p-3.5 flex flex-col gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-verdeCabo flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Fuentes oficiales verificadas ({muniName})</span>
                  </p>
                  <ul className="flex flex-col gap-1.5 text-xs text-tinta/85">
                    {m.sourceDetails.map((src) => (
                      <li
                        key={src.filename}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span className="font-semibold">
                          {src.filename}{' '}
                          <span className="text-tinta/65 font-normal">({src.dateLabel})</span>
                        </span>
                        {src.sourceUrl && (
                          <a
                            href={src.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-azulMed underline hover:opacity-80"
                          >
                            <span>Ver documento oficial</span>
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
                    className={`inline-flex items-center gap-2 min-h-[40px] px-4 rounded-full text-sm font-semibold transition-colors ${
                      speakingIndex === i
                        ? 'bg-terracota text-tarjeta'
                        : 'bg-verdeCabo/15 text-verdeCabo hover:bg-verdeCabo/25'
                    }`}
                  >
                    {speakingIndex === i ? (
                      <Square className="w-4 h-4 fill-current" aria-hidden="true" />
                    ) : (
                      <Volume2 className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>
                      {speakingIndex === i ? 'Detener voz' : t('assistant.listen')}
                    </span>
                  </button>

                  {!m.suggestHumanEscalation && !m.escalatedMsg && (
                    <button
                      type="button"
                      disabled={escalatingIdx === i}
                      onClick={() => void handleEscalateToHuman(i, m)}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full bg-azulMed/15 text-azulMed text-sm font-semibold hover:bg-azulMed/25 transition-colors"
                    >
                      <UserCheck className="w-4 h-4" aria-hidden="true" />
                      <span>Hablar con una persona</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Tarjeta destacada "Hablar con una persona" cuando no hay respaldo RAG o se solicita */}
            {m.role === 'assistant' && m.suggestHumanEscalation && !m.escalatedMsg && (
              <div className="max-w-[92%] rounded-3xl bg-[#FDF5DF] border-2 border-solAlmeria p-5 flex flex-col gap-3 a11y-card">
                <p className="font-heading font-bold text-lg text-tinta flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-azulMed shrink-0" aria-hidden="true" />
                  <span>¿Prefieres que te atienda un agente municipal?</span>
                </p>
                <p className="text-sm text-tinta/80">
                  Esta consulta requiere revisión personal o no figura en las ordenanzas indexadas. Puedes derivarla en un clic a Atención Ciudadana de {muniName}.
                </p>
                <button
                  type="button"
                  disabled={escalatingIdx === i}
                  onClick={() => void handleEscalateToHuman(i, m)}
                  className="inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-2xl bg-azulMed text-tarjeta font-bold hover:opacity-95 transition-opacity self-start"
                >
                  <UserCheck className="w-5 h-5" aria-hidden="true" />
                  <span>
                    {escalatingIdx === i ? 'Derivando consulta...' : 'Hablar con una persona'}
                  </span>
                </button>
              </div>
            )}

            {m.role === 'assistant' && m.escalatedMsg && (
              <div
                role="status"
                className="max-w-[92%] rounded-3xl bg-azulMed text-tarjeta p-5 text-sm font-semibold a11y-card"
              >
                {m.escalatedMsg}
              </div>
            )}

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

        {voiceAutoSending && !loading && (
          <div
            role="status"
            className="self-end rounded-3xl bg-azulMed/15 border border-azulMed/40 px-5 py-3 text-sm font-semibold text-azulMed flex items-center gap-2 a11y-card"
          >
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
            <span>Voz detectada. Enviando automáticamente...</span>
          </div>
        )}

        {/* Burbuja animada del asistente mientras procesa la petición */}
        {loading && (
          <div
            role="status"
            aria-live="polite"
            className="self-start max-w-[90%] rounded-3xl bg-tarjeta border-2 border-verdeCabo/40 p-5 shadow-sm flex items-center gap-3.5 text-tinta a11y-card"
          >
            <span className="w-10 h-10 rounded-2xl bg-verdeCabo/15 text-verdeCabo flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5 animate-bounce" aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-heading font-bold text-sm text-verdeCabo">
                Consultando información oficial de {muniName}...
              </p>
              <div className="flex items-center gap-1.5 text-xs text-tinta/70">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-verdeCabo" aria-hidden="true" />
                <span>{t('assistant.thinking')}</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input, 'text');
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
          onChange={(e) => {
            if (autoSendTimerRef.current) {
              clearTimeout(autoSendTimerRef.current);
              autoSendTimerRef.current = null;
              setVoiceAutoSending(false);
            }
            setInput(e.target.value);
          }}
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
                  ? 'bg-terracota text-tarjeta animate-pulse'
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
