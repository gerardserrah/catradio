export default async function handler(req, res) {
  try {
    const response = await fetch("https://www.3cat.cat/3cat/directes/catalunya-radio/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

    if (match && match[1]) {
      return res.status(200).json(JSON.parse(match[1]));
    }
    return res.status(200).json({});
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
