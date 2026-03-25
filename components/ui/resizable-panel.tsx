"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";

interface ResizablePanelGroupProps {
  children: React.ReactNode;
  className?: string;
  direction?: "horizontal" | "vertical";
}

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsedSize?: number;
  className?: string;
  title?: string;
}

interface ResizableHandleProps {
  className?: string;
  withHandle?: boolean;
}

interface PanelConfig {
  defaultSize: number;
  minSize: number;
  maxSize: number;
  collapsible: boolean;
  collapsedSize: number;
  title?: string;
}

interface PanelContextValue {
  direction: "horizontal" | "vertical";
  sizes: number[];
  setSizes: React.Dispatch<React.SetStateAction<number[]>>;
  collapsedPanels: Set<number>;
  setCollapsedPanels: React.Dispatch<React.SetStateAction<Set<number>>>;
  previousSizes: React.MutableRefObject<number[]>;
  registerPanel: (index: number, config: PanelConfig) => void;
  panelConfigs: PanelConfig[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  expandPanel: (index: number) => void;
  collapsePanel: (index: number) => void;
}

const PanelContext = React.createContext<PanelContextValue | null>(null);

const COLLAPSE_THRESHOLD = 5; // Collapse when panel is dragged below 5%

export function ResizablePanelGroup({
  children,
  className,
  direction = "horizontal",
}: ResizablePanelGroupProps) {
  const [sizes, setSizes] = React.useState<number[]>([]);
  const [panelConfigs, setPanelConfigs] = React.useState<PanelConfig[]>([]);
  const [collapsedPanels, setCollapsedPanels] = React.useState<Set<number>>(new Set());
  const previousSizes = React.useRef<number[]>([]);
  const initialized = React.useRef(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const registerPanel = React.useCallback(
    (index: number, config: PanelConfig) => {
      if (!initialized.current) {
        setSizes((prev) => {
          const newSizes = [...prev];
          newSizes[index] = config.defaultSize;
          return newSizes;
        });
        setPanelConfigs((prev) => {
          const newConfigs = [...prev];
          newConfigs[index] = config;
          return newConfigs;
        });
      }
    },
    []
  );

  const expandPanel = React.useCallback((index: number) => {
    setCollapsedPanels((prev) => {
      const newSet = new Set(prev);
      newSet.delete(index);
      return newSet;
    });

    // Restore previous size
    setSizes((prev) => {
      const newSizes = [...prev];
      const prevSize = previousSizes.current[index] || panelConfigs[index]?.defaultSize || 33;
      const collapsedSize = panelConfigs[index]?.collapsedSize || 0;

      // Find adjacent non-collapsed panel to take space from
      let adjacentIndex = -1;
      for (let i = index + 1; i < newSizes.length; i++) {
        if (!collapsedPanels.has(i)) {
          adjacentIndex = i;
          break;
        }
      }
      if (adjacentIndex === -1) {
        for (let i = index - 1; i >= 0; i--) {
          if (!collapsedPanels.has(i)) {
            adjacentIndex = i;
            break;
          }
        }
      }

      if (adjacentIndex !== -1) {
        const spaceNeeded = prevSize - collapsedSize;
        newSizes[adjacentIndex] = Math.max(
          panelConfigs[adjacentIndex]?.minSize || 10,
          newSizes[adjacentIndex] - spaceNeeded
        );
      }

      newSizes[index] = prevSize;
      return newSizes;
    });
  }, [panelConfigs, collapsedPanels]);

  const collapsePanel = React.useCallback((index: number) => {
    // Save current size before collapsing
    previousSizes.current[index] = sizes[index];

    setCollapsedPanels((prev) => {
      const newSet = new Set(prev);
      newSet.add(index);
      return newSet;
    });

    setSizes((prev) => {
      const newSizes = [...prev];
      const collapsedSize = panelConfigs[index]?.collapsedSize || 0;
      const freedSpace = prev[index] - collapsedSize;

      // Give freed space to adjacent non-collapsed panel
      let adjacentIndex = -1;
      for (let i = index + 1; i < newSizes.length; i++) {
        if (!collapsedPanels.has(i)) {
          adjacentIndex = i;
          break;
        }
      }
      if (adjacentIndex === -1) {
        for (let i = index - 1; i >= 0; i--) {
          if (!collapsedPanels.has(i)) {
            adjacentIndex = i;
            break;
          }
        }
      }

      if (adjacentIndex !== -1) {
        newSizes[adjacentIndex] += freedSpace;
      }

      newSizes[index] = collapsedSize;
      return newSizes;
    });
  }, [sizes, panelConfigs, collapsedPanels]);

  React.useEffect(() => {
    initialized.current = true;
  }, []);

  return (
    <PanelContext.Provider value={{
      direction,
      sizes,
      setSizes,
      collapsedPanels,
      setCollapsedPanels,
      previousSizes,
      registerPanel,
      panelConfigs,
      containerRef,
      expandPanel,
      collapsePanel
    }}>
      <div
        ref={containerRef}
        className={cn(
          "flex h-full w-full",
          direction === "horizontal" ? "flex-row" : "flex-col",
          className
        )}
      >
        {children}
      </div>
    </PanelContext.Provider>
  );
}

export function ResizablePanel({
  children,
  defaultSize = 33,
  minSize = 10,
  maxSize = 80,
  collapsible = true,
  collapsedSize = 0,
  className,
  title,
}: ResizablePanelProps) {
  const context = React.useContext(PanelContext);
  const indexRef = React.useRef(-1);
  const panelRef = React.useRef<HTMLDivElement>(null);

  if (!context) {
    throw new Error("ResizablePanel must be used within ResizablePanelGroup");
  }

  const { direction, sizes, collapsedPanels, registerPanel, containerRef, expandPanel } = context;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !panelRef.current) return;

    const panels = container.querySelectorAll("[data-resizable-panel]");
    let myIndex = -1;
    panels.forEach((panel, i) => {
      if (panel === panelRef.current) {
        myIndex = i;
      }
    });

    if (myIndex >= 0 && indexRef.current !== myIndex) {
      indexRef.current = myIndex;
      registerPanel(myIndex, { defaultSize, minSize, maxSize, collapsible, collapsedSize, title });
    }
  }, [defaultSize, minSize, maxSize, collapsible, collapsedSize, title, registerPanel, containerRef]);

  const size = sizes[indexRef.current] ?? defaultSize;
  const isCollapsed = collapsedPanels.has(indexRef.current);

  const handleExpand = () => {
    if (isCollapsed) {
      expandPanel(indexRef.current);
    }
  };

  // Collapsed state - show a clickable bar
  if (isCollapsed) {
    return (
      <div
        ref={panelRef}
        data-resizable-panel
        data-collapsed="true"
        onClick={handleExpand}
        className={cn(
          "flex-shrink-0 cursor-pointer transition-all duration-300 group",
          "bg-muted/50 hover:bg-muted border-r last:border-r-0",
          direction === "horizontal" ? "w-8 h-full" : "h-8 w-full",
          className
        )}
      >
        <div className={cn(
          "h-full w-full flex items-center justify-center",
          "text-muted-foreground hover:text-foreground transition-colors"
        )}>
          <div className={cn(
            "flex items-center justify-center gap-1",
            direction === "horizontal" ? "flex-col" : "flex-row"
          )}>
            {direction === "horizontal" ? (
              <ChevronRight className="h-4 w-4 opacity-60 group-hover:opacity-100 transition-opacity" />
            ) : (
              <ChevronDown className="h-4 w-4 opacity-60 group-hover:opacity-100 transition-opacity" />
            )}
            {title && (
              <span className={cn(
                "text-xs font-medium truncate max-w-[80px]",
                direction === "horizontal" ? "writing-mode-vertical rotate-180" : ""
              )}
              style={direction === "horizontal" ? { writingMode: "vertical-rl" } : undefined}
              >
                {title}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      data-resizable-panel
      className={cn("overflow-auto transition-all duration-200", className)}
      style={{
        [direction === "horizontal" ? "width" : "height"]: `${size}%`,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

export function ResizableHandle({ className, withHandle = true }: ResizableHandleProps) {
  const context = React.useContext(PanelContext);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isHovered, setIsHovered] = React.useState(false);
  const handleRef = React.useRef<HTMLDivElement>(null);

  if (!context) {
    throw new Error("ResizableHandle must be used within ResizablePanelGroup");
  }

  const {
    direction,
    sizes,
    setSizes,
    collapsedPanels,
    setCollapsedPanels,
    previousSizes,
    panelConfigs,
    containerRef
  } = context;

  // Find which handle this is by counting previous handles in DOM
  const getHandleIndex = React.useCallback(() => {
    const container = containerRef.current;
    if (!container || !handleRef.current) return 0;

    const handles = container.querySelectorAll("[data-resizable-handle]");
    let myIndex = 0;
    handles.forEach((handle, i) => {
      if (handle === handleRef.current) {
        myIndex = i;
      }
    });
    return myIndex;
  }, [containerRef]);

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);

      // This handle is between panel[handleIndex] and panel[handleIndex + 1]
      const handleIndex = getHandleIndex();
      const leftPanelIndex = handleIndex;
      const rightPanelIndex = handleIndex + 1;

      const startPos = direction === "horizontal" ? e.clientX : e.clientY;
      const container = containerRef.current;

      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const containerSize = direction === "horizontal" ? containerRect.width : containerRect.height;
      const startSizes = [...sizes];

      // Check if adjacent panels are collapsed
      const leftCollapsed = collapsedPanels.has(leftPanelIndex);
      const rightCollapsed = collapsedPanels.has(rightPanelIndex);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentPos = direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
        const delta = ((currentPos - startPos) / containerSize) * 100;

        const newSizes = [...startSizes];

        const leftConfig = panelConfigs[leftPanelIndex] || { minSize: 10, maxSize: 80, collapsible: true, collapsedSize: 0 };
        const rightConfig = panelConfigs[rightPanelIndex] || { minSize: 10, maxSize: 80, collapsible: true, collapsedSize: 0 };

        let newLeftSize = startSizes[leftPanelIndex] + delta;
        let newRightSize = startSizes[rightPanelIndex] - delta;

        // Calculate total of other panels (not the two being resized)
        let otherPanelsTotal = 0;
        for (let i = 0; i < startSizes.length; i++) {
          if (i !== leftPanelIndex && i !== rightPanelIndex) {
            otherPanelsTotal += startSizes[i];
          }
        }
        const availableSpace = 100 - otherPanelsTotal;

        // Check for collapse triggers
        const shouldCollapseLeft = leftConfig.collapsible && !leftCollapsed && newLeftSize < COLLAPSE_THRESHOLD;
        const shouldCollapseRight = rightConfig.collapsible && !rightCollapsed && newRightSize < COLLAPSE_THRESHOLD;

        if (shouldCollapseLeft) {
          // Collapse left panel
          previousSizes.current[leftPanelIndex] = startSizes[leftPanelIndex];
          setCollapsedPanels(prev => {
            const newSet = new Set(prev);
            newSet.add(leftPanelIndex);
            return newSet;
          });
          newLeftSize = leftConfig.collapsedSize;
          newRightSize = availableSpace - newLeftSize;
        } else if (shouldCollapseRight) {
          // Collapse right panel
          previousSizes.current[rightPanelIndex] = startSizes[rightPanelIndex];
          setCollapsedPanels(prev => {
            const newSet = new Set(prev);
            newSet.add(rightPanelIndex);
            return newSet;
          });
          newRightSize = rightConfig.collapsedSize;
          newLeftSize = availableSpace - newRightSize;
        } else {
          // Normal resize with constraints
          if (!leftCollapsed && newLeftSize < leftConfig.minSize) {
            newLeftSize = leftConfig.minSize;
            newRightSize = availableSpace - newLeftSize;
          }
          if (!rightCollapsed && newRightSize < rightConfig.minSize) {
            newRightSize = rightConfig.minSize;
            newLeftSize = availableSpace - newRightSize;
          }

          // Cap at max sizes
          if (newLeftSize > availableSpace - (rightCollapsed ? rightConfig.collapsedSize : rightConfig.minSize)) {
            newLeftSize = availableSpace - (rightCollapsed ? rightConfig.collapsedSize : rightConfig.minSize);
            newRightSize = rightCollapsed ? rightConfig.collapsedSize : rightConfig.minSize;
          }
          if (newRightSize > availableSpace - (leftCollapsed ? leftConfig.collapsedSize : leftConfig.minSize)) {
            newRightSize = availableSpace - (leftCollapsed ? leftConfig.collapsedSize : leftConfig.minSize);
            newLeftSize = leftCollapsed ? leftConfig.collapsedSize : leftConfig.minSize;
          }
        }

        // Ensure we don't go below 0
        if (newLeftSize < 0) newLeftSize = 0;
        if (newRightSize < 0) newRightSize = 0;

        newSizes[leftPanelIndex] = newLeftSize;
        newSizes[rightPanelIndex] = newRightSize;
        setSizes(newSizes);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [direction, sizes, setSizes, collapsedPanels, setCollapsedPanels, previousSizes, panelConfigs, getHandleIndex, containerRef]
  );

  return (
    <div
      ref={handleRef}
      data-resizable-handle
      className={cn(
        "relative flex items-center justify-center transition-all duration-200 flex-shrink-0",
        direction === "horizontal"
          ? "w-3 cursor-col-resize group"
          : "h-3 cursor-row-resize group",
        className
      )}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Background line */}
      <div
        className={cn(
          "absolute transition-all duration-300",
          direction === "horizontal"
            ? "w-[2px] h-full"
            : "h-[2px] w-full",
          isDragging
            ? "bg-primary shadow-[0_0_15px_var(--glow),0_0_30px_var(--glow)]"
            : isHovered
              ? "bg-primary/60 shadow-[0_0_10px_var(--glow)]"
              : "bg-border"
        )}
      />

      {/* Fancy handle grip */}
      {withHandle && (
        <div
          className={cn(
            "relative z-10 flex items-center justify-center rounded-full transition-all duration-300",
            direction === "horizontal"
              ? "w-4 h-12"
              : "h-4 w-12",
            isDragging
              ? "bg-primary shadow-[0_0_20px_var(--glow)]"
              : isHovered
                ? "bg-primary/80 shadow-[0_0_15px_var(--glow)]"
                : "bg-muted hover:bg-primary/60"
          )}
        >
          {/* Grip dots */}
          <div
            className={cn(
              "flex gap-[2px]",
              direction === "horizontal" ? "flex-col" : "flex-row"
            )}
          >
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-full transition-all duration-300 w-1 h-1",
                  isDragging || isHovered
                    ? "bg-primary-foreground"
                    : "bg-muted-foreground/50"
                )}
              />
            ))}
          </div>
        </div>
      )}

      {/* Expanded hit area for easier grabbing */}
      <div
        className={cn(
          "absolute",
          direction === "horizontal"
            ? "w-6 h-full -left-[6px]"
            : "h-6 w-full -top-[6px]"
        )}
      />

      {/* Glow effect on edges when dragging */}
      {isDragging && (
        <>
          <div
            className={cn(
              "absolute pointer-events-none transition-opacity duration-300",
              direction === "horizontal"
                ? "w-8 h-full bg-gradient-to-r from-primary/20 via-transparent to-transparent -left-4"
                : "h-8 w-full bg-gradient-to-b from-primary/20 via-transparent to-transparent -top-4"
            )}
          />
          <div
            className={cn(
              "absolute pointer-events-none transition-opacity duration-300",
              direction === "horizontal"
                ? "w-8 h-full bg-gradient-to-l from-primary/20 via-transparent to-transparent -right-4"
                : "h-8 w-full bg-gradient-to-t from-primary/20 via-transparent to-transparent -bottom-4"
            )}
          />
        </>
      )}
    </div>
  );
}
