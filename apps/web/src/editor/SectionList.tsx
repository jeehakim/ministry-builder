import { useState } from "react";
import { SECTION_TYPES, type Section, type SectionType } from "@ministry/schema";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SECTION_LABELS } from "./fields";
import { SECTION_HINTS, SECTION_ICONS } from "./sectionMeta";

export function sectionTitle(s: Section): string {
  const heading = "heading" in s ? s.heading : "";
  return heading || SECTION_LABELS[s.type];
}

type Props = {
  sections: Section[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onReorder: (id: string, overId: string) => void;
  onToggleHidden: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (type: SectionType) => void;
  /** Editing a translation: selecting still works, but adding, hiding, moving and deleting do not. */
  locked?: boolean;
};

export function SectionList(props: Props) {
  const { sections, selectedId, onSelect, onMove, onReorder, onToggleHidden, onDelete, onAdd, locked = false } = props;
  const [pendingDelete, setPendingDelete] = useState<Section | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const over = e.over;
    if (over && e.active.id !== over.id) onReorder(String(e.active.id), String(over.id));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sections</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={locked}>
              <Plus />
              Add
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {SECTION_TYPES.map((t) => {
              const Icon = SECTION_ICONS[t];
              return (
                <DropdownMenuItem key={t} onSelect={() => onAdd(t)}>
                  <Icon />
                  <span className="flex flex-col">
                    <span>{SECTION_LABELS[t]}</span>
                    <span className="text-xs text-muted-foreground">{SECTION_HINTS[t]}</span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {sections.map((s, i) => (
              <Row
                key={s.id}
                section={s}
                index={i}
                count={sections.length}
                locked={locked}
                selected={s.id === selectedId}
                onSelect={() => onSelect(s.id)}
                onMove={(dir) => onMove(s.id, dir)}
                onToggleHidden={() => onToggleHidden(s.id)}
                onDelete={() => setPendingDelete(s)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No sections yet. Add one to get started.
        </p>
      ) : null}

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this section?</DialogTitle>
            <DialogDescription>
              “{pendingDelete ? sectionTitle(pendingDelete) : ""}” and its content will be removed from the page. You can add a new one later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              <Trash2 />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row(props: {
  section: Section;
  index: number;
  count: number;
  locked: boolean;
  selected: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const { section: s, index, count, locked, selected, onSelect, onMove, onToggleHidden, onDelete } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const Icon = SECTION_ICONS[s.type];
  const title = sectionTitle(s);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1 rounded-lg border bg-card pr-1 transition-colors",
        selected ? "border-brand/40 bg-brand-soft/60 shadow-xs" : "border-transparent hover:bg-muted/60",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Drag to reorder ${title}`}
        disabled={locked}
        className="flex h-10 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground/60 outline-none hover:text-foreground focus-visible:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md",
            selected ? "bg-brand text-white" : "bg-muted text-muted-foreground",
            s.hidden && "opacity-50",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className={cn("block truncate text-sm font-medium", s.hidden && "text-muted-foreground line-through")}>{title}</span>
          <span className="block text-[11px] text-muted-foreground">
            {SECTION_LABELS[s.type]}
            {s.hidden ? " · hidden" : ""}
          </span>
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${s.hidden ? "Show" : "Hide"} ${title}`}
            aria-pressed={s.hidden}
            disabled={locked}
            onClick={onToggleHidden}
            className={cn("text-muted-foreground", !s.hidden && "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}
          >
            {s.hidden ? <EyeOff /> : <Eye />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{s.hidden ? "Show on page" : "Hide from page"}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${title}`} disabled={locked} className="text-muted-foreground">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
            <ArrowUp />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
            <ArrowDown />
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleHidden}>
            {s.hidden ? <Eye /> : <EyeOff />}
            {s.hidden ? "Show" : "Hide"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
