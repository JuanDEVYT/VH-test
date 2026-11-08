
const BASE = "https://veohentai.com";
const PLAYER = "https://hentaiplayer.com";
const TIMEOUT = 12000;
const MAX_ITEMS = 60;
const MAX_EPISODES = 3000;
const LOG_PREFIX = "[veohentai]";
const VERSION = "1.1.4";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function log(...args) {
  try {
    kino.log(LOG_PREFIX, ...args);
  } catch {}
}

log("VeoHentai v" + VERSION + " • creado por Sonny Itsuka y JuandreXter");

function es() {
  return String(kino.lang || "es-CO").toLowerCase().indexOf("en") !== 0;
}

function msg(esText, enText) {
  return es() ? esText : enText;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function getText(url, referer) {
  log("GET", url);

  const headers = { "User-Agent": UA };
  if (referer) headers.Referer = referer;

  const r = await kino.fetch(url, {
    headers,
    timeoutMs: TIMEOUT
  });

  if (!r.ok) {
    log("HTTP error", r.status, url);
    throw new Error(url + " respondió " + r.status);
  }

  const body = await r.text();
  log("GET OK", r.status, body.length + " bytes");

  return body;
}

async function parallelLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;

      try {
        results[index] = await fn(items[index], index);
      } catch (e) {
        log("Tarea falló", index, e.message);
        results[index] = null;
      }
    }
  }

  const workers = [];
  const count = Math.min(
    Math.max(1, Number(limit) || 1),
    items.length
  );

  for (let i = 0; i < count; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

function abs(path) {
  return new URL(path, BASE).href;
}

function clean(text, max) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 200);
}

function imageUrl(value, pageUrl) {
  if (!value || typeof value !== "string") return undefined;

  let v = value.trim().replace(/&amp;/gi, "&");

  if (!v || /^data:/i.test(v)) return undefined;
  if (v.startsWith("//")) v = "https:" + v;

  try {
    return new URL(v, pageUrl || BASE + "/").href;
  } catch {
    return undefined;
  }
}

function validPoster(value, pageUrl) {
  const url = imageUrl(value, pageUrl);
  if (!url) return undefined;

  const filename = url.split("/").pop().split("?")[0].toLowerCase();

  if (
    filename.endsWith(".svg") ||
    /^(logo|favicon|icon|avatar|placeholder)([-_.]|$)/i.test(filename)
  ) {
    return undefined;
  }

  return url;
}

function b64(value) {
  let s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");

  while (s.length % 4) s += "=";

  return atob(s);
}

function encodeRef(value) {
  return btoa(encodeURIComponent(String(value || "")));
}

