/** API the desktop app (Electron preload) exposes to the page; absent in a browser. */
export interface DesktopBridge {
  /** Renders the page with the print stylesheet into a PDF the user saves via a dialog. */
  savePdf(defaultName: string): Promise<{ saved: boolean; path?: string }>;
}

declare global {
  interface Window {
    dcvr?: DesktopBridge;
  }
}

/**
 * Exports the print view as PDF: a save dialog in the desktop app, the
 * browser's print dialog ("Save as PDF") otherwise.
 */
export async function exportPdf(defaultName: string): Promise<void> {
  if (window.dcvr) {
    await window.dcvr.savePdf(defaultName);
  } else {
    window.print();
  }
}
