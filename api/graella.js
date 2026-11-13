export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");

  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Accept": "application/json, text/html;q=0.9",
    "Referer": "https://www.3cat.cat/"
  };

  // Mapeig oficial de codis de canal de la CCMA / 3Cat
  const CHANNELS = {
    catradio: ["cr", "catalunya-radio", "catalunya ràdio"],
    digital: ["ocr1", "catradio-digital", "exclusiu digital"],
    catinfo: ["ci", "catinfo", "3catinfo", "catalunya informació"],
    icat: ["ic", "icat"],
    catmusica: ["cm", "catmusica", "catalunya música"]
  };

  function normalizeImg(raw) {
    if (!raw || typeof raw !== "string") return null;
    let url = raw.trim().replace(/\\u002F/g, "/").replace(/\\\//g, "/");
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("/multimedia/")) url = "https://img.3cat.cat" + url;
    else if (url.startsWith("/")) url = "https://www.3cat.cat" + url;
    if (!/^https?:\/\//i.test(url)) return null;
    if (/logo|icona|avatar|sprite|\.svg/i.test(url)) return null;
    return url;
  }

  function extractImgFromObj(obj) {
    if (!obj || typeof obj !== "object") return null;
    const str = JSON.stringify(obj);
    const matches = str.match(/(?:https:\/\/img\.3cat\.cat)?\/multimedia\/[^"'\s\\]+?\.(?:jpg|jpeg|png|webp)/gi);
    if (!matches) return null;
    const valid = matches.map(normalizeImg).filter(Boolean);
    return valid.find((u) => /1x1|quadrat|cover|512|600|800/i.test(u)) || valid[0] || null;
  }

  function walkAndCollect(node, result) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item) => walkAndCollect(item, result));
      return;
    }

    const idHint = String(
      node.codi_canal || node.codi || node.id || node.canal || node.slug || ""
    ).toLowerCase();

    const currentProg = node.ara || node.directe || (node.titol && (node.imatge || node.imatges || node.subtitol) ? node : null);

    if (currentProg && idHint) {
      for (const [key, aliases] of Object.entries(CHANNELS)) {
        if (!result[key] && aliases.some((a) => idHint === a || idHint.includes(a))) {
          const title = currentProg.titol || currentProg.nom || currentProg.programa;
          const host = currentProg.subtitol || currentProg.presentador || currentProg.descripcio || "";
          const artwork = extractImgFromObj(currentProg) || extractImgFromObj(node);
          const nextObj = node.seguent || currentProg.seguent || node.despres;
          const next = nextObj?.titol
            ? `A continuació: ${nextObj.hora || nextObj.hora_inici || ""} ${nextObj.titol}`.trim()
            : "";

          if (title && artwork) {
            result[key] = { title, host, artwork, next };
          }
        }
      }
    }

    for (const k of Object.keys(node)) {
      walkAndCollect(node[k], result);
    }
  }

  const parsedChannels = {};

  // 1. Provem l'API oficial de graelles de 3Cat i les pàgines dels directes de ràdio
  const sources = [
    "https://api.3cat.cat/graella/directes",
    "https://www.3cat.cat/3cat/directes/catalunya-radio/",
    "https://www.3cat.cat/3cat/directes/icat/"
  ];

  for (const url of sources) {
    if (Object.keys(parsedChannels).length === 5) break;
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const text = await r.text();

      if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
        walkAndCollect(JSON.parse(text), parsedChannels);
      } else {
        const match = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (match && match[1]) {
          walkAndCollect(JSON.parse(match[1]), parsedChannels);
        }
      }
    } catch (e) {}
  }

  return res.status(200).json({ channels: parsedChannels, updatedAt: new Date().toISOString() });
}
