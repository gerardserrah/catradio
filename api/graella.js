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
    if (url.includes("statics.ccma.cat")) url = url.replace("statics.ccma.cat", "statics.3cat.cat");
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

  const NON_SQUARE_META_RE =
    /169|16_9|16X9|1920X1080|1280X720|POSTER|CARTELL|VERTICAL|288X422|240X350|467X684|467684|320X466|1014X570|670X378|670X250|670X420|326X184|312X180|400X80|768X92|1980X200|141X51|128X96|176X100|133X75|IPTV|BRAVIA|4COL|8COL|12COL|CAP_PHABLET|CAP_DESKTOP/i;

  function isLogoRelOrTitle(rel, titol) {
    if (/LOGO/i.test(String(rel || ""))) return true;
    const t = String(titol || "");
    if (/^(?:img_)?logo\b/i.test(t) && !/podcast|1400|1500|300x300|314x314|200x200/i.test(t)) return true;
    return false;
  }

  function isDimensionNonSquare(midaStr) {
    const m = String(midaStr || "").match(/(\d{2,4})\s*[xX]\s*(\d{2,4})/);
    if (!m) return false;
    const w = Number(m[1]);
    const h = Number(m[2]);
    return w > 0 && h > 0 && Math.abs(w - h) > 4;
  }

  function isDimensionSquare(midaStr) {
    const m = String(midaStr || "").match(/^(\d{2,4})\s*[xX]\s*(\d{2,4})$/);
    if (!m) return false;
    const w = Number(m[1]);
    const h = Number(m[2]);
    return w > 0 && h > 0 && Math.abs(w - h) <= 4;
  }

  function collectNonSquareUrlsFromObject(obj, rejected = new Set(), depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 7) return rejected;
    if (Array.isArray(obj)) {
      for (const item of obj) collectNonSquareUrlsFromObject(item, rejected, depth + 1);
      return rejected;
    }

    const rawUrl = obj.url || obj.src || obj.text || obj.imatge;
    if (typeof rawUrl === "string") {
      const u = normalizeImg(rawUrl);
      const meta = `${obj.rel_name || ""} ${obj.mida || ""} ${obj.titol || ""} ${obj.alt || ""}`;
      if (
        u &&
        (isLogoRelOrTitle(obj.rel_name, obj.titol) ||
          NON_SQUARE_META_RE.test(meta) ||
          isDimensionNonSquare(obj.mida) ||
          isDimensionNonSquare(obj.titol))
      ) {
        rejected.add(u);
      }
    }

    for (const k of Object.keys(obj)) {
      collectNonSquareUrlsFromObject(obj[k], rejected, depth + 1);
    }
    return rejected;
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
            rel: String(it?.rel_name || "").toUpperCase(),
            titol: String(it?.titol || it?.alt || "")
          }))
          .filter(
            (it) =>
              it.url &&
              !isLogoRelOrTitle(it.rel, it.titol) &&
              !NON_SQUARE_META_RE.test(`${it.rel} ${it.mida} ${it.titol}`) &&
              !isDimensionNonSquare(it.mida) &&
              !isDimensionNonSquare(it.titol)
          );

        const podcastCover = validItems.find((it) => it.rel === "IMG_PODCAST");
        if (podcastCover) return podcastCover.url;

        const sq1400 = validItems.find((it) => it.mida === "1400X1400" || it.mida === "1500X1500");
        if (sq1400) return sq1400.url;

        const sq300 = validItems.find(
          (it) =>
            it.mida === "400X400" ||
            it.mida === "314X314" ||
            it.mida === "300X300" ||
            it.mida === "200X200" ||
            it.mida === "1:1" ||
            it.mida === "1X1" ||
            isDimensionSquare(it.mida)
        );
        if (sq300) return sq300.url;

        const sq144 = validItems.find((it) => it.mida === "144X144");
        if (sq144) return sq144.url;

        const sqByTitle = validItems.find((it) =>
          /podcast|1400x1400|1500x1500|400x400|314x314|300x300|itunes_avatar/i.test(it.titol)
        );
        if (sqByTitle) return sqByTitle.url;
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
    const titolMeta = String(obj.titol || obj.alt || "");
    const midaMeta = String(obj.mida || obj.relacio || obj.ratio || "");
    if (
      isLogoRelOrTitle(relName, titolMeta) ||
      NON_SQUARE_META_RE.test(`${relName} ${midaMeta} ${titolMeta}`) ||
      isDimensionNonSquare(midaMeta) ||
      isDimensionNonSquare(titolMeta)
    ) {
      return null;
    }

    const w = Number(obj.amplada || obj.width || obj.w || 0);
    const h = Number(obj.alcada || obj.height || obj.h || 0);
    const ratio = midaMeta.toLowerCase();
    const rawUrl = obj.url || obj.src || obj.text || obj.imatge;

    if (typeof rawUrl === "string") {
      const normalized = normalizeImg(rawUrl);
      if (normalized) {
        if (
          relName === "IMG_PODCAST" ||
          (w > 0 && h > 0 && Math.abs(w - h) <= 4) ||
          isDimensionSquare(ratio) ||
          ratio === "1:1" ||
          ratio === "1x1" ||
          ratio.includes("quadra")
        ) {
          return normalized;
        }
      }
    }

    if (obj.imatges) {
      const foundInImatges = findSquareImageInObject(obj.imatges, depth + 1);
      if (foundInImatges) return foundInImatges;
    }

    for (const k of Object.keys(obj)) {
      if (k === "imatges" || /16x9|16_9|vertical|poster|cartell|logo|ara_sona|despres_sona|despres_fem|seguent/i.test(k)) continue;
      const found = findSquareImageInObject(obj[k], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function stripTransientKeys(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripTransientKeys);
    const clone = {};
    for (const k of Object.keys(obj)) {
      if (/^(ara_sona|despres_sona|despres_fem|seguent|despres)$/i.test(k)) continue;
      clone[k] = obj[k];
    }
    return clone;
  }

  function extractMultimediaUrl(textChunk, objContext = null) {
    const cleanContext = objContext ? stripTransientKeys(objContext) : null;
    if (cleanContext) {
      const exactSquare = findSquareImageInObject(cleanContext);
      if (exactSquare) return exactSquare;

      const ctxStr = JSON.stringify(cleanContext);
      if (/not[ií]cies\s*3catinfo/i.test(ctxStr)) {
        return "/catinfo_cover.png";
      }
      textChunk = ctxStr;
    }

    if (!textChunk) return null;
    if (/not[ií]cies\s*3catinfo/i.test(textChunk)) {
      return "/catinfo_cover.png";
    }

    const matches = textChunk.match(/(?:https?:\/\/img\.3cat\.cat)?\/multimedia\/[^"'\s\\<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\<>]*)?/gi);
    if (!matches || matches.length === 0) return null;

    const rejected = cleanContext ? collectNonSquareUrlsFromObject(cleanContext) : new Set();
    const valid = [...new Set(matches.map(normalizeImg).filter((u) => u && !rejected.has(u)))];
    if (valid.length === 0) return null;

    // 1. Etiqueta quadrada explícita
    const square = valid.find((u) => /1x1|1_1|quadra|square|cover|1400x1400|200x200|300x300|400x400|500x500|512x512|600x600|800x800/i.test(u));
    if (square) return square;

    // 2. Descartem tant les panoràmiques (16:9) com les verticals (poster / 2:3 / 9:16)
    const squareCandidates = valid.filter(
      (u) => !/16x9|16_9|panoramic|horitzontal|wide|1920x1080|1280x720|vertical|portrait|poster|cartell|288x422|240x350|467x684|2x3|2_3|3x4|3_4|9x16|9_16|1080x1920|720x1280/i.test(u)
    );
    if (squareCandidates.length > 0) {
      return squareCandidates[0];
    }

    return null;
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
          artwork: artwork || (chKey === "catinfo" ? "/catinfo_cover.png" : null),
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

  function findSongInfo(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 8) return null;

    const candidates = [
      obj.ara_sona,
      obj.canco_actual,
      obj.canco,
      obj.canço,
      obj.song,
      obj.track,
      obj.pista,
      obj.audio_track
    ];

    for (const c of candidates) {
      if (c && typeof c === "object") {
        const title = c.titol || c.titol_canco || c.nom || c.canco || c.title || c.name;
        const artist = c.artista || c.interpret || c.grup || c.cantant || c.artist || c.author;
        if (title && typeof title === "string" && title.trim()) {
          const rawImg = c.imatge || c.cover || c.foto || c.artwork || c.src || c.url;
          const songImg = findSquareImageInObject(c) || normalizeImg(typeof rawImg === "string" ? rawImg : null);
          return {
            title: decodeHtmlEntities(title),
            artist: artist ? decodeHtmlEntities(artist) : "",
            artwork: songImg || null
          };
        }
      } else if (typeof c === "string" && c.includes("-") && c.length > 3) {
        const parts = c.split("-").map((p) => p.trim());
        if (parts.length >= 2 && parts[0] && parts[1]) {
          return {
            title: decodeHtmlEntities(parts[1]),
            artist: decodeHtmlEntities(parts[0]),
            artwork: null
          };
        }
      }
    }

    if ((obj.titol_canco || obj.canco) && (obj.artista || obj.interpret)) {
      const title = obj.titol_canco || obj.canco || obj.titol || obj.title;
      const artist = obj.artista || obj.interpret || obj.grup || obj.cantant || obj.artist;
      if (title && typeof title === "string" && title.trim()) {
        const songImg = findSquareImageInObject(obj);
        return {
          title: decodeHtmlEntities(title),
          artist: artist ? decodeHtmlEntities(artist) : "",
          artwork: songImg || null
        };
      }
    }

    for (const k of Object.keys(obj)) {
      if (/^(imatges|schedule|graella|tokens)$/i.test(k)) continue;
      if (obj[k] && typeof obj[k] === "object") {
        const found = findSongInfo(obj[k], depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function findSongInfoInHtml(html) {
    if (!html || typeof html !== "string") return null;
    const m = html.match(/Ara sona:?\s*(?:<[^>]+>\s*)*([^<]+?)\s*-\s*([^<]+)/i) ||
              html.match(/(?:Canç[oó]|Tema):?\s*(?:<[^>]+>\s*)*([^<]+)/i);
    if (m && m[1] && m[2]) {
      return {
        artist: decodeHtmlEntities(m[1]),
        title: decodeHtmlEntities(m[2]),
        artwork: null
      };
    }
    return null;
  }

  const channels = {};
  const debugLog = [];

  try {
    let directesNextData = null;

    const [directesRes, icatWsaRes] = await Promise.allSettled([
      fetch("https://www.3cat.cat/3cat/directes/catalunya-radio/", { headers }),
      fetch("https://dinamics.3cat.cat/wsarafem/arafem/radio/ic/geo/cat", { headers })
    ]);

    if (directesRes.status === "fulfilled" && directesRes.value.ok) {
      const html = await directesRes.value.text();
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (nextDataMatch && nextDataMatch[1]) {
        try {
          directesNextData = JSON.parse(nextDataMatch[1]);
          extractFromNextData(directesNextData, channels);
        } catch (err) {
          debugLog.push({ nextDataError: err.message });
        }
      }
      extractFromRenderedHtml(html, channels);
    }

    if (icatWsaRes.status === "fulfilled" && icatWsaRes.value.ok) {
      try {
        const icatJson = await icatWsaRes.value.json();
        const araFem = icatJson?.canal?.ara_fem;
        if (araFem) {
          if (!channels.icat) {
            channels.icat = {
              id: "icat",
              channel: "icat",
              title: "iCat",
              host: "iCat",
              artwork: null
            };
          }
          if (araFem.titol_programa) {
            channels.icat.programTitle = decodeHtmlEntities(araFem.titol_programa.trim());
            channels.icat.title = decodeHtmlEntities(araFem.titol_programa.trim());
          }
          if (araFem.presentador) {
            channels.icat.host = decodeHtmlEntities(araFem.presentador.trim());
          }
          const progImg = findSquareImageInObject(araFem);
          if (progImg) {
            channels.icat.artwork = progImg;
          }

          const arasona = araFem.arasona;
          if (arasona && arasona.titol && typeof arasona.titol === "string" && arasona.titol.trim()) {
            const rawImg = (Array.isArray(arasona.imatges) && arasona.imatges[0] && arasona.imatges[0].text) || null;
            channels.icat.song = {
              title: decodeHtmlEntities(arasona.titol.trim()),
              artist: arasona.artista ? decodeHtmlEntities(String(arasona.artista).trim()) : "",
              artwork: rawImg ? normalizeImg(rawImg) : null,
              startTime: arasona.start_time || null,
              endTime: arasona.end_time || null
            };
          } else {
            channels.icat.song = null;
          }
        }
      } catch (err) {
        debugLog.push({ icatWsaError: err.message });
      }
    }

    if (channels.icat && !channels.icat.song && directesNextData) {
      const fallbackSong = findSongInfo(directesNextData);
      if (fallbackSong && fallbackSong.title) {
        channels.icat.song = fallbackSong;
      }
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
        const rawSchedule = schedulesBySlug[m.graellaSlug] || [];
        // Si és Exclusiu Digital, només fem servir la graella si el programa en emissió coincideix amb Catalunya Ràdio
        const liveTitleNorm = (channels[m.key].title || "").toLowerCase().trim();
        const canonicalArtworkByTitle = new Map();
        if (liveTitleNorm && channels[m.key].artwork) {
          canonicalArtworkByTitle.set(liveTitleNorm, channels[m.key].artwork);
        }
        for (const item of rawSchedule) {
          const tNorm = (item.title || "").toLowerCase().trim();
          if (tNorm && item.artwork && !canonicalArtworkByTitle.has(tNorm)) {
            canonicalArtworkByTitle.set(tNorm, item.artwork);
          }
        }
        if (liveTitleNorm && !channels[m.key].artwork && canonicalArtworkByTitle.has(liveTitleNorm)) {
          channels[m.key].artwork = canonicalArtworkByTitle.get(liveTitleNorm);
        }
        channels[m.key].schedule = rawSchedule.map((item) => {
          const tNorm = (item.title || "").toLowerCase().trim();
          return {
            ...item,
            artwork: canonicalArtworkByTitle.get(tNorm) || item.artwork || null
          };
        });
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
