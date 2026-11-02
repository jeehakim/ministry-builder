import type { ImageRef } from "@ministry/schema";
import { ImageField } from "../components/ImageField";
import { TextField } from "../components/Field";
import { btnCls, iconBtnCls, inputCls, labelCls } from "../components/ui";
import type { FieldSpec, Obj } from "./fields";

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isImageRef(v: unknown): v is ImageRef {
  return isObj(v) && typeof v.src === "string";
}

function withKey(obj: Obj, key: string, value: unknown): Obj {
  if (value === undefined) {
    const { [key]: _removed, ...rest } = obj;
    return rest;
  }
  return { ...obj, [key]: value };
}

/** Renders the fields described by `fields` for the object `value`. Fully controlled and immutable. */
export function FieldsForm(props: { value: Obj; fields: FieldSpec[]; onChange: (next: Obj) => void }) {
  const { value, fields, onChange } = props;
  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <FieldView key={field.key} field={field} value={value} onChange={onChange} />
      ))}
    </div>
  );
}

function FieldView({ field, value, onChange }: { field: FieldSpec; value: Obj; onChange: (next: Obj) => void }) {
  const current = value[field.key];

  switch (field.kind) {
    case "text":
      return (
        <TextField
          label={field.label}
          value={str(current)}
          multiline={field.multiline}
          placeholder={field.placeholder}
          onChange={(text) => onChange(withKey(value, field.key, field.optional && text === "" ? undefined : text))}
        />
      );

    case "image":
      return (
        <ImageField
          label={field.label}
          value={isImageRef(current) ? current : undefined}
          onChange={(image) => onChange(withKey(value, field.key, image))}
        />
      );

    case "link": {
      if (!isObj(current)) {
        return (
          <div>
            <button type="button" className={btnCls} onClick={() => onChange(withKey(value, field.key, { ...field.blank }))}>
              + Add {field.label}
            </button>
          </div>
        );
      }
      return (
        <fieldset className="rounded-md border border-slate-200 p-2">
          <legend className="px-1 text-xs font-medium text-slate-600 capitalize">{field.label}</legend>
          <div className="grid grid-cols-2 gap-2">
            <input
              aria-label={`${field.label} label`}
              className={inputCls}
              placeholder="Label"
              value={str(current.label)}
              onChange={(e) => onChange(withKey(value, field.key, { ...current, label: e.target.value }))}
            />
            <input
              aria-label={`${field.label} link`}
              className={inputCls}
              placeholder="https://... or #section"
              value={str(current.href)}
              onChange={(e) => onChange(withKey(value, field.key, { ...current, href: e.target.value }))}
            />
          </div>
          <button type="button" className={`${btnCls} mt-2`} onClick={() => onChange(withKey(value, field.key, undefined))}>
            Remove {field.label}
          </button>
        </fieldset>
      );
    }

    case "list": {
      const items = Array.isArray(current) ? current.filter(isObj) : [];
      const setItems = (next: Obj[]) => onChange(withKey(value, field.key, next));
      const move = (index: number, dir: -1 | 1) => {
        const target = index + dir;
        const a = items[index];
        const b = items[target];
        if (!a || !b) return;
        const next = [...items];
        next[index] = b;
        next[target] = a;
        setItems(next);
      };
      return (
        <div>
          <span className={labelCls}>{field.label}</span>
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li key={index} className="rounded-md border border-slate-200 bg-slate-50/60 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-700">
                    {str(item[field.titleKey]) || `${field.itemLabel} ${index + 1}`}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className={iconBtnCls}
                      aria-label={`Move ${field.itemLabel.toLowerCase()} ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={iconBtnCls}
                      aria-label={`Move ${field.itemLabel.toLowerCase()} ${index + 1} down`}
                      disabled={index === items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={iconBtnCls}
                      aria-label={`Delete ${field.itemLabel.toLowerCase()} ${index + 1}`}
                      onClick={() => setItems(items.filter((_, i) => i !== index))}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <FieldsForm
                  value={item}
                  fields={field.fields}
                  onChange={(next) => setItems(items.map((it, i) => (i === index ? next : it)))}
                />
              </li>
            ))}
          </ul>
          <button type="button" className={`${btnCls} mt-2`} onClick={() => setItems([...items, { ...field.blank }])}>
            + Add {field.itemLabel.toLowerCase()}
          </button>
        </div>
      );
    }
  }
}
