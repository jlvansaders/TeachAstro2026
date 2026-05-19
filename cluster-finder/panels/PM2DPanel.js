// Proper-motion scatter (2D).  Primary selection gesture: drag a box or
// lasso around the co-moving clump.  Selections flow into the store.
//
// Performance note: only stars brighter than `gLimit` (Gmag) are plotted,
// keeping the WebGL point count low enough for smooth pan/zoom.  The lasso
// and box selection still capture ALL stars in that region regardless of
// brightness, because the store applies the selection geometry to the full
// dataset independently of what's displayed here.

import { useMemo, useState } from 'react';
import { html } from '../html.js';
import { Plot } from './Plot.js';
import { useStore, actions } from '../store.js';
import { useTheme, plotColors } from '../../shared/theme.js';

const G_LIMIT_DEFAULT  = 17;   // Gmag display cutoff — tunable via slider
const DISPLAY_MAX      = 300_000; // hard cap on scattergl points to avoid OOM

export function PM2DPanel() {
  const [theme] = useTheme();
  const c       = plotColors(theme);
  const data        = useStore((s) => s.data);
  const pmSelection = useStore((s) => s.pmSelection);
  const plxRange    = useStore((s) => s.plxRange);
  const mask        = useStore((s) => s.mask);
  const nSelected   = useStore((s) => s.nSelected);

  // Local UI state: magnitude display cutoff.  Stored here (not in the global
  // store) because it only affects this panel's rendering, not selection math.
  const [gLimit, setGLimit] = useState(G_LIMIT_DEFAULT);

  // Indices of stars that pass the Gmag filter — these are the ones we plot.
  // Keyed on data identity AND gLimit so it updates when the slider moves.
  const displayIndices = useMemo(() => {
    if (!data) return null;
    const { g } = data.columns;
    const out = [];
    for (let i = 0; i < data.n; i++) {
      if (Number.isFinite(g[i]) && g[i] <= gLimit) out.push(i);
    }
    // Subsample deterministically if still over the hard cap.
    if (out.length <= DISPLAY_MAX) return out;
    const step = out.length / DISPLAY_MAX;
    return Array.from({ length: DISPLAY_MAX }, (_, j) => out[Math.round(j * step)]);
  }, [data, gLimit]);

  // Extract pmRA / pmDec for only the displayed subset.
  const { pmraDisplay, pmdecDisplay } = useMemo(() => {
    if (!displayIndices || !data) return { pmraDisplay: [], pmdecDisplay: [] };
    const { pmra, pmdec } = data.columns;
    const pmraDisplay  = new Float32Array(displayIndices.length);
    const pmdecDisplay = new Float32Array(displayIndices.length);
    for (let j = 0; j < displayIndices.length; j++) {
      pmraDisplay[j]  = pmra[displayIndices[j]];
      pmdecDisplay[j] = pmdec[displayIndices[j]];
    }
    return { pmraDisplay, pmdecDisplay };
  }, [displayIndices, data]);

  // selectedpoints must index into the DISPLAYED subset, not the full dataset.
  // The mask itself covers all stars; here we remap to display-subset indices.
  const selectedpoints = useMemo(() => {
    const anyFilter = !!pmSelection || !!plxRange;
    if (!mask || !anyFilter || !displayIndices) return null;
    const out = [];
    for (let j = 0; j < displayIndices.length; j++) {
      if (mask[displayIndices[j]]) out.push(j);
    }
    return out;
  }, [mask, displayIndices, pmSelection, plxRange]);

  // Axis ranges computed from all stars (not just the display subset) so the
  // default zoom frames the full proper-motion distribution properly.
  const axisRanges = useMemo(() => {
    if (!data) return null;
    return { xr: robustRange(data.columns.pmra), yr: robustRange(data.columns.pmdec) };
  }, [data]);

  if (!data) return html`<div className="panel pm2d"><header>Proper motion</header></div>`;

  const nDisplay = displayIndices ? displayIndices.length : 0;

  const trace = {
    type: 'scattergl',
    mode: 'markers',
    x: pmraDisplay,
    y: pmdecDisplay,
    marker: { size: 3, color: c.unselectedColor },
    selected:   { marker: { size: 4, color: c.selectedColor, opacity: 1 } },
    unselected: { marker: { size: 3, color: c.unselectedColor, opacity: 0.35 } },
    selectedpoints,
    hoverinfo: 'x+y',
  };

  const layout = {
    paper_bgcolor: c.paper_bgcolor,
    plot_bgcolor:  c.plot_bgcolor,
    font: { color: c.fontColor, size: 15 },
    margin: { l: 60, r: 15, t: 10, b: 50 },
    xaxis: {
      title: { text: 'pmRA (mas/yr)', font: { size: 16 } },
      gridcolor: c.gridColor, zerolinecolor: c.zeroColor,
      tickfont: { size: 15 },
      range: axisRanges.xr,
    },
    yaxis: {
      title: { text: 'pmDec (mas/yr)', font: { size: 16 } },
      gridcolor: c.gridColor, zerolinecolor: c.zeroColor,
      tickfont: { size: 15 },
      range: axisRanges.yr,
    },
    dragmode: 'select',
    showlegend: false,
    // Preserve the user's zoom/pan across selection updates; reset when the
    // active dataset changes or gLimit changes (new point set = new view).
    uirevision: `${data.meta.id}:${gLimit}`,
  };

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToAdd: ['lasso2d', 'select2d'],
  };

  // onSelected captures the GEOMETRY of the selection (box bounds or lasso
  // polygon vertices) and stores it.  The store's recomputeMask then applies
  // that geometry to the full dataset — so stars not plotted here are still
  // included in the selection count and downstream panels.
  const onSelected = (ev) => {
    if (!ev) return;
    if (ev.range && ev.range.x && ev.range.y) {
      actions.setPmSelection({
        kind: 'box',
        x: [ev.range.x[0], ev.range.x[1]],
        y: [ev.range.y[0], ev.range.y[1]],
      });
    } else if (ev.lassoPoints && ev.lassoPoints.x) {
      actions.setPmSelection({
        kind: 'lasso',
        xs: Array.from(ev.lassoPoints.x),
        ys: Array.from(ev.lassoPoints.y),
      });
    }
  };
  const onDeselect = () => actions.setPmSelection(null);

  return html`
    <div className="panel pm2d">
      <header>
        Proper motion (pmRA × pmDec)
        <span className="hint">drag a box or lasso around the clump</span>
        <div className="controls">
          <label
            title="Only plots stars brighter than this Gmag. Making the limit lower can improve performance. Your selections will include all stars in the lasso, regardless of whether they are plotted here."
            style=${{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'help' }}>
            <span>G ≤</span>
            <input
              type="range" min="12" max="21" step="0.5"
              value=${gLimit}
              onInput=${(e) => setGLimit(+e.target.value)}
              style=${{ width: '80px', accentColor: '#7dd3fc' }}
            />
            <span style=${{ minWidth: '2.5rem' }}>${gLimit.toFixed(1)}</span>
            <span style=${{ opacity: 0.5, fontSize: '0.7rem' }}>
              (${nDisplay.toLocaleString()} pts shown / ${data.n.toLocaleString()} total)
            </span>
          </label>
          ${pmSelection ? html`
            <button
              onClick=${() => actions.setPmSelection(null)}
              style=${{ background:'#1b2333', color:'#eaeaea', border:'1px solid #2a3246',
                        padding:'2px 8px', borderRadius:3, fontSize:'0.7rem', cursor:'pointer' }}>
              Clear selection
            </button>
          ` : null}
        </div>
      </header>
      <div className="plot-host">
        <${Plot}
          data=${[trace]}
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

// Robust x-range: 1st to 99th percentile with padding, so outliers don't
// compress the cluster into a single pixel.
function robustRange(arr) {
  const n = arr.length;
  if (!n) return [-50, 50];
  const sorted = Array.from(arr).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return [-50, 50];
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = sorted[Math.floor(sorted.length * 0.99)];
  const pad = (hi - lo) * 0.1 || 1;
  return [lo - pad, hi + pad];
}
