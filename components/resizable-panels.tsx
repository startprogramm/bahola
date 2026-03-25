"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { cn } from "@/lib/utils";
import { GripVertical, PanelLeftOpen, PanelRightOpen } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PanelConfig {
  id: string;
  label: string;
  icon?: React.ElementType;
  minWidth?: number;
  defaultFlex?: number;
  content: ReactNode;
}

interface PanelState {
  id: string;
  flex: number;
  collapsed: boolean;
  prevFlex: number;
}

interface Props {
  panels: PanelConfig[];
  className?: string;
  storageKey?: string;
  gap?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_PANEL_PX = 80;
const HANDLE_HIT_AREA = 12; // hitbox for the resize handle
const COLLAPSED_WIDTH = 36;

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadLayout(key: string, panelIds: string[]): PanelState[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as {
      order: string[];
      states: Record<string, { flex: number; collapsed: boolean }>;
    };
    if (
      !saved.order ||
      saved.order.length !== panelIds.length ||
      !panelIds.every((id) => saved.order.includes(id))
    )
      return null;

    return saved.order.map((id) => {
      const s = saved.states[id];
      return {
        id,
        flex: s?.flex ?? 1,
        collapsed: s?.collapsed ?? false,
        prevFlex: s?.flex ?? 1,
      };
    });
  } catch {
    return null;
  }
}

