// Shared URL hash schema — the portable cluster-selection state that flows
// between apps (cluster-finder → track-overplotter).
//
// Only encodeState / decodeState live here.  Each app's own url.js adds
// readFromHash / writeToHash / shareableLink so it can include app-specific
// fields (e.g. track parameters in track-overplotter) on top of this base.
//
// Schema v1 fields:
//   d   — datasetId  (string)
//   pm  — pmSelection ({ kind, x, y } | { kind, xs, ys } | null)
//   pl  — plxRange   ([min, max] | null)
//   ab  — cmdAbsolute (0 | 1)

import lz from 'lz-string';

export const SCHEMA_VERSION = 1;

export function encodeState(s) {
  const payload = {
    v:  SCHEMA_VERSION,
    d:  s.datasetId   ?? null,
    pm: s.pmSelection ?? null,
    pl: s.plxRange    ?? null,
    ab: s.cmdAbsolute ? 1 : 0,
  };
  return lz.compressToEncodedURIComponent(JSON.stringify(payload));
}

// Returns the base cluster-selection fields, or null if the token is absent /
// malformed / from an incompatible version.
// App-specific fields (track params etc.) are decoded by each app's own url.js.
export function decodeState(token) {
  if (!token) return null;
  try {
    const json = lz.decompressFromEncodedURIComponent(token);
    if (!json) return null;
    const obj = JSON.parse(json);
    if (!obj || obj.v !== SCHEMA_VERSION) return null;
    return {
      datasetId:   obj.d  ?? null,
      pmSelection: obj.pm ?? null,
      plxRange:    obj.pl ?? null,
      cmdAbsolute: !!obj.ab,
    };
  } catch (err) {
    console.warn('[TeachAstro] bad session token', err);
    return null;
  }
}
