import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAi } from "../editor/AiContext";
import { AiAssist } from "./AiAssist";

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  /** Adds an AI rewrite button. `context` tells the model where the text lives, e.g. "hero Heading". */
  assist?: { context: string };
  /** Shows the value but does not let it change (and hides the AI button). */
  disabled?: boolean;
  /** When the field is empty, shows "Write this with AI →" inside it; clicking opens Ask AI prefilled. */
  ghost?: () => void;
}) {
  const { label, value, onChange, multiline, placeholder, hint, assist, disabled, ghost } = props;
  const id = useId();
  const { ai, enabled } = useAi();
  const showGhost = ghost !== undefined && enabled && !disabled && value.trim() === "";
  const ghostButton = showGhost ? (
    <button
      type="button"
      onClick={ghost}
      aria-label={`Write ${label} with AI`}
      className={`absolute left-2.5 ${multiline ? "top-2" : "top-1/2 -translate-y-1/2"} rounded px-0.5 text-xs text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none`}
    >
      Write this with AI →
    </button>
  ) : null;
  const labelEl = (
    <Label htmlFor={id} className="text-xs text-muted-foreground">
      {label}
    </Label>
  );
  return (
    <div className="space-y-1.5">
      {assist && ai && !disabled ? (
        <div className="flex min-h-6 items-center justify-between gap-2">
          {labelEl}
          <AiAssist label={label} value={value} context={assist.context} onApply={onChange} />
        </div>
      ) : (
        labelEl
      )}
      <div className="relative">
        {multiline ? (
          <Textarea
            id={id}
            className="min-h-24 resize-y"
            value={value}
            placeholder={showGhost ? undefined : placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input id={id} value={value} placeholder={showGhost ? undefined : placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        )}
        {ghostButton}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      <Select value={props.value} onValueChange={props.onChange} disabled={props.disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField(props: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${props.label} picker`}
          className="size-8 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          value={HEX.test(props.value) ? props.value : "#000000"}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <Input id={id} className="font-mono text-xs uppercase" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      </div>
    </div>
  );
}
