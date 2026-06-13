import './style.css'

// ──────────────────────────────────────────────
// Configuración
// ──────────────────────────────────────────────
const API_KEY = import.meta.env.VITE_LASTFM_API_KEY
const API_BASE = 'https://ws.audioscrobbler.com/2.0/'
const LASTFM_USER = 'Fabilover'
const SPOTIFY_URL = 'https://open.spotify.com/user/fabisparrow'

const SEARCH_FETCH_LIMIT = 30
const SEARCH_DISPLAY_LIMIT = 8
const MIN_LISTENERS = 1000
const ALBUMS_LIMIT = 12
const SIMILAR_LIMIT = 6
const DASHBOARD_LIMIT = 6
const MAX_VIEWED = 12
const NOW_PLAYING_REFRESH_MS = 30_000

const ALPHABET = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('')

// ──────────────────────────────────────────────
// Estado de la app
// ──────────────────────────────────────────────
let lastSearchResults = []
let currentLetter = null
let cachedTopArtists = []

// ──────────────────────────────────────────────
// Top artists de Last.fm (cache 6h en localStorage)
// ──────────────────────────────────────────────
const TOP_ARTISTS_CACHE_KEY = 'fcg-top-artists-v1'
const TOP_ARTISTS_TTL_MS = 6 * 60 * 60 * 1000

async function loadTopArtists() {
  // Intentar cache primero
  try {
    const cached = JSON.parse(localStorage.getItem(TOP_ARTISTS_CACHE_KEY) ?? 'null')
    if (cached && Date.now() - cached.fetchedAt < TOP_ARTISTS_TTL_MS) {
      cachedTopArtists = cached.artists
      return
    }
  } catch {}

  // Refrescar desde la API
  try {
    const data = await lastfm({
      method: 'user.getTopArtists',
      user: LASTFM_USER,
      limit: '50',
      period: 'overall',
    })
    const artists = data?.topartists?.artist ?? []
    cachedTopArtists = artists
    localStorage.setItem(
      TOP_ARTISTS_CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), artists })
    )
  } catch (error) {
    console.warn('No pudimos cargar tu top de Last.fm:', error)
  }
}

// Busca si un artista está en tu top y devuelve su ranking (1-indexed)
function getMyTopRank(artistName) {
  const normalized = artistName.toLowerCase()
  const idx = cachedTopArtists.findIndex(
    (a) => a.name.toLowerCase() === normalized
  )
  return idx === -1 ? null : idx + 1
}

// ──────────────────────────────────────────────
// Imágenes de artistas vía Deezer (cache 30 días, sin auth)
// ──────────────────────────────────────────────
const ARTIST_IMG_KEY = 'fcg-artist-images-v1'
const ARTIST_IMG_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 días

let cachedArtistImages = (() => {
  try {
    return JSON.parse(localStorage.getItem(ARTIST_IMG_KEY) ?? '{}')
  } catch {
    return {}
  }
})()

function saveArtistImages() {
  try {
    localStorage.setItem(ARTIST_IMG_KEY, JSON.stringify(cachedArtistImages))
  } catch {}
}

// Devuelve: URL string, '' si confirmado-sin-imagen, null si no probado aún.
function getCachedArtistImage(name) {
  const entry = cachedArtistImages[name.toLowerCase()]
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > ARTIST_IMG_TTL_MS) return null
  return entry.url
}

function setCachedArtistImage(name, url) {
  cachedArtistImages[name.toLowerCase()] = { url, fetchedAt: Date.now() }
  saveArtistImages()
}

async function fetchArtistImage(name) {
  const cached = getCachedArtistImage(name)
  if (cached !== null) return cached

  try {
    const params = new URLSearchParams({ q: name, limit: '1' })
    const response = await fetch(`https://api.deezer.com/search/artist?${params}`)
    if (!response.ok) {
      setCachedArtistImage(name, '')
      return ''
    }
    const data = await response.json()
    const artist = data?.data?.[0]
    // Validamos que el nombre coincida razonablemente (evita falsos positivos)
    const matches = artist?.name?.toLowerCase() === name.toLowerCase()
    const url = matches ? (artist?.picture_medium || artist?.picture || '') : ''
    setCachedArtistImage(name, url)
    return url
  } catch (error) {
    return ''
  }
}

// Llamar después de renderizar: busca todos los slots con data-artist-img,
// pide imágenes en lotes y las inyecta como <img> que hace fade-in.
async function populateArtistImages() {
  const slots = Array.from(document.querySelectorAll('[data-artist-img]'))
  const namesToFetch = [
    ...new Set(
      slots
        .map((s) => s.dataset.artistImg)
        .filter((name) => getCachedArtistImage(name) === null)
    ),
  ]

  const applyImage = (name, url) => {
    if (!url) return
    document.querySelectorAll('[data-artist-img]').forEach((el) => {
      if (el.dataset.artistImg !== name) return
      if (el.querySelector('.art-img')) return
      const img = document.createElement('img')
      img.className = 'art-img'
      img.src = url
      img.alt = ''
      img.loading = 'lazy'
      el.appendChild(img)
    })
  }

  // Primero aplicamos las que ya tenemos cacheadas
  for (const slot of slots) {
    const name = slot.dataset.artistImg
    const cached = getCachedArtistImage(name)
    if (cached) applyImage(name, cached)
  }

  // Luego pedimos las que faltan, en lotes paralelos de 5
  for (let i = 0; i < namesToFetch.length; i += 5) {
    const batch = namesToFetch.slice(i, i + 5)
    const results = await Promise.all(
      batch.map(async (name) => ({ name, url: await fetchArtistImage(name) }))
    )
    for (const { name, url } of results) applyImage(name, url)
  }
}

