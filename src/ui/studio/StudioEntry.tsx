/** Scene tab card: open Base Studio for a new scene, or re-open a saved one. */
import { useAppStore } from '@/state/project';

export function StudioEntry() {
  const openStudio = useAppStore((s) => s.openStudio);
  const scenes = useAppStore((s) => s.project.studio);
  const list = Object.values(scenes ?? {});
  return (
    <div className="studio-entry">
      <div className="panel-subtitle">Or make your own scene</div>
      <p className="muted">
        Base Studio raises ground from a genre preset (ruins, swamp, sci-fi deck…) and strews it with rocks, rubble and
        plating. The finished scene comes back here to be cut like any STL.
      </p>
      <button type="button" className="primary" onClick={() => openStudio()}>
        Make a scene in Base Studio
      </button>
      {list.length > 0 && (
        <ul>
          {list.map((d) => (
            <li key={d.id}>
              <button type="button" className="link-button" onClick={() => openStudio({ docId: d.id })}>
                {d.name}
              </button>{' '}
              <span className="muted">
                {d.board.shape.w} × {d.board.shape.d} mm{d.props.length ? ` · ${d.props.length} props` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
