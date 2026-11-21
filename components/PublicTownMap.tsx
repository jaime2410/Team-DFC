'use client';

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CheckCircle2, MapPin, ThumbsUp, Users } from 'lucide-react';

export interface PublicMapIncidentItem {
  id: string;
  trackingCode: string;
  title: string;
  category: string;
  status: string;
  lat: number;
  lng: number;
  addressLabel: string | null;
  upvotes: number;
}

interface PublicTownMapProps {
  center: [number, number];
  municipalitySlug: string;
  municipalityName: string;
  incidents: PublicMapIncidentItem[];
  onUpvoted?: (incidentId: string, nextVotes: number) => void;
}

function statusColor(status: string): string {
  if (status === 'RESUELTO' || status === 'RESUELTA') return '#1B8A7A';
  if (status === 'EN_CURSO' || status === 'ASIGNADO') return '#2C6E91';
  if (status === 'VISTO') return '#F2B84B';
  return '#E45735';
}

export default function PublicTownMap({
  center,
  municipalitySlug,
  municipalityName,
  incidents,
  onUpvoted,
}: PublicTownMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const [selected, setSelected] = useState<PublicMapIncidentItem | null>(
    incidents[0] ?? null
  );
  const [votedIds, setVotedIds] = useState<Record<string, boolean>>({});
  const [votingId, setVotingId] = useState<string | null>(null);

  useEffect(() => {
    setSelected(incidents[0] ?? null);
  }, [municipalitySlug, incidents]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(center, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setView(center, 15);
  }, [center]);

  useEffect(() => {
    const group = layerRef.current;
    if (!group) return;
    group.clearLayers();

    for (const inc of incidents) {
      if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lng)) continue;
      const color = statusColor(inc.status);
      const votes = Math.max(1, Number(inc.upvotes ?? 1));
      const diameter = Math.min(54, 28 + (votes - 1) * 4);
      const half = Math.round(diameter / 2);
      const textColor = inc.status === 'VISTO' ? '#1E242B' : '#FFFDF8';

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${diameter}px;height:${diameter}px;border-radius:9999px;background:${color};color:${textColor};border:3px solid #FFFDF8;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;box-shadow:0 3px 10px rgba(0,0,0,.3)">+${votes}</div>`,
        iconSize: [diameter, diameter],
        iconAnchor: [half, half],
      });

      const marker = L.marker([inc.lat, inc.lng], { icon });
      marker.on('click', () => {
        setSelected(inc);
      });
      marker.bindTooltip(
        `${inc.category} · ${inc.status} (+${votes} vecinos)`,
        { direction: 'top' }
      );
      marker.addTo(group);
    }
  }, [incidents]);

  async function handleUpvote(inc: PublicMapIncidentItem) {
    if (votingId || votedIds[inc.id]) return;
    setVotingId(inc.id);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(inc.id)}/upvote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ municipalityId: municipalitySlug }),
      });
      if (res.ok) {
        const nextVotes = inc.upvotes + 1;
        setVotedIds((prev) => ({ ...prev, [inc.id]: true }));
        setSelected({ ...inc, upvotes: nextVotes });
        onUpvoted?.(inc.id, nextVotes);
      }
    } finally {
      setVotingId(null);
    }
  }

  return (
    <div className="rounded-3xl bg-tarjeta border border-superficie p-5 sm:p-6 shadow-sm flex flex-col gap-5 a11y-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading font-bold text-xl text-tinta">
            🗺️ Mapa Público Anonimizado de {municipalityName}
          </h3>
          <p className="text-sm text-tinta/75 mt-0.5">
            Pulsa un marcador circular para ver la categoría, el estado y sumar tu apoyo si también te afecta (sin datos personales).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <span className="px-3 py-1 rounded-full bg-terracota text-tarjeta">
            Recibido
          </span>
          <span className="px-3 py-1 rounded-full bg-azulMed text-tarjeta">
            En curso / Asignado
          </span>
          <span className="px-3 py-1 rounded-full bg-verdeCabo text-tarjeta">
            Resuelto
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="w-full h-80 sm:h-96 rounded-3xl overflow-hidden border border-superficie z-0"
        role="application"
        aria-label={`Mapa público de incidencias en ${municipalityName}`}
      />

      {selected && (
        <div className="rounded-2xl bg-arena border border-superficie p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-tinta text-tarjeta text-xs font-bold">
                {selected.trackingCode}
              </span>
              <span className="px-3 py-1 rounded-full bg-azulMed/15 text-azulMed text-xs font-bold">
                {selected.category}
              </span>
              <span className="px-3 py-1 rounded-full bg-verdeCabo/15 text-verdeCabo text-xs font-bold">
                Estado: {selected.status}
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-tarjeta border border-superficie text-xs font-bold text-tinta">
                <Users className="w-3.5 h-3.5 text-terracota" aria-hidden="true" />
                <span>{selected.upvotes} vecinos afectados</span>
              </span>
            </div>
            <p className="font-heading font-bold text-lg text-tinta mt-1">
              {selected.title}
            </p>
            <p className="text-xs font-semibold text-tinta/70 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-terracota shrink-0" aria-hidden="true" />
              <span>{selected.addressLabel || municipalityName}</span>
            </p>
          </div>

          <div className="shrink-0">
            {votedIds[selected.id] ? (
              <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-verdeCabo/15 text-verdeCabo font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>¡Sumado tu apoyo (+1)!</span>
              </span>
            ) : selected.status !== 'RESUELTO' && selected.status !== 'RESUELTA' ? (
              <button
                type="button"
                disabled={votingId === selected.id}
                onClick={() => void handleUpvote(selected)}
                className="min-h-[48px] px-5 rounded-2xl bg-terracota text-tarjeta font-heading font-bold text-sm inline-flex items-center gap-2 hover:opacity-95 transition-opacity"
              >
                <ThumbsUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {votingId === selected.id ? 'Sumando...' : 'Me pasa lo mismo (+1)'}
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-verdeCabo text-tarjeta font-bold text-xs">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                <span>Incidencia resuelta</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
