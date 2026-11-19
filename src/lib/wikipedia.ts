
export type WikipediaResult = {
  title: string;
  extract: string;
  url: string;
  thumbnail?: string;
};

export async function searchWikipedia(
  query: string,
  language: "en" | "fa" = "en"
): Promise<WikipediaResult | null> {
  const baseUrl = `https://${language}.wikipedia.org`;

  try {
    // Find the best matching article
    const searchResponse = await fetch(
      `${baseUrl}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=1`
    );

    if (!searchResponse.ok) {
      throw new Error("Wikipedia search failed");
    }

    const searchData = await searchResponse.json();
    const page = searchData.pages?.[0];

    if (!page) return null;

    // Fetch the article summary
    const summaryResponse = await fetch(
      `${baseUrl}/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`
    );

    if (!summaryResponse.ok) {
      throw new Error("Could not fetch Wikipedia article");
    }

    const article = await summaryResponse.json();

    return {
      title: article.title,
      extract: article.extract,
      url: article.content_urls?.desktop?.page,
      thumbnail: article.thumbnail?.source,
    };
  } catch (error) {
    console.error("[Voca] Wikipedia error:", error);
    return null;
  }
}
