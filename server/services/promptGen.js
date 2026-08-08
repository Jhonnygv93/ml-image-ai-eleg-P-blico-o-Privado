import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * PROMPT MAESTRO — secuencia de 12 imágenes para publicaciones de MercadoLibre.
 * Cada slot responde una pregunta distinta del comprador (regla: no repetir
 * información) y trae sus propias reglas de contenido tomadas del brief.
 * `needsText: false` en el slot 1 => portada sin ningún texto/ícono/marco.
 */
export const IMAGE_SLOTS = [
  {
    id: "cover-white-bg",
    label: "Portada principal (fondo blanco)",
    question: "¿Cómo es el producto?",
    needsText: false,
    brief: `Únicamente el producto, fondo blanco puro y uniforme, sin textos, sin
títulos, sin promociones, sin precios, sin logos agregados, sin marcos, sin
íconos, sin sellos, sin flechas, sin banners, sin info de despacho. Producto
centrado, proporciones reales, ocupando 80-90% del encuadre, excelente
iluminación comercial, bordes definidos, ángulo que mejor muestre su forma.
Sombra natural muy suave opcional para dar profundidad.`,
  },
  {
    id: "whats-included",
    label: "¿Qué incluye?",
    question: "¿Qué incluye?",
    needsText: true,
    brief: `Título "¿QUÉ INCLUYE?". Mostrar ordenadamente el producto principal
junto a los accesorios, piezas, cables, controles, adaptadores, herramientas
o manuales que estén confirmados en los datos de la publicación. Usar
pequeñas etiquetas para identificar cada elemento. Si no hay accesorios
confirmados, mostrar solo el producto principal sin inventar nada extra.`,
  },
  {
    id: "dimensions",
    label: "Dimensiones",
    question: "¿Cuánto mide?",
    needsText: true,
    brief: `Título "CONOCE SUS MEDIDAS". Líneas de medición profesionales sobre
el producto mostrando alto/ancho/largo/profundidad/diámetro ÚNICAMENTE si esos
valores están en las especificaciones provistas. Si no hay medidas
confirmadas, usar líneas de referencia sin números y un subtítulo genérico
tipo "Medidas disponibles en la ficha técnica" en vez de inventar cifras. No
alterar el tamaño o proporción real del producto.`,
  },
  {
    id: "main-benefit",
    label: "Beneficio principal",
    question: "¿Cuál es su beneficio principal?",
    needsText: true,
    brief: `Título corto con el beneficio más importante del producto (ej.
estilo "MÁS COMODIDAD EN TU DÍA A DÍA") y como máximo una línea de
explicación debajo. El producto sigue siendo protagonista de la composición.`,
  },
  {
    id: "feature-1",
    label: "Característica principal",
    question: "¿Qué característica destaca?",
    needsText: true,
    brief: `Acercamiento profesional (macro) a una característica real y
verificable del producto: material, sensor, costuras, botones, estructura,
conectores, cierre, iluminación, articulaciones, superficie o tecnología.
Título corto con el beneficio de esa característica. No alterar físicamente
el producto para mostrarla, no inventar tecnología no confirmada.`,
  },
  {
    id: "feature-2",
    label: "Segunda característica",
    question: "¿Qué otra característica posee?",
    needsText: true,
    brief: `Una SEGUNDA característica distinta a la de la imagen anterior
(vista lateral, vista posterior, detalle de mecanismo o material diferente).
Título corto + máximo una línea. No repetir la información ya mostrada en
"feature-1".`,
  },
  {
    id: "in-use",
    label: "Producto en uso",
    question: "¿Cómo se utiliza?",
    needsText: false,
    brief: `Escenario realista y coherente con la categoría del producto
(hogar, cocina, dormitorio, terraza, oficina, jardín, auto, taller, camping,
deporte, etc., según corresponda). El producto dentro de la escena debe
mantener EXACTAMENTE su forma, diseño, color, tamaño relativo y componentes
reales — no crear una versión distinta del producto. Sin texto salvo que
ayude mínimamente a la escena (evitar en lo posible).`,
  },
  {
    id: "three-benefits",
    label: "3 beneficios",
    question: "¿Cuáles son sus beneficios?",
    needsText: true,
    brief: `Infografía limpia con EXACTAMENTE 3 beneficios reales del producto
en formato de checklist con íconos minimalistas (✓ beneficio corto). Producto
visible y protagonista, sin saturar la imagen de información.`,
  },
  {
    id: "tech-specs",
    label: "Especificaciones técnicas",
    question: "¿Cuáles son sus especificaciones?",
    needsText: true,
    brief: `Título "ESPECIFICACIONES". Listar ÚNICAMENTE entre 4 y 6
características técnicas reales tomadas de las especificaciones provistas
(ej. potencia, protección, color, voltaje, material). No inventar ni
completar specs que no estén confirmadas; si hay menos de 4 confirmadas,
listar solo las que existen.`,
  },
  {
    id: "scale-real-size",
    label: "Tamaño real / escala",
    question: "¿Qué tamaño tiene realmente?",
    needsText: false,
    brief: `Ayudar a comprender el tamaño real del producto ubicándolo en una
habitación, sobre una mesa, junto a objetos cotidianos, instalado o en uso.
Los objetos secundarios son solo referencia de escala realista — nunca hacer
que el producto luzca artificialmente más grande de lo real.`,
  },
  {
    id: "use-cases",
    label: "Formas de uso",
    question: "¿Dónde puedo utilizarlo?",
    needsText: true,
    brief: `Título "IDEAL PARA DIFERENTES SITUACIONES". Composición limpia
mostrando entre 2 y 4 situaciones/lugares de uso reales y acordes a la
categoría del producto (ej. "Casa | Oficina | Viajes"). No mencionar usos que
no correspondan al producto.`,
  },
  {
    id: "closing",
    label: "Cierre de la publicación",
    question: "¿Por qué debería considerarlo?",
    needsText: true,
    brief: `Imagen final premium con el producto nuevamente como protagonista
y sus 3 argumentos de venta más importantes en checklist corto (ej. ✓
Resistente ✓ Práctico ✓ Fácil de usar). PROHIBIDO incluir: precio, teléfono,
WhatsApp, dirección web, info de despacho, métodos de pago, promociones,
"compra ahora", "últimas unidades", "oferta", o cualquier dato externo a
MercadoLibre.`,
  },
];

