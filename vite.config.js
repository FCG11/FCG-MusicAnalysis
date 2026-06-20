// Configuración local del proyecto musical.
// Usamos puerto 5180 (uncommon) para garantizar aislamiento total
// de cualquier otro proyecto Vite en el equipo.
// strictPort: true → falla si está ocupado en vez de auto-incrementar
// (así nunca termina compartiendo localStorage con otro proyecto por accidente).
export default {
  server: {
    port: 5180,
    strictPort: true,
  },
}