// ──────────────────────────────────────────────
// Persistencia: ratings y artistas vistos
// ──────────────────────────────────────────────
const RATINGS_KEY = 'fcg-ratings-v1'
const VIEWED_KEY = 'fcg-viewed-v1'

function loadRatings() {
  try {
    return JSON.parse(localStorage.getItem(RATINGS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveRatings(ratings) {
  localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings))
}

function ratingKey(artist, album) {
  return `${artist}::${album}`
}

function getRating(artist, album) {
  const data = loadRatings()[ratingKey(artist, album)]
  if (typeof data === 'number') return data
  return data?.rating ?? 0
}

function setRating(artist, album, value, cover = '') {
  const ratings = loadRatings()
  const key = ratingKey(artist, album)
  if (value === 0) {
    delete ratings[key]
  } else {
    ratings[key] = { rating: value, artist, album, cover, ratedAt: Date.now() }
  }
  saveRatings(ratings)
}

// ──────────────────────────────────────────────
// Ratings de tracks (canciones individuales)
// ──────────────────────────────────────────────
const TRACK_RATINGS_KEY = 'fcg-track-ratings-v1'

function loadTrackRatings() {
  try {
    return JSON.parse(localStorage.getItem(TRACK_RATINGS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveTrackRatings(map) {
  localStorage.setItem(TRACK_RATINGS_KEY, JSON.stringify(map))
}

function trackKey(artist, album, track) {
  return `${artist}::${album}::${track}`
}

function getTrackRating(artist, album, track) {
  return loadTrackRatings()[trackKey(artist, album, track)] ?? 0
}

// Promedio de ratings de tracks de un álbum (redondeado).
function computeAlbumAvg(artist, album) {
  const all = loadTrackRatings()
  const prefix = `${artist}::${album}::`
  const values = Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v)
    .filter((v) => v > 0)
  if (values.length === 0) return 0
  const sum = values.reduce((a, b) => a + b, 0)
  return Math.round(sum / values.length)
}

// Guarda rating de track Y actualiza el rating del álbum como promedio.
// Si el cover viene, también se guarda en el rating del álbum.
function setTrackRating(artist, album, track, value, cover = '') {
  const map = loadTrackRatings()
  const key = trackKey(artist, album, track)
  if (value === 0) delete map[key]
  else map[key] = value
  saveTrackRatings(map)

  // Recomputa el rating del álbum a partir del promedio
  const avg = computeAlbumAvg(artist, album)
  const existing = loadRatings()[ratingKey(artist, album)]
  const existingCover =
    typeof existing === 'object' ? existing.cover : ''
  setRating(artist, album, avg, cover || existingCover)
}

function getAllRatedAlbums() {
  const ratings = loadRatings()
  return Object.entries(ratings).map(([key, data]) => {
    if (typeof data === 'number') {
      const [artist, album] = key.split('::')
      return { artist, album, rating: data, cover: '', ratedAt: 0 }
    }
    return { ...data, ratedAt: data.ratedAt ?? 0 }
  })
}

function getViewedArtists() {
  try {
    return JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]')
  } catch {
    return []
  }
}

function addViewedArtist(name) {
  const viewed = getViewedArtists().filter((a) => a.name !== name)
  const updated = [{ name, viewedAt: Date.now() }, ...viewed].slice(0, MAX_VIEWED)
  localStorage.setItem(VIEWED_KEY, JSON.stringify(updated))
}

// ──────────────────────────────────────────────
// HTML inicial
// ──────────────────────────────────────────────
const app = document.querySelector('#app')

app.innerHTML = `
  <nav class="navbar">
    <a class="brand" href="#" data-view="home">FCG <span class="brand-sep">|</span> MusicAnalysis</a>
  </nav>

  <section class="hero">
    <img class="hero-photo" src="/hero.jpg" alt="Foto de Fabian" />
    <div class="hero-overlay"></div>
    <div class="hero-glow"></div>
    <div class="hero-content">
      <div class="hero-text">
        <p class="hero-eyebrow">Bienvenido a tu rincón musical</p>
        <h1 class="hero-title">Mi laboratorio<br/>musical</h1>
        <p class="hero-subtitle">Calificando álbumes, descubriendo artistas y guardando lo que me mueve.</p>
        <a class="hero-spotify-btn" href="${SPOTIFY_URL}" target="_blank" rel="noopener noreferrer">
          <span class="spotify-icon">♫</span> Sígueme en Spotify
        </a>
      </div>
      <aside class="hero-side">
        <div class="now-playing" id="now-playing" hidden></div>
      </aside>
    </div>
  </section>

  <main>
    <section class="search-section">
      <form id="search-form">
        <input
          type="text"
          id="search-input"
          placeholder="Busca un artista (ej: Radiohead)"
          autocomplete="off"
        />
        <button type="submit">Buscar</button>
      </form>

      <div class="alphabet-bar" id="alphabet-bar">
        ${ALPHABET.map((l) => `<button class="letter" data-letter="${l}">${l}</button>`).join('')}
      </div>
    </section>

    <section id="results" class="results"></section>
  </main>
`

const form = document.querySelector('#search-form')
const input = document.querySelector('#search-input')
const resultsEl = document.querySelector('#results')
const nowPlayingEl = document.querySelector('#now-playing')

// ──────────────────────────────────────────────
// Helpers de formato
// ──────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

function formatListeners(count) {
  const num = parseInt(count, 10)
  if (isNaN(num)) return ''
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M oyentes`
  if (num >= 1_000) return `${Math.round(num / 1_000)}K oyentes`
  return `${num} oyentes`
}

function formatPlaycount(count) {
  const num = parseInt(count, 10)
  if (isNaN(num) || num === 0) return ''
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M reproducciones`
  if (num >= 1_000) return `${Math.round(num / 1_000)}K reproducciones`
  return `${num} reproducciones`
}

function formatMyPlays(count) {
  const num = parseInt(count, 10)
  if (isNaN(num) || num === 0) return ''
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K plays`
  return `${num} plays`
}

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'hace un momento'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `hace ${days} d`
  const months = Math.floor(days / 30)
  return `hace ${months} mes${months !== 1 ? 'es' : ''}`
}

function getImageUrl(images, size = 'large') {
  if (!Array.isArray(images)) return ''
  const match = images.find((img) => img.size === size)
  return match?.['#text'] || ''
}

// ──────────────────────────────────────────────
// Stars
// ──────────────────────────────────────────────

function renderStars(rating) {
  const stars = []
  for (let value = 5; value >= 1; value--) {
    const filled = value <= rating ? 'star-filled' : ''
    stars.push(
      `<button type="button" class="star ${filled}" data-value="${value}" aria-label="Calificar con ${value}">★</button>`
    )
  }
  return stars.join('')
}

function updateRatingDisplay(ratingEl, newRating) {
  ratingEl.querySelectorAll('.star').forEach((star) => {
    const value = parseInt(star.dataset.value, 10)
    star.classList.toggle('star-filled', value <= newRating)
  })
}

// ──────────────────────────────────────────────
// API
// ──────────────────────────────────────────────

async function lastfm(params) {
  const url = `${API_BASE}?${new URLSearchParams({
    ...params,
    api_key: API_KEY,
    format: 'json',
  })}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Last.fm respondió con estado ${response.status}`)
  }
  return response.json()
}

// Deduplica artistas con nombres muy parecidos quedándose con el de
// más oyentes. Por ejemplo: "Radiohead", "RADIOHEAD", "Radio Head"
// se colapsan en un solo resultado (el de Radiohead real).
function dedupeArtists(artists) {
  const canonical = new Map()
  for (const artist of artists) {
    const key = artist.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!key) continue
    const existing = canonical.get(key)
    if (
      !existing ||
      parseInt(artist.listeners, 10) > parseInt(existing.listeners, 10)
    ) {
      canonical.set(key, artist)
    }
  }
  return Array.from(canonical.values())
}

async function searchArtists(query) {
  const data = await lastfm({
    method: 'artist.search',
    artist: query,
    limit: String(SEARCH_FETCH_LIMIT),
  })
  const raw = data?.results?.artistmatches?.artist ?? []

  const sorted = [...raw].sort(
    (a, b) => parseInt(b.listeners, 10) - parseInt(a.listeners, 10)
  )
  const deduped = dedupeArtists(sorted)
  const filtered = deduped.filter(
    (artist) => parseInt(artist.listeners, 10) >= MIN_LISTENERS
  )
  const finalList = filtered.length > 0 ? filtered : deduped
  return finalList.slice(0, SEARCH_DISPLAY_LIMIT)
}

async function fetchTopAlbums(artistName) {
  const data = await lastfm({
    method: 'artist.getTopAlbums',
    artist: artistName,
    limit: String(ALBUMS_LIMIT),
  })
  const albums = data?.topalbums?.album ?? []
  return albums.filter((album) => album.name && album.name !== '(null)')
}

async function fetchAlbumInfo(artist, album) {
  const data = await lastfm({
    method: 'album.getInfo',
    artist,
    album,
    autocorrect: '1',
  })
  return data?.album ?? null
}

async function fetchSimilarArtists(artistName) {
  const data = await lastfm({
    method: 'artist.getSimilar',
    artist: artistName,
    limit: String(SIMILAR_LIMIT),
  })
  return data?.similarartists?.artist ?? []
}

async function fetchNowPlaying() {
  const data = await lastfm({
    method: 'user.getRecentTracks',
    user: LASTFM_USER,
    limit: '1',
  })
  const track = data?.recenttracks?.track?.[0]
  if (!track) return null
  const isNowPlaying = track['@attr']?.nowplaying === 'true'
  return {
    name: track.name,
    artist: track.artist?.['#text'] || '',
    album: track.album?.['#text'] || '',
    image: getImageUrl(track.image, 'medium'),
    nowPlaying: isNowPlaying,
    when: track.date?.uts ? parseInt(track.date.uts, 10) * 1000 : Date.now(),
  }
}

// ──────────────────────────────────────────────
// Vistas
// ──────────────────────────────────────────────

function setActiveTab(_view) {
  // Tabs removidas en v1.5 — función vacía para no romper llamadas previas.
}

function setActiveLetter(letter) {
  currentLetter = letter
  document.querySelectorAll('.letter').forEach((btn) => {
    btn.classList.toggle('letter-active', btn.dataset.letter === letter)
  })
}

function renderArtistCardsRow(artists) {
  return artists
    .map((artist) => {
      const name = escapeHtml(artist.name)
      const initial = escapeHtml(artist.name.charAt(0).toUpperCase())
      const meta = artist.meta ? escapeHtml(artist.meta) : ''
      const rank = getMyTopRank(artist.name)
      const badge = rank ? `<span class="top-badge">★ #${rank}</span>` : ''
      return `
        <article class="artist-card" data-artist="${name}">
          <div class="artist-avatar" data-artist-img="${name}">${initial}</div>
          <div class="artist-info">
            <p class="artist-name">${name}${badge}</p>
            ${meta ? `<p class="artist-listeners">${meta}</p>` : ''}
          </div>
        </article>
      `
    })
    .join('')
}

function renderAlbumCardsRow(items) {
  return items
    .map((item) => {
      const artist = escapeHtml(item.artist)
      const album = escapeHtml(item.album)
      const coverHtml = item.cover
        ? `<img class="album-cover" src="${item.cover}" alt="Portada de ${album}" loading="lazy" />`
        : `<div class="album-cover album-cover-placeholder">♪</div>`
      return `
        <article class="album-card collection-card" data-artist="${artist}" data-album="${album}">
          ${coverHtml}
          <div class="album-info">
            <p class="album-name">${album}</p>
            <p class="album-artist">${artist}</p>
            <div class="rating">${renderStars(item.rating)}</div>
          </div>
        </article>
      `
    })
    .join('')
}

// Paleta duotono: variaciones de azul para los artistas
const ARTIST_GRADIENTS = [
  ['#003bb0', '#0066ff'],
  ['#005aff', '#4a8dff'],
  ['#0047c9', '#66a8ff'],
  ['#00256e', '#005aff'],
  ['#001a4d', '#003bb0'],
  ['#0052e0', '#80b8ff'],
  ['#00307a', '#0066ff'],
  ['#001c5c', '#3578e5'],
]

// Devuelve un gradiente deterministico para el nombre.
function gradientForName(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return ARTIST_GRADIENTS[Math.abs(hash) % ARTIST_GRADIENTS.length]
}

// Sticker color palette (legado, usado en filtro alfabético si aplica).
const STICKER_COLORS = [
  '#fef08a', // amarillo
  '#f87171', // rojo
  '#fb923c', // naranja
  '#a5b4fc', // índigo claro
  '#86efac', // verde
  '#f0abfc', // rosa pastel
  '#fcd34d', // ámbar
  '#7dd3fc', // celeste
]
const STICKER_ROTATIONS = [-5, 3, -3, 4, -4, 2, -2, 5]

function stickerStyle(index) {
  const color = STICKER_COLORS[index % STICKER_COLORS.length]
  const rotation = STICKER_ROTATIONS[index % STICKER_ROTATIONS.length]
  return `--sticker-bg: ${color}; --sticker-rot: ${rotation}deg`
}

function renderStickerAlbums(items) {
  return items
    .map((item, i) => {
      const artist = escapeHtml(item.artist)
      const album = escapeHtml(item.album)
      const coverHtml = item.cover
        ? `<img class="sticker-cover" src="${item.cover}" alt="" loading="lazy" />`
        : `<div class="sticker-cover sticker-cover-placeholder">♪</div>`
      return `
        <article class="sticker-card sticker-album collection-card"
                 style="${stickerStyle(i)}"
                 data-artist="${artist}" data-album="${album}">
          ${coverHtml}
          <div class="sticker-badge">★ ${item.rating}</div>
          <p class="sticker-title">${album}</p>
          <p class="sticker-sub">${artist}</p>
        </article>
      `
    })
    .join('')
}

function renderStickerArtists(items) {
  return items
    .map((item, i) => {
      const name = escapeHtml(item.name)
      const initial = escapeHtml(item.name.charAt(0).toUpperCase())
      const meta = item.meta ? escapeHtml(item.meta) : ''
      return `
        <article class="sticker-card sticker-artist artist-card"
                 style="${stickerStyle(i + 3)}"
                 data-artist="${name}">
          <div class="sticker-avatar">${initial}</div>
          <p class="sticker-title">${name}</p>
          ${meta ? `<p class="sticker-sub">${meta}</p>` : ''}
        </article>
      `
    })
    .join('')
}

// ──────────────────────────────────────────────
// Componentes estilo "OdbPro": rows, lista, banners
// ──────────────────────────────────────────────

function renderRowSection(title, cardsHtml) {
  if (!cardsHtml) return ''
  return `
    <section class="row-section">
      <header class="row-header">
        <h2 class="row-title">${title}</h2>
      </header>
      <div class="row-grid">${cardsHtml}</div>
    </section>
  `
}

function renderRowArtistCards(items) {
  return items
    .map((item) => {
      const name = escapeHtml(item.name)
      const initial = escapeHtml(item.name.charAt(0).toUpperCase())
      const [from, to] = gradientForName(item.name)
      const sub = item.meta ? escapeHtml(item.meta) : ''
      const rank = getMyTopRank(item.name)
      const badge = rank
        ? `<span class="row-rank-chip">★ #${rank}</span>`
        : ''
      return `
        <article class="row-card artist-card" data-artist="${name}">
          <div class="row-card-art" data-artist-img="${name}" style="background: linear-gradient(135deg, ${from} 0%, ${to} 100%)">
            <span class="row-card-initial">${initial}</span>
            ${badge}
          </div>
          <p class="row-card-title">${name}</p>
          ${sub ? `<p class="row-card-subtitle">${sub}</p>` : ''}
        </article>
      `
    })
    .join('')
}

function renderRowAlbumCards(items) {
  return items
    .map((item) => {
      const artist = escapeHtml(item.artist)
      const album = escapeHtml(item.album)
      const coverHtml = item.cover
        ? `<img class="row-card-art" src="${item.cover}" alt="" loading="lazy" />`
        : `<div class="row-card-art row-card-placeholder">♪</div>`
      return `
        <article class="row-card collection-card" data-artist="${artist}" data-album="${album}">
          ${coverHtml}
          <p class="row-card-title">${album}</p>
          <p class="row-card-subtitle">${artist}</p>
        </article>
      `
    })
    .join('')
}

function renderTopListSection(items) {
  if (items.length === 0) return ''
  const rendered = items
    .map((item) => {
      const artist = escapeHtml(item.artist)
      const album = escapeHtml(item.album)
      const coverHtml = item.cover
        ? `<img class="list-cover" src="${item.cover}" alt="" loading="lazy" />`
        : `<div class="list-cover list-cover-placeholder">♪</div>`
      const stars =
        '<span class="list-stars-filled">' +
        '★'.repeat(item.rating) +
        '</span>' +
        '★'.repeat(5 - item.rating)
      return `
        <article class="list-item collection-card" data-artist="${artist}" data-album="${album}">
          ${coverHtml}
          <div class="list-info">
            <p class="list-title">${album}</p>
            <p class="list-sub">${artist}</p>
          </div>
          <span class="list-stars" aria-label="${item.rating} de 5">${stars}</span>
        </article>
      `
    })
    .join('')
  return `
    <section class="list-section">
      <header class="row-header">
        <h2 class="row-title">Tu top calificados</h2>
      </header>
      <div class="list-grid">${rendered}</div>
    </section>
  `
}


function renderPromoBanner() {
  return `
    <section class="promo-banner">
      <div class="promo-banner-glyph" aria-hidden="true">
        <span>♫</span>
      </div>
      <div class="promo-banner-content">
        <p class="promo-banner-eyebrow">Spotify</p>
        <h2 class="promo-banner-title">Sígueme en Spotify</h2>
        <p class="promo-banner-text">Lo que estoy escuchando, mis playlists y mi flow musical en tiempo real.</p>
        <a class="promo-banner-btn" href="${SPOTIFY_URL}" target="_blank" rel="noopener noreferrer">
          Ir al perfil
        </a>
      </div>
    </section>
  `
}

function renderCtaBanner() {
  return `
    <section class="cta-banner">
      <div class="cta-banner-content">
        <h2 class="cta-banner-title">Toda mi música en un solo lugar.</h2>
        <p class="cta-banner-text">Conectado con Last.fm para mostrarte qué he escuchado, qué amo y a quién recomiendo. Mi historia musical vive aquí.</p>
        <a class="cta-banner-btn" href="https://www.last.fm/user/${LASTFM_USER}" target="_blank" rel="noopener noreferrer">
          Ver mi perfil en Last.fm
        </a>
      </div>
      <div class="cta-banner-art" aria-hidden="true">
        <span class="cta-banner-art-glyph">♪</span>
      </div>
    </section>
  `
}

function renderHome() {
  setActiveLetter(null)

  const topArtists = cachedTopArtists.slice(0, 5).map((a) => ({
    name: a.name,
    meta: formatMyPlays(a.playcount),
  }))

  const recentRated = getAllRatedAlbums()
    .sort((a, b) => b.ratedAt - a.ratedAt)
    .slice(0, 5)

  const topRated = getAllRatedAlbums()
    .sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating
      return b.ratedAt - a.ratedAt
    })
    .slice(0, 10)

  const viewed = getViewedArtists()
    .slice(0, 5)
    .map((v) => ({ name: v.name, meta: timeAgo(v.viewedAt) }))

  const sections = []

  if (topArtists.length > 0) {
    sections.push(
      renderRowSection('Mis más escuchados', renderRowArtistCards(topArtists))
    )
  }

  sections.push(renderPromoBanner())

  if (topRated.length > 0) {
    sections.push(renderTopListSection(topRated))
  }

  if (recentRated.length > 0) {
    sections.push(
      renderRowSection('Últimos calificados', renderRowAlbumCards(recentRated))
    )
  }

  sections.push(renderCtaBanner())

  if (viewed.length > 0) {
    sections.push(
      renderRowSection(
        'Artistas vistos recientemente',
        renderRowArtistCards(viewed)
      )
    )
  }

  resultsEl.innerHTML = sections.join('')
  populateArtistImages()
}

