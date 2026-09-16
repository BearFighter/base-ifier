/**
 * The short guide shown until a base is loaded (and in the Base tab).
 */
import { useAppStore } from '@/state/project';

const STEPS: { title: string; text: string }[] = [
  { title: 'Load a scene', text: 'Drop an STL file anywhere on the window, or pick one from the sample list. The scene is the big sculpted base you will cut from.' },
  {
    title: 'Choose what you are making',
    text: 'Use the Multibase / Diorama / Single base switch at the top of the controls. Multibase: place a unit frame (e.g. a Kings of War troop) and cut bases inside it. Diorama: cut the bases you need and keep all the leftover material as extra bases. Single base: cut one base topper.',
  },
  { title: 'Place your bases', text: 'Pick sizes from the lists above the view, or type them. Drag to move, drag corners to resize. Nothing is cut yet, so try things freely.' },
  { title: 'Base-ify', text: 'Press the big orange button. Every base is cut out, magnet slots go underneath (3 × 2 mm unless you change them), and you can preview each one before downloading from the Export tab.' },
];

export function GettingStarted() {
  const showHelp = useAppStore((s) => s.view.showHelp);
  if (!showHelp) return null;
  return (
    <div className="getting-started">
      <div className="getting-started-title">How it works</div>
      <ol className="getting-started-steps">
        {STEPS.map((s, i) => (
          <li key={i}><strong>{s.title}.</strong> {s.text}</li>
        ))}
      </ol>
    </div>
  );
}

export function HowItWorks() {
  const showHelp = useAppStore((s) => s.view.showHelp);
  if (!showHelp) return null;
  return (
    <div className="how-it-works">
      <h2>Base-ifier</h2>
      <p className="how-it-works-lead">Turn one great sculpted slab into the bases you actually need. No spells required.</p>
      <ol className="getting-started-steps">
        {STEPS.map((s, i) => (
          <li key={i}><strong>{s.title}.</strong> {s.text}</li>
        ))}
      </ol>
      <p className="how-it-works-foot">Start by dropping an STL here or choosing a sample in the Scene tab on the left.</p>
    </div>
  );
}
