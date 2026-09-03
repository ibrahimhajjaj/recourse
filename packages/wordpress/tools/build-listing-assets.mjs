/**
 * Draws the plugin directory's icon and banner.
 *
 * The directory looks for four exact sizes under exact names and shows nothing
 * at all for anything else, so these are rendered rather than exported by hand.
 * Checked in so the files in `.wordpress-org` can be reproduced instead of
 * being binaries nobody can regenerate.
 *
 * Run: node tools/build-listing-assets.mjs .wordpress-org
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Resolved, because a `file://` URL built from a relative path does not point
// anywhere: Chrome renders its own "site cannot be reached" page and the
// screenshot succeeds, so the failure arrives as a plausible-looking PNG.
const out = resolve(process.argv[2] ?? '.wordpress-org')
mkdirSync(out, { recursive: true })

// 1a: blue field, white mark. Chosen because it is the one that still reads at
// 32px, which is the size that decides whether anybody installs this.
const icon = px => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}
 div{width:${px}px;height:${px}px;background:#2563eb;display:flex;align-items:center;justify-content:center}</style>
 <div><svg viewBox="0 0 1000 548" width="${px*.656}" height="${px*.656*.548}" fill="none" stroke="#fff" stroke-width="85" stroke-linecap="round">
 <path d="M62 62H820"/><path d="M62 270H560"/><path d="M62 490H470C660 490 790 420 818 306"/>
 <circle cx="908" cy="232" r="45" fill="#fff" stroke="none"/></svg></div>`

const g = (col, sw, ds) => `<g stroke="${col}" stroke-width="${sw}">${ds.map(d=>`<path d="${d}"/>`).join('')}</g>`
// 1e: dark ground, so the banner has edges against the directory's white page.
const banner = scale => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;
 font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}</style>
 <div style="width:1544px;height:500px;transform:scale(${scale});transform-origin:top left;background:#0f172a;position:relative;display:flex;align-items:center;justify-content:center">
 <svg viewBox="0 0 1544 500" width="1544" height="500" style="position:absolute;inset:0" fill="none" stroke-linecap="round">
 ${g('rgba(255,255,255,.16)',14,['M90 70H470','M90 130H370','M90 430H430','M90 370H330','M1074 70H1454','M1174 130H1454','M1114 430H1454','M1214 370H1454','M560 70H860','M684 430H984'])}
 ${g('#3b82f6',14,['M90 190H300C400 190 452 160 470 118','M1454 310H1244C1144 310 1092 340 1074 382'])}
 <circle cx="500" cy="86" r="12" fill="#3b82f6"/><circle cx="1044" cy="414" r="12" fill="#3b82f6"/></svg>
 <div style="position:relative;text-align:center;color:#fff">
  <div style="font-size:94px;font-weight:640;letter-spacing:-.03em;line-height:1">Recourse</div>
  <div style="margin-top:20px;font-size:32px;color:rgba(255,255,255,.7)">Answers from your own pages</div></div></div>`

const shot = (html, file, w, h) => {
  const page = `${out}/_tmp.html`
  writeFileSync(page, html)
  execFileSync(CHROME, ['--headless','--disable-gpu','--hide-scrollbars',`--screenshot=${out}/${file}`,
    `--window-size=${w},${h}`,'--virtual-time-budget=1500',`file://${page}`], { stdio:'ignore' })
  unlinkSync(page)
  console.log(`  ${file}`)
}

// Each rendered at its own size rather than downscaled, so the strokes and the
// type are sharp at both.
shot(icon(256), 'icon-256x256.png', 256, 256)
shot(icon(128), 'icon-128x128.png', 128, 128)
shot(banner(1), 'banner-1544x500.png', 1544, 500)
shot(banner(0.5), 'banner-772x250.png', 772, 250)


// A screenshot of the wrong thing is still a valid PNG of the right size: a
// bad `file://` URL renders Chrome's own error page, which is why the corner
// colour is checked and not just the dimensions.
const CORNERS = {
  'icon-256x256.png': [37, 99, 235],
  'icon-128x128.png': [37, 99, 235],
  'banner-1544x500.png': [15, 23, 42],
  'banner-772x250.png': [15, 23, 42],
}

/**
 * The top-left pixel, without a PNG library.
 *
 * Every filter type leaves the first pixel of the first scanline as its literal
 * value, because it has no neighbour to the left or above to predict from.
 */
function firstPixel(png) {
  const idat = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    const type = png.toString('ascii', at + 4, at + 8)
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const channels = png[25] === 6 ? 4 : 3
  return [...raw.subarray(1, 1 + Math.min(3, channels))]
}

for (const [file, want] of Object.entries(CORNERS)) {
  const png = readFileSync(`${out}/${file}`)
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const [, w, h] = file.match(/(\d+)x(\d+)/)
  if (width !== Number(w) || height !== Number(h)) {
    throw new Error(`${file} is ${width}x${height}, expected ${w}x${h}`)
  }

  const got = firstPixel(png)
  const off = got.reduce((worst, channel, i) => Math.max(worst, Math.abs(channel - want[i])), 0)
  if (off > 4) {
    throw new Error(`${file} corner is rgb(${got}), expected rgb(${want}). Did the page fail to load?`)
  }
  console.log(`  ${file} ${width}x${height}, corner rgb(${got})`)
}
console.log(`\nwritten to ${out}`)