function renderArtists(artists) {
  if (artists.length === 0) {
    resultsEl.innerHTML = `<p class="hint">No encontramos artistas con ese nombre. Intenta otro.</p>`
    return
  }
  resultsEl.innerHTML = artists
    .map((artist) => {
      const name = escapeHtml(artist.name)
      const initial = escapeHtml(artist.name.charAt(0).toUpperCase())
      const listeners = formatListeners(artist.listeners)
      const rank = getMyTopRank(artist.name)
      const badge = rank
        ? `<span class="top-badge">★ #${rank} en tu top</span>`
        : ''
      return `
        <article class="artist-card" data-artist="${name}">
          <div class="artist-avatar" data-artist-img="${name}">${initial}</div>
          <div class="artist-info">
            <p class="artist-name">${name}${badge}</p>
            <p class="artist-listeners">${listeners}</p>
          </div>
        </article>
      `
    })
    .join('')
  populateArtistImages()
}

function renderSimilarArtists(artistName, similar) {
  if (similar.length === 0) return ''
  const escapedArtist = escapeHtml(artistName)
  const cards = similar
    .map((artist) => {
      const name = escapeHtml(artist.name)
      const initial = escapeHtml(artist.name.charAt(0).toUpperCase())
      const matchPercent = Math.round(parseFloat(artist.match) * 100)
      const rank = getMyTopRank(artist.name)
      const badge = rank ? `<span class="top-badge">★ #${rank}</span>` : ''
      return `
        <article class="artist-card similar-card" data-artist="${name}">
          <div class="artist-avatar" data-artist-img="${name}">${initial}</div>
          <div class="artist-info">
            <p class="artist-name">${name}${badge}</p>
            <p class="artist-listeners">${matchPercent}% similar</p>
          </div>
        </article>
      `
    })
    .join('')
  return `
    <section class="similar-section">
      <h3 class="similar-heading">Si te gusta ${escapedArtist}, también te puede gustar:</h3>
      <div class="similar-grid">${cards}</div>
    </section>
  `
}

