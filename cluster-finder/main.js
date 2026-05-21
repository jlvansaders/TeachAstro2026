// Root React component + bootstrap.

import { useEffect, Component } from 'react';
import { html } from './html.js';
import { createRoot } from 'react-dom/client';
import { takeScreenshot, screenshotFilename } from '../shared/screenshot.js';

// ErrorBoundary catches render errors inside the component tree and shows
// them in-page (with .booted present) so the window error handler doesn't
// replace the root with the generic "failed to start" message.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(err) { return { error: err }; }
  componentDidCatch(err, info) {
    console.error('[TeachAstro] Render error:', err, info.componentStack);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error;
      return html`
        <div className="booted" style=${{ padding: '2rem', color: '#fca5a5' }}>
          <h2 style=${{ marginBottom: '0.5rem' }}>Render error</h2>
          <pre style=${{ whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>${e.stack || e.message}</pre>
        </div>`;
    }
    return this.props.children;
  }
}

import { useStore, actions, getState, setState } from './store.js';
import { loadManifest, loadDataset } from './data.js';
import { readFromHash, writeToHash, shareableLink, overplotterLink } from './url.js';
import { useTheme } from '../shared/theme.js';

import { PM2DPanel } from './panels/PM2DPanel.js';
import { PM3DPanel } from './panels/PM3DPanel.js';
import { ParallaxPanel } from './panels/ParallaxPanel.js';
import { CMDPanel } from './panels/CMDPanel.js';
import { StatsPanel } from './panels/StatsPanel.js';
import { DatasetPicker } from './panels/DatasetPicker.js';

// Full-screen cluster picker shown before any data is loaded.
function ClusterPickerScreen() {
  const manifest = useStore((s) => s.manifest);
  const [theme, setTheme] = useTheme();

  return html`
    <div className="booted cluster-picker">
      <div className="cp-topbar">
        <img src="../shared/logo.png" alt="TeachAstro" className="cp-logo" />
        <div className="cp-topbar-right">
          <button className="cp-btn" onClick=${() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            ${theme === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
          <a href="../" className="cp-btn cp-btn-link">← Home</a>
        </div>
      </div>
      <div className="cp-body">
        <img src="../shared/logo.png" alt="TeachAstro" className="cp-hero-logo" />
        <h1 className="cp-heading">Choose a star cluster</h1>
        <p className="cp-sub">Select a dataset to begin exploring Gaia stellar data.</p>
        ${manifest && (() => {
          const START    = ['Pleiades', 'M37', 'M67', 'NGC752', 'Hyades'];
          const ADVANCED = ['NGC188', 'NGC2158', 'NGC6633', 'NGC6791', 'NGC6819'];
          const byId     = Object.fromEntries(manifest.datasets.map(d => [d.id, d]));
          const group = (ids, label) => html`
            <div className="cp-group" key=${label}>
              <h2 className="cp-group-label">${label}</h2>
              <div className="cp-grid">
                ${ids.filter(id => byId[id]).map(id => { const d = byId[id]; return html`
                  <button key=${d.id} className="cp-card"
                    onClick=${() => actions.chooseCluster(d.id, d)}>
                    <div className="cp-card-name">${d.name}</div>
                    ${d.note && html`<div className="cp-card-note">${d.note}</div>`}
                  </button>
                `;})}
              </div>
            </div>
          `;
          return html`
            <div className="cp-groups">
              ${group(START,    'Start here')}
              ${group(ADVANCED, 'More challenging')}
            </div>
          `;
        })()}
      </div>
    </div>
  `;
}

