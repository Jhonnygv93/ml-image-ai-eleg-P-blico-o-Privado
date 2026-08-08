# ML Image AI — Generador de imágenes de producto para MercadoLibre

Extensión de Chrome + backend que analiza una publicación de MercadoLibre,
toma **la primera foto de la publicación como imagen de muestra/referencia**,
y genera **12 imágenes de producto** con IA manteniendo el mismo producto real
(color, forma, materiales), listas para descargar y subir a la publicación.

## Arquitectura

```
[Publicación de MercadoLibre]
        │  content.js analiza el DOM: título, precio, specs, descripción,
        │  categoría, galería de fotos → referenceImageUrl = primera foto
        ▼
[Popup de la extensión] ──POST /api/generate-images──▶ [Backend Node/Express]
                                                              │
                                                              ├─ 1) Descarga y normaliza
                                                              │     la foto de muestra (PNG)
                                                              │
                                                              ├─ 2) GPT-4o-mini (visión) analiza
                                                              │     esa foto + los datos y arma
                                                              │     12 prompts anclados en el
                                                              │     producto real
                                                              │
                                                              └─ 3) gpt-image-1 (edición guiada
                                                                    por imagen de referencia)
                                                                    genera cada una de las 12
                                                                    imágenes, en paralelo
        ▲
        └── 12 imágenes (PNG en data URL) en un grid, descargables individual o en conjunto
```

**Por qué "imagen de referencia" y no solo texto:** en vez de generar las 12
imágenes solo a partir del texto de la publicación (lo que puede alucinar un
producto distinto), el backend usa la foto real como entrada del modelo, así
las imágenes nuevas conservan el mismo color, forma y materiales del producto
que el vendedor realmente tiene.

## 1. Backend

```bash
cd server
npm install
cp .env.example .env
# Editá .env y pegá tu OPENAI_API_KEY real
npm start
```

El servidor queda escuchando en `http://localhost:3000`.

Prueba rápida (usando cualquier imagen pública como referencia):
```bash
curl -X POST http://localhost:3000/api/generate-images \
  -H "Content-Type: application/json" \
  -d '{
    "listing": {
      "title": "Silla Gamer Ergonómica Reclinable Negro/Rojo",
      "category": "Hogar > Muebles > Sillas",
      "specs": [{"key":"Material","value":"Cuero PU"},{"key":"Reclinación","value":"180°"}],
      "referenceImageUrl": "https://http2.mlstatic.com/D_NQ_NP_ejemplo.jpg"
    }
  }'
```

## 2. Extensión de Chrome

1. Abrí `chrome://extensions`
2. Activá "Modo de desarrollador"
3. "Cargar descomprimida" → seleccioná la carpeta `extension/`
4. Entrá a cualquier publicación de MercadoLibre (`mercadolibre.com.ar/...`, etc.)
5. Abrí el popup de la extensión → si tu backend no corre en `localhost:3000`,
   pegá la URL correcta abajo del todo y "Guardar"
6. "Analizar publicación y generar imágenes"

> Nota: agregá un ícono `icon128.png` en `extension/` (128x128px) o quitá esa
> línea del `manifest.json` si todavía no tenés uno.

## 3. Producción

- Desplegá `server/` en cualquier hosting Node (Render, Railway, Fly.io, un VPS, etc.).
- Cambiá el `backendUrl` guardado en el popup (o `DEFAULT_BACKEND_URL` en
  `extension/background.js`) por tu URL pública, y agregala a
  `host_permissions` en `manifest.json`.
- En `server.js`, restringí CORS solo al origin de tu extensión
  (`chrome-extension://<TU_ID_DE_EXTENSIÓN>`) en vez de `cors()` abierto.
- Considerá guardar las imágenes generadas en un storage (S3, Cloudinary, etc.)
  en vez de devolver base64, para publicaciones con mucho tráfico.
- Agregá autenticación al backend (API key propia o JWT) si va a estar público.

## La campaña de 12 imágenes (prompt maestro)

`server/services/promptGen.js` sigue un prompt maestro de diseño gráfico
e-commerce que define exactamente qué debe mostrar cada una de las 12
imágenes, en este orden (cada una responde una pregunta distinta del
comprador, sin repetir información):

1. **Portada** — fondo blanco puro, SIN texto ni logos, solo el producto.
2. **Qué incluye** — accesorios/piezas reales confirmados en la publicación.
3. **Dimensiones** — líneas de medición; solo usa números si están en las specs.
4. **Beneficio principal** — título corto + una línea.
5. **Característica 1** — acercamiento a un detalle real (material, botón, etc).
6. **Característica 2** — un detalle distinto al anterior.
7. **Producto en uso** — escenario realista acorde a la categoría.
8. **3 beneficios** — checklist con íconos minimalistas.
9. **Especificaciones técnicas** — 4 a 6 datos reales, nunca inventados.
10. **Tamaño real / escala** — el producto junto a objetos cotidianos.
11. **Formas de uso** — 2 a 4 situaciones de uso reales.
12. **Cierre** — 3 argumentos de venta, sin precio/teléfono/promociones.

Reglas globales que se aplican a las 12 (embebidas en `MASTER_STYLE_GUIDE`):
formato 1200×1200, tipografía sans-serif moderna, texto mínimo (título corto
+ máx. una línea), misma identidad visual en toda la secuencia, y sobre todo
**nunca inventar datos** (medidas, specs, accesorios) que no estén
confirmados en la publicación scrapeada — si el dato no está, simplemente no
se usa.

La API de imágenes no genera nativamente 1200×1200, así que
`server/services/imageGen.js` reescala cada resultado a `OUTPUT_SIZE`
(1200 por defecto, configurable en `.env`) después de generarlo.

## Personalización

- **Cambiar de proveedor de IA de imágenes**: todo el código específico de
  OpenAI para la generación vive en `server/services/imageGen.js`. Podés
  reemplazar `generateSingleImage` por una llamada a Stability AI, Google
  Imagen, etc. sin tocar el resto del proyecto.
- **Cambiar el contenido/reglas de los 12 slots**: editá `IMAGE_SLOTS` y
  `MASTER_STYLE_GUIDE` en `server/services/promptGen.js`.
- **Selectores del DOM de MercadoLibre**: si ML cambia su HTML, los selectores
  a ajustar están todos en `extension/content.js`.
- **Usar más de una foto de referencia**: hoy se usa solo `images[0]`. Podés
  extender `content.js` para mandar `images[0..2]` y pasar varias imágenes al
  endpoint de edición (acepta un array de imágenes de referencia).

## Costos a tener en cuenta

- Cada generación completa hace: 1 llamada de texto+visión (GPT-4o-mini,
  barata) + 12 llamadas al endpoint de edición de imágenes (gpt-image-1).
- Calculá el costo por publicación multiplicando el precio por imagen de
  OpenAI x 12 x cantidad de publicaciones que vayas a procesar por día.
- `IMAGE_CONCURRENCY` en `.env` controla cuántas de las 12 se generan en
  paralelo (default 3) — subilo con cuidado por los rate limits de tu cuenta.
