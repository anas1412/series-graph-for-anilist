// Watches AniList's client-side routing and keeps the ratings panel in sync with
// whichever anime page is showing.

const ANIME_OVERVIEW = /^\/anime\/(\d+)(?:\/[^/]*)?\/?$/

// AniList is a Vue SPA: it rewrites .overview on every route change, which both
// changes the page under us and deletes anything we injected. One debounced
// observer covers both cases.
const DEBOUNCE_MS = 120

let currentId = null
let panel = null
let requestToken = 0

function animeIdFromPath() {
  const m = ANIME_OVERVIEW.exec(location.pathname)
  return m ? m[1] : null
}

// Top of the overview column either way. .description-wrap is always the first child
// when it exists — it is display:none at desktop widths, where AniList shows the
// description in the banner instead — so inserting after it lands in the same place
// as prepending, and both stay above Relations.
function place(node) {
  const overview = document.querySelector('.overview')
  if (!overview) return false
  const description = overview.querySelector(':scope > .description-wrap')
  if (description) description.insertAdjacentElement('afterend', node)
  else overview.prepend(node)
  return true
}

function clear() {
  document.querySelectorAll('[data-sgfa]').forEach((n) => n.remove())
  panel = null
}

async function load(anilistId) {
  const token = ++requestToken
  let result
  try {
    result = await chrome.runtime.sendMessage({ type: 'episodeRatings', anilistId })
  } catch {
    // Usually the extension being reloaded while an AniList tab is open. Forget which
    // page we are on so the next mutation re-runs this instead of leaving it blank.
    if (anilistId === currentId) currentId = null
    return
  }
  if (token !== requestToken || anilistId !== currentId) return

  if (result?.ok) {
    panel = buildPanel(result)
  } else if (result?.reason === 'error') {
    panel = buildMessage(`Couldn't reach Series Graph. ${result.message || ''}`.trim())
  } else {
    // 'no-mapping' or 'no-data' — this anime simply isn't on Series Graph.
    // Showing an empty box on every such page would be noise.
    panel = null
    return
  }
  place(panel)
}

function sync() {
  const id = animeIdFromPath()

  if (!id) {
    if (currentId !== null) {
      currentId = null
      requestToken++
      clear()
    }
    return
  }

  if (id !== currentId) {
    currentId = id
    clear()
    load(id)
    return
  }

  // Same page, but Vue re-rendered and dropped our node.
  if (panel && !panel.isConnected) place(panel)
}

let timer = null
const observer = new MutationObserver(() => {
  // Drop a stale panel immediately. Debouncing this too would leave the previous
  // anime's chart sitting on the new anime's page for as long as the mutation storm
  // after a route change keeps resetting the timer.
  if (currentId !== null && animeIdFromPath() !== currentId) clear()

  clearTimeout(timer)
  timer = setTimeout(sync, DEBOUNCE_MS)
})

observer.observe(document.body, { childList: true, subtree: true })
sync()
