// Minimal React wrapper around Plotly.  Plotly is loaded lazily via dynamic
// import() so it doesn't block React from mounting — the library is ~3 MB and
// was the main reason the app hung on the loading screen after a cache clear.
//
// While Plotly is loading the component renders an empty div (replaced almost
// immediately; students won't notice the flicker on first load).

import { useEffect, useRef, useState } from 'react';
import { html } from '../html.js';

// Shared promise so every Plot instance reuses the same in-flight fetch.
let plotlyPromise = null;
function loadPlotly() {
  if (!plotlyPromise) {
    plotlyPromise = import('plotly.js-dist-min').then((m) => m.default ?? m);
  }
  return plotlyPromise;
}

export function Plot({
  data, layout, config,
  onSelected, onDeselect, onRelayout,
  className, style,
}) {
  const ref = useRef(null);
  const handlersRef = useRef({});
  const [Plotly, setPlotly] = useState(null);

  // Keep the latest handlers in a ref so the event-binding effect doesn't
  // need to rebind on every render — Plotly's event system doesn't cope
  // well with rapid listener churn.
  handlersRef.current = { onSelected, onDeselect, onRelayout };

  // Lazy-load Plotly once; set state when ready.
  useEffect(() => {
    let cancelled = false;
    loadPlotly().then((P) => { if (!cancelled) setPlotly(P); });
    return () => { cancelled = true; };
  }, []);

  // (Re)plot whenever Plotly is available and data/layout/config change.
  // Plotly.react is smart about diffing so this is cheap for selection-only updates.
  useEffect(() => {
    if (!Plotly || !ref.current) return;
    Plotly.react(ref.current, data, layout || {}, config || { responsive: true });
  }, [Plotly, data, layout, config]);

  // One-time event binding (after Plotly is ready).
  useEffect(() => {
    if (!Plotly) return;
    const div = ref.current;
    if (!div) return;

    const handleSelected = (ev) => handlersRef.current.onSelected && handlersRef.current.onSelected(ev);
    const handleDeselect = (ev) => handlersRef.current.onDeselect && handlersRef.current.onDeselect(ev);
    const handleRelayout = (ev) => handlersRef.current.onRelayout && handlersRef.current.onRelayout(ev);

    div.on && div.on('plotly_selected', handleSelected);
    div.on && div.on('plotly_deselect', handleDeselect);
    div.on && div.on('plotly_relayout', handleRelayout);

    return () => {
      if (div.removeAllListeners) {
        div.removeAllListeners('plotly_selected');
        div.removeAllListeners('plotly_deselect');
        div.removeAllListeners('plotly_relayout');
      }
    };
  }, [Plotly]);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (Plotly && ref.current) Plotly.purge(ref.current);
  }, [Plotly]);

  // While Plotly is still downloading, render the container div but leave it
  // empty — the panel's own skeleton (header etc.) is already visible.
  return html`<div ref=${ref} className=${className} style=${style}></div>`;
}
