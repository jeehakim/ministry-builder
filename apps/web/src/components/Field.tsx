import type { ReactNode } from "react";
import { inputCls, labelCls } from "./ui";

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const { label, value, onChange, multiline, placeholder, hint } = props;
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {multiline ? (
        <textarea
          className={`${inputCls} min-h-24 resize-y`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{props.label}</span>
      <select className={inputCls} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span className={labelCls}>{props.label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${props.label} picker`}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
          value={HEX.test(props.value) ? props.value : "#000000"}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <input
          aria-label={`${props.label} value`}
          className={inputCls}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
