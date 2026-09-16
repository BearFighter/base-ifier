/** Project-wide edge shape for bases whose size preset does not imply one. */
import { useAppStore } from '@/state/project';
import { PROFILE_CHOICES, profileId } from '@/model/defaults';
import { Field } from '@/ui/common/Field';

export function DefaultEdges() {
  const profile = useAppStore((s) => s.project.defaultProfile);
  const setDefaultProfile = useAppStore((s) => s.setDefaultProfile);
  const id = profileId(profile);
  return (
    <Field label="Edge shape for new bases" help="Sizes picked from a game's list use that game's style automatically (Games Workshop sizes get the slight bevel, Kings of War sizes get flat sides). This is for custom sizes, and can be changed per base in the Bases tab.">
      <select value={id} onChange={(e) => { const c = PROFILE_CHOICES.find((x) => x.id === e.target.value); if (c) setDefaultProfile(c.profile); }}>
        {PROFILE_CHOICES.map((c) => <option key={c.id} value={c.id} title={c.help}>{c.label}</option>)}
        {id === 'custom' && <option value="custom">Custom</option>}
      </select>
    </Field>
  );
}
