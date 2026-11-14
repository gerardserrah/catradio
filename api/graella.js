export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=25, stale-while-revalidate=50");

  const isDebug = req.query && req.query.debug === "1";

  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.8",
    "Accept-Language": "ca,es;q=0.9,en;q=0.8",
    "Referer": "https://www.3cat.cat/"
  };

  const CHANNEL_MATCHERS = [
    {
      key: "catradio",
      graellaSlug: "catalunya-radio",
      codes: ["cr", "catalunya-radio", "catalunya ràdio"],
      htmlMarkers: ["Directe: Catalunya Ràdio", "Emissora: Catalunya Ràdio"]
    },
    {
      key: "digital",
      graellaSlug: "catalunya-radio",
      codes: ["ocr1", "catalunya-radio-digital", "exclusiu digital"],
      htmlMarkers: ["Emissora: exclusiu digital", "Directe: exclusiu digital"]
    },
    {
      key: "catinfo",
      graellaSlug: "catinfo",
      codes: ["ci", "3catinfo", "catalunya informació", "catalunya-informacio"],
      htmlMarkers: ["Emissora: 3CatInfo", "Directe: 3CatInfo (ràdio)"]
    },
    {
      key: "icat",
      graellaSlug: "icat",
      codes: ["ic", "icat"],
      htmlMarkers: ["Emissora: iCat", "Directe: iCat"]
    },
    {
      key: "catmusica",
      graellaSlug: "catalunya-musica",
      codes: ["cm", "catmusica", "catalunya música", "catalunya-musica"],
      htmlMarkers: ["Emissora: Catalunya Música", "Directe: Catalunya Música"]
    }
  ];

  function normalizeImg(raw) {
    if (!raw || typeof raw !== "string") return null;
    let url = raw.trim().replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("/multimedia/")) url = "https://img.3cat.cat" + url;
    else if (url.startsWith("/")) url = "https://www.3cat.cat" + url;
    if (!/^https?:\/\//i.test(url)) return null;
    if (/logo|icona|avatar|sprite|\.svg/i.test(url)) return null;
    return url;
  }

  function decodeHtmlEntities(str) {
    if (!str) return "";
    return str
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractMultimediaUrl(textChunk) {
    if (!textChunk) return null;
    const matches = textChunk.match(/(?:https?:\/\/img\.3cat\.cat)?\/multimedia\/[^"'\s\\<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\<>]*)?/gi);
    if (!matches || matches.length === 0) return null;

    // Eliminem duplicats i normalitzem
    const valid = [...new Set(matches.map(normalizeImg).filter(Boolean))];
    if (valid.length === 0) return null;

    // 1. Busquem explícitament la versió quadrada (1:1)
    const square = valid.find((u) => /1x1|1_1|quadra|square|cover|200x200|300x300|400x400|500x500|512x512|600x600|800x800/i.test(u));
    if (square) return square;

    // 2. Si no hi ha etiqueta quadrada explícita, descartem les que sabem segur que són 16:9
    const non16x9 = valid.filter((u) => !/16x9|16_9|panoramic|horitzontal|wide|1920x1080|1280x720/i.test(u));
    if (non16x9.length > 0) {
      // A la card de 3Cat, l'última imatge sense 16:9 acostuma a ser la miniatura quadrada del programa
      return non16x9[non16x9.length - 1];
    }

    return valid[0];
  }

  function detectChannelKey(obj) {
    if (!obj || typeof obj !== "object") return null;
    const candidates = [
      obj.codi_canal, obj.codi, obj.canal, obj.emissora, obj.slug, obj.id,
      obj.nom_canal, obj.titol_canal,
      obj.canal?.codi, obj.canal?.id, obj.canal?.slug, obj.canal?.nom,
      obj.emissora?.codi, obj.emissora?.id, obj.emissora?.nom
    ]
      .filter((v) => typeof v === "string" || typeof v === "number")
      .map((v) => String(v).toLowerCase().trim());

    for (const m of CHANNEL_MATCHERS) {
      if (candidates.some((c) => m.codes.includes(c))) {
        return m.key;
      }
    }
    return null;
  }

  function parseTimestampMs(raw) {
    if (!raw) return null;
    if (typeof raw === "number") return raw > 1e11 ? raw : raw * 1000;
    if (typeof raw === "string") {
      const parsed = Date.parse(raw);
      if (!isNaN(parsed)) return parsed;
    }
    return null;
  }

  function extractFromNextData(node, result) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item) => extractFromNextData(item, result));
      return;
    }

    const chKey = detectChannelKey(node);
    if (chKey && !result[chKey]) {
      const prog = node.ara || node.directe || node.programa_actual || node;
      const title =
        prog.titol_programa ||
        prog.programa ||
        (prog !== node ? prog.titol : null) ||
        node.titol_programa;

      const host =
        prog.subtitol_programa ||
        prog.subtitol ||
        prog.presentador ||
        prog.descripcio_curta ||
        "";

      const nextObj = node.seguent || prog.seguent || node.despres || prog.despres;
      let nextText = "";
      if (typeof nextObj === "string" && nextObj.trim()) {
        nextText = nextObj.includes("A continuació") ? nextObj.trim() : `A continuació: ${nextObj.trim()}`;
      } else if (nextObj && typeof nextObj === "object") {
        const nextTitle = nextObj.titol || nextObj.titol_programa || nextObj.programa;
        const nextHour = nextObj.hora || nextObj.hora_inici || "";
        if (nextTitle) {
          nextText = `A continuació: ${nextHour} ${nextTitle}`.replace(/\s+/g, " ").trim();
        }
      }

      const artwork = extractMultimediaUrl(JSON.stringify(prog)) || extractMultimediaUrl(JSON.stringify(node));

      if (title && typeof title === "string" && title.length > 1 && !/^directe:/i.test(title)) {
        result[chKey] = {
          title: title.trim(),
          host: typeof host === "string" ? host.trim() : "",
          artwork: artwork || null,
          next: nextText,
          schedule: []
        };
      }
    }

    for (const k of Object.keys(node)) {
      extractFromNextData(node[k], result);
    }
  }

  function extractFromRenderedHtml(html, result) {
    for (const m of CHANNEL_MATCHERS) {
      if (result[m.key] && result[m.key].title && result[m.key].artwork) continue;

      let markerIdx = -1;
      for (const marker of m.htmlMarkers) {
        markerIdx = html.indexOf(marker);
        if (markerIdx !== -1) break;
      }
      if (markerIdx === -1) continue;

      const sliceStart = Math.max(0, markerIdx - 1800);
      const sliceEnd = Math.min(html.length, markerIdx + 2800);
      const cardHtml = html.slice(sliceStart, sliceEnd);

      const artwork = extractMultimediaUrl(cardHtml);
      const nextMatch = cardHtml.match(/A continuaci[oó]:\s*(?:<[^>]+>\s*)*([^<]{3,120})/i);
      const nextText = nextMatch ? `A continuació: ${decodeHtmlEntities(nextMatch[1])}` : "";

      const afterMarker = html.slice(markerIdx, Math.min(html.length, markerIdx + 1800));
      const textTokens = afterMarker
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .split(/<\/(?:h1|h2|h3|h4|p|span|div|a)>/i)
        .map(decodeHtmlEntities)
        .filter((t) =>
          t.length >= 2 &&
          !/^(Directe|Emissora:|Logo |Icona |Àudio|reproduir|A continuació|icona a continuació)/i.test(t)
        );

      const title = textTokens[0] || "";
      const host = textTokens[1] && !/^A continuaci/i.test(textTokens[1]) ? textTokens[1] : "";

      if (title) {
        result[m.key] = {
          title: result[m.key]?.title || title,
          host: result[m.key]?.host || host,
          artwork: result[m.key]?.artwork || artwork || null,
          next: result[m.key]?.next || nextText,
          schedule: result[m.key]?.schedule || []
        };
      }
    }
  }

  // Recull els blocs horaris de la graella web de 3Cat per saber què sonava minuts/hores enrere
  function collectScheduleItems(node, items) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((el) => collectScheduleItems(el, items));
      return;
    }

    const startRaw = node.data_inici || node.hora_inici_iso || node.start || node.inici;
    const endRaw = node.data_fi || node.hora_fi_iso || node.end || node.fi;
    const startMs = parseTimestampMs(startRaw);
    const endMs = parseTimestampMs(endRaw);
    const title = node.titol_programa || node.titol || node.programa;

    if (startMs && title && typeof title === "string" && title.length > 1) {
      const host = node.subtitol_programa || node.subtitol || node.presentador || "";
      const artwork = extractMultimediaUrl(JSON.stringify(node));
      items.push({
        startMs,
        endMs: endMs || null,
        title: title.trim(),
        host: typeof host === "string" ? host.trim() : "",
        artwork: artwork || null
      });
    }

    for (const k of Object.keys(node)) {
      collectScheduleItems(node[k], items);
    }
  }

  async function fetchChannelSchedule(slug) {
    const rawItems = [];
    try {
      const r = await fetch(`https://www.3cat.cat/3cat/programacio/${slug}/`, { headers });
      if (!r.ok) return [];
      const html = await r.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (m && m[1]) {
        collectScheduleItems(JSON.parse(m[1]), rawItems);
      }
    } catch (e) {}

    // Ordenem cronològicament i dedupliquem per hora d'inici
    rawItems.sort((a, b) => a.startMs - b.startMs);
    const deduped = [];
    for (const item of rawItems) {
      if (!deduped.some((d) => Math.abs(d.startMs - item.startMs) < 60000 && d.title === item.title)) {
        deduped.push(item);
      }
    }
    for (let i = 0; i < deduped.length; i++) {
      if (!deduped[i].endMs && deduped[i + 1]) {
        deduped[i].endMs = deduped[i + 1].startMs;
      }
    }
    return deduped;
  }

  const channels = {};
  const debugLog = [];

  try {
    const response = await fetch("https://www.3cat.cat/3cat/directes/catalunya-radio/", { headers });
    debugLog.push({ url: "https://www.3cat.cat/3cat/directes/catalunya-radio/", status: response.status });

    if (response.ok) {
      const html = await response.text();
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (nextDataMatch && nextDataMatch[1]) {
        try {
          extractFromNextData(JSON.parse(nextDataMatch[1]), channels);
        } catch (err) {
          debugLog.push({ nextDataError: err.message });
        }
      }
      extractFromRenderedHtml(html, channels);
    }

    // Carreguem en paral·lel la graella horària del dia per poder mostrar programes anteriors en tirar enrere
    const uniqueSlugs = [...new Set(CHANNEL_MATCHERS.map((m) => m.graellaSlug))];
    const schedulesBySlug = {};
    await Promise.all(
      uniqueSlugs.map(async (slug) => {
        schedulesBySlug[slug] = await fetchChannelSchedule(slug);
      })
    );

    for (const m of CHANNEL_MATCHERS) {
      if (channels[m.key]) {
        channels[m.key].schedule = schedulesBySlug[m.graellaSlug] || [];
      }
    }
  } catch (err) {
    debugLog.push({ fetchError: err.message });
  }

  const payload = {
    channels,
    updatedAt: new Date().toISOString()
  };

  if (isDebug) payload.debug = debugLog;
  return res.status(200).json(payload);
}
