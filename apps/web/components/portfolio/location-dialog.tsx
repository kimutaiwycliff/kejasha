'use client';
import type { Schemas } from '@kejasha/api-client';
import { Button } from '@kejasha/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kejasha/ui/components/dialog';
import { LocateFixed } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MapView, type MapMarker } from '@/components/map/map-view';
import { api, unwrap } from '@/lib/api';
import { toastError, useWrite } from '@/lib/hooks';
import { startView, type LngLat } from '@/lib/map';

/** Six decimals ≈ 10 cm: plenty for a building, and what the API stores comfortably. */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Set where a property is: tap the map, or use this device's location (handy when standing at
 * the gate). No address lookup service in v1 (ADR-022).
 */
export function LocationDialog({
  open,
  onOpenChange,
  property,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  property: Schemas['PropertyDetail'];
}) {
  const current: LngLat | null =
    property.latitude !== null && property.longitude !== null
      ? [property.longitude, property.latitude]
      : null;
  const [at, setAt] = useState<LngLat | null>(current);
  const [locating, setLocating] = useState(false);
  const start = current ? { center: current, zoom: 16 } : startView(property.county);
  const save = useWrite(
    async (body: { latitude: number | null; longitude: number | null }, headers) =>
      unwrap(
        await api.PATCH('/v1/properties/{id}', {
          params: { path: { id: property.id } },
          body,
          headers,
        }),
      ),
    { invalidate: [['property'], ['properties']], success: 'Location saved' },
  );
  const markers: MapMarker[] = useMemo(
    () =>
      at
        ? [
            {
              id: 'here',
              at,
              color: 'var(--murram)',
              title: `${property.name} goes here`,
              heading: property.name,
              detail: 'Pin goes here',
            },
          ]
        : [],
    [at, property.name],
  );
  const locate = () => {
    if (!navigator.geolocation) return toast.error('This browser cannot share its location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setAt([round(p.coords.longitude), round(p.coords.latitude)]);
      },
      () => {
        setLocating(false);
        toast.error('Location was not shared. Tap the map instead.');
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const submit = async (v: LngLat | null) => {
    try {
      await save.run({ latitude: v ? v[1] : null, longitude: v ? v[0] : null });
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Where is {property.name}?</DialogTitle>
          <DialogDescription>
            Tap the map to drop the pin on the building, or use your location.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <MapView
            label={`Choose the location of ${property.name}`}
            markers={markers}
            center={start.center}
            zoom={start.zoom}
            onPick={(p) => setAt([round(p[0]), round(p[1])])}
            className="relative h-[22rem] overflow-hidden rounded-lg"
          />
        )}
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {at ? `Pin at ${at[1].toFixed(5)}, ${at[0].toFixed(5)}` : 'No pin yet.'}
        </p>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={locate} disabled={locating}>
              <LocateFixed /> {locating ? 'Finding you…' : 'Use my location'}
            </Button>
            {current && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void submit(null)}
                disabled={save.pending}
              >
                Remove pin
              </Button>
            )}
          </div>
          <Button
            type="button"
            onClick={() => at && void submit(at)}
            disabled={!at || save.pending}
          >
            Save location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
