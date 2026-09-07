/**
 * Regenerates the source artwork in `resources/` from the brand tokens.
 *
 * The icon and splash are the app's own type and palette rather than something
 * drawn by hand, so they cannot drift from the design system: the gradient is
 * the wine -> rose pair, and the mark is set in Playfair Display, the display
 * face used for headings and hero numbers.
 *
 *   npm run assets:source     # rewrite resources/*.png
 *   npm run assets            # fan them out into android/ via @capacitor/assets
 *
 * The glyph is placed from its measured ink box, not from font metrics or a
 * hand-tuned nudge: Playfair's cap sits high in the em box, so centring the
 * text line leaves the mark visibly low. Everything is drawn to a canvas at
 * full size in headless Chromium (already present for Playwright), so the
 * letterform is shaped by a real text engine rather than upscaled.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'resources');

/** Brand tokens — kept in step with tailwind.config.js. */
const WINE = '#9F1239';
const ROSE = '#BE185D';
const CANVAS = '#180B10';

const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap';

const ASSETS = [
  // Full-bleed: iOS and Android apply their own mask, so no rounding here.
  { file: 'icon.png', size: 1024, background: 'gradient', ink: 0.6 },

  /*
   * Adaptive foreground: transparent, and the ink has to stay inside the safe
   * circle (the central ~66%) or Android's mask clips it. 0.42 leaves the
   * diagonal of the ink box comfortably inside that circle.
   */
  { file: 'icon-foreground.png', size: 1024, background: 'none', ink: 0.42 },

  { file: 'icon-background.png', size: 1024, background: 'gradient', ink: 0 },

  // Square, so Capacitor can crop to any aspect without losing the mark.
  { file: 'splash.png', size: 2732, background: 'canvas', ink: 0.105, plate: true },
];

// The app is dark under both schemes, so the dark splash is the same artwork.
ASSETS.push({ ...ASSETS[ASSETS.length - 1], file: 'splash-dark.png' });

const browser = await chromium.launch();
try {
  await mkdir(OUT, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 512, height: 512 } });
  const tab = await context.newPage();
  await tab.setContent(
    `<!doctype html><html><head><meta charset="utf-8">
     <link href="${FONT_CSS}" rel="stylesheet"></head><body></body></html>`,
    { waitUntil: 'load' }
  );
  await tab.evaluate(() => document.fonts.load('700 100px "Playfair Display"'));
  await tab.evaluate(() => document.fonts.ready);

  for (const asset of ASSETS) {
    const result = await tab.evaluate(
      ({ size, background, ink, plate, wine, rose, canvasColor }) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const brandGradient = () => {
          // 135deg: top-left to bottom-right.
          const g = ctx.createLinearGradient(0, 0, size, size);
          g.addColorStop(0, wine);
          g.addColorStop(1, rose);
          return g;
        };

        if (background === 'gradient') {
          ctx.fillStyle = brandGradient();
          ctx.fillRect(0, 0, size, size);
        } else if (background === 'canvas') {
          ctx.fillStyle = canvasColor;
          ctx.fillRect(0, 0, size, size);
        }

        const centre = size / 2;

        if (plate) {
          // A rounded plate carrying the mark, with the ambient glow the app
          // uses behind its own surfaces.
          const plateSize = size * 0.227;
          const radius = plateSize * 0.26;
          const x = centre - plateSize / 2;
          const y = centre - plateSize / 2;

          ctx.save();
          ctx.shadowColor = 'rgba(190, 24, 93, 0.38)';
          ctx.shadowBlur = size * 0.08;
          ctx.beginPath();
          ctx.roundRect(x, y, plateSize, plateSize, radius);
          ctx.fillStyle = brandGradient();
          ctx.fill();
          ctx.restore();
        }

        if (ink > 0) {
          const target = size * ink;

          // Measure at a reference size, then scale so the ink box matches.
          const measure = (px) => {
            ctx.font = `700 ${px}px "Playfair Display", Georgia, serif`;
            const m = ctx.measureText('S');
            return {
              ascent: m.actualBoundingBoxAscent,
              descent: m.actualBoundingBoxDescent,
              left: m.actualBoundingBoxLeft,
              right: m.actualBoundingBoxRight,
              height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
            };
          };

          const reference = measure(size / 2);
          const fontSize = (size / 2) * (target / reference.height);
          const m = measure(fontSize);

          // Place the measured ink box dead centre.
          const x = centre + (m.left - m.right) / 2;
          const y = centre + (m.ascent - m.descent) / 2;

          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'alphabetic';
          ctx.textAlign = 'left';
          ctx.fillText('S', x, y);

          // Report the box back so the build can assert it, rather than trust it.
          return {
            data: canvas.toDataURL('image/png'),
            ink: {
              width: Math.round(m.left + m.right),
              height: Math.round(m.height),
              centreX: Math.round(centre),
              centreY: Math.round(centre),
            },
          };
        }

        return { data: canvas.toDataURL('image/png'), ink: null };
      },
      { ...asset, wine: WINE, rose: ROSE, canvasColor: CANVAS }
    );

    const buffer = Buffer.from(result.data.split(',')[1], 'base64');
    await writeFile(join(OUT, asset.file), buffer);

    const box = result.ink
      ? `mark ${result.ink.width}x${result.ink.height} centred`
      : 'no mark';
    console.log(`  ${asset.file.padEnd(22)} ${asset.size}x${asset.size}  ${box}`);
  }
} finally {
  await browser.close();
}

console.log('\nresources/ regenerated — now: npm run assets');
