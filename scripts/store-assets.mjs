// Generates the Chrome Web Store listing assets into docs/store/:
//   screenshot-*.png   1280x800, the extension actually running on anilist.co
//   promo-small.png    440x280 tile
//   promo-marquee.png  1400x560 tile
//
// Loads the unpacked extension into headless Chrome and drives it over the DevTools
// protocol, so the screenshots are the real thing rather than a mock-up.
//
// Needs `chromium` on PATH. Run: node scripts/store-assets.mjs

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXT = resolve(HERE, '..')
const OUT = resolve(EXT, 'docs', 'store')
const PROFILE = resolve('/tmp', 'sgfa-store-profile')
const PORT = 9444

const SHOTS = [
  {
    name: 'screenshot-1-dark',
    url: 'https://anilist.co/anime/154587/Sousou-no-Frieren/',
    dark: true,
  },
  {
    name: 'screenshot-2-light',
    url: 'https://anilist.co/anime/154587/Sousou-no-Frieren/',
    dark: false,
  },
  {
    name: 'screenshot-3-seasons',
    url: 'https://anilist.co/anime/145064/Jujutsu-Kaisen-2nd-Season/',
    dark: true,
  },
  {
    name: 'screenshot-4-community',
    url: 'https://anilist.co/anime/154587/Sousou-no-Frieren/',
    dark: true,
    // click the Community pill before capturing
    click: '.sgfa-pill[data-metric="community"]',
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- tiny CDP client -------------------------------------------------------

let nextId = 0
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const ready = new Promise((res) => ws.addEventListener('open', res))
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++nextId
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { send, ready }
}

const evaluate = async (tab, expression) => {
  const r = await tab.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}

async function waitFor(tab, expression, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(tab, expression)) return true
    await sleep(400)
  }
  return false
}

// --- launch ----------------------------------------------------------------

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })
mkdirSync(OUT, { recursive: true })

const chrome = spawn(
  'chromium',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--user-data-dir=${PROFILE}`,
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] }
)

const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()

for (let i = 0; i < 80; i++) {
  try {
    await targets()
    break
  } catch {
    await sleep(250)
  }
}

const page = (await targets()).find((t) => t.type === 'page')
const tab = connect(page.webSocketDebuggerUrl)
await tab.ready
await tab.send('Page.enable')
await tab.send('Runtime.enable')
await tab.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
})

// --- screenshots -----------------------------------------------------------

// AniList keeps the theme in localStorage under 'site-theme'. Its default, 'system',
// follows prefers-color-scheme — so set that, emulate the media query, and reload.
// Setting 'dark' directly does nothing; the site only honours the three values it writes.
for (const shot of SHOTS) {
  await tab.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: shot.dark ? 'dark' : 'light' }],
  })
  await tab.send('Page.navigate', { url: shot.url })
  await sleep(1500)

  // The body class is what actually drives AniList's CSS variables, and it is what the
  // site itself toggles, so set it directly rather than hoping the media emulation
  // survives a reload.
  await evaluate(
    tab,
    `(() => {
      document.body.classList.remove('site-theme-dark', 'site-theme-contrast');
      ${shot.dark ? `document.body.classList.add('site-theme-dark');` : ''}
      return document.body.className;
    })()`
  )
  await sleep(400)

  const themed = String(await evaluate(tab, `document.body.className`))
  const isDark = themed.includes('site-theme-dark')
  if (isDark !== shot.dark) {
    console.log(`  warning: ${shot.name} wanted dark=${shot.dark}, body is "${themed}"`)
  }

  const appeared = await waitFor(tab, `!!document.querySelector('[data-sgfa] svg')`)
  if (!appeared) {
    console.log(`${shot.name}: panel never appeared, skipped`)
    continue
  }

  if (shot.click) {
    await evaluate(tab, `document.querySelector(${JSON.stringify(shot.click)})?.click(), true`)
    await sleep(600)
  }

  // Put the panel in the frame with some of the page around it for context.
  await evaluate(
    tab,
    `(() => {
      const p = document.querySelector('[data-sgfa]');
      const top = p.getBoundingClientRect().top + scrollY;
      scrollTo({ top: Math.max(0, top - 150), behavior: 'instant' });
      return true;
    })()`
  )
  await sleep(900)

  const { result } = await tab.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(OUT, `${shot.name}.png`), Buffer.from(result.data, 'base64'))
  console.log(`${shot.name}.png`)
}

// --- promo tiles -----------------------------------------------------------

const tile = (w, h, scale) => `
<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{background:radial-gradient(120% 140% at 12% 0%, #1d3350 0%, #0b1622 60%);
       font-family:Roboto,'Segoe UI',system-ui,sans-serif;color:#edf1f5;
       display:flex;align-items:center;gap:${44 * scale}px;padding:0 ${56 * scale}px;box-sizing:border-box}
  .art{flex:0 0 auto}
  h1{margin:0;font-size:${34 * scale}px;font-weight:600;letter-spacing:-.2px;line-height:1.15}
  p{margin:${10 * scale}px 0 0;font-size:${16 * scale}px;color:#9fadbd;line-height:1.45;max-width:${420 * scale}px}
</style>
<div class="art">
  <svg width="${190 * scale}" height="${120 * scale}" viewBox="0 0 190 120">
    <g stroke="#2b3d52" stroke-width="1">
      <line x1="8" y1="24" x2="182" y2="24"/><line x1="8" y1="54" x2="182" y2="54"/>
      <line x1="8" y1="84" x2="182" y2="84"/><line x1="8" y1="112" x2="182" y2="112"/>
    </g>
    <polyline fill="none" stroke="#728aa1" stroke-width="2.4" stroke-linejoin="round" opacity=".6"
      points="12,74 34,86 56,64 78,96 100,44 122,58 144,30 166,38 178,20"/>
    <g stroke="#0b1622" stroke-width="2.4">
      <circle cx="12" cy="74" r="5.5" fill="#f4d03f"/><circle cx="34" cy="86" r="5.5" fill="#f0913c"/>
      <circle cx="56" cy="64" r="5.5" fill="#6abe54"/><circle cx="78" cy="96" r="5.5" fill="#e03e3e"/>
      <circle cx="100" cy="44" r="5.5" fill="#186a3b"/><circle cx="122" cy="58" r="5.5" fill="#6abe54"/>
      <circle cx="144" cy="30" r="5.5" fill="#186a3b"/><circle cx="166" cy="38" r="5.5" fill="#186a3b"/>
      <circle cx="178" cy="20" r="5.5" fill="#186a3b"/>
    </g>
  </svg>
</div>
<div>
  <h1>Episode ratings<br>on AniList</h1>
  <p>Series Graph's per-episode chart, right on the anime page.</p>
</div>`

for (const [name, w, h, scale] of [
  ['promo-small', 440, 280, 0.62],
  ['promo-marquee', 1400, 560, 1.6],
]) {
  const dataUrl = 'data:text/html;base64,' + Buffer.from(tile(w, h, scale)).toString('base64')
  await tab.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await tab.send('Page.navigate', { url: dataUrl })
  await sleep(1200)
  const { result } = await tab.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(result.data, 'base64'))
  console.log(`${name}.png`)
}

chrome.kill()
console.log(`\nassets in ${OUT}`)
process.exit(0)
