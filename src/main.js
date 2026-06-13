import './style.css'

// ──────────────────────────────────────────────
// Configuración: API key desde .env, URL base de Last.fm
// ──────────────────────────────────────────────
const API_KEY = import.meta.env.VITE_LASTFM_API_KEY
const API_BASE = 'https://ws.audioscrobbler.com/2.0/'

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

// Escapa caracteres HTML para evitar romper el render si un nombre
// trae cosas como < > " &. Truco: usar la propia API del navegador.
function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// Convierte "5295617" en "5.3M oyentes" — mucho más legible.
function formatListeners(count) {
  const num = parseInt(count, 10)
  if (isNaN(num)) return ''
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M oyentes`
  if (num >= 1_000) return `${Math.round(num / 1_000)}K oyentes`
  return `${num} oyentes`
}

// ──────────────────────────────────────────────
// Llamada a la API de Last.fm
// ──────────────────────────────────────────────
// Cuántos resultados pedimos vs. cuántos mostramos al final.
// Pedimos más para tener candidatos al filtrar el ruido.
const SEARCH_FETCH_LIMIT = 30
const SEARCH_DISPLAY_LIMIT = 8
const MIN_LISTENERS = 1000

async function searchArtists(query) {
  // URLSearchParams arma los parámetros de la URL correctamente
  // (escapando espacios y caracteres raros automáticamente).
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

  // El "?." y el "??" protegen contra estructuras inesperadas:
  // si algo en la cadena es undefined, devolvemos [] en vez de explotar.
  const raw = data?.results?.artistmatches?.artist ?? []

  // Ordenamos de más a menos popular.
  // Nota: parseInt convierte el string "5295617" en el número 5295617.
  const sorted = [...raw].sort(
    (a, b) => parseInt(b.listeners, 10) - parseInt(a.listeners, 10)
  )

  // Quitamos artistas con casi nadie escuchándolos (typos, tributos, spam).
  const filtered = sorted.filter(
    (artist) => parseInt(artist.listeners, 10) >= MIN_LISTENERS
  )

  // Si el filtro nos deja sin resultados (búsqueda muy underground),
  // mostramos los más populares aunque sean pocos oyentes.
  const finalList = filtered.length > 0 ? filtered : sorted

  return finalList.slice(0, SEARCH_DISPLAY_LIMIT)
}

// ──────────────────────────────────────────────
// Pintar resultados en la página
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

// ──────────────────────────────────────────────
// Eventos: submit del formulario + click en una tarjeta
// ──────────────────────────────────────────────
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const query = input.value.trim()
  if (!query) return

  resultsEl.innerHTML = `<p class="hint">Buscando "${escapeHtml(query)}"...</p>`

  try {
    const artists = await searchArtists(query)
    renderArtists(artists)
  } catch (error) {
    console.error('Error buscando artistas:', error)
    resultsEl.innerHTML = `<p class="error">No pudimos completar la búsqueda. Revisa tu conexión e intenta de nuevo.</p>`
  }
})

// Event delegation: un solo listener en #results captura clicks
// en cualquier tarjeta (presente o futura). Más eficiente que
// poner un listener por cada tarjeta.
resultsEl.addEventListener('click', (event) => {
  const card = event.target.closest('.artist-card')
  if (!card) return
  const artistName = card.dataset.artist
  console.log('Click en artista:', artistName)
  // TODO sesión 3: mostrar álbumes de este artista
})
