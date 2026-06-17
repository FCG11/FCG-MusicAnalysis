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
// Hero cards flotantes (estilo Pallet Ross)
// ──────────────────────────────────────────────

function artistUsername(name) {
  return '@' + name.toLowerCase().replace(/[^a-záéíóúñ0-9]/gi, '')
}

function populateHeroCards() {
  const container = document.querySelector('#hero-cards')
  if (!container) return

  const top4 = cachedTopArtists.slice(0, 4)
  const cards = []

  // 4 cards de tus top artistas
  for (let i = 0; i < top4.length; i++) {
    const artist = top4[i]
    cards.push({
      name: artist.name,
      username: artistUsername(artist.name),
      kind: 'artist',
    })
  }

  // 5ta card: tu foto personal como curador
  cards.push({
    name: 'fabisparrow',
    username: '@fabisparrow',
    kind: 'self',
    image: '/hero.jpg',
  })

  if (cards.length === 0) return

  container.innerHTML = cards
    .map((card, i) => {
      const initial = (card.name.charAt(0) || '?').toUpperCase()
      const escName = escapeHtml(card.name)
      const escUser = escapeHtml(card.username)

      if (card.kind === 'self') {
        return `
          <article class="float-card float-card-${i + 1} float-card-self">
            <div class="float-card-cover">
              <img class="float-card-img" src="${card.image}" alt="Tu foto" />
            </div>
            <span class="float-card-name">${escUser}</span>
          </article>
        `
      }

      const [from, to] = gradientForName(card.name)
      return `
        <article class="float-card float-card-${i + 1} artist-card" data-artist="${escName}">
          <div class="float-card-cover" data-artist-img="${escName}" style="background: linear-gradient(135deg, ${from} 0%, ${to} 100%)">
            <span class="float-card-initial">${escapeHtml(initial)}</span>
          </div>
          <span class="float-card-name">${escUser}</span>
        </article>
      `
    })
    .join('')

  // Si ya tenemos imágenes cacheadas, las traemos
  populateArtistImages()
}

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
    <div class="hero-cards" id="hero-cards"></div>

    <div class="hero-content">
      <p class="hero-eyebrow">Bienvenido a tu galería musical</p>
      <h1 class="hero-title">Un lugar para tu<br/>obsesión musical.</h1>
      <p class="hero-subtitle">Explora artistas, califica álbumes y descubre quién te mueve. Tu música, tu colección, tu historia.</p>
      <div class="hero-ctas">
        <a class="hero-cta-primary" href="${SPOTIFY_URL}" target="_blank" rel="noopener noreferrer">Sígueme en Spotify</a>
        <a class="hero-cta-secondary" href="#empieza" id="hero-explore">Empezar a explorar →</a>
      </div>
    </div>

    <div class="now-playing-wrap">
      <div class="now-playing" id="now-playing" hidden></div>
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

  <footer class="site-footer">
    <div class="site-footer-inner">
      <div class="footer-brand">
        <p class="footer-logo">FCG · MusicAnalysis</p>
        <p class="footer-tagline">Un lugar para tu obsesión musical. Construido con Last.fm + Deezer.</p>
      </div>
      <div class="footer-links">
        <a href="https://github.com/FCG11/FCG-MusicAnalysis" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://www.last.fm/user/${LASTFM_USER}" target="_blank" rel="noopener noreferrer">Last.fm</a>
        <a href="${SPOTIFY_URL}" target="_blank" rel="noopener noreferrer">Spotify</a>
      </div>
      <p class="footer-copy">© 2026 · FCG · All rights reserved.</p>
    </div>
  </footer>
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

// ──────────────────────────────────────────────
// Carrusel vertical infinito (Showcase Pallet Ross)
// ──────────────────────────────────────────────

function renderVerticalCarousel(artists) {
  if (artists.length === 0) return ''

  // Duplicamos las cards para crear el loop infinito perfecto.
  // El CSS anima -50% del track, así el set duplicado queda donde
  // empezó el primero.
  const doubled = [...artists, ...artists]

  const cards = doubled
    .map((artist) => {
      const name = escapeHtml(artist.name)
      const username = escapeHtml(artistUsername(artist.name))
      const [from, to] = gradientForName(artist.name)
      const initial = artist.name.charAt(0).toUpperCase()
      const playsLabel = formatMyPlays(artist.playcount)
      return `
        <article class="vcard artist-card" data-artist="${name}">
          <div class="vcard-cover" data-artist-img="${name}" style="background: linear-gradient(135deg, ${from} 0%, ${to} 100%)">
            <span class="vcard-initial">${escapeHtml(initial)}</span>
          </div>
          <div class="vcard-info">
            <p class="vcard-name">${name}</p>
            <p class="vcard-username">${username}${playsLabel ? ` · ${escapeHtml(playsLabel)}` : ''}</p>
          </div>
        </article>
      `
    })
    .join('')

  return `
    <section class="showcase-section">
      <div class="showcase-text">
        <p class="showcase-eyebrow">Showcase</p>
        <h2 class="showcase-title">Tus artistas<br/>en rotación.</h2>
        <p class="showcase-sub">Los que más escuchas en Last.fm pasan uno tras otro, como una galería viviente. Pasa el cursor sobre la lista para pausarla.</p>
      </div>
      <div class="vcarousel">
        <div class="vcarousel-track">
          ${cards}
        </div>
      </div>
    </section>
  `
}

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

