import './style.css'

// ──────────────────────────────────────────────
// Configuración: API key desde .env, URL base de Last.fm
// ──────────────────────────────────────────────
const API_KEY = import.meta.env.VITE_LASTFM_API_KEY
const API_BASE = 'https://ws.audioscrobbler.com/2.0/'

// Cuántos resultados pedimos vs. cuántos mostramos al final.
const SEARCH_FETCH_LIMIT = 30
const SEARCH_DISPLAY_LIMIT = 8
const MIN_LISTENERS = 1000
const ALBUMS_LIMIT = 12

// ──────────────────────────────────────────────
// Estado de la app (mínimo, solo lo necesario)
// ──────────────────────────────────────────────
let lastSearchResults = []

// ──────────────────────────────────────────────
// Renderizado inicial de la página
// ──────────────────────────────────────────────
const app = document.querySelector('#app')

app.innerHTML = `
  <main>
    <header>
      <h1>FCG-MusicAnalysis</h1>
      <p class="tagline">Tu colección personal de álbumes y recomendaciones musicales</p>
    </header>

    <section class="search">
      <form id="search-form">
        <input
          type="text"
          id="search-input"
          placeholder="Busca un artista (ej: Radiohead)"
          autocomplete="off"
        />
        <button type="submit">Buscar</button>
      </form>
    </section>

    <section id="results" class="results">
      <p class="hint">Escribe el nombre de un artista arriba para empezar.</p>
    </section>
  </main>
`

const form = document.querySelector('#search-form')
const input = document.querySelector('#search-input')
const resultsEl = document.querySelector('#results')

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
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

// Last.fm devuelve un array de imágenes con distintos tamaños.
// Sacamos la URL de la talla que pidamos, o '' si no hay.
function getImageUrl(images, size = 'large') {
  if (!Array.isArray(images)) return ''
  const match = images.find((img) => img.size === size)
  return match?.['#text'] || ''
}

// ──────────────────────────────────────────────
// Llamadas a la API de Last.fm
// ──────────────────────────────────────────────

async function searchArtists(query) {
  const params = new URLSearchParams({
    method: 'artist.search',
    artist: query,
    api_key: API_KEY,
    format: 'json',
    limit: String(SEARCH_FETCH_LIMIT),
  })

  const response = await fetch(`${API_BASE}?${params}`)
  if (!response.ok) {
    throw new Error(`Last.fm respondió con estado ${response.status}`)
  }
  const data = await response.json()
  const raw = data?.results?.artistmatches?.artist ?? []

  // Ordenar por popularidad, filtrar ruido, cortar a top N.
  const sorted = [...raw].sort(
    (a, b) => parseInt(b.listeners, 10) - parseInt(a.listeners, 10)
  )
  const filtered = sorted.filter(
    (artist) => parseInt(artist.listeners, 10) >= MIN_LISTENERS
  )
  const finalList = filtered.length > 0 ? filtered : sorted
  return finalList.slice(0, SEARCH_DISPLAY_LIMIT)
}

async function fetchTopAlbums(artistName) {
  const params = new URLSearchParams({
    method: 'artist.getTopAlbums',
    artist: artistName,
    api_key: API_KEY,
    format: 'json',
    limit: String(ALBUMS_LIMIT),
  })

  const response = await fetch(`${API_BASE}?${params}`)
  if (!response.ok) {
    throw new Error(`Last.fm respondió con estado ${response.status}`)
  }
  const data = await response.json()
  const albums = data?.topalbums?.album ?? []

  // A veces Last.fm devuelve álbumes con name "(null)" — los quitamos.
  return albums.filter((album) => album.name && album.name !== '(null)')
}

// ──────────────────────────────────────────────
// Renderizado de vistas
// ──────────────────────────────────────────────

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
      return `
        <article class="artist-card" data-artist="${name}">
          <div class="artist-avatar">${initial}</div>
          <div class="artist-info">
            <p class="artist-name">${name}</p>
            <p class="artist-listeners">${listeners}</p>
          </div>
        </article>
      `
    })
    .join('')
}

function renderAlbums(artistName, albums) {
  const escapedArtist = escapeHtml(artistName)
  const backButtonHtml = `<button class="back-btn" id="back-btn">← Volver a la búsqueda</button>`

  if (albums.length === 0) {
    resultsEl.innerHTML = `
      ${backButtonHtml}
      <p class="hint">No encontramos álbumes para ${escapedArtist}.</p>
    `
    return
  }

  const grid = albums
    .map((album) => {
      const name = escapeHtml(album.name)
      const cover = getImageUrl(album.image, 'large')
      const plays = formatPlaycount(album.playcount)
      const coverHtml = cover
        ? `<img class="album-cover" src="${cover}" alt="Portada de ${name}" loading="lazy" />`
        : `<div class="album-cover album-cover-placeholder">♪</div>`
      return `
        <article class="album-card">
          ${coverHtml}
          <div class="album-info">
            <p class="album-name">${name}</p>
            <p class="album-plays">${plays}</p>
          </div>
        </article>
      `
    })
    .join('')

  resultsEl.innerHTML = `
    ${backButtonHtml}
    <h2 class="artist-heading">${escapedArtist}</h2>
    <div class="album-grid">${grid}</div>
  `
}

// ──────────────────────────────────────────────
// Acciones (orquestan API + render)
// ──────────────────────────────────────────────

async function showArtistAlbums(artistName) {
  resultsEl.innerHTML = `<p class="hint">Cargando álbumes de ${escapeHtml(artistName)}...</p>`
  try {
    const albums = await fetchTopAlbums(artistName)
    renderAlbums(artistName, albums)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (error) {
    console.error('Error cargando álbumes:', error)
    resultsEl.innerHTML = `<p class="error">No pudimos cargar los álbumes. Intenta de nuevo.</p>`
  }
}

// ──────────────────────────────────────────────
// Eventos
// ──────────────────────────────────────────────

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const query = input.value.trim()
  if (!query) return

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

// Un solo listener atrapa todos los clicks dentro de #results y
// decide qué hacer según dónde se hizo click.
resultsEl.addEventListener('click', (event) => {
  const artistCard = event.target.closest('.artist-card')
  if (artistCard) {
    showArtistAlbums(artistCard.dataset.artist)
    return
  }

  const backBtn = event.target.closest('#back-btn')
  if (backBtn) {
    renderArtists(lastSearchResults)
  }
})
