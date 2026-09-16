/** A short plain-language explanation line, hidden when help is switched off. */
import React from 'react';
import { useAppStore } from '@/state/project';

export function Hint({ children }: { children: React.ReactNode }) {
  const showHelp = useAppStore((s) => s.view.showHelp);
  if (!showHelp) return null;
  return (
    <div className="hint">
      <span className="hint-icon" aria-hidden="true">
        ⓘ
      </span>
      <span>{children}</span>
    </div>
  );
}
