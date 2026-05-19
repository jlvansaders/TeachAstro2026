// App 3 — Track overplotter.
// Reads the cluster selection from the URL hash (written by the cluster-finder),
// applies the same PM + parallax mask, and plots an apparent-magnitude CMD
// (Gaia G vs BP−RP) with YBC isochrones overlaid.

import { createRoot }             from 'react-dom/client';
import { useState, useEffect, useRef } from 'react';
import Plotly                     from 'plotly.js-dist-min';
import { html }                   from '../shared/html.js';
import { decodeState }            from '../shared/url.js';
import { loadManifest, loadDataset } from '../shared/data.js';
import { useTheme, plotColors }   from '../shared/theme.js';
import { takeScreenshot, screenshotFilename } from '../shared/screenshot.js';

const DATA_BASE = '../cluster-finder/data';

// ── isochrone loader ──────────────────────────────────────────────────────────
// Columns (0-indexed): 0=age_gyr 2=Teff 4=LogL 5=Av 7=mass 9=G 10=G_BP 11=G_RP
// Returns { av0: Map, avCluster: Map } — same age keys, split by Av column.

async function loadIsochrones(datasetId) {
  const url = `../${datasetId}_YBC.txt`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  const text = await resp.text();

  // Detect column positions from the comment header line.
  let colG = 9, colBP = 10, colRP = 11;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const cols = line.replace(/^#+\s*/, '').split(/\s+/);
      const gi = cols.indexOf('G'), bpi = cols.indexOf('G_BP'), rpi = cols.indexOf('G_RP');
      if (gi >= 0 && bpi >= 0 && rpi >= 0) { colG = gi; colBP = bpi; colRP = rpi; }
      else if (cols.some(c => c === 'J' || c === 'Ks'))
        throw new Error(
          'Pleiades_YBC.txt contains 2MASS (J, H, Ks) photometry instead of Gaia (G, G_BP, G_RP). ' +
          'Please regenerate the file using the YBC tool with the Gaia EDR3 filter set.');
      continue;
    }
    break;
  }

  const av0       = new Map(); // Av ≈ 0 rows
  const avCluster = new Map(); // Av > 0 rows
  const minCols   = Math.max(colG, colBP, colRP) + 1;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    if (p.length < minCols) continue;
    const av   = parseFloat(p[5]);
    const age  = p[0];
    const teff = parseFloat(p[2]);
    const logL = parseFloat(p[4]);
    const mass = parseFloat(p[7]);
    const g    = parseFloat(p[colG]);
    const gbp  = parseFloat(p[colBP]);
    const grp  = parseFloat(p[colRP]);
    if (!isFinite(g) || !isFinite(gbp) || !isFinite(grp)) continue;
    if (teff < 3500 && logL > 0) continue;

    const map = Math.abs(av) < 0.001 ? av0 : avCluster;
    if (!map.has(age)) map.set(age, { bpRp: [], gAbs: [], mass: [] });
    const entry = map.get(age);
    entry.bpRp.push(gbp - grp);
    entry.gAbs.push(g);
    entry.mass.push(mass);
  }
  return { av0, avCluster };
}

// ── mask (mirrors cluster-finder/store.js recomputeMask) ─────────────────────

function pointInPolygon(x, y, xs, ys) {
  const n = xs.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = xs[i], yi = ys[i], xj = xs[j], yj = ys[j];
    const hit = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-300) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function computeMask(data, pmSel, plxRange) {
  const { pmra, pmdec, plx } = data.columns;
  const n    = data.n;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (pmSel) {
      const x = pmra[i], y = pmdec[i];
      if (pmSel.kind === 'box') {
        if (x < pmSel.x[0] || x > pmSel.x[1] || y < pmSel.y[0] || y > pmSel.y[1]) continue;
      } else if (pmSel.kind === 'lasso') {
        if (!pointInPolygon(x, y, pmSel.xs, pmSel.ys)) continue;
      }
    }
    if (plxRange) {
      const p = plx[i];
      if (p < plxRange[0] || p > plxRange[1]) continue;
    }
    mask[i] = 1;
  }
  return mask;
}

// ── CMD plot ──────────────────────────────────────────────────────────────────

const NULL_AGE = '';   // sentinel for "off"

