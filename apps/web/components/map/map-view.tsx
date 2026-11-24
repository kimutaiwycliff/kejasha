'use client';
import 'maplibre-gl/dist/maplibre-gl.css';
import type * as MaplibreModule from 'maplibre-gl';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { MAP_STYLE_URL, type LngLat } from '@/lib/map';

export type MapMarker = {
  id: string;
  at: LngLat;
  /** CSS colour (a theme variable, e.g. var(--success)). */
  color: string;
  /** Short text inside the pin (e.g. "8/12"). */
  label?: string;
  /** Read by screen readers and shown on hover. */
  title: string;
};

type Maplibre = typeof MaplibreModule;

/**
 * A MapLibre map (ADR-022), loaded only where a map is shown. Pins are buttons, so they work
 * with a keyboard and screen readers; `onPick` makes a tap on the map choose a point.
 */
export function MapView({
  markers,
  center,
  zoom,
  onMarkerClick,
  onPick,
  label,
  className,
}: {
  markers: MapMarker[];
  center: LngLat;
  zoom: number;
  onMarkerClick?: (id: string) => void;
  onPick?: (at: LngLat) => void;
  label: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<{ ml: Maplibre; map: MlMap } | null>(null);
  const [failed, setFailed] = useState(false);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    let map: MlMap | undefined;
    let resize: ResizeObserver | undefined;
    let gone = false;
    void import('maplibre-gl')
      .then((ml) => {
        if (gone || !box.current) return;
        ml.setWorkerUrl(`/maplibre/worker-${ml.getVersion()}.mjs`);
        map = new ml.Map({
          container: box.current,
          style: MAP_STYLE_URL,
          center,
          zoom,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        map.on('click', (e) => pick.current?.([e.lngLat.lng, e.lngLat.lat]));
        map.on('load', () => {
          // Attribution stays one tap away (ⓘ) instead of covering small maps.
          box.current
            ?.querySelector('.maplibregl-ctrl-attrib')
            ?.classList.remove('maplibregl-compact-show');
          setReady({ ml, map: map! });
        });
        // Cards and dialogs settle their size after the map starts: follow the box.
        resize = new ResizeObserver(() => map?.resize());
        resize.observe(box.current);
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      resize?.disconnect();
      map?.remove();
    };
    // The map is created once (center/zoom are only the starting view); pins update below.
  }, []);

  // Pins: replaced whenever the list changes; the view fits them.
  useEffect(() => {
    if (!ready) return;
    const { ml, map } = ready;
    const placed: Marker[] = markers.map((m, i) => {
      // MapLibre positions the wrapper with a CSS transform; the pin inside it can animate freely.
      const wrap = document.createElement('div');
      const el = document.createElement('button');
      wrap.appendChild(el);
      el.type = 'button';
      el.title = m.title;
      el.setAttribute('aria-label', m.title);
      el.className =
        'animate-pop flex min-w-8 h-8 items-center justify-center rounded-full border-2 border-white px-2 text-xs font-bold text-white shadow-lg transition-transform hover:scale-110 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring';
      el.style.background = m.color;
      el.style.setProperty('--i', String(i));
      el.textContent = m.label ?? '';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onMarkerClick?.(m.id);
      });
      return new ml.Marker({ element: wrap }).setLngLat(m.at).addTo(map);
    });
    if (markers.length > 1) {
      const bounds = new ml.LngLatBounds();
      markers.forEach((m) => bounds.extend(m.at));
      map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 600 });
    } else if (markers.length === 1) {
      map.easeTo({ center: markers[0]!.at, zoom: Math.max(map.getZoom(), 14), duration: 600 });
    }
    return () => placed.forEach((p) => p.remove());
  }, [ready, markers, onMarkerClick]);

  return (
    <div className={className ?? 'relative h-96 overflow-hidden rounded-xl'}>
      <div ref={box} role="region" aria-label={label} className="size-full" />
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center bg-muted text-sm text-muted-foreground">
          The map could not load. Check your connection.
        </p>
      )}
    </div>
  );
}
