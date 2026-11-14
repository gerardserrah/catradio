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
      graellaSlug: "3catinfo-radio",
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

  // Busca dins d'un objecte JSON la portada quadrada oficial del programa (prioritzant IMG_PODCAST i 1400x1400, i descartant IMG_LOGO / IMATGE_169 / IMG_POSTER)
  function findSquareImageInObject(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;

    if (Array.isArray(obj)) {
      if (obj.length > 0 && obj.some((it) => it && typeof it === "object" && (it.rel_name || it.mida))) {
        const validItems = obj
          .map((it) => ({
            url: normalizeImg(it?.url || it?.src || it?.text || it?.imatge),
            mida: String(it?.mida || it?.relacio || it?.ratio || "").toUpperCase(),
            rel: String(it?.rel_name || "").toUpperCase()
          }))
          .filter((it) => it.url && !/LOGO|169|16_9|16X9|POSTER|CARTELL|VERTICAL/.test(it.rel));

        const podcastCover = validItems.find((it) => it.rel === "IMG_PODCAST");
        if (podcastCover) return podcastCover.url;

        const sq1400 = validItems.find((it) => it.mida === "1400X1400");
        if (sq1400) return sq1400.url;

        const sq300 = validItems.find((it) => it.mida === "300X300" || it.mida === "200X200" || it.mida === "1:1" || it.mida === "1X1");
        if (sq300) return sq300.url;

        const sq144 = validItems.find((it) => it.mida === "144X144");
        if (sq144) return sq144.url;
      }

      for (const item of obj) {
        const found = findSquareImageInObject(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    // Camps explícits de portada quadrada de l'API de 3Cat
    const directSquareKeys = [
      "imatge_quadrada",
      "imatgeQuadrada",
      "imatge_1x1",
      "imatge1x1",
      "quadrada",
      "square",
      "cover"
    ];
    for (const k of directSquareKeys) {
      if (typeof obj[k] === "string") {
        const u = normalizeImg(obj[k]);
        if (u) return u;
      } else if (obj[k] && typeof obj[k] === "object") {
        const u = normalizeImg(obj[k].url || obj[k].src || obj[k].text);
        if (u) return u;
      }
    }

    // Comprovació per dimensions (amplada === alcada) o proporció ("1:1" / "1x1")
    const relName = String(obj.rel_name || "").toUpperCase();
    if (/LOGO|169|16_9|16X9|POSTER|CARTELL|VERTICAL/.test(relName)) {
      return null;
    }

    const w = Number(obj.amplada || obj.width || obj.w || 0);
    const h = Number(obj.alcada || obj.height || obj.h || 0);
    const ratio = String(obj.relacio || obj.ratio || obj.aspect || obj.mida || "").toLowerCase();
    const rawUrl = obj.url || obj.src || obj.text || obj.imatge;

    if (typeof rawUrl === "string") {
      const normalized = normalizeImg(rawUrl);
      if (normalized) {
        if (
          relName === "IMG_PODCAST" ||
          (w > 0 && h > 0 && Math.abs(w - h) <= 4) ||
          ratio === "1:1" ||
          ratio === "1x1" ||
          ratio === "1400x1400" ||
          ratio === "300x300" ||
          ratio === "200x200" ||
          ratio.includes("quadra")
        ) {
          return normalized;
        }
      }
    }

    for (const k of Object.keys(obj)) {
      if (/16x9|16_9|vertical|poster|cartell|logo/i.test(k)) continue;
      const found = findSquareImageInObject(obj[k], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function extractMultimediaUrl(textChunk, objContext = null) {
    if (objContext) {
      const exactSquare = findSquareImageInObject(objContext);
      if (exactSquare) return exactSquare;
    }

    if (!textChunk) return null;
    const matches = textChunk.match(/(?:https?:\/\/img\.3cat\.cat)?\/multimedia\/[^"'\s\\<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\<>]*)?/gi);
    if (!matches || matches.length === 0) return null;

    const valid = [...new Set(matches.map(normalizeImg).filter(Boolean))];
    if (valid.length === 0) return null;

    // 1. Etiqueta quadrada explícita
    const square = valid.find((u) => /1x1|1_1|quadra|square|cover|200x200|300x300|400x400|500x500|512x512|600x600|800x800/i.test(u));
    if (square) return square;

    // 2. Descartem tant les panoràmiques (16:9) com les verticals (poster / 2:3 / 9:16)
    const squareCandidates = valid.filter(
      (u) => !/16x9|16_9|panoramic|horitzontal|wide|1920x1080|1280x720|vertical|portrait|poster|cartell|2x3|2_3|3x4|3_4|9x16|9_16|1080x1920|720x1280/i.test(u)
    );
    if (squareCandidates.length > 0) {
      return squareCandidates[0];
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

  function getMadridOffsetMinutes(year, month, day, hour) {
    // Últim diumenge de març i últim diumenge d'octubre (horari d'estiu CEST UTC+2 vs CET UTC+1)
    const lastSundayMarch = 31 - new Date(Date.UTC(year, 2, 31)).getUTCDay();
    const lastSundayOct = 31 - new Date(Date.UTC(year, 9, 31)).getUTCDay();
    const afterStart = month > 3 || (month === 3 && (day > lastSundayMarch || (day === lastSundayMarch && hour >= 2)));
    const beforeEnd = month < 10 || (month === 10 && (day < lastSundayOct || (day === lastSundayOct && hour < 3)));
    return afterStart && beforeEnd ? 120 : 60;
  }

  function parseTimestampMs(raw) {
    if (!raw) return null;
    if (typeof raw === "number") return raw > 1e11 ? raw : raw * 1000;
    if (typeof raw === "string") {
      const s = raw.trim();
      // Format de 3Cat a /catradio/programacio/: "DD/MM/YYYY HH:mm:ss"
      const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
      if (dmy) {
        const day = Number(dmy[1]);
        const month = Number(dmy[2]);
        const year = Number(dmy[3]);
        const hour = Number(dmy[4]);
        const min = Number(dmy[5]);
        const sec = Number(dmy[6] || 0);
        const offsetMin = getMadridOffsetMinutes(year, month, day, hour);
        return Date.UTC(year, month - 1, day, hour, min, sec) - offsetMin * 60 * 1000;
      }
      const parsed = Date.parse(s);
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
      const prog = node.ara_fem || node.ara || node.directe || node.programa_actual || node;
      const title =
        prog.titol_programa ||
        prog.programa ||
        (prog !== node ? prog.titol : null) ||
        node.titol_programa;

      const host =
        prog.presentador ||
        node.presentador ||
        prog.subtitol_programa ||
        prog.subtitol ||
        "";

      const nextObj = node.despres_fem || node.seguent || prog.seguent || node.despres || prog.despres;
      let nextText = "";
      let nextStartMs = null;
      if (typeof nextObj === "string" && nextObj.trim()) {
        nextText = nextObj.includes("A continuació") ? nextObj.trim() : `A continuació: ${nextObj.trim()}`;
      } else if (nextObj && typeof nextObj === "object") {
        const nextTitle = nextObj.titol_programa || nextObj.titol || nextObj.programa;
        nextStartMs = parseTimestampMs(nextObj.start_time || nextObj.data_inici || nextObj.hora_inici_iso);
        let nextHour = nextObj.hora || nextObj.hora_inici || "";
        if (!nextHour && nextStartMs) {
          nextHour = new Date(nextStartMs).toLocaleTimeString("ca-ES", {
            timeZone: "Europe/Madrid",
            hour: "2-digit",
            minute: "2-digit"
          });
        }
        if (nextTitle) {
          nextText = `A continuació: ${nextHour} ${nextTitle}`.replace(/\s+/g, " ").trim();
        }
      }

      const startMs = parseTimestampMs(prog.start_time || prog.data_inici || prog.hora_inici_iso);
      const endMs = parseTimestampMs(prog.end_time || prog.data_fi || prog.hora_fi_iso) || nextStartMs;

      const artwork =
        extractMultimediaUrl(JSON.stringify(prog), prog) ||
        extractMultimediaUrl(JSON.stringify(node), node);

      if (title && typeof title === "string" && title.length > 1 && !/^directe:/i.test(title)) {
        const cleanTitle = decodeHtmlEntities(title);
        const cleanHost = (typeof host === "string" && host.trim()) ? decodeHtmlEntities(host) : lookupKnownHost(cleanTitle);
        result[chKey] = {
          title: cleanTitle,
          host: cleanHost,
          artwork: artwork || null,
          next: nextText,
          startMs: startMs || null,
          endMs: endMs || null,
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

      // La miniatura quadrada de la targeta va just abans del text "Directe: ..." / "Emissora: ..."
      const beforeMarkerHtml = html.slice(Math.max(0, markerIdx - 1600), markerIdx);
      const fullCardHtml = html.slice(Math.max(0, markerIdx - 1600), Math.min(html.length, markerIdx + 2400));

      const artwork = extractMultimediaUrl(beforeMarkerHtml) || extractMultimediaUrl(fullCardHtml);
      const nextMatch = fullCardHtml.match(/A continuaci[oó]:\s*(?:<[^>]+>\s*)*([^<]{3,120})/i);
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

  const KNOWN_PROGRAM_HOSTS = {
    "la finestra indiscreta": "Toni de la Torre",
    "l'altre barri": "Blai Marsé",
    "les dones i els dies": "Montse Virgili",
    "el matí de catalunya ràdio": "Ricard Ustrell",
    "els matiners": "Xavi Canalias",
    "la renaixença": "Peyu",
    "la solució": "Elisenda Carod",
    "catalunya migdia": "Òscar Fernández",
    "la tarda de catalunya ràdio": "Francesc Garriga",
    "que no surti d'aquí": "Roger Carandell, Juliana Canet i Marta Montaner",
    "tot costa": "Jordi Costa i Sònia Gelmà",
    "catalunya nit": "Manel Alías",
    "catalunya al dia": "Estel Batet",
    "el suplement": "Roger Escapa",
    "crims": "Carles Porta",
    "el búnquer": "Peyu, Jair Domínguez i Neus Rossell",
    "la nit dels ignorants 3.0": "Xavier Solà",
    "solidaris": "Mercè Folch",
    "un restaurant caníbal a berlín": "Paula Molés",
    "revolució 4.0": "Xantal Llavina",
    "l'ofici de viure": "Gaspar Hernández",
    "en guàrdia!": "Enric Calpena",
    "ciutat maragda": "David Guzmán",
    "adolescents xl": "Roger Carandell, Juliana Canet i Marta Montaner",
    "els experts": "Albert Miralles i Roger Seró",
    "loft": "Xènia Casado i Berta Aroca",
    "casa babylon": "Jordi Turtós",
    "tots els matins del món": "Ester Plana i Joan Vives",
    "assaig general": "Albert Torrens i Marta Lanau",
    "els homes clàssics": "Albert Galceran i Pedro Pardo"
  };

  function lookupKnownHost(title) {
    if (!title) return "";
    const norm = decodeHtmlEntities(title).toLowerCase().trim();
    if (KNOWN_PROGRAM_HOSTS[norm]) return KNOWN_PROGRAM_HOSTS[norm];
    for (const [k, v] of Object.entries(KNOWN_PROGRAM_HOSTS)) {
      if (norm.includes(k)) return v;
    }
    return "";
  }

  function extractHostFromScheduleNode(node, title) {
    const direct = node.presentador || node.subtitol_programa || node.subtitol || "";
    if (typeof direct === "string" && direct.trim()) return decodeHtmlEntities(direct);
    const desc = typeof node.descripcio === "string" ? decodeHtmlEntities(node.descripcio) : "";
    if (desc) {
      const m = desc.match(/(?:Realitz(?:a|en)|Dirigit(?:\s+i\s+presentat)?\s+per|Presenta(?:t\s+per)?)\s*:?\s*([A-ZÀ-Ý][^.;"<>]{2,60})/i);
      if (m && m[1]) return m[1].trim();
    }
    return lookupKnownHost(title);
  }

  function collectScheduleItems(node, items) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((el) => collectScheduleItems(el, items));
      return;
    }

    const startRaw = node.data_emissio || node.data_inici || node.hora_inici_iso || node.start_time || node.start || node.inici;
    const endRaw = node.data_emissio_fi || node.data_fi || node.hora_fi_iso || node.end_time || node.end || node.fi;
    const startMs = parseTimestampMs(startRaw);
    const endMs = parseTimestampMs(endRaw);
    let title = node.titol_programa || node.titol;
    if (!title && Array.isArray(node.programa) && node.programa[0]) {
      title = node.programa[0].desc || node.programa[0].titol;
    } else if (!title && typeof node.programa === "string") {
      title = node.programa;
    }

    if (startMs && title && typeof title === "string" && title.length > 1) {
      const cleanTitle = decodeHtmlEntities(title);
      const host = extractHostFromScheduleNode(node, cleanTitle);
      const artwork = extractMultimediaUrl(JSON.stringify(node), node);
      items.push({
        startMs,
        endMs: endMs || null,
        title: cleanTitle,
        host,
        artwork: artwork || null
      });
    }

    for (const k of Object.keys(node)) {
      collectScheduleItems(node[k], items);
    }
  }

  async function fetchChannelSchedule(slug) {
    const rawItems = [];
    const urls = [
      `https://www.3cat.cat/catradio/programacio/${slug}/`,
      `https://www.3cat.cat/3cat/programacio/${slug}/`
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) continue;
        const html = await r.text();
        const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (m && m[1]) {
          collectScheduleItems(JSON.parse(m[1]), rawItems);
          if (rawItems.length > 0) break;
        }
      } catch (e) {}
    }

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
