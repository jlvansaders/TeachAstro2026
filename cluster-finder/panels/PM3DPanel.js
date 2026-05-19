// 3D scatter of pmRA × pmDec × Parallax.
//
// View-only: selection is driven from other panels.
// Axis ranges are computed so that 100 % of selected stars and 95 % of all
// background stars are enclosed, cutting distant outliers that otherwise
// squash the cluster into an unreadable dot.
//
// uirevision strategy:
//   - Changes when the dataset changes   → camera resets
//   - Changes when selection goes from   → camera resets to frame the cluster
//     none to active (or back)
//   - Stable while refining the selection → camera/rotation preserved

import { useMemo } from 'react';
import { html } from '../html.js';
import { Plot } from './Plot.js';
import { useStore } from '../store.js';
import { useTheme, plotColors } from '../../shared/theme.js';


export function PM3DPanel() {
  const [theme] = useTheme();
  const c       = plotColors(theme);
  const data        = useStore((s) => s.data);
  const pmSelection = useStore((s) => s.pmSelection);
  const plxRange    = useStore((s) => s.plxRange);
  const mask        = useStore((s) => s.mask);

  // ── Axis bounds ──────────────────────────────────────────────────────────

  // 95th-percentile range of ALL stars.  Computed once per dataset load
  // (sorting ~100 k values ×3 axes takes ~30 ms; memoised so it only runs once).
  const bgBounds = useMemo(() => {
    if (!data) return null;
    const { pmra, pmdec, plx } = data.columns;
    return {
      x: pctRange(pmra,  0.025, 0.975),
      y: pctRange(pmdec, 0.025, 0.975),
      z: pctRange(plx,   0.025, 0.975),
    };
  }, [data]);

  // Exact min/max of selected stars (fast single pass through the mask).
  const selBounds = useMemo(() => {
    const anyFilter = !!pmSelection || !!plxRange;
    if (!mask || !anyFilter || !data) return null;
    const { pmra, pmdec, plx } = data.columns;
    let xLo =  Infinity, xHi = -Infinity;
    let yLo =  Infinity, yHi = -Infinity;
    let zLo =  Infinity, zHi = -Infinity;
    let found = false;
    for (let i = 0; i < data.n; i++) {
      if (!mask[i]) continue;
      const x = pmra[i], y = pmdec[i], z = plx[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < xLo) xLo = x;  if (x > xHi) xHi = x;
      if (y < yLo) yLo = y;  if (y > yHi) yHi = y;
      if (z < zLo) zLo = z;  if (z > zHi) zHi = z;
      found = true;
    }
    return found
      ? { x: [xLo, xHi], y: [yLo, yHi], z: [zLo, zHi] }
      : null;
  }, [mask, data, pmSelection, plxRange]);

  // Final axis ranges: union of (selected 100 %) and (background 95 %).
  // Add 20 % padding around the selected bounds so the cluster doesn't sit
  // flush against the axis walls.
  const axisRanges = useMemo(() => {
    if (!bgBounds) return null;
    if (!selBounds) return bgBounds;    // no selection yet — show 95 % of all

    const padX = Math.max((selBounds.x[1] - selBounds.x[0]) * 0.20, 0.5);
    const padY = Math.max((selBounds.y[1] - selBounds.y[0]) * 0.20, 0.5);
    const padZ = Math.max((selBounds.z[1] - selBounds.z[0]) * 0.20, 0.1);

    return {
      x: [Math.min(selBounds.x[0] - padX, bgBounds.x[0]),
          Math.max(selBounds.x[1] + padX, bgBounds.x[1])],
      y: [Math.min(selBounds.y[0] - padY, bgBounds.y[0]),
          Math.max(selBounds.y[1] + padY, bgBounds.y[1])],
      z: [Math.min(selBounds.z[0] - padZ, bgBounds.z[0]),
          Math.max(selBounds.z[1] + padZ, bgBounds.z[1])],
    };
  }, [bgBounds, selBounds]);

  // ── Traces ───────────────────────────────────────────────────────────────

  // Selected-stars overlay (only rebuilt when mask changes).
  const { selPmra, selPmdec, selPlx } = useMemo(() => {
    const anyFilter = !!pmSelection || !!plxRange;
    if (!mask || !anyFilter || !data) {
      return { selPmra: [], selPmdec: [], selPlx: [] };
    }
    const { pmra, pmdec, plx } = data.columns;
    const sp = [], sd = [], sz = [];
    for (let i = 0; i < data.n; i++) {
      if (mask[i]) { sp.push(pmra[i]); sd.push(pmdec[i]); sz.push(plx[i]); }
    }
    return { selPmra: sp, selPmdec: sd, selPlx: sz };
  }, [mask, data, pmSelection, plxRange]);

  if (!data) return html`<div className="panel pm3d"><header>3D scatter</header></div>`;

  const { pmra, pmdec, plx } = data.columns;

  // Trace 1: all stars — dim background.  Cap at 200k points to stay within
  // WebGL buffer limits; subsample deterministically when the dataset is larger.
  const BG_MAX = 200_000;
  let bgX = pmra, bgY = pmdec, bgZ = plx;
  if (data.n > BG_MAX) {
    const step = data.n / BG_MAX;
    const sx = new Float32Array(BG_MAX);
    const sy = new Float32Array(BG_MAX);
    const sz = new Float32Array(BG_MAX);
    for (let j = 0; j < BG_MAX; j++) {
      const i = Math.round(j * step);
      sx[j] = pmra[i]; sy[j] = pmdec[i]; sz[j] = plx[i];
    }
    bgX = sx; bgY = sy; bgZ = sz;
  }

  const bgTrace = {
    type: 'scatter3d', mode: 'markers',
    x: bgX, y: bgY, z: bgZ,
    marker: { size: 1.5, color: c.bgColor3d, line: { width: 0 } },
    hoverinfo: 'skip', showlegend: false,
  };

  // Trace 2: selected stars — bright overlay, updates with mask.
  const selTrace = {
    type: 'scatter3d', mode: 'markers',
    x: selPmra, y: selPmdec, z: selPlx,
    marker: { size: 3, color: c.selectedColor, line: { width: 0 } },
    hoverinfo: 'skip', showlegend: false,
  };

  // ── Layout ───────────────────────────────────────────────────────────────

  // uirevision flips only when selection goes active ↔ inactive, so the
  // camera resets to frame the cluster on first selection but is preserved
  // while the student refines it.
  const hasSelection = !!(pmSelection || plxRange);
  const uirevision   = `${data.meta.id}:${hasSelection}`;

  const axisStyle = {
    gridcolor: c.gridColor, zerolinecolor: c.zeroColor,
    backgroundcolor: c.axis3dBg, showbackground: true, color: c.axis3dColor,
  };

  const layout = {
    paper_bgcolor: c.paper_bgcolor,
    font: { color: c.fontColor, size: 15 },
    margin: { l: 0, r: 0, t: 10, b: 0 },
    scene: {
      xaxis: { title: 'pmRA (mas/yr)',      ...axisStyle,
               range: axisRanges?.x },
      yaxis: { title: 'pmDec (mas/yr)',     ...axisStyle,
               range: axisRanges?.y },
      zaxis: { title: 'Parallax (mas)',     ...axisStyle,
               range: axisRanges?.z },
      camera: { eye: { x: 1.6, y: 1.6, z: 1.1 } },
    },
    showlegend: false,
    uirevision,
  };

  const config = { responsive: true, displaylogo: false };

  return html`
    <div className="panel pm3d">
      <header>
        3D view (pmRA × pmDec × Parallax)
        <span className="hint">rotate / zoom — selection driven from other panels</span>
      </header>
      <div className="plot-host">
        <${Plot}
          data=${[bgTrace, selTrace]}
          layout=${layout}
          config=${config}
          style=${{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  `;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Returns [p_lo, p_hi] from a TypedArray, filtering out non-finite values.
function pctRange(arr, lo, hi) {
  const finite = Array.from(arr).filter(Number.isFinite);
  if (!finite.length) return [-50, 50];
  finite.sort((a, b) => a - b);
  const n = finite.length;
  return [
    finite[Math.max(0, Math.floor(n * lo))],
    finite[Math.min(n - 1, Math.floor(n * hi))],
  ];
}