const MASTER_STYLE_GUIDE = `
FORMATO: 1200x1200 px, cuadrado 1:1, alta resolución, calidad profesional de
e-commerce, producto nítido, iluminación comercial, composición limpia, sin
pixelación, sin deformaciones, sin objetos cortados, proporciones reales.

ESTILO: profesional, moderno, minimalista, comercial, limpio, premium,
orientado a MercadoLibre. Fondos claros (blanco o gris muy claro) o ambientes
realistas según el slot, degradados muy suaves, sombras naturales, iconografía
minimalista. Evitar fondos cargados, exceso de colores, efectos exagerados,
collages desordenados o estética de "volante publicitario".

TIPOGRAFÍA: sans-serif moderna (estilo Montserrat, Poppins o Inter), misma
familia tipográfica en las 12 imágenes, títulos destacados y textos
secundarios más pequeños, jerarquía visual clara.

TEXTO: mínimo indispensable. Título corto (pocas palabras, en mayúsculas) +
como máximo UNA línea de explicación breve debajo. Cada imagen debe
entenderse en 2-3 segundos. Nunca párrafos largos.

CONSISTENCIA: las 12 imágenes deben verse como una misma campaña — mismos
colores, misma tipografía, misma estética, mismo producto, misma calidad
fotográfica.

FIDELIDAD AL PRODUCTO (regla principal, nunca se sacrifica): respetar
exactamente forma, materiales, colores, botones, conexiones, costuras,
texturas, dimensiones y accesorios reales observados en la foto de
referencia. No cambiar el diseño del producto entre imágenes, no inventar
funciones ni accesorios no incluidos, no inventar marcas ni logotipos, no
modificar el producto para hacerlo "más atractivo".

PROHIBIDO INVENTAR DATOS: si un dato (medida, potencia, material,
certificación, peso, accesorio, etc.) no está confirmado en la publicación,
simplemente no se usa — jamás se inventa.

NUNCA incluir números de paso ("Imagen 1", "2", "3"...) ni ningún rótulo de
organización dentro del diseño final — son solo referencia interna.

PRIORIDADES en este orden: 1) fidelidad al producto real, 2) claridad,
3) calidad profesional, 4) información correcta, 5) buena composición,
6) consistencia entre imágenes, 7) estética comercial, 8) conversión. Nunca
sacrificar la fidelidad del producto por conseguir una imagen más vistosa.
`.trim();

function buildListingSummary(listing) {
  const specsText = (listing.specs || [])
    .map((s) => `- ${s.key}: ${s.value}`)
    .join("\n");
  return `
Título: ${listing.title || "N/D"}
Precio: ${listing.currency || "$"}${listing.price || "N/D"} (NO usar el precio en ninguna imagen)
Categoría: ${listing.category || "N/D"}
Descripción: ${(listing.description || "").slice(0, 800)}
Especificaciones técnicas confirmadas:
${specsText || "(ninguna confirmada — no inventar specs ni medidas)"}
`.trim();
}

