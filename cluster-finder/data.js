// Thin wrapper — binds the shared data loader to this app's data directory.
// Panels and main.js import from './data.js' (or '../data.js') as before;
// the basePath './data' resolves relative to cluster-finder/index.html.
import { loadManifest as _loadManifest, loadDataset as _loadDataset } from '../shared/data.js';

export const loadManifest = ()      => _loadManifest('./data');
export const loadDataset  = (meta)  => _loadDataset(meta, './data');
