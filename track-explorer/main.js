// Track Explorer — browse and compare stellar evolutionary tracks.
// Data: eep_tracks_solar.json (solar-metallicity EEP tracks from kiauhoku).
// Two linked plots: left = fixed HRD, right = user-selectable axes.
// Hovering a point in either panel highlights the corresponding location
// in the other panel using a pre-allocated highlight trace + Plotly.restyle.

import { createRoot }                    from 'react-dom/client';
import { useState, useEffect, useRef }   from 'react';
import Plotly                            from 'plotly.js-dist-min';
import { html }                          from '../shared/html.js';
import { useTheme, plotColors }          from '../shared/theme.js';
import { takeScreenshot, screenshotFilename } from '../shared/screenshot.js';

const TRACKS_URL = '../eep_tracks_solar.json';
const LOCI_URL   = '../hr_loci_solar.json';
const NULL_MASS  = '';

// EEP boundaries (match export_eep_tracks.py / eep_params intervals [200,250,500,50]).
const ZAMS_EEP      = 201;
const TAMS_EEP      = 451;
const POST_MS_ALPHA = 0.25;

// Each track slot gets 2 traces (MS + post-MS), so highlight is at index 6.
const HL = 6;

// All available column keys (same order as metadata.columns).
const COLUMNS = [
  'eep', 'Age_gyr', 'log_Teff', 'Teff',
  'LogL_lsun', 'Log_g', 'LogR_rsun', 'R_rsun', 'X_cen',
];

// Per-column display configuration.
// values(track) → array to pass to Plotly (unlogged for log-scale columns).
// axisType      → Plotly axis type ('log' | 'linear').
// title         → HTML axis label shown on the plot.
// hoverFmt      → d3-format specifier for the hover tooltip.
// selectLabel   → plain-text label for the <select> dropdown.
const COL_DISPLAY = {
  eep: {
    values:      t => t.eep,
    axisType:    'linear',
    title:       'EEP',
    hoverFmt:    '.0f',
    selectLabel: 'EEP',
  },
  Age_gyr: {
    values:      t => t.Age_gyr,
    axisType:    'linear',
    title:       'Age (Gyr)',
    hoverFmt:    '.4g',
    selectLabel: 'Age (Gyr)',
  },
  log_Teff: {
    values:      t => t.Teff,                          // plot Teff in K on a log axis
    axisType:    'log',
    title:       'T<sub>eff</sub> (K)',
    hoverFmt:    ',.0f',
    selectLabel: 'Teff  —  log scale',
  },
  Teff: {
    values:      t => t.Teff,
    axisType:    'linear',
    title:       'T<sub>eff</sub> (K)',
    hoverFmt:    ',.0f',
    selectLabel: 'Teff  —  linear scale',
  },
  LogL_lsun: {
    values:      t => t.LogL_lsun.map(v => 10 ** v),  // convert to L/L☉
    axisType:    'log',
    title:       'L/L<sub>☉</sub>',
    hoverFmt:    '.4g',
    selectLabel: 'L/L☉  —  log scale',
  },
  Log_g: {
    values:      t => t.Log_g.map(v => 10 ** v),       // convert to g in cm/s²
    axisType:    'log',
    title:       'g (cm s<sup>−2</sup>)',
    hoverFmt:    '.4g',
    selectLabel: 'g  —  log scale',
  },
  LogR_rsun: {
    values:      t => t.R_rsun,                        // R_rsun already unlogged
    axisType:    'log',
    title:       'R/R<sub>☉</sub>',
    hoverFmt:    '.4g',
    selectLabel: 'R/R☉  —  log scale',
  },
  R_rsun: {
    values:      t => t.R_rsun,
    axisType:    'linear',
    title:       'R/R<sub>☉</sub>',
    hoverFmt:    '.4g',
    selectLabel: 'R/R☉  —  linear scale',
  },
  X_cen: {
    values:      t => t.X_cen,
    axisType:    'linear',
    title:       'Core H (X<sub>c</sub>)',
    hoverFmt:    '.4g',
    selectLabel: 'Core H (Xc)',
  },
};

const TRACK_COLORS = {
  dark:  ['#fbbf24', '#4ade80', '#f472b6'],
  light: ['#c2410c', '#15803d', '#7c3aed'],
};

