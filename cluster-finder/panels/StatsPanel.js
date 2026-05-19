// Live stats for the currently-selected stars.

import { useMemo } from 'react';
import { html } from '../html.js';
import { useStore } from '../store.js';

export function StatsPanel() {
  const data        = useStore((s) => s.data);
  const mask        = useStore((s) => s.mask);
  const nSelected   = useStore((s) => s.nSelected);
  const pmSelection = useStore((s) => s.pmSelection);
  const plxRange    = useStore((s) => s.plxRange);

  const stats = useMemo(() => computeStats(data, mask, nSelected), [data, mask, nSelected]);

  const anyFilter = !!pmSelection || !!plxRange;

  return html`
    <aside className="sidebar">
      <section>
        <h2>Selection</h2>
        <dl>
          <dt>Stars selected</dt>
          <dd>${formatInt(stats.n)}</dd>
          <dt>out of</dt>
          <dd>${formatInt(data?.n ?? 0)}</dd>
        </dl>
        ${!anyFilter ? html`<p className="muted" style=${{marginTop:'0.5rem'}}>
          Drag a box or lasso on the proper-motion panel to begin selecting cluster members.
        </p>` : null}
      </section>

      <section>
        <h2>Mean values</h2>
        <dl>
          <dt>pmRA</dt><dd>${fmtN(stats.meanPmra, 3)} mas/yr</dd>
          <dt>pmDec</dt><dd>${fmtN(stats.meanPmdec, 3)} mas/yr</dd>
          <dt>Parallax</dt><dd>${fmtN(stats.meanPlx, 4)} mas</dd>
          <dt>Distance</dt><dd>${fmtN(stats.meanDistancePc, 1)} pc</dd>
        </dl>
      </section>

      <section>
        <h2>Median values</h2>
        <dl>
          <dt>pmRA</dt><dd>${fmtN(stats.medianPmra, 3)} mas/yr</dd>
          <dt>pmDec</dt><dd>${fmtN(stats.medianPmdec, 3)} mas/yr</dd>
          <dt>Parallax</dt><dd>${fmtN(stats.medianPlx, 4)} mas</dd>
          <dt>Distance</dt><dd>${fmtN(stats.medianDistancePc, 1)} pc</dd>
        </dl>
      </section>

      <section>
        <h2>Scatter (σ)</h2>
        <dl>
          <dt>pmRA</dt><dd>${fmtN(stats.sdPmra, 3)} mas/yr</dd>
          <dt>pmDec</dt><dd>${fmtN(stats.sdPmdec, 3)} mas/yr</dd>
          <dt>Parallax</dt><dd>${fmtN(stats.sdPlx, 4)} mas</dd>
        </dl>
      </section>

      ${plxRange ? html`
        <section>
          <h2>Parallax range</h2>
          <dl>
            <dt>from</dt><dd>${fmtN(plxRange[0], 3)} mas</dd>
            <dt>to</dt><dd>${fmtN(plxRange[1], 3)} mas</dd>
          </dl>
        </section>
      ` : null}
    </aside>
  `;
}

function computeStats(data, mask, nSelected) {
  const empty = {
    n: 0, meanPmra: NaN, meanPmdec: NaN, meanPlx: NaN, meanDistancePc: NaN,
    medianPmra: NaN, medianPmdec: NaN, medianPlx: NaN, medianDistancePc: NaN,
    sdPmra: NaN, sdPmdec: NaN, sdPlx: NaN,
  };
  if (!data) return empty;
  const { pmra, pmdec, plx } = data.columns;

  // Iterate over whichever we have: the mask if present, else all stars.
  const usingMask = !!mask && (mask.length === data.n);
  const n = usingMask ? nSelected : data.n;

  if (n === 0) return empty;

  // Collect values for computations (for median we need a sorted list).
  const pmraVals = new Float32Array(n);
  const pmdecVals = new Float32Array(n);
  const plxVals = new Float32Array(n);
  let pmraSum = 0, pmdecSum = 0;
  let plxSum = 0, plxN = 0;
  let k = 0;

  for (let i = 0; i < data.n; i++) {
    if (usingMask && !mask[i]) continue;
    const a = pmra[i], b = pmdec[i], p = plx[i];
    pmraVals[k] = a;
    pmdecVals[k] = b;
    plxVals[k] = p;
    if (Number.isFinite(a)) pmraSum += a;
    if (Number.isFinite(b)) pmdecSum += b;
    if (Number.isFinite(p) && p > 0) { plxSum += p; plxN++; }
    k++;
  }

  const meanPmra = pmraSum / n;
  const meanPmdec = pmdecSum / n;
  const meanPlx = plxN ? plxSum / plxN : NaN;
  const meanDistancePc = Number.isFinite(meanPlx) && meanPlx > 0 ? 1000 / meanPlx : NaN;

  // Medians — use typed-array sort in place.
  const sortedPmra = pmraVals.slice(0, n).sort();
  const sortedPmdec = pmdecVals.slice(0, n).sort();
  const sortedPlx = plxVals.slice(0, n).filter((p) => Number.isFinite(p) && p > 0).sort();
  const medianPmra = median(sortedPmra);
  const medianPmdec = median(sortedPmdec);
  const medianPlx = median(sortedPlx);
  const medianDistancePc = Number.isFinite(medianPlx) && medianPlx > 0 ? 1000 / medianPlx : NaN;

  // Standard deviations.
  let sxa = 0, sxb = 0, sxp = 0;
  let ca = 0, cb = 0, cp = 0;
  for (let i = 0; i < n; i++) {
    const a = pmraVals[i], b = pmdecVals[i], p = plxVals[i];
    if (Number.isFinite(a)) { const d = a - meanPmra; sxa += d * d; ca++; }
    if (Number.isFinite(b)) { const d = b - meanPmdec; sxb += d * d; cb++; }
    if (Number.isFinite(p) && p > 0) { const d = p - meanPlx; sxp += d * d; cp++; }
  }
  const sdPmra = ca > 1 ? Math.sqrt(sxa / (ca - 1)) : NaN;
  const sdPmdec = cb > 1 ? Math.sqrt(sxb / (cb - 1)) : NaN;
  const sdPlx = cp > 1 ? Math.sqrt(sxp / (cp - 1)) : NaN;

  return {
    n, meanPmra, meanPmdec, meanPlx, meanDistancePc,
    medianPmra, medianPmdec, medianPlx, medianDistancePc,
    sdPmra, sdPmdec, sdPlx,
  };
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return NaN;
  const m = Math.floor(n / 2);
  return n % 2 ? sorted[m] : 0.5 * (sorted[m - 1] + sorted[m]);
}

function fmtN(v, dp) {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(dp);
}
function formatInt(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString();
}
