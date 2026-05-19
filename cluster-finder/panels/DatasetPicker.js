import { html } from '../html.js';
import { useStore, actions } from '../store.js';

export function DatasetPicker() {
  const manifest  = useStore((s) => s.manifest);
  const datasetId = useStore((s) => s.datasetId);
  const loading   = useStore((s) => s.loading);

  if (!manifest) return null;

  const onChange = (e) => {
    const id = e.target.value;
    const meta = manifest.datasets.find((d) => d.id === id);
    if (meta) actions.setDataset(id, meta);
  };

  return html`
    <select value=${datasetId || ''} onChange=${onChange} disabled=${loading}>
      ${manifest.datasets.map((d) => html`
        <option key=${d.id} value=${d.id}>${d.name}</option>
      `)}
    </select>
  `;
}
