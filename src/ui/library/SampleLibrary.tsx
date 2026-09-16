/**
 * Dev-server convenience: the One Page Rules "S - Bases" set that ships next to
 * the app is served by Vite from the project root, so it can be loaded with a
 * click instead of the folder picker. Only rendered in `npm run dev`.
 */
import { useState } from 'react';
import { useAppStore } from '@/state/project';

const SAMPLES: string[] = [
  'S_Base_Square_20mm_1.stl',
  'S_Base_Square_25mm_1.stl',
  'S_Base_Square_30mm_1.stl',
  'S_Base_Square_40mm_1.stl',
  'S_Base_Square_50mm_1.stl',
  'S_Base_Square_50mm_25mm_1.stl',
  'S_Base_Square_60mm_30mm_1.stl',
  'S_Base_Square_60mm_40mm_1.stl',
  'S_Base_Square_75mm_50mm_1.stl',
  'S_Base_Square_100mm_50mm_1.stl',
  'S_Base_Square_100mm_60mm_1.stl',
  'S_Base_Square_150mm_100mm_1.stl',
  'S_Base_Round_25mm_1.stl',
  'S_Base_Round_32mm_1.stl',
  'S_Base_Round_40mm_1.stl',
  'S_Base_Round_50mm_1.stl',
  'S_Base_Round_60mm_1.stl',
  'S_Base_Round_60mm_35mm_1.stl',
  'S_Base_Round_75mm_46mm_1.stl',
  'S_Base_Round_90mm_52mm_1.stl',
  'S_Base_Round_105mm_70mm_1.stl',
  'S_Base_Round_120mm_92mm_1.stl',
];

const BASE_PATH = '/S - Bases/STL/';

export function SampleLibrary() {
  const loadSourceFile = useAppStore((s) => s.loadSourceFile);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  if (!import.meta.env.DEV) return null;

  async function load(name: string) {
    setBusy(name);
    try {
      const res = await fetch(encodeURI(BASE_PATH + name));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      await loadSourceFile(new File([blob], name, { type: 'model/stl' }));
    } catch (e) {
      useAppStore.setState({ lastError: `Could not load sample ${name}: ${String(e)}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sample-library">
      <button type="button" className="section-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Sample bases (One Page Rules set)
      </button>
      {open && (
        <ul className="sample-list">
          {SAMPLES.map((n) => (
            <li key={n}>
              <button type="button" disabled={busy !== null} onClick={() => void load(n)} title={n}>
                {busy === n ? '…' : n.replace(/^S_Base_/, '').replace(/_1\.stl$/, '').replace(/_/g, ' ')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