function App() {
  // Individual selectors return stable primitives/references so that
  // useSyncExternalStore doesn't see a "new" snapshot on every render.
  const manifest      = useStore((s) => s.manifest);
  const clusterChosen = useStore((s) => s.clusterChosen);
  const datasetId     = useStore((s) => s.datasetId);
  const loading       = useStore((s) => s.loading);
  const error         = useStore((s) => s.error);
  const linkFeedback  = useStore((s) => s.linkFeedback);
  const [theme, setTheme] = useTheme();
  const pmSelection   = useStore((s) => s.pmSelection);
  const plxRange      = useStore((s) => s.plxRange);
  const cmdAbsolute   = useStore((s) => s.cmdAbsolute);

  // Load manifest once on mount.  If the URL hash already encodes a dataset
  // (bookmarked / shared link) skip the picker and restore directly.
  // Otherwise leave clusterChosen=false so the picker is shown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await loadManifest();
        if (cancelled) return;

        const restored = readFromHash();

        if (restored?.datasetId) {
          // Restore from URL hash — skip the picker entirely.
          const pickMeta = m.datasets.find((d) => d.id === restored.datasetId) || m.datasets[0];
          setState({
            manifest: m,
            clusterChosen: true,
            datasetId: pickMeta?.id ?? null,
            datasetMeta: pickMeta ?? null,
            loading: !!pickMeta,
            error: null,
            data: null,
            pmSelection: restored.pmSelection ?? null,
            plxRange: restored.plxRange ?? null,
            cmdAbsolute: !!restored.cmdAbsolute,
          });
        } else {
          // No URL hash — show the cluster picker.
          setState({ manifest: m, clusterChosen: false });
        }
      } catch (err) {
        if (!cancelled) actions.setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Whenever the active dataset id changes, (re)fetch its data.
  useEffect(() => {
    if (!datasetId || !manifest) return;
    const meta = manifest.datasets.find((d) => d.id === datasetId);
    if (!meta) return;
    let cancelled = false;
    (async () => {
      try {
        const dataset = await loadDataset(meta);
        if (!cancelled) actions.setData(dataset);
      } catch (err) {
        if (!cancelled) actions.setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [datasetId, manifest]);

  // Keep URL hash in sync with state whenever the sharable slice changes.
  // Skip until the manifest is loaded so we don't clobber a hash on first render.
  useEffect(() => {
    if (!manifest) return;
    writeToHash(getState());
  }, [manifest, datasetId, pmSelection, plxRange, cmdAbsolute]);

  const onCopyLink = async () => {
    try {
      const link = shareableLink(getState());
      await navigator.clipboard.writeText(link);
      actions.flashLinkFeedback('Copied!');
    } catch {
      actions.flashLinkFeedback('Copy failed');
    }
  };

  // Show cluster picker until the user (or a URL hash) has chosen a dataset.
  if (!clusterChosen) return html`<${ClusterPickerScreen} />`;

  return html`
    <div className="booted" style=${{display:'contents'}}>
      <header className="topbar">
        <h1 style=${{display:'flex',alignItems:'center',gap:'0.5rem',lineHeight:'1'}}>
          <img src="../shared/logo.png" alt="TeachAstro" style=${{height:'32px',width:'auto',display:'block'}}/>
          <span style=${{color:'#94a3b8',fontWeight:400,fontSize:'0.95rem'}}>· Open-cluster explorer</span>
        </h1>
        <span className="subtitle">
          ${error ? html`<span style=${{color:'#fca5a5'}}>${error}</span>`
            : loading ? 'Loading dataset…'
            : manifest ? null
            : 'Initialising…'}
        </span>
        <div className="spacer"></div>
        <${DatasetPicker} />
        <button onClick=${() => actions.resetSelection()}
          disabled=${!pmSelection && !plxRange}>Reset selection</button>
        <button onClick=${() => takeScreenshot(screenshotFilename('ClusterFinder'))}>Screenshot</button>
        <button onClick=${() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          ${theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
        <button onClick=${onCopyLink}>Copy link</button>
        <span className="link-feedback">${linkFeedback}</span>
        <a href=${overplotterLink(getState())}
           style=${{
             display: 'inline-block',
             background: '#0ea5e9', color: '#fff',
             padding: '0.35rem 0.85rem', borderRadius: '4px',
             fontSize: '0.85rem', textDecoration: 'none', fontWeight: 500,
           }}>
          Send to overplotter →
        </a>
        <a href="../" style=${{ color: '#7dd3fc', fontSize: '0.85rem' }}>← Home</a>
      </header>

      <main className="workspace">
        <${PM2DPanel} />
        <${PM3DPanel} />
        <${ParallaxPanel} />
        <${CMDPanel} />
        <${StatsPanel} />
      </main>
    </div>
  `;
}

// Mount — wrapped in ErrorBoundary so render errors appear in-page with
// a useful message rather than a blank screen.
const root = createRoot(document.getElementById('root'));
root.render(html`<${ErrorBoundary}><${App} /><//>`);
