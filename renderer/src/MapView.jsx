import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function MapView({ city, lat, lon }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;   // already initialised

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    }).setView([lat, lon], 12);

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19 }
    ).addTo(map);

    // Pulsing orange marker — divIcon with a CSS animation. Built once;
    // re-positioned via setLatLng on city change.
    const pulseHtml = `
      <div style="
        width: 22px; height: 22px; border-radius: 50%;
        background: rgba(255, 107, 0, 0.9);
        border: 2px solid #FFD700;
        box-shadow: 0 0 14px rgba(255,107,0,0.8);
        animation: jarvis-pulse 1.6s ease-in-out infinite;
      "></div>`;
    const icon = L.divIcon({
      html: pulseHtml,
      className: 'jarvis-map-pulse',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    L.marker([lat, lon], { icon }).addTo(map);
    mapRef.current = map;

    return () => {
      try { map.remove(); } catch {}
      mapRef.current = null;
    };
  }, [lat, lon]);

  // If city/coords change after init, fly there
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView([lat, lon], 12);
    }
  }, [city, lat, lon]);

  return (
    <>
      <style>{`
        @keyframes jarvis-pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%      { transform: scale(1.5); opacity: 0.6; }
        }
        .leaflet-container { background: #000 !important; }
      `}</style>
      <div
        ref={containerRef}
        style={{
          width: '100%', height: '100%',
          border: '1px solid rgba(255, 107, 0, 0.25)',
          boxSizing: 'border-box',
          background: '#000',
        }}
      />
      <div style={{
        position: 'absolute', top: 14, left: 18,
        fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
        color: '#FF8C00',
        textShadow: '0 0 8px rgba(255,107,0,0.6)',
        letterSpacing: 2,
        pointerEvents: 'none',
      }}>
        ◆ {String(city || '').toUpperCase()}
      </div>
    </>
  );
}
