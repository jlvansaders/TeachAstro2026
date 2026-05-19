// Color–magnitude diagram for the currently selected stars.
// Exposes an `overlays` prop pattern so Part 1 (stellar models) can later
// inject isochrone curves without touching this component.

import { useMemo } from 'react';
import { html } from '../html.js';
import { Plot } from './Plot.js';
import { useStore, actions } from '../store.js';
import { useTheme, plotColors } from '../../shared/theme.js';


export function CMDPanel({ overlays = [] }) {
  const [theme]     = useTheme();
  const c           = plotColors(theme);
  const data        = useStore((s) => s.data);
  const mask        = useStore((s) => s.mask);
  const nSelected   = useStore((s) => s.nSelected);
  const cmdAbsolute = useStore((s) => s.cmdAbsolute);

  const { x, y, meanPlx } = useMemo(() => {
    if (!data) return { x: [], y: [], meanPlx: NaN };
    const { plx, g, bpRp } = data.columns;
    const xs = [], ys = [];
    let plxSum = 0, plxN = 0;

    const nItems = mask ? nSelected : data.n;
    const useMask = !!mask && nSelected > 0 && nSelected < data.n;
    // If nothing selected, leave the panel empty rather than flooding it
    // with 200k field stars (unhelpful for CMD work).
    if (mask && nSelected === 0) return { x: [], y: [], meanPlx: NaN };

    // First pass: mean parallax of selection for absolute-mag conversion.
    for (let i = 0; i < data.n; i++) {
      if (useMask && !mask[i]) continue;
      const p = plx[i];
      if (Number.isFinite(p) && p > 0) { plxSum += p; plxN++; }
    }
    const meanPlx = plxN ? plxSum / plxN : NaN;
    const distancePc = Number.isFinite(meanPlx) && meanPlx > 0 ? 1000 / meanPlx : NaN;
    const distMod = Number.isFinite(distancePc) ? 5 * Math.log10(distancePc) - 5 : NaN;

    for (let i = 0; i < data.n; i++) {
      if (useMask && !mask[i]) continue;
      const gi = g[i], c = bpRp[i];
      if (!Number.isFinite(gi) || !Number.isFinite(c)) continue;
      xs.push(c);
      ys.push(cmdAbsolute && Number.isFinite(distMod) ? gi - distMod : gi);
    }
    return { x: xs, y: ys, meanPlx };
  }, [data, mask, nSelected, cmdAbsolute]);

  if (!data) return html`<div className="panel cmd"><header>CMD</header></div>`;

  const traces = [
    {
      type: 'scattergl',
      mode: 'markers',
      x, y,
      marker: { size: 3, color: c.selectedColor },
      name: 'selection',
      hoverinfo: 'x+y',
    },
    ...overlays,   // future: isochrone curves from Part 1
  ];

  const layout = {
    paper_bgcolor: c.paper_bgcolor,
    plot_bgcolor:  c.plot_bgcolor,
    font: { color: c.fontColor, size: 15 },
    margin: { l: 60, r: 15, t: 10, b: 50 },
    xaxis: {
      title: { text: 'BP − RP (mag)', font: { size: 16 } },
      gridcolor: c.gridColor, zerolinecolor: c.zeroColor,
      tickfont: { size: 15 },
    },
    yaxis: {
      title: { text: cmdAbsolute ? 'M_G (mag, absolute)' : 'G (mag, apparent)', font: { size: 16 } },
      gridcolor: c.gridColor, zerolinecolor: c.zeroColor,
      tickfont: { size: 15 },
      autorange: 'reversed',
    },
    showlegend: false,
    dragmode: 'pan',
    // Keep zoom/pan as the user tweaks abs/app toggle or selection; reset
    // when dataset changes.
    uirevision: `${data.meta.id}:${cmdAbsolute ? 'abs' : 'app'}`,
  };

  const config = { responsive: true, displaylogo: false };

  return html`
    <div className="panel cmd">
      <header>
        Color–magnitude diagram
        <span className="hint">BP−RP vs ${cmdAbsolute ? 'M_G' : 'G'}</span>
        <div className="controls">
          <label>
            <input type="checkbox" checked=${cmdAbsolute}
              onChange=${(e) => actions.setCmdAbsolute(e.target.checked)} />
            absolute (uses selection mean Plx)
          </label>
        </div>
      </header>
      <div className="plot-host">
        <${Plot}
          data=${traces}
          layout=${layout}
          config=${config}
          style=${{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  `;
}