/**
 * Analiza la imagen de referencia (primera foto real de la publicación) junto
 * con los datos scrapeados y devuelve el contenido de las 12 imágenes de la
 * campaña (título corto, subtítulo de una línea si aplica, y el prompt visual
 * de composición), siguiendo el prompt maestro de diseño para MercadoLibre.
 *
 * @param {object} listing - datos scrapeados de la publicación
 * @param {Buffer} referenceImageBuffer - PNG de la imagen de muestra
 * @returns {Promise<Array<{id, label, needsText, titleText, subtitleText, prompt}>>}
 */
export async function generateImagePrompts(listing, referenceImageBuffer) {
  const listingSummary = buildListingSummary(listing);
  const base64Image = referenceImageBuffer.toString("base64");

  const slotList = IMAGE_SLOTS.map(
    (s, i) => `${i + 1}. [${s.id}] "${s.label}" — responde: ${s.question}\n   Reglas: ${s.brief}`
  ).join("\n\n");

  const systemPrompt = `Sos un diseñador gráfico profesional especializado en e-commerce,
fotografía de producto, infografías comerciales y publicaciones de
MercadoLibre. Vas a recibir una foto real de muestra del producto y los
datos de su publicación. Tu tarea es planificar el contenido de una campaña
de 12 imágenes siguiendo EXACTAMENTE estas reglas:

${MASTER_STYLE_GUIDE}

Respondé ÚNICAMENTE con un JSON válido, sin texto adicional ni bloques de código.`;

  const userPrompt = `Datos de la publicación:
${listingSummary}

Planificá el contenido de las 12 imágenes de la campaña, en este orden exacto
(no repitas información entre imágenes — cada una responde una pregunta
distinta del comprador):

${slotList}

Formato de respuesta (JSON estricto, sin comentarios ni markdown):
{
  "productDescription": "descripción visual detallada y fiel del producto real observado en la foto (forma, color, materiales, proporciones, detalles distintivos)",
  "images": [
    {
      "id": "cover-white-bg",
      "titleText": null,
      "subtitleText": null,
      "compositionPrompt": "instrucciones visuales de composición fotográfica para esta imagen, en español, listas para un generador de imágenes"
    },
    ... (12 objetos en total, mismo orden y mismos ids que la lista de arriba)
  ]
}

Reglas para "titleText"/"subtitleText": null cuando el slot indica needsText
false o cuando el brief pide explícitamente que no haya texto (portada). En
el resto, "titleText" es un título corto en mayúsculas (pocas palabras) y
"subtitleText" es como máximo UNA línea breve (o null si no hace falta).
Nunca inventes cifras, specs o accesorios que no estén confirmados arriba.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${base64Image}` },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error("El modelo no devolvió un JSON válido para la campaña de imágenes.");
  }

  const byId = new Map((parsed.images || []).map((img) => [img.id, img]));
  const productDescription = parsed.productDescription || listing.title;

  // Garantizamos las 12, en el orden fijo de IMAGE_SLOTS, con fallback si el
  // modelo omitió alguna, y armamos el prompt final combinando composición +
  // texto a renderizar (o la instrucción explícita de "sin texto").
  return IMAGE_SLOTS.map((slot) => {
    const planned = byId.get(slot.id) || {};
    const composition =
      planned.compositionPrompt ||
      `Fotografía de producto profesional de: ${productDescription}. ${slot.brief}`;

    let textInstruction;
    if (slot.needsText === false || (!planned.titleText && !planned.subtitleText)) {
      textInstruction =
        "No incluir NINGÚN texto, título, ícono, marco, sello ni banner en la imagen.";
    } else {
      const title = planned.titleText ? `Título grande: "${planned.titleText}".` : "";
      const subtitle = planned.subtitleText
        ? `Subtítulo, una sola línea, más pequeño: "${planned.subtitleText}".`
        : "";
      textInstruction = `Renderizar el siguiente texto con tipografía sans-serif moderna
(estilo Montserrat/Poppins), jerarquía clara: ${title} ${subtitle}
No incluir ningún otro texto, número de paso ni marca de agua.`.replace(/\s+/g, " ").trim();
    }

    const prompt = `${composition}\n\n${MASTER_STYLE_GUIDE}\n\n${textInstruction}`;

    return {
      id: slot.id,
      label: slot.label,
      needsText: slot.needsText,
      titleText: planned.titleText || null,
      subtitleText: planned.subtitleText || null,
      prompt,
    };
  });
}
