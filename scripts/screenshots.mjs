import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(import.meta.dirname, '../screenshots');
const PALETTES = ['cosmic', 'forest', 'crimson', 'ocean', 'ember'];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();

for (const palette of PALETTES) {
  // Navigate first so localStorage is available
  await page.goto('http://localhost:3000/org', { waitUntil: 'networkidle2' });

  // Set palette and apply it before the page paints
  await page.evaluate((p) => {
    localStorage.setItem('zenhance-palette', p);
    document.documentElement.dataset.palette = p;
  }, palette);

  // Short pause for CSS transitions to settle
  await new Promise(r => setTimeout(r, 400));

  const filePath = `${OUT}/${palette}.png`;
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`Saved: ${filePath}`);
}

await browser.close();
console.log('Done.');
