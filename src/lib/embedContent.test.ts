import { describe, it, expect } from 'vitest';
import { embedHtml, isImageTarget, imageSize } from './embedContent';

const NOTE = '<h1>Plan</h1><p>intro</p><h2>Budget</h2><p>money</p><h3>Detail</h3><p>fine print</p><h2>Risks</h2>'
  + '<p>a risk ^r1</p><ul><li><p>one ^item</p></li><li><p>two</p></li></ul><h1>Next</h1><p>after</p>';

describe('embedHtml', () => {
  it('is the whole note without a heading or a block', () => {
    expect(embedHtml(NOTE, {})).toContain('<h1>Next</h1>');
  });

  it('a heading embeds its section, sub-sections included, up to the next heading as high', () => {
    const html = embedHtml(NOTE, { heading: 'budget' });
    expect(html).toContain('<h2>Budget</h2>');
    expect(html).toContain('fine print');
    expect(html).not.toContain('Risks');
    expect(html).not.toContain('intro');
  });

  it('the last section of a note runs to its end', () => {
    expect(embedHtml(NOTE, { heading: 'Next' })).toBe('<h1>Next</h1><p>after</p>');
  });

  it('a block embeds that block, without its id', () => {
    expect(embedHtml(NOTE, { block: 'r1' })).toBe('<p>a risk</p>');
  });

  it('a block inside a list is that item alone', () => {
    const html = embedHtml(NOTE, { block: 'item' }) ?? '';
    expect(html).toContain('one');
    expect(html).not.toContain('two');
    expect(html).not.toContain('^item');
  });

  it('is null for a heading or block that is not there', () => {
    expect(embedHtml(NOTE, { heading: 'Missing' })).toBeNull();
    expect(embedHtml(NOTE, { block: 'nope' })).toBeNull();
  });

  it('never lets a script through', () => {
    const html = embedHtml('<p>hi</p><script>alert(1)</script><img src=x onerror="alert(2)">', {}) ?? '';
    expect(html).not.toMatch(/<script|onerror/i);
    expect(html).toContain('hi');
  });
});

describe('images', () => {
  it('knows the images the app serves', () => {
    expect(isImageTarget('Attachments/a.PNG')).toBe(true);
    expect(isImageTarget('photo.jpeg')).toBe(true);
    expect(isImageTarget('Note')).toBe(false);
    expect(isImageTarget('doc.pdf')).toBe(false);
  });

  it('reads the size after the bar', () => {
    expect(imageSize('300')).toEqual({ width: 300 });
    expect(imageSize('300x200')).toEqual({ width: 300, height: 200 });
    expect(imageSize('a caption')).toEqual({});
    expect(imageSize(undefined)).toEqual({});
  });
});
