function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function lightenColor(color: string, amount = 0.14) {
  const value = color.trim();

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    const full = raw.length === 3
      ? raw.split("").map((c) => c + c).join("")
      : raw;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return rgbToHex(
      r + (255 - r) * amount,
      g + (255 - g) * amount,
      b + (255 - b) * amount
    );
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b, a] = rgb[1].split(",").map((part) => Number(part.trim()));
    const next = [
      clampChannel(r + (255 - r) * amount),
      clampChannel(g + (255 - g) * amount),
      clampChannel(b + (255 - b) * amount),
    ];
    return Number.isFinite(a)
      ? `rgba(${next[0]}, ${next[1]}, ${next[2]}, ${a})`
      : `rgb(${next[0]}, ${next[1]}, ${next[2]})`;
  }

  return color;
}