function renderAlbums(artistName, albums, similar = []) {
  const escapedArtist = escapeHtml(artistName)
  const backBtn = `<button class="back-btn" id="back-btn">← Volver</button>`

  if (albums.length === 0) {
    resultsEl.innerHTML = `
      ${backBtn}
      <p class="hint">No encontramos álbumes para ${escapedArtist}.</p>
      ${renderSimilarArtists(artistName, similar)}
    `
    return
  }

  const grid = albums
    .map((album) => {
      const name = escapeHtml(album.name)
      const cover = getImageUrl(album.image, 'large')
      const plays = formatPlaycount(album.playcount)
      const currentRating = getRating(artistName, album.name)
      const coverHtml = cover
        ? `<img class="album-cover" src="${cover}" alt="Portada de ${name}" loading="lazy" />`
        : `<div class="album-cover album-cover-placeholder">♪</div>`
      return `
        <article class="album-card" data-artist="${escapedArtist}" data-album="${name}">
          ${coverHtml}
          <div class="album-info">
            <p class="album-name">${name}</p>
            <p class="album-plays">${plays}</p>
            <div class="rating">${renderStars(currentRating)}</div>
          </div>
        </article>
      `
    })
    .join('')

  resultsEl.innerHTML = `
    ${backBtn}
    <h2 class="artist-heading">${escapedArtist}</h2>
    <div class="album-grid">${grid}</div>
    ${renderSimilarArtists(artistName, similar)}
  `
}

