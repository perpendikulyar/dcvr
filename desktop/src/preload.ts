import { contextBridge, ipcRenderer } from 'electron';

// The only API the page gets from the desktop app; see web/src/desktop.ts.
contextBridge.exposeInMainWorld('dcvr', {
  savePdf: (defaultName: string): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke('save-pdf', String(defaultName)),
});
