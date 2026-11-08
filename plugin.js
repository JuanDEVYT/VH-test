const BASE = "https://veohentai.com";
const PLAYER = "https://hentaiplayer.com";
const PLAYER_REF = PLAYER + "/";
const TIMEOUT = 12000;
const MAX_ITEMS = 60;
const MAX_EPISODES = 3000;
const POW_LIMIT = 4000000;
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function log(...args) {
  try { kino.log(...args); } catch {}
}

function es() {
  return String(kino.lang || "es-CO").toLowerCase().indexOf("en") !== 0;
}

function msg(esText, enText) {
  return es() ? esText : enText;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return ""; }
}

function sleep(ms) {
  return kino.sleep(ms);
}

async function getText(url, referer) {
  const headers = { "User-Agent": UA };
  if (referer) headers.Referer = referer;

  const r = await kino.fetch(url, {
    headers,
    timeoutMs: TIMEOUT
  });

  if (!r.ok) throw new Error(url + " respondió " + r.status);
  return r.text();
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

  try { return new URL(v, pageUrl || BASE + "/").href; }
  catch { return undefined; }
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

function encodeRef(url) {
  try { return btoa(encodeURIComponent(url)); }
  catch { return btoa(url); }
}

function decodeRef(value) {
  let raw;

  try { raw = atob(value); }
  catch { throw kino.error("not_found", "ese servidor ya no sirve"); }

  try { return decodeURIComponent(raw); }
  catch { return raw; }
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

  return candidates.length ? candidates[candidates.length - 1] : "";
}

// Extrae imágenes evitando logos, iconos y placeholders.
function extractImage(block, pageUrl) {
  if (!block) return undefined;

  const tags = [];
  const tagRe = /<(?:img|source)\b[^>]*>/gi;
  let m;

  while ((m = tagRe.exec(block))) tags.push(m[0]);

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

    const set = validPoster(srcsetUrl(attr(tag, "srcset")), pageUrl);
    if (set) return set;

    const lazy = validPoster(srcsetUrl(attr(tag, "data-srcset")), pageUrl);
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
    const next = i + 1 < marks.length ? marks[i + 1].at : from + 3000;
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
    poster: c.poster,
    genres: ["anime"]
  };
}

// Agrupa capítulos de una misma serie.
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

// ---- búsqueda --------------------------------------------------------------

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

  const answers = await Promise.all(
    terms.map(async term => {
      try {
        return await getText(
          abs("/buscar?q=" + encodeURIComponent(term)),
          BASE + "/"
        );
      } catch (e) {
        log("búsqueda falló", term, e.message);
        return null;
      }
    })
  );

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

  const relevant = kino.rank.filterRelevant(found, terms, c => c.title);
  const kept = relevant.length ? relevant : found;

  const sorted = kino.rank.sortBySimilarity(kept, terms, c => c.title);

  return catalogItems(sorted).slice(0, MAX_ITEMS);
}

// ---- inicio -----------------------------------------------------------------

export async function home() {
  await null;

  const [front, top, seen, uncensored] = await Promise.all([
    getText(BASE + "/", BASE + "/").catch(e => {
      log("Inicio falló", e.message);
      return null;
    }),

    getText(abs("/explorar/?orden=vistas-semana"), BASE + "/").catch(() => null),

    getText(abs("/explorar/?orden=vistas"), BASE + "/").catch(() => null),

    getText(abs("/genero/hentai-sin-censura/"), BASE + "/").catch(() => null)
  ]);

  const rows = [];

  const push = (id, title, items) => {
    if (items.length) {
      rows.push({
        id,
        title,
        genre: "anime",
        items: items.slice(0, MAX_ITEMS)
      });
    }
  };

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
    throw kino.error("unavailable", "el sitio no devolvió nada");
  }

  return rows;
}

// ---- episodios --------------------------------------------------------------

export async function episodes(ref) {
  await null;

  const parts = String(ref || "").split("~");
  const slug = parts[1] || "";

  if (parts[0] !== "s" || !slug) {
    throw kino.error("not_found", "esa serie ya no existe");
  }

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

  // Prioriza la portada del contenido principal, no el logo.
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
      ref: "v~" + ep.slug + "~" + ep.num,
      title: c.title || msg(
        "Episodio " + ep.num,
        "Episode " + ep.num
      )
    });

    if (list.length >= MAX_EPISODES) break;
  }

  if (!list.length) {
    throw kino.error("not_found", "esa serie no tiene episodios");
  }

  list.sort((a, b) => a.number - b.number);

  return {
    series: {
      title: clean(
        titleM ? titleM[1] : slug.replace(/-/g, " "),
        200
      ),
      poster: seriesPoster,
      genres: ["anime"]
    },
    episodes: list
  };
}

// ---- reproductor ------------------------------------------------------------

// SHA-256 en JS puro (el runtime del plugin no siempre expone crypto.subtle).
const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function hex8(value) {
  let s = (value >>> 0).toString(16);
  while (s.length < 8) s = "0" + s;
  return s;
}

