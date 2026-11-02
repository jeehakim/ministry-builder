import { useState } from "react";
import { SECTION_TYPES, type Section, type SectionType } from "@ministry/schema";
import { btnCls, iconBtnCls, inputCls, smallBtnCls } from "../components/ui";
import { SECTION_LABELS } from "./fields";

function sectionTitle(s: Section): string {
  const heading = "heading" in s ? s.heading : "";
  return heading || SECTION_LABELS[s.type];
}

export function SectionList(props: {
  sections: Section[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onToggleHidden: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (type: SectionType) => void;
}) {
  const { sections, selectedId, onSelect, onMove, onToggleHidden, onDelete, onAdd } = props;
  const [newType, setNewType] = useState<SectionType>("programs");

  return (
    <div>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200 bg-white">
        {sections.map((s, i) => {
          const selected = s.id === selectedId;
          return (
            <li key={s.id} className={`flex items-center gap-1 p-1.5 ${selected ? "bg-sky-50" : ""}`}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(s.id)}
                className="min-w-0 flex-1 rounded px-1.5 py-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-sky-600"
              >
                <span className={`block truncate font-medium ${s.hidden ? "text-slate-400 line-through" : "text-slate-900"}`}>
                  {sectionTitle(s)}
                </span>
                <span className="block text-xs text-slate-500">
                  {SECTION_LABELS[s.type]}
                  {s.hidden ? " · hidden" : ""}
                </span>
              </button>
              <button
                type="button"
                className={iconBtnCls}
                aria-label={`Move ${sectionTitle(s)} up`}
                disabled={i === 0}
                onClick={() => onMove(s.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={iconBtnCls}
                aria-label={`Move ${sectionTitle(s)} down`}
                disabled={i === sections.length - 1}
                onClick={() => onMove(s.id, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className={smallBtnCls}
                aria-label={`${s.hidden ? "Show" : "Hide"} ${sectionTitle(s)}`}
                aria-pressed={s.hidden}
                onClick={() => onToggleHidden(s.id)}
              >
                {s.hidden ? "Show" : "Hide"}
              </button>
              <button
                type="button"
                className={iconBtnCls}
                aria-label={`Delete ${sectionTitle(s)}`}
                onClick={() => {
                  if (window.confirm(`Delete the "${sectionTitle(s)}" section?`)) onDelete(s.id);
                }}
              >
                ✕
              </button>
            </li>
          );
        })}
        {sections.length === 0 ? <li className="p-3 text-sm text-slate-500">No sections yet.</li> : null}
      </ul>

      <div className="mt-2 flex gap-2">
        <select
          aria-label="Section type to add"
          className={inputCls}
          value={newType}
          onChange={(e) => {
            const picked = SECTION_TYPES.find((t) => t === e.target.value);
            if (picked) setNewType(picked);
          }}
        >
          {SECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {SECTION_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="button" className={`${btnCls} shrink-0`} onClick={() => onAdd(newType)}>
          Add section
        </button>
      </div>
    </div>
  );
}
