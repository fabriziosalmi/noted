export type RendererElectronApi = Window['electronAPI'];

export function getElectronApi(): RendererElectronApi | null {
  if (typeof window === 'undefined') return null;
  return window.electronAPI ?? null;
}
