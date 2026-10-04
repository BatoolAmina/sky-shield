import React, { useEffect, useRef } from 'react';
import { drawScene, pickTrack } from '../draw.js';
export default function Tactical({ frame, selectedId, onSelect, showTruth = false, size = 560 }) {
  const ref = useRef(null);
  useEffect(() => { const c = ref.current; if (c) drawScene(c.getContext('2d'), size, size, frame, { selectedId, showTruth }); }, [frame, selectedId, showTruth, size]);
  const click = (e) => { const r = ref.current.getBoundingClientRect(), k = size / r.width; onSelect?.(pickTrack(frame, size, size, (e.clientX - r.left) * k, (e.clientY - r.top) * k)); };
  return <canvas ref={ref} width={size} height={size} onClick={click} className="tactical" aria-label="Tactical display" />;
}
