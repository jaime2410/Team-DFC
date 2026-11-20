'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface Municipality {
  id: string;
  slug: string;
  name: string;
  province: string;
  center_lat: number;
  center_lng: number;
  streets: string[];
  whatsapp_phone_id: string | null;
}

const STORAGE_KEY = 'almeriacerca_municipality';

interface MunicipalityContextValue {
  municipalities: Municipality[];
  currentMunicipality: Municipality | null;
  setMunicipalityBySlug: (slugOrId: string) => void;
  isLoading: boolean;
}

const MunicipalityContext = createContext<MunicipalityContextValue | undefined>(undefined);

export function MunicipalityProvider({ children }: { children: React.ReactNode }) {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [currentMunicipality, setCurrentMunicipality] = useState<Municipality | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch('/api/municipalities', { cache: 'no-store' });
        if (!res.ok) throw new Error('Error fetching municipalities');
        const data = (await res.json()) as { municipalities: Municipality[] };
        if (!active) return;

        const list = data.municipalities ?? [];
        setMunicipalities(list);

        let savedKey: string | null = null;
        try {
          savedKey = window.localStorage.getItem(STORAGE_KEY);
        } catch {
          savedKey = null;
        }

        const matched =
          list.find((m) => m.slug === savedKey || m.id === savedKey) ?? list[0] ?? null;
        setCurrentMunicipality(matched);
      } catch (err) {
        console.error('MunicipalityProvider error:', err);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const setMunicipalityBySlug = useCallback(
    (slugOrId: string) => {
      const found = municipalities.find(
        (m) => m.slug === slugOrId || m.id === slugOrId
      );
      if (found) {
        setCurrentMunicipality(found);
        try {
          window.localStorage.setItem(STORAGE_KEY, found.slug);
        } catch {
          // Ignore storage restrictions
        }
      }
    },
    [municipalities]
  );

  return (
    <MunicipalityContext.Provider
      value={{
        municipalities,
        currentMunicipality,
        setMunicipalityBySlug,
        isLoading,
      }}
    >
      {children}
    </MunicipalityContext.Provider>
  );
}

export function useMunicipality(): MunicipalityContextValue {
  const ctx = useContext(MunicipalityContext);
  if (!ctx) {
    throw new Error('useMunicipality must be used within a MunicipalityProvider');
  }
  return ctx;
}
