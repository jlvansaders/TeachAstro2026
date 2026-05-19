// Cluster-finder URL hash helper.
// Imports portable encode/decode from shared/, then adds the window-specific
// helpers (readFromHash, writeToHash, shareableLink) and a convenience
// function for handing off to the track-overplotter.

import { encodeState, decodeState } from '../shared/url.js';

export { encodeState, decodeState };

export function readFromHash() {
  const h = window.location.hash.replace(/^#/, '');
  if (!h) return null;
  return decodeState(h);
}

export function writeToHash(s) {
  const token = encodeState(s);
  // replaceState avoids flooding browser history on every selection nudge.
  const url = new URL(window.location.href);
  url.hash = token;
  window.history.replaceState(null, '', url.toString());
}

export function shareableLink(s) {
  const token = encodeState(s);
  const url = new URL(window.location.href);
  url.hash = token;
  return url.toString();
}

// Link pointing at track-overplotter with the current cluster selection
// pre-loaded.  The overplotter calls decodeState(hash) on boot and gets
// the same datasetId / pmSelection / plxRange without any extra wiring.
export function overplotterLink(s) {
  const token = encodeState(s);
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/cluster-finder(\/.*)?$/, '/track-overplotter/');
  url.hash = token;
  return url.toString();
}