function tColors(theme) {
  return theme === 'light' ? TRACK_COLORS.light : TRACK_COLORS.dark;
}

function hlColor(theme) {
  return theme === 'light' ? 'rgba(0,0,80,0.9)' : 'rgba(255,255,255,0.9)';
}

// Find a track by mass.  Uses parseFloat so that String(1.0)='1' and '1.0'
// both resolve to the 1.0 M☉ track without brittle string comparison.
function findTrack(tracks, massStr) {
  if (!massStr) return null;
  const target = parseFloat(massStr);
  return tracks.find(t => Math.abs(t.mass - target) < 1e-9) ?? null;
}

// Return [min, max] of COL_DISPLAY[col].values() across the MS segment
// (ZAMS_EEP → TAMS_EEP) of all active tracks.  Returns [Infinity, -Infinity]
// when no active tracks exist.
function msBounds(tracks, masses, col) {
  let lo = Infinity, hi = -Infinity;
  const cfg = COL_DISPLAY[col];
  masses.forEach(mass => {
    const track = findTrack(tracks, mass);
    if (!track) return;
    const z = track.eep.findIndex(v => v >= ZAMS_EEP);
    const t = track.eep.findIndex(v => v >  TAMS_EEP);
    const start = z === -1 ? 0 : z;
    const end   = t === -1 ? track.eep.length : t;
    const vals  = cfg.values(track).slice(start, end);
    for (const v of vals) {
      if (v != null && isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  });
  return [lo, hi];
}

// Convert [min, max] data bounds into a Plotly axis range array, adding
// fractional padding.  For log axes the range is in log10 space (as Plotly
// requires).  Returns null if bounds are not finite.
function msRange(lo, hi, axisType, reversed = false, pad = 0.06) {
  if (!isFinite(lo) || !isFinite(hi)) return null;
  let a, b;
  if (axisType === 'log') {
    a = Math.log10(lo);
    b = Math.log10(hi);
  } else {
    a = lo; b = hi;
  }
  const p = (b - a) * pad || 0.1;
  return reversed ? [b + p, a - p] : [a - p, b + p];
}

// Build 2 traces per track slot (MS at full opacity, post-MS dimmed; pre-MS
// excluded) plus the highlight trace.  Always emits exactly HL+1 traces so
// curveNumber arithmetic in the hover handlers stays stable.
function buildTraces(tracks, masses, xCol, yCol, theme, showAge = false) {
  const colors = tColors(theme);
  const hl     = hlColor(theme);
  const xCfg   = COL_DISPLAY[xCol];
  const yCfg   = COL_DISPLAY[yCol];

  const empty = (color) => ({
    x: [], y: [], mode: 'lines', type: 'scatter',
    name: '', showlegend: false,
    line: { color, width: 2.5 },
  });

  const traces = [];

  masses.forEach((mass, i) => {
    const track = findTrack(tracks, mass);
    if (!track) {
      traces.push(empty(colors[i]));   // MS slot
      traces.push(empty(colors[i]));   // post-MS slot
      return;
    }

    const zamsIdx = track.eep.findIndex(v => v >= ZAMS_EEP);
    const tamsIdx = track.eep.findIndex(v => v >  TAMS_EEP);
    const msStart = zamsIdx === -1 ? 0 : zamsIdx;
    const msEnd   = tamsIdx === -1 ? track.eep.length : tamsIdx;

    const xAll   = xCfg.values(track);
    const yAll   = yCfg.values(track);
    const ageAll = track.Age_gyr;

    const ageLine = showAge ? `Age: %{customdata:.4g} Gyr<br>` : '';
    const htmpl = (label) =>
      `<b>${mass} M☉</b> (${label})<br>` +
      `${xCfg.selectLabel}: %{x:${xCfg.hoverFmt}}<br>` +
      `${yCfg.selectLabel}: %{y:${yCfg.hoverFmt}}<br>` +
      ageLine +
      `<extra></extra>`;

    // MS trace (ZAMS → TAMS, inclusive)
    traces.push({
      x: xAll.slice(msStart, msEnd),
      y: yAll.slice(msStart, msEnd),
      ...(showAge && { customdata: ageAll.slice(msStart, msEnd) }),
      mode: 'lines', type: 'scatter',
      name: `${mass} M☉`,
      line: { color: colors[i], width: 2.5 },
      hovertemplate: htmpl('MS'),
    });

    // Post-MS trace (TAMS+1 → end), dimmed
    traces.push({
      x: tamsIdx === -1 ? [] : xAll.slice(tamsIdx),
      y: tamsIdx === -1 ? [] : yAll.slice(tamsIdx),
      ...(showAge && { customdata: tamsIdx === -1 ? [] : ageAll.slice(tamsIdx) }),
      mode: 'lines', type: 'scatter',
      name: `${mass} M☉`, showlegend: false,
      opacity: POST_MS_ALPHA,
      line: { color: colors[i], width: 2.5 },
      hovertemplate: htmpl('post-MS'),
    });
  });

  // Highlight trace — starts empty; filled via Plotly.restyle on hover.
  traces.push({
    x: [], y: [],
    mode: 'markers', type: 'scatter',
    name: '', showlegend: false,
    hoverinfo: 'skip',
    marker: {
      size: 16, symbol: 'circle-open',
      color: hl, line: { color: hl, width: 3 },
    },
  });

  return traces;
}

// ── Loci ─────────────────────────────────────────────────────────────────────

// Per-locus line style.  Two themes; ZAMS/TAMS are dashed, isochrones solid.
const LOCI_STYLES = {
  dark: {
    'ZAMS':    { color: '#cbd5e1', dash: 'dot', width: 1.5 },
    'TAMS':    { color: '#94a3b8', dash: 'dot', width: 1.5 },
    '0.1 Gyr': { color: 'rgba(255,255,255,0.80)', dash: 'dash', width: 1.5 },
    '1 Gyr':   { color: 'rgba(255,255,255,0.80)', dash: 'dash', width: 1.5 },
    '2 Gyr':   { color: 'rgba(255,255,255,0.80)', dash: 'dash', width: 1.5 },
    '5 Gyr':   { color: 'rgba(255,255,255,0.80)', dash: 'dash', width: 1.5 },
  },
  light: {
    'ZAMS':    { color: '#334155', dash: 'dot', width: 1.5 },
    'TAMS':    { color: '#64748b', dash: 'dot', width: 1.5 },
    '0.1 Gyr': { color: 'rgba(15,23,42,0.75)', dash: 'dash', width: 1.5 },
    '1 Gyr':   { color: 'rgba(15,23,42,0.75)', dash: 'dash', width: 1.5 },
    '2 Gyr':   { color: 'rgba(15,23,42,0.75)', dash: 'dash', width: 1.5 },
    '5 Gyr':   { color: 'rgba(15,23,42,0.75)', dash: 'dash', width: 1.5 },
  },
};

// Build one Plotly trace per active locus.  These are appended after the
// highlight trace (index HL) so the hover guard `curveNumber >= HL` skips them.
// Loci only carry Teff and LogL_lsun so they only appear on the HRD panel.
function buildLociTraces(lociData, activeLabels, theme) {
  if (!lociData || activeLabels.length === 0) return [];
  const styles = LOCI_STYLES[theme] ?? LOCI_STYLES.dark;

  return activeLabels.map(label => {
    const locus = lociData.find(l => l.label === label);
    if (!locus) return null;
    const isoColor = theme === 'dark' ? 'rgba(255,255,255,0.80)' : 'rgba(15,23,42,0.75)';
    const style = styles[label] ?? { color: isoColor, dash: 'dash', width: 1.5 };

    // Filter out cool luminous points (same fix as track-overplotter):
    // Teff < 3500 with LogL > 0 produces ordering artefacts on the giant branch.
    const x = [], y = [], mass = [];
    for (let i = 0; i < locus.Teff.length; i++) {
      if (locus.Teff[i] < 3500 && locus.LogL_lsun[i] > 0) continue;
      x.push(locus.Teff[i]);
      y.push(10 ** locus.LogL_lsun[i]);
      mass.push(locus.initial_mass[i]);
    }

    const isIsochrone = label.includes('Gyr');

    const lineTrace = {
      x, y,
      mode: 'lines+markers', type: 'scatter',
      marker: { size: 10, color: 'rgba(0,0,0,0)', line: { width: 0 } },
      name: label,
      // Isochrones are labelled inline; keep ZAMS/TAMS in the legend.
      showlegend: !isIsochrone,
      line: { color: style.color, width: style.width, dash: style.dash },
      hovertemplate:
        `<b>${label}</b><br>` +
        `T<sub>eff</sub>: %{x:,.0f} K<br>` +
        `L/L<sub>☉</sub>: %{y:.3g}<br>` +
        `Mass: %{customdata:.2f} M☉<extra></extra>`,
      customdata: mass,
    };

    return [lineTrace];
  }).flat().filter(Boolean);
}

// xRange / yRange: explicit Plotly range arrays (log10 space for log axes).
// Pass null to fall back to autorange.  Reversed x is encoded in the range
// itself (xRange[0] > xRange[1]) so no separate reverseX flag is needed.
function buildLayout(xCol, yCol, theme, xRange = null, yRange = null) {
  const c    = plotColors(theme);
  const xCfg = COL_DISPLAY[xCol];
  const yCfg = COL_DISPLAY[yCol];
  return {
    paper_bgcolor: c.paper_bgcolor,
    plot_bgcolor:  c.plot_bgcolor,
    font:  { color: c.fontColor, size: 15, family: 'inherit' },
    xaxis: {
      title:     { text: xCfg.title, font: { size: 17 } },
      type:      xCfg.axisType,
      gridcolor: c.gridColor, zeroline: false, tickfont: { size: 15 },
      ...(xRange ? { range: xRange, autorange: false } : { autorange: true }),
    },
    yaxis: {
      title:     { text: yCfg.title, font: { size: 17 } },
      type:      yCfg.axisType,
      gridcolor: c.gridColor, zeroline: false, tickfont: { size: 15 },
      ...(yRange ? { range: yRange, autorange: false } : { autorange: true }),
    },
    legend: {
      bgcolor: 'rgba(0,0,0,0)', borderwidth: 1,
      bordercolor: c.gridColor, font: { size: 14 },
      x: 1, xanchor: 'right', y: 1,
    },
    margin:    { t: 20, r: 20, b: 65, l: 75 },
    hovermode: 'closest',
  };
}

const PLOTLY_CFG = { responsive: true };

// ── DualPlot ──────────────────────────────────────────────────────────────────
// Renders both plots and wires up cross-panel hover highlighting.

function DualPlot({ tracks, masses, xAxis, yAxis, onXChange, onYChange, lociData, activeLoci, theme }) {
  const leftRef  = useRef(null);
  const rightRef = useRef(null);

  useEffect(() => {
    if (!leftRef.current || !rightRef.current) return;

    // Left panel: track segments (0-5) + highlight (6) + loci (7+).
    const lTraces = [
      ...buildTraces(tracks, masses, 'log_Teff', 'LogL_lsun', theme, true),
      ...buildLociTraces(lociData, activeLoci, theme),
    ];
    const rTraces = buildTraces(tracks, masses, xAxis, yAxis, theme);

    // Scale both panels to the MS portion of the active tracks.
    const [lxLo, lxHi] = msBounds(tracks, masses, 'log_Teff');
    const [lyLo, lyHi] = msBounds(tracks, masses, 'LogL_lsun');
    const lxRange = msRange(lxLo, lxHi, 'log', /* reversed */ true);
    const lyRange = msRange(lyLo, lyHi, 'log');

    const [rxLo, rxHi] = msBounds(tracks, masses, xAxis);
    const [ryLo, ryHi] = msBounds(tracks, masses, yAxis);
    const rxRange = msRange(rxLo, rxHi, COL_DISPLAY[xAxis].axisType);
    const ryRange = msRange(ryLo, ryHi, COL_DISPLAY[yAxis].axisType);

    const lLayout = buildLayout('log_Teff', 'LogL_lsun', theme, lxRange, lyRange);
    const rLayout = buildLayout(xAxis, yAxis, theme, rxRange, ryRange);

    Plotly.react(leftRef.current,  lTraces, lLayout, PLOTLY_CFG);
    Plotly.react(rightRef.current, rTraces, rLayout, PLOTLY_CFG);

    const lEl = leftRef.current;
    const rEl = rightRef.current;

    // curveNumber = trackSlot*2 + (0=MS, 1=postMS).
    // pt.pointIndex is local to the segment; segOffset maps it back to the
    // full track array so we can look up values for the other panel.
    function segOffset(track, isPostMS) {
      if (isPostMS) return track.eep.findIndex(v => v > TAMS_EEP);
      const z = track.eep.findIndex(v => v >= ZAMS_EEP);
      return z === -1 ? 0 : z;
    }

    function onHoverLeft(e) {
      const pt = e.points[0];
      if (pt.curveNumber === HL) return;

      if (pt.curveNumber > HL) {
        // Locus hovered: thicken it.
        Plotly.restyle(lEl, { 'line.width': 3 }, [pt.curveNumber]);
        return;
      }

      // Track hovered: cross-highlight right panel.
      const slot     = pt.curveNumber >> 1;
      const isPostMS = (pt.curveNumber & 1) === 1;
      const track    = findTrack(tracks, masses[slot]);
      if (!track) return;
      const off  = segOffset(track, isPostMS);
      if (off < 0) return;
      const orig = off + pt.pointIndex;
      const xv   = COL_DISPLAY[xAxis].values(track);
      const yv   = COL_DISPLAY[yAxis].values(track);
      Plotly.restyle(rEl, { x: [[xv[orig]]], y: [[yv[orig]]] }, [HL]);
    }

    function onUnhoverLeft() {
      Plotly.restyle(rEl, { x: [[]], y: [[]] }, [HL]);
      // Reset all loci to normal line width.
      if (activeLoci.length > 0) {
        const lociIndices = Array.from({ length: activeLoci.length }, (_, i) => HL + 1 + i);
        Plotly.restyle(lEl, { 'line.width': 1.5 }, lociIndices);
      }
    }

    function onHoverRight(e) {
      const pt       = e.points[0];
      if (pt.curveNumber >= HL) return;
      const slot     = pt.curveNumber >> 1;
      const isPostMS = (pt.curveNumber & 1) === 1;
      const track    = findTrack(tracks, masses[slot]);
      if (!track) return;
      const off  = segOffset(track, isPostMS);
      if (off < 0) return;
      const orig = off + pt.pointIndex;
      const xv   = COL_DISPLAY['log_Teff'].values(track);
      const yv   = COL_DISPLAY['LogL_lsun'].values(track);
      Plotly.restyle(lEl, { x: [[xv[orig]]], y: [[yv[orig]]] }, [HL]);
    }

    function onUnhoverRight() {
      Plotly.restyle(lEl, { x: [[]], y: [[]] }, [HL]);
    }

    lEl.on('plotly_hover',    onHoverLeft);
    lEl.on('plotly_unhover',  onUnhoverLeft);
    rEl.on('plotly_hover',    onHoverRight);
    rEl.on('plotly_unhover',  onUnhoverRight);

    return () => {
      // Remove only our custom callbacks; Plotly's own internal emitter
      // fires these events rather than listening to them, so this is safe.
      lEl.removeAllListeners?.('plotly_hover');
      lEl.removeAllListeners?.('plotly_unhover');
      rEl.removeAllListeners?.('plotly_hover');
      rEl.removeAllListeners?.('plotly_unhover');
    };
  }, [tracks, masses, xAxis, yAxis, lociData, activeLoci, theme]);

  const selStyle = {
    background: 'var(--bg-raised)', color: 'var(--text)',
    border: '1px solid var(--border-hi)',
    padding: '0.2rem 0.45rem', borderRadius: '4px',
    fontSize: '0.75rem', cursor: 'pointer',
  };

  const panelStyle = {
    flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: '6px', overflow: 'hidden',
  };

  const headerStyle = {
    padding: '0.4rem 0.75rem', flexShrink: 0,
    borderBottom: '1px solid var(--border)',
    fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem',
  };

  return html`
    <div style=${{ display: 'flex', flex: '1 1 0', minHeight: 0, gap: '8px' }}>

      <!-- Left: fixed HRD -->
      <div style=${panelStyle}>
        <div style=${{ ...headerStyle }}>
          <span style=${{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
            H–R Diagram
          </span>
          <span style=${{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 'auto' }}>
            log T<sub>eff</sub> → log L/L<sub>☉</sub>
          </span>
        </div>
        <div ref=${leftRef} style=${{ flex: '1 1 0', minHeight: 0 }} />
      </div>

      <!-- Right: configurable -->
      <div style=${panelStyle}>
        <div style=${{ ...headerStyle, flexWrap: 'wrap' }}>
          <span style=${{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
            Explorer
          </span>
          <span style=${{ color: 'var(--text-muted)' }}>X</span>
          <select value=${xAxis} onChange=${e => onXChange(e.target.value)} style=${selStyle}>
            ${COLUMNS.map(col => html`
              <option key=${col} value=${col}>${COL_DISPLAY[col].selectLabel}</option>
            `)}
          </select>
          <span style=${{ color: 'var(--text-muted)' }}>Y</span>
          <select value=${yAxis} onChange=${e => onYChange(e.target.value)} style=${selStyle}>
            ${COLUMNS.map(col => html`
              <option key=${col} value=${col}>${COL_DISPLAY[col].selectLabel}</option>
            `)}
          </select>
        </div>
        <div ref=${rightRef} style=${{ flex: '1 1 0', minHeight: 0 }} />
      </div>

    </div>
  `;
}

// ── TrackSelect ───────────────────────────────────────────────────────────────

function TrackSelect({ label, color, value, availMasses, onChange }) {
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
      <span style=${{
        width: '10px', height: '10px', borderRadius: '50%',
        background: color, flexShrink: 0,
      }} />
      <span style=${{ color: 'var(--text-dim)', fontSize: '0.85rem', userSelect: 'none' }}>
        ${label}
      </span>
      <select
        value=${value}
        onChange=${e => onChange(e.target.value)}
        style=${{
          background: 'var(--bg-raised)', color: 'var(--text)',
          border: `2px solid ${color}`, borderRadius: '4px',
          padding: '0.25rem 0.5rem', fontSize: '0.85rem', cursor: 'pointer',
        }}
      >
        <option value=${NULL_MASS}>— off —</option>
        ${availMasses.map(m => html`
          <option key=${m} value=${String(m)}>${m} M☉</option>
        `)}
      </select>
    </div>
  `;
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [theme, setTheme] = useTheme();
  const [tracks,      setTracks]      = useState(null);
  const [lociData,    setLociData]    = useState(null);
  const [availMasses, setAvailMasses] = useState([]);
  const [availLoci,   setAvailLoci]   = useState([]);
  const [activeLoci,  setActiveLoci]  = useState([]);
  const [loadError,   setLoadError]   = useState(null);

  // Note: option values use String(m), so 1.0 → '1', 3.0 → '3', etc.
  const [sel0, setSel0] = useState('1');
  const [sel1, setSel1] = useState(NULL_MASS);
  const [sel2, setSel2] = useState(NULL_MASS);

  // Right-panel axes — default: age on X shows lifetime, luminosity on Y.
  const [xAxis, setXAxis] = useState('Age_gyr');
  const [yAxis, setYAxis] = useState('X_cen');

  useEffect(() => {
    const load = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
    Promise.all([load(TRACKS_URL), load(LOCI_URL)])
      .then(([tracks, loci]) => {
        setTracks(tracks.tracks);
        setAvailMasses(tracks.metadata.masses);
        setLociData(loci.loci);
        setAvailLoci(loci.metadata.loci_labels);
      })
      .catch(err => setLoadError(err.message));
  }, []);

  const colors          = tColors(theme);
  const selectedMasses  = [sel0, sel1, sel2];

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>

      <!-- Top bar -->
      <header class="topbar">
        <h1 style=${{ display: 'flex', alignItems: 'center', gap: '0.5rem', lineHeight: '1', margin: 0 }}>
          <img
            src="../shared/logo.png" alt="TeachAstro"
            style=${{ height: '32px', width: 'auto', display: 'block' }}
          />
          <span style=${{ color: '#94a3b8', fontWeight: 400, fontSize: '0.95rem' }}>
            · Track Explorer
          </span>
        </h1>
        <div class="spacer" />
        <button
          onClick=${() => takeScreenshot(screenshotFilename('TrackExplorer'))}
          style=${{
            background: 'var(--bg-raised)', color: 'var(--text)',
            border: '1px solid var(--border-hi)', padding: '0.35rem 0.7rem',
            borderRadius: '4px', fontSize: '0.85rem', cursor: 'pointer',
          }}
        >Screenshot</button>
        <button
          onClick=${() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          style=${{
            background: 'var(--bg-raised)', color: 'var(--text)',
            border: '1px solid var(--border-hi)', padding: '0.35rem 0.7rem',
            borderRadius: '4px', fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          ${theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
        <a href="../" style=${{ color: 'var(--accent)', fontSize: '0.85rem' }}>← Home</a>
      </header>

      ${loadError ? html`
        <div style=${{ padding: '1rem', color: '#fca5a5', flexShrink: 0 }}>
          Error loading track data: ${loadError}
        </div>
      ` : null}

      ${tracks ? html`

        <!-- Track selector controls -->
        <div style=${{
          display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap',
          padding: '0.55rem 1rem', flexShrink: 0,
          background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
        }}>
          <span style=${{ color: 'var(--text-dim)', fontSize: '0.85rem', userSelect: 'none' }}>
            Tracks:
          </span>
          <${TrackSelect}
            label="1" color=${colors[0]}
            value=${sel0} availMasses=${availMasses}
            onChange=${setSel0}
          />
          <${TrackSelect}
            label="2" color=${colors[1]}
            value=${sel1} availMasses=${availMasses}
            onChange=${setSel1}
          />
          <${TrackSelect}
            label="3" color=${colors[2]}
            value=${sel2} availMasses=${availMasses}
            onChange=${setSel2}
          />
          <span style=${{ color: 'var(--text-dim)', fontSize: '0.85rem', marginLeft: '1.5rem', userSelect: 'none' }}>
            Loci:
          </span>
          <select
            value=""
            onChange=${e => {
              const label = e.target.value;
              if (label && !activeLoci.includes(label))
                setActiveLoci(prev => [...prev, label]);
            }}
            style=${{
              background: 'var(--bg-raised)', color: 'var(--text)',
              border: '1px solid var(--border-hi)', borderRadius: '4px',
              padding: '0.25rem 0.5rem', fontSize: '0.85rem', cursor: 'pointer',
            }}
          >
            <option value="">— add locus —</option>
            ${availLoci.map(l => html`<option key=${l} value=${l}>${l}</option>`)}
          </select>
          ${activeLoci.length > 0 ? html`
            <div style=${{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
              ${activeLoci.map(l => html`
                <span key=${l} style=${{
                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                  background: 'var(--bg-raised)', border: '1px solid var(--border-hi)',
                  borderRadius: '4px', padding: '0.15rem 0.4rem',
                  fontSize: '0.78rem', color: 'var(--text-dim)',
                }}>
                  ${l}
                  <button
                    onClick=${() => setActiveLoci(prev => prev.filter(x => x !== l))}
                    style=${{
                      background: 'none', border: 'none', color: 'var(--text-muted)',
                      cursor: 'pointer', padding: '0', fontSize: '0.85rem', lineHeight: 1,
                    }}
                  >×</button>
                </span>
              `)}
              <button
                onClick=${() => setActiveLoci([])}
                style=${{
                  background: 'none', border: '1px solid var(--border-hi)',
                  borderRadius: '4px', color: 'var(--text-muted)',
                  padding: '0.15rem 0.45rem', fontSize: '0.75rem', cursor: 'pointer',
                }}
              >Clear all</button>
            </div>
          ` : null}
          <span style=${{
            marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem',
            fontStyle: 'italic',
          }}>
            Hover either plot to cross-highlight the same point in the other
          </span>
        </div>

        <!-- Dual-panel plots -->
        <div style=${{ flex: '1 1 0', minHeight: 0, padding: '8px', display: 'flex' }}>
          <${DualPlot}
            tracks=${tracks}
            masses=${selectedMasses}
            xAxis=${xAxis}
            yAxis=${yAxis}
            onXChange=${setXAxis}
            onYChange=${setYAxis}
            lociData=${lociData}
            activeLoci=${activeLoci}
            theme=${theme}
          />
        </div>

      ` : html`
        <div style=${{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-dim)',
        }}>
          ${!loadError ? 'Loading track data…' : ''}
        </div>
      `}

    </div>
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
