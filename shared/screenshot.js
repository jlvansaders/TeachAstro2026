// Takes a PNG screenshot of the full page and downloads it.
// Uses html-to-image via dynamic import so no importmap entry is needed.

export async function takeScreenshot(filename) {
  const { toPng } = await import('https://esm.sh/html-to-image@1.11.11');
  const node = document.getElementById('root');
  const dataUrl = await toPng(node, { pixelRatio: 2 });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// Returns a filename like "TeachAstro-TrackExplorer-2026-05-14.png"
export function screenshotFilename(appName) {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return `TeachAstro-${appName}-${date}.png`;
}