function sha256hex(input) {
  const m = [];
  for (let i = 0; i < input.length; i++) m.push(input.charCodeAt(i) & 0xff);

  const bits = m.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);

  const hi = Math.floor(bits / 4294967296);
  const lo = bits >>> 0;

  m.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  m.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Array(64);

  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (m[off + 4 * i] << 24) |
        (m[off + 4 * i + 1] << 16) |
        (m[off + 4 * i + 2] << 8) |
        m[off + 4 * i + 3];
    }

    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const pick = (e & f) ^ (~e & g);
      const t1 = (h + s1 + pick + SHA_K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;

      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map(hex8).join("");
}

// Huella mínima: el servidor solo la registra, no la compara en duro.
const FP = btoa(JSON.stringify({
  t: 2400, i: 1, mc: 0, tc: 0, cc: 0, kc: 0, mm: [], tm: [],
  b: {
    sw: 1920, sh: 1080, aw: 1920, ah: 1040, cd: 24, tz: 0,
    hc: 8, dm: 8, pl: "Win32", lang: "es", dpr: 1,
    ww: 1920, wh: 1080, touch: false
  }
}));

async function solvePow(challenge) {
  for (let i = 0; i < POW_LIMIT; i++) {
    if (sha256hex(challenge + i.toString(16)).slice(0, 4) === "0000") {
      return i.toString(16);
    }

    if ((i & 2047) === 0) await sleep(0);
  }

  throw new Error("reto agotado");
}

