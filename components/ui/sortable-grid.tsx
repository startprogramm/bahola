"use client";

import React, { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SortableItem {
  id: string;
}

interface SortableGridProps<T extends SortableItem> {
  items: T[];
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number, isDragging: boolean) => React.ReactNode;
  className?: string;
  columns?: number;
  gap?: number;
}

function SortableGridItem<T extends SortableItem>({
  item,
  index,
  renderItem,
}: {
  item: T;
  index: number;
  renderItem: (item: T, index: number, isDragging: boolean) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative aspect-[3/4]"
      {...attributes}
    >
      {renderItem(item, index, isDragging)}
      {/* Drag handle at bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 h-7 bg-black/60 flex items-center justify-center gap-1.5 cursor-grab active:cursor-grabbing touch-none rounded-b-lg"
        {...listeners}
      >
        <GripHorizontal className="h-3.5 w-3.5 text-white/80" />
        <span className="text-[10px] text-white/80 font-medium">{index + 1}</span>
      </div>
    </div>
  );
}

export function SortableGrid<T extends SortableItem>({
  items,
  onReorder,
  renderItem,
  className,
}: SortableGridProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;
  const activeIndex = activeId ? items.findIndex((i) => i.id === activeId) : -1;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      onReorder(arrayMove(items, oldIndex, newIndex));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div className={cn("grid grid-cols-2 sm:grid-cols-3 gap-4", className)}>
          {items.map((item, index) => (
            <SortableGridItem
              key={item.id}
              item={item}
              index={index}
              renderItem={renderItem}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeItem ? (
          <div className="relative aspect-[3/4] cursor-grabbing opacity-90 shadow-2xl rounded-lg">
            {renderItem(activeItem, activeIndex, true)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
