'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Building2,
  CheckCircle2,
  Cpu,
  FileText,
  Gift,
  Loader2,
  LogOut,
  Megaphone,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';
import type { AdminMapMarker } from '@/components/AdminMap';

const AdminMap = dynamic(() => import('@/components/AdminMap'), {
  ssr: false,
  loading: () => <div className="w-full h-80 rounded-3xl bg-superficie/70 animate-pulse" />,
});

type AdminTab = 'INCIDENTS' | 'AI' | 'RAG' | 'BROADCAST' | 'ANALYTICS';
type AIProvider = 'GEMINI' | 'GROQ' | 'OPENAI' | 'OPENROUTER' | 'LOCAL';
type AIFeatureKey = 'CHAT' | 'CLASSIFY' | 'VISION';

const STATUS_OPTIONS = ['RECIBIDO', 'VISTO', 'ASIGNADO', 'EN_CURSO', 'RESUELTO'] as const;
const URGENCY_OPTIONS = ['BAJA', 'MEDIA', 'ALTA', 'URGENTE', 'EMERGENCIA_112'] as const;
const DEPT_OPTIONS = [
  'Electricidad',
  'Limpieza Viaria',
  'Obras y Urbanismo',
  'Aguas y Mantenimiento',
  'Medio Ambiente',
  'Atención Ciudadana',
  'Policía Local',
  'Deportes',
  'Fiestas',
] as const;
const PROVIDER_OPTIONS: AIProvider[] = ['GEMINI', 'GROQ', 'OPENAI', 'OPENROUTER', 'LOCAL'];
const DEFAULT_PROVIDER_MODELS: Record<AIProvider, string[]> = {
  GEMINI: [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-pro',
  ],
  GROQ: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ],
  OPENAI: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  OPENROUTER: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'qwen/qwen-2.5-vl-7b-instruct:free',
  ],
  LOCAL: ['deterministic-v1'],
};

function previewAutoModel(
  provider: AIProvider,
  featureKey: AIFeatureKey,
  list: string[]
): string {
  if (provider === 'LOCAL') return 'deterministic-v1';
  const models = list && list.length > 0 ? list : DEFAULT_PROVIDER_MODELS[provider];
  const findMatch = (pred: (lower: string) => boolean) =>
    models.find((m) => pred(m.toLowerCase()));

  if (provider === 'GEMINI') {
    if (featureKey === 'CLASSIFY') {
      return (
        findMatch((l) => l.includes('2.5-flash-lite')) ??
        findMatch((l) => l.includes('2.5-flash') && !l.includes('lite')) ??
        findMatch((l) => l.includes('2.5-flash')) ??
        findMatch((l) => l.includes('2.0-flash')) ??
        findMatch((l) => l.includes('flash')) ??
        models[0]
      );
    }
    return (
      findMatch((l) => l.includes('2.5-flash') && !l.includes('lite')) ??
      findMatch((l) => l.includes('2.0-flash')) ??
      findMatch((l) => l.includes('2.5-flash-lite')) ??
      findMatch((l) => l.includes('flash')) ??
      models[0]
    );
  }

  if (provider === 'GROQ') {
    if (featureKey === 'CLASSIFY') {
      return (
        findMatch((l) => l.includes('8b-instant')) ??
        findMatch((l) => l.includes('llama-3.3-70b')) ??
        models[0]
      );
    }
    if (featureKey === 'CHAT') {
      return (
        findMatch((l) => l.includes('llama-3.3-70b')) ??
        findMatch((l) => l.includes('70b')) ??
        findMatch((l) => l.includes('8b-instant')) ??
        models[0]
      );
    }
    return (
      findMatch((l) => l.includes('llama-4-scout')) ??
      findMatch((l) => l.includes('vision')) ??
      findMatch((l) => l.includes('llama-3.3-70b')) ??
      models[0]
    );
  }

  if (provider === 'OPENAI') {
    return (
      findMatch((l) => l.includes('gpt-4.1-mini')) ??
      findMatch((l) => l.includes('gpt-4o-mini')) ??
      findMatch((l) => l.includes('gpt-4o')) ??
      models[0]
    );
  }

  if (provider === 'OPENROUTER') {
    if (featureKey === 'VISION') {
      return (
        findMatch(
          (l) =>
            l.includes(':free') &&
            (l.includes('vl') || l.includes('vision') || l.includes('gemini'))
        ) ??
        findMatch((l) => l.includes(':free')) ??
        models[0]
      );
    }
    return (
      findMatch((l) => l.includes('llama-3.3-70b') && l.includes(':free')) ??
      findMatch((l) => l.includes('gemini') && l.includes(':free')) ??
      findMatch((l) => l.includes(':free')) ??
      models[0]
    );
  }

  return models[0];
}
const CHART_COLORS = ['#E45735', '#1B8A7A', '#2C6E91', '#F2B84B', '#B84A62', '#1E242B'];

interface AdminIncident {
  id: string;
  tracking_code: string;
  title: string;
  description: string;
  photo_url: string | null;
  resolved_photo_url: string | null;
  address_label: string | null;
  category: string;
  urgency: string;
  department: string;
  status: string;
  channel: string;
  upvotes: number;
  internal_notes: string | null;
  citizen_rating: number | null;
  citizen_feedback: string | null;
  reopened_count: number;
  is_quarantined: number;
  quarantine_reason: string | null;
  reporterIds: string[];
  created_at: string;
}

interface ProviderConfigItem {
  provider: AIProvider;
  maskedKey: string;
  hasKey: boolean;
  baseUrl: string;
  enabled: boolean;
  draftKey?: string;
}

interface FeatureConfigItem {
  featureKey: AIFeatureKey;
  primaryProvider: AIProvider;
  primaryModel: string;
  backups: Array<{ provider: AIProvider; model: string }>;
  maxTokens: number;
  temperature: number;
}

interface RagDocItem {
  id: string;
  filename: string;
  doc_type: string;
  category?: string | null;
  source_url: string | null;
  status: 'VIGENTE' | 'DEROGADA';
  valid_until: string | null;
  usage_count: number;
  char_count: number;
  chunk_count: number;
  created_at: string;
}

interface SuggestedFaqItem {
  normalizedQuestion: string;
  sampleQuestion: string;
  suggestedAnswer: string;
  lang: string;
  count: number;
  escalated: boolean;
}

