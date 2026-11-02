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
}) {
  const { label, value, onChange, multiline, placeholder, hint, assist } = props;
  const id = useId();
  const { ai } = useAi();
  const labelEl = (
    <Label htmlFor={id} className="text-xs text-muted-foreground">
      {label}
    </Label>
  );
  return (
    <div className="space-y-1.5">
      {assist && ai ? (
        <div className="flex min-h-6 items-center justify-between gap-2">
          {labelEl}
          <AiAssist label={label} value={value} context={assist.context} onApply={onChange} />
        </div>
      ) : (
        labelEl
      )}
      {multiline ? (
        <Textarea
          id={id}
          className="min-h-24 resize-y"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {props.label}
      </Label>
      <Select value={props.value} onValueChange={props.onChange}>
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
