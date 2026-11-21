import { describe, expect, it } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { removeUnplayableMedia } from '@/lib/edit/unplayable-media';

const box = { left: 100, top: 100, width: 500, height: 281, rotate: 0 };
const el = (o: Record<string, unknown>) => ({ ...box, ...o }) as unknown as PPTElement;

describe('media a slide can never show', () => {
  it('drops an unplanned video (invented URL or ref) and unplanned generated images', () => {
    const elements = [
      el({ id: 't', type: 'text', content: '<p>光合作用方程式</p>' }),
      el({ id: 'v1', type: 'video', src: 'https://example.com/photosynthesis.mp4' }),
      el({ id: 'v2', type: 'video', mediaRef: '<VIDEO_MEDIA_REF_FROM_ASSIGNED_MEDIA>' }),
      el({ id: 'v3', type: 'video', src: 'photosynthesis.mp4' }),
      el({ id: 'i1', type: 'image', src: 'gen_img_9' }),
      el({ id: 'i2', type: 'image', src: '/api/assets/leaf.png' }),
    ];
    expect(removeUnplayableMedia(elements).map((e) => e.id)).toEqual(['t', 'i2']);
  });
  it('keeps planned generated media and embedded videos', () => {
    const planned = [
      { type: 'video', elementId: 'gen_vid_1' },
      { type: 'image', elementId: 'gen_img_1' },
    ];
    const elements = [
      el({ id: 'v1', type: 'video', mediaRef: 'gen_vid_1' }),
      el({ id: 'v2', type: 'video', src: 'data:video/mp4;base64,AAAA' }),
      el({ id: 'i1', type: 'image', src: 'gen_img_1' }),
    ];
    expect(removeUnplayableMedia(elements, planned)).toBe(elements);
    // An invented local path is dropped too.
    expect(
      removeUnplayableMedia([el({ id: 'v3', type: 'video', src: '/videos/gradient.mp4' })]),
    ).toEqual([]);
  });
});
