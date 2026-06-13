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
const SIMILAR_LIMIT = 6

// ──────────────────────────────────────────────
// Estado de la app (mínimo, solo lo necesario)
// ──────────────────────────────────────────────
let lastSearchResults = []

// ──────────────────────────────────────────────
// Persistencia de calificaciones (localStorage)
// ──────────────────────────────────────────────
const RATINGS_KEY = 'fcg-ratings-v1'

function loadRatings() {
  try {
    return JSON.parse(localStorage.getItem(RATINGS_KEY) ?? '{}')
  } catch {
    // Si los datos están corruptos por alguna razón, empezamos limpios.
    return {}
  }
}

function saveRatings(ratings) {
  localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings))
}

function ratingKey(artist, album) {
  return `${artist}::${album}`
}

// Lee el rating. Soporta formato viejo (solo número) y nuevo (objeto).
function getRating(artist, album) {
  const data = loadRatings()[ratingKey(artist, album)]
  if (typeof data === 'number') return data
  return data?.rating ?? 0
}

// Guarda rating + metadatos del álbum (artista, nombre, portada).
function setRating(artist, album, value, cover = '') {
  const ratings = loadRatings()
  const key = ratingKey(artist, album)
  if (value === 0) {
    delete ratings[key]
  } else {
    ratings[key] = { rating: value, artist, album, cover }
  }
  saveRatings(ratings)
}

// Devuelve todos los álbumes calificados como un array uniforme,
// migrando al vuelo los del formato viejo.
function getAllRatedAlbums() {
  const ratings = loadRatings()
  return Object.entries(ratings).map(([key, data]) => {
    if (typeof data === 'number') {
      const [artist, album] = key.split('::')
      return { artist, album, rating: data, cover: '' }
    }
    return data
  })
}

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

    <nav class="tabs">
      <button class="tab tab-active" data-view="search">Buscar</button>
      <button class="tab" data-view="collection">Mi colección</button>
    </nav>

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

// Genera los 5 botones de estrellas en orden 5,4,3,2,1.
// El CSS usa flex row-reverse para mostrarlas como 1,2,3,4,5.
// El truco está en cómo se rellenan al pasar el mouse — ver style.css.
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

// Actualiza el llenado visual de las estrellas sin re-renderizar la tarjeta.
function updateRatingDisplay(ratingEl, newRating) {
  const stars = ratingEl.querySelectorAll('.star')
  stars.forEach((star) => {
    const value = parseInt(star.dataset.value, 10)
    star.classList.toggle('star-filled', value <= newRating)
  })
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

async function fetchSimilarArtists(artistName) {
  const params = new URLSearchParams({
    method: 'artist.getSimilar',
    artist: artistName,
    api_key: API_KEY,
    format: 'json',
    limit: String(SIMILAR_LIMIT),
  })

  const response = await fetch(`${API_BASE}?${params}`)
  if (!response.ok) {
    throw new Error(`Last.fm respondió con estado ${response.status}`)
  }
  const data = await response.json()
  return data?.similarartists?.artist ?? []
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

function setActiveTab(view) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('tab-active', tab.dataset.view === view)
  })
}

function renderCollection() {
  setActiveTab('collection')
  const items = getAllRatedAlbums()

  // Ordenamos por rating descendente, y dentro del mismo rating
  // por artista en orden alfabético (respetando acentos del español).
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

  const cards = items
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

  const total = items.length
  resultsEl.innerHTML = `
    <h2 class="artist-heading">Mi colección · ${total} álbum${total !== 1 ? 'es' : ''}</h2>
    <div class="album-grid">${cards}</div>
  `
}

function renderSimilarArtists(artistName, similar) {
  if (similar.length === 0) return ''

  const escapedArtist = escapeHtml(artistName)
  const cards = similar
    .map((artist) => {
      const name = escapeHtml(artist.name)
      const initial = escapeHtml(artist.name.charAt(0).toUpperCase())
      // El "match" viene como un número entre 0 y 1. Lo convertimos a %.
      const matchPercent = Math.round(parseFloat(artist.match) * 100)
      return `
        <article class="artist-card similar-card" data-artist="${name}">
          <div class="artist-avatar">${initial}</div>
          <div class="artist-info">
            <p class="artist-name">${name}</p>
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
  const backButtonHtml = `<button class="back-btn" id="back-btn">← Volver a la búsqueda</button>`

  if (albums.length === 0) {
    resultsEl.innerHTML = `
      ${backButtonHtml}
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
    ${backButtonHtml}
    <h2 class="artist-heading">${escapedArtist}</h2>
    <div class="album-grid">${grid}</div>
    ${renderSimilarArtists(artistName, similar)}
  `
}

// ──────────────────────────────────────────────
// Acciones (orquestan API + render)
// ──────────────────────────────────────────────

async function showArtistAlbums(artistName) {
  setActiveTab('search')
  resultsEl.innerHTML = `<p class="hint">Cargando álbumes de ${escapeHtml(artistName)}...</p>`
  try {
    // Pedimos álbumes y artistas similares EN PARALELO con Promise.all.
    // El .catch(() => []) hace que si los similares fallan,
    // sigamos mostrando los álbumes sin romper la página.
    const [albums, similar] = await Promise.all([
      fetchTopAlbums(artistName),
      fetchSimilarArtists(artistName).catch(() => []),
    ])
    renderAlbums(artistName, albums, similar)
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

  setActiveTab('search')
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

// Listener para las pestañas Buscar / Mi colección.
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view
    if (view === 'collection') {
      renderCollection()
    } else {
      setActiveTab('search')
      if (lastSearchResults.length > 0) {
        renderArtists(lastSearchResults)
      } else {
        resultsEl.innerHTML = `<p class="hint">Escribe el nombre de un artista arriba para empezar.</p>`
      }
    }
  })
})

// Un solo listener atrapa todos los clicks dentro de #results y
// decide qué hacer según dónde se hizo click.
resultsEl.addEventListener('click', (event) => {
  // Click en una estrella: guardar/quitar rating
  const star = event.target.closest('.star')
  if (star) {
    const card = star.closest('.album-card')
    const artist = card.dataset.artist
    const album = card.dataset.album
    const value = parseInt(star.dataset.value, 10)
    const current = getRating(artist, album)
    // Click en la misma estrella ya marcada → desmarca (rating 0)
    const newValue = current === value ? 0 : value
    // Sacamos la URL de la portada para guardarla con el rating.
    const coverImg = card.querySelector('img.album-cover')
    const cover = coverImg?.src ?? ''
    setRating(artist, album, newValue, cover)
    updateRatingDisplay(star.closest('.rating'), newValue)
    return
  }

  // Click en una tarjeta de la colección → ver álbumes de ese artista
  const collectionCard = event.target.closest('.collection-card')
  if (collectionCard) {
    showArtistAlbums(collectionCard.dataset.artist)
    return
  }

  // Click en una tarjeta de artista (vista de búsqueda)
  const artistCard = event.target.closest('.artist-card')
  if (artistCard) {
    showArtistAlbums(artistCard.dataset.artist)
    return
  }

  // Click en "volver"
  const backBtn = event.target.closest('#back-btn')
  if (backBtn) {
    setActiveTab('search')
    renderArtists(lastSearchResults)
  }
})