function decodeRef(value) {
  let raw;

  try {
    raw = atob(value);
  } catch {
    throw kino.error("not_found", "ese servidor ya no sirve");
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function attr(tag, name) {
  const m = new RegExp(
    "\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1",
    "i"
  ).exec(tag);

  return m ? m[2] : "";
}

function srcsetUrl(value) {
  if (!value) return "";

  const candidates = value
    .split(",")
    .map(part => part.trim().split(/\s+/)[0])
    .filter(Boolean);

  return candidates.length
    ? candidates[candidates.length - 1]
    : "";
}

function extractImage(block, pageUrl) {
  if (!block) return undefined;

  const tags = [];
  const tagRe = /<(?:img|source)\b[^>]*>/gi;
  let m;

  while ((m = tagRe.exec(block))) {
    tags.push(m[0]);
  }

  const attributes = [
    "data-poster",
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-original-src",
    "data-image",
    "data-thumb",
    "src"
  ];

  for (const tag of tags) {
    for (const name of attributes) {
      const url = validPoster(attr(tag, name), pageUrl);
      if (url) return url;
    }

    const set = validPoster(
      srcsetUrl(attr(tag, "srcset")),
      pageUrl
    );

    if (set) return set;

    const lazy = validPoster(
      srcsetUrl(attr(tag, "data-srcset")),
      pageUrl
    );

    if (lazy) return lazy;
  }

  const metaRe = /<meta\b[^>]*>/gi;

  while ((m = metaRe.exec(block))) {
    const tag = m[0];

    const property = (
      attr(tag, "property") || attr(tag, "name")
    ).toLowerCase();

    if (property === "og:image" || property === "twitter:image") {
      const url = validPoster(attr(tag, "content"), pageUrl);
      if (url) return url;
    }
  }

  return undefined;
}

function parseCards(html, pageUrl) {
  const re =
    /<a\b[^>]*href\s*=\s*(["'])(?:https?:\/\/(?:www\.)?veohentai\.com)?\/ver\/([^"'\/\s?#]+)/gi;

  const marks = [];
  let m;

  while ((m = re.exec(html))) {
    marks.push({
      slug: m[2],
      at: m.index,
      end: re.lastIndex
    });
  }

  const out = [];
  const seen = new Set();

  for (let i = 0; i < marks.length; i++) {
    const slug = marks[i].slug;

    if (seen.has(slug)) continue;
    seen.add(slug);

    const from = marks[i].at;
    const next = i + 1 < marks.length
      ? marks[i + 1].at
      : from + 3000;

    const chunk = html.slice(from, next);

    const previousEnd = i > 0
      ? marks[i - 1].end
      : Math.max(0, from - 1200);

    const before = html.slice(
      Math.max(previousEnd, from - 1200),
      from
    );

    const poster =
      extractImage(chunk, pageUrl) ||
      extractImage(before, pageUrl);

    const titleM =
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(chunk) ||
      /<img\b[^>]*\balt\s*=\s*(["'])([\s\S]*?)\1/i.exec(chunk) ||
      /title\s*=\s*(["'])([\s\S]*?)\1/i.exec(chunk);

    const title = clean(
      titleM ? titleM[2] || titleM[1] : slug.replace(/-/g, " "),
      200
    );

    out.push({
      slug,
      title: title || slug.replace(/-/g, " "),
      poster
    });
  }

  return out;
}

function splitEpisode(slug) {
  const m = /^(.*)-episodio-(\d+)$/i.exec(slug);

  return m
    ? { slug: m[1], num: Number(m[2]) }
    : null;
}

function seriesTitle(title, slug) {
  const cleaned = clean(title, 200)
    .replace(/\s*[-–|:]?\s*episodio\s*\d+\s*$/i, "")
    .trim();

  return cleaned || slug.replace(/-/g, " ");
}

function seriesItem(c) {
  return {
    id: "s~" + c.slug,
    ref: "s~" + c.slug,
    title: c.title,
    kind: "series",
    adult: true,
    poster: c.poster,
    genres: ["anime"]
  };
}

function episodeItem(c) {
  return {
    id: "v~" + c.slug,
    ref: "v~" + c.slug + "~1",
    title: c.title,
    kind: "movie",
    adult: true,
    poster: c.poster,
    genres: ["anime"]
  };
}

function catalogItems(cards) {
  const result = [];
  const seriesMap = new Map();

  for (const c of cards) {
    const ep = splitEpisode(c.slug);

    if (!ep) {
      result.push(episodeItem(c));
      continue;
    }

    if (seriesMap.has(ep.slug)) continue;

    const grouped = {
      slug: ep.slug,
      title: seriesTitle(c.title, ep.slug),
      poster: c.poster
    };

    const item = seriesItem(grouped);

    seriesMap.set(ep.slug, item);
    result.push(item);
  }

  return result;
}

// ---- búsqueda ---------------------------------------------------------------

export async function search(query) {
  await null;

  const terms = [];
  const seenTerm = new Set();

  for (const raw of [
    query && query.q,
    query && query.originalTitle
  ]) {
    if (typeof raw !== "string" || !raw.trim()) continue;

    const text = kino.rank.shortQuery(raw).trim();
    const key = text.toLowerCase();

    if (!text || seenTerm.has(key)) continue;

    seenTerm.add(key);
    terms.push(text);

    if (terms.length === 2) break;
  }

  if (!terms.length) return [];

  log("Búsqueda iniciada", terms.join(", "));

  const answers = await parallelLimit(terms, 2, async term => {
    try {
      return await getText(
        abs("/buscar?q=" + encodeURIComponent(term)),
        BASE + "/"
      );
    } catch (e) {
      log("Búsqueda falló", term, e.message);
      return null;
    }
  });

  if (answers.every(a => a === null)) {
    throw kino.error("unavailable", "el sitio no respondió");
  }

  const found = [];
  const seen = new Set();

  for (const html of answers) {
    if (!html) continue;

    for (const c of parseCards(html, BASE + "/")) {
      if (seen.has(c.slug)) continue;

      seen.add(c.slug);
      found.push(c);
    }
  }

  const relevant = kino.rank.filterRelevant(
    found,
    terms,
    c => c.title
  );

  const kept = relevant.length ? relevant : found;

  const sorted = kino.rank.sortBySimilarity(
    kept,
    terms,
    c => c.title
  );

  const result = catalogItems(sorted).slice(0, MAX_ITEMS);

  log("Búsqueda terminada", result.length, "resultados");

  return result;
}

// ---- inicio ------------------------------------------------------------------

export async function home() {
  await null;

  log("Cargando inicio");

  const paths = [
    { id: "front", url: BASE + "/" },
    { id: "top", url: abs("/explorar/?orden=vistas-semana") },
    { id: "seen", url: abs("/explorar/?orden=vistas") },
    { id: "uncensored", url: abs("/genero/hentai-sin-censura/") }
  ];

  const pages = await parallelLimit(paths, 4, async entry => {
    try {
      return await getText(entry.url, BASE + "/");
    } catch (e) {
      log("Fila no disponible", entry.id, e.message);
      return null;
    }
  });

  const rows = [];

  const push = (id, title, items) => {
    if (items.length) {
      rows.push({
        id,
        title,
        genre: "anime",
        items: items.slice(0, MAX_ITEMS)
      });

      log("Fila creada", id, items.length);
    }
  };

  const [front, top, seen, uncensored] = pages;

  if (front) {
    push(
      "recientes",
      msg("Recién agregados", "Recently added"),
      catalogItems(parseCards(front, BASE + "/"))
    );
  }

  if (top) {
    push(
      "tendencias",
      msg("Tendencias de la semana", "Trending this week"),
      catalogItems(parseCards(top, BASE + "/"))
    );
  }

  if (seen) {
    push(
      "vistos",
      msg("Los más vistos", "Most watched"),
      catalogItems(parseCards(seen, BASE + "/"))
    );
  }

  if (uncensored) {
    push(
      "sin-censura",
      msg("Sin censura", "Uncensored"),
      catalogItems(parseCards(uncensored, BASE + "/"))
    );
  }

  if (!rows.length) {
    log("Inicio vacío");
    throw kino.error("unavailable", "el sitio no devolvió nada");
  }

  log("Inicio terminado", rows.length, "filas");

  return rows;
}

// ---- episodios ---------------------------------------------------------------

export async function episodes(ref) {
  await null;

  const parts = String(ref || "").split("~");
  const slug = parts[1] || "";

  if (parts[0] !== "s" || !slug) {
    throw kino.error("not_found", "esa serie ya no existe");
  }

  log("Cargando episodios", slug);

  const seriesUrl = abs("/serie/" + slug + "/");

  let html;

  try {
    html = await getText(seriesUrl, BASE + "/");
  } catch (e) {
    throw kino.error(
      "not_found",
      "no se pudo abrir la serie: " + e.message
    );
  }

  const titleM = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);

  const seriesPoster = extractImage(html, seriesUrl);

  const list = [];
  const seen = new Set();

  for (const c of parseCards(html, seriesUrl)) {
    const ep = splitEpisode(c.slug);

    if (!ep || ep.slug !== slug || seen.has(c.slug)) continue;

    seen.add(c.slug);

    list.push({
      season: 1,
      number: ep.num,
      ref: "v~" + c.slug,
      title: c.title || msg(
        "Episodio " + ep.num,
        "Episode " + ep.num
      ),
      adult: true
    });

    if (list.length >= MAX_EPISODES) break;
  }

  if (!list.length) {
    throw kino.error("not_found", "esa serie no tiene episodios");
  }

  list.sort((a, b) => a.number - b.number);

  log("Episodios encontrados", slug, list.length);

  return {
    series: {
      title: clean(
        titleM ? titleM[1] : slug.replace(/-/g, " "),
        200
      ),
      poster: seriesPoster,
      genres: ["anime"],
      adult: true
    },
    episodes: list
  };
}

// ---- reproductor -------------------------------------------------------------

function parseEmbed(html) {
  const re = /<iframe\b[^>]*>/gi;
  let m;

  while ((m = re.exec(html))) {
    const src = imageUrl(attr(m[0], "src"), BASE + "/");

    if (
      src &&
      hostOf(src).endsWith("hentaiplayer.com")
    ) {
      return src;
    }
  }

  const loose =
    /https?:\/\/hentaiplayer\.com\/v\/[A-Za-z0-9_-]+\/?/.exec(html);

  return loose ? loose[0] : "";
}

function parseServers(page) {
  const out = [];
  const re =
    /<li\b[^>]*\bdata-id\s*=\s*(["'])([\s\S]*?)\1/gi;

  let m;

  while ((m = re.exec(page))) {
    const dataId = m[2].replace(/&amp;/gi, "&");

    const vidM = /[?&]vid=([^&"'\s]+)/.exec(dataId);

    if (!vidM) continue;

    let file;

    try {
      file = b64(decodeURIComponent(vidM[1])).split("|")[0];
    } catch {
      continue;
    }

    if (!/^https?:\/\//i.test(file)) continue;

    let subtitle;

    const sM = /[?&]s=([^&"'\s]+)/.exec(dataId);

    if (sM) {
      try {
        subtitle = b64(decodeURIComponent(sM[1]));
      } catch {}
    }

    if (subtitle && !/^https?:\/\//i.test(subtitle)) {
      subtitle = undefined;
    }

    out.push({
      file,
      subtitle,
      dataId
    });
  }

  return out;
}

async function episodeHtml(slug, num) {
  const number = Number(num) || 1;

  const episodeSlug = /-episodio-\d+$/i.test(slug)
    ? slug
    : slug + "-episodio-" + number;

  try {
    return await getText(
      abs("/ver/" + episodeSlug + "/"),
      BASE + "/"
    );
  } catch (e) {
    if (number === 1) {
      try {
        return await getText(
          abs("/ver/" + slug + "/"),
          BASE + "/"
        );
      } catch {}
    }

    throw e;
  }
}

async function playServer(entry, episodeUrl, embedUrl) {
  // El CDN valida Referer del player embed, no del episodio en veohentai.
  // Si tenemos embedUrl lo usamos; si no, caemos al PLAYER base.
  const referer = embedUrl || PLAYER + "/";

  if (typeof entry === "string" && /^https?:\/\//i.test(entry)) {
    return {
      url: entry,
      mime: /\.m3u8(\?|$)/i.test(entry)
        ? "application/x-mpegURL"
        : "video/mp4",
      headers: {
        Referer: referer,
        Origin: PLAYER
      }
    };
  }

  if (
    !entry ||
    typeof entry !== "object" ||
    !/^https?:\/\//i.test(entry.file || "")
  ) {
    throw kino.error("not_found", "servidor de video inválido");
  }

  const stream = {
    url: entry.file,
    mime: /\.m3u8(\?|$)/i.test(entry.file)
      ? "application/x-mpegURL"
      : "video/mp4",
    headers: {
      Referer: referer,
      Origin: PLAYER
    }
  };

  if (
    entry.subtitle &&
    /^https?:\/\//i.test(entry.subtitle)
  ) {
    stream.subtitles = [
      {
        url: entry.subtitle,
        label: "Español",
        lang: "es"
      }
    ];
  }

  return stream;
}

function decodeAlternative(ref) {
  const raw = decodeRef(ref);

  // Formato nuevo: objeto con archivo y subtítulo.
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);

      if (
        parsed &&
        /^https?:\/\//i.test(parsed.file || "")
      ) {
        return parsed;
      }
    } catch {}
  }

  // Compatibilidad con referencias antiguas:
  // data-id de HentaiPlayer.
  const vidM = /[?&]vid=([^&"'\s]+)/.exec(raw);

  if (vidM) {
    let file;

    try {
      file = b64(decodeURIComponent(vidM[1])).split("|")[0];
    } catch {
      throw kino.error("not_found", "ese servidor ya no sirve");
    }

    if (!/^https?:\/\//i.test(file)) {
      throw kino.error("not_found", "ese servidor ya no sirve");
    }

    let subtitle;
    const sM = /[?&]s=([^&"'\s]+)/.exec(raw);

    if (sM) {
      try {
        subtitle = b64(decodeURIComponent(sM[1]));
      } catch {}
    }

    if (subtitle && !/^https?:\/\//i.test(subtitle)) {
      subtitle = undefined;
    }

    return {
      file,
      subtitle
    };
  }

  // También permite referencias antiguas que guardaban directamente URL.
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  throw kino.error("not_found", "ese servidor ya no sirve");
}

// Captura el request real al video usando kino.browser.
// Abre el embed de hentaiplayer y espera el primer request a un .mp4 o .m3u8.
async function captureViaBrowser(embedUrl, episodeUrl) {
  log("Browser capture", embedUrl);

  const result = await kino.browser.capture(embedUrl, {
    headers: { Referer: episodeUrl || (BASE + "/") },
    match: "^https?://(?!.*(?:ad[sz]?[.-]|doubleclick|googlesyndication|adnxs|advertising|adserver|adcdn|adsterra|popads|popcash|trafficjunky|adspyglass|exoclick|juicyads|plugrush|trafficfactory|adultadworld))[^?#]+\\.mp4(\\?|$)|^https?://(?!.*(?:ad[sz]?[.-]|doubleclick|googlesyndication|adnxs|advertising|adserver|adcdn|adsterra|popads|popcash|trafficjunky|adspyglass|exoclick|juicyads|plugrush|trafficfactory|adultadworld))[^?#]+\\.m3u8(\\?|$)",
    timeoutMs: 25000
  });

  // kino.browser.capture devuelve { media, subtitles, requests, finalUrl }
  // El video está en result.media[0]
  const media = result && Array.isArray(result.media) ? result.media : [];

  if (!media.length) {
    log("Browser capture: sin media");
    return null;
  }

  const item = media[0];
  let url = item.url || "";

  // JWPlayer a veces dispara primero el ping de analytics (prd.jwpltx.com)
  // con la URL real del video codificada en el parámetro mu=.
  // Extraemos esa URL en vez de descartar el resultado.
  if (/prd\.jwpltx\.com/i.test(url)) {
    const muM = /[?&]mu=([^&]+)/.exec(url);
    if (muM) {
      try { url = decodeURIComponent(decodeURIComponent(muM[1])); }
      catch { url = decodeURIComponent(muM[1]); }
      log("Browser capture: URL extraída del ping de analytics", url);
    }
  }

  if (!/^https?:\/\//i.test(url)) {
    log("Browser capture: URL inválida", url);
    return null;
  }

  // Los headers capturados deben ir al reproductor tal cual — el CDN los valida.
  // Si vienen vacíos, forzamos los mínimos que r2.1hanime.com exige.
  const capturedHeaders = Object.assign({}, item.headers || {});

  if (!capturedHeaders.Referer && !capturedHeaders.referer) {
    capturedHeaders.Referer = embedUrl;
  }
  if (!capturedHeaders.Origin && !capturedHeaders.origin) {
    capturedHeaders.Origin = PLAYER;
  }

  log("Browser capture OK", url);

  const stream = {
    url,
    mime: item.mime || (/\.m3u8(\?|$)/i.test(url) ? "application/x-mpegURL" : "video/mp4"),
    headers: capturedHeaders
  };

  // Subtítulos capturados por el browser
  const subs = result.subtitles || [];
  if (subs.length) {
    stream.subtitles = subs
      .filter(s => s && /^https?:\/\//i.test(s.url || ""))
      .map(s => ({
        url: s.url,
        lang: s.lang || "es",
        format: /\.vtt(\?|$)/i.test(s.url) ? "vtt" : "srt"
      }));
  }

  return stream;
}

export async function resolve(ref) {
  await null;

  const parts = String(ref || "").split("~");

  // Resolver servidor alternativo.
  if (parts[0] === "p") {
    log("Resolviendo servidor alternativo");

    const entry = decodeAlternative(
      parts.slice(1).join("~")
    );

    return await playServer(entry, BASE + "/", PLAYER + "/");
  }

  if (parts[0] !== "v" || !parts[1]) {
    throw kino.error(
      "not_found",
      "esa dirección no es un episodio"
    );
  }

  const slug = parts[1];
  const num = Number(parts[2]) || 1;

  log("Resolviendo episodio", slug, num);

  let html;

  try {
    html = await episodeHtml(slug, num);
  } catch (e) {
    throw kino.error(
      "not_found",
      "no se pudo abrir el episodio: " + e.message
    );
  }

  const embed = parseEmbed(html);

  if (!embed) {
    throw kino.error("not_found", "el episodio no tiene reproductor", {
      userMessage: msg(
        "Este episodio no tiene reproductor disponible.",
        "This episode has no available player."
      )
    });
  }

  const episodeSlug = /-episodio-\d+$/i.test(slug)
    ? slug
    : slug + "-episodio-" + num;
  const episodeUrl = abs("/ver/" + episodeSlug + "/");

  // --- Ruta principal: browser capture para obtener URL autenticada ---
  let browserStream = null;

  try {
    browserStream = await captureViaBrowser(embed, episodeUrl);
  } catch (e) {
    log("Browser capture falló", e.message);
  }

  if (browserStream) {
    log("Resolución completada (browser)", slug);
    return {
      ...browserStream,
      label: msg("Reproducir", "Play"),
      expiresInSeconds: 300
    };
  }

  // --- Fallback: segundo intento con browser capture, más tiempo ---
  // Las URLs firmadas de r2.1hanime.com solo son válidas en el contexto del
  // browser que las generó — reproducirlas directamente desde getText da 403.
  // Intentamos una segunda captura con 50 s, ampliando también el match al
  // ping de analytics por si JWPlayer tarda en disparar el request al CDN.
  log("Fallback a segundo browser capture (50 s)");

  try {
    const result2 = await kino.browser.capture(embed, {
      headers: { Referer: episodeUrl || (BASE + "/") },
      match: "^https?://(?!.*(?:ad[sz]?[.-]|doubleclick|googlesyndication|adnxs|advertising|adserver|adcdn|adsterra|popads|popcash|trafficjunky|adspyglass|exoclick|juicyads|plugrush|trafficfactory|adultadworld))[^?#]+\\.mp4(\\?|$)|^https?://(?!.*(?:ad[sz]?[.-]|doubleclick|googlesyndication|adnxs|advertising|adserver|adcdn|adsterra|popads|popcash|trafficjunky|adspyglass|exoclick|juicyads|plugrush|trafficfactory|adultadworld))[^?#]+\\.m3u8(\\?|$)|prd\\.jwpltx\\.com",
      timeoutMs: 25000
    });

    const media2 = result2 && Array.isArray(result2.media) ? result2.media : [];

    if (media2.length) {
      let url2 = media2[0].url || "";

      if (/prd\.jwpltx\.com/i.test(url2)) {
        const muM = /[?&]mu=([^&]+)/.exec(url2);
        if (muM) {
          try { url2 = decodeURIComponent(decodeURIComponent(muM[1])); }
          catch { url2 = decodeURIComponent(muM[1]); }
          log("Fallback: URL extraída del ping de analytics", url2);
        }
      }

      if (/^https?:\/\//i.test(url2)) {
        const capturedHeaders2 = Object.assign({}, media2[0].headers || {});
        if (!capturedHeaders2.Referer && !capturedHeaders2.referer) capturedHeaders2.Referer = embed;
        if (!capturedHeaders2.Origin && !capturedHeaders2.origin) capturedHeaders2.Origin = PLAYER;

        log("Resolución completada (fallback browser)", slug);
        return {
          url: url2,
          mime: /\.m3u8(\?|$)/i.test(url2) ? "application/x-mpegURL" : "video/mp4",
          headers: capturedHeaders2,
          label: msg("Reproducir", "Play"),
          expiresInSeconds: 300
        };
      }
    }
  } catch (e) {
    log("Fallback browser capture falló", e.message);
  }

  // --- Último recurso: parsear HTML del player ---
  log("Último recurso: parseo directo del player");

  let page;

  try {
    page = await getText(embed, BASE + "/");
  } catch (e) {
    throw kino.error(
      "unavailable",
      "el reproductor no respondió: " + e.message
    );
  }

  const servers = parseServers(page);

  if (!servers.length) {
    const loose =
      /(https?:\/\/[^"'\s]+?\.mp4[^"'\s]*)/i.exec(page);

    if (loose) {
      servers.push({
        file: loose[1],
        subtitle: undefined
      });
    }
  }

  if (!servers.length) {
    throw kino.error("unavailable", "el reproductor no entregó archivo", {
      userMessage: msg(
        "El reproductor no entregó ningún video.",
        "The player returned no video."
      )
    });
  }

  log("Servidores encontrados (fallback)", servers.length);

  const stream = await playServer(servers[0], episodeUrl, embed);
  const alternatives = [];

  for (let i = 1; i < servers.length; i++) {
    const alternativeData = JSON.stringify({
      file: servers[i].file,
      subtitle: servers[i].subtitle
    });

    alternatives.push({
      label: msg(
        "Alternativa " + (i + 1),
        "Alternative " + (i + 1)
      ),
      ref: "p~" + encodeRef(alternativeData)
    });
  }

  log("Resolución completada (fallback)", slug);

  return {
    ...stream,
    label: msg("Reproducir", "Play"),
    alternatives
  };
}


