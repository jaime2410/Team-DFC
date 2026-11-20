'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import esDict from './es.json';
import enDict from './en.json';
import frDict from './fr.json';
import arDict from './ar.json';

export type SupportedLang = 'es' | 'en' | 'fr' | 'ar';

const STORAGE_KEY = 'almeriacerca_lang';

const DICTIONARIES: Record<SupportedLang, typeof esDict> = {
  es: esDict,
  en: enDict,
  fr: frDict,
  ar: arDict,
};

interface I18nContextValue {
  lang: SupportedLang;
  dir: 'ltr' | 'rtl';
  setLang: (next: SupportedLang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function resolveNestedKey(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<SupportedLang>('es');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as SupportedLang | null;
      if (saved && saved in DICTIONARIES) {
        setLangState(saved);
      }
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  useEffect(() => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang]);

  const setLang = useCallback((next: SupportedLang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const activeDict = DICTIONARIES[lang] as unknown as Record<string, unknown>;
      const fallbackDict = DICTIONARIES.es as unknown as Record<string, unknown>;
      let template = resolveNestedKey(activeDict, key) ?? resolveNestedKey(fallbackDict, key) ?? key;

      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return template;
    },
    [lang]
  );

  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <I18nContext.Provider value={{ lang, dir, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return ctx;
}
