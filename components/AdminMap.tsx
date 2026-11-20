'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface AdminMapMarker {
  id: string;
  tracking_code: string;
  title: string;
  category: string;
  urgency: string;
  department: string;
  status: string;
  lat: number;
  lng: number;
  address_label: string | null;
  upvotes: number;
}

interface AdminMapProps {
  center: [number, number];
  incidents: AdminMapMarker[];
}

function pinColor(urgency: string, status: string): string {
  if (status === 'RESUELTO') return '#1B8A7A';
  switch (urgency) {
    case 'EMERGENCIA_112':
    case 'URGENTE':
    case 'CRITICA':
      return '#E45735';
    case 'ALTA':
      return '#F2B84B';
    case 'MEDIA':
      return '#2C6E91';
    default:
      return '#1B8A7A';
  }
}

export default function AdminMap({ center, incidents }: AdminMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

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
      const color = pinColor(inc.urgency, inc.status);
      const votes = Math.max(1, Number(inc.upvotes ?? 1));
      // Radio circular proporcional al número de vecinos que han reportado el aviso
      const diameter = Math.min(58, 26 + (votes - 1) * 5);
      const half = Math.round(diameter / 2);
      const textColor = inc.urgency === 'ALTA' && inc.status !== 'RESUELTO' ? '#1E242B' : '#FFFDF8';

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${diameter}px;height:${diameter}px;border-radius:9999px;background:${color};color:${textColor};border:3px solid #FFFDF8;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;box-shadow:0 3px 10px rgba(0,0,0,.35)">+${votes}</div>`,
        iconSize: [diameter, diameter],
        iconAnchor: [half, half],
      });

      const marker = L.marker([inc.lat, inc.lng], { icon });
      marker.bindPopup(
        `<div style="font-family:sans-serif;min-width:190px">
          <strong>${inc.tracking_code}</strong> · ${inc.status}<br/>
          <span>${inc.title}</span><br/>
          <small>${inc.department} · Prioridad: ${inc.urgency} · Vecinos: +${votes}</small>
        </div>`
      );
      marker.addTo(group);
    }
  }, [incidents]);

  return (
    <div
      ref={containerRef}
      className="w-full h-80 sm:h-96 rounded-3xl overflow-hidden border border-superficie z-0"
      role="application"
      aria-label="Mapa de incidencias municipales con radio proporcional a vecinos afectados"
    />
  );
}
