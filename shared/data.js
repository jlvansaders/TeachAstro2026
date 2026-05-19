// Shared cluster-data loader.
//
// `basePath` is the URL prefix for the data directory, resolved relative to
// the HTML document that loaded the app (e.g. './data' or '../cluster-finder/data').
// Each app passes its own basePath so this module works from any directory.
//
// Uses the browser's built-in DecompressionStream for gzip, then a
// hand-rolled line-oriented parser that's ~5× faster on this data shape
// than Papa Parse without adding a library dependency.

const NUMERIC_COLS = ['Plx', 'pmRA', 'pmDE', 'Gmag', 'BP-RP'];
const STRING_COLS  = [];

export async function loadManifest(basePath = './data') {
  const resp = await fetch(`${basePath}/manifest.json`);
  if (!resp.ok) throw new Error(`manifest.json: HTTP ${resp.status}`);
  return await resp.json();
}

export async function loadDataset(meta, basePath = './data') {
  const resp = await fetch(`${basePath}/${meta.file}`);
  if (!resp.ok) throw new Error(`${meta.file}: HTTP ${resp.status}`);

  // Decompress the gzip stream in the browser.  Works in Chrome, Firefox,
  // Safari >= 16.4.
  const ds     = new DecompressionStream('gzip');
  const stream = resp.body.pipeThrough(ds);
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');

  const chunks = [];
  let totalLen = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }
  const buf = decoder.decode(concatChunks(chunks, totalLen));

  const lines = buf.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) throw new Error(`${meta.file}: empty`);

  const header       = lines[0].split(',');
  const colByName    = new Map(header.map((c, i) => [c, i]));

  for (const c of [...NUMERIC_COLS, ...STRING_COLS]) {
    if (!colByName.has(c))
      throw new Error(`${meta.file}: missing column "${c}" (header: ${header.join(', ')})`);
  }

  const nRows  = lines.length - 1;
  const numeric = {};
  for (const c of NUMERIC_COLS) numeric[c] = new Float32Array(nRows);

  const numIdx = NUMERIC_COLS.map((c) => colByName.get(c));

  for (let r = 0; r < nRows; r++) {
    const parts = lines[r + 1].split(',');
    for (let j = 0; j < NUMERIC_COLS.length; j++) {
      const raw = parts[numIdx[j]];
      numeric[NUMERIC_COLS[j]][r] = (raw === '' || raw === undefined) ? NaN : +raw;
    }
  }

  return {
    meta,
    n: nRows,
    columns: {
      plx:   numeric['Plx'],
      pmra:  numeric['pmRA'],
      pmdec: numeric['pmDE'],
      g:     numeric['Gmag'],
      bpRp:  numeric['BP-RP'],
    },
  };
}

function concatChunks(chunks, totalLen) {
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