function renderCollection() {
  setActiveLetter(null)
  const items = getAllRatedAlbums()
  items.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating
    return a.artist.localeCompare(b.artist, 'es')
  })

  if (items.length === 0) {
    resultsEl.innerHTML = `
      <div class="empty-collection">
        <p class="empty-collection-emoji">🎵</p>
        <p>Aún no has calificado ningún álbum.</p>
        <p class="hint">Busca un artista y marca tus favoritos con estrellas.</p>
      </div>
    `
    return
  }

  const total = items.length
  resultsEl.innerHTML = `
    <h2 class="artist-heading">Mi colección · ${total} álbum${total !== 1 ? 'es' : ''}</h2>
    <div class="album-grid">${renderAlbumCardsRow(items)}</div>
  `
}

// Filtro alfabético: muestra los artistas que conoces — del Top de Last.fm,
// de los álbumes calificados y de los vistos recientemente.
function renderLetterFilter(letter) {
  setActiveLetter(letter)

  // Reunimos artistas de las tres fuentes con info contextual
  const fromTop = cachedTopArtists.map((a, i) => ({
    name: a.name,
    source: 'top',
    rank: i + 1,
    plays: a.playcount,
  }))
  const fromRated = getAllRatedAlbums().map((r) => ({
    name: r.artist,
    source: 'rated',
  }))
  const fromViewed = getViewedArtists().map((v) => ({
    name: v.name,
    source: 'viewed',
    viewedAt: v.viewedAt,
  }))

  // Deduplicamos por nombre (lowercase) manteniendo la primera aparición.
  // Como Top va primero, gana sobre rated y viewed si hay duplicados.
  const seen = new Map()
  for (const artist of [...fromTop, ...fromRated, ...fromViewed]) {
    const key = artist.name.toLowerCase()
    if (!seen.has(key)) seen.set(key, artist)
  }

  const matches = Array.from(seen.values())
    .filter((a) => a.name.charAt(0).toUpperCase() === letter)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  if (matches.length === 0) {
    resultsEl.innerHTML = `
      <h2 class="artist-heading">Artistas con "${letter}"</h2>
      <p class="hint">No tienes artistas con "${letter}". Cuando escuches o califiques alguno, aparecerá aquí.</p>
    `
    return
  }

  // Cada card lleva su contexto en el meta
  const cards = matches.map((a) => {
    let meta = ''
    if (a.source === 'top') {
      meta = `#${a.rank} · ${formatMyPlays(a.plays)}`
    } else if (a.source === 'viewed') {
      meta = `Visto ${timeAgo(a.viewedAt)}`
    } else if (a.source === 'rated') {
      meta = 'En tu colección'
    }
    return { name: a.name, meta }
  })

  resultsEl.innerHTML = `
    <h2 class="artist-heading">Artistas con "${letter}" · ${matches.length}</h2>
    <div class="letter-grid">${renderArtistCardsRow(cards)}</div>
  `
  populateArtistImages()
}

