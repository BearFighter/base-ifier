/**
 * Shared "one setting, plainly explained" building blocks for the side panels.
 *
 * - `Field` is a label + control + (optional) one-line explanation. The
 *   explanation is always available as a tooltip, and is also shown inline
 *   under the control when the user has help turned on (`view.showHelp`).
 * - `Section` groups a few related fields under a heading, optionally
 *   collapsible.
 * - `Details` is a thin wrapper around `<details>` for technical/advanced
 *   information that should stay out of the way by default.
 */
import React, { useState } from 'react';
import { useAppStore } from '@/state/project';

export function Field({
  label,
  help,
  unit,
  children,
}: {
  label: string;
  help?: string;
  unit?: string;
  children: React.ReactNode;
}) {
  const showHelp = useAppStore((s) => s.view.showHelp);
  return (
    <div className="field" title={help}>
      <div className="field-label">
        {label}
        {unit ? <span className="field-unit"> ({unit})</span> : null}
      </div>
      <div className="field-control">{children}</div>
      {showHelp && help && <div className="help">{help}</div>}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  collapsed,
  children,
}: {
  title: string;
  subtitle?: string;
  collapsed?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="section">
      <button type="button" className="section-header" onClick={() => setOpen((o) => !o)}>
        <span className="section-toggle-icon">{open ? '▾' : '▸'}</span>
        <span className="section-title">{title}</span>
      </button>
      {open && (
        <div className="section-body">
          {subtitle && <div className="section-subtitle">{subtitle}</div>}
          {children}
        </div>
      )}
    </div>
  );
}

export function Details({
  summary,
  defaultOpen,
  children,
}: {
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="details" open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="details-body">{children}</div>
    </details>
  );
}
