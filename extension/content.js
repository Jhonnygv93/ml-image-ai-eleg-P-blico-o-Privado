// content.js
// Corre dentro de la página de una publicación de MercadoLibre.
// Extrae toda la información de la publicación, incluyendo la PRIMERA
// imagen de la galería, que se usará como imagen de referencia para que
// la IA genere las 12 imágenes nuevas manteniendo el producto real.
//
// Si MercadoLibre cambia su HTML, todos los selectores a ajustar están
// centralizados acá.

function safeText(selector) {
  const el = document.querySelector(selector);
  return el ? el.innerText.trim() : "";
}

function safeAttr(selector, attr) {
  const el = document.querySelector(selector);
  return el ? el.getAttribute(attr) : "";
}

function extractTitle() {
  return (
    safeText("h1.ui-pdp-title") ||
    safeText("h1[class*='title']") ||
    safeAttr("meta[property='og:title']", "content") ||
    document.title
  );
}

function extractPrice() {
  const priceFraction = safeText(".ui-pdp-price__second-line .andes-money-amount__fraction") ||
    safeText(".andes-money-amount__fraction");
  const priceCents = safeText(".ui-pdp-price__second-line .andes-money-amount__cents") ||
    safeText(".andes-money-amount__cents");
  if (!priceFraction) return "";
  return priceCents ? `${priceFraction},${priceCents}` : priceFraction;
}

function extractCurrency() {
  return (
    safeText(".andes-money-amount__currency-symbol") ||
    safeAttr("meta[itemprop='priceCurrency']", "content") ||
    "$"
  );
}

function extractDescription() {
  return (
    safeText(".ui-pdp-description__content") ||
    safeText("[class*='description']") ||
    ""
  );
}

function extractBreadcrumbs() {
  const crumbs = Array.from(
    document.querySelectorAll(".andes-breadcrumb__link, .ui-pdp-breadcrumb__link")
  ).map((el) => el.innerText.trim());
  return crumbs.filter(Boolean);
}

function extractSpecs() {
  const specs = [];
  // Tabla de "características principales" / "specs"
  const rows = document.querySelectorAll(
    ".andes-table__row, .ui-pdp-specs__table tr, tr.ui-vpp-striped-specs__row"
  );
  rows.forEach((row) => {
    const key =
      row.querySelector("th, .andes-table__header__container")?.innerText?.trim() ||
      row.querySelector("td:first-child")?.innerText?.trim();
    const value =
      row.querySelector("td:last-child, .andes-table__column--value")?.innerText?.trim();
    if (key && value && key !== value) {
      specs.push({ key, value });
    }
  });
  return specs;
}

function extractGalleryImages() {
  // Imágenes en alta resolución de la galería principal.
  const imgEls = document.querySelectorAll(
    ".ui-pdp-gallery__figure img, figure.ui-pdp-gallery__figure img, .ui-pdp-image"
  );
  const urls = new Set();
  imgEls.forEach((img) => {
    // MercadoLibre suele usar data-zoom o src con la versión de mayor resolución
    const src =
      img.getAttribute("data-zoom") ||
      img.getAttribute("data-src") ||
      img.getAttribute("src");
    if (src && src.startsWith("http")) {
      // Normalizar a la versión de mayor calidad posible (-O.jpg / -F.jpg)
      const highRes = src.replace(/-[A-Z]\.(jpg|jpeg|png|webp)/i, "-O.$1");
      urls.add(highRes);
    }
  });
  // Fallback: og:image
  if (urls.size === 0) {
    const og = safeAttr("meta[property='og:image']", "content");
    if (og) urls.add(og);
  }
  return Array.from(urls);
}

function extractSellerInfo() {
  return {
    name:
      safeText(".ui-pdp-seller__header__title") ||
      safeText("[class*='seller'] [class*='title']") ||
      "",
    reputation: safeText(".ui-pdp-seller__reputation-info-container") || "",
  };
}

function extractListing() {
  const images = extractGalleryImages();
  return {
    url: window.location.href,
    title: extractTitle(),
    price: extractPrice(),
    currency: extractCurrency(),
    description: extractDescription(),
    category: extractBreadcrumbs().join(" > "),
    specs: extractSpecs(),
    images,
    // La primera imagen de la galería es la imagen de MUESTRA / referencia
    // que se usará como base visual para generar las 12 imágenes nuevas.
    referenceImageUrl: images[0] || null,
    seller: extractSellerInfo(),
    scrapedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ML_IMAGE_AI_EXTRACT_LISTING") {
    try {
      const listing = extractListing();
      sendResponse({ ok: true, listing });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  }
  // Necesario para permitir sendResponse asíncrono
  return true;
});
