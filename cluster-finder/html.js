// Re-export the shared htm binding so panels can keep importing from '../html.js'
// without knowing about the shared/ directory.
export { html } from '../shared/html.js';
