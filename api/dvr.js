export default async function handler(req, res) {
  const { id = "cr" } = req.query;

  try {
    const targetUrl = `https://dinamics.ccma.cat/pvideo/media.jsp?media=radio&version=0s&idint=${encodeURIComponent(id)}&profile=pc`;
    const response = await fetch(targetUrl, {
      headers: {
        "Referer": "https://www.3cat.cat/",
        "Origin": "https://www.3cat.cat",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}