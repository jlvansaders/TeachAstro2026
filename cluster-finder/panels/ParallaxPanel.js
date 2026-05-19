// Parallax histogram with drag-to-select range filtering.
//
// The panel is always locked into horizontal-select drag mode — zoom/pan
// buttons are removed from the mode bar so students can't accidentally switch
// into a mode where dragging no longer selects.
//
// Workflow:
//   1. Lasso cluster in PM2D panel  →  pmSelection set in store
//   2. Drag a range on this histogram  →  plxRange set in store
//   3. store.recomputeMask ANDs both filters  →  mask reflects intersection
//   4. 3D plot and CMD show only the doubly-filtered stars
//
// When no PM selection is active the histogram shows all stars.
// When a PM selection is active it shows only those stars (grey),
// with the parallax-filtered subset overlaid in blue.

import { useMemo } from 'react';
import { html } from '../html.js';
import { Plot } from './Plot.js';
import { useStore, actions } from '../store.js';
import { useTheme, plotColors } from '../../shared/theme.js';


export function ParallaxPanel() {
  const [theme] = useTheme();
  const c       = plotColors(theme);
  const data        = useStore((s) => s.data);
  const pmSelection = useStore((s) => s.pmSelection);
  const plxRange    = useStore((s) => s.plxRange);
  const mask        = useStore((s) => s.mask);

  const { pmSelectedPlx, selectedPlx } = useMemo(() => {
    if (!data) return { pmSelectedPlx: [], selectedPlx: [] };
    const { plx, pmra, pmdec } = data.columns;
    const n = data.n;
    const pmSelectedPlx = [];
    const selectedPlx   = [];

    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(plx[i])) continue;

      // "pm-selected" = passes PM filter only (ignore plx range here).
      let pmOk = true;
      if (pmSelection) {
        const x = pmra[i], y = pmdec[i];
        if (pmSelection.kind === 'box') {
          if (x < pmSelection.x[0] || x > pmSelection.x[1] ||
              y < pmSelection.y[0] || y > pmSelection.y[1]) pmOk = false;
        } else if (pmSelection.kind === 'lasso') {
          pmOk = pointInPolygon(x, y, pmSelection.xs, pmSelection.ys);
        }
      }
      if (pmOk) pmSelectedPlx.push(plx[i]);

      // Full selection = PM ∩ parallax (from mask).
      if (mask && mask[i]) selectedPlx.push(plx[i]);
    }
    return { pmSelectedPlx, selectedPlx };
  }, [data, pmSelection, mask]);

  // X-range: zoom into the PM-selected parallax distribution so the cluster
  // peak fills the panel rather than being lost among field-star outliers.
  // Declared before early return to satisfy Rules of Hooks.
  const xRange = useMemo(() => {
    const src = pmSelectedPlx.length > 50
      ? pmSelectedPlx
      : (data ? Array.from(data.columns.plx).filter(Number.isFinite) : []);
    if (!src.length) return [-5, 20];
    const sorted = [...src].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.01)];
    const hi = sorted[Math.floor(sorted.length * 0.99)];
    return [Math.max(-5, lo - 1), hi + 1];
  }, [pmSelectedPlx, data]);

  if (!data) return html`<div className="panel plxh"><header>Parallax</header></div>`;

  const binSize = (xRange[1] - xRange[0]) / 80;

  // Grey trace: PM-selected stars (or all stars before any PM selection).
  const bgTrace = {
    type: 'histogram',
    x: pmSelectedPlx.length ? pmSelectedPlx : Array.from(data.columns.plx),
    name: pmSelectedPlx.length ? 'PM-selected' : 'all stars',
    xbins: { size: binSize },
    marker: { color: c.histAllColor },
    hoverinfo: 'x+y',
  };

  // Blue trace: stars that pass both PM and parallax filters.
  const selTrace = selectedPlx.length ? {
    type: 'histogram',
    x: selectedPlx,
    name: 'PM + parallax selected',
    xbins: { size: binSize },
    marker: { color: c.histSelColor },
    hoverinfo: 'x+y',
  } : null;

  const traces = [bgTrace, selTrace].filter(Boolean);

  // Blue shaded rectangle showing the active parallax range.
  const shapes = plxRange ? [{
    type: 'rect',
    xref: 'x', yref: 'paper',
    x0: plxRange[0], x1: plxRange[1], y0: 0, y1: 1,
    line: { width: 1, color: '#7dd3fc' },
    fillcolor: 'rgba(125,211,252,0.08)',
    layer: 'below',
  }] : [];

  // Annotations showing the range bounds when active.
  const annotations = plxRange ? [
    {
      x: plxRange[0], y: 1, xref: 'x', yref: 'paper',
      text: plxRange[0].toFixed(2), showarrow: false,
      font: { color: '#7dd3fc', size: 10 },
      xanchor: 'right', yanchor: 'top', xshift: -3,
    },
    {
      x: plxRange[1], y: 1, xref: 'x', yref: 'paper',
      text: plxRange[1].toFixed(2), showarrow: false,
      font: { color: '#7dd3fc', size: 10 },
      xanchor: 'left', yanchor: 'top', xshift: 3,
    },
  ] : [];

  const layout = {
    paper_bgcolor: c.paper_bgcolor,
    plot_bgcolor:  c.plot_bgcolor,
    font: { color: c.fontColor, size: 15 },
    margin: { l: 60, r: 15, t: 10, b: 50 },
    barmode: 'overlay',
    xaxis: {
      title: { text: 'Parallax (mas)', font: { size: 16 } },
      gridcolor: c.gridColor, zerolinecolor: c.zeroColor,
      tickfont: { size: 15 },
      range: xRange,
    },
    yaxis: {
      title: { text: 'Count', font: { size: 16 } },
      gridcolor: c.gridColor, zerolinecolor: c.zeroColor,
      tickfont: { size: 15 },
      type: 'log',
    },
    // Lock into horizontal-select mode permanently.
    dragmode: 'select',
    selectdirection: 'h',
    shapes,
    annotations,
    showlegend: false,
    // Reset zoom when dataset changes but not on every selection update.
    uirevision: data.meta.id,
  };

  // Remove zoom/pan tools so the panel is always in select mode.
  // Students should only need to drag to select and scroll to zoom.
  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: [
      'zoom2d', 'pan2d', 'zoomIn2d', 'zoomOut2d',
      'autoScale2d', 'lasso2d',
    ],
  };

  const onSelected = (ev) => {
    if (!ev || !ev.range || !ev.range.x) return;
    const [lo, hi] = ev.range.x;
    actions.setPlxRange([Math.min(lo, hi), Math.max(lo, hi)]);
  };

  // Clicking without dragging fires deselect — don't clear the range on an
  // accidental click; only clear explicitly via the button.
  const onDeselect = () => {};

  const rangeLabel = plxRange
    ? `${plxRange[0].toFixed(2)} – ${plxRange[1].toFixed(2)} mas`
    : null;

  return html`
    <div className="panel plxh">
      <header>
        Parallax distribution
        <span className="hint">drag to set range${rangeLabel ? ` · ${rangeLabel}` : ''}</span>
        <div className="controls">
          ${plxRange ? html`
            <button
              onClick=${() => actions.setPlxRange(null)}
              style=${{ background:'#1b2333', color:'#eaeaea', border:'1px solid #2a3246',
                        padding:'2px 8px', borderRadius:3, fontSize:'0.7rem', cursor:'pointer' }}>
              Clear range
            </button>
          ` : null}
        </div>
      </header>
      <div className="plot-host">
        <${Plot}
          data=${traces}
          layout=${layout}
          config=${config}
          onSelected=${onSelected}
          onDeselect=${onDeselect}
          style=${{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  `;
}

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
