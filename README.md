# TeachAstro 2026 — Open-cluster explorer (Part 2)

An interactive web app for identifying open clusters from Gaia DR3
astrometry.  Students lasso the co-moving clump in proper-motion space,
refine by parallax, and inspect the resulting color–magnitude diagram.
Part 1 (stellar model explorer) will plug isochrones into the CMD panel
once it's built.

## Repository layout

```
TeachAstro2026/
├── Pleiades.vot                   # raw VizieR export (Gaia DR3, 3° radius)
├── Hyades.vot
├── scripts/
│   └── vot_to_csv.py              # one-shot: .vot → gzipped CSV
├── app/
│   ├── index.html                 # entry point (importmap + script tag)
│   ├── main.js                    # React root
│   ├── store.js                   # observable state + mask computation
│   ├── data.js                    # CSV fetch + columnar TypedArray parse
│   ├── url.js                     # shareable-link encoding (lz-string)
│   ├── styles.css
│   ├── panels/
│   │   ├── Plot.js                # minimal Plotly/React wrapper
│   │   ├── PM2DPanel.js           # 2D proper-motion scatter (primary select)
│   │   ├── PM3DPanel.js           # 3D pmRA × pmDec × Plx view
│   │   ├── ParallaxPanel.js       # histogram with drag-to-select range
│   │   ├── CMDPanel.js            # color–magnitude diagram + isochrone hook
│   │   ├── StatsPanel.js          # live mean/median/σ readout
│   │   └── DatasetPicker.js
│   └── data/
│       ├── manifest.json
│       ├── Pleiades.csv.gz        # ~10 MB, 222 k stars
│       └── Hyades.csv.gz          # ~9 MB, 204 k stars
└── README.md
```

## Running the app locally

There is no build step.  The app is plain ES modules loaded through an
importmap; React and Plotly are fetched from esm.sh in the browser at
runtime.  To view it, serve the folder over HTTP (opening the HTML as
`file://` will fail due to browser CORS/module rules):

```bash
# from the project root:
python3 -m http.server 8000
# then open http://localhost:8000/app/
```

Any static HTTP server works (`npx serve`, `caddy file-server`, etc.).

## Adding a new cluster

1. Export the cluster's Gaia DR3 data from VizieR as a VOTable.
   Minimum columns to request (under "Add position" and "Output columns"):
   `_RAJ2000`, `_DEJ2000`, `DR3Name`, `Plx`, `e_Plx`, `pmRA`, `e_pmRA`,
   `pmDE`, `e_pmDE`, `Gmag`, `BPmag`, `RPmag`, `BP-RP`.
2. Drop the `.vot` file in the project root.
3. Convert it:

   ```bash
   python3 scripts/vot_to_csv.py MyCluster.vot app/data/MyCluster.csv.gz
   ```
4. Add an entry to `app/data/manifest.json`:

   ```json
   { "id": "mycluster", "name": "My Cluster",
     "file": "MyCluster.csv.gz",
     "center": { "ra_deg": 123.45, "dec_deg": -6.78 } }
   ```

The app will pick it up on next load.

## Deploying

Upload the entire `app/` directory to any static host — Netlify, Vercel,
GitHub Pages, S3, etc.  No server-side code, no backend database.

```bash
# Example: Vercel CLI, from inside app/
vercel --prod
```

Sessions are encoded in the URL hash, so students share their selection by
copying the link.  No accounts, no database, no persistence beyond what's
in the URL.

## Interactive workflow

1. Pick a cluster from the top bar.
2. On the **Proper motion** panel, drag a box (or pick "Lasso" from the
   Plotly toolbar) around the tight clump of co-moving stars.
3. Watch the **3D view** highlight the same stars in pmRA × pmDec ×
   parallax space — cluster members sit in a tight 3D blob.
4. If helpful, drag horizontally across the **Parallax** histogram to
   tighten the parallax range around the cluster's peak.
5. The **CMD** panel now shows only the selected stars.  Toggle
   "absolute" to convert G to M_G using the mean parallax of the
   selection (isochrone fits will work best in absolute magnitudes).
6. The **Stats** sidebar shows live means, medians, σ's, and the mean
   distance (in pc, from mean parallax).
7. Click **Copy link** to save the session; the URL is self-contained.

## Known limitations / future work

- The 3D scatter is view-only.  Plotly doesn't support box/lasso
  selection in 3D; we could bolt on deck.gl if true 3D lasso becomes
  a must-have.
- The isochrone overlay hook in `CMDPanel` accepts an `overlays` prop
  (array of Plotly traces) but no isochrones are wired in yet — that's
  Part 1's job.
- Large CSVs (>30 MB gzipped) will start to feel the browser's memory
  and parse cost.  Converting to Apache Arrow / Parquet in the browser
  via DuckDB-WASM would scale further if needed.
- CDN dependency: if esm.sh is unreachable, the app won't load.
  Libraries can be vendored into `app/vendor/` and the importmap
  rewritten to point at them if offline use becomes important.

## Conversion notes

`scripts/vot_to_csv.py` stream-parses the VOTable with `lxml.iterparse`
so memory stays flat regardless of input size.  It picks the primary
`I_355_gaiadr3` table, drops rows missing core astrometry (RA, Dec,
parallax, or proper motions), and rounds numeric values to
measurement-sensible precision to keep the CSV small.
