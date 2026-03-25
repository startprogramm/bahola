"use client";

import { useCallback, useEffect, useRef } from "react";

// Lazy-load canvas-confetti — only loaded when a celebration fires
let confettiFn: any = null;
const getConfetti = async () => {
  if (!confettiFn) {
    const mod = await import("canvas-confetti");
    confettiFn = mod.default;
  }
  return confettiFn;
};

interface ConfettiOptions {
  particleCount?: number;
  spread?: number;
  startVelocity?: number;
  decay?: number;
  gravity?: number;
  colors?: string[];
  origin?: { x: number; y: number };
  angle?: number;
}

export function useConfetti() {
  const confettiRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (confettiRef.current) {
        confettiRef.current.reset();
      }
    };
  }, []);

  const fire = useCallback(async (options?: ConfettiOptions) => {
    const c = await getConfetti();
    c({
      particleCount: 100,
      spread: 70,
      startVelocity: 30,
      decay: 0.95,
      gravity: 1,
      colors: ["#ff0080", "#00ffff", "#ffff00", "#ff00ff", "#00ff00"],
      origin: { x: 0.5, y: 0.5 },
      ...options,
    });
  }, []);

  const fireSchoolPride = useCallback(async () => {
    const c = await getConfetti();
    const end = Date.now() + 3000;
    const colors = ["#3b82f6", "#8b5cf6", "#ec4899"];

    (function frame() {
      c({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 }, colors });
      c({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, []);

  const fireStars = useCallback(async () => {
    const c = await getConfetti();
    const defaults = {
      spread: 360, ticks: 100, gravity: 0, decay: 0.94, startVelocity: 30,
      colors: ["#FFE400", "#FFBD00", "#E89400", "#FFCA6C", "#FDFFB8"],
    };

    function shoot() {
      c({ ...defaults, particleCount: 40, scalar: 1.2, shapes: ["star"] });
      c({ ...defaults, particleCount: 10, scalar: 0.75, shapes: ["circle"] });
    }

    setTimeout(shoot, 0);
    setTimeout(shoot, 100);
    setTimeout(shoot, 200);
  }, []);

  const fireRealistic = useCallback(async () => {
    const c = await getConfetti();
    const count = 200;
    const defaults = { origin: { y: 0.7 } };

    function burst(ratio: number, opts: any) {
      c({ ...defaults, ...opts, particleCount: Math.floor(count * ratio) });
    }

    burst(0.25, { spread: 26, startVelocity: 55 });
    burst(0.2, { spread: 60 });
    burst(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    burst(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    burst(0.1, { spread: 120, startVelocity: 45 });
  }, []);

  const fireSideCannons = useCallback(async () => {
    const c = await getConfetti();
    const end = Date.now() + 1000;

    (function frame() {
      c({ particleCount: 2, angle: 60, spread: 55, origin: { x: 0, y: 0.8 }, colors: ["#ff0080", "#00ffff", "#ffff00"] });
      c({ particleCount: 2, angle: 120, spread: 55, origin: { x: 1, y: 0.8 }, colors: ["#ff0080", "#00ffff", "#ffff00"] });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, []);

  const fireEmoji = useCallback(async (emoji: string = "🎉") => {
    const c = await getConfetti();
    const scalar = 2;
    const emojiShape = c.shapeFromText({ text: emoji, scalar });
    const defaults = {
      spread: 360, ticks: 60, gravity: 0.5, decay: 0.96,
      startVelocity: 20, shapes: [emojiShape], scalar,
    };

    function shoot() {
      c({ ...defaults, particleCount: 30 });
      c({ ...defaults, particleCount: 5, flat: true });
    }

    setTimeout(shoot, 0);
    setTimeout(shoot, 100);
    setTimeout(shoot, 200);
  }, []);

  return { fire, fireSchoolPride, fireStars, fireRealistic, fireSideCannons, fireEmoji };
}

// Component version for easy use
interface ConfettiButtonProps {
  children: React.ReactNode;
  type?: "default" | "stars" | "realistic" | "schoolPride" | "sideCannons";
  onClick?: () => void;
  className?: string;
}

export function ConfettiTrigger({ children, type = "default", onClick, className }: ConfettiButtonProps) {
  const { fire, fireStars, fireRealistic, fireSchoolPride, fireSideCannons } = useConfetti();

  const handleClick = () => {
    switch (type) {
      case "stars": fireStars(); break;
      case "realistic": fireRealistic(); break;
      case "schoolPride": fireSchoolPride(); break;
      case "sideCannons": fireSideCannons(); break;
      default: fire();
    }
    onClick?.();
  };

  return (
    <div onClick={handleClick} className={className}>
      {children}
    </div>
  );
}