interface ActiveFaqItem {
  id: string;
  normalized_question: string;
  lang: string;
  answer: string;
  hits: number;
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

interface AidItem {
  id: string;
  title: string;
  description: string;
  discountLabel: string;
  deadline: string | null;
}

interface EscalatedConsultationItem {
  id: string;
  question: string;
  answer: string;
  lang: string;
  channel: string;
  escalated_to_human: number;
  human_answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

interface AnalyticsPayload {
  kpis: {
    totalIncidents: number;
    resolvedPercent: number;
    urgentActiveCount: number;
    quarantinedCount: number;
    totalConsultations: number;
    zeroTokenPercent: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    estimatedTokensSaved?: number;
    escalatedCount?: number;
    avgHoursToViewed?: number;
    avgHoursToResolved?: number;
  };
  byCategory: Array<{ name: string; count: number }>;
  byDepartment: Array<{ name: string; count: number }>;
  byStatus: Array<{ name: string; count: number }>;
  byChannel: Array<{ name: string; count: number }>;
  mapIncidents: AdminMapMarker[];
  recentConsultations: Array<{
    id: string;
    question: string;
    answer: string;
    topic: string | null;
    channel: string;
    tokens_saved: number;
    provider_used: string;
    created_at: string;
  }>;
}

async function compressFileToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('img'));
    i.src = raw;
  });
  const scale = Math.min(1, 800 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

export default function AdminPage() {
  const { municipalities, setMunicipalityBySlug } = useMunicipality();

  const [authUser, setAuthUser] = useState<{
    userId: string;
    name: string;
    email: string;
    role: string;
    municipalityId: string;
    municipalitySlug: string;
    municipalityName: string;
  } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('INCIDENTS');
  const [banner, setBanner] = useState<string | null>(null);

  // Pestaña 1: Incidencias y Cuarentena
  const [incidents, setIncidents] = useState<AdminIncident[]>([]);
  const [showQuarantineView, setShowQuarantineView] = useState(false);
  const [filterDept, setFilterDept] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterUrgency, setFilterUrgency] = useState('ALL');
  const [editingIncident, setEditingIncident] = useState<AdminIncident | null>(null);
  const [editStatus, setEditStatus] = useState('RECIBIDO');
  const [editUrgency, setEditUrgency] = useState('MEDIA');
  const [editDept, setEditDept] = useState('Atención Ciudadana');
  const [editNotes, setEditNotes] = useState('');
  const [editResolvedPhoto, setEditResolvedPhoto] = useState<string | null>(null);
  const [editQuarantined, setEditQuarantined] = useState(false);
  const [editQuarantineReason, setEditQuarantineReason] = useState('');
  const [savingIncident, setSavingIncident] = useState(false);

  // Pestaña 2: APIs de IA, Backups y FAQs Sugeridas
  const [providers, setProviders] = useState<ProviderConfigItem[]>([]);
  const [aiConfigs, setAiConfigs] = useState<FeatureConfigItem[]>([]);
  const [providerModels, setProviderModels] = useState<Record<AIProvider, string[]>>(
    DEFAULT_PROVIDER_MODELS
  );
  const [tokenStats, setTokenStats] = useState({
    totalConsultations: 0,
    zeroTokenConsultations: 0,
    savingsPercent: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedTokensSaved: 0,
  });
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [savingAi, setSavingAi] = useState(false);
  const [suggestedFaqs, setSuggestedFaqs] = useState<SuggestedFaqItem[]>([]);
  const [activeFaqs, setActiveFaqs] = useState<ActiveFaqItem[]>([]);
  const [escalatedList, setEscalatedList] = useState<EscalatedConsultationItem[]>([]);
  const [humanDrafts, setHumanDrafts] = useState<Record<string, string>>({});

  // Pestaña 3: Base de Conocimiento (RAG + Vigencia + Scraping)
  const [ragDocs, setRagDocs] = useState<RagDocItem[]>([]);
  const [ragVectorStats, setRagVectorStats] = useState<{
    totalChunks: number;
    vectorizedChunks: number;
    embeddingModel: string;
  }>({
    totalChunks: 0,
    vectorizedChunks: 0,
    embeddingModel: 'gemini-embedding-001',
  });
  const [scrapingRag, setScrapingRag] = useState(false);
  const [customSedeUrl, setCustomSedeUrl] = useState('');
  const [ragCategoryFilter, setRagCategoryFilter] = useState('ALL');
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [ragUploadDate, setRagUploadDate] = useState('2027-12-31');
  const [ragTextTitle, setRagTextTitle] = useState('');
  const [ragTextUrl, setRagTextUrl] = useState('');
  const [ragTextBody, setRagTextBody] = useState('');
  const [ragSearchQuery, setRagSearchQuery] = useState('');
  const [ragSearchResults, setRagSearchResults] = useState<
    Array<{
      chunkId: string;
      filename: string;
      category?: string | null;
      content: string;
      score: number;
      vectorScore?: number | null;
      retrievalMethod?: string;
      sourceUrl?: string | null;
    }>
  >([]);

  // Pestaña 4: Avisos por Calle y Ayudas
  const [alerts, setAlerts] = useState<StreetAlertItem[]>([]);
  const [aids, setAids] = useState<AidItem[]>([]);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertStreets, setAlertStreets] = useState<string[]>([]);
  const [alertSeverity, setAlertSeverity] = useState<'INFO' | 'WARNING' | 'CRITICAL'>('WARNING');
  const [alertStartDate, setAlertStartDate] = useState('2026-11-20');
  const [alertEndDate, setAlertEndDate] = useState('2026-11-28');

  const [aidTitle, setAidTitle] = useState('');
  const [aidDesc, setAidDesc] = useState('');
  const [aidDiscount, setAidDiscount] = useState('');
  const [aidDeadline, setAidDeadline] = useState('31/12/2026');
  const [aidReqLargeFamily, setAidReqLargeFamily] = useState(false);
  const [aidReqChildren, setAidReqChildren] = useState(false);
  const [aidReqSeniors, setAidReqSeniors] = useState(false);
  const [aidReqMobility, setAidReqMobility] = useState(false);
  const [aidReqMinHousehold, setAidReqMinHousehold] = useState(1);

  // Pestaña 5: Analíticas
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [resettingDemo, setResettingDemo] = useState(false);

  const loadAllAdminData = useCallback(async () => {
    const [incRes, aiRes, faqRes, ragRes, alertRes, aidRes, anRes, escRes] = await Promise.all([
      fetch('/api/admin/incidents', { cache: 'no-store' }),
      fetch('/api/admin/ai-config', { cache: 'no-store' }),
      fetch('/api/admin/faqs', { cache: 'no-store' }),
      fetch('/api/admin/rag', { cache: 'no-store' }),
      fetch('/api/admin/street-alerts', { cache: 'no-store' }),
      fetch('/api/admin/aids', { cache: 'no-store' }),
      fetch('/api/admin/analytics', { cache: 'no-store' }),
      fetch('/api/admin/consultations?onlyEscalated=1', { cache: 'no-store' }),
    ]);

    if (incRes.ok) {
      const d = (await incRes.json()) as { incidents: AdminIncident[] };
      setIncidents(d.incidents ?? []);
    }
    if (aiRes.ok) {
      const d = (await aiRes.json()) as {
        providers: ProviderConfigItem[];
        configs: FeatureConfigItem[];
        tokenStats: typeof tokenStats;
      };
      setProviders(
        (d.providers ?? []).map((p) => ({ ...p, draftKey: p.maskedKey }))
      );
      setAiConfigs(d.configs ?? []);
      if (d.tokenStats) setTokenStats(d.tokenStats);
    }
    if (faqRes.ok) {
      const d = (await faqRes.json()) as {
        activeFaqs: ActiveFaqItem[];
        suggestedFaqs: SuggestedFaqItem[];
      };
      setActiveFaqs(d.activeFaqs ?? []);
      setSuggestedFaqs(d.suggestedFaqs ?? []);
    }
    if (ragRes.ok) {
      const d = (await ragRes.json()) as {
        documents: RagDocItem[];
        vectorStats?: {
          totalChunks: number;
          vectorizedChunks: number;
          embeddingModel: string;
        };
      };
      setRagDocs(d.documents ?? []);
      if (d.vectorStats) {
        setRagVectorStats(d.vectorStats);
      }
    }
    if (alertRes.ok) {
      const d = (await alertRes.json()) as { alerts: StreetAlertItem[] };
      setAlerts(d.alerts ?? []);
    }
    if (aidRes.ok) {
      const d = (await aidRes.json()) as { aids: AidItem[] };
      setAids(d.aids ?? []);
    }
    if (anRes.ok) {
      const d = (await anRes.json()) as AnalyticsPayload;
      setAnalytics(d);
    }
    if (escRes.ok) {
      const d = (await escRes.json()) as {
        consultations: EscalatedConsultationItem[];
      };
      setEscalatedList(d.consultations ?? []);
    }
  }, []);

  const checkAdminAuth = useCallback(async () => {
    setAuthChecking(true);
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = (await res.json()) as { user?: typeof authUser };
      if (
        data.user &&
        (data.user.role === 'ADMIN' || data.user.role === 'DEPARTMENT')
      ) {
        setAuthUser(data.user);
        setMunicipalityBySlug(data.user.municipalitySlug);
        await loadAllAdminData();
      } else {
        setAuthUser(null);
      }
    } catch {
      setAuthUser(null);
    } finally {
      setAuthChecking(false);
    }
  }, [loadAllAdminData, setMunicipalityBySlug]);

  useEffect(() => {
    void checkAdminAuth();
  }, [checkAdminAuth]);

  async function quickSwitchAdmin(email: string, muniSlug: string) {
    setAuthChecking(true);
    setBanner(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: '1234',
          municipalityId: muniSlug,
          mode: 'ADMIN',
        }),
      });
      if (res.ok) {
        window.dispatchEvent(new Event('almeriacerca-auth-changed'));
        await checkAdminAuth();
      }
    } finally {
      setAuthChecking(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('almeriacerca-auth-changed'));
    setAuthUser(null);
  }

  function openIncidentEditor(inc: AdminIncident) {
    setEditingIncident(inc);
    setEditStatus(inc.status);
    setEditUrgency(inc.urgency);
    setEditDept(inc.department);
    setEditNotes(inc.internal_notes ?? '');
    setEditResolvedPhoto(inc.resolved_photo_url ?? null);
    setEditQuarantined(Boolean(inc.is_quarantined));
    setEditQuarantineReason(inc.quarantine_reason ?? '');
  }

  async function handleSaveIncident(e: React.FormEvent) {
    e.preventDefault();
    if (!editingIncident) return;
    setSavingIncident(true);
    setBanner(null);
    try {
      const res = await fetch(
        `/api/admin/incidents/${encodeURIComponent(editingIncident.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: editStatus,
            urgency: editUrgency,
            department: editDept,
            internalNotes: editNotes,
            resolvedPhotoUrl: editResolvedPhoto,
            isQuarantined: editQuarantined,
            quarantineReason: editQuarantined ? editQuarantineReason : null,
          }),
        }
      );
      if (res.ok) {
        const d = (await res.json()) as { notifiedReporters?: number };
        setEditingIncident(null);
        setBanner(
          `Incidencia ${editingIncident.tracking_code} actualizada (${editStatus}). Vecinos notificados: ${
            d.notifiedReporters ?? 0
          }.`
        );
        await loadAllAdminData();
      }
    } finally {
      setSavingIncident(false);
    }
  }

  async function handleRecoverFromQuarantine(inc: AdminIncident) {
    const res = await fetch(`/api/admin/incidents/${encodeURIComponent(inc.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isQuarantined: false,
        quarantineReason: null,
      }),
    });
    if (res.ok) {
      setBanner(`Aviso ${inc.tracking_code} recuperado de cuarentena como legítimo.`);
      await loadAllAdminData();
    }
  }

  async function handleDeleteIncident(incId: string) {
    const res = await fetch(`/api/admin/incidents/${encodeURIComponent(incId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setBanner('Aviso eliminado definitivamente.');
      await loadAllAdminData();
    }
  }

  async function handleSaveAiConfig() {
    setSavingAi(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providers: providers.map((p) => ({
            provider: p.provider,
            apiKey: p.draftKey ?? p.maskedKey,
            baseUrl: p.baseUrl,
            enabled: p.enabled,
          })),
          configs: aiConfigs,
        }),
      });
      if (res.ok) {
        setBanner('Configuración de proveedores IA y cadena de backups guardada.');
        await loadAllAdminData();
      }
    } finally {
      setSavingAi(false);
    }
  }

  async function handleTestProvider(p: ProviderConfigItem) {
    setTestResults((prev) => ({ ...prev, [p.provider]: 'Probando conexión...' }));
    const res = await fetch('/api/admin/ai-config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: p.provider,
        apiKey: p.draftKey,
        model: 'auto',
        baseUrl: p.baseUrl,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      model?: string;
      models?: string[];
      message?: string;
      latencyMs?: number;
    };
    if (Array.isArray(data.models) && data.models.length > 0) {
      const discovered = data.models;
      setProviderModels((prev) => ({
        ...prev,
        [p.provider]: discovered,
      }));
      setAiConfigs((prev) =>
        prev.map((cfg) => {
          const nextPrimaryModel =
            cfg.primaryProvider === p.provider &&
            cfg.primaryModel !== 'auto' &&
            !discovered.includes(cfg.primaryModel)
              ? 'auto'
              : cfg.primaryModel;
          const nextBackups = cfg.backups.map((bk) =>
            bk.provider === p.provider &&
            bk.model !== 'auto' &&
            !discovered.includes(bk.model)
              ? { ...bk, model: 'auto' }
              : bk
          );
          return {
            ...cfg,
            primaryModel: nextPrimaryModel,
            backups: nextBackups,
          };
        })
      );
    }
    setTestResults((prev) => ({
      ...prev,
      [p.provider]: `${data.ok ? '✅' : '❌'} ${data.message ?? ''} (${
        data.latencyMs ?? 0
      } ms)`,
    }));
  }

  async function handleApproveFaq(faq: SuggestedFaqItem) {
    const res = await fetch('/api/admin/faqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: faq.sampleQuestion,
        answer: faq.suggestedAnswer,
        lang: faq.lang,
      }),
    });
    if (res.ok) {
      setBanner(`FAQ aprobada en caché (0 tokens): "${faq.sampleQuestion}"`);
      await loadAllAdminData();
    }
  }

  async function handleDeleteFaq(id: string) {
    await fetch(`/api/admin/faqs?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await loadAllAdminData();
  }

  async function handleAnswerEscalated(
    item: EscalatedConsultationItem,
    promoteToFaq: boolean
  ) {
    const text = (humanDrafts[item.id] ?? item.human_answer ?? '').trim();
    if (!text) return;
    const res = await fetch(
      `/api/admin/consultations/${encodeURIComponent(item.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          humanAnswer: text,
          approveAsFaq: promoteToFaq,
        }),
      }
    );
    if (res.ok) {
      setBanner(
        promoteToFaq
          ? 'Consulta respondida por escrito y aprobada en Caché FAQ (0 tokens).'
          : 'Respuesta municipal guardada para la consulta derivada.'
      );
      await loadAllAdminData();
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);
    setBanner(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (ragUploadDate) formData.append('validUntil', ragUploadDate);

      const res = await fetch('/api/admin/rag/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        setBanner(`Documento "${file.name}" indexado en pgvector correctamente.`);
        await loadAllAdminData();
      }
    } finally {
      setUploadingDoc(false);
      e.target.value = '';
    }
  }

  async function handleTextOrUrlIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!ragTextTitle.trim() && !ragTextUrl.trim()) return;
    setUploadingDoc(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/rag/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: ragTextTitle.trim() || 'Fuente_Oficial.txt',
          sourceUrl: ragTextUrl.trim() || undefined,
          text: ragTextBody.trim(),
          validUntil: ragUploadDate || undefined,
        }),
      });
      if (res.ok) {
        setRagTextTitle('');
        setRagTextUrl('');
        setRagTextBody('');
        setBanner('Fuente oficial indexada con vigencia activa.');
        await loadAllAdminData();
      }
    } finally {
      setUploadingDoc(false);
    }
  }

  async function handleToggleDocStatus(doc: RagDocItem) {
    const nextStatus = doc.status === 'DEROGADA' ? 'VIGENTE' : 'DEROGADA';
    const res = await fetch(`/api/admin/rag/${encodeURIComponent(doc.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      setBanner(`Documento "${doc.filename}" marcado como ${nextStatus}.`);
      await loadAllAdminData();
    }
  }

  async function handleDeleteDoc(docId: string) {
    const res = await fetch(`/api/admin/rag/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setBanner('Documento eliminado del motor RAG.');
      await loadAllAdminData();
    }
  }

  async function handleRagLiveSearch(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ragSearchQuery }),
    });
    if (res.ok) {
      const d = (await res.json()) as { chunks: typeof ragSearchResults };
      setRagSearchResults(d.chunks ?? []);
    }
  }

  async function handleRunMunicipalScraper(mode: 'official_sync' | 'live_scrape') {
    setScrapingRag(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/rag/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          customSedeUrl: customSedeUrl.trim() || undefined,
          validUntil: ragUploadDate || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        documentsIndexed?: number;
        chunksIndexed?: number;
        vectorsGenerated?: number;
        tramitesCount?: number;
        lawsCount?: number;
        error?: string;
      };
      if (res.ok && data.ok) {
        setBanner(
          `Scraping y vectorización completados (${
            mode === 'live_scrape' ? 'En vivo' : 'Catálogo Oficial'
          }): ${data.documentsIndexed ?? 0} documentos (${
            data.tramitesCount ?? 0
          } trámites SIA + ${data.lawsCount ?? 0} leyes BOE), ${
            data.chunksIndexed ?? 0
          } fragmentos y ${
            data.vectorsGenerated ?? 0
          } vectores gemini-embedding-001 en pgvector.`
        );
        await loadAllAdminData();
      } else {
        setBanner(data.error || 'No se pudo completar el scraping.');
      }
    } finally {
      setScrapingRag(false);
    }
  }

  async function handleCreateStreetAlert(e: React.FormEvent) {
    e.preventDefault();
    if (!alertTitle.trim() || !alertMessage.trim() || alertStreets.length === 0) return;
    const res = await fetch('/api/admin/street-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: alertTitle,
        message: alertMessage,
        affectedStreets: alertStreets,
        severity: alertSeverity,
        startDate: alertStartDate,
        endDate: alertEndDate,
      }),
    });
    if (res.ok) {
      const d = (await res.json()) as { notifiedCount: number };
      setAlertTitle('');
      setAlertMessage('');
      setAlertStreets([]);
      setBanner(`Aviso de calle publicado. Notificado a ${d.notifiedCount} vecinos.`);
      await loadAllAdminData();
    }
  }

  async function handleCreateAid(e: React.FormEvent) {
    e.preventDefault();
    if (!aidTitle.trim() || !aidDesc.trim() || !aidDiscount.trim()) return;
    const requirements: Record<string, unknown> = {};
    if (aidReqLargeFamily) requirements.large_family = true;
    if (aidReqChildren) requirements.has_children = true;
    if (aidReqSeniors) requirements.has_seniors_or_dependents = true;
    if (aidReqMobility) requirements.reduced_mobility = true;
    if (aidReqMinHousehold > 1) requirements.min_household = aidReqMinHousehold;

    const res = await fetch('/api/admin/aids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: aidTitle,
        description: aidDesc,
        discountLabel: aidDiscount,
        deadline: aidDeadline,
        requirements,
      }),
    });
    if (res.ok) {
      const d = (await res.json()) as { matchedCount: number };
      setAidTitle('');
      setAidDesc('');
      setAidDiscount('');
      setBanner(`Nueva ayuda publicada. Compatible con ${d.matchedCount} vecinos.`);
      await loadAllAdminData();
    }
  }

  async function handleResetDemo() {
    setResettingDemo(true);
    try {
      const res = await fetch('/api/admin/reset-demo', { method: 'POST' });
      if (res.ok) {
        setBanner('Datos de demostración restaurados al estado inicial.');
        await loadAllAdminData();
      }
    } finally {
      setResettingDemo(false);
    }
  }

  const activeMuniRecord = useMemo(
    () =>
      municipalities.find(
        (m) =>
          m.id === authUser?.municipalityId ||
          m.slug === authUser?.municipalitySlug
      ) ?? municipalities[0],
    [municipalities, authUser]
  );

  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (showQuarantineView) {
        return Boolean(inc.is_quarantined);
      }
      if (inc.is_quarantined) return false;
      if (filterDept !== 'ALL' && inc.department !== filterDept) return false;
      if (filterStatus !== 'ALL' && inc.status !== filterStatus) return false;
      if (filterUrgency !== 'ALL' && inc.urgency !== filterUrgency) return false;
      return true;
    });
  }, [incidents, showQuarantineView, filterDept, filterStatus, filterUrgency]);

  const quarantinedTotal = useMemo(
    () => incidents.filter((i) => Boolean(i.is_quarantined)).length,
    [incidents]
  );

  if (authChecking) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-36 rounded-3xl bg-superficie/70 animate-pulse" />
        <div className="h-80 rounded-3xl bg-superficie/70 animate-pulse" />
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-8">
        <section className="rounded-3xl bg-tinta text-tarjeta p-8 shadow-sm flex flex-col gap-4 a11y-card">
          <Building2 className="w-10 h-10 text-solAlmeria" aria-hidden="true" />
          <h1 className="font-heading font-bold text-3xl">
            Panel Municipal Multi-Ayuntamiento
          </h1>
          <p className="text-tarjeta/85 text-base leading-relaxed">
            Inicia sesión con una cuenta de administrador municipal para gestionar incidencias, configuración de IA, documentos RAG y analíticas de tu municipio.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={() => void quickSwitchAdmin('admin@lucainena.es', 'lucainena')}
              className="min-h-[50px] px-6 rounded-2xl bg-solAlmeria text-tinta font-heading font-bold hover:opacity-95 transition-opacity"
            >
              Entrar como Admin Lucainena
            </button>
            <button
              type="button"
              onClick={() => void quickSwitchAdmin('admin@nijar.es', 'nijar')}
              className="min-h-[50px] px-6 rounded-2xl bg-tarjeta text-tinta font-heading font-bold hover:opacity-95 transition-opacity"
            >
              Entrar como Admin Níjar
            </button>
            <Link
              href="/login?next=/admin"
              className="min-h-[50px] px-6 rounded-2xl bg-superficie/20 text-tarjeta font-semibold inline-flex items-center justify-center"
            >
              Ir a Login
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const tabs: Array<{ key: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'INCIDENTS', label: '1. Incidencias y Cuarentena', icon: Wrench },
    { key: 'AI', label: '2. APIs IA, Backups y FAQs', icon: Cpu },
    { key: 'RAG', label: '3. Documentos RAG (pgvector)', icon: FileText },
    { key: 'BROADCAST', label: '4. Avisos Calle y Ayudas', icon: Megaphone },
    { key: 'ANALYTICS', label: '5. Mapa y Analíticas', icon: BarChart3 },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Cabecera Admin con Aislamiento Multi-Municipio */}
      <section className="rounded-3xl bg-tinta text-tarjeta p-6 sm:p-8 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6 a11y-card">
        <div>
          <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-solAlmeria text-tinta text-xs font-bold uppercase tracking-wide mb-2">
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
            Municipio Activo (Aislamiento Multi-Tenant)
          </span>
          <h1 className="font-heading font-bold text-3xl">
            Ayuntamiento de {authUser.municipalityName}
          </h1>
          <p className="text-sm sm:text-base text-tarjeta/80 mt-1">
            Sesión activa: <strong>{authUser.email}</strong> · Solo ves y editas datos de{' '}
            <strong>{authUser.municipalityName}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              void quickSwitchAdmin(
                authUser.municipalitySlug === 'lucainena'
                  ? 'admin@nijar.es'
                  : 'admin@lucainena.es',
                authUser.municipalitySlug === 'lucainena' ? 'nijar' : 'lucainena'
              )
            }
            className="min-h-[46px] px-4 rounded-2xl bg-tarjeta/15 hover:bg-tarjeta/25 text-tarjeta text-sm font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>
              Cambiar a Admin{' '}
              {authUser.municipalitySlug === 'lucainena' ? 'Níjar' : 'Lucainena'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="min-h-[46px] px-4 rounded-2xl bg-terracota text-tarjeta text-sm font-bold inline-flex items-center gap-2 hover:opacity-95 transition-opacity"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Salir</span>
          </button>
        </div>
      </section>

      {banner && (
        <div
          role="status"
          className="rounded-3xl bg-verdeCabo text-tarjeta p-5 font-semibold flex items-center justify-between gap-4 shadow-sm a11y-card"
        >
          <span className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 shrink-0" aria-hidden="true" />
            {banner}
          </span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="p-1.5 rounded-xl bg-tarjeta/20 hover:bg-tarjeta/30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 5 Pestañas amplias */}
      <div className="flex flex-wrap gap-3" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-[52px] px-5 py-3 rounded-2xl font-heading font-bold text-sm sm:text-base inline-flex items-center gap-2.5 border transition-all a11y-card ${
                active
                  ? 'bg-terracota text-tarjeta border-terracota shadow-sm'
                  : 'bg-tarjeta text-tinta border-superficie hover:bg-superficie/70'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* PESTAÑA 1: INCIDENCIAS, DEPARTAMENTOS Y CUARENTENA */}
      {activeTab === 'INCIDENTS' && (
        <section className="flex flex-col gap-6">
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-wrap items-center justify-between gap-4 a11y-card">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowQuarantineView(false)}
                className={`min-h-[44px] px-4 rounded-2xl font-bold text-sm transition-colors ${
                  !showQuarantineView
                    ? 'bg-tinta text-tarjeta'
                    : 'bg-arena text-tinta hover:bg-superficie'
                }`}
              >
                Avisos Activos ({incidents.length - quarantinedTotal})
              </button>
              <button
                type="button"
                onClick={() => setShowQuarantineView(true)}
                className={`min-h-[44px] px-4 rounded-2xl font-bold text-sm inline-flex items-center gap-2 transition-colors ${
                  showQuarantineView
                    ? 'bg-terracota text-tarjeta'
                    : 'bg-arena text-tinta hover:bg-superficie'
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                <span>Cuarentena / Spam ({quarantinedTotal})</span>
              </button>
            </div>

            {!showQuarantineView && (
              <div className="flex flex-wrap items-center gap-3">
                <select
                  aria-label="Filtrar por departamento"
                  value={filterDept}
                  onChange={(e) => setFilterDept(e.target.value)}
                  className="min-h-[44px] rounded-2xl bg-arena border border-superficie px-3 text-sm font-semibold text-tinta"
                >
                  <option value="ALL">Todos los departamentos</option>
                  {DEPT_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filtrar por estado"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="min-h-[44px] rounded-2xl bg-arena border border-superficie px-3 text-sm font-semibold text-tinta"
                >
                  <option value="ALL">Todos los estados (5)</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filtrar por prioridad"
                  value={filterUrgency}
                  onChange={(e) => setFilterUrgency(e.target.value)}
                  className="min-h-[44px] rounded-2xl bg-arena border border-superficie px-3 text-sm font-semibold text-tinta"
                >
                  <option value="ALL">Todas las prioridades</option>
                  {URGENCY_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredIncidents.map((inc) => (
              <div
                key={inc.id}
                className={`rounded-3xl bg-tarjeta border p-6 shadow-sm flex flex-col justify-between gap-4 a11y-card ${
                  inc.is_quarantined
                    ? 'border-2 border-terracota'
                    : 'border-superficie'
                }`}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="px-3.5 py-1 rounded-full bg-azulMed text-tarjeta font-heading font-bold text-sm">
                      {inc.tracking_code}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-3 py-1 rounded-full bg-superficie text-tinta text-xs font-bold">
                        {inc.status}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-terracota/15 text-terracota text-xs font-bold">
                        {inc.urgency}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-arena text-tinta text-xs font-bold">
                        +{inc.upvotes}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-heading font-bold text-xl text-tinta">
                      {inc.title}
                    </h3>
                    <p className="text-sm text-tinta/80 mt-1">{inc.description}</p>
                  </div>

                  <p className="text-xs font-semibold text-tinta/70">
                    {inc.department} · {inc.category} · {inc.address_label || authUser.municipalityName} · Canal: {inc.channel}
                  </p>

                  {inc.reopened_count > 0 && (
                    <p className="text-xs font-bold text-terracota">
                      ⚠ Reabierta por vecino ({inc.reopened_count} veces)
                    </p>
                  )}

                  {inc.citizen_rating && (
                    <p className="text-xs font-bold text-verdeCabo">
                      ★ Valoración ciudadana: {inc.citizen_rating}/5
                    </p>
                  )}

                  {inc.is_quarantined === 1 && (
                    <div className="rounded-2xl bg-terracota/10 border border-terracota/30 p-3 text-xs font-semibold text-terracota">
                      Motivo de cuarentena: {inc.quarantine_reason || 'Spam / Contenido no válido'}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-superficie">
                  <button
                    type="button"
                    onClick={() => openIncidentEditor(inc)}
                    className="flex-1 min-h-[44px] px-4 rounded-2xl bg-tinta text-tarjeta text-sm font-semibold hover:opacity-95 transition-opacity"
                  >
                    Gestionar estado / foto cierre
                  </button>

                  {inc.is_quarantined === 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleRecoverFromQuarantine(inc)}
                        className="min-h-[44px] px-4 rounded-2xl bg-verdeCabo text-tarjeta text-sm font-bold inline-flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Recuperar aviso legítimo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteIncident(inc.id)}
                        className="min-h-[44px] px-3 rounded-2xl bg-terracota/15 text-terracota hover:bg-terracota hover:text-tarjeta transition-colors"
                        aria-label="Eliminar definitivamente"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Modal de Gestión de Incidencia (5 estados + Foto de Cierre + Cuarentena) */}
          {editingIncident && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-tinta/60 backdrop-blur-sm p-4"
              role="dialog"
              aria-modal="true"
            >
              <form
                onSubmit={handleSaveIncident}
                className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-2xl flex flex-col gap-5 a11y-card"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="px-3 py-1 rounded-full bg-azulMed text-tarjeta text-xs font-bold">
                      {editingIncident.tracking_code}
                    </span>
                    <h2 className="font-heading font-bold text-2xl text-tinta mt-2">
                      {editingIncident.title}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingIncident(null)}
                    className="p-2 rounded-2xl bg-superficie text-tinta"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase text-tinta/70">
                      Estado (5 pasos)
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="min-h-[48px] rounded-2xl bg-arena border border-superficie px-3 font-semibold text-tinta"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase text-tinta/70">
                      Prioridad
                    </label>
                    <select
                      value={editUrgency}
                      onChange={(e) => setEditUrgency(e.target.value)}
                      className="min-h-[48px] rounded-2xl bg-arena border border-superficie px-3 font-semibold text-tinta"
                    >
                      {URGENCY_OPTIONS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase text-tinta/70">
                      Departamento
                    </label>
                    <select
                      value={editDept}
                      onChange={(e) => setEditDept(e.target.value)}
                      className="min-h-[48px] rounded-2xl bg-arena border border-superficie px-3 font-semibold text-tinta"
                    >
                      {DEPT_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase text-tinta/70">
                    Nota municipal para los vecinos reportantes
                  </label>
                  <textarea
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Explica la actuación realizada o el estado actual..."
                    className="rounded-2xl bg-arena border border-superficie p-3.5 text-sm text-tinta"
                  />
                </div>

                {/* Foto de cierre del operario */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold uppercase text-tinta/70">
                    Foto de cierre del operario (opcional)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setEditResolvedPhoto(await compressFileToDataUrl(f));
                      }
                    }}
                    className="text-sm text-tinta"
                  />
                  {editResolvedPhoto && (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={editResolvedPhoto}
                        alt="Vista previa resolución"
                        className="h-24 w-36 object-cover rounded-xl border border-superficie"
                      />
                      <button
                        type="button"
                        onClick={() => setEditResolvedPhoto(null)}
                        className="text-xs font-bold text-terracota"
                      >
                        Quitar foto
                      </button>
                    </div>
                  )}
                </div>

                {/* Control de Cuarentena / Spam */}
                <div className="rounded-2xl bg-arena border border-superficie p-4 flex flex-col gap-3">
                  <label className="flex items-center gap-2.5 text-sm font-bold text-tinta cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editQuarantined}
                      onChange={(e) => setEditQuarantined(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span>Enviar a Bandeja de Cuarentena / Spam</span>
                  </label>
                  {editQuarantined && (
                    <input
                      type="text"
                      value={editQuarantineReason}
                      onChange={(e) => setEditQuarantineReason(e.target.value)}
                      placeholder="Motivo (ej: Reporte spam, duplicado masivo o texto ofensivo)"
                      className="min-h-[44px] rounded-xl bg-tarjeta border border-superficie px-3 text-sm text-tinta"
                    />
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingIncident(null)}
                    className="min-h-[48px] px-5 rounded-2xl bg-superficie text-tinta font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingIncident}
                    className="min-h-[48px] px-6 rounded-2xl bg-verdeCabo text-tarjeta font-bold inline-flex items-center gap-2"
                  >
                    {savingIncident && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Guardar y notificar a vecinos</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>
      )}

      {/* PESTAÑA 2: APIs DE IA, BACKUPS Y FAQ SUGERIDAS */}
      {activeTab === 'AI' && (
        <section className="flex flex-col gap-8">
          {/* Indicador de ahorro de tokens */}
          <div className="rounded-3xl bg-verdeCabo text-tarjeta p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 a11y-card">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-tarjeta/80">
                Optimizador de Consumo de Tokens Activo
              </p>
              <h2 className="font-heading font-bold text-2xl mt-1">
                {tokenStats.savingsPercent}% de consultas servidas con 0 tokens
              </h2>
              <p className="text-sm text-tarjeta/90 mt-1">
                {tokenStats.zeroTokenConsultations} de {tokenStats.totalConsultations} consultas resueltas mediante Caché FAQ e Intenciones Locales.
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-xs font-bold">
                <span className="px-3 py-1 rounded-full bg-tarjeta/20">
                  Tokens Entrada: {tokenStats.totalInputTokens ?? 0}
                </span>
                <span className="px-3 py-1 rounded-full bg-tarjeta/20">
                  Tokens Salida: {tokenStats.totalOutputTokens ?? 0}
                </span>
                <span className="px-3 py-1 rounded-full bg-solAlmeria text-tinta">
                  Tokens Ahorrados Est.: {tokenStats.estimatedTokensSaved ?? 0}
                </span>
              </div>
            </div>
            <Bot className="w-12 h-12 text-tarjeta/80 shrink-0" />
          </div>

          {/* Gestión de Proveedores */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-5 a11y-card">
            <h2 className="font-heading font-bold text-2xl text-tinta">
              Proveedores de IA ({authUser.municipalityName})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {providers.map((p, idx) => (
                <div
                  key={p.provider}
                  className="rounded-2xl bg-arena border border-superficie p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-heading font-bold text-lg text-tinta">
                      {p.provider}
                    </span>
                    <label className="flex items-center gap-2 text-sm font-semibold text-tinta">
                      <input
                        type="checkbox"
                        disabled={p.provider === 'LOCAL'}
                        checked={p.enabled}
                        onChange={(e) => {
                          const next = [...providers];
                          next[idx] = { ...p, enabled: e.target.checked };
                          setProviders(next);
                        }}
                      />
                      <span>{p.enabled ? 'Activo' : 'Inactivo'}</span>
                    </label>
                  </div>

                  {p.provider !== 'LOCAL' && (
                    <input
                      type="text"
                      value={p.draftKey ?? ''}
                      onChange={(e) => {
                        const next = [...providers];
                        next[idx] = { ...p, draftKey: e.target.value };
                        setProviders(next);
                      }}
                      placeholder={`API Key de ${p.provider}`}
                      className="min-h-[44px] rounded-xl bg-tarjeta border border-superficie px-3 text-sm text-tinta"
                    />
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestProvider(p)}
                      className="min-h-[40px] px-4 rounded-xl bg-superficie hover:bg-tinta hover:text-tarjeta text-xs font-bold text-tinta transition-colors"
                    >
                      Probar conexión
                    </button>
                    {testResults[p.provider] && (
                      <span className="text-xs font-semibold text-tinta/80 truncate">
                        {testResults[p.provider]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Matriz por funcionalidad (CHAT, CLASSIFY, VISION) */}
            <h3 className="font-heading font-bold text-xl text-tinta pt-3">
              Matriz por Funcionalidad y Backups en Cascada
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {aiConfigs.map((cfg, cIdx) => (
                <div
                  key={cfg.featureKey}
                  className="rounded-2xl bg-arena border border-superficie p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 rounded-full bg-tinta text-tarjeta text-xs font-bold">
                      {cfg.featureKey}
                    </span>
                    <span className="text-xs font-semibold text-tinta/70">
                      max_tokens: {cfg.maxTokens}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-tinta/70">
                      Proveedor Principal
                    </label>
                    <select
                      value={cfg.primaryProvider}
                      onChange={(e) => {
                        const newProv = e.target.value as AIProvider;
                        const next = [...aiConfigs];
                        next[cIdx] = {
                          ...cfg,
                          primaryProvider: newProv,
                          primaryModel:
                            newProv === 'LOCAL' ? 'deterministic-v1' : 'auto',
                        };
                        setAiConfigs(next);
                      }}
                      className="min-h-[42px] rounded-xl bg-tarjeta border border-superficie px-3 text-sm font-semibold"
                    >
                      {PROVIDER_OPTIONS.map((pr) => (
                        <option key={pr} value={pr}>
                          {pr}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-tinta/70">
                      Modelo Principal
                    </label>
                    <select
                      value={cfg.primaryModel}
                      onChange={(e) => {
                        const next = [...aiConfigs];
                        next[cIdx] = { ...cfg, primaryModel: e.target.value };
                        setAiConfigs(next);
                      }}
                      className="min-h-[42px] rounded-xl bg-tarjeta border border-superficie px-3 text-sm font-semibold"
                    >
                      {cfg.primaryProvider !== 'LOCAL' && (
                        <option value="auto">
                          ✨ Automático (usando:{' '}
                          {previewAutoModel(
                            cfg.primaryProvider,
                            cfg.featureKey,
                            providerModels[cfg.primaryProvider]
                          )}
                          )
                        </option>
                      )}
                      {cfg.primaryModel &&
                        cfg.primaryModel !== 'auto' &&
                        !providerModels[cfg.primaryProvider].includes(
                          cfg.primaryModel
                        ) && (
                          <option value={cfg.primaryModel}>
                            {cfg.primaryModel}
                          </option>
                        )}
                      {providerModels[cfg.primaryProvider].map((mName) => (
                        <option key={mName} value={mName}>
                          {mName}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] font-semibold text-verdeCabo">
                      {cfg.primaryModel === 'auto'
                        ? `Modelo activo para ${cfg.featureKey}: ${previewAutoModel(
                            cfg.primaryProvider,
                            cfg.featureKey,
                            providerModels[cfg.primaryProvider]
                          )}`
                        : `Modelo fijado manualmente: ${cfg.primaryModel}`}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-tinta/70">
                      Límite max_tokens
                    </label>
                    <input
                      type="number"
                      value={cfg.maxTokens}
                      onChange={(e) => {
                        const next = [...aiConfigs];
                        next[cIdx] = {
                          ...cfg,
                          maxTokens: Number(e.target.value) || 180,
                        };
                        setAiConfigs(next);
                      }}
                      className="min-h-[42px] rounded-xl bg-tarjeta border border-superficie px-3 text-sm"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-tinta/70">
                        Backups en cascada
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...aiConfigs];
                          next[cIdx] = {
                            ...cfg,
                            backups: [
                              ...cfg.backups,
                              { provider: 'LOCAL', model: 'deterministic-v1' },
                            ],
                          };
                          setAiConfigs(next);
                        }}
                        className="text-xs font-bold text-azulMed inline-flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Añadir
                      </button>
                    </div>
                    {cfg.backups.map((bk, bIdx) => (
                      <div key={bIdx} className="flex items-center gap-1.5">
                        <select
                          value={bk.provider}
                          onChange={(e) => {
                            const newProv = e.target.value as AIProvider;
                            const next = [...aiConfigs];
                            const bks = [...cfg.backups];
                            bks[bIdx] = {
                              ...bk,
                              provider: newProv,
                              model:
                                newProv === 'LOCAL'
                                  ? 'deterministic-v1'
                                  : 'auto',
                            };
                            next[cIdx] = { ...cfg, backups: bks };
                            setAiConfigs(next);
                          }}
                          className="rounded-lg bg-tarjeta border border-superficie px-2 py-1.5 text-xs font-semibold"
                        >
                          {PROVIDER_OPTIONS.map((pr) => (
                            <option key={pr} value={pr}>
                              {pr}
                            </option>
                          ))}
                        </select>
                        <select
                          value={bk.model}
                          onChange={(e) => {
                            const next = [...aiConfigs];
                            const bks = [...cfg.backups];
                            bks[bIdx] = { ...bk, model: e.target.value };
                            next[cIdx] = { ...cfg, backups: bks };
                            setAiConfigs(next);
                          }}
                          className="flex-1 min-w-0 rounded-lg bg-tarjeta border border-superficie px-2 py-1.5 text-xs font-semibold"
                        >
                          {bk.provider !== 'LOCAL' && (
                            <option value="auto">
                              ✨ Auto (
                              {previewAutoModel(
                                bk.provider,
                                cfg.featureKey,
                                providerModels[bk.provider]
                              )}
                              )
                            </option>
                          )}
                          {bk.model &&
                            bk.model !== 'auto' &&
                            !providerModels[bk.provider].includes(bk.model) && (
                              <option value={bk.model}>{bk.model}</option>
                            )}
                          {providerModels[bk.provider].map((mName) => (
                            <option key={mName} value={mName}>
                              {mName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...aiConfigs];
                            next[cIdx] = {
                              ...cfg,
                              backups: cfg.backups.filter((_, i) => i !== bIdx),
                            };
                            setAiConfigs(next);
                          }}
                          className="p-1 text-terracota"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <button
                type="button"
                disabled={savingAi}
                onClick={() => void handleSaveAiConfig()}
                className="min-h-[50px] px-7 rounded-2xl bg-tinta text-tarjeta font-heading font-bold inline-flex items-center gap-2"
              >
                {savingAi ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Save className="w-5 h-5" />
                )}
                <span>Guardar configuración de IA</span>
              </button>
            </div>
          </div>

          {/* FAQ Sugeridas (1-clic para 0 tokens) */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-5 a11y-card">
            <div>
              <h2 className="font-heading font-bold text-2xl text-tinta flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-solAlmeria" />
                <span>FAQ Sugeridas (Aprobación 1-Clic → 0 Tokens)</span>
              </h2>
              <p className="text-sm text-tinta/75 mt-1">
                Detectadas a partir de consultas ciudadanas en {authUser.municipalityName}. Al aprobarlas, se responden instantáneamente en 0 tokens.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suggestedFaqs.map((faq) => (
                <div
                  key={`${faq.lang}:${faq.normalizedQuestion}`}
                  className="rounded-2xl bg-[#FDF5DF] border border-solAlmeria/70 p-4 flex flex-col justify-between gap-3"
                >
                  <div>
                    <span className="px-2.5 py-0.5 rounded-full bg-solAlmeria text-tinta text-xs font-bold">
                      Sugerida · {faq.count} consultas
                    </span>
                    <p className="font-heading font-bold text-base text-tinta mt-2">
                      {faq.sampleQuestion}
                    </p>
                    <p className="text-xs text-tinta/80 mt-1 line-clamp-3">
                      {faq.suggestedAnswer}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleApproveFaq(faq)}
                    className="min-h-[42px] px-4 rounded-xl bg-verdeCabo text-tarjeta text-xs font-bold inline-flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Aprobar FAQ (1 clic · 0 tokens)</span>
                  </button>
                </div>
              ))}
            </div>

            {activeFaqs.length > 0 && (
              <div className="pt-2">
                <h3 className="font-heading font-bold text-lg text-tinta mb-3">
                  FAQs Activas en Caché ({activeFaqs.length})
                </h3>
                <div className="flex flex-col gap-2.5">
                  {activeFaqs.map((f) => (
                    <div
                      key={f.id}
                      className="rounded-2xl bg-arena border border-superficie p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-tinta">
                          {f.normalized_question}{' '}
                          <span className="text-xs font-bold text-verdeCabo">
                            ({f.hits} hits · 0 tokens)
                          </span>
                        </p>
                        <p className="text-xs text-tinta/75 truncate">{f.answer}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteFaq(f.id)}
                        className="p-2 text-terracota hover:bg-terracota/10 rounded-xl shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Consultas Derivadas a Atención Humana ("Hablar con una persona") */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-5 a11y-card">
            <div>
              <h2 className="font-heading font-bold text-2xl text-tinta">
                Consultas Derivadas a Atención Humana ({escalatedList.length})
              </h2>
              <p className="text-sm text-tinta/75 mt-1">
                Responde por escrito a las consultas sin respaldo RAG o en las que el vecino pulsó &ldquo;Hablar con una persona&rdquo; y conviértelas en FAQ aprobada (0 tokens) con 1 clic.
              </p>
            </div>

            {escalatedList.length === 0 ? (
              <p className="text-sm text-tinta/70">
                No hay consultas derivadas pendientes en {authUser.municipalityName}.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {escalatedList.map((esc) => (
                  <div
                    key={esc.id}
                    className="rounded-2xl bg-arena border border-superficie p-4 flex flex-col gap-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-heading font-bold text-base text-tinta">
                        {esc.question}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-azulMed/15 text-azulMed text-xs font-bold">
                        {esc.human_answer ? `Respondida por ${esc.answered_by}` : 'Pendiente de respuesta'}
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      value={humanDrafts[esc.id] ?? esc.human_answer ?? ''}
                      onChange={(e) =>
                        setHumanDrafts((prev) => ({
                          ...prev,
                          [esc.id]: e.target.value,
                        }))
                      }
                      placeholder="Escribe aquí la respuesta oficial de Atención Ciudadana..."
                      className="rounded-xl bg-tarjeta border border-superficie p-3 text-sm text-tinta"
                    />
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        type="button"
                        onClick={() => void handleAnswerEscalated(esc, false)}
                        className="min-h-[40px] px-4 rounded-xl bg-azulMed text-tarjeta text-xs font-bold"
                      >
                        Guardar respuesta humana
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAnswerEscalated(esc, true)}
                        className="min-h-[40px] px-4 rounded-xl bg-verdeCabo text-tarjeta text-xs font-bold"
                      >
                        Responder y Aprobar como FAQ (0 tokens)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* PESTAÑA 3: BASE DE CONOCIMIENTO OFICIAL (RAG pgvector + VIGENCIA + SCRAPING) */}
      {activeTab === 'RAG' && (
        <section className="flex flex-col gap-8">
          {/* Panel de Scraping Oficial del Ayuntamiento, Sede Electrónica (SIA) y Leyes BOE */}
          <div className="rounded-3xl bg-tinta text-tarjeta p-6 sm:p-8 flex flex-col gap-5 shadow-sm a11y-card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-solAlmeria text-tinta text-xs font-bold uppercase tracking-wide mb-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  Scraping Municipal + Leyes BOE + Embeddings pgvector
                </span>
                <h2 className="font-heading font-bold text-2xl">
                  Sincronizador de Sede Electrónica, Trámites SIA y Legislación Local ({authUser.municipalityName})
                </h2>
                <p className="text-sm text-tarjeta/80 mt-1 max-w-3xl">
                  Extrae automáticamente las 16 secciones normativas de la Sede Electrónica, los 67 trámites del catálogo oficial (con Código SIA, requisitos y silencio administrativo) y el Compendio de Leyes BOE (Ley 39/2015, Ley 40/2015, Ley 7/1985 LRBRL, Haciendas Locales, Subvenciones, LISTA y LOPDGDD), generando vectores de 768 dimensiones con <code>gemini-embedding-001</code> en lotes (<code>batchEmbedContents</code>).
                </p>
              </div>
              <div className="rounded-2xl bg-tarjeta/10 border border-tarjeta/20 px-4 py-3 text-right shrink-0">
                <p className="text-xs font-bold uppercase text-solAlmeria">
                  Estado Base Vectorial (pgvector HNSW)
                </p>
                <p className="font-heading font-bold text-xl text-tarjeta mt-0.5">
                  {ragVectorStats.vectorizedChunks} / {ragVectorStats.totalChunks} chunks con vector
                </p>
                <p className="text-xs text-tarjeta/75">
                  Modelo: {ragVectorStats.embeddingModel} (768d)
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-center">
              <input
                type="url"
                value={customSedeUrl}
                onChange={(e) => setCustomSedeUrl(e.target.value)}
                placeholder={`URL Sede Electrónica (por defecto: https://sede.${
                  authUser.municipalitySlug === 'lucainena'
                    ? 'lucainenadelastorres'
                    : authUser.municipalitySlug
                }.es)`}
                className="min-h-[48px] rounded-2xl bg-tarjeta text-tinta px-4 text-sm font-medium"
              />
              <button
                type="button"
                disabled={scrapingRag}
                onClick={() => void handleRunMunicipalScraper('official_sync')}
                className="min-h-[48px] px-5 rounded-2xl bg-verdeCabo text-tarjeta font-heading font-bold text-sm inline-flex items-center justify-center gap-2 hover:opacity-95 transition-opacity disabled:opacity-60"
              >
                {scrapingRag ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>
                  {scrapingRag
                    ? 'Indexando y vectorizando lotes...'
                    : '1. Sincronizar Catálogo Oficial + 67 Trámites SIA + Leyes BOE'}
                </span>
              </button>
              <button
                type="button"
                disabled={scrapingRag}
                onClick={() => void handleRunMunicipalScraper('live_scrape')}
                className="min-h-[48px] px-5 rounded-2xl bg-solAlmeria text-tinta font-heading font-bold text-sm inline-flex items-center justify-center gap-2 hover:opacity-95 transition-opacity disabled:opacity-60"
              >
                {scrapingRag ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>2. Scraping en Vivo Sede Electrónica + Web Municipal</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Subida de archivo .pdf, .txt, .md, .json */}
            <div className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-col gap-4 a11y-card">
              <h2 className="font-heading font-bold text-xl text-tinta">
                Subir Documento Oficial (.pdf, .txt, .md, .json)
              </h2>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold uppercase text-tinta/70">
                  Fecha de vigencia de la normativa
                </label>
                <input
                  type="date"
                  value={ragUploadDate}
                  onChange={(e) => setRagUploadDate(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-arena border border-superficie px-3 text-sm font-semibold"
                />
              </div>
              <label className="min-h-[120px] rounded-3xl bg-verdeCabo/10 border-2 border-dashed border-verdeCabo text-verdeCabo font-heading font-bold flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-verdeCabo/15 transition-colors p-4 text-center">
                <Upload className="w-8 h-8" />
                <span>
                  {uploadingDoc
                    ? 'Indexando fragmentos y vectores en Supabase...'
                    : 'Seleccionar o arrastrar archivo (.pdf, .txt, .md, .json)'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Ingestar Texto o URL oficial */}
            <form
              onSubmit={handleTextOrUrlIngest}
              className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-col gap-3 a11y-card"
            >
              <h2 className="font-heading font-bold text-xl text-tinta">
                Ingestar Texto o URL Oficial Municipal
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={ragTextTitle}
                  onChange={(e) => setRagTextTitle(e.target.value)}
                  placeholder="Título (ej: Ordenanza_Fiscal_IBI_2026)"
                  className="min-h-[44px] rounded-xl bg-arena border border-superficie px-3 text-sm"
                />
                <input
                  type="url"
                  value={ragTextUrl}
                  onChange={(e) => setRagTextUrl(e.target.value)}
                  placeholder="URL oficial de Sede o BOE (opcional)"
                  className="min-h-[44px] rounded-xl bg-arena border border-superficie px-3 text-sm"
                />
              </div>
              <textarea
                rows={3}
                value={ragTextBody}
                onChange={(e) => setRagTextBody(e.target.value)}
                placeholder="Pega aquí el texto oficial de la ordenanza, bando o trámite (o déjalo vacío si indicas una URL oficial para hacer scraping)..."
                className="rounded-xl bg-arena border border-superficie p-3 text-sm"
              />
              <button
                type="submit"
                disabled={uploadingDoc}
                className="min-h-[46px] px-5 rounded-2xl bg-verdeCabo text-tarjeta font-bold text-sm"
              >
                Indexar fuente en Base de Conocimiento
              </button>
            </form>
          </div>

          {/* Listado de documentos con estado VIGENTE / DEROGADA, filtro por categoría y contador de usos */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-4 a11y-card">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-heading font-bold text-2xl text-tinta">
                Documentos Indexados en {authUser.municipalityName} ({ragDocs.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'ALL', label: `Todos (${ragDocs.length})` },
                  {
                    key: 'TRAMITES',
                    label: `Trámites SIA (${
                      ragDocs.filter((d) => d.category === 'tramite_sede' || d.doc_type === 'SIA').length
                    })`,
                  },
                  {
                    key: 'LEYES',
                    label: `Leyes BOE (${
                      ragDocs.filter((d) => d.category?.startsWith('ley_boe') || d.doc_type === 'BOE').length
                    })`,
                  },
                  {
                    key: 'SEDE',
                    label: `Sede y Ordenanzas (${
                      ragDocs.filter(
                        (d) =>
                          d.category !== 'tramite_sede' &&
                          !d.category?.startsWith('ley_boe') &&
                          d.doc_type !== 'SIA' &&
                          d.doc_type !== 'BOE'
                      ).length
                    })`,
                  },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setRagCategoryFilter(f.key)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      ragCategoryFilter === f.key
                        ? 'bg-tinta text-tarjeta'
                        : 'bg-arena text-tinta hover:bg-superficie'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[640px] overflow-y-auto pr-1">
              {ragDocs
                .filter((doc) => {
                  if (ragCategoryFilter === 'TRAMITES') {
                    return doc.category === 'tramite_sede' || doc.doc_type === 'SIA';
                  }
                  if (ragCategoryFilter === 'LEYES') {
                    return Boolean(doc.category?.startsWith('ley_boe') || doc.doc_type === 'BOE');
                  }
                  if (ragCategoryFilter === 'SEDE') {
                    return (
                      doc.category !== 'tramite_sede' &&
                      !doc.category?.startsWith('ley_boe') &&
                      doc.doc_type !== 'SIA' &&
                      doc.doc_type !== 'BOE'
                    );
                  }
                  return true;
                })
                .map((doc) => (
                  <div
                    key={doc.id}
                    className={`rounded-2xl p-5 border flex flex-col justify-between gap-4 ${
                      doc.status === 'DEROGADA'
                        ? 'bg-superficie/40 border-terracota/40 opacity-80'
                        : 'bg-arena border-superficie'
                    }`}
                  >
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold ${
                              doc.status === 'DEROGADA'
                                ? 'bg-terracota text-tarjeta'
                                : 'bg-verdeCabo text-tarjeta'
                            }`}
                          >
                            {doc.status}
                          </span>
                          {doc.category && (
                            <span className="px-2.5 py-0.5 rounded-full bg-superficie text-tinta text-xs font-semibold">
                              {doc.category}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-bold text-azulMed">
                          Usado en {doc.usage_count} respuestas · {doc.chunk_count} chunks
                        </span>
                      </div>
                      <h3 className="font-heading font-bold text-lg text-tinta mt-2">
                        {doc.filename}
                      </h3>
                      <p className="text-xs text-tinta/70 mt-1">
                        Tipo: {doc.doc_type} · {doc.char_count} caracteres
                        {doc.valid_until ? ` · Vigente hasta: ${doc.valid_until}` : ''}
                      </p>
                      {doc.source_url && (
                        <a
                          href={doc.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-xs font-bold text-azulMed underline mt-1 truncate max-w-full"
                        >
                          Fuente oficial: {doc.source_url} ↗
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleToggleDocStatus(doc)}
                        className={`flex-1 min-h-[40px] px-4 rounded-xl text-xs font-bold transition-colors ${
                          doc.status === 'DEROGADA'
                            ? 'bg-verdeCabo text-tarjeta'
                            : 'bg-solAlmeria text-tinta'
                        }`}
                      >
                        {doc.status === 'DEROGADA'
                          ? 'Reactivar vigencia (1 clic)'
                          : 'Derogar documento (1 clic)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteDoc(doc.id)}
                        className="p-2.5 rounded-xl bg-terracota/15 text-terracota hover:bg-terracota hover:text-tarjeta transition-colors"
                        aria-label="Eliminar documento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Buscador en vivo RAG */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-4 a11y-card">
            <h2 className="font-heading font-bold text-xl text-tinta">
              Probar Recuperación RAG Híbrida en Directo (pgvector gemini-embedding-001 + FTS)
            </h2>
            <form onSubmit={handleRagLiveSearch} className="flex gap-3">
              <input
                type="text"
                value={ragSearchQuery}
                onChange={(e) => setRagSearchQuery(e.target.value)}
                placeholder="Ej: alta de suministro de agua potable, Ley 39/2015 plazos, SIA 3318987 o bonificación IBI..."
                className="flex-1 min-h-[48px] rounded-2xl bg-arena border border-superficie px-4 text-sm"
              />
              <button
                type="submit"
                className="min-h-[48px] px-6 rounded-2xl bg-azulMed text-tarjeta font-bold text-sm inline-flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                <span>Buscar fragmentos</span>
              </button>
            </form>

            {ragSearchResults.length > 0 && (
              <div className="flex flex-col gap-3">
                {ragSearchResults.map((ch) => (
                  <div
                    key={ch.chunkId}
                    className="rounded-2xl bg-arena border border-superficie p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-verdeCabo mb-1.5">
                      <span>
                        {ch.filename}
                        {ch.category ? ` (${ch.category})` : ''}
                      </span>
                      <span>
                        Método: {(ch.retrievalMethod ?? 'hybrid').toUpperCase()} · Score:{' '}
                        {ch.score}
                        {typeof ch.vectorScore === 'number'
                          ? ` (Coseno vector: ${ch.vectorScore})`
                          : ''}
                      </span>
                    </div>
                    {ch.sourceUrl && (
                      <a
                        href={ch.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block text-xs font-semibold text-azulMed underline mb-2"
                      >
                        {ch.sourceUrl} ↗
                      </a>
                    )}
                    <p className="text-sm text-tinta/85 whitespace-pre-line">{ch.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* PESTAÑA 4: AVISOS POR CALLE Y AYUDAS */}
      {activeTab === 'BROADCAST' && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Crear aviso de calle */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-5 a11y-card">
            <h2 className="font-heading font-bold text-2xl text-tinta flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-terracota" />
              <span>Publicar Aviso o Corte de Calle</span>
            </h2>

            <form onSubmit={handleCreateStreetAlert} className="flex flex-col gap-4">
              <input
                type="text"
                required
                value={alertTitle}
                onChange={(e) => setAlertTitle(e.target.value)}
                placeholder="Título del aviso (ej: Obras de red de agua en Calle Real)"
                className="min-h-[48px] rounded-2xl bg-arena border border-superficie px-4 text-sm"
              />
              <textarea
                rows={3}
                required
                value={alertMessage}
                onChange={(e) => setAlertMessage(e.target.value)}
                placeholder="Descripción clara del horario y calles afectadas..."
                className="rounded-2xl bg-arena border border-superficie p-4 text-sm"
              />

              <div>
                <p className="text-xs font-bold uppercase text-tinta/70 mb-2">
                  Selecciona las calles afectadas ({authUser.municipalityName})
                </p>
                <div className="flex flex-wrap gap-2">
                  {(activeMuniRecord?.streets ?? []).map((st) => {
                    const selected = alertStreets.includes(st);
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() =>
                          setAlertStreets((prev) =>
                            selected ? prev.filter((x) => x !== st) : [...prev, st]
                          )
                        }
                        className={`px-3.5 py-2 rounded-2xl text-xs font-bold border transition-colors ${
                          selected
                            ? 'bg-terracota text-tarjeta border-terracota'
                            : 'bg-arena text-tinta border-superficie'
                        }`}
                      >
                        {st}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <select
                  value={alertSeverity}
                  onChange={(e) =>
                    setAlertSeverity(e.target.value as 'INFO' | 'WARNING' | 'CRITICAL')
                  }
                  className="min-h-[44px] rounded-xl bg-arena border border-superficie px-3 text-xs font-bold"
                >
                  <option value="INFO">INFO</option>
                  <option value="WARNING">WARNING</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
                <input
                  type="date"
                  value={alertStartDate}
                  onChange={(e) => setAlertStartDate(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-arena border border-superficie px-3 text-xs"
                />
                <input
                  type="date"
                  value={alertEndDate}
                  onChange={(e) => setAlertEndDate(e.target.value)}
                  className="min-h-[44px] rounded-xl bg-arena border border-superficie px-3 text-xs"
                />
              </div>

              <button
                type="submit"
                className="min-h-[50px] px-6 rounded-2xl bg-terracota text-tarjeta font-heading font-bold"
              >
                Publicar y notificar a vecinos de la calle
              </button>
            </form>

            <div className="flex flex-col gap-2.5 pt-2">
              {alerts.map((al) => (
                <div
                  key={al.id}
                  className="rounded-2xl bg-arena border border-superficie p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-tinta">{al.title}</p>
                    <p className="text-xs text-tinta/70">
                      {al.affectedStreets.join(', ')} ({al.startDate} → {al.endDate})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(
                        `/api/admin/street-alerts?id=${encodeURIComponent(al.id)}`,
                        { method: 'DELETE' }
                      );
                      await loadAllAdminData();
                    }}
                    className="p-2 text-terracota"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Crear ayuda o descuento municipal */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-5 a11y-card">
            <h2 className="font-heading font-bold text-2xl text-tinta flex items-center gap-2">
              <Gift className="w-6 h-6 text-verdeCabo" />
              <span>Crear Ayuda o Descuento Municipal</span>
            </h2>

            <form onSubmit={handleCreateAid} className="flex flex-col gap-4">
              <input
                type="text"
                required
                value={aidTitle}
                onChange={(e) => setAidTitle(e.target.value)}
                placeholder="Título de la ayuda (ej: Bono Familiar Agua y Basura)"
                className="min-h-[48px] rounded-2xl bg-arena border border-superficie px-4 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={aidDiscount}
                  onChange={(e) => setAidDiscount(e.target.value)}
                  placeholder="Descuento (ej: 50% descuento)"
                  className="min-h-[44px] rounded-xl bg-arena border border-superficie px-3 text-sm"
                />
                <input
                  type="text"
                  value={aidDeadline}
                  onChange={(e) => setAidDeadline(e.target.value)}
                  placeholder="Plazo (ej: 31/12/2026)"
                  className="min-h-[44px] rounded-xl bg-arena border border-superficie px-3 text-sm"
                />
              </div>
              <textarea
                rows={3}
                required
                value={aidDesc}
                onChange={(e) => setAidDesc(e.target.value)}
                placeholder="Descripción sencilla de la ayuda..."
                className="rounded-2xl bg-arena border border-superficie p-4 text-sm"
              />

              <div className="grid grid-cols-2 gap-2.5 text-xs font-semibold text-tinta">
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-arena border border-superficie">
                  <input
                    type="checkbox"
                    checked={aidReqLargeFamily}
                    onChange={(e) => setAidReqLargeFamily(e.target.checked)}
                  />
                  <span>Familia numerosa</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-arena border border-superficie">
                  <input
                    type="checkbox"
                    checked={aidReqChildren}
                    onChange={(e) => setAidReqChildren(e.target.checked)}
                  />
                  <span>Menores en casa</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-arena border border-superficie">
                  <input
                    type="checkbox"
                    checked={aidReqSeniors}
                    onChange={(e) => setAidReqSeniors(e.target.checked)}
                  />
                  <span>Mayores / Dependientes</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-arena border border-superficie">
                  <input
                    type="checkbox"
                    checked={aidReqMobility}
                    onChange={(e) => setAidReqMobility(e.target.checked)}
                  />
                  <span>Movilidad reducida</span>
                </label>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-tinta/70">
                  Mínimo integrantes en casa:
                </label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={aidReqMinHousehold}
                  onChange={(e) => setAidReqMinHousehold(Number(e.target.value) || 1)}
                  className="w-20 min-h-[40px] rounded-xl bg-arena border border-superficie px-3 text-sm font-bold"
                />
              </div>

              <button
                type="submit"
                className="min-h-[50px] px-6 rounded-2xl bg-verdeCabo text-tarjeta font-heading font-bold"
              >
                Publicar ayuda y cruzar con perfiles (0 tokens)
              </button>
            </form>

            <div className="flex flex-col gap-2.5 pt-2">
              {aids.map((a) => (
                <div
                  key={a.id}
                  className="rounded-2xl bg-arena border border-superficie p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-tinta">
                      {a.title} ·{' '}
                      <span className="text-verdeCabo">{a.discountLabel}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(`/api/admin/aids?id=${encodeURIComponent(a.id)}`, {
                        method: 'DELETE',
                      });
                      await loadAllAdminData();
                    }}
                    className="p-2 text-terracota"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* PESTAÑA 5: MAPA, CONSULTAS Y ANALÍTICAS */}
      {activeTab === 'ANALYTICS' && analytics && (
        <section className="flex flex-col gap-8">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="rounded-3xl bg-tarjeta border border-superficie p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tinta/60">Total Avisos</p>
              <p className="font-heading font-bold text-3xl text-tinta mt-1">
                {analytics.kpis.totalIncidents}
              </p>
            </div>
            <div className="rounded-3xl bg-verdeCabo text-tarjeta p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tarjeta/80">% Resueltos</p>
              <p className="font-heading font-bold text-3xl mt-1">
                {analytics.kpis.resolvedPercent}%
              </p>
            </div>
            <div className="rounded-3xl bg-terracota text-tarjeta p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tarjeta/80">
                Urgentes Activos
              </p>
              <p className="font-heading font-bold text-3xl mt-1">
                {analytics.kpis.urgentActiveCount}
              </p>
            </div>
            <div className="rounded-3xl bg-solAlmeria text-tinta p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tinta/75">Cuarentena</p>
              <p className="font-heading font-bold text-3xl mt-1">
                {analytics.kpis.quarantinedCount}
              </p>
            </div>
            <div className="rounded-3xl bg-azulMed text-tarjeta p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tarjeta/80">Consultas</p>
              <p className="font-heading font-bold text-3xl mt-1">
                {analytics.kpis.totalConsultations}
              </p>
            </div>
            <div className="rounded-3xl bg-buganvilla text-tarjeta p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tarjeta/80">
                Ahorro 0-Tokens
              </p>
              <p className="font-heading font-bold text-3xl mt-1">
                {analytics.kpis.zeroTokenPercent}%
              </p>
            </div>
          </div>

          {/* Tiempos reales de respuesta/resolución y métricas de tokens */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-3xl bg-tarjeta border border-superficie p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tinta/60">
                Tiempo Medio hasta «Visto»
              </p>
              <p className="font-heading font-bold text-2xl text-azulMed mt-1">
                {analytics.kpis.avgHoursToViewed ?? 0} h
              </p>
              <p className="text-xs text-tinta/70 mt-0.5">
                Calculado sobre marcas reales <code>viewed_at</code>
              </p>
            </div>
            <div className="rounded-3xl bg-tarjeta border border-superficie p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tinta/60">
                Tiempo Medio hasta «Resuelto»
              </p>
              <p className="font-heading font-bold text-2xl text-verdeCabo mt-1">
                {analytics.kpis.avgHoursToResolved ?? 0} h
              </p>
              <p className="text-xs text-tinta/70 mt-0.5">
                Calculado sobre marcas reales <code>resolved_at</code>
              </p>
            </div>
            <div className="rounded-3xl bg-tarjeta border border-superficie p-5 a11y-card">
              <p className="text-xs font-bold uppercase text-tinta/60">
                Balance de Tokens (Entrada / Salida / Ahorrados)
              </p>
              <p className="font-heading font-bold text-xl text-tinta mt-1">
                {analytics.kpis.totalInputTokens ?? 0} in ·{' '}
                {analytics.kpis.totalOutputTokens ?? 0} out ·{' '}
                <span className="text-verdeCabo">
                  +{analytics.kpis.estimatedTokensSaved ?? 0} ahorrados
                </span>
              </p>
            </div>
          </div>

          {/* Mapa Interactivo Leaflet */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-col gap-4 a11y-card">
            <h2 className="font-heading font-bold text-2xl text-tinta">
              Mapa de Incidencias de {authUser.municipalityName}
            </h2>
            <AdminMap
              center={[
                activeMuniRecord?.center_lat ?? 37.0408,
                activeMuniRecord?.center_lng ?? -2.1995,
              ]}
              incidents={analytics.mapIncidents}
            />
          </div>

          {/* Gráficas Recharts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-col gap-3 a11y-card">
              <h3 className="font-heading font-bold text-lg text-tinta">
                Incidencias por Categoría
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.byCategory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#E45735" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-col gap-3 a11y-card">
              <h3 className="font-heading font-bold text-lg text-tinta">
                Carga por Departamento
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.byDepartment}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#1B8A7A" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-3xl bg-tarjeta border border-superficie p-6 flex flex-col gap-3 a11y-card">
              <h3 className="font-heading font-bold text-lg text-tinta">
                Canales Web vs WhatsApp
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analytics.byChannel}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label
                    >
                      {analytics.byChannel.map((_, index) => (
                        <Cell
                          key={index}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Historial de consultas recientes + Reset Demo */}
          <div className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 flex flex-col gap-4 a11y-card">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="font-heading font-bold text-xl text-tinta">
                Últimas Consultas Ciudadanas ({analytics.recentConsultations.length})
              </h3>
              <button
                type="button"
                disabled={resettingDemo}
                onClick={() => void handleResetDemo()}
                className="min-h-[44px] px-4 rounded-2xl bg-superficie hover:bg-terracota hover:text-tarjeta text-xs font-bold text-tinta inline-flex items-center gap-2 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>
                  {resettingDemo ? 'Restaurando...' : 'Reiniciar datos de demo'}
                </span>
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              {analytics.recentConsultations.map((c) => (
                <div
                  key={c.id}
                  className="rounded-2xl bg-arena border border-superficie p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-tinta">{c.question}</p>
                    <p className="text-xs text-tinta/75 truncate">{c.answer}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2.5 py-1 rounded-full bg-azulMed/15 text-azulMed text-xs font-bold">
                      {c.channel}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-verdeCabo/15 text-verdeCabo text-xs font-bold">
                      {c.provider_used}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
