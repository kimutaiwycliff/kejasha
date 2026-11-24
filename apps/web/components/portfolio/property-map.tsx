'use client';
import { useMemo } from 'react';
import { MapView } from '@/components/map/map-view';
import type { LngLat } from '@/lib/map';

/** A small map with the property's pin (on its own page). */
export function PropertyMap({ name, at }: { name: string; at: LngLat }) {
  const markers = useMemo(
    () => [{ id: 'p', at, color: 'var(--primary)', title: name }],
    [at, name],
  );
  return (
    <MapView
      label={`Map showing ${name}`}
      markers={markers}
      center={at}
      zoom={15}
      className="relative h-48 overflow-hidden rounded-lg"
    />
  );
}
