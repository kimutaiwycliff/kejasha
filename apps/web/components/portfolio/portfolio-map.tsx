'use client';
import { Card } from '@kejasha/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { MapView, type MapMarker } from '@/components/map/map-view';
import { api, unwrap } from '@/lib/api';
import { fetchAll } from '@/lib/hooks';
import { KENYA, occupancyColor } from '@/lib/map';
import { useRentRoll } from './occupancy';

/** Every property on a map, pins coloured by how full it is; unplaced ones listed beside. */
export function PortfolioMap() {
  const router = useRouter();
  const props = useQuery({
    queryKey: ['properties', 'all-for-map'],
    queryFn: () =>
      fetchAll(async (cursor) =>
        unwrap(await api.GET('/v1/properties', { params: { query: { cursor, limit: 100 } } })),
      ),
  });
  const roll = useRentRoll();
  const byName = useMemo(() => {
    const m = new Map<string, { occupied: number; units: number }>();
    for (const r of roll.data ?? []) {
      const e = m.get(r.propertyName) ?? { occupied: 0, units: 0 };
      e.units += 1;
      if (r.status === 'occupied') e.occupied += 1;
      m.set(r.propertyName, e);
    }
    return m;
  }, [roll.data]);
  const all = props.data ?? [];
  const unplaced = all.filter((p) => p.latitude === null || p.longitude === null);
  // Memoised on the data so pins are not rebuilt on every render.
  const markers: MapMarker[] = useMemo(
    () =>
      (props.data ?? [])
        .filter((p) => p.latitude !== null && p.longitude !== null)
        .map((p) => {
          const o = byName.get(p.name);
          return {
            id: p.id,
            at: [p.longitude!, p.latitude!],
            color: o ? occupancyColor(o.occupied, o.units) : 'var(--primary)',
            label: o && o.units > 0 ? `${o.occupied}/${o.units}` : String(p.unitCounts.total),
            title: o
              ? `${p.name}: ${o.occupied} of ${o.units} long-term units let${p.unitCounts.shortStay ? `, ${p.unitCounts.shortStay} short-stay` : ''}`
              : `${p.name}: ${p.unitCounts.total} units`,
            heading: p.name,
            detail: [
              o && o.units > 0
                ? `${o.occupied} of ${o.units} units let`
                : `${p.unitCounts.total} units`,
              p.unitCounts.shortStay ? `${p.unitCounts.shortStay} short-stay` : null,
            ]
              .filter(Boolean)
              .join(' · '),
          };
        }),
    [props.data, byName],
  );
  const open = useCallback((id: string) => router.push(`/properties/${id}`), [router]);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <Card className="gap-0 overflow-hidden py-0">
        <MapView
          label="Map of your properties"
          markers={markers}
          center={KENYA.center}
          zoom={KENYA.zoom}
          onMarkerClick={open}
          className="relative h-full min-h-[32rem]"
        />
      </Card>
      <div className="space-y-4">
        <Card className="gap-2 px-4 text-sm">
          <p className="font-semibold">Pins show units let</p>
          {[
            ['var(--success)', '90% or more'],
            ['var(--warning)', '60–89%'],
            ['var(--murram)', 'Under 60%'],
            ['var(--info)', 'Short stays only'],
          ].map(([c, t]) => (
            <span key={t} className="flex items-center gap-2 text-muted-foreground">
              <span className="size-3 rounded-full" style={{ background: c }} /> {t}
            </span>
          ))}
        </Card>
        {unplaced.length > 0 && (
          <Card className="gap-2 px-4 text-sm">
            <p className="font-semibold">Not on the map yet</p>
            <p className="text-muted-foreground">Open a property and set its location.</p>
            <ul className="space-y-1">
              {unplaced.slice(0, 12).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/properties/${p.id}#location`}
                    className="flex items-center gap-2 underline-offset-4 hover:underline"
                  >
                    <MapPin className="size-3.5 text-murram" aria-hidden /> {p.name}
                  </Link>
                </li>
              ))}
              {unplaced.length > 12 && (
                <li className="text-muted-foreground">and {unplaced.length - 12} more</li>
              )}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
