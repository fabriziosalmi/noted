import { describe, it, expect, vi, afterEach } from 'vitest';
import { attachImage } from './imageAttach';

const original = window.electronAPI;
afterEach(() => { window.electronAPI = original; });

const png = () => new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' });
const withApi = (saveAttachment: unknown) => { window.electronAPI = { ...original, saveAttachment } as unknown as typeof window.electronAPI; };

describe('attachImage', () => {
  it('stores the bytes through the app and returns the relative path, passing folder and vault', async () => {
    const save = vi.fn().mockResolvedValue({ success: true, data: 'attachments/abc.png' });
    withApi(save);
    const out = await attachImage(png(), { folder: 'Pics', syncDir: '/v' });
    expect(out).toEqual({ src: 'attachments/abc.png', stored: true });
    const [bytes, folder, dir] = save.mock.calls[0];
    expect(Array.from(bytes as Uint8Array)).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect([folder, dir]).toEqual(['Pics', '/v']);
  });

  it('uses the default folder when none is configured', async () => {
    const save = vi.fn().mockResolvedValue({ success: true, data: 'attachments/x.png' });
    withApi(save);
    await attachImage(png(), {});
    expect(save.mock.calls[0][1]).toBe('attachments');
  });

  it('surfaces the app\'s reason when the image cannot be stored (and never embeds it silently)', async () => {
    withApi(vi.fn().mockResolvedValue({ success: false, error: 'Image is too large (25 MB maximum)' }));
    await expect(attachImage(png(), {})).rejects.toThrow('Image is too large');
  });

  it('falls back to a data URI only where there is no app backend', async () => {
    window.electronAPI = { ...original, saveAttachment: undefined } as unknown as typeof window.electronAPI;
    const out = await attachImage(png(), {});
    expect(out.stored).toBe(false);
    expect(out.src.startsWith('data:image/png;base64,')).toBe(true);
  });
});
