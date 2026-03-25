export async function exportChartAsPNG(container: HTMLElement, filename: string) {
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(container, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const a = document.createElement("a");
  a.download = filename + ".png";
  a.href = canvas.toDataURL("image/png");
  a.click();
}

export function exportDataAsExcel(type: string) {
  window.location.href = `/api/director/export?type=${type}`;
}

export function printAsPDF() {
  window.print();
}