// ──────────────────────────────────────────────
// Acciones (orquestan API + render)
// ──────────────────────────────────────────────

function formatDuration(seconds) {
  const num = parseInt(seconds, 10)
  if (isNaN(num) || num === 0) return ''
  const mins = Math.floor(num / 60)
  const secs = num % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function renderTrackStars(rating) {
  const out = []
  for (let value = 5; value >= 1; value--) {
    const filled = value <= rating ? 'star-filled' : ''
    out.push(
      `<button type="button" class="star track-star ${filled}" data-value="${value}" aria-label="${value} estrellas">★</button>`
    )
  }
  return out.join('')
}

function renderTracks(artist, album, tracks) {
  if (tracks.length === 0) {
    return `<p class="hint">No tenemos las canciones de este álbum.</p>`
  }
  const escArtist = escapeHtml(artist)
  const escAlbum = escapeHtml(album)
  return `
    <div class="tracks-list">
      ${tracks
        .map((t, i) => {
          const name = escapeHtml(t.name)
          const duration = formatDuration(t.duration)
          const rating = getTrackRating(artist, album, t.name)
          return `
            <article class="track-row" data-artist="${escArtist}" data-album="${escAlbum}" data-track="${name}">
              <span class="track-number">${(i + 1).toString().padStart(2, '0')}</span>
              <span class="track-name">${name}</span>
              <span class="track-duration">${duration}</span>
              <div class="rating track-rating">${renderTrackStars(rating)}</div>
            </article>
          `
        })
        .join('')}
    </div>
  `
}

function renderAlbumSidebar(currentAlbum, otherAlbums) {
  const filtered = otherAlbums
    .filter((a) => a.name !== currentAlbum)
    .slice(0, 6)
  if (filtered.length === 0) return ''
  return `
    <aside class="album-sidebar">
      <h3 class="sidebar-heading">Más del artista</h3>
      <div class="sidebar-grid">
        ${filtered
          .map((a) => {
            const name = escapeHtml(a.name)
            const cover = getImageUrl(a.image, 'large')
            const coverHtml = cover
              ? `<img class="sidebar-album-cover" src="${cover}" alt="" loading="lazy" />`
              : `<div class="sidebar-album-cover sidebar-album-cover-placeholder">♪</div>`
            return `
              <article class="sidebar-album collection-card" data-artist="${escapeHtml(a.artist?.name || '')}" data-album="${name}">
                ${coverHtml}
                <p class="sidebar-album-title">${name}</p>
              </article>
            `
          })
          .join('')}
      </div>
    </aside>
  `
}

function renderAlbumDetail(artist, album, cover, info, otherAlbums) {
  const tracksRaw = info?.tracks?.track || []
  const tracks = Array.isArray(tracksRaw) ? tracksRaw : [tracksRaw]

  const albumCover =
    cover ||
    getImageUrl(info?.image, 'extralarge') ||
    getImageUrl(info?.image, 'large')

  const avgRating = computeAlbumAvg(artist, album)
  const ratedTracks = tracks.filter((t) =>
    getTrackRating(artist, album, t.name)
  ).length

  const tags = (info?.tags?.tag || []).slice(0, 4)
  const tagsHtml = tags
    .map((t) => `<span class="album-tag">${escapeHtml(t.name)}</span>`)
    .join('')

  const listeners = info?.listeners ? formatListeners(info.listeners) : ''
  const playcount = info?.playcount ? formatPlaycount(info.playcount) : ''

  const escArtist = escapeHtml(artist)
  const escAlbum = escapeHtml(album)

  const coverHtml = albumCover
    ? `<img class="album-hero-cover-img" src="${albumCover}" alt="Portada de ${escAlbum}" />`
    : `<div class="album-hero-cover-img album-hero-cover-placeholder">♪</div>`

  const starsDisplay = '★'
    .repeat(avgRating)
    .padEnd(5, '☆')
    .split('')
    .map((s) =>
      s === '★'
        ? '<span class="album-hero-star album-hero-star-filled">★</span>'
        : '<span class="album-hero-star">☆</span>'
    )
    .join('')

  resultsEl.innerHTML = `
    <button class="back-btn" id="back-btn" data-action="to-artist" data-artist="${escArtist}">← Volver a ${escArtist}</button>

    <section class="album-hero">
      <div class="album-hero-cover">${coverHtml}</div>
      <div class="album-hero-info">
        <p class="album-hero-eyebrow">${escArtist}</p>
        <h1 class="album-hero-title">${escAlbum}</h1>
        <div class="album-hero-rating">
          <div class="album-hero-stars">${starsDisplay}</div>
          <span class="album-hero-rating-meta">
            ${
              ratedTracks > 0
                ? `${avgRating}/5 · promedio de ${ratedTracks} ${ratedTracks === 1 ? 'canción' : 'canciones'} calificada${ratedTracks === 1 ? '' : 's'}`
                : 'Califica las canciones para obtener tu rating del álbum'
            }
          </span>
        </div>
        ${tagsHtml ? `<div class="album-tags">${tagsHtml}</div>` : ''}
        <div class="album-hero-meta">
          ${tracks.length > 0 ? `<span>${tracks.length} canciones</span>` : ''}
          ${listeners ? `<span>${listeners}</span>` : ''}
          ${playcount ? `<span>${playcount}</span>` : ''}
        </div>
      </div>
    </section>

    <section class="album-body">
      <div class="tracks-panel">
        <h3 class="tracks-heading">Canciones</h3>
        ${renderTracks(artist, album, tracks)}
      </div>
      ${renderAlbumSidebar(album, otherAlbums)}
    </section>
  `
  populateArtistImages()
}

async function showAlbumDetail(artist, album, cover = '') {
  resultsEl.innerHTML = `<p class="hint">Cargando ${escapeHtml(album)}...</p>`
  try {
    const [info, otherAlbums] = await Promise.all([
      fetchAlbumInfo(artist, album).catch(() => null),
      fetchTopAlbums(artist).catch(() => []),
    ])
    renderAlbumDetail(artist, album, cover, info, otherAlbums)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (error) {
    console.error('Error cargando álbum:', error)
    resultsEl.innerHTML = `<p class="error">No pudimos cargar este álbum. Intenta de nuevo.</p>`
  }
}

async function showArtistAlbums(artistName) {
  addViewedArtist(artistName)
  setActiveLetter(null)
  resultsEl.innerHTML = `<p class="hint">Cargando álbumes de ${escapeHtml(artistName)}...</p>`
  try {
    const [albums, similar] = await Promise.all([
      fetchTopAlbums(artistName),
      fetchSimilarArtists(artistName).catch(() => []),
    ])
    renderAlbums(artistName, albums, similar)
    populateArtistImages()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (error) {
    console.error('Error cargando álbumes:', error)
    resultsEl.innerHTML = `<p class="error">No pudimos cargar los álbumes. Intenta de nuevo.</p>`
  }
}

async function refreshNowPlaying() {
  try {
    const track = await fetchNowPlaying()
    if (!track) {
      nowPlayingEl.hidden = true
      return
    }
    const label = track.nowPlaying
      ? `<span class="now-playing-pulse"></span> Sonando ahora`
      : `Última escucha · ${timeAgo(track.when)}`
    const cover = track.image
      ? `<img class="now-playing-cover" src="${track.image}" alt="" />`
      : `<div class="now-playing-cover now-playing-cover-placeholder">♪</div>`
    nowPlayingEl.innerHTML = `
      ${cover}
      <div class="now-playing-info">
        <p class="now-playing-label">${label}</p>
        <p class="now-playing-track">${escapeHtml(track.name)}</p>
        <p class="now-playing-artist">${escapeHtml(track.artist)}</p>
      </div>
    `
    nowPlayingEl.hidden = false
  } catch (error) {
    console.warn('No pudimos cargar Listen now:', error)
    nowPlayingEl.hidden = true
  }
}

// ──────────────────────────────────────────────
// Eventos
// ──────────────────────────────────────────────

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const query = input.value.trim()
  if (!query) return

  setActiveTab('search')
  setActiveLetter(null)
  resultsEl.innerHTML = `<p class="hint">Buscando "${escapeHtml(query)}"...</p>`

  try {
    const artists = await searchArtists(query)
    lastSearchResults = artists
    renderArtists(artists)
  } catch (error) {
    console.error('Error buscando artistas:', error)
    resultsEl.innerHTML = `<p class="error">No pudimos completar la búsqueda. Revisa tu conexión e intenta de nuevo.</p>`
  }
})

// Brand click → home
document.querySelectorAll('[data-view="home"]').forEach((el) => {
  el.addEventListener('click', (event) => {
    event.preventDefault()
    renderHome()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
})

// Alphabet bar
document.querySelectorAll('.letter').forEach((btn) => {
  btn.addEventListener('click', () => {
    const letter = btn.dataset.letter
    if (currentLetter === letter) {
      renderHome()
    } else {
      renderLetterFilter(letter)
    }
  })
})

// Resultados (delegation para clicks en estrellas, tarjetas, back)
resultsEl.addEventListener('click', (event) => {
  // Click en estrella de TRACK → rating individual de canción
  const trackStar = event.target.closest('.track-star')
  if (trackStar) {
    event.stopPropagation()
    const row = trackStar.closest('.track-row')
    if (!row) return
    const artist = row.dataset.artist
    const album = row.dataset.album
    const track = row.dataset.track
    const value = parseInt(trackStar.dataset.value, 10)
    const current = getTrackRating(artist, album, track)
    const newValue = current === value ? 0 : value
    // Buscamos el cover en el hero del álbum para guardarlo si falta
    const cover =
      document.querySelector('.album-hero-cover-img')?.src ?? ''
    setTrackRating(artist, album, track, newValue, cover)
    updateRatingDisplay(trackStar.closest('.rating'), newValue)
    return
  }

  // Click en estrella de ALBUM card (vista artista, colección, dashboard)
  const star = event.target.closest('.star')
  if (star) {
    event.stopPropagation()
    const card = star.closest('.album-card')
    if (!card) return
    const artist = card.dataset.artist
    const album = card.dataset.album
    const value = parseInt(star.dataset.value, 10)
    const current = getRating(artist, album)
    const newValue = current === value ? 0 : value
    const coverImg = card.querySelector('img.album-cover')
    const cover = coverImg?.src ?? ''
    setRating(artist, album, newValue, cover)
    updateRatingDisplay(star.closest('.rating'), newValue)
    return
  }

  // Click en una card de álbum (artista o colección) → abrir detalle
  const albumCard = event.target.closest('.album-card, .collection-card, .sidebar-album')
  if (albumCard && albumCard.dataset.album) {
    const artist = albumCard.dataset.artist
    const album = albumCard.dataset.album
    const coverImg =
      albumCard.querySelector('img.album-cover, img.sidebar-album-cover')
    const cover = coverImg?.src ?? ''
    showAlbumDetail(artist, album, cover)
    return
  }

  // Click en card de artista
  const artistCard = event.target.closest('.artist-card')
  if (artistCard) {
    showArtistAlbums(artistCard.dataset.artist)
    return
  }

  // Botón volver: el destino depende del data-action
  const backBtn = event.target.closest('#back-btn')
  if (backBtn) {
    const action = backBtn.dataset.action
    if (action === 'to-artist' && backBtn.dataset.artist) {
      showArtistAlbums(backBtn.dataset.artist)
    } else {
      setActiveLetter(null)
      if (lastSearchResults.length > 0) {
        setActiveTab('search')
        renderArtists(lastSearchResults)
      } else {
        renderHome()
      }
    }
  }
})

// ──────────────────────────────────────────────
// Arranque
// ──────────────────────────────────────────────
renderHome()
refreshNowPlaying()
setInterval(refreshNowPlaying, NOW_PLAYING_REFRESH_MS)

// Cargar top artistas en segundo plano. Cuando terminan,
// re-renderizamos la vista actual para incluirlos.
loadTopArtists().then(() => {
  if (resultsEl.querySelector('.row-section, .events-section, .list-section')) {
    renderHome()
  } else if (currentLetter) {
    renderLetterFilter(currentLetter)
  }
})