function parseEmbed(html) {
  const meta = /"embedUrl"\s*:\s*"([^"]+)"/i.exec(html);

  if (meta && hostOf(meta[1]).indexOf("hentaiplayer.com") !== -1) {
    return meta[1].replace(/\\\//g, "/");
  }

  const re = /<(?:iframe|div)\b[^>]*\b(?:src|data-src)\s*=\s*(["'])([^"']+)\1/gi;
  let m;

  while ((m = re.exec(html))) {
    const src = imageUrl(m[2], BASE + "/");

    if (src && hostOf(src).indexOf("hentaiplayer.com") !== -1) {
      return src;
    }
  }

  const loose = /https?:\/\/hentaiplayer\.com\/v\/[A-Za-z0-9_-]+\/?/.exec(html);
  return loose ? loose[0] : "";
}

function parseServers(page) {
  const out = [];
  const re = /<li\b[^>]*\bdata-id\s*=\s*(["'])([\s\S]*?)\1/gi;
  let m;

  while ((m = re.exec(page))) {
    const dataId = m[2].replace(/&amp;/gi, "&");
    const vidM = /[?&]vid=([^&"'\s]+)/.exec(dataId);

    if (!vidM) continue;

    let raw;

    try {
      raw = b64(decodeURIComponent(vidM[1]));
    } catch {
      continue;
    }

    // formato: file|expiración|hash
    const bits = raw.split("|");
    const file = bits[0];

    if (!/^https?:\/\//i.test(file)) continue;

    let subtitle;
    const sM = /[?&]s=([^&"'\s]+)/.exec(dataId);

    if (sM) {
      try { subtitle = b64(decodeURIComponent(sM[1])); }
      catch {}
    }

    if (subtitle && !/^https?:\/\//i.test(subtitle)) {
      subtitle = undefined;
    }

    out.push({
      file,
      exp: bits[1] || "",
      hash: bits[2] || "",
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
    return await getText(abs("/ver/" + episodeSlug + "/"), BASE + "/");
  } catch (e) {
    // Algunas películas o episodios únicos usan /ver/slug/ sin sufijo.
    if (number === 1) {
      try {
        return await getText(abs("/ver/" + slug + "/"), BASE + "/");
      } catch {}
    }

    throw e;
  }
}

function mimeOf(url) {
  return /\.m3u8(\?|$)/i.test(url) ? "application/x-mpegURL" : "video/mp4";
}

// Cadena real del player: /player.php -> player-core-v2.php -> reto -> URL firmada.
async function playerUrl(entry) {
  const referer = PLAYER + (entry.dataId || "/");
  const started = Date.now();

  const page = await getText(PLAYER + entry.dataId, BASE + "/");

  const coreM = /player-core-v2\.php\?t=([A-Za-z0-9_\-]+)(?:&amp;|&)_=(\d+)/.exec(page);

  if (!coreM) throw new Error("el reproductor no entregó token");

  const core = await getText(
    PLAYER + "/player-core-v2.php?t=" + coreM[1] + "&_=" + coreM[2],
    referer
  );

  const cM = /\bc\s*:\s*"([A-Za-z0-9_\-.]+)"/.exec(core);
  const tM = /\bt\s*:\s*'(\d+)'/.exec(core);

  if (!cM || !tM) throw new Error("el reproductor no entregó el reto");

  const token = cM[1];
  const stamp = tM[1];

  let nonce = "";

  try {
    nonce = String(JSON.parse(b64(token.split(".")[0])).n || "");
  } catch {}

  if (!/^[0-9a-f]{32}$/i.test(nonce)) throw new Error("reto ilegible");

  // El servidor espera al menos ~2,1 s de "interacción" antes de validar.
  const wait = 2400 - (Date.now() - started);
  if (wait > 0) await sleep(wait);

  const proof = await solvePow(nonce + stamp);

  const query =
    "c=" + encodeURIComponent(token) +
    "&p1=" + nonce.slice(0, 8) +
    "&p2=" + nonce.slice(8, 16) +
    "&p3=" + nonce.slice(16, 24) +
    "&p4=" + nonce.slice(24, 32) +
    "&t=" + stamp +
    "&pow=" + proof +
    "&fp=" + encodeURIComponent(FP) +
    "&df=wd";

  const r = await kino.fetch(PLAYER + "/get-video-url-v2.php?" + query, {
    headers: {
      Referer: referer,
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest"
    },
    timeoutMs: TIMEOUT
  });

  const text = await r.text();

  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!r.ok || !data || !data.url) {
    throw new Error((data && data.error) || "reproductor " + r.status);
  }

  if (!/^https?:\/\//i.test(data.url)) throw new Error("url inválida");

  return data.url;
}

function withSubtitle(stream, entry) {
  if (entry && entry.subtitle) {
    stream.subtitles = [
      { url: entry.subtitle, label: "Español", lang: "es" }
    ];
  }

  return stream;
}

async function resolveServer(entry) {
  if (typeof entry === "string" && /^https?:\/\//i.test(entry)) {
    return {
      stream: {
        url: entry,
        mime: mimeOf(entry),
        headers: { Referer: PLAYER_REF }
      },
      alternatives: []
    };
  }

  const alternatives = [];
  let url = "";

  try {
    url = await playerUrl(entry);
  } catch (e) {
    log("cadena del reproductor falló", e.message);
  }

  // Respaldo si el reto falla: firmas directas del archivo.
  if (!url && entry.file) {
    if (entry.exp && entry.hash) {
      alternatives.push({
        label: msg("Firma directa", "Direct signature"),
        url: entry.file + "?e=" + entry.exp + "&h=" + entry.hash
      });
    }

    alternatives.push({
      label: msg("Archivo directo", "Direct file"),
      url: entry.file
    });
  }

  if (!url) {
    const first = alternatives.shift();

    return {
      stream: withSubtitle({
        url: first.url,
        mime: mimeOf(first.url),
        headers: { Referer: PLAYER_REF }
      }, entry),
      alternatives
    };
  }

  return {
    stream: withSubtitle({
      url,
      mime: mimeOf(url),
      headers: { Referer: PLAYER_REF }
    }, entry),
    alternatives
  };
}

export async function resolve(ref) {
  await null;

  const parts = String(ref || "").split("~");

  if (parts[0] === "p") {
    let dataId;

    try {
      dataId = decodeRef(parts.slice(1).join("~"));
    } catch {
      throw kino.error("not_found", "ese servidor ya no sirve");
    }

    const result = await resolveServer({ dataId });

    return {
      ...result.stream,
      label: msg("Reproducir", "Play"),
      alternatives: result.alternatives
    };
  }

  if (parts[0] !== "v" || !parts[1]) {
    throw kino.error("not_found", "esa dirección no es un episodio");
  }

  const slug = parts[1];
  const num = Number(parts[2]) || 1;

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
    const loose = /(https?:\/\/[^"'\s]+?\.mp4[^"'\s]*)/i.exec(page);

    if (loose) {
      servers.push({
        file: loose[1],
        dataId: loose[1]
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

  const primary = await resolveServer(servers[0]);
  const alternatives = primary.alternatives.slice();

  for (let i = 1; i < servers.length; i++) {
    alternatives.push({
      label: msg(
        "Alternativa " + (i + 1),
        "Alternative " + (i + 1)
      ),
      ref: "p~" + encodeRef(servers[i].dataId)
    });
  }

  return {
    ...primary.stream,
    label: msg("Reproducir", "Play"),
    alternatives
  };
}

export async function screen({ state = {}, route = {} } = {}) {
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      title: "VeoHentai",
      titleEn: "VeoHentai",
      mergeWithKinoBar: true,
      dense: true,
      leading: {
        type: "IconButton",
        icon: "close",
        labelText: "Cerrar",
        labelTextEn: "Close",
        onPressed: { close: true }
      }
    },
    body: {
      type: "SingleChildScrollView",
      children: [{
        type: "Column",
        padding: 16,
        gap: 12,
        children: [
          {
            type: "Text",
            text: "Abre VeoHentai en el navegador integrado de Kino. Si aparece una verificación, complétala allí.",
            textEn: "Open VeoHentai in Kino's built-in browser. If a verification appears, complete it there."
          },
          {
            type: "ElevatedButton",
            key: "openPlayer",
            labelText: "Abrir VeoHentai",
            labelTextEn: "Open VeoHentai",
            onPressed: "openPlayer",
            autofocus: true
          }
        ]
      }]
    }
  };
}

export async function screenEvent({ name } = {}) {
  if (name === "openPlayer") {
    try {
      await kino.visualBrowser.open({
        url: BASE + "/",
        title: "VeoHentai",
        userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        timeoutMs: 120000
      });
    } catch (error) {
      log("Error abriendo VeoHentai:", error);
    }
  }

  return null;
}
