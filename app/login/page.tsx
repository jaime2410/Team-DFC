'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Building2,
  KeyRound,
  Loader2,
  LogIn,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/I18nProvider';
import { useMunicipality } from '@/lib/municipality/MunicipalityProvider';

type MainTab = 'CITIZEN' | 'ADMIN';
type AuthMode = 'LOGIN' | 'REGISTER';

interface LoginResponse {
  user?: {
    userId: string;
    name: string;
    email: string;
    role: 'CITIZEN' | 'ADMIN' | 'DEPARTMENT';
    municipalitySlug: string;
    municipalityName: string;
  };
  error?: string;
}

function LoginContent() {
  const { t, lang } = useTranslation();
  const { municipalities, currentMunicipality, setMunicipalityBySlug } = useMunicipality();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<MainTab>('CITIZEN');
  const [citizenMode, setCitizenMode] = useState<AuthMode>('LOGIN');
  const [adminMode, setAdminMode] = useState<AuthMode>('LOGIN');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminInviteCode, setAdminInviteCode] = useState('');
  const [adminMunicipality, setAdminMunicipality] = useState(
    currentMunicipality?.slug ?? 'lucainena'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeMuniSlug = currentMunicipality?.slug ?? 'lucainena';
  const activeMuniName = currentMunicipality?.name ?? 'Lucainena de las Torres';

  function completeAuth(user: NonNullable<LoginResponse['user']>) {
    setMunicipalityBySlug(user.municipalitySlug);
    window.dispatchEvent(new Event('almeriacerca-auth-changed'));
    const nextUrl = searchParams.get('next');
    if (nextUrl && nextUrl.startsWith('/')) {
      router.push(nextUrl);
    } else if (user.role === 'ADMIN' || user.role === 'DEPARTMENT') {
      router.push('/admin');
    } else {
      router.push('/mi-perfil');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (tab === 'CITIZEN' && citizenMode === 'REGISTER') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            password,
            municipalityId: activeMuniSlug,
            preferredLang: lang,
            role: 'CITIZEN',
          }),
        });
        const data = (await res.json()) as LoginResponse;
        if (!res.ok || !data.user) {
          setError(data.error || t('login.errorGeneric'));
          return;
        }
        completeAuth(data.user);
        return;
      }

      if (tab === 'ADMIN' && adminMode === 'REGISTER') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            password,
            municipalityId: adminMunicipality,
            preferredLang: lang,
            role: 'ADMIN',
            inviteCode: adminInviteCode.trim(),
          }),
        });
        const data = (await res.json()) as LoginResponse;
        if (!res.ok || !data.user) {
          setError(data.error || t('login.errorGeneric'));
          return;
        }
        completeAuth(data.user);
        return;
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          municipalityId: tab === 'ADMIN' ? adminMunicipality : activeMuniSlug,
          mode: tab,
          strictMunicipality: tab === 'ADMIN',
        }),
      });
      const data = (await res.json()) as LoginResponse;
      if (!res.ok || !data.user) {
        setError(data.error || t('login.errorGeneric'));
        return;
      }
      completeAuth(data.user);
    } catch {
      setError(t('login.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  async function quickDemoLogin(demoEmail: string, demoMuniSlug: string, mode: MainTab) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: demoEmail,
          password: '1234',
          municipalityId: demoMuniSlug,
          mode,
        }),
      });
      const data = (await res.json()) as LoginResponse;
      if (!res.ok || !data.user) {
        setError(data.error || t('login.errorGeneric'));
        return;
      }
      completeAuth(data.user);
    } catch {
      setError(t('login.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  const isRegistering =
    (tab === 'CITIZEN' && citizenMode === 'REGISTER') ||
    (tab === 'ADMIN' && adminMode === 'REGISTER');

  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-8">
      <section className="rounded-3xl bg-buganvilla text-tarjeta p-6 sm:p-8 shadow-sm a11y-card">
        <h1 className="font-heading font-bold text-3xl">{t('login.title')}</h1>
        <p className="mt-2 text-base sm:text-lg text-tarjeta/90 leading-relaxed">
          {t('login.subtitle', { municipality: activeMuniName })}
        </p>
      </section>

      {/* Dos pestañas amplias y espaciadas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'CITIZEN'}
          onClick={() => {
            setTab('CITIZEN');
            setError(null);
          }}
          className={`min-h-[64px] rounded-3xl p-4 font-heading font-bold text-lg flex items-center justify-center gap-3 border transition-all a11y-card ${
            tab === 'CITIZEN'
              ? 'bg-buganvilla text-tarjeta border-buganvilla shadow-sm'
              : 'bg-tarjeta text-tinta border-superficie hover:bg-superficie/60'
          }`}
        >
          <Users className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>{t('login.tabCitizen')}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ADMIN'}
          onClick={() => {
            setTab('ADMIN');
            setAdminMunicipality(activeMuniSlug);
            setError(null);
          }}
          className={`min-h-[64px] rounded-3xl p-4 font-heading font-bold text-lg flex items-center justify-center gap-3 border transition-all a11y-card ${
            tab === 'ADMIN'
              ? 'bg-tinta text-tarjeta border-tinta shadow-sm'
              : 'bg-tarjeta text-tinta border-superficie hover:bg-superficie/60'
          }`}
        >
          <Building2 className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>{t('login.tabAdmin')}</span>
        </button>
      </div>

      {/* Formulario principal */}
      <section className="rounded-3xl bg-tarjeta border border-superficie p-6 sm:p-8 shadow-sm flex flex-col gap-6 a11y-card">
        {tab === 'CITIZEN' ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setCitizenMode('LOGIN');
                setError(null);
              }}
              className={`flex-1 min-h-[48px] px-5 rounded-2xl font-semibold inline-flex items-center justify-center gap-2 border transition-colors ${
                citizenMode === 'LOGIN'
                  ? 'bg-superficie text-tinta border-tinta/30 font-bold'
                  : 'bg-arena/60 text-tinta/75 border-superficie hover:bg-superficie/50'
              }`}
            >
              <LogIn className="w-4 h-4" aria-hidden="true" />
              <span>{t('login.citizenSignIn')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCitizenMode('REGISTER');
                setError(null);
              }}
              className={`flex-1 min-h-[48px] px-5 rounded-2xl font-semibold inline-flex items-center justify-center gap-2 border transition-colors ${
                citizenMode === 'REGISTER'
                  ? 'bg-superficie text-tinta border-tinta/30 font-bold'
                  : 'bg-arena/60 text-tinta/75 border-superficie hover:bg-superficie/50'
              }`}
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              <span>{t('login.citizenRegister')}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setAdminMode('LOGIN');
                setError(null);
              }}
              className={`flex-1 min-h-[48px] px-5 rounded-2xl font-semibold inline-flex items-center justify-center gap-2 border transition-colors ${
                adminMode === 'LOGIN'
                  ? 'bg-superficie text-tinta border-tinta/30 font-bold'
                  : 'bg-arena/60 text-tinta/75 border-superficie hover:bg-superficie/50'
              }`}
            >
              <LogIn className="w-4 h-4" aria-hidden="true" />
              <span>Entrar como Administrador</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminMode('REGISTER');
                setError(null);
              }}
              className={`flex-1 min-h-[48px] px-5 rounded-2xl font-semibold inline-flex items-center justify-center gap-2 border transition-colors ${
                adminMode === 'REGISTER'
                  ? 'bg-superficie text-tinta border-tinta/30 font-bold'
                  : 'bg-arena/60 text-tinta/75 border-superficie hover:bg-superficie/50'
              }`}
            >
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              <span>Registrar nuevo Admin (con código)</span>
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-2xl bg-terracota/10 border border-terracota/40 p-4 text-sm font-semibold text-terracota"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {tab === 'ADMIN' && (
            <div className="flex flex-col gap-2">
              <label htmlFor="admin-municipality" className="font-semibold text-tinta flex items-center gap-2">
                <MapPin className="w-4 h-4 text-terracota" aria-hidden="true" />
                {t('login.adminMunicipalityLabel')}
              </label>
              <select
                id="admin-municipality"
                value={adminMunicipality}
                onChange={(e) => setAdminMunicipality(e.target.value)}
                className="min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 font-semibold text-tinta focus:outline-none focus:ring-2 focus:ring-tinta"
              >
                {municipalities.map((m) => (
                  <option key={m.id} value={m.slug}>
                    {m.name} ({m.province})
                  </option>
                ))}
              </select>
            </div>
          )}

          {isRegistering && (
            <div className="flex flex-col gap-2">
              <label htmlFor="register-name" className="font-semibold text-tinta">
                {t('login.nameLabel')}
              </label>
              <input
                id="register-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  tab === 'ADMIN'
                    ? 'Ej: Responsable Atención Municipal'
                    : t('login.namePlaceholder')
                }
                className="min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 text-base text-tinta focus:outline-none focus:ring-2 focus:ring-buganvilla"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="login-email" className="font-semibold text-tinta">
              {t('login.emailLabel')}
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                tab === 'ADMIN' ? 'admin@lucainena.es' : 'vecino@lucainena.es'
              }
              className="min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 text-base text-tinta focus:outline-none focus:ring-2 focus:ring-buganvilla"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="login-password" className="font-semibold text-tinta">
              {t('login.passwordLabel')}
            </label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••"
              className="min-h-[52px] rounded-2xl bg-arena border border-superficie px-4 text-base text-tinta focus:outline-none focus:ring-2 focus:ring-buganvilla"
            />
          </div>

          {tab === 'ADMIN' && adminMode === 'REGISTER' && (
            <div className="flex flex-col gap-2 rounded-2xl bg-[#FDF5DF] border border-solAlmeria p-4">
              <label
                htmlFor="admin-invite-code"
                className="font-semibold text-tinta flex items-center gap-2 text-sm"
              >
                <ShieldCheck className="w-4 h-4 text-terracota" aria-hidden="true" />
                <span>Código de invitación municipal (requerido para alta Admin)</span>
              </label>
              <input
                id="admin-invite-code"
                type="text"
                required
                value={adminInviteCode}
                onChange={(e) => setAdminInviteCode(e.target.value.toUpperCase())}
                placeholder="Ej: AYTO-2026"
                className="min-h-[48px] rounded-xl bg-tarjeta border border-superficie px-4 text-base font-heading font-bold tracking-wider text-tinta focus:outline-none focus:ring-2 focus:ring-tinta"
              />
              <p className="text-xs text-tinta/75">
                Para pruebas del jurado puedes usar el código oficial <code>AYTO-2026</code>.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`min-h-[56px] rounded-2xl font-heading font-bold text-lg inline-flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 ${
              tab === 'ADMIN'
                ? 'bg-tinta text-tarjeta'
                : 'bg-buganvilla text-tarjeta'
            }`}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="w-5 h-5" aria-hidden="true" />
            )}
            <span>
              {tab === 'ADMIN'
                ? adminMode === 'REGISTER'
                  ? 'Crear cuenta de Administrador Municipal'
                  : t('login.submitAdmin')
                : citizenMode === 'REGISTER'
                ? t('login.submitRegister', { municipality: activeMuniName })
                : t('login.submitLogin')}
            </span>
          </button>
        </form>
      </section>

      {/* Bloque discreto de Acceso Rápido Demo (1-clic) */}
      <section className="rounded-3xl bg-superficie/70 border border-superficie p-6 flex flex-col gap-4 a11y-card">
        <div className="flex items-center gap-2 text-sm font-bold text-tinta/80">
          <Sparkles className="w-4 h-4 text-terracota shrink-0" aria-hidden="true" />
          <span>{t('login.demoTitle')}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => void quickDemoLogin('vecino@lucainena.es', 'lucainena', 'CITIZEN')}
            className="min-h-[48px] px-4 py-2.5 rounded-2xl bg-tarjeta border border-superficie hover:bg-buganvilla hover:text-tarjeta text-sm font-semibold text-tinta inline-flex items-center justify-center gap-2 transition-colors"
          >
            <UserCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Vecino Lucainena</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void quickDemoLogin('admin@lucainena.es', 'lucainena', 'ADMIN')}
            className="min-h-[48px] px-4 py-2.5 rounded-2xl bg-tarjeta border border-superficie hover:bg-tinta hover:text-tarjeta text-sm font-semibold text-tinta inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Admin Lucainena</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void quickDemoLogin('admin@nijar.es', 'nijar', 'ADMIN')}
            className="min-h-[48px] px-4 py-2.5 rounded-2xl bg-tarjeta border border-superficie hover:bg-tinta hover:text-tarjeta text-sm font-semibold text-tinta inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Admin Níjar</span>
          </button>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
