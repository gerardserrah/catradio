export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=25, stale-while-revalidate=50");

  const isDebug = req.query && req.query.debug === "1";

  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ca,es;q=0.9,en;q=0.8",
    "Referer": "https://www.3cat.cat/"
  };

  const CHANNEL_MATCHERS = [
    {
      key: "catradio",
      codes: ["cr", "catalunya-radio", "catalunya ràdio"],
      htmlMarkers: ["Directe: Catalunya Ràdio", "Emissora: Catalunya Ràdio"]
    },
    {
      key: "digital",
      codes: ["ocr1", "catalunya-radio-digital", "exclusiu digital"],
      htmlMarkers: ["Emissora: exclusiu digital", "Directe: exclusiu digital"]
    },
    {
      key: "catinfo",
      codes: ["ci", "3catinfo", "catalunya informació", "catalunya-informacio"],
      htmlMarkers: ["Emissora: 3CatInfo", "Directe: 3CatInfo (ràdio)"]
    },
    {
      key: "icat",
      codes: ["ic", "icat"],
      htmlMarkers: ["Emissora: iCat", "Directe: iCat"]
    },
    {
      key: "catmusica",
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
    const valid = matches.map(normalizeImg).filter(Boolean);
    if (valid.length === 0) return null;
    return valid.find((u) => /1x1|quadrat|cover|512|600|800/i.test(u)) || valid[0];
  }

  function detectChannelKey(obj) {
    if (!obj || typeof obj !== "object") return null;
    const candidates = [
      obj.codi_canal,
      obj.codi,
      obj.canal,
      obj.emissora,
      obj.slug,
      obj.id,
      obj.nom_canal,
      obj.titol_canal,
      obj.canal?.codi,
      obj.canal?.id,
      obj.canal?.slug,
      obj.canal?.nom,
      obj.emissora?.codi,
      obj.emissora?.id,
      obj.emissora?.nom
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

  // Motor 1: Exploració recursiva del JSON __NEXT_DATA__ de 3Cat
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
          source: "next_data"
        };
      }
    }

    for (const k of Object.keys(node)) {
      extractFromNextData(node[k], result);
    }
  }

  // Motor 2: Extracció directa de l'HTML renderitzat (SSR) de la pàgina de directes
  function extractFromRenderedHtml(html, result) {
    for (const m of CHANNEL_MATCHERS) {
      if (result[m.key] && result[m.key].title && result[m.key].artwork) continue;

      let markerIdx = -1;
      for (const marker of m.htmlMarkers) {
        markerIdx = html.indexOf(marker);
        if (markerIdx !== -1) break;
      }
      if (markerIdx === -1) continue;

      // Agafem una finestra al voltant de la targeta d'aquesta emissora (abans i després del marcador)
      const sliceStart = Math.max(0, markerIdx - 1800);
      const sliceEnd = Math.min(html.length, markerIdx + 2800);
      const cardHtml = html.slice(sliceStart, sliceEnd);

      const artwork = extractMultimediaUrl(cardHtml);

      // Busquem el text "A continuació: HH:MM Nom del programa"
      const nextMatch = cardHtml.match(/A continuaci[oó]:\s*(?:<[^>]+>\s*)*([^<]{3,120})/i);
      const nextText = nextMatch ? `A continuació: ${decodeHtmlEntities(nextMatch[1])}` : "";

      // Extraiem els blocs de text nets dins la targeta després del marcador principal
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
          source: "ssr_html"
        };
      }
    }
  }

  const channels = {};
  const debugLog = [];

  try {
    const response = await fetch("https://www.3cat.cat/3cat/directes/catalunya-radio/", { headers });
    debugLog.push({ url: "https://www.3cat.cat/3cat/directes/catalunya-radio/", status: response.status });

    if (response.ok) {
      const html = await response.text();

      // 1. Intentem extreure del JSON __NEXT_DATA__
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (nextDataMatch && nextDataMatch[1]) {
        try {
          const parsedNext = JSON.parse(nextDataMatch[1]);
          extractFromNextData(parsedNext, channels);
        } catch (err) {
          debugLog.push({ nextDataError: err.message });
        }
      }

      // 2. Completem qualsevol emissora o miniatura que falti des de l'HTML renderitzat
      extractFromRenderedHtml(html, channels);
    }
  } catch (err) {
    debugLog.push({ fetchError: err.message });
  }

  const payload = {
    channels,
    updatedAt: new Date().toISOString()
  };

  if (isDebug) {
    payload.debug = debugLog;
  }

  return res.status(200).json(payload);
}
