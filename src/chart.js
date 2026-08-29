// Renders the episode-rating panel. Runs in the content script's isolated world;
// `buildPanel` is picked up by content.js through the shared top-level scope.

const SVG_NS = 'http://www.w3.org/2000/svg'
const PLOT_HEIGHT = 190
const PAD = { top: 14, right: 12, bottom: 24, left: 30 }
const MIN_EPISODE_WIDTH = 13 // below this, points collide — scroll instead

// Anchored on the two colours Series Graph itself uses (7.7 yellow, 9.1+ dark green),
// interpolated so the whole 0-10 range reads red -> yellow -> green.
const COLOR_STOPS = [
  [5.5, [224, 62, 62]],
  [7.0, [240, 145, 60]],
  [7.75, [244, 208, 63]],
  [8.5, [106, 190, 84]],
  [9.2, [24, 106, 59]],
]

function ratingColor(v) {
  if (v <= COLOR_STOPS[0][0]) return `rgb(${COLOR_STOPS[0][1].join(',')})`
  const last = COLOR_STOPS[COLOR_STOPS.length - 1]
  if (v >= last[0]) return `rgb(${last[1].join(',')})`
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [x0, c0] = COLOR_STOPS[i]
    const [x1, c1] = COLOR_STOPS[i + 1]
    if (v >= x0 && v <= x1) {
      const t = (v - x0) / (x1 - x0)
      const c = c0.map((ch, j) => Math.round(ch + (c1[j] - ch) * t))
      return `rgb(${c.join(',')})`
    }
  }
  return 'rgb(var(--color-blue))'
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v)
  return node
}

function formatDate(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function formatVotes(n) {
  if (n == null) return null
  return n.toLocaleString()
}

// Ticks every 0.5 or 1.0, whichever keeps the axis to a handful of labels.
function axisTicks(lo, hi) {
  const step = hi - lo > 3 ? 1 : 0.5
  const ticks = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(1)))
  return ticks
}

