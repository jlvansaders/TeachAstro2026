// Theme utilities shared across all TeachAstro pages.
//
// Theme is stored in localStorage under 'ta-theme' ('dark' | 'light').
// Changing theme writes to localStorage, sets data-theme on <html>, and
// dispatches a 'ta-theme' CustomEvent so any React component using useTheme()
// re-renders automatically.

import { useState, useEffect } from 'react';

const KEY = 'ta-theme';

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'dark'; } catch { return 'dark'; }
}

export function setTheme(t) {
  try { localStorage.setItem(KEY, t); } catch {}
  document.documentElement.dataset.theme = t;
  window.dispatchEvent(new CustomEvent('ta-theme', { detail: t }));
}

export function useTheme() {
  const [theme, setLocal] = useState(getTheme);
  useEffect(() => {
    const handler = (e) => setLocal(e.detail);
    window.addEventListener('ta-theme', handler);
    return () => window.removeEventListener('ta-theme', handler);
  }, []);
  return [theme, setTheme];
}

// Returns Plotly-compatible color values for the given theme.
export function plotColors(theme) {
  const dark = theme !== 'light';
  return {
    paper_bgcolor:  dark ? '#0f1422' : '#ffffff',
    plot_bgcolor:   dark ? '#0f1422' : '#f8fafc',
    fontColor:      dark ? '#d4d8e0' : '#1e293b',
    gridColor:      dark ? '#1d2637' : '#dde3ec',
    zeroColor:      dark ? '#2a3246' : '#c4ccd8',
    axis3dBg:       dark ? '#0f1422' : '#e8edf5',
    axis3dColor:    dark ? '#d4d8e0' : '#1e293b',
    // Data series — chosen for contrast on each background
    starColor:        dark ? '#7dd3fc'               : '#1d6fa8',
    isoColor:         dark ? '#fbbf24'               : '#c2410c',
    // Three isochrone trace colors
    isoColors: dark
      ? ['#fbbf24', '#4ade80', '#f472b6']
      : ['#c2410c', '#15803d', '#7c3aed'],
    // Cluster-finder scatter / histogram
    selectedColor:    dark ? 'rgba(125,211,252,0.95)' : 'rgba(14,100,200,0.90)',
    unselectedColor:  dark ? 'rgba(120,130,150,0.35)' : 'rgba(80,100,140,0.45)',
    bgColor3d:        dark ? 'rgba(120,130,150,0.18)' : 'rgba(40,60,110,0.50)',
    histAllColor:     dark ? 'rgba(120,130,150,0.55)' : 'rgba(80,100,140,0.55)',
    histSelColor:     dark ? 'rgba(125,211,252,0.85)' : 'rgba(14,100,200,0.85)',
  };
}
