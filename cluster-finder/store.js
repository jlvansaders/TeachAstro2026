// Tiny observable store.
//
// We don't pull in zustand because we're building without a bundler; this
// replaces it with ~40 lines that do the job.  Components subscribe with
// `useStore(selector)`.
//
// We use useState + useEffect rather than useSyncExternalStore so we avoid
// concurrent-mode snapshot-consistency checks that can misbehave when the
// selector returns a new object reference on every call.

import { useState, useEffect, useRef } from 'react';

const listeners = new Set();

let state = {
  // Data layer
  manifest: null,            // { datasets: [...] }
  clusterChosen: false,      // true once user picks a cluster (or URL hash restores one)
  datasetId: null,           // currently-active dataset id
  datasetMeta: null,         // entry from the manifest
  data: null,                // { columns: {ra, dec, ...}, n }
  loading: false,
  error: null,

  // Selection
  pmSelection: null,         // { kind: 'box', x:[x0,x1], y:[y0,y1] }
                             //   or { kind: 'lasso', xs:[...], ys:[...] }
                             //   or null (all stars selected)
  plxRange: null,            // [min, max] in mas, or null
  cmdAbsolute: false,        // CMD y-axis: absolute (true) or apparent (false)

  // Derived (cached)
  mask: null,                // Uint8Array of length n; 1 means "selected"
  nSelected: 0,

  // UI feedback
  linkFeedback: '',          // shown briefly next to "Copy link"
};

function recomputeMask(s) {
  if (!s.data) return { mask: null, nSelected: 0 };
  const { pmra, pmdec, plx } = s.data.columns;
  const n = s.data.n;
  const mask = new Uint8Array(n);

  const pm = s.pmSelection;
  const plr = s.plxRange;

  let count = 0;
  for (let i = 0; i < n; i++) {
    // pm selection
    if (pm) {
      const x = pmra[i], y = pmdec[i];
      if (pm.kind === 'box') {
        if (x < pm.x[0] || x > pm.x[1] || y < pm.y[0] || y > pm.y[1]) continue;
      } else if (pm.kind === 'lasso') {
        if (!pointInPolygon(x, y, pm.xs, pm.ys)) continue;
      }
    }
    // parallax range
    if (plr) {
      const p = plx[i];
      if (p < plr[0] || p > plr[1]) continue;
    }
    mask[i] = 1;
    count++;
  }
  return { mask, nSelected: count };
}

// Classic ray-cast point-in-polygon.  xs/ys are arrays of the polygon's
// vertices in order; the last vertex is assumed to close back to the first.
function pointInPolygon(x, y, xs, ys) {
  const n = xs.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = xs[i], yi = ys[i];
    const xj = xs[j], yj = ys[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-300) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  let merged = { ...state, ...next };

  // If anything that influences the mask changed, recompute it eagerly.
  const maskDirty =
    merged.data !== state.data ||
    merged.pmSelection !== state.pmSelection ||
    merged.plxRange !== state.plxRange;
  if (maskDirty) {
    const { mask, nSelected } = recomputeMask(merged);
    merged = { ...merged, mask, nSelected };
  }

  state = merged;
  listeners.forEach((l) => l());
}

export function getState() { return state; }

// Hook used in components.  `selector` picks the slice we care about.
// Using useState + useEffect rather than useSyncExternalStore avoids
// concurrent-mode snapshot instability when selectors return new objects.
export function useStore(selector = (s) => s) {
  // Keep a ref to the latest selector so the subscription callback always
  // reads the most recent version without needing to re-subscribe.
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const [snapshot, setSnapshot] = useState(() => selector(state));

  useEffect(() => {
    // Sync any state change that happened between the initial render
    // (when useState ran) and now (when effects fire after paint).
    setSnapshot(selectorRef.current(state));

    function handleChange() {
      setSnapshot(selectorRef.current(state));
    }
    listeners.add(handleChange);
    return () => { listeners.delete(handleChange); };
  }, []); // Subscribe once; selectorRef stays current via the assignment above.

  return snapshot;
}

// Convenience actions.
export const actions = {
  chooseCluster(datasetId, datasetMeta) {
    setState({
      clusterChosen: true,
      datasetId,
      datasetMeta,
      data: null,
      loading: true,
      error: null,
      pmSelection: null,
      plxRange: null,
    });
  },
  setDataset(datasetId, datasetMeta) {
    setState({
      datasetId,
      datasetMeta,
      data: null,
      loading: true,
      error: null,
      pmSelection: null,
      plxRange: null,
    });
  },
  setData(data) { setState({ data, loading: false, error: null }); },
  setError(err) { setState({ error: String(err), loading: false }); },
  setPmSelection(sel) { setState({ pmSelection: sel }); },
  setPlxRange(range) { setState({ plxRange: range }); },
  setCmdAbsolute(val) { setState({ cmdAbsolute: !!val }); },
  resetSelection() { setState({ pmSelection: null, plxRange: null }); },
  flashLinkFeedback(msg) {
    setState({ linkFeedback: msg });
    setTimeout(() => setState((s) => (s.linkFeedback === msg ? { linkFeedback: '' } : {})), 1500);
  },
};