function buildPanel(result) {
  const { seasons, season: chosenSeason, tmdbId } = result

  const state = {
    metric: 'imdb',
    season: seasons.some((s) => s.season === chosenSeason) ? chosenSeason : seasons[0].season,
  }

  const root = el('div', 'sgfa')
  root.dataset.sgfa = '1'

  // --- header ---------------------------------------------------------------
  const header = el('h2', 'sgfa-head')
  header.appendChild(el('span', null, 'Episode Ratings'))

  const actions = el('div', 'sgfa-actions')
  const toggle = el('div', 'sgfa-toggle')
  const metricButtons = [
    ['imdb', 'IMDb'],
    ['community', 'Community'],
  ].map(([metric, label]) => {
    const b = el('button', 'sgfa-pill', label)
    b.type = 'button'
    b.dataset.metric = metric
    b.addEventListener('click', () => {
      if (state.metric === metric) return
      state.metric = metric
      draw()
    })
    toggle.appendChild(b)
    return b
  })
  actions.appendChild(toggle)

  const link = el('a', 'sgfa-src', 'Series Graph')
  link.href = `https://seriesgraph.com/show/${tmdbId}`
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  actions.appendChild(link)
  header.appendChild(actions)
  root.appendChild(header)

  const body = el('div', 'sgfa-body')
  root.appendChild(body)

  // --- season picker (only when the show has more than one season) ----------
  let seasonButtons = []
  if (seasons.length > 1) {
    const bar = el('div', 'sgfa-seasons')
    seasonButtons = seasons.map((s) => {
      const b = el('button', 'sgfa-pill', s.season === 0 ? 'Specials' : `S${s.season}`)
      b.type = 'button'
      b.dataset.season = String(s.season)
      b.addEventListener('click', () => {
        if (state.season === s.season) return
        state.season = s.season
        draw()
      })
      bar.appendChild(b)
      return b
    })
    body.appendChild(bar)
  }

  const plot = el('div', 'sgfa-plot')
  const tip = el('div', 'sgfa-tip')
  tip.hidden = true
  plot.appendChild(tip)
  body.appendChild(plot)

  const stats = el('div', 'sgfa-stats')
  body.appendChild(stats)

  const note = el('div', 'sgfa-note')
  note.hidden = true
  body.appendChild(note)

  // --- drawing --------------------------------------------------------------
  function currentEpisodes() {
    const s = seasons.find((x) => x.season === state.season) || seasons[0]
    return s.episodes
  }

  function showTip(ep, value, anchorX, anchorY) {
    const lines = []
    lines.push(`E${ep.n}${ep.name ? ` · ${ep.name}` : ''}`)
    const votes = formatVotes(state.metric === 'imdb' ? ep.imdbVotes : ep.communityVotes)
    const source = state.metric === 'imdb' ? 'IMDb' : 'Series Graph users'
    lines.push(
      value == null ? `No ${source} rating yet` : `${value.toFixed(1)} · ${source}${votes ? ` · ${votes} votes` : ''}`
    )
    const date = formatDate(ep.date)
    if (date) lines.push(date)

    tip.textContent = ''
    lines.forEach((line, i) => tip.appendChild(el('div', i === 0 ? 'sgfa-tip-title' : null, line)))
    tip.hidden = false

    // anchorX/anchorY are SVG coordinates; the SVG is 1:1 with the scroll box it sits in.
    // Measure from a clean slate — offsetWidth is still shaped by the previous hover's
    // `left` until the new one is applied.
    tip.style.left = '0px'
    const width = tip.offsetWidth
    const left = Math.max(0, Math.min(anchorX - width / 2, Math.max(plot.scrollWidth, plot.clientWidth) - width))
    tip.style.left = `${left}px`
    tip.style.top = `${Math.max(0, anchorY - tip.offsetHeight - 10)}px`
  }

  function draw() {
    metricButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.metric === state.metric))
    seasonButtons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.season) === state.season))

    const episodes = currentEpisodes()
    const values = episodes.map((e) => (state.metric === 'imdb' ? e.imdb : e.community))
    const rated = values.filter((v) => typeof v === 'number')

    // Removing the only scroll-content child collapses scrollWidth and makes the
    // browser reset scrollLeft. Switching metric or season must not jump One Piece
    // back to episode 1.
    const keepScroll = plot.scrollLeft
    plot.querySelector('svg')?.remove()
    tip.hidden = true
    note.hidden = true

    if (rated.length === 0) {
      stats.textContent = ''
      note.textContent =
        state.metric === 'imdb'
          ? 'No IMDb ratings for these episodes yet.'
          : 'No Series Graph community ratings for these episodes yet.'
      note.hidden = false
      return
    }

    const lo = Math.max(0, Math.min(...rated) - Math.max(0.4, (Math.max(...rated) - Math.min(...rated)) * 0.15))
    const hi = Math.min(10, Math.max(...rated) + Math.max(0.4, (Math.max(...rated) - Math.min(...rated)) * 0.15))

    const available = Math.max(240, plot.clientWidth)
    const needed = PAD.left + PAD.right + episodes.length * MIN_EPISODE_WIDTH
    const width = Math.max(available, needed)
    plot.classList.toggle('is-scrollable', needed > available)

    const innerW = width - PAD.left - PAD.right
    const innerH = PLOT_HEIGHT - PAD.top - PAD.bottom
    const x = (i) => PAD.left + (episodes.length === 1 ? innerW / 2 : (i / (episodes.length - 1)) * innerW)
    const y = (v) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH

    const svg = svgEl('svg', { width, height: PLOT_HEIGHT, class: 'sgfa-svg' })

    // gridlines + y labels
    for (const t of axisTicks(lo, hi)) {
      svg.appendChild(svgEl('line', { class: 'sgfa-grid', x1: PAD.left, x2: width - PAD.right, y1: y(t), y2: y(t) }))
      const label = svgEl('text', { class: 'sgfa-ylabel', x: PAD.left - 6, y: y(t) + 3.5, 'text-anchor': 'end' })
      label.textContent = t.toFixed(1)
      svg.appendChild(label)
    }

    // season average
    const avg = rated.reduce((a, b) => a + b, 0) / rated.length
    svg.appendChild(svgEl('line', { class: 'sgfa-avg', x1: PAD.left, x2: width - PAD.right, y1: y(avg), y2: y(avg) }))

    // connect only consecutive rated episodes, so gaps stay visible as gaps
    let run = []
    const flush = () => {
      if (run.length > 1) {
        svg.appendChild(svgEl('polyline', { class: 'sgfa-line', points: run.map((p) => `${p[0]},${p[1]}`).join(' ') }))
      }
      run = []
    }
    values.forEach((v, i) => (typeof v === 'number' ? run.push([x(i), y(v)]) : flush()))
    flush()

    // points and x labels. Dots shrink once episodes get dense (One Piece is one
    // 1176-episode season on TMDB, so this is a real case, not a hypothetical).
    const spacing = episodes.length > 1 ? innerW / (episodes.length - 1) : innerW
    const radius = spacing < 8 ? 2 : 3.5
    const labelEvery = Math.max(1, Math.ceil(episodes.length / Math.max(1, Math.floor(innerW / 26))))
    episodes.forEach((ep, i) => {
      const v = values[i]
      if (typeof v === 'number') {
        svg.appendChild(svgEl('circle', { class: 'sgfa-dot', cx: x(i), cy: y(v), r: radius, fill: ratingColor(v) }))
      }
      // The last episode is always labelled, but not if the previous label is closer
      // than one step — at 1176 episodes that pair would overlap by ~7px.
      const last = episodes.length - 1
      if (i === last || (i % labelEvery === 0 && last - i >= labelEvery)) {
        const label = svgEl('text', { class: 'sgfa-xlabel', x: x(i), y: PLOT_HEIGHT - 8, 'text-anchor': 'middle' })
        label.textContent = String(ep.n)
        svg.appendChild(label)
      }
    })

    // One delegated hover instead of one hit area per episode.
    const guide = svgEl('line', { class: 'sgfa-guide', y1: PAD.top, y2: PAD.top + innerH })
    guide.style.display = 'none'
    svg.appendChild(guide)
    const marker = svgEl('circle', { class: 'sgfa-marker', r: radius + 2.5 })
    marker.style.display = 'none'
    svg.appendChild(marker)

    const overlay = svgEl('rect', {
      class: 'sgfa-overlay',
      x: PAD.left - spacing / 2,
      y: PAD.top,
      width: innerW + spacing,
      height: innerH,
    })
    const hideHover = () => {
      tip.hidden = true
      guide.style.display = 'none'
      marker.style.display = 'none'
    }
    overlay.addEventListener('mousemove', (event) => {
      const box = svg.getBoundingClientRect()
      const scale = box.width / width // the SVG is sized in px, but zoom can still scale it
      const mx = (event.clientX - box.left) / scale
      const i = Math.max(0, Math.min(episodes.length - 1, Math.round((mx - PAD.left) / spacing)))
      const v = values[i]
      guide.setAttribute('x1', x(i))
      guide.setAttribute('x2', x(i))
      guide.style.display = ''
      if (typeof v === 'number') {
        marker.setAttribute('cx', x(i))
        marker.setAttribute('cy', y(v))
        marker.setAttribute('stroke', ratingColor(v))
        marker.style.display = ''
      } else {
        marker.style.display = 'none'
      }
      showTip(episodes[i], typeof v === 'number' ? v : null, x(i), typeof v === 'number' ? y(v) : PAD.top + innerH / 2)
    })
    overlay.addEventListener('mouseleave', hideHover)
    svg.appendChild(overlay)

    plot.appendChild(svg)
    plot.scrollLeft = keepScroll // browser-clamped, so a narrower redraw still lands valid

    // summary line
    let bestI = -1
    let worstI = -1
    values.forEach((v, i) => {
      if (typeof v !== 'number') return
      if (bestI === -1 || v > values[bestI]) bestI = i
      if (worstI === -1 || v < values[worstI]) worstI = i
    })
    stats.textContent = ''
    const add = (label, value) => {
      const s = el('span', 'sgfa-stat')
      s.appendChild(el('span', 'sgfa-stat-label', label))
      s.appendChild(el('span', 'sgfa-stat-value', value))
      stats.appendChild(s)
    }
    add('Average', avg.toFixed(2))
    add('Best', `E${episodes[bestI].n} · ${values[bestI].toFixed(1)}`)
    add('Worst', `E${episodes[worstI].n} · ${values[worstI].toFixed(1)}`)
    if (rated.length < episodes.length) add('Unrated', `${episodes.length - rated.length} ep`)
  }

  draw()

  // The AniList overview column changes width with the viewport.
  let lastWidth = plot.clientWidth
  const ro = new ResizeObserver(() => {
    // Detaching the panel collapses it to 0x0 and fires here. Redrawing a tree that
    // will never be painted is wasted work — but do not disconnect: Vue drops our node
    // on its own re-renders and content.js puts the same panel back, so the observer
    // has to survive that. Returning before lastWidth is updated is what makes it
    // correct; a re-place at the same width is then a no-op.
    if (!plot.isConnected) return
    if (Math.abs(plot.clientWidth - lastWidth) < 8) return
    lastWidth = plot.clientWidth
    draw()
  })
  ro.observe(plot)

  return root
}

function buildMessage(text) {
  const root = el('div', 'sgfa')
  root.dataset.sgfa = '1'
  root.appendChild(el('h2', 'sgfa-head', 'Episode Ratings'))
  const body = el('div', 'sgfa-body')
  body.appendChild(el('div', 'sgfa-note', text))
  root.appendChild(body)
  return root
}
