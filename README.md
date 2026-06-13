# FCG-MusicAnalysis

Proyecto personal de aprendizaje: una interfaz web para calificar álbumes y descubrir artistas similares, usando la API de Last.fm.

## Stack

- HTML + CSS + JavaScript (vanilla, sin frameworks)
- [Vite](https://vite.dev/) como servidor de desarrollo
- [Last.fm API](https://www.last.fm/api) para datos de artistas, álbumes y similitudes

## Setup local

1. Clona el repo:
   ```bash
   git clone https://github.com/<tu-usuario>/FCG-MusicAnalysis.git
   cd FCG-MusicAnalysis
   ```
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Copia `.env.example` a `.env` y pon tu propia API key de Last.fm:
   ```bash
   cp .env.example .env
   ```
   Consigue una key gratis en https://www.last.fm/api/account/create
4. Enciende el servidor:
   ```bash
   npm run dev
   ```
5. Abre http://localhost:5173

## Roadmap

- [x] Setup inicial con Vite
- [ ] Buscador de artistas (Last.fm `artist.search`)
- [ ] Vista de álbumes por artista (`artist.getTopAlbums`)
- [ ] Sistema de calificación con `localStorage`
- [ ] Recomendaciones de artistas similares (`artist.getSimilar`)
- [ ] Vista "Mi colección" ordenada por rating

## Notas

Este es un proyecto de aprendizaje. El código está pensado para enseñar fundamentos, no para producción.
