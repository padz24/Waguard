const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://music.apple.com/id/search?term=";

/**
 * Scrape Apple Music search results for a given term.
 * @param {string} term — kata kunci pencarian, misal "sempurna"
 * @returns {Promise<Array<{ title: string, subtitle: string, link: string, image: string|null }>>}
 */
async function apples(term) {
	const url = `${BASE_URL}${encodeURIComponent(term)}`;

	try {
		// 1. Fetch halaman
		const { data: html } = await axios.get(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
			}
		});

		// 2. Parse dengan Cheerio
		const $ = cheerio.load(html);
		const results = [];

		// 3. Ekstrak tiap item grid
		$("li.grid-item").each((_, li) => {
			const el = $(li);

			const link = el.find("a.click-action").attr("href");
			const title = el
				.find(
					'[data-testid="top-search-result-title"] .top-search-lockup__primary__title'
				)
				.text()
				.trim();
			const subtitle = el
				.find('[data-testid="top-search-result-subtitle"]')
				.text()
				.trim();
			// ambil srcset pertama dari <source type="image/jpeg">
			const imgSrc =
				el
					.find('picture source[type="image/jpeg"]')
					.first()
					.attr("srcset")
					?.split(" ")[0] || null;

			if (title && link) {
				results.push({ title, subtitle, link, image: imgSrc });
			}
		});

		return results;
	} catch (err) {
		console.error(`Error scraping "${term}":`, err.message);
		return [];
	}
}

/**
 * Cari lagu di Spotify
 * @param {string} query - judul / kata kunci pencarian
 * @returns {Promise<Array<{ track_url: string, thumbnail: string, title: string, artist: string, duration: string, album: string, release_date: string }>>}
 */
async function spotifySearch(query) {
	try {
		const url = `https://api.siputzx.my.id/api/s/spotify?query=${encodeURIComponent(
			query
		)}`;
		const { data } = await axios.get(url);

		if (!data.status || !Array.isArray(data.data)) {
			return [];
		}

		// return hasil sesuai format
		return data.data.map(item => ({
			track_url: item.track_url,
			thumbnail: item.thumbnail,
			title: item.title,
			artist: item.artist,
			duration: item.duration,
			album: item.album,
			release_date: item.release_date
		}));
	} catch (err) {
		console.error("Spotify search error:", err.message);
		return [];
	}
}

/**
 * Cari video / channel di YouTube
 * @param {string} query - kata kunci pencarian, misal "lagu duka last child"
 * @returns {Promise<Array>}
 */
async function youtubeSearch(query) {
	try {
		const url = `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(
			query
		)}`;

		const { data } = await axios.get(url, {
			headers: {
				"user-agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
			}
		});

		if (!data.status || !data.data) return [];

		return data.data
			.map(item => {
				if (item.type === "video") {
					return {
						type: "video",
						videoId: item.videoId,
						url: item.url,
						title: item.title,
						description: item.description,
						thumbnail: item.thumbnail || item.image,
						duration: item.duration?.timestamp || item.timestamp,
						views: item.views,
						ago: item.ago,
						author: item.author?.name || "-",
						authorUrl: item.author?.url || null
					};
				} else if (item.type === "channel") {
					return {
						type: "channel",
						name: item.name,
						title: item.title,
						url: item.url,
						thumbnail: item.thumbnail || item.image,
						subscribers:
							item.subCountLabel || item.subCount || null,
						about: item.about || null,
						verified: item.verified || false
					};
				}
				return null;
			})
			.filter(Boolean);
	} catch (err) {
		console.error("YouTube search error:", err.message);
		return [];
	}
}

module.exports = { apples, spotifySearch, youtubeSearch };