function AgeSelect({ label, color, value, ages, onChange }) {
  const selectStyle = {
    background: 'var(--bg-raised)', color: 'var(--text)',
    border: `2px solid ${color}`, borderRadius: '4px',
    padding: '0.3rem 0.6rem', fontSize: '0.9rem', cursor: 'pointer',
  };
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style=${{ width: '10px', height: '10px', borderRadius: '50%',
                      background: color, flexShrink: 0 }}></span>
      <label style=${{ color: 'var(--text-dim)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
        ${label}
      </label>
      <select value=${value} onChange=${(e) => onChange(e.target.value)} style=${selectStyle}>
        <option value=${NULL_AGE}>— off —</option>
        ${ages.map((a) => html`<option key=${a} value=${a}>${a} Gyr</option>`)}
      </select>
    </div>
  `;
}

function CMD({ data, session, isochrones, correctDist, correctDust, onToggleDist, onToggleDust }) {
  const divRef = useRef(null);
  const [theme] = useTheme();

  // Collect all available ages from both maps (union), sorted numerically.
  const ages = [...new Set([...isochrones.av0.keys(), ...isochrones.avCluster.keys()])]
    .sort((a, b) => parseFloat(a) - parseFloat(b));

  // Three independent age selectors; default: slot 0 = youngest, others off.
  const [age0, setAge0] = useState(() => ages[0] ?? NULL_AGE);
  const [age1, setAge1] = useState(NULL_AGE);
  const [age2, setAge2] = useState(NULL_AGE);

  useEffect(() => {
    if (!divRef.current) return;
    const c = plotColors(theme);

    // Cluster stars — use apparent magnitudes directly.
    const mask = computeMask(data, session.pmSelection, session.plxRange);
    const { g, bpRp, plx } = data.columns;
    const starX = [], starY = [];
    let plxSum = 0, plxCount = 0;
    for (let i = 0; i < data.n; i++) {
      if (!mask[i]) continue;
      if (!isFinite(g[i]) || !isFinite(bpRp[i])) continue;
      starX.push(bpRp[i]);
      starY.push(g[i]);
      if (isFinite(plx[i]) && plx[i] > 0) { plxSum += plx[i]; plxCount++; }
    }

    // Distance modulus from mean parallax of selected stars.
    // Apply Gaia global parallax zero-point correction: +0.029 mas (Lindegren et al. 2018, DR2).
    const PLX_ZP  = 0.029; // mas
    const meanPlx = plxCount > 0 ? plxSum / plxCount : null;
    const corrPlx = meanPlx !== null ? meanPlx + PLX_ZP : null;
    const distMod = (corrPlx && corrPlx > 0) ? 5 * Math.log10(1000 / corrPlx) - 5 : 0;

    // Select isochrone map and magnitude shift.
    const isoMap   = correctDust ? isochrones.avCluster : isochrones.av0;
    const magShift = correctDist ? distMod : 0;

    const traces = [
      {
        x: starX, y: starY,
        mode: 'markers', type: 'scatter',
        name: 'Cluster stars',
        marker: { color: c.starColor, size: 4, opacity: 0.8 },
      },
    ];

    // Build isochrone traces, collecting all plotted points for axis ranging.
    const isoX = [], isoY_all = [];
    [age0, age1, age2].forEach((age, idx) => {
      if (!age) return;
      const iso = isoMap.get(age);
      if (!iso) return;
      const isoY = magShift !== 0 ? iso.gAbs.map((v) => v + magShift) : iso.gAbs;
      isoX.push(...iso.bpRp);
      isoY_all.push(...isoY);
      traces.push({
        x: iso.bpRp, y: isoY,
        mode: 'lines', type: 'scatter',
        name: `${age} Gyr`,
        line: { color: c.isoColors[idx], width: 2.5 },
        customdata: iso.mass,
        hovertemplate:
          `<b>${age} Gyr</b><br>` +
          `B<sub>P</sub>−R<sub>P</sub>: %{x:.3f}<br>` +
          `G (apparent): %{y:.3f}<br>` +
          `Mass: %{customdata:.3f} M☉<extra></extra>`,
      });
    });

    // Axis bounds: union of cluster stars and selected isochrone points.
    const allX = isoX.length  ? [...starX, ...isoX]    : starX;
    const allY = isoY_all.length ? [...starY, ...isoY_all] : starY;
    const xMin = Math.min(...allX), xMax = Math.max(...allX);
    const yMin = Math.min(...allY), yMax = Math.max(...allY);
    const xPad = (xMax - xMin) * 0.08 || 0.5;
    const yPad = (yMax - yMin) * 0.08 || 1;

    const layout = {
      paper_bgcolor: c.paper_bgcolor,
      plot_bgcolor:  c.plot_bgcolor,
      font: { color: c.fontColor, size: 16, family: 'inherit' },
      xaxis: {
        title: { text: 'B<sub>P</sub> − R<sub>P</sub>', font: { size: 17 } },
        range: [xMin - xPad, xMax + xPad],
        gridcolor: c.gridColor, zeroline: false,
        tickfont: { size: 16 },
      },
      yaxis: {
        title: { text: 'G (apparent mag)', font: { size: 17 } },
        range: [yMax + yPad, yMin - yPad],
        gridcolor: c.gridColor, zeroline: false,
        tickfont: { size: 16 },
      },
      legend: {
        bgcolor: 'rgba(0,0,0,0)',
        bordercolor: c.gridColor, borderwidth: 1,
        font: { size: 15 },
      },
      margin: { t: 30, r: 20, b: 70, l: 75 },
    };

    Plotly.react(divRef.current, traces, layout, { responsive: true });
  }, [data, session, isochrones, age0, age1, age2, correctDist, correctDust, theme]);

  const c = plotColors(theme);
  const [showInfo, setShowInfo] = useState(false);

  return html`
    <div>
      <div style=${{ marginBottom: '0.6rem', display: 'flex', flexWrap: 'wrap',
                     alignItems: 'center', gap: '1rem' }}>
        <span style=${{ color: 'var(--text-dim)', fontSize: '0.95rem' }}>Correct isochrones for:</span>
        <${ToggleButton} label="Cluster distance" active=${correctDist} onClick=${onToggleDist} />
        <${ToggleButton} label="Dust reddening and extinction" active=${correctDust} onClick=${onToggleDust} />
      </div>
      <div style=${{ marginBottom: '0.75rem', display: 'flex', flexWrap: 'wrap',
                     alignItems: 'center', gap: '1rem' }}>
        <span style=${{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>Isochrones:</span>
        <${AgeSelect} label="1" color=${c.isoColors[0]} value=${age0} ages=${ages} onChange=${setAge0} />
        <${AgeSelect} label="2" color=${c.isoColors[1]} value=${age1} ages=${ages} onChange=${setAge1} />
        <${AgeSelect} label="3" color=${c.isoColors[2]} value=${age2} ages=${ages} onChange=${setAge2} />
        <button
          onClick=${() => setShowInfo((v) => !v)}
          style=${{ marginLeft: 'auto', background: 'var(--bg-raised)', color: 'var(--text-dim)',
                    border: '1px solid var(--border-hi)', borderRadius: '4px',
                    padding: '0.3rem 0.75rem', fontSize: '0.85rem', cursor: 'pointer' }}>
          ${showInfo ? 'Hide info ▲' : 'How was this plot made? ▼'}
        </button>
      </div>

      ${showInfo ? html`
        <p style=${{ margin: '0 0 0.75rem', padding: '0.75rem 1rem',
                     background: 'var(--bg-raised)', border: '1px solid var(--border)',
                     borderRadius: '6px', fontSize: '0.9rem', color: 'var(--text-dim)',
                     lineHeight: '1.65' }}>
          Plotted are the Gaia apparent magnitudes and B<sub>P</sub>−R<sub>P</sub> colors
          of the stars you selected in the cluster finder. The model tracks are drawn from the${' '}
          <a href="https://arxiv.org/pdf/2603.25792" target="_blank" rel="noopener"
             style=${{ color: 'var(--accent)' }}>YREC public release</a>${' '}
          stellar model grid, with observational magnitudes computed using the${' '}
          <a href="https://sec.center/YBC/" target="_blank" rel="noopener"
             style=${{ color: 'var(--accent)' }}>YBC bolometric correction tool</a>.
          Use the toggles above to correct the isochrones for the cluster distance (shifting
          to apparent magnitude using the mean parallax of your selected members) and for${' '}
          <a href="https://en.wikipedia.org/wiki/Extinction_(astronomy)" target="_blank" rel="noopener"
             style=${{ color: 'var(--accent)' }}>dust extinction and reddening</a>${' '}
          along the line of sight.
        </p>
      ` : null}

      <div ref=${divRef} style=${{ width: '100%', height: '80vh', minHeight: '600px' }} />
    </div>
  `;
}

// ── App ───────────────────────────────────────────────────────────────────────

function ToggleButton({ label, active, onClick }) {
  return html`
    <button
      onClick=${onClick}
      style=${{
        background: active ? '#0ea5e9' : 'var(--bg-raised)',
        color: active ? '#fff' : 'var(--text-dim)',
        border: active ? '2px solid #0ea5e9' : '2px solid var(--border-hi)',
        borderRadius: '6px',
        padding: '0.45rem 1rem',
        fontSize: '0.95rem',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        fontFamily: 'inherit',
      }}>
      ${active ? '✓ ' : ''}${label}
    </button>
  `;
}

function App() {
  const [theme, setTheme] = useTheme();
  const [status,     setStatus]     = useState('Restoring session…');
  const [session,    setSession]    = useState(null);
  const [cluster,    setCluster]    = useState(null);
  const [isochrones, setIsochrones] = useState(null);
  const [correctDist, setCorrectDist] = useState(false);
  const [correctDust, setCorrectDust] = useState(false);

  useEffect(() => {
    const restored = decodeState(window.location.hash.replace(/^#/, ''));
    if (!restored?.datasetId) {
      setStatus('No cluster selection found. Open the cluster finder, make a selection, then use "Send to overplotter".');
      return;
    }
    setSession(restored);
    setStatus('Loading…');

    (async () => {
      try {
        const [manifest, isos] = await Promise.all([
          loadManifest(DATA_BASE),
          loadIsochrones(restored.datasetId),
        ]);
        setIsochrones(isos);

        const meta = manifest.datasets.find((d) => d.id === restored.datasetId);
        if (!meta) throw new Error(`Dataset "${restored.datasetId}" not found in manifest.`);
        const data = await loadDataset(meta, DATA_BASE);
        setCluster(data);
        setStatus(null);
      } catch (err) {
        setStatus(`Error: ${err.message}`);
      }
    })();
  }, []);

  const nSelected = (() => {
    if (!cluster || !session) return 0;
    const mask = computeMask(cluster, session.pmSelection, session.plxRange);
    let c = 0; for (let i = 0; i < mask.length; i++) c += mask[i];
    return c;
  })();

  return html`
    <div class="booted" style=${{ padding: '2rem', width: '100%', maxWidth: '1400px', margin: '0 auto', boxSizing: 'border-box' }}>
      <header class="topbar">
        <h1 style=${{ display: 'flex', alignItems: 'center', gap: '0.5rem', lineHeight: '1' }}>
          <img src="../shared/logo.png" alt="TeachAstro"
               style=${{ height: '32px', width: 'auto', display: 'block' }} />
          <span style=${{ color: '#94a3b8', fontWeight: 400, fontSize: '0.95rem' }}>
            · Track overplotter
          </span>
        </h1>
        <div class="spacer"></div>
        <button
          onClick=${() => takeScreenshot(screenshotFilename('TrackOverplotter'))}
          style=${{ background: 'var(--bg-raised)', color: 'var(--text)', border: '1px solid var(--border-hi)',
                    padding: '0.35rem 0.7rem', borderRadius: '4px', fontSize: '0.85rem', cursor: 'pointer' }}>
          Screenshot
        </button>
        <button
          onClick=${() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          style=${{ background: 'var(--bg-raised)', color: 'var(--text)', border: '1px solid var(--border-hi)',
                    padding: '0.35rem 0.7rem', borderRadius: '4px', fontSize: '0.85rem', cursor: 'pointer' }}>
          ${theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
        <a href=${'../cluster-finder/' + window.location.hash} style=${{ color: 'var(--accent)', fontSize: '0.85rem' }}>
          ← Back to cluster finder
        </a>
        <a href="../" style=${{ color: 'var(--accent)', fontSize: '0.85rem', marginLeft: '1rem' }}>
          ← Home
        </a>
      </header>

      <main style=${{ marginTop: '2rem', color: '#eaeaea' }}>
        ${status ? html`
          <p style=${{ color: status.startsWith('Error') ? '#fca5a5' : '#fde68a' }}>
            ${status}
          </p>
        ` : null}

        ${session && !status ? html`
          <p style=${{ color: '#86efac', marginBottom: '1.25rem' }}>
            ✓ Cluster: <strong>${session.datasetId}</strong>
            ${session.pmSelection ? ' · PM selection active' : ''}
            ${session.plxRange    ? ' · parallax filter active' : ''}
            ${' · '}<strong>${nSelected.toLocaleString()}</strong> stars plotted
          </p>
        ` : null}

        ${cluster && isochrones ? html`
          <${CMD}
            data=${cluster}
            session=${session}
            isochrones=${isochrones}
            correctDist=${correctDist}
            correctDust=${correctDust}
            onToggleDist=${() => setCorrectDist((v) => !v)}
            onToggleDust=${() => setCorrectDust((v) => !v)}
          />
        ` : null}
      </main>
    </div>
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