// ──────────────────────────────────────────────
// "Acceso exclusivo a tu archivo": constelación de cards floating
// ──────────────────────────────────────────────

// Posiciones predefinidas para la constelación. Hasta 10 cards
// flotantes alrededor del texto centrado. Cada una con su tamaño y rotación
// determinística para consistencia visual.
const CONSTEL_POSITIONS = [
  { top: '0%',    left: '8%',   size: 'md', rot: -10 },
  { top: '10%',   left: '30%',  size: 'sm', rot: 7   },
  { top: '4%',    left: '54%',  size: 'md', rot: 13  },
  { top: '0%',    right: '5%',  size: 'lg', rot: -6  },
  { top: '40%',   left: '0%',   size: 'lg', rot: 4   },
  { top: '38%',   right: '0%',  size: 'sm', rot: 12  },
  { bottom: '10%', left: '13%', size: 'lg', rot: 5   },
  { bottom: '0%', left: '40%',  size: 'md', rot: -9  },
  { bottom: '14%', right: '22%', size: 'sm', rot: 14 },
  { bottom: '5%', right: '4%',  size: 'md', rot: -5  },
]

function renderRecentRatedConstellation(items) {
  if (items.length === 0) return ''

  const max = Math.min(items.length, CONSTEL_POSITIONS.length)
  const cards = items.slice(0, max)

  const cardHtml = cards
    .map((item, i) => {
      const pos = CONSTEL_POSITIONS[i]
      const placement = Object.entries(pos)
        .filter(([k]) => !['size', 'rot'].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')
      const artist = escapeHtml(item.artist)
      const album = escapeHtml(item.album)
      const coverHtml = item.cover
        ? `<img class="constel-cover" src="${item.cover}" alt="${album}" loading="lazy" />`
        : `<div class="constel-cover constel-placeholder">♪</div>`
      return `
        <article class="constel-card constel-card-${pos.size} collection-card"
                 data-artist="${artist}" data-album="${album}"
                 style="${placement}; --rot: ${pos.rot}deg;"
                 title="${album} · ${artist}">
          ${coverHtml}
          <p class="constel-label">${album}</p>
        </article>
      `
    })
    .join('')

  return `
    <section class="constel-section">
      <div class="constel-stage">
        ${cardHtml}
        <div class="constel-center">
          <h2 class="constel-title">Acceso exclusivo<br/>a tu archivo.</h2>
          <p class="constel-sub">Las últimas obras que calificaste, flotando alrededor como tus reflejos musicales más recientes.</p>
        </div>
      </div>
      <a class="constel-visit" href="#" id="constel-visit">↗ Calificar más</a>
    </section>
  `
}

// ──────────────────────────────────────────────
// "Tus obras maestras": fan arqueado estilo Pallet Ross hero
// ──────────────────────────────────────────────

function renderTopRatedFan(items) {
  if (items.length === 0) return ''

  // Hasta 7 cards, centradas. Si hay menos, igual quedan alineadas.
  const fanCount = Math.min(items.length, 7)
  const cards = items.slice(0, fanCount)
  const centerIdx = (fanCount - 1) / 2 // 3 para 7 cards, 2 para 5, etc.

  const cardHtml = cards
    .map((item, i) => {
      const mult = i - centerIdx // pos relativa al centro: -3, -2, ..., 3
      const absMult = Math.abs(mult)
      const z = Math.round(10 - absMult * 2)
      const artist = escapeHtml(item.artist)
      const album = escapeHtml(item.album)
      const coverHtml = item.cover
        ? `<img class="top-fan-cover" src="${item.cover}" alt="${album}" loading="lazy" />`
        : `<div class="top-fan-cover top-fan-placeholder">♪</div>`
      return `
        <article class="top-fan-card collection-card"
                 data-artist="${artist}" data-album="${album}"
                 title="${album} · ${artist}"
                 style="--mult: ${mult}; --abs-mult: ${absMult}; z-index: ${z};">
          ${coverHtml}
        </article>
      `
    })
    .join('')

  // Speech bubbles: usar primer y último artista del fan
  const leftCard = cards[0]
  const rightCard = cards[cards.length - 1]
  const bubbleLeft = leftCard
    ? `<div class="top-fan-bubble top-fan-bubble-blue">${escapeHtml(artistUsername(leftCard.artist))}</div>`
    : ''
  const bubbleRight = rightCard && rightCard !== leftCard
    ? `<div class="top-fan-bubble top-fan-bubble-green">${escapeHtml(artistUsername(rightCard.artist))}</div>`
    : ''

  return `
    <section class="top-fan-section">
      <h2 class="top-fan-title">Un lugar para<br/>tus obras maestras.</h2>
      <div class="top-fan-stage">
        ${bubbleLeft}${bubbleRight}
        ${cardHtml}
      </div>
      <p class="top-fan-sub">Los álbumes que mejor te han pegado, ordenados por tu rating. Cada portada es una decisión tuya, una historia que llevás.</p>
      <div class="top-fan-ctas">
        <a class="top-fan-cta-primary" href="#" id="top-fan-explore">Calificar más álbumes</a>
        <a class="top-fan-cta-secondary" href="#" id="top-fan-readmore">Leer más →</a>
      </div>
    </section>
  `
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


// ──────────────────────────────────────────────
// FASE 4: Mosaico de avatares (direcciones opuestas)
// ──────────────────────────────────────────────

function renderAvatarMosaic() {
  // Reunimos artistas únicos del top + calificados + vistos
  const fromTop = cachedTopArtists.map((a) => a.name)
  const fromRated = getAllRatedAlbums().map((r) => r.artist)
  const fromViewed = getViewedArtists().map((v) => v.name)
  const all = [...new Set([...fromTop, ...fromRated, ...fromViewed])]

  if (all.length < 6) return ''

  // Hasta 28 artistas, partidos en 2 filas
  const picked = all.slice(0, 28)
  const half = Math.ceil(picked.length / 2)
  const row1 = picked.slice(0, half)
  const row2 = picked.slice(half)

  const renderRow = (names) => {
    // Duplicamos para loop infinito perfecto
    const doubled = [...names, ...names]
    return doubled
      .map((name) => {
        const [from, to] = gradientForName(name)
        const initial = name.charAt(0).toUpperCase()
        const escName = escapeHtml(name)
        return `
          <div class="mosaic-avatar artist-card" data-artist="${escName}" title="${escName}">
            <div class="mosaic-avatar-img" data-artist-img="${escName}" style="background: linear-gradient(135deg, ${from} 0%, ${to} 100%)">
              <span class="mosaic-avatar-initial">${escapeHtml(initial)}</span>
            </div>
          </div>
        `
      })
      .join('')
  }

  return `
    <section class="mosaic-section">
      <div class="mosaic-text">
        <p class="mosaic-eyebrow">Comunidad</p>
        <h2 class="mosaic-title">Estás entre los tuyos.</h2>
        <p class="mosaic-sub">Toda la gente que pasa por tu radar musical, en movimiento.</p>
      </div>
      <div class="mosaic-rows">
        <div class="mosaic-row mosaic-row-left">${renderRow(row1)}</div>
        <div class="mosaic-row mosaic-row-right">${renderRow(row2)}</div>
      </div>
    </section>
  `
}

// ──────────────────────────────────────────────
// FASE 5: Color blocks (banner naranja + stats)
// ──────────────────────────────────────────────

function renderFeaturedBlock() {
  const featured = cachedTopArtists[0]
  if (!featured) return ''
  const name = escapeHtml(featured.name)
  const username = escapeHtml(artistUsername(featured.name))
  const plays = formatMyPlays(featured.playcount)
  const [from, to] = gradientForName(featured.name)
  const initial = featured.name.charAt(0).toUpperCase()
  return `
    <section class="featured-banner artist-card" data-artist="${name}">
      <div class="featured-banner-content">
        <p class="featured-banner-eyebrow">Featured · #1 en tu top</p>
        <h2 class="featured-banner-title">CLASS BY<br/>${name.toUpperCase()}</h2>
        <p class="featured-banner-meta">${username} · ${escapeHtml(plays)}</p>
        <button class="featured-banner-cta" type="button">
          Ver perfil completo →
        </button>
      </div>
      <div class="featured-banner-image" data-artist-img="${name}" style="background: linear-gradient(135deg, ${from} 0%, ${to} 100%)">
        <span class="featured-banner-initial">${escapeHtml(initial)}</span>
      </div>
    </section>
  `
}

function renderStatsBlocks() {
  const ratedAlbums = getAllRatedAlbums().length
  const ratedTracks = Object.keys(loadTrackRatings()).length
  const exploredArtists = getViewedArtists().length
  const topListens = cachedTopArtists[0]
    ? parseInt(cachedTopArtists[0].playcount || '0', 10)
    : 0

  return `
    <section class="blocks-grid">
      <div class="color-block color-block-blue">
        <p class="color-block-eyebrow">Where music breathes</p>
        <h3 class="color-block-title">Tu colección,<br/>tu identidad.</h3>
        <p class="color-block-text">Cada estrella es una decisión.<br/>Cada artista, una historia.</p>
      </div>
      <div class="color-block color-block-green">
        <p class="color-block-eyebrow">Tu universo en números</p>
        <div class="color-block-stats">
          <div><strong>${ratedAlbums}</strong><span>álbumes calificados</span></div>
          <div><strong>${ratedTracks}</strong><span>canciones con rating</span></div>
          <div><strong>${exploredArtists}</strong><span>artistas explorados</span></div>
          ${topListens > 0 ? `<div><strong>${formatMyPlays(topListens)}</strong><span>de tu #1 en Last.fm</span></div>` : ''}
        </div>
      </div>
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
  document.body.classList.remove('album-mode')
  setActiveLetter(null)

  const topArtists = cachedTopArtists.slice(0, 5).map((a) => ({
    name: a.name,
    meta: formatMyPlays(a.playcount),
  }))

  const recentRated = getAllRatedAlbums()
    .sort((a, b) => b.ratedAt - a.ratedAt)
    .slice(0, 10)

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

  // Fase 3 — Showcase: carrusel vertical infinito con top 10 artistas
  const top10 = cachedTopArtists.slice(0, 10)
  if (top10.length > 0) {
    sections.push(renderVerticalCarousel(top10))
  }

  // Fase 5 — Featured Artist (banner naranja con #1 de Last.fm)
  sections.push(renderFeaturedBlock())

  // Fan estilo Pallet Ross: tus obras maestras (top calificados)
  if (topRated.length > 0) {
    sections.push(renderTopRatedFan(topRated))
  }

  // Fase 5 — Bloques azul + verde con stats personales
  sections.push(renderStatsBlocks())

  // Últimos calificados — constelación floating estilo Pallet Ross
  if (recentRated.length > 0) {
    sections.push(renderRecentRatedConstellation(recentRated))
  }

  resultsEl.innerHTML = sections.join('')
  populateArtistImages()
}

function renderArtists(artists) {
  document.body.classList.remove('album-mode')
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
  document.body.classList.remove('album-mode')
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

// Limpia el HTML del wiki de Last.fm (quita tags y enlaces) y trunca.
function cleanWikiSummary(wiki) {
  if (!wiki) return ''
  const clean = wiki
    .replace(/<a[^>]*>.*?<\/a>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= 360) return clean
  return clean.substring(0, 360).replace(/\s+\S*$/, '') + '…'
}

// Año desde el campo published del wiki ("Mon, 04 Aug 2018 …")
function extractYearFromWiki(wiki) {
  const match = wiki?.published?.match(/\b(19|20)\d{2}\b/)
  return match ? match[0] : ''
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

  const totalSeconds = tracks.reduce(
    (sum, t) => sum + (parseInt(t.duration, 10) || 0),
    0
  )
  const totalMins = Math.round(totalSeconds / 60)
  const year = extractYearFromWiki(info?.wiki)
  const wikiSummary = cleanWikiSummary(info?.wiki?.summary)

  const escArtist = escapeHtml(artist)
  const escAlbum = escapeHtml(album)

  const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(
    artist + ' ' + album
  )}`

  const coverHtml = albumCover
    ? `<img class="album-page-cover-img" src="${albumCover}" alt="Portada de ${escAlbum}" />`
    : `<div class="album-page-cover-img album-page-cover-placeholder">♪</div>`

  const starsHtml = Array.from({ length: 5 }, (_, i) => {
    const filled = i < avgRating
    return `<span class="album-page-star ${filled ? 'album-page-star-filled' : ''}">★</span>`
  }).join('')

  const tracksHtml =
    tracks.length > 0
      ? tracks
          .map((t, i) => {
            const name = escapeHtml(t.name)
            const duration = formatDuration(t.duration)
            const num = (i + 1).toString().padStart(2, '0')
            const rating = getTrackRating(artist, album, t.name)
            return `
              <li class="album-page-track" data-artist="${escArtist}" data-album="${escAlbum}" data-track="${name}">
                <span class="album-page-track-num">${num}.</span>
                <span class="album-page-track-name">${name}</span>
                <span class="album-page-track-dur">${duration}</span>
                <div class="rating album-page-track-rating">${renderTrackStars(rating)}</div>
              </li>
            `
          })
          .join('')
      : `<li class="album-page-track-empty">No tenemos las canciones de este álbum.</li>`

  const otherCovers = otherAlbums
    .filter((a) => a.name !== album)
    .slice(0, 10)
  const otherHtml = otherCovers
    .map((a) => {
      const cv = getImageUrl(a.image, 'large')
      const an = escapeHtml(a.name)
      const ar = escapeHtml(a.artist?.name || artist)
      const cvHtml = cv
        ? `<img class="album-other-img" src="${cv}" alt="${an}" loading="lazy" />`
        : `<div class="album-other-img album-other-placeholder">♪</div>`
      return `
        <article class="album-other-card collection-card" data-artist="${ar}" data-album="${an}" title="${an}">
          ${cvHtml}
        </article>
      `
    })
    .join('')

  resultsEl.innerHTML = `
    <button class="back-btn album-page-back" id="back-btn" data-action="to-artist" data-artist="${escArtist}">← Volver</button>

    <article class="album-page">
      <div class="album-page-grid">
        <div class="album-page-art">
          <div class="album-page-cover-frame">
            ${coverHtml}
            <div class="album-page-vinyl"></div>
          </div>
        </div>

        <div class="album-page-info">
          <h1 class="album-page-title">${escAlbum}</h1>
          <p class="album-page-meta">
            ${year ? `<span>${year}</span>` : ''}
            <span>${tracks.length} tracks</span>
            ${totalMins > 0 ? `<span>${totalMins} min</span>` : ''}
          </p>

          <a class="album-page-spotify" href="${spotifyUrl}" target="_blank" rel="noopener noreferrer">
            <span class="album-page-spotify-dot"></span>
            Listen on Spotify
          </a>

          <div class="album-page-rating-box">
            <div class="album-page-stars">${starsHtml}</div>
            <p class="album-page-rating-meta">
              ${
                ratedTracks > 0
                  ? `${avgRating}/5 — promedio de ${ratedTracks} ${ratedTracks === 1 ? 'canción calificada' : 'canciones calificadas'}`
                  : 'Califica las canciones para obtener tu rating del álbum'
              }
            </p>
          </div>

          ${wikiSummary ? `<p class="album-page-description">${escapeHtml(wikiSummary)}</p>` : ''}

          <p class="album-page-artist-mark">"${escArtist.toUpperCase()}"</p>
        </div>

        <ol class="album-page-tracks">
          ${tracksHtml}
        </ol>
      </div>

      ${
        otherHtml
          ? `<div class="album-page-other">
               <div class="album-page-other-track">${otherHtml}</div>
             </div>`
          : ''
      }
    </article>
  `
  populateArtistImages()
}

async function showAlbumDetail(artist, album, cover = '') {
  document.body.classList.add('album-mode')
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
  document.body.classList.remove('album-mode')
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

  // Click en una card de álbum (artista, colección, sidebar, fan, constel, other) → abrir detalle
  const albumCard = event.target.closest(
    '.album-card, .collection-card, .sidebar-album, .album-other-card'
  )
  if (albumCard && albumCard.dataset.album) {
    const artist = albumCard.dataset.artist
    const album = albumCard.dataset.album
    const coverImg = albumCard.querySelector(
      'img.album-cover, img.sidebar-album-cover, img.album-other-img, img.top-fan-cover, img.constel-cover'
    )
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
// re-renderizamos la vista actual y poblamos las cards del hero.
loadTopArtists().then(() => {
  populateHeroCards()
  if (resultsEl.querySelector('.row-section, .list-section')) {
    renderHome()
  } else if (currentLetter) {
    renderLetterFilter(currentLetter)
  }
})

// CTAs que hacen scroll al buscador
function scrollToSearchInput(event) {
  event?.preventDefault()
  document
    .querySelector('#search-input')
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => document.querySelector('#search-input')?.focus(), 600)
}

document.querySelector('#hero-explore')?.addEventListener('click', scrollToSearchInput)

// Delegation para CTAs que se renderean dinámicamente
document.body.addEventListener('click', (e) => {
  if (e.target.matches('#top-fan-explore, #top-fan-readmore, #constel-visit')) {
    scrollToSearchInput(e)
  }
})