function saveLayout(key: string, panels: PanelState[]) {
  if (typeof window === "undefined") return;
  try {
    const data = {
      order: panels.map((p) => p.id),
      states: Object.fromEntries(
        panels.map((p) => [
          p.id,
          { flex: p.collapsed ? p.prevFlex : p.flex, collapsed: p.collapsed },
        ])
      ),
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResizablePanelLayout({
  panels: panelConfigs,
  className,
  storageKey,
  gap = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ---- State ----

  const [panelStates, setPanelStates] = useState<PanelState[]>(() => {
    const ids = panelConfigs.map((p) => p.id);
    if (storageKey) {
      const saved = loadLayout(storageKey, ids);
      if (saved) return saved;
    }
    return panelConfigs.map((p) => ({
      id: p.id,
      flex: p.defaultFlex ?? 1,
      collapsed: false,
      prevFlex: p.defaultFlex ?? 1,
    }));
  });

  const [isResizing, setIsResizing] = useState(false);

  // We use refs to track mouse-move state so we don't need to re-attach
  // listeners on every state change.
  const resizeRef = useRef<{
    leftId: string;
    rightId: string;
    startX: number;
    leftStartFlex: number;
    rightStartFlex: number;
    totalPxWidth: number;
  } | null>(null);

  const dragRef = useRef<{
    draggingId: string;
    startX: number;
    currentX: number;
    panelRects: Map<string, DOMRect>;
  } | null>(null);
  const [dragDelta, setDragDelta] = useState<{ id: string; dx: number } | null>(null);

  // Keep a ref mirror of panelStates for use in event handlers (avoid stale closures)
  const panelStatesRef = useRef(panelStates);
  panelStatesRef.current = panelStates;

  // ---- Persist ----

  useEffect(() => {
    if (storageKey) saveLayout(storageKey, panelStates);
  }, [panelStates, storageKey]);

  // ---- Resize ----

  const handleResizeStart = useCallback((leftId: string, rightId: string, clientX: number) => {
    const container = containerRef.current;
    if (!container) return;

    const leftEl = container.querySelector(`[data-panel-id="${leftId}"]`) as HTMLElement | null;
    const rightEl = container.querySelector(`[data-panel-id="${rightId}"]`) as HTMLElement | null;
    if (!leftEl || !rightEl) return;

    const states = panelStatesRef.current;
    const leftState = states.find((p) => p.id === leftId);
    const rightState = states.find((p) => p.id === rightId);
    if (!leftState || !rightState) return;

    resizeRef.current = {
      leftId,
      rightId,
      startX: clientX,
      leftStartFlex: leftState.flex,
      rightStartFlex: rightState.flex,
      totalPxWidth: leftEl.offsetWidth + rightEl.offsetWidth,
    };
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (clientX: number) => {
      const r = resizeRef.current;
      if (!r) return;

      const delta = clientX - r.startX;
      const totalFlex = r.leftStartFlex + r.rightStartFlex;
      const pxPerFlex = r.totalPxWidth / totalFlex;
      const minFlex = MIN_PANEL_PX / pxPerFlex;

      let newLeft = r.leftStartFlex + delta / pxPerFlex;
      let newRight = totalFlex - newLeft;

      // Collapse if dragged past half the min threshold
      if (newLeft < minFlex * 0.5) {
        setPanelStates((prev) =>
          prev.map((p) => {
            if (p.id === r.leftId) return { ...p, collapsed: true, prevFlex: r.leftStartFlex };
            if (p.id === r.rightId) return { ...p, flex: totalFlex };
            return p;
          })
        );
        resizeRef.current = null;
        setIsResizing(false);
        return;
      }
      if (newRight < minFlex * 0.5) {
        setPanelStates((prev) =>
          prev.map((p) => {
            if (p.id === r.rightId) return { ...p, collapsed: true, prevFlex: r.rightStartFlex };
            if (p.id === r.leftId) return { ...p, flex: totalFlex };
            return p;
          })
        );
        resizeRef.current = null;
        setIsResizing(false);
        return;
      }

      // Clamp
      if (newLeft < minFlex) { newLeft = minFlex; newRight = totalFlex - newLeft; }
      if (newRight < minFlex) { newRight = minFlex; newLeft = totalFlex - newRight; }

      setPanelStates((prev) =>
        prev.map((p) => {
          if (p.id === r.leftId) return { ...p, flex: newLeft, prevFlex: newLeft };
          if (p.id === r.rightId) return { ...p, flex: newRight, prevFlex: newRight };
          return p;
        })
      );
    };

    const onMouseMove = (e: globalThis.MouseEvent) => { e.preventDefault(); onMove(e.clientX); };
    const onTouchMove = (e: globalThis.TouchEvent) => { if (e.touches.length === 1) onMove(e.touches[0].clientX); };
    const onEnd = () => { resizeRef.current = null; setIsResizing(false); };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [isResizing]);

  // ---- Drag reorder ----

  const startDrag = useCallback((panelId: string, clientX: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rects = new Map<string, DOMRect>();
    panelStatesRef.current.forEach((p) => {
      if (p.collapsed) return;
      const el = container.querySelector(`[data-panel-id="${p.id}"]`) as HTMLElement | null;
      if (el) rects.set(p.id, el.getBoundingClientRect());
    });

    dragRef.current = { draggingId: panelId, startX: clientX, currentX: clientX, panelRects: rects };
    setDragDelta({ id: panelId, dx: 0 });
  }, []);

  useEffect(() => {
    if (!dragDelta) return;

    const onMove = (clientX: number) => {
      const d = dragRef.current;
      if (!d) return;
      d.currentX = clientX;
      const dx = clientX - d.startX;
      setDragDelta({ id: d.draggingId, dx });
    };

    const onEnd = () => {
      const d = dragRef.current;
      if (!d) { setDragDelta(null); return; }

      const states = panelStatesRef.current;
      const visibleIds = states.filter((p) => !p.collapsed).map((p) => p.id);
      const dragIdx = visibleIds.indexOf(d.draggingId);
      const draggedRect = d.panelRects.get(d.draggingId);

      if (dragIdx !== -1 && draggedRect) {
        const dx = d.currentX - d.startX;
        const threshold = draggedRect.width * 0.35;

        let targetIdx = dragIdx;
        if (dx > threshold && dragIdx < visibleIds.length - 1) targetIdx = dragIdx + 1;
        else if (dx < -threshold && dragIdx > 0) targetIdx = dragIdx - 1;

        if (targetIdx !== dragIdx) {
          setPanelStates((prev) => {
            const arr = [...prev];
            const fromFull = arr.findIndex((p) => p.id === visibleIds[dragIdx]);
            const toFull = arr.findIndex((p) => p.id === visibleIds[targetIdx]);
            if (fromFull !== -1 && toFull !== -1) {
              const [moved] = arr.splice(fromFull, 1);
              // After splice, toFull may have shifted; re-find:
              const insertAt = arr.findIndex((p) => p.id === visibleIds[targetIdx]);
              if (insertAt !== -1) {
                // Insert before target if moving left, after if moving right
                arr.splice(targetIdx > dragIdx ? insertAt + 1 : insertAt, 0, moved);
              } else {
                arr.push(moved); // fallback
              }
            }
            return arr;
          });
        }
      }

      dragRef.current = null;
      setDragDelta(null);
    };

    const onMouseMove = (e: globalThis.MouseEvent) => { e.preventDefault(); onMove(e.clientX); };
    const onTouchMove = (e: globalThis.TouchEvent) => { if (e.touches.length === 1) onMove(e.touches[0].clientX); };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [dragDelta !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Expand ----

  const expandPanel = useCallback((panelId: string) => {
    setPanelStates((prev) => {
      const panel = prev.find((p) => p.id === panelId);
      if (!panel || !panel.collapsed) return prev;

      const visibleFlex = prev.filter((p) => !p.collapsed).reduce((s, p) => s + p.flex, 0);
      const restoreFlex = panel.prevFlex || 1;
      const shrink = visibleFlex / (visibleFlex + restoreFlex);

      return prev.map((p) => {
        if (p.id === panelId) return { ...p, collapsed: false, flex: restoreFlex };
        if (!p.collapsed) return { ...p, flex: p.flex * shrink, prevFlex: p.flex * shrink };
        return p;
      });
    });
  }, []);

  // ---- Build render items ----
  // We build a flat array of { type: 'panel' | 'collapsed' | 'handle' } items
  // to render in order, so collapsed pills appear in-line at their position.

  const configById = new Map(panelConfigs.map((c) => [c.id, c]));
  const visiblePanels = panelStates.filter((p) => !p.collapsed);
  const totalFlex = visiblePanels.reduce((s, p) => s + p.flex, 0);

  type RenderItem =
    | { type: "panel"; state: PanelState; config: PanelConfig; visibleIdx: number }
    | { type: "collapsed"; state: PanelState; config: PanelConfig; posIdx: number }
    | { type: "handle"; leftId: string; rightId: string };

  const items: RenderItem[] = [];
  let vIdx = 0;

  for (let i = 0; i < panelStates.length; i++) {
    const ps = panelStates[i];
    const config = configById.get(ps.id);
    if (!config) continue;

    if (ps.collapsed) {
      items.push({ type: "collapsed", state: ps, config, posIdx: i });
    } else {
      // Insert handle before this panel if it's not the first visible
      if (vIdx > 0) {
        // Find the previous visible panel id
        const prevVisible = visiblePanels[vIdx - 1];
        items.push({ type: "handle", leftId: prevVisible.id, rightId: ps.id });
      }
      items.push({ type: "panel", state: ps, config, visibleIdx: vIdx });
      vIdx++;
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full min-h-0 relative",
        (isResizing || dragDelta) && "select-none",
        className
      )}
      style={{ gap: `${gap}px` }}
    >
      {items.map((item) => {
        // ---- Collapsed pill ----
        if (item.type === "collapsed") {
          const { state: ps, config, posIdx } = item;
          const Icon = config.icon;
          const isFirst = posIdx === 0 || panelStates.slice(0, posIdx).every((p) => p.collapsed);
          const isLast =
            posIdx === panelStates.length - 1 ||
            panelStates.slice(posIdx + 1).every((p) => p.collapsed);

          return (
            <button
              key={`col-${ps.id}`}
              onClick={() => expandPanel(ps.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 shrink-0 rounded-xl border border-dashed",
                "bg-muted/40 hover:bg-muted/80 transition-all cursor-pointer group",
                "hover:border-primary/40 hover:shadow-sm"
              )}
              style={{ width: `${COLLAPSED_WIDTH}px` }}
              title={config.label}
            >
              {isFirst ? (
                <PanelLeftOpen className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              ) : isLast ? (
                <PanelRightOpen className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              ) : Icon ? (
                <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              ) : (
                <PanelLeftOpen className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              )}
              <span
                className="text-[9px] font-semibold text-muted-foreground group-hover:text-primary transition-colors max-h-24 overflow-hidden"
                style={{ writingMode: "vertical-lr", textOrientation: "mixed" }}
              >
                {config.label}
              </span>
            </button>
          );
        }

        // ---- Resize handle ----
        if (item.type === "handle") {
          const { leftId, rightId } = item;
          return (
            <div
              key={`handle-${leftId}-${rightId}`}
              className={cn(
                "shrink-0 flex items-center justify-center group/handle",
                "cursor-col-resize transition-colors rounded-full relative z-20"
              )}
              style={{ width: `${HANDLE_HIT_AREA + 2}px`, margin: `0 ${-HANDLE_HIT_AREA / 2 + 2}px` }}
              onMouseDown={(e: ReactMouseEvent) => {
                e.preventDefault();
                handleResizeStart(leftId, rightId, e.clientX);
              }}
              onTouchStart={(e: ReactTouchEvent) => {
                if (e.touches.length === 1) {
                  handleResizeStart(leftId, rightId, e.touches[0].clientX);
                }
              }}
            >
              <div
                className={cn(
                  "w-[6px] h-20 rounded-full border transition-all duration-150 shadow-sm",
                  "border-primary/35 bg-primary/30 group-hover/handle:bg-primary/50 group-hover/handle:border-primary/60",
                  "group-active/handle:bg-primary group-active/handle:border-primary",
                  isResizing &&
                    resizeRef.current?.leftId === leftId &&
                    "bg-primary border-primary"
                )}
              />
              <GripVertical
                className={cn(
                  "absolute h-3.5 w-3.5 text-primary/90 pointer-events-none",
                  isResizing &&
                    resizeRef.current?.leftId === leftId &&
                    "text-primary-foreground"
                )}
              />
            </div>
          );
        }

        // ---- Panel ----
        const { state: ps, config } = item;
        const isDragging = dragDelta?.id === ps.id;
        const transform = isDragging ? `translateX(${dragDelta.dx}px)` : undefined;

        // Drop indicator: highlight when another panel is dragged near this one
        let showDropIndicator = false;
        if (dragDelta && dragDelta.id !== ps.id && dragRef.current) {
          const myRect = dragRef.current.panelRects.get(ps.id);
          if (myRect) {
            const cx = dragRef.current.currentX;
            if (cx > myRect.left && cx < myRect.right) {
              showDropIndicator = true;
            }
          }
        }

        return (
          <div
            key={ps.id}
            data-panel-id={ps.id}
            className={cn(
              "min-h-0 min-w-0 relative overflow-hidden",
              isDragging && "z-30 opacity-80 shadow-2xl rounded-2xl",
              showDropIndicator && "ring-2 ring-primary/30 ring-inset rounded-2xl"
            )}
            style={{
              flex: `${ps.flex / totalFlex}`,
              transform,
              transition: isDragging ? "none" : "transform 200ms ease",
            }}
          >
            {/* Drag grip overlay at top center */}
            <div
              className={cn(
                "absolute top-2.5 left-1/2 -translate-x-1/2 z-20",
                "opacity-0 hover:opacity-100 focus-visible:opacity-100",
                "transition-opacity duration-150 cursor-grab active:cursor-grabbing",
                isDragging && "opacity-100"
              )}
              onMouseDown={(e: ReactMouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                startDrag(ps.id, e.clientX);
              }}
              onTouchStart={(e: ReactTouchEvent) => {
                if (e.touches.length === 1) {
                  e.stopPropagation();
                  startDrag(ps.id, e.touches[0].clientX);
                }
              }}
            >
              <div className="flex items-center px-2 py-1 rounded-md bg-muted/90 backdrop-blur-sm border shadow-sm">
                <GripVertical className="h-3 w-3 text-muted-foreground" />
              </div>
            </div>

            <div className={cn("h-full", (isResizing || dragDelta) && "pointer-events-none")}>{config.content}</div>
          </div>
        );
      })}
    </div>
  );
}
