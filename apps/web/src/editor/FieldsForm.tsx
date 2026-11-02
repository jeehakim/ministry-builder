import type { ImageRef } from "@ministry/schema";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Link2, Plus, Trash2, X } from "lucide-react";
import { ImageField } from "../components/ImageField";
import { TextField } from "../components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
export function FieldsForm(props: {
  value: Obj;
  fields: FieldSpec[];
  onChange: (next: Obj) => void;
  /** Section type such as "hero"; when set, text fields get AI rewrite buttons that know where the text lives. */
  sectionType?: string;
}) {
  const { value, fields, onChange, sectionType } = props;
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <FieldView key={field.key} field={field} value={value} onChange={onChange} sectionType={sectionType} />
      ))}
    </div>
  );
}

function FieldView({
  field,
  value,
  onChange,
  sectionType,
}: {
  field: FieldSpec;
  value: Obj;
  onChange: (next: Obj) => void;
  sectionType?: string;
}) {
  const current = value[field.key];
  const reduced = useReducedMotion();

  switch (field.kind) {
    case "text":
      return (
        <TextField
          label={field.label}
          value={str(current)}
          multiline={field.multiline}
          placeholder={field.placeholder}
          assist={sectionType ? { context: `${sectionType} ${field.label}` } : undefined}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start border-dashed text-muted-foreground"
            onClick={() => onChange(withKey(value, field.key, { ...field.blank }))}
          >
            <Plus />
            Add {field.label}
          </Button>
        );
      }
      return (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground capitalize">
              <Link2 className="size-3.5" aria-hidden="true" />
              {field.label}
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${field.label}`}
              onClick={() => onChange(withKey(value, field.key, undefined))}
            >
              <X />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label={`${field.label} label`}
              placeholder="Label"
              value={str(current.label)}
              onChange={(e) => onChange(withKey(value, field.key, { ...current, label: e.target.value }))}
            />
            <Input
              aria-label={`${field.label} link`}
              placeholder="https://… or #section"
              value={str(current.href)}
              onChange={(e) => onChange(withKey(value, field.key, { ...current, href: e.target.value }))}
            />
          </div>
        </div>
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              {field.label}
              {items.length ? <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{items.length}</span> : null}
            </Label>
            <Button type="button" variant="outline" size="xs" onClick={() => setItems([...items, { ...field.blank }])}>
              <Plus />
              {field.itemLabel}
            </Button>
          </div>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {items.map((item, index) => (
                <motion.li
                  key={index}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.16 }}
                  className="rounded-lg border bg-card p-2.5 shadow-xs"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {str(item[field.titleKey]) || `${field.itemLabel} ${index + 1}`}
                    </span>
                    <span className="flex shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Move ${field.itemLabel.toLowerCase()} ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Move ${field.itemLabel.toLowerCase()} ${index + 1} down`}
                        disabled={index === items.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${field.itemLabel.toLowerCase()} ${index + 1}`}
                        onClick={() => setItems(items.filter((_, i) => i !== index))}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  </div>
                  <FieldsForm
                    value={item}
                    fields={field.fields}
                    sectionType={sectionType}
                    onChange={(next) => setItems(items.map((it, i) => (i === index ? next : it)))}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              No {field.label.toLowerCase()} yet.
            </p>
          ) : null}
        </div>
      );
    }
  }
}
