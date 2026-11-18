const BASE = "https://veohentai.com";
const PLAYER = "https://hentaiplayer.com";
const TIMEOUT = 12000;
const MAX_ITEMS = 60;
const MAX_EPISODES = 3000;

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

async function getText(url, referer) {
  const headers = {};
  if (referer) headers.Referer = referer;

  const r = await kino.fetch(url, {
    headers,
    timeoutMs: TIMEOUT
  });

  if (!r.ok) throw new Error(url + " respondió con HTTP " + r.status);
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

function parseGenres(html) {
  const genres = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*(["'])([^"']*\/genero\/([^/"'?#]+)\/?)[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html))) {
    const slug = m[3];
    if (!slug || seen.has(slug)) continue;

    const block = m[4];
    const titleMatch = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(block);
    if (!titleMatch) continue;

    const title = clean(titleMatch[1], 100);
    const imageMatch = /<img\b[^>]*>/i.exec(block);
    const poster = imageMatch
      ? imageUrl(
          attr(imageMatch[0], "src") || attr(imageMatch[0], "data-src"),
          BASE + "/generos/"
        )
      : undefined;

    if (!title) continue;

    seen.add(slug);
    genres.push({ slug, title, poster });
  }

  return genres;
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
    ? { slug: m[1], num: Number(m[2]) } : null;
}

function seriesTitle(title, slug) {
  const cleaned = clean(title, 200)
    .replace(/\s*[-â€“â€”|:]?\s*episodio\s*\d+\s*$/i, "")
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
        log("búsqueda fallida", term, e.message);
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
      log("Inicio fallido", e.message);
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
            msg("Recien agregados", "Recently added"),
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
            msg("Los mas vistos", "Most watched"),
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

export async function getGenres() {
  const html = await getText(abs("/generos/"), BASE + "/");
  return parseGenres(html);
}

async function getGenrePage(slug, page = 1) {
  const value = String(slug || "").trim();
  if (!/^[a-z0-9-]+$/i.test(value)) throw new Error("Genero no valido");
  const basePath = "/genero/" + value + "/";
  const url = abs(page > 1 ? basePath + "page/" + page + "/" : basePath);
  const html = await getText(url, BASE + "/");
  const items = catalogItems(parseCards(html, url));
  const re = new RegExp("page/([0-9]+)/", "g");
  const links = [...html.matchAll(re)];
  const totalPages = Math.max(page, 1, ...links.map(x => Number(x[1])));
  return { items, totalPages };
}

export async function getGenreCatalog(slug, page = 1) {
  return (await getGenrePage(slug, page)).items;
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
  let sourceUrl = seriesUrl;
  let html;
  let fromSearch = false;

  try {
    html = await getText(seriesUrl, BASE + "/");
  } catch (originalError) {
    const searchTerm = slug.replace(/_/g, "-")
      .split("-").slice(0, 2).join("-");

    sourceUrl = abs("/buscar?q=" + encodeURIComponent(searchTerm));

    try {
      html = await getText(sourceUrl, BASE + "/");
      fromSearch = true;
      log("episodios: usando búsqueda alternativa", slug);
    } catch (e) {
      throw kino.error(
        "not_found",
        "no se pudo abrir la serie: " + originalError.message
      );
    }
  }

  const titleM = fromSearch
    ? null
    : /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);

  const normalizedSlug = slug.replace(/[-_]/g, "");

  const matchingCards = parseCards(html, sourceUrl).filter(c => {
    const ep = splitEpisode(c.slug);
    return ep && ep.slug.replace(/[-_]/g, "") === normalizedSlug;
  });

  const seriesName = fromSearch
    ? seriesTitle(matchingCards[0]?.title || "", slug)
    : clean(titleM ? titleM[1] : slug.replace(/-/g, " "), 200);

  const seriesPoster = fromSearch
    ? (matchingCards.find(c => c.poster)?.poster || "")
    : extractImage(html, seriesUrl);

  const list = [];
  const seen = new Set();

  for (const c of matchingCards) {
    const ep = splitEpisode(c.slug);

    if (!ep || seen.has(c.slug)) continue;
    seen.add(c.slug);

    list.push({
      season: 1,
      number: ep.num,
      ref: "v~" + ep.slug + "~" + ep.num + "~" +
        encodeURIComponent(seriesName).replace(/~/g, "%7E"),
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
      title: seriesName,
      poster: seriesPoster,
      genres: ["anime"]
    },
    episodes: list
  };
}

// ---- reproductores multi: Hentaila.com + Hentaila.tv + VOE -----------------

const HENTAILA_COM = "https://hentaila.com";
const HENTAILA_TV = "https://hentaila.tv";
const HENTAILA_TV_API =
  "https://hentaila.tv/wp-content/plugins/player-logic/api.php";

function rot13(text) {
  return String(text).replace(/[a-zA-Z]/g, ch => {
    const c = ch.charCodeAt(0);
    const base = c <= 90 ? 65 : 97;
    return String.fromCharCode(((c - base + 13) % 26) + base);
  });
}

function mimeOf(url) {
  return /\.m3u8(\?|$)/i.test(url)
    ? "application/x-mpegURL"
    : "video/mp4";
}

function episodePath(slug, num) {
  const n = Number(num) || 1;
  const episodeSlug = /-episodio-\d+$/i.test(slug)
    ? slug
    : slug + "-episodio-" + n;

  return "/ver/" + episodeSlug + "/";
}

async function sourceEpisodeHtml(base, slug, num) {
  const path = episodePath(slug, num);

  try {
    return await getText(base + path, base + "/");
  } catch (e) {
    if ((Number(num) || 1) === 1) {
      return await getText(base + "/ver/" + slug + "/", base + "/");
    }
    throw e;
  }
}

// Busca el reproductor incrustado en la página del episodio.
function parsePlayerEmbed(html, pageUrl) {
  const re = /<(?:iframe|embed)\b[^>]*>/gi;
  let m;

  while ((m = re.exec(html))) {
    const tag = m[0];
    const src = imageUrl(
      attr(tag, "src") || attr(tag, "data-src"),
      pageUrl
    );

    if (!src) continue;

    const host = hostOf(src);

    if (
      host.includes("hentaiplayer.com") ||
      host.includes("hentaila.com") ||
      host.includes("hentaila.tv") ||
      host.includes("voe.sx") ||
      /player\.php/i.test(src)
    ) {
      return src;
    }
  }

  const patterns = [
    /https?:\/\/(?:www\.)?hentaiplayer\.com\/v\/[A-Za-z0-9_-]+\/?/i,
    /https?:\/\/(?:www\.)?voe\.sx\/e\/[A-Za-z0-9]+/i,
    /https?:\/\/(?:www\.)?hentaila\.tv\/[^"'\\\s]*player\.php[^"'\\\s]*/i
  ];

  for (const pattern of patterns) {
    const found = pattern.exec(html);
    if (found) return found[0].replace(/&amp;/g, "&");
  }

  return "";
}

// Convierte el data-id del reproductor en un servidor.
function parseServerDataId(dataId) {
  const value = String(dataId || "").replace(/&amp;/gi, "&");
  const vidM = /[?&]vid=([^&"'\s]+)/.exec(value);

  if (!vidM) throw new Error("data-id sin video");

  let decoded;

  try {
    decoded = b64(decodeURIComponent(vidM[1]));
  } catch {
    throw new Error("data-id inválido");
  }

  const parts = decoded.split("|");
  const file = parts[0];

  if (!/^https?:\/\//i.test(file)) {
    throw new Error("URL de video inválida");
  }

  let subtitle;
  const subM = /[?&]s=([^&"'\s]+)/.exec(value);

  if (subM) {
    try {
      subtitle = b64(decodeURIComponent(subM[1]));
    } catch {}
  }

  if (subtitle && !/^https?:\/\//i.test(subtitle)) {
    subtitle = undefined;
  }

  return {
    file,
    subtitle,
    dataId: value
  };
}

function parseServers(page) {
  const servers = [];
  const re = /<li\b[^>]*\bdata-id\s*=\s*(["'])([\s\S]*?)\1/gi;
  let m;

  while ((m = re.exec(page))) {
    try {
      servers.push(parseServerDataId(m[2]));
    } catch (e) {
      log("Servidor ignorado", e.message);
    }
  }

  return servers;
}

// ---- VOE --------------------------------------------------------------------

async function fromVoe(url) {
  const idM = /\/e\/([a-z0-9]+)/i.exec(url);

  if (!idM) throw new Error("ID de VOE inválido");

  const pageUrl = "https://arianathankspecial.com/e/" + idM[1];
  const html = await getText(pageUrl, "https://arianathankspecial.com/");

  const blobM =
    /<script type="application\/json">\s*(\[[\s\S]*?\])\s*<\/script>/i.exec(html);

  if (!blobM) throw new Error("VOE no entregó datos");

  const list = JSON.parse(blobM[1]);
  const encoded = Array.isArray(list) ? list[0] : null;

  if (typeof encoded !== "string") {
    throw new Error("Datos VOE inválidos");
  }

  const clean1 = rot13(encoded).replace(
    /@\$|#&|!!|%\?|\^\^|~@|\*~/g,
    ""
  );

  let step1; try { step1 = atob(clean1); } catch (e) { throw new Error("VOE: falla Base64 inicial; longitud " + clean1.length); }
  let shifted = "";  for (let i = 0; i < step1.length; i++) {
    shifted += String.fromCharCode(step1.charCodeAt(i) - 3);
  }

  const reversed = shifted.split("").reverse().join("");
  let decoded; try { decoded = atob(reversed.replace(/^=+/, "")); } catch (e) { throw new Error("VOE: falla Base64 final; longitud " + reversed.length); }
  const json = JSON.parse(decoded);
  const file = json.source || json.direct_access_url;

  if (!file || !/^https?:\/\//i.test(file)) {
    throw new Error("VOE no entregó el archivo");
  }

  return {
    url: file,
    mime: mimeOf(file),
    headers: { Referer: pageUrl }
  };
}

// Conserva aquí tu función withSubtitle original sin modificarla.

async function playServer(entry, referer) {
  if (typeof entry === "string") {
    if (/voe\.sx\/e\//i.test(entry)) {
      return await fromVoe(entry);
    }

    return {
      url: entry,
      mime: mimeOf(entry),
      headers: { Referer: referer || HENTAILA_COM + "/" }
    };
  }

  if (!entry || !entry.file) {
    throw new Error("Servidor sin archivo");
  }

  if (/voe\.sx\/e\//i.test(entry.file)) {
    return withSubtitle(await fromVoe(entry.file), entry);
  }

  return withSubtitle({
    url: entry.file,
    mime: mimeOf(entry.file),
    headers: { Referer: referer || HENTAILA_COM + "/" }
  }, entry);
}

// ---- Hentaila.com -----------------------------------------------------------

function hentailaWords(value) {
  return clean(value, 300)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bova\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

async function findHentailaSlug(title) {
  const words = hentailaWords(title);
  if (!words.length) throw new Error("Título vacío para buscar");

  const queries = [
    title,
    words.slice(0, 2).join(" ")
  ];

  let best = null;

  for (const query of [...new Set(queries)]) {
    const searchUrl =
      "https://www5.hentaila.com/catalogo?search=" +
      encodeURIComponent(query);

    const html = await getText(searchUrl, HENTAILA_COM + "/");
    const re = /<a\b[^>]*href=["']\/media\/([^"'/?#]+)["'][^>]*>/gi;
    let match;

    while ((match = re.exec(html))) {
      const before = html.slice(
        Math.max(0, match.index - 1800),
        match.index
      );

      const titles = [
        ...before.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)
      ];

      if (!titles.length) continue;

      const candidateTitle = clean(
        titles[titles.length - 1][1],
        200
      );

      const candidateWords = hentailaWords(candidateTitle);
      if (!candidateWords.length) continue;

      const matched = candidateWords.filter(
        word => words.includes(word)
      ).length;

      const score = matched / candidateWords.length;

      if (!best || score > best.score) {
        best = {
          slug: match[1],
          title: candidateTitle,
          score
        };
      }
    }
  }

  if (!best || best.score < 0.6) {
    throw new Error("No se encontró una serie coincidente en Hentaila.com");
  }

  log("Hentaila.com: serie encontrada", best.title, best.slug);
  return best.slug;
}

async function resolveHentailaCom(slug, num, title) {
  let cleanSlug = String(slug).replace(/^\/+|\/+$/g, "");

  if (title) {
    cleanSlug = await findHentailaSlug(title);
  }

  const pageUrl =
    HENTAILA_COM + "/media/" + cleanSlug + "/" + (Number(num) || 1);

  const html = await getText(pageUrl, HENTAILA_COM + "/");
  const servers = [];
  const re = /server\s*:\s*"([^"]+)"\s*,\s*url\s*:\s*"([^"]+)"/gi;
  let match;

  while ((match = re.exec(html))) {
    servers.push({
      server: match[1],
      url: match[2].replace(/&amp;/g, "&")
    });
  }

  if (!servers.length) {
    throw new Error("Hentaila.com no entregó servidores");
  }

  const voe = servers.find(server =>
    /voe/i.test(server.server) || /voe\.sx\/e\//i.test(server.url)
  );

  if (!voe) {
    throw new Error("Hentaila.com no entregó servidor Voe");
  }

  log("Hentaila.com: usando servidor Voe");
  return await fromVoe(voe.url);
}


// ---- Hentaila.tv ------------------------------------------------------------

function decodeTvConfig(html) {
  const re = /<meta\b[^>]*>/gi;
  let m;
  let token = "";

  while ((m = re.exec(html))) {
    const tag = m[0];
    const name = (
      attr(tag, "name") || attr(tag, "property")
    ).toLowerCase();

    if (name === "x-secure-token") {
      token = attr(tag, "content");
      break;
    }
  }

  if (!token) {
    throw new Error("No se encontro x-secure-token");
  }

  let decoded = token.replace(/^sha512-/i, "").trim();

  for (let i = 0; i < 3; i++) {
    decoded = atob(rot13(decoded));
  }

  const config = JSON.parse(decoded);

  if (!config.uri || !config.en || !config.iv) {
    throw new Error("Configuracion incompleta de Hentaila.tv");
  }

  return config;
}

function parseTvPlayer(html, pageUrl) {
  const re = /<iframe\b[^>]*>/gi;
  let m;

  while ((m = re.exec(html))) {
    const src = imageUrl(attr(m[0], "src"), pageUrl);

    if (src && /player\.php/i.test(src)) {
      return src;
    }
  }

  const loose =
    /https?:\/\/[^"'\\\s]+\/player\.php\?data=[^"'\\\s]+/i.exec(html);

  return loose ? loose[0].replace(/&amp;/g, "&") : "";
}

async function resolveHentailaTv(slug, num) {
  const pageUrl =
    HENTAILA_TV +
    "/ver/" +
    slug.replace(/\/+$/, "") +
    "/episodio-" +
    (Number(num) || 1) +
    "/";

  const html = await getText(pageUrl, HENTAILA_TV + "/");
  const playerUrl = parseTvPlayer(html, pageUrl);

  if (!playerUrl) {
    throw new Error("Hentaila.tv no entrego player.php");
  }

  const playerHtml = await getText(playerUrl, pageUrl);
  const config = decodeTvConfig(playerHtml);

  const body = new URLSearchParams();
  body.set("action", "zarat_get_data_player_ajax");
  body.set("a", config.en);
  body.set("b", config.iv);

  let apiUrl = HENTAILA_TV_API;

  try {
    apiUrl = new URL(
      "api.php",
      String(config.uri).replace(/\/?$/, "/")
    ).href;
  } catch {}

  const response = await kino.fetch(apiUrl, {
    method: "POST",
    headers: {
      Origin: HENTAILA_TV,
      Referer: playerUrl,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString(),
    timeoutMs: TIMEOUT
  });

  if (!response.ok) {
    throw new Error(
      "API Hentaila.tv respondio con HTTP " + response.status
    );
  }

  const responseText = await response.text();
  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error("Respuesta invalida de Hentaila.tv");
  }

  if (!data.status || !data.data || !Array.isArray(data.data.sources)) {
    throw new Error("Hentaila.tv no entrego fuentes");
  }

  console.log("HENTAILA_TV_DATA_KEYS", Object.keys(data.data));

  console.log(
    "HENTAILA_TV_SOURCES",
    JSON.stringify(
      data.data.sources.map(item => ({
        ...item,
        src: item && item.src ? "[URL oculta]" : undefined
      })),
      null,
      2
    )
  );

  console.log(
    "HENTAILA_TV_SUBTITLE_FIELDS",
    JSON.stringify(
      Object.fromEntries(
        Object.entries(data.data).filter(([key]) =>
          /sub|caption|track|lang/i.test(key)
        )
      ),
      null,
      2
    )
  );

  const source = data.data.sources.find(item =>
    item && item.src && /^https?:\/\//i.test(item.src)
  );

  if (!source) {
    throw new Error("Hentaila.tv no entrego el video");
  }

  return {
    url: source.src,
    mime: source.type || mimeOf(source.src),
    subtitles: [{
      url: new URL("s/es.vtt", source.src).href,
      lang: "es",
      label: "Español Latam",
      format: "vtt"
    }],
    headers: {
      Referer: HENTAILA_TV + "/",
      Origin: HENTAILA_TV
    }
  };
}

// ---- resolución Kino --------------------------------------------------------

export async function resolve(ref) {
  const parts = String(ref || "").split("~");

  // Servidor alternativo de Hentaila.com.
  if (parts[0] === "p") {
    let dataId;

    try {
      dataId = decodeRef(parts.slice(1).join("~"));
    } catch {
      throw kino.error("not_found", "Servidor alternativo inválido");
    }

    try {
      const entry = parseServerDataId(dataId);
      return await playServer(entry, HENTAILA_COM + "/");
    } catch (e) {
      log("Falló servidor alternativo", e.message);
      throw kino.error("unavailable", e.message);
    }
  }

  // Selección directa de Hentaila.tv.
  if (parts[0] === "t" && parts[1]) {
    try {
      const stream = await resolveHentailaTv(
        parts[1],
        Number(parts[2]) || 1
      );

      return {
        ...stream,
        label: "Hentaila TV"
      };
    } catch (e) {
      log("Hentaila.tv falló", e.message);
      throw kino.error("unavailable", e.message);
    }
  }

  if (parts[0] !== "v" || !parts[1]) {
    throw kino.error("not_found", "Episodio inválido");
  }

  const slug = parts[1];
  const num = Number(parts[2]) || 1;
  let seriesTitle = "";

  if (parts[3]) {
    try {
      seriesTitle = decodeURIComponent(parts.slice(3).join("~"));
    } catch {}
  }

  // Primero intenta Hentaila.com.
  try {
    const stream = await resolveHentailaCom(slug, num, seriesTitle);
    const alternatives = (stream.alternatives || []).slice();

    alternatives.push({
      label: "Hentaila.tv",
      ref: "t~" + slug + "~" + num
    });

    return {
      ...stream,
      label: "Hentaila COM",
      alternatives
    };
  } catch (comError) {
    log("Hentaila.com falló", comError.message);
  }

// Si falla Hentaila.com, intenta Hentaila.tv automáticamente.
try {
  const stream = await resolveHentailaTv(slug, num);

  return {
    ...stream,
    label: "Hentaila TV"
  };
} catch (tvError) {
  log("Hentaila.tv falló: " + tvError.message);

  throw kino.error(
    "unavailable",
    "No se pudo obtener el video desde ninguno de los reproductores"
  );
}


}

// Caché de sesión: las filas del catálogo son ~52 KB y el estado tope es 64 KB
let rowsCache = null;
let genresCache = null;

export async function screen({ state = {}, device = 'phone', size = 'compact' } = {}) {
  const isTv = device === 'tv';
  const cols = isTv ? 6 : { compact: 3, medium: 4, expanded: 5 };
  const section = state.section === 'genres' ? 'genres' : 'catalog';
  const results = Array.isArray(state.results) ? state.results : [];
  const genres  = Array.isArray(state.genres) && state.genres.length > 0 ? state.genres : (genresCache || []);
  const genreItems = Array.isArray(state.genreItems) ? state.genreItems : [];

  // Las filas viven en la caché de sesión: volver al catálogo no vuelve a pedirlas
  let rows = Array.isArray(state.rows) ? state.rows : rowsCache;
  if (!rows && section === 'catalog' && !state.selectedGenre && !state.searched) {
    try { rows = await home(); rowsCache = rows; } catch (e) { log('home en screen fallido', e.message); rows = []; }
  }
  rows = rows || [];

  // Hero: primer ítem del primer rail
  const heroItem = rows.length > 0 && Array.isArray(rows[0].items) && rows[0].items.length > 0
    ? rows[0].items[0] : null;

  // ── body content ────────────────────────────────────────────────────────
  let bodyChildren = [];

  if (results.length > 0) {
    // Resultados de búsqueda activos
    bodyChildren = [
      { type: 'Row', padding: 16, gap: 8, children: [
        { type: 'Text', text: results.length + ' resultados', style: 'h4', flex: 1 },
        { type: 'TextButton', labelText: 'Limpiar', labelTextEn: 'Clear', onPressed: 'clear-search' }
      ]},
      { type: 'titleGrid', columns: cols, items: results, done: true }
    ];
  } else if (state.searched) {
    bodyChildren = [
      { type: 'emptyState',
        title: 'Sin resultados',
        titleEn: 'No results',
        text: 'Prueba con otro término.',
        textEn: 'Try a different term.' },
      { type: 'Row', mainAxisAlignment: 'center', children: [
        { type: 'TextButton', labelText: 'Limpiar búsqueda', labelTextEn: 'Clear search', onPressed: 'clear-search' }
      ]}
    ];
  } else if (section === 'catalog') {
    if (heroItem) {
      bodyChildren.push({
        type: 'heroCard',
        title: heroItem.title,
        image: heroItem.backdrop || heroItem.poster || '',
        text: heroItem.overview || '',
        buttons: [
          { type: 'ElevatedButton', labelText: 'Ver ahora', labelTextEn: 'Watch now',
            onPressed: { event: 'hero-open', arg: JSON.stringify({ id: heroItem.id, ref: heroItem.ref, title: heroItem.title, kind: heroItem.kind || 'series', poster: heroItem.poster || '' }) } }
        ]
      });
    }
    for (const row of rows) {
      bodyChildren.push({ type: 'titleRail', title: row.title, items: row.items, size: 'small' });
    }
    if (rows.length === 0) {
      bodyChildren.push({ type: 'loading' });
    }
  } else if (section === 'genres') {
    if (state.selectedGenre) {
      // Vista interior de un género
      bodyChildren = [
        { type: 'Row', padding: 16, gap: 8, crossAxisAlignment: 'center', children: [
          { type: 'IconButton', icon: 'arrow_back', labelText: 'Volver', labelTextEn: 'Back', onPressed: 'back-genres' },
          { type: 'Text', text: state.selectedGenreTitle || 'Género', style: 'h3', flex: 1 }
        ]},
        ...(genreItems.length
          ? [{ type: 'titleGrid', columns: cols, items: genreItems,
               onEndReached: state.genreHasMore ? { event: 'genre-more' } : undefined,
               loadingMore: state.genreLoadingMore === true,
               done: !state.genreHasMore }]
          : [state.genreLoadingMore
              ? { type: 'loading' }
              : { type: 'emptyState', title: 'Sin títulos', titleEn: 'No titles',
                  text: 'Este género no tiene contenido disponible.',
                  textEn: 'This genre has no content available.' }
            ]
        )
      ];
    } else if (genres.length > 0) {
      // Géneros como lista normal: filas con el nombre, sin portadas
      bodyChildren = [
        { type: 'Text', text: 'Explorar por género', textEn: 'Browse by genre',
          style: 'h4', padding: 16 },
        { type: 'Column', gap: 0, children: genres.map(g => ({
            type: 'ListTile',
            key: 'genre-' + g.slug,
            title: g.title,
            dense: true,
            onTap: { event: 'genre', arg: g.slug }
          })) }
      ];
    } else if (state.genresError && state.genresTried) {
      bodyChildren = [{ type: 'errorState',
        title: 'Error al cargar géneros', titleEn: 'Could not load genres',
        text: 'Toca para reintentar.', textEn: 'Tap to retry.',
        onRetry: 'retry-genres' }];
    } else {
      // La sección ya está pintada: el tick `hydrate-genres` trae la lista
      bodyChildren = [{ type: 'loading' }];
    }
  }

  // Mientras falten los géneros, un tick los pide y la pantalla ya muestra su sección
  const needsGenres = genres.length === 0 && !(state.genresTried === true && state.genresError === true);

  // ── Scaffold con AppBar + NavigationBar ─────────────────────────────────
  return {
    type: 'Scaffold',
    ...(needsGenres ? { every: { ms: 1000, event: 'hydrate-genres' } } : {}),
    appBar: {
      type: 'AppBar',
      dense: true,
      title: 'Veo Hentai',
      actions: [
        { type: 'IconButton', icon: 'search', labelText: 'Buscar', labelTextEn: 'Search',
          onPressed: { event: 'open-search' } }
      ]
    },
    bottomNavigationBar: {
      type: 'NavigationBar',
      value: section,
      onChanged: 'section',
      items: [
        { key: 'catalog', icon: 'home',  label: 'Catálogo', labelEn: 'Catalog' },
        { key: 'genres',  icon: 'list',  label: 'Géneros',  labelEn: 'Genres'  }
      ]
    },
    body: {
      type: 'SingleChildScrollView',
      children: [
        ...(state.searchOpen ? [{
          type: 'Column',
          padding: 16,
          gap: 0,
          children: [{
            type: 'TextField',
            key: 'query',
            value: state.query || '',
            hintText: 'Buscar títulos...',
            hintTextEn: 'Search titles...',
            onChange: 'typed',
            onSubmit: 'search',
            trailingIcon: 'search',
            trailingLabel: 'Buscar',
            trailingLabelEn: 'Search',
            onTrailingTap: 'search'
          }]
        }] : []),
        { type: 'Column', gap: 16, children: bodyChildren }
      ]
    }
  };
}

export async function screenEvent({ name, value, arg, state = {} }) {
  if (name === 'open-search') {
    return { state: { ...state, searchOpen: true }, focus: 'query' };
  }

  if (name === 'section') {
    // Cambia de sección al instante: si faltan datos, la pantalla pinta su spinner
    const base = { ...state, section: value, results: [], searched: false, searchOpen: false,
                   selectedGenre: null, genreItems: [] };
    if (value === 'genres') {
      const cached = Array.isArray(state.genres) && state.genres.length > 0 ? state.genres : genresCache;
      if (cached && cached.length > 0) {
        return { state: { ...base, genres: cached, genresTried: true, genresLoading: false, genresError: false } };
      }
      return { state: { ...base, genres: [], genresLoading: true } };
    }
    return { state: base };
  }

  // Tick del screen (`every`): trae los géneros sin retener el cambio de sección
  if (name === 'hydrate-genres') {
    if (Array.isArray(state.genres) && state.genres.length > 0) return null;
    try {
      const genres = genresCache && genresCache.length > 0 ? genresCache : await getGenres();
      genresCache = genres;
      return { state: { ...state, genres, genresLoading: false, genresTried: true, genresError: false } };
    } catch (e) {
      log('Carga de géneros fallida', e.message);
      return { state: { ...state, genresLoading: false, genresTried: true, genresError: true } };
    }
  }

  if (name === 'retry-genres') {
    // Vuelve al spinner y deja que el tick reintente
    return { state: { ...state, genres: [], genresLoading: true, genresTried: false, genresError: false } };
  }

  if (name === 'genre') {
    const slug = String(arg || '');
    try {
      const result = await getGenrePage(slug, 1);
      const selected = (state.genres || []).find(g => g.slug === slug);
      return {
        state: {
          ...state,
          section: 'genres',
          selectedGenre: slug,
          selectedGenreTitle: selected?.title || slug,
          genreItems: result.items,
          genrePage: 1,
          genreHasMore: result.totalPages > 1,
          genreLoadingMore: false
        }
      };
    } catch (e) {
      log('Carga de género fallida', e.message);
      return { toast: 'No se pudo cargar ese género.' };
    }
  }

  if (name === 'genre-more') {
    const slug  = String(state.selectedGenre || '');
    const page  = Number(state.genrePage || 1) + 1;
    try {
      const result   = await getGenrePage(slug, page);
      const existing = Array.isArray(state.genreItems) ? state.genreItems : [];
      const seen     = new Set(existing.map(i => i.id || i.ref || i.title));
      const added    = result.items.filter(i => {
        const k = i.id || i.ref || i.title;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return {
        state: { ...state, genreItems: [...existing, ...added], genrePage: page,
                 genreHasMore: page < result.totalPages, genreLoadingMore: false }
      };
    } catch (e) {
      log('Carga de más títulos fallida', e.message);
      return { state: { ...state, genreLoadingMore: false }, toast: 'No se pudieron cargar más títulos.' };
    }
  }

  if (name === 'back-genres') {
    return { state: { ...state, selectedGenre: null, genreItems: [] } };
  }

  if (name === 'typed') {
    return { state: { ...state, query: value || '' } };
  }

  if (name === 'search') {
    const query = String(state.query || '').trim();
    if (!query) return { toast: 'Escribe un título para buscar.' };
    try {
      const found = await search({ q: query });
      return {
        state: { ...state, searchOpen: false, query, results: Array.isArray(found) ? found : [], searched: true }
      };
    } catch {
      return {
        state: { ...state, searchOpen: false, results: [], searched: true },
        toast: 'No se pudo completar la búsqueda.'
      };
    }
  }

  // Fix #9: clear-search limpia estado y vuelve a catálogo
  if (name === 'clear-search') {
    return { state: { ...state, results: [], searched: false, query: '', searchOpen: false, section: 'catalog' } };
  }

  // "Ver ahora" del heroCard: abrir la ficha del título
  if (name === 'hero-open') {
    try {
      const item = JSON.parse(arg || '{}');
      if (item.ref && item.kind) {
        const go = { ref: item.ref, kind: item.kind };
        if (item.id)    go.id = item.id;
        if (item.title) go.title = item.title;
        return { go: { title: go } };
      }
      log('hero-open sin ref o kind', String(arg || '').slice(0, 80));
    } catch (e) {
      log('hero-open arg inválido', e.message);
    }
    return null;
  }

  return null;
}
