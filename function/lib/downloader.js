const axios = require("axios");
const cheerio = require("cheerio");
const qs = require("qs");
const crypto = require("crypto")

/**
 * ======================
 * TREADDS DOWNLOADER
 * ======================
 */
async function trd(url) {
	const apiUrl = "https://api.threadsphotodownloader.com/v2/media";

	const params = {
		url: url
	};

	try {
		const response = await axios.get(apiUrl, {
			params: params
		});

		const imageUrls = (response.data.image_urls || [])
			.map(item => item.download_url || item)
			.filter(url => url);

		const videoUrls = (response.data.video_urls || [])
			.map(item => item.download_url || item)
			.filter(url => url);

		return {
			image_urls: imageUrls,
			video_urls: videoUrls
		};
	} catch (error) {
		console.error("Error downloading media:", error.message);
		return { image_urls: [], video_urls: [] };
	}
}

/**
 * ======================
 * SPOTIFY DOWNLOADER
 * ======================
 */
async function spotifydl(url) {
	try {
		if (!url.includes("open.spotify.com")) throw new Error("Invalid url.");

		const rynn = await axios.get("https://spotdl.io/", {
			headers: {
				"user-agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
			}
		});
		const $ = cheerio.load(rynn.data);

		const api = axios.create({
			baseURL: "https://spotdl.io",
			headers: {
				cookie: rynn.headers["set-cookie"].join("; "),
				"content-type": "application/json",
				"user-agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				"x-csrf-token": $('meta[name="csrf-token"]').attr("content")
			}
		});

		const [{ data: meta }, { data: dl }] = await Promise.all([
			api.post("/getTrackData", { spotify_url: url }),
			api.post("/convert", { urls: url })
		]);

		return {
			...meta,
			download_url: dl.url
		};
	} catch (error) {
		throw new Error(error.message);
	}
}

/**
 * ======================
 * TIKTOK DOWNLOADER
 * ======================
 */
async function ttdl(url) {
	try {
		if (
			!/^https?:\/\/(www\.)?(tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|m\.tiktok\.com)\/.+/i.test(
				url
			)
		)
			throw new Error("Invalid url");

		const { data } = await axios.get(
			"https://tiktok-scraper7.p.rapidapi.com",
			{
				headers: {
					"Accept-Encoding": "gzip",
					Connection: "Keep-Alive",
					Host: "tiktok-scraper7.p.rapidapi.com",
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36",
					"X-RapidAPI-Host": "tiktok-scraper7.p.rapidapi.com",
					"X-RapidAPI-Key":
						"ca5c6d6fa3mshfcd2b0a0feac6b7p140e57jsn72684628152a"
				},
				params: {
					url: url,
					hd: "1"
				}
			}
		);

		return data.data;
	} catch (error) {
		throw new Error(error.message);
	}
}

async function getFinalFileUrl(mediaUrl) {
	const headers = {
		accept: "*/*",
		"accept-language": "id-ID",
		"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
		cookie: "PHPSESSID=ofu9rbop984f7ovqdsp72q9t82",
		origin: "https://ytdown.io",
		referer: "https://ytdown.io/en/",
		"sec-ch-ua":
			'"Chromium";v="127", "Not)A;Brand";v="99", "Microsoft Edge Simulate";v="127", "Lemur";v="127"',
		"sec-ch-ua-mobile": "?1",
		"sec-ch-ua-platform": '"Android"',
		"sec-fetch-dest": "empty",
		"sec-fetch-mode": "cors",
		"sec-fetch-site": "same-origin",
		"user-agent":
			"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36",
		"x-requested-with": "XMLHttpRequest"
	};
	const data = qs.stringify({ url: mediaUrl });
	const resp = await axios.post("https://ytdown.io/proxy.php", data, {
		headers
	});
	return resp.data.api.fileUrl;
}

/**
 * ======================
 * YOUTUBE DOWNLOADER
 * ======================
 */
class ytdown {
	constructor() {
		this.ky = "C5D58EF67A7584E4A29F6C35BBC4EB12";
		this.hr = {
			"content-type": "application/json",
			origin: "https://yt.savetube.me",
			"user-agent":
				"Mozilla/5.0 (Android 15; Mobile; SM-F958; rv:130.0) Gecko/130.0 Firefox/130.0"
		};
		this.fmt = ["144", "240", "360", "480", "720", "1080", "mp3"];
		this.m =
			/^((?:https?:)?\/\/)?((?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]{11})/;
	}

	async decrypt(enc) {
		try {
			const [sr, ky] = [
				Buffer.from(enc, "base64"),
				Buffer.from(this.ky, "hex")
			];
			const [iv, dt] = [sr.slice(0, 16), sr.slice(16)];
			const dc = crypto.createDecipheriv("aes-128-cbc", ky, iv);
			return JSON.parse(
				Buffer.concat([dc.update(dt), dc.final()]).toString()
			);
		} catch (e) {
			throw new Error(`Error while decrypting data: ${e.message}`);
		}
	}

	async getCdn() {
		const response = await axios.get(
			"https://media.savetube.me/api/random-cdn",
			{ headers: this.hr }
		);
		if (!response.status) return response;
		return {
			status: true,
			data: response.data.cdn
		};
	}

	async download(url, format = "mp3") {
		const id = url.match(this.m)?.[3];
		if (!id) {
			return {
				status: false,
				msg: "ID cannot be extracted from url"
			};
		}
		if (!format || !this.fmt.includes(format)) {
			return {
				status: false,
				msg: "Formats not found",
				list: this.fmt
			};
		}
		try {
			const u = await this.getCdn();
			if (!u.status) return u;
			const res = await axios.post(
				`https://${u.data}/v2/info`,
				{
					url: `https://www.youtube.com/watch?v=${id}`
				},
				{ headers: this.hr }
			);
			const dec = await this.decrypt(res.data.data);
			const dl = await axios.post(
				`https://${u.data}/download`,
				{
					id: id,
					downloadType: format === "mp3" ? "audio" : "video",
					quality: format === "mp3" ? "128" : format,
					key: dec.key
				},
				{ headers: this.hr }
			);

			return {
				status: true,
				title: dec.title,
				format: format,
				thumb:
					dec.thumbnail ||
					`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
				duration: dec.duration,
				cached: dec.fromCache,
				dl: dl.data.data.downloadUrl
			};
		} catch (error) {
			return {
				status: false,
				error: error.message
			};
		}
	}
}
/**
 * ======================
 * APPLEMUSIC DOWNLOADER
 * ======================
 */
/**
 * Ambil metadata + link download dari Apple Music (via API siputzx)
 * @param {string} url - link Apple Music (lagu/album)
 * @returns {Promise<object|null>}
 */
async function appleMusicDl(url) {
	try {
		if (!url || !url.includes("music.apple.com")) {
			throw new Error("URL tidak valid. Harus link Apple Music");
		}

		const { data } = await axios.get(
			`https://api.siputzx.my.id/api/d/musicapple?url=${encodeURIComponent(
				url
			)}`
		);

		if (!data?.status || !data?.data) {
			throw new Error("Gagal ambil data Apple Music");
		}

		return {
			title: data.data.songTitle || data.data.appleTitle || "-",
			artist: data.data.artist || "-",
			artwork: data.data.artworkUrl || null,
			mp3: data.data.mp3DownloadLink || null,
			cover: data.data.coverDownloadLink || null,
			url: data.data.url || null
		};
	} catch (err) {
		console.error("Error appleMusicDl:", err.message);
		return null;
	}
}

module.exports = { spotifydl, ttdl, ytdown, trd, appleMusicDl };
