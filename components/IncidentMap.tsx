'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface IncidentMapProps {
  center: [number, number];
  position: [number, number];
  onChange: (lat: number, lng: number) => void;
}

export default function IncidentMap({ center, position, onChange }: IncidentMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(position, 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const icon = L.divIcon({
      className: '',
      html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#E45735;border:3px solid #FFFDF8;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });

    const marker = L.marker(position, { icon, draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      onChangeRef.current(p.lat, p.lng);
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const current = marker.getLatLng();
    if (current.lat !== position[0] || current.lng !== position[1]) {
      marker.setLatLng(position);
      map.setView(position, map.getZoom());
    }
  }, [position]);

  useEffect(() => {
    mapRef.current?.setView(center, 17);
  }, [center]);

  return (
    <div
      ref={containerRef}
      className="w-full h-72 sm:h-96 rounded-3xl overflow-hidden border border-superficie z-0"
      role="application"
      aria-label="Mapa"
    />
  );
}
