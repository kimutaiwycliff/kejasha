'use client';
import { useEffect, useRef, useState } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts from the previous value to `target` (ease-out, ~600 ms) so figures settle into place.
 * Integers only (cents, counts, basis points); jumps straight there under reduced motion.
 */
export function useCountUp(target: number, durationMs = 600): number {
  // Starts from zero so figures count up when a page opens.
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = target;
    if (start === target || reduced()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - (1 - p) ** 3;
      setValue(Math.round(start + (target - start) * eased));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}
