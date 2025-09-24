// function/pesan.js
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");
const util = require("util");
const { exec } = require("child_process");
const { allMessageTemplate } = require("./lib/allmessage");
const config = require("../database/config.json");
const Lookup = require("./lib/lookup");
const { Msw, Mgc } = require("./lib/messages");
const { fontify } = require("./lib/fontify");
const {
	spotifydl,
	ttdl,
	ytdown,
	trd,
	appleMusicDl
} = require("./lib/downloader");
const { igstalk } = require("./lib/stalk");
const { apples, spotifySearch, youtubeSearch } = require("./lib/search");

// Helper simpan config
async function saveConfig() {
	const configPath = path.join(__dirname, "../database/config.json");
	await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function handlePesan(
	sock,
	m,
	userDatabase,
	saveUserDatabase,
	currentMode
) {
	const sender = m.key.remoteJid;
	const isGroup = sender.endsWith("@g.us");
	const participant = isGroup ? m.key.participant || sender : sender;

	// ambil nomor tanpa @
	const formatSender = participant.split("@")[0];

	// lookup nomor → negara
	const Look = await Lookup(formatSender);

	// pushName fallback ke nomor aja (biar gak dobel nama & nomor)
	const pushName = m.pushName || formatSender;

	// === msg sesuai konteks ===
	const msg = isGroup
		? await Mgc(sender, formatSender, pushName, Look?.country)
		: await Msw(sender, formatSender, pushName, Look?.country);

	if (!config.OWNERS) config.OWNERS = [config.OWNER].filter(Boolean);

	// === Ambil isi pesan ===
	let text = "";
	if (m.message?.conversation) text = m.message.conversation;
	else if (m.message?.extendedTextMessage?.text)
		text = m.message.extendedTextMessage.text;
	else if (m.message?.imageMessage?.caption)
		text = m.message.imageMessage.caption;
	else if (m.message?.videoMessage?.caption)
		text = m.message.videoMessage.caption;
	else if (m.message?.documentMessage?.caption)
		text = m.message.documentMessage.caption;
	else if (m.message?.buttonsMessage?.contentText)
		text = m.message.buttonsMessage.contentText;
	else if (m.message?.buttonsResponseMessage?.selectedButtonId)
		text =
			m.message.buttonsResponseMessage.selectedDisplayText ||
			m.message.buttonsResponseMessage.selectedButtonId;
	else if (m.message?.listMessage?.description)
		text = m.message.listMessage.description;
	else if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId)
		text =
			m.message.listResponseMessage.singleSelectReply.title ||
			m.message.listResponseMessage.singleSelectReply.selectedRowId;
	else if (
		m.message?.interactiveResponseMessage?.nativeFlowResponseMessage
			?.paramsJson
	) {
		try {
			const params = JSON.parse(
				m.message.interactiveResponseMessage.nativeFlowResponseMessage
					.paramsJson
			);
			if (params.id) text = params.id;
			else if (params.text) text = params.text;
		} catch (e) {
			console.error("Error parsing interactive message paramsJson:", e);
		}
	} else if (m.message?.templateButtonReplyMessage?.selectedId)
		text =
			m.message.templateButtonReplyMessage.selectedDisplayText ||
			m.message.templateButtonReplyMessage.selectedId;
	else if (m.message?.reactionMessage?.text)
		text = m.message.reactionMessage.text;

	// ====== Command Parsing ======
	let command = "";
	let args = "";
	let prefix = "";
	let isCommand = false;
	const body = text || "";
	const isOwner =
		Array.isArray(config.OWNERS) && config.OWNERS.includes(formatSender);
	const botJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";

	// ambil metadata grup kalau group
	let groupMetadata = null;
	let groupName = "";
	try {
		if (isGroup) {
			groupMetadata = await sock.groupMetadata(sender);
			groupName = groupMetadata?.subject || "";
		}
	} catch (e) {
		groupMetadata = null;
		groupName = "";
	}

	// cek admin
	const isAdmin =
		isGroup && groupMetadata?.participants
			? groupMetadata.participants.some(
					p =>
						p.id === participant &&
						(p.admin === "admin" || p.admin === "superadmin")
			  )
			: false;

	function logCommand(
		command,
		senderId,
		pushNameLocal,
		isGroupLocal,
		groupNameLocal
	) {
		if (m.key && m.key.fromMe) return;
		const waktu = new Date().toLocaleString("id-ID", {
			timeZone: "Asia/Jakarta"
		});
		console.log(`
━━━━━━━━━━━━━━━
🕒 ${waktu}
👤 Pengirim : ${pushNameLocal} (${senderId})
💬 Command  : ${command || "-"}
🏠 Dari     : ${isGroupLocal ? "Grup " + groupNameLocal : "Chat Pribadi"}
━━━━━━━━━━━━━━━
		`);
	}

	if (config.PREFIX_ENABLED) {
		for (const p of config.PREFIXES) {
			if (!text) continue;
			if (text.toLowerCase().startsWith(p.toLowerCase())) {
				prefix = p;
				const fullCommand = text.slice(p.length).trim();
				command = fullCommand.split(" ")[0].toLowerCase();
				args = fullCommand.split(" ").slice(1).join(" ");
				isCommand = true;
				break;
			}
		}
	} else {
		if (text && text.trim() !== "") {
			command = text.toLowerCase().trim().split(" ")[0];
			args = text.trim().split(" ").slice(1).join(" ");
			isCommand = true;
		}
	}

	// === AI MODE (skip kalau command) ===
	if (!isCommand && config.AI === true) {
		if (m.key && m.key.fromMe) return;
		if (body == "$" || body == "=>" || body == ">" || body == "/") return;
		if (!text || text.trim() === "") return;
		try {
			const response = await axios.post(
				"https://api.siputzx.my.id/api/ai/gpt3",
				[
					{
						role: "system",
						content: `Kamu adalah AI bernama Waguard. 
- Kalau ditanya siapa developer/pembuatmu, jawab: paddil. 
- Nada bicaramu halus, gaya Gen Z, kalau marah agak toxic dikit tapi tetap sopan, tambahin emoji sesuai mood.`
					},
					{ role: "user", content: text }
				]
			);

			const replyRaw =
				response.data?.data || "😵 Waguard lagi bengong...";
			const reply = replyRaw
				.replace(/##+/g, ">")
				.replace(/\*\*(.*?)\*\*/g, "*$1*");

			await allMessageTemplate(sock, sender, msg, {
				type: "text",
				text: reply
			});
		} catch (err) {
			console.error("Error call AI:", err);
			await allMessageTemplate(sock, sender, msg, {
				type: "text",
				text: "😖 Aduh, Waguard lagi bad mood, coba lagi bentar yaa~"
			});
		}
		return;
	}

	logCommand(body, formatSender, pushName, isGroup, groupName);
	// 🚨 Deteksi bug / virtex
	if (config.ANTIBUG || config.ANTIVIRTEX) {
		if (body && typeof body === "string") {
			// contoh filter: panjang pesan terlalu gila
			if (config.ANTIVIRTEX && body.length > 5000) {
				await sock.sendMessage(sender, {
					text: "⚠️ Pesan terdeteksi sebagai *virtex* (terlalu panjang), otomatis dihapus!"
				});
				return;
			}

			// contoh filter bug tertentu (karakter aneh / nol width / unicode rusak)
			const bugPattern = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/;
			if (config.ANTIBUG && bugPattern.test(body)) {
				await sock.sendMessage(sender, {
					text: "⚠️ Pesan terdeteksi sebagai *bug text*, diblokir otomatis!"
				});
				return;
			}
		}
	}

	// 🚨 Deteksi AntiKudeta
	if (isGroup && config.GROUP_ANTIKUDETA?.[sender]) {
		try {
			const metadata = await sock.groupMetadata(sender);
			const admins = metadata.participants
				.filter(p => p.admin === "admin" || p.admin === "superadmin")
				.map(p => p.id);

			// simpan state admin lama biar bisa dibandingin
			if (!userDatabase[sender]) userDatabase[sender] = {};
			if (!userDatabase[sender].lastAdmins)
				userDatabase[sender].lastAdmins = admins;

			const lastAdmins = userDatabase[sender].lastAdmins;

			// cek apakah ada admin yg hilang
			const removedAdmins = lastAdmins.filter(x => !admins.includes(x));

			if (removedAdmins.length > 0) {
				// identifikasi pelaku (pengirim event terakhir)
				const actor = m.key.participant || m.participant || "";
				const actorId = actor.split("@")[0];

				for (let target of removedAdmins) {
					try {
						// balikin admin yang ditendang
						await sock.groupParticipantsUpdate(
							sender,
							[target],
							"add"
						);

						// kalau pelaku valid & bukan owner / bot → kick
						const isOwnerActor =
							Array.isArray(config.OWNERS) &&
							config.OWNERS.includes(actorId);
						const botJid =
							sock.user.id.split(":")[0] + "@s.whatsapp.net";

						if (actor && actor !== botJid && !isOwnerActor) {
							await sock.groupParticipantsUpdate(
								sender,
								[actor],
								"remove"
							);
							await sock.sendMessage(sender, {
								text: `⛔ AntiKudeta aktif!\n@${actorId} mencoba menendang admin @${
									target.split("@")[0]
								}.\nPelaku sudah di-*kick*!`,
								mentions: [actor, target]
							});
						} else {
							await sock.sendMessage(sender, {
								text: `🚨 AntiKudeta aktif!\nPercobaan kudeta terhadap admin @${
									target.split("@")[0]
								} berhasil dicegah 🔒`,
								mentions: [target]
							});
						}
					} catch (e) {
						console.error("Gagal proses AntiKudeta:", e);
					}
				}
			}

			// update state admin terbaru
			userDatabase[sender].lastAdmins = admins;
			await saveUserDatabase(userDatabase);
		} catch (err) {
			console.error("Error AntiKudeta:", err);
		}
	}

	// 🚨 Deteksi AntiTagSW
	if (
		isGroup &&
		config.GROUP_ANTITAGSW?.[sender] &&
		m.message?.statusMentionMessage?.message?.protocolMessage?.type ===
			"STATUS_MENTION_MESSAGE"
	) {
		// Bypass untuk Owner & Admin
		if (isOwner || isAdmin) return;

		// auto hapus pesan
		try {
			await sock.sendMessage(sender, { delete: m.key });
		} catch (e) {
			console.error("Gagal hapus pesan:", e);
		}

		// init data limit
		if (!userDatabase[sender]) userDatabase[sender] = {};
		if (!userDatabase[sender].antitagsw)
			userDatabase[sender].antitagsw = {};
		if (!userDatabase[sender].antitagsw[participant])
			userDatabase[sender].antitagsw[participant] = 0;

		// increment hitungan
		userDatabase[sender].antitagsw[participant]++;
		const count = userDatabase[sender].antitagsw[participant];

		if (count >= 5) {
			// kick user
			try {
				await sock.groupParticipantsUpdate(
					sender,
					[participant],
					"remove"
				);
				await sock.sendMessage(sender, {
					text: `🚨 @${
						participant.split("@")[0]
					} sudah melakukan *TagSW* sebanyak 5x dan otomatis di-*kick*!`,
					mentions: [participant]
				});
			} catch (e) {
				console.error("Gagal kick user:", e);
			}
		} else {
			await sock.sendMessage(sender, {
				text: `⚠️ @${
					participant.split("@")[0]
				}, dilarang tag status! ( ${count}/5 )`,
				mentions: [participant]
			});
		}

		await saveUserDatabase(userDatabase);
		return;
	}

	// === Init database user ===
	if (!userDatabase[sender]) {
		userDatabase[sender] = {
			name: m.pushName || "Anonim",
			lastActivity: Date.now(),
			count: 0
		};
		await saveUserDatabase(userDatabase);
	}
	userDatabase[sender].lastActivity = Date.now();
	userDatabase[sender].count++;
	await saveUserDatabase(userDatabase);

	// === Commands ===
	try {
		switch (command) {
			case "menu":
			case "help":
				{
					const teks = `
⟡✦⟡───── 𝑴𝒊𝒅𝒏𝒊𝒈𝒉𝒕 𝑪𝒊𝒓𝒄𝒍𝒆 ─────⟡✦⟡

🔍 *Stalk*
   • ${prefix}stalk <nomor> [Limit]
   • ${prefix}igstalk <username> [Limit]

👑 *Owner*
   • ${prefix}owner <add|del|list> <nomor>

🕌 *Reminder Sholat*
   • ${prefix}reminder on/off
   • ${prefix}setcity <id_kota>
   • ${prefix}addcity <id_kota>

⚙️ *Konfigurasi*
   • ${prefix}config
   • ${prefix}set <owner/mode/prefix> <value>
   • ${prefix}prefix add/del/list <simbol>
   • ${prefix}message set <group|owner|private|admin> <pesan>

🛡️ *Proteksi Grup*
   • ${prefix}antibug on/off
   • ${prefix}antivirtex on/off
   • ${prefix}antikudet on/off
   • ${prefix}antitagsw on/off

☁️ *Downloader*
   • ${prefix}download <tt|yt|sp|ap> <url> [Limit]

🔍 *Search*
   • ${prefix}search <ap|yt|sp> <title>

🔨 *Tools*
   • ${prefix}fontify <text>

👥 *Group Setting*
   • ${prefix}group set <open/close|on/off>

🤖 *AI*
   • ${prefix}ai on/off

⟡✦⟡────────────────────────────⟡✦⟡
`;

					await sock.sendMessage(
						sender,
						{ text: teks },
						{ quoted: msg }
					);
				}
				break;

			case "dl":
			case "download":
				{
					if (isGroup) {
						await sock.sendMessage(
							sender,
							{
								text: "⚠️ Fitur ini hanya bisa dipakai di chat pribadi."
							},
							{ quoted: msg }
						);
						return;
					}

					// parsing argumen
					const [subcmd, ...restArgs] = args.split(" ");
					const rawUrl = restArgs.join(" ").trim();

					if (!subcmd || subcmd === "help") {
						await sock.sendMessage(
							sender,
							{
								text:
									`ℹ️ Gunakan:\n` +
									`${prefix}dl yt <url_youtube>\n` +
									`${prefix}dl tt <url_tiktok>\n` +
									`${prefix}dl sp <url_spotify>`
							},
							{ quoted: msg }
						);
						return;
					}

					try {
						// ==== YouTube ====
						if (subcmd === "yt") {
							if (!rawUrl) {
								await sock.sendMessage(
									sender,
									{
										text: `❌ Gunakan: ${prefix}dl yt <url_youtube>`
									},
									{ quoted: msg }
								);
								return;
							}

							const LIMIT = Number(config.YTDL_LIMIT ?? 3);
							if (!userDatabase[sender])
								userDatabase[sender] = {};
							const u = userDatabase[sender];
							if (!u.ytdl)
								u.ytdl = {
									count: 0,
									resetAt: Date.now() + 86400000
								};
							if (Date.now() > u.ytdl.resetAt) {
								u.ytdl.count = 0;
								u.ytdl.resetAt = Date.now() + 86400000;
							}

							const isExempt =
								Array.isArray(config.OWNERS) &&
								config.OWNERS.includes(formatSender);
							if (!isExempt && u.ytdl.count >= LIMIT) {
								await sock.sendMessage(
									sender,
									{
										text: `🚫 Limit harian YouTube (${LIMIT}) tercapai. Reset: ${new Date(
											u.ytdl.resetAt
										).toLocaleString("id-ID")}`
									},
									{ quoted: msg }
								);
								return;
							}

							await sock.sendMessage(
								sender,
								{ text: "🔎 Mengambil video YouTube..." },
								{ quoted: msg }
							);

							// ambil data dari downloader
							const dls = new ytdown();
							const res = await dls
								.download(rawUrl, "720")
								.catch(() => null);

							if (!res || !res.status || !res.dl) {
								await sock.sendMessage(
									sender,
									{ text: "❌ Gagal download YouTube." },
									{ quoted: msg }
								);
								return;
							}

							const caption = `🎬 *YouTube Video*\n\n• Judul: ${
								res.title || "-"
							}\n• Resolusi: ${
								res.format ? res.format + "p" : "-"
							}\n• Durasi: ${
								res.duration ? res.duration + " detik" : "-"
							}\n\n📌 Sisa limit: ${
								isExempt ? "Unlimited" : LIMIT - u.ytdl.count
							}/${LIMIT}`;

							const videoRes = await axios.get(res.dl, {
								responseType: "arraybuffer"
							});

							await sock.sendMessage(
								sender,
								{
									video: Buffer.from(videoRes.data),
									mimetype: "video/mp4",
									caption,
									contextInfo: {
										externalAdReply: {
											title: res.title,
											body: "YouTube Downloader",
											thumbnailUrl: res.thumb || null,
											mediaType: 2,
											mediaUrl: rawUrl,
											sourceUrl: rawUrl,
											renderLargerThumbnail: true
										}
									}
								},
								{ quoted: msg }
							);

							if (!isExempt) u.ytdl.count++;
							userDatabase[sender] = u;
							await saveUserDatabase(userDatabase);
						} else if (subcmd === "ytmp3") {
							if (!rawUrl) {
								await sock.sendMessage(
									sender,
									{
										text: `❌ Gunakan: ${prefix}dl ytmp3 <url_youtube>`
									},
									{ quoted: msg }
								);
								return;
							}

							const LIMIT = Number(config.YTDL_LIMIT ?? 3);
							if (!userDatabase[sender])
								userDatabase[sender] = {};
							const u = userDatabase[sender];
							if (!u.ytdl)
								u.ytdl = {
									count: 0,
									resetAt: Date.now() + 86400000
								};
							if (Date.now() > u.ytdl.resetAt) {
								u.ytdl.count = 0;
								u.ytdl.resetAt = Date.now() + 86400000;
							}

							const isExempt =
								Array.isArray(config.OWNERS) &&
								config.OWNERS.includes(formatSender);
							if (!isExempt && u.ytdl.count >= LIMIT) {
								await sock.sendMessage(
									sender,
									{
										text: `🚫 Limit harian YouTube (${LIMIT}) tercapai. Reset: ${new Date(
											u.ytdl.resetAt
										).toLocaleString("id-ID")}`
									},
									{ quoted: msg }
								);
								return;
							}

							await sock.sendMessage(
								sender,
								{ text: "🔎 Mengambil audio YouTube (MP3)..." },
								{ quoted: msg }
							);

							// ambil data dari downloader dengan format mp3
							const dls = new ytdown();
							const res = await dls
								.download(rawUrl, "mp3")
								.catch(() => null);

							if (!res || !res.status || !res.dl) {
								await sock.sendMessage(
									sender,
									{
										text: "❌ Gagal download audio YouTube."
									},
									{ quoted: msg }
								);
								return;
							}

							const caption = `🎵 *YouTube MP3*\n\n• Judul: ${
								res.title || "-"
							}\n• Format: ${res.format || "-"}\n• Durasi: ${
								res.duration ? res.duration + " detik" : "-"
							}\n\n📌 Sisa limit: ${
								isExempt ? "Unlimited" : LIMIT - u.ytdl.count
							}/${LIMIT}`;

							const audioRes = await axios.get(res.dl, {
								responseType: "arraybuffer"
							});

							await sock.sendMessage(
								sender,
								{
									audio: Buffer.from(audioRes.data),
									mimetype: "audio/mpeg",
									ptt: false,
									caption,
									contextInfo: {
										externalAdReply: {
											title: res.title,
											body: "YouTube MP3 Downloader",
											thumbnailUrl: res.thumb || null,
											mediaType: 2,
											mediaUrl: rawUrl,
											sourceUrl: rawUrl,
											renderLargerThumbnail: true
										}
									}
								},
								{ quoted: msg }
							);

							if (!isExempt) u.ytdl.count++;
							userDatabase[sender] = u;
							await saveUserDatabase(userDatabase);
						}

						// ==== TikTok ====
						else if (subcmd === "tt") {
							if (!rawUrl) {
								await sock.sendMessage(
									sender,
									{
										text: `❌ Gunakan: ${prefix}dl tt <url_tiktok>`
									},
									{ quoted: msg }
								);
								return;
							}

							const LIMIT = Number(config.TTDL_LIMIT ?? 3);
							if (!userDatabase[sender])
								userDatabase[sender] = {};
							const u = userDatabase[sender];
							if (!u.ttdl)
								u.ttdl = {
									count: 0,
									resetAt: Date.now() + 86400000
								};
							if (Date.now() > u.ttdl.resetAt) {
								u.ttdl.count = 0;
								u.ttdl.resetAt = Date.now() + 86400000;
							}

							const isExempt =
								Array.isArray(config.OWNERS) &&
								config.OWNERS.includes(formatSender);
							if (!isExempt && u.ttdl.count >= LIMIT) {
								await sock.sendMessage(
									sender,
									{
										text: `🚫 Limit harian TikTok (${LIMIT}) tercapai. Reset: ${new Date(
											u.ttdl.resetAt
										).toLocaleString("id-ID")}`
									},
									{ quoted: msg }
								);
								return;
							}

							await sock.sendMessage(
								sender,
								{ text: "🔎 Mengambil video TikTok..." },
								{ quoted: msg }
							);

							const res = await ttdl(rawUrl);
							if (!res || !res.play) {
								await sock.sendMessage(
									sender,
									{ text: "❌ Gagal ambil data TikTok." },
									{ quoted: msg }
								);
								return;
							}

							const caption = `🎬 *TikTok Video*\n\n• User: ${
								res.author?.nickname || "-"
							}\n• Title: ${res.title || "-"}\n\n📌 Sisa limit: ${
								isExempt ? "Unlimited" : LIMIT - u.ttdl.count
							}/${LIMIT}`;

							const videoRes = await axios.get(
								res.hdplay || res.play,
								{
									responseType: "arraybuffer"
								}
							);
							await sock.sendMessage(
								sender,
								{
									video: Buffer.from(videoRes.data),
									mimetype: "video/mp4",
									caption
								},
								{ quoted: msg }
							);

							if (!isExempt) u.ttdl.count++;
							userDatabase[sender] = u;
							await saveUserDatabase(userDatabase);
						}

						// ==== Spotify ====
						else if (subcmd === "sp") {
							if (!rawUrl) {
								await sock.sendMessage(
									sender,
									{
										text: `❌ Gunakan: ${prefix}dl sp <url_spotify>`
									},
									{ quoted: msg }
								);
								return;
							}

							const LIMIT = Number(config.SPOTIFY_LIMIT ?? 5);
							if (!userDatabase[sender])
								userDatabase[sender] = {};
							const u = userDatabase[sender];
							if (!u.spotify)
								u.spotify = {
									count: 0,
									resetAt: Date.now() + 86400000
								};
							if (Date.now() > u.spotify.resetAt) {
								u.spotify.count = 0;
								u.spotify.resetAt = Date.now() + 86400000;
							}

							const isExempt =
								Array.isArray(config.OWNERS) &&
								config.OWNERS.includes(formatSender);
							if (!isExempt && u.spotify.count >= LIMIT) {
								await sock.sendMessage(
									sender,
									{
										text: `🚫 Limit harian Spotify (${LIMIT}) tercapai. Reset: ${new Date(
											u.spotify.resetAt
										).toLocaleString("id-ID")}`
									},
									{ quoted: msg }
								);
								return;
							}

							await sock.sendMessage(
								sender,
								{ text: "🔎 Mengambil data Spotify..." },
								{ quoted: msg }
							);

							const meta = await spotifydl(rawUrl).catch(
								() => null
							);
							if (!meta || !meta.download_url) {
								await sock.sendMessage(
									sender,
									{ text: "❌ Gagal ambil data Spotify." },
									{ quoted: msg }
								);
								return;
							}

							const title = meta.name || meta.title || "Unknown";
							const artist = Array.isArray(meta.artists)
								? meta.artists.map(a => a.name).join(", ")
								: "Unknown";

							const audioRes = await axios.get(
								meta.download_url,
								{
									responseType: "arraybuffer"
								}
							);

							await sock.sendMessage(
								sender,
								{
									audio: Buffer.from(audioRes.data),
									mimetype: "audio/mpeg",
									fileName: `${title}.mp3`,
									contextInfo: {
										externalAdReply: {
											title: title,
											body: artist,
											thumbnailUrl:
												meta.album?.images?.[0]?.url ||
												null,
											mediaType: 2,
											mediaUrl:
												meta.external_urls?.spotify ||
												rawUrl,
											sourceUrl:
												meta.external_urls?.spotify ||
												rawUrl,
											renderLargerThumbnail: true
										}
									}
								},
								{ quoted: msg }
							);

							if (!isExempt) u.spotify.count++;
							userDatabase[sender] = u;
							await saveUserDatabase(userDatabase);
						}

						// ==== Apple Music ====
						else if (subcmd === "ap") {
							if (!rawUrl) {
								await sock.sendMessage(
									sender,
									{
										text: `❌ Gunakan: ${prefix}dl ap <url_applemusic>`
									},
									{ quoted: msg }
								);
								return;
							}

							const LIMIT = Number(config.APPLE_LIMIT ?? 3);
							if (!userDatabase[sender])
								userDatabase[sender] = {};
							const u = userDatabase[sender];
							if (!u.apple)
								u.apple = {
									count: 0,
									resetAt: Date.now() + 86400000
								};
							if (Date.now() > u.apple.resetAt) {
								u.apple.count = 0;
								u.apple.resetAt = Date.now() + 86400000;
							}

							const isExempt =
								Array.isArray(config.OWNERS) &&
								config.OWNERS.includes(formatSender);

							if (!isExempt && u.apple.count >= LIMIT) {
								await sock.sendMessage(
									sender,
									{
										text: `🚫 Limit harian Apple Music (${LIMIT}) tercapai. Reset: ${new Date(
											u.apple.resetAt
										).toLocaleString("id-ID")}`
									},
									{ quoted: msg }
								);
								return;
							}

							await sock.sendMessage(
								sender,
								{ text: "🔎 Mengambil data Apple Music..." },
								{ quoted: msg }
							);

							const meta = await appleMusicDl(rawUrl).catch(
								() => null
							);
							if (!meta || !meta.mp3) {
								await sock.sendMessage(
									sender,
									{
										text: "❌ Gagal ambil data Apple Music."
									},
									{ quoted: msg }
								);
								return;
							}

							const title = meta.title || "Unknown";
							const artist = meta.artist || "Unknown";

							// Download audio
							const audioRes = await axios.get(meta.mp3, {
								responseType: "arraybuffer"
							});

							await sock.sendMessage(
								sender,
								{
									audio: Buffer.from(audioRes.data),
									mimetype: "audio/mpeg",
									fileName: `${title}.mp3`,
									contextInfo: {
										externalAdReply: {
											title: title,
											body: artist,
											thumbnailUrl: meta.artwork || null,
											mediaType: 2,
											mediaUrl: meta.url || rawUrl,
											sourceUrl: meta.url || rawUrl,
											renderLargerThumbnail: true
										}
									}
								},
								{ quoted: msg }
							);

							if (!isExempt) u.apple.count++;
							userDatabase[sender] = u;
							await saveUserDatabase(userDatabase);
						}

						// ==== Subcmd tidak dikenal ====
						else {
							await sock.sendMessage(
								sender,
								{
									text:
										`❌ Subcommand tidak dikenal.\nGunakan:\n` +
										`${prefix}dl yt <url>\n${prefix}dl tt <url>\n${prefix}dl sp <url>`
								},
								{ quoted: msg }
							);
						}
					} catch (err) {
						console.error("Error dl case:", err);
						await sock.sendMessage(
							sender,
							{ text: "❌ Terjadi error saat download." },
							{ quoted: msg }
						);
					}
				}
				break;

			case "search":
			case "src":
				{
					if (isGroup) {
						await sock.sendMessage(
							sender,
							{
								text: "⚠️ Fitur ini hanya bisa dipakai di chat pribadi."
							},
							{ quoted: msg }
						);
						return;
					}

					const [subcmd, ...restArgs] = args.split(" ");
					const query = restArgs.join(" ").trim();

					if (!subcmd || !query) {
						await sock.sendMessage(
							sender,
							{
								text: `❌ Gunakan: ${prefix}sch <aple|yt|sp> <judul>\n\nContoh:\n${prefix}sch aple sempurna\n${prefix}sch yt lathi\n${prefix}sch sp payung teduh`
							},
							{ quoted: msg }
						);
						return;
					}

					try {
						if (subcmd === "ap") {
							await sock.sendMessage(
								sender,
								{ text: "🔎 Mencari di Apple Music..." },
								{ quoted: msg }
							);

							const results = await apples(query);
							if (!results.length) {
								await sock.sendMessage(
									sender,
									{
										text: `❌ Tidak ada hasil untuk *${query}* di Apple Music.`
									},
									{ quoted: msg }
								);
								return;
							}

							// List Sections
							const sections = [
								{
									title: "Apple Music Results",
									rows: results.slice(0, 10).map((r, i) => ({
										title: `${i + 1}. ${r.title}`,
										rowId: `${prefix}dl ap ${r.link}`,
										description: `${r.subtitle}\n🔗 ${r.link}`
									}))
								}
							];

							const listMessage = {
								text: `🎶 Hasil pencarian Apple Music untuk: *${query}*`,
								footer: "Pilih salah satu hasil di bawah untuk mendownload 🎵",
								title: "📀 Apple Music Search",
								buttonText: "Lihat Hasil",
								sections
							};

							await sock.sendMessage(sender, listMessage, {
								quoted: msg
							});
						}
						// ==== Spotify ====
						else if (subcmd === "sp") {
							await sock.sendMessage(
								sender,
								{ text: "🔎 Mencari di Spotify..." },
								{ quoted: msg }
							);

							const results = await spotifySearch(query);
							if (!results.length) {
								await sock.sendMessage(
									sender,
									{
										text: `❌ Tidak ada hasil untuk *${query}* di Spotify.`
									},
									{ quoted: msg }
								);
								return;
							}

							const sections = [
								{
									title: "🎧 Hasil Spotify",
									rows: results.slice(0, 10).map((r, i) => ({
										title: `${i + 1}. ${r.title}`,
										description: `${r.artist} · ${r.album} (${r.duration})`,
										rowId: `${prefix}dl sp ${r.track_url}`
									}))
								}
							];

							await sock.sendMessage(sender, {
								text: `🔎 Hasil pencarian Spotify untuk *${query}*`,
								footer: "Pilih salah satu hasil untuk membuka link",
								title: "Spotify Search",
								buttonText: "Lihat Hasil",
								sections
							});
						} // ==== YouTube Search ====
						else if (subcmd === "yt") {
							await sock.sendMessage(
								sender,
								{ text: "🔎 Mencari di YouTube..." },
								{ quoted: msg }
							);

							const results = await youtubeSearch(query);
							if (!results.length) {
								await sock.sendMessage(
									sender,
									{
										text: `❌ Tidak ada hasil untuk *${query}* di YouTube.`
									},
									{ quoted: msg }
								);
								return;
							}

							// Format ListMessage
							const sections = [
								{
									title: "🎬 Hasil Pencarian YouTube",
									rows: results
										.slice(0, 10)
										.flatMap((r, i) => {
											if (r.type !== "video") {
												return [
													{
														title: `[Channel] ${
															r.title || r.name
														}`,
														description: `${
															r.subscribers || "0"
														} subscriber`,
														rowId: `${prefix}dl yt ${r.url}`
													}
												];
											}

											return [
												{
													title: `📺 ${r.title}`,
													description: `${r.author} • ${r.duration} • ${r.views}x ditonton`,
													rowId: `${prefix}dl yt ${r.url}` // default: video
												},
												{
													title: `🎵 ${r.title} (MP3)`,
													description: `${r.author} • Audio Only`,
													rowId: `${prefix}dl ytmp3 ${r.url}` // tambahan: mp3
												}
											];
										})
								}
							];

							const listMessage = {
								text: `🔎 *YouTube Search*\nHasil untuk: *${query}*`,
								footer: "Pilih salah satu hasil di bawah 👇",
								title: "",
								buttonText: "Lihat Hasil",
								sections
							};

							await sock.sendMessage(sender, listMessage, {
								quoted: msg
							});
						} else {
							await sock.sendMessage(
								sender,
								{
									text: `❌ Subcmd tidak valid.\nGunakan: ${prefix}sch <aple|yt|sp> <judul>`
								},
								{ quoted: msg }
							);
						}
					} catch (err) {
						console.error("Error search case:", err);
						await sock.sendMessage(
							sender,
							{ text: "❌ Terjadi error pencarian." },
							{ quoted: msg }
						);
					}
				}
				break;

			case "fontify":
			case "fancy":
				{
					const argsText = args.trim().split(" ");
					const style = argsText.shift()?.toLowerCase() || "script";
					const inputText = argsText.join(" ");

					if (!inputText) {
						await sock.sendMessage(
							sender,
							{
								text: `ℹ️ Gunakan: ${prefix}fontify <style> <text>\n\nStyle yang tersedia: bold, italic, bolditalic, script, circled`
							},
							{ quoted: msg }
						);
						return;
					}

					try {
						const output = fontify(inputText, style);
						await sock.sendMessage(
							sender,
							{ text: `✨ *Fontify (${style})*\n\n${output}` },
							{ quoted: msg }
						);
					} catch (err) {
						console.error("Error fontify:", err);
						await sock.sendMessage(
							sender,
							{ text: "❌ Terjadi error fontify." },
							{ quoted: msg }
						);
					}
				}
				break;

			case "stalk":
				{
					// hanya boleh di private chat
					if (isGroup) {
						await sock.sendMessage(
							sender,
							{
								text:
									config.MSG_PRIVATE_ONLY ||
									"⚠️ Fitur ini hanya bisa dipakai di *chat pribadi*. Chat bot langsung ya."
							},
							{ quoted: msg }
						);
						return;
					}

					const raw = args.trim();
					if (!raw) {
						await sock.sendMessage(
							sender,
							{
								text: `ℹ️ Gunakan: ${prefix}stalk <nomor tanpa +>\nContoh: ${prefix}stalk 6281234567890`
							},
							{ quoted: msg }
						);
						return;
					}

					// sanitize nomor (buang selain digit)
					let targetNumber = raw.replace(/[^0-9]/g, "");
					if (!/^\d+$/.test(targetNumber)) {
						await sock.sendMessage(
							sender,
							{
								text: "❌ Format nomor tidak valid. Hanya boleh angka."
							},
							{ quoted: msg }
						);
						return;
					}

					// LIMITING (per hari)
					try {
						const LIMIT = Number(config.STALK_LIMIT ?? 5);
						if (!userDatabase[sender])
							userDatabase[sender] = {
								name: m.pushName || "Anonim",
								lastActivity: Date.now(),
								count: 0
							};
						const u = userDatabase[sender];
						if (!u.stalk)
							u.stalk = {
								count: 0,
								resetAt: Date.now() + 24 * 3600 * 1000
							};
						if (Date.now() > (u.stalk.resetAt || 0)) {
							u.stalk.count = 0;
							u.stalk.resetAt = Date.now() + 24 * 3600 * 1000;
						}
						const isExempt =
							Array.isArray(config.OWNERS) &&
							config.OWNERS.includes(formatSender);
						if (!isExempt && u.stalk.count >= LIMIT) {
							await saveUserDatabase(userDatabase);
							await sock.sendMessage(
								sender,
								{
									text: `🚫 Batas stalking harian tercapai (${LIMIT}x). Coba lagi setelah ${new Date(
										u.stalk.resetAt
									).toLocaleString("id-ID", {
										timeZone: "Asia/Jakarta"
									})}.`
								},
								{ quoted: msg }
							);
							return;
						}

						await sock.sendMessage(
							sender,
							{ text: "🔎 Sedang stalking... sabar ya~" },
							{ quoted: msg }
						);

						// lookup eksternal (lib Lookup)
						let lookupRes = {};
						try {
							lookupRes = (await Lookup(targetNumber)) || {};
						} catch (e) {
							lookupRes = {};
						}

						const targetJid = `${targetNumber}@s.whatsapp.net`;

						// --- BEST-EFFORT WA checks ---
						let profilePicUrl = null;
						let isRegistered = false;
						let pushName = null;
						let isBusiness = false;
						let isEnterprise = false;
						let contactExistsInfo = null;

						// 1) cek onWhatsApp / registration & some flags (many baileys forks implement this)
						try {
							if (typeof sock.onWhatsApp === "function") {
								const info = await sock.onWhatsApp([targetJid]);
								if (Array.isArray(info) && info[0]) {
									contactExistsInfo = info[0]; // simpan full object untuk inspeksi
									isRegistered = !!info[0].exists;
									pushName =
										info[0].vname || info[0].notify || null;
									isBusiness = !!info[0].isBusiness;
									isEnterprise = !!info[0].isEnterprise;
								}
							}
						} catch (e) {
							// ignore
						}

						// 2) try ambil profile picture (bisa throw jika ga ada / privat / nomor ga terdaftar)
						try {
							if (typeof sock.profilePictureUrl === "function") {
								profilePicUrl = await sock.profilePictureUrl(
									targetJid,
									"image"
								);
							}
						} catch (e) {
							profilePicUrl = null;
						}

						// 3) try fetch vcard/contact detail jika tersedia (fork-dependent)
						let contactDetail = null;
						try {
							// banyak fork punya method getName / getContact / vcard fetching; best-effort:
							if (typeof sock.getName === "function") {
								const name = await sock.getName(targetJid);
								if (name) pushName = pushName || name;
							}
							// some forks expose contacts map
							if (sock.contacts && sock.contacts[targetJid]) {
								contactDetail = sock.contacts[targetJid];
								pushName =
									pushName ||
									contactDetail.name ||
									contactDetail.notify;
							}
						} catch (e) {
							contactDetail = null;
						}

						// --- Infer privacy / "private number" ---
						// Kita nggak bisa lihat last-seen / status jika pemilik set privasi.
						// Kita infer:
						// - jika isRegistered === false => NOT REGISTERED
						// - jika registered tetapi no pushName AND no profilePic => kemungkinan PRIVATE / minimal info
						// - jika registered & pushName present but no profilePic => kemungkinan foto disembunyikan / belum pasang
						let privacyInference = "Tidak bisa dipastikan";
						if (!isRegistered)
							privacyInference =
								"Nomor tidak terdaftar di WhatsApp ❌";
						else {
							if (!pushName && !profilePicUrl)
								privacyInference =
									"Terdaftar, tapi tampilan publik sangat minim — kemungkinan pribadi/privat 🔒";
							else if (pushName && !profilePicUrl)
								privacyInference =
									"Terdaftar & punya nama, tapi tidak terlihat foto profil (privasi/tdk ada foto) 🕵️";
							else if (!pushName && profilePicUrl)
								privacyInference =
									"Terdaftar & punya foto, tapi tanpa nama pushName (kemungkinan terdeteksi lewat foto) 📸";
							else
								privacyInference =
									"Terdaftar & info publik terlihat normal ✅";
						}

						// --- Compose message ---
						let teks = `🔎 *Hasil Stalking (enhanced)*\n\n`;
						teks += `• *Nomor:* ${targetNumber}\n`;
						teks += `• *JID:* ${targetJid}\n`;
						teks += `• *Terdaftar di WA:* ${
							isRegistered ? "YA ✅" : "TIDAK ❌"
						}\n`;
						if (pushName)
							teks += `• *Nama (pushName):* ${pushName}\n`;
						teks += `• *Foto profil terlihat:* ${
							profilePicUrl ? "YA ✅" : "TIDAK / Privat ❌"
						}\n`;
						teks += `• *Tipe akun:* ${
							isBusiness
								? "Business"
								: isEnterprise
								? "Enterprise"
								: "Personal"
						}\n`;

						// info dari Lookup (jika ada)
						if (lookupRes && Object.keys(lookupRes).length) {
							teks += `\n• *Lookup:* ${
								lookupRes.valid
									? "Valid"
									: "Unknown / Tidak valid"
							}\n`;
							if (lookupRes.international)
								teks += `• *Format internasional:* ${lookupRes.international}\n`;
							if (lookupRes.country)
								teks += `• *Negara:* ${lookupRes.country}\n`;
							if (lookupRes.carrier)
								teks += `• *Operator / Carrier:* ${lookupRes.carrier}\n`;
							if (lookupRes.line_type)
								teks += `• *Tipe line:* ${lookupRes.line_type}\n`;
						}

						// privacy inference + notes
						teks += `\n🔐 *Privasi / Inference*\n`;
						teks += `• ${privacyInference}\n`;
						teks += `• *Catatan:* Last-seen / Status / About tidak dapat diakses jika pemilik menyetel privasi. Hasil di atas adalah best-effort inference.\n`;

						// debug-ish small raw info (owner/debug can request more)
						if (contactExistsInfo) {
							teks += `\n🧾 *Meta (wa-api):* exists=${!!contactExistsInfo.exists}`;
							if (
								typeof contactExistsInfo.isBusiness !==
								"undefined"
							)
								teks += `, isBusiness=${!!contactExistsInfo.isBusiness}`;
							if (
								typeof contactExistsInfo.isEnterprise !==
								"undefined"
							)
								teks += `, isEnterprise=${!!contactExistsInfo.isEnterprise}`;
						}

						// usage info
						teks += `\n\n📊 *Info penggunaan*\n`;
						teks += `• Sisa stalk hari ini: ${
							isExempt
								? "Unlimited (owner/admin)"
								: Math.max(0, LIMIT - u.stalk.count)
						} / ${LIMIT}\n`;
						teks += `• Reset: ${new Date(
							u.stalk.resetAt
						).toLocaleString("id-ID", {
							timeZone: "Asia/Jakarta"
						})}\n`;

						// kirim hasil (pakai foto kalau ada)
						if (profilePicUrl) {
							await sock.sendMessage(
								sender,
								{
									image: { url: profilePicUrl },
									caption: teks
								},
								{ quoted: msg }
							);
						} else {
							await sock.sendMessage(
								sender,
								{ text: teks },
								{ quoted: msg }
							);
						}

						// increment usage
						if (!isExempt) {
							u.stalk.count = (u.stalk.count || 0) + 1;
						}
						userDatabase[sender] = u;
						await saveUserDatabase(userDatabase);
					} catch (err) {
						console.error("Error pada case stalk (enhanced):", err);
						await sock.sendMessage(
							sender,
							{
								text: "❌ Gagal stalking. Mungkin ada masalah koneksi atau fitur tidak didukung di versi baileys yang kamu pakai."
							},
							{ quoted: msg }
						);
					}
				}
				break;

			case "igstalk":
			case "igstalker":
				{
					if (isGroup) {
						await sock.sendMessage(
							sender,
							{
								text: "⚠️ Fitur ini hanya bisa dipakai di chat pribadi."
							},
							{ quoted: msg }
						);
						return;
					}

					const username = args.trim();
					if (!username) {
						await sock.sendMessage(
							sender,
							{ text: `ℹ️ Gunakan: ${prefix}igstalk <username>` },
							{ quoted: msg }
						);
						return;
					}

					try {
						const LIMIT = Number(config.IGSTALK_LIMIT ?? 5); // default 5/hari

						if (!userDatabase[sender]) {
							userDatabase[sender] = {
								name: m.pushName || "Anonim",
								lastActivity: Date.now()
							};
						}

						const u = userDatabase[sender];
						if (!u.igstalk) {
							u.igstalk = {
								count: 0,
								resetAt: Date.now() + 86400000
							};
						}

						if (Date.now() > u.igstalk.resetAt) {
							u.igstalk.count = 0;
							u.igstalk.resetAt = Date.now() + 86400000;
						}

						const isExempt =
							Array.isArray(config.OWNERS) &&
							config.OWNERS.includes(formatSender);

						if (!isExempt && u.igstalk.count >= LIMIT) {
							await sock.sendMessage(
								sender,
								{
									text: `🚫 Limit harian IG Stalk (${LIMIT}) tercapai. Reset: ${new Date(
										u.igstalk.resetAt
									).toLocaleString("id-ID")}`
								},
								{ quoted: msg }
							);
							return;
						}

						await sock.sendMessage(
							sender,
							{ text: "🔎 Mengambil data Instagram..." },
							{ quoted: msg }
						);

						const res = await igstalk(username);
						if (!res) {
							await sock.sendMessage(
								sender,
								{
									text: `❌ Gagal mengambil data IG: ${username}`
								},
								{ quoted: msg }
							);
							return;
						}

						// struktur hasil sesuai request
						const result = {
							username: res.username || "-",
							fullname: res.fullname || "-",
							bio: res.bio || "-",
							profilePic: res.profilePic || "",
							posts: res.posts || "0",
							followers: res.followers || "0",
							following: res.following || "0"
						};

						// kirim ke chat dengan gambar profil
						await sock.sendMessage(
							sender,
							{
								image: { url: result.profilePic },
								caption:
									`👤 *Instagram Stalker*\n\n` +
									`• Username: ${result.username}\n` +
									`• Nama: ${result.fullname}\n` +
									`• Bio: ${result.bio}\n` +
									`• Postingan: ${result.posts}\n` +
									`• Followers: ${result.followers}\n` +
									`• Following: ${result.following}\n\n` +
									`📌 Sisa limit: ${
										isExempt
											? "Unlimited"
											: LIMIT - u.igstalk.count
									}/${LIMIT}`
							},
							{ quoted: msg }
						);

						if (!isExempt) u.igstalk.count++;
						userDatabase[sender] = u;
						await saveUserDatabase(userDatabase);
					} catch (err) {
						console.error("Error igstalk case:", err);
						await sock.sendMessage(
							sender,
							{ text: "❌ Terjadi error IG Stalk." },
							{ quoted: msg }
						);
					}
				}
				break;

			case "owner":
				if (!isOwner) {
					await sock.sendMessage(
						sender,
						{ text: config.MSG_NOT_OWNER },
						{ quoted: msg }
					);
					return;
				}

				// parsing argumen
				const [subcmd, ...restOwner] = args.split(" ");
				let targetNumber = restOwner.join(" ").trim();

				// sanitize nomor
				if (targetNumber) {
					targetNumber = targetNumber.replace(/[^0-9]/g, ""); // buang non-digit
				}

				if (subcmd === "add") {
					if (!targetNumber) {
						await sock.sendMessage(
							sender,
							{
								text: `❌ Gunakan: ${prefix}owner add <nomor>`
							},
							{ quoted: msg }
						);
						return;
					}
					if (!config.OWNERS) config.OWNERS = [];
					if (config.OWNERS.includes(targetNumber)) {
						await sock.sendMessage(
							sender,
							{
								text: `⚠️ Nomor *${targetNumber}* sudah jadi owner.`
							},
							{ quoted: msg }
						);
					} else {
						config.OWNERS.push(targetNumber);
						await saveConfig();
						await sock.sendMessage(
							sender,
							{
								text: `✅ Nomor *${targetNumber}* berhasil ditambahkan ke owner.`
							},
							{ quoted: msg }
						);
					}
				} else if (subcmd === "del") {
					if (!targetNumber) {
						await sock.sendMessage(
							sender,
							{
								text: `❌ Gunakan: ${prefix}owner del <nomor>`
							},
							{ quoted: msg }
						);
						return;
					}
					if (!config.OWNERS) config.OWNERS = [];
					if (!config.OWNERS.includes(targetNumber)) {
						await sock.sendMessage(
							sender,
							{
								text: `⚠️ Nomor *${targetNumber}* tidak ada di daftar owner.`
							},
							{ quoted: msg }
						);
					} else {
						config.OWNERS = config.OWNERS.filter(
							o => o !== targetNumber
						);
						await saveConfig();
						await sock.sendMessage(
							sender,
							{
								text: `🗑️ Nomor *${targetNumber}* berhasil dihapus dari owner.`
							},
							{ quoted: msg }
						);
					}
				} else if (!subcmd || subcmd === "list") {
					if (!config.OWNERS || config.OWNERS.length === 0) {
						await sock.sendMessage(
							sender,
							{ text: "📭 Belum ada owner yang terdaftar." },
							{ quoted: msg }
						);
					} else {
						const list = config.OWNERS.map(
							(o, i) => ` ${i + 1}. ${o}@s.whatsapp.net`
						).join("\n");
						await sock.sendMessage(
							sender,
							{ text: `👑 *Daftar Owner:*\n${list}` },
							{ quoted: msg }
						);
					}
				} else {
					await sock.sendMessage(
						sender,
						{
							text: `ℹ️ Gunakan: ${prefix}owner add/del/list <nomor>`
						},
						{ quoted: msg }
					);
				}
				break;

			case "reminder":
				if (!isGroup) {
					await sock.sendMessage(
						sender,
						{ text: "⚠️ Perintah ini hanya berlaku di grup." },
						{ quoted: msg }
					);
					return;
				}
				if (!isAdmin) {
					await sock.sendMessage(
						sender,
						{ text: "⚠️ Hanya admin grup yang bisa set reminder." },
						{ quoted: msg }
					);
					return;
				}

				if (args.toLowerCase() === "on") {
					if (!config.REMINDER) config.REMINDER = {};
					config.REMINDER[sender] = true;
					await saveConfig();

					await sock.sendMessage(
						sender,
						{
							text: "✅ Reminder sholat berhasil *diaktifkan* untuk grup ini."
						},
						{ quoted: msg }
					);
				} else if (args.toLowerCase() === "off") {
					if (!config.REMINDER) config.REMINDER = {};
					config.REMINDER[sender] = false;
					await saveConfig();

					await sock.sendMessage(
						sender,
						{
							text: "🛑 Reminder sholat berhasil *dimatikan* untuk grup ini."
						},
						{ quoted: msg }
					);
				} else {
					const status = config.REMINDER?.[sender]
						? "ON ✅"
						: "OFF 🛑";
					await sock.sendMessage(
						sender,
						{
							text: `ℹ️ Gunakan: ${prefix}reminder on/off\nStatus sekarang: ${status}`
						},
						{ quoted: msg }
					);
				}
				break;

			case "setcity":
				if (!isOwner) {
					await sock.sendMessage(
						sender,
						{ text: config.MSG_NOT_OWNER },
						{ quoted: msg }
					);
					return;
				}

				{
					const cityId = args.trim();
					if (!cityId) {
						await sock.sendMessage(
							sender,
							{
								text: `❌ Gunakan: ${prefix}setcity <id_kota>\n\nContoh: ${prefix}setcity 1632`
							},
							{ quoted: msg }
						);
						return;
					}

					if (!/^\d+$/.test(cityId)) {
						await sock.sendMessage(
							sender,
							{
								text: `⚠️ ID kota harus berupa angka, bukan huruf.\n\nContoh: ${prefix}setcity 1632`
							},
							{ quoted: msg }
						);
						return;
					}

					// reset daftar kota → hanya berisi cityId ini
					config.CITIES = [cityId];
					await saveConfig();

					await sock.sendMessage(
						sender,
						{
							text: `✅ Daftar kota berhasil di-set ke: *${cityId}*`
						},
						{ quoted: msg }
					);
				}
				break;

			case "addcity":
				if (!isOwner) {
					await sock.sendMessage(
						sender,
						{ text: config.MSG_NOT_OWNER },
						{ quoted: msg }
					);
					return;
				}

				{
					const cityId = args.trim();
					if (!cityId) {
						await sock.sendMessage(
							sender,
							{
								text: `❌ Gunakan: ${prefix}addcity <id_kota>\n\nContoh: ${prefix}addcity 1632`
							},
							{ quoted: msg }
						);
						return;
					}

					if (!/^\d+$/.test(cityId)) {
						await sock.sendMessage(
							sender,
							{
								text: `⚠️ ID kota harus berupa angka, bukan huruf.\n\nContoh: ${prefix}addcity 1632`
							},
							{ quoted: msg }
						);
						return;
					}

					if (!config.CITIES) config.CITIES = [];
					if (config.CITIES.includes(cityId)) {
						await sock.sendMessage(
							sender,
							{
								text: `⚠️ ID kota *${cityId}* sudah ada di daftar.`
							},
							{ quoted: msg }
						);
					} else {
						config.CITIES.push(cityId);
						await saveConfig();

						await sock.sendMessage(
							sender,
							{
								text: `✅ ID kota *${cityId}* berhasil ditambahkan.\n\n📌 Daftar saat ini: ${config.CITIES.join(
									", "
								)}`
							},
							{ quoted: msg }
						);
					}
				}
				break;

			case "config":
				{
					let text = `⚙️ *Konfigurasi Bot Saat Ini*\n\n`;

					text += `👑 Owner: ${config.OWNER || "-"}\n`;
					text += `🤖 Mode: ${config.MODE || "public"}\n`;
					text += `🧠 AI: ${config.AI ? "ON ✅" : "OFF 🛑"}\n`;
					text += `💬 Prefix: ${config.PREFIXES.join(" ")}\n`;
					text += `📌 Prefix Enabled: ${
						config.PREFIX_ENABLED ? "ON ✅" : "OFF 🛑"
					}\n`;
					text += `🛡️ AntiBug: ${
						config.ANTIBUG ? "ON ✅" : "OFF 🛑"
					}\n`;
					text += `🛡️ AntiVirtex: ${
						config.ANTIVIRTEX ? "ON ✅" : "OFF 🛑"
					}\n`;
					text += `🔒 Group Welcome: ${
						config.GROUP_WELCOME &&
						Object.keys(config.GROUP_WELCOME).length > 0
							? "Custom ✅"
							: "Default 🛑"
					}\n`;
					text += `🚫 AntiKudeta: ${
						config.GROUP_ANTIKUDETA &&
						Object.keys(config.GROUP_ANTIKUDETA).length > 0
							? "Custom ✅"
							: "Default 🛑"
					}\n`;
					text += `🎨 Bot Mode: ${config.BOT_MODE || "text"}\n`;

					await sock.sendMessage(sender, { text }, { quoted: msg });
				}
				break;

			case "antibug":
				if (!isOwner && !isAdmin && isGroup) {
					await sock.sendMessage(
						sender,
						{
							text: "⚠️ Fitur antibug hanya bisa dipakai Owner atau Admin grup!"
						},
						{ quoted: msg }
					);
					return;
				}

				if (args.toLowerCase() === "on") {
					config.ANTIBUG = true;
					await saveConfig();
					await sock.sendMessage(
						sender,
						{ text: "✅ Fitur *AntiBug* berhasil diaktifkan." },
						{ quoted: msg }
					);
				} else if (args.toLowerCase() === "off") {
					config.ANTIBUG = false;
					await saveConfig();
					await sock.sendMessage(
						sender,
						{ text: "🛑 Fitur *AntiBug* berhasil dimatikan." },
						{ quoted: msg }
					);
				} else {
					await sock.sendMessage(
						sender,
						{ text: `ℹ️ Gunakan: ${prefix}antibug on/off` },
						{ quoted: msg }
					);
				}
				break;

			case "antivirtex":
				if (!isOwner && !isAdmin && isGroup) {
					await sock.sendMessage(
						sender,
						{
							text: "⚠️ Fitur antivirtex hanya bisa dipakai Owner atau Admin grup!"
						},
						{ quoted: msg }
					);
					return;
				}

				if (args.toLowerCase() === "on") {
					config.ANTIVIRTEX = true;
					await saveConfig();
					await sock.sendMessage(
						sender,
						{ text: "✅ Fitur *AntiVirtex* berhasil diaktifkan." },
						{ quoted: msg }
					);
				} else if (args.toLowerCase() === "off") {
					config.ANTIVIRTEX = false;
					await saveConfig();
					await sock.sendMessage(
						sender,
						{ text: "🛑 Fitur *AntiVirtex* berhasil dimatikan." },
						{ quoted: msg }
					);
				} else {
					await sock.sendMessage(
						sender,
						{ text: `ℹ️ Gunakan: ${prefix}antivirtex on/off` },
						{ quoted: msg }
					);
				}
				break;

			case "message":
				if (!isOwner) {
					await sock.sendMessage(
						sender,
						{ text: config.MSG_NOT_OWNER },
						{ quoted: msg }
					);
					return;
				}

				{
					const [sub, type, ...rest] = args.split(" ");
					if (sub?.toLowerCase() === "set") {
						const customMsg = rest.join(" ").trim();

						if (!type) {
							// reset semua ke default
							config.MSG_NOT_GROUP =
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!";
							config.MSG_NOT_OWNER =
								"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!";
							config.MSG_PRIVATE_ONLY =
								"⚠️ Fitur ini hanya bisa dipakai di private chat!";
							config.MSG_NOT_ADMIN = "⚠️ Bot belum jadi admin!";
							await saveConfig();
							await sock.sendMessage(
								sender,
								{
									text: "✅ Semua pesan default sudah dikembalikan."
								},
								{ quoted: msg }
							);
						} else if (
							["group", "owner", "private", "admin"].includes(
								type.toLowerCase()
							)
						) {
							if (!customMsg) {
								await sock.sendMessage(
									sender,
									{
										text: `⚠️ Gunakan: ${prefix}message set <group|owner|private|admin> <custom-pesan>`
									},
									{ quoted: msg }
								);
								return;
							}

							if (type === "group")
								config.MSG_NOT_GROUP = customMsg;
							if (type === "owner")
								config.MSG_NOT_OWNER = customMsg;
							if (type === "private")
								config.MSG_PRIVATE_ONLY = customMsg;
							if (type === "admin")
								config.MSG_NOT_ADMIN = customMsg;

							await saveConfig();
							await sock.sendMessage(
								sender,
								{
									text: `✅ Pesan default untuk *${type}* berhasil diubah ke:\n\n${customMsg}`
								},
								{ quoted: msg }
							);
						} else {
							await sock.sendMessage(
								sender,
								{
									text: `⚠️ Tipe pesan tidak dikenal!\nGunakan: ${prefix}message set <group|owner|private|admin> <custom-pesan>`
								},
								{ quoted: msg }
							);
						}
					} else {
						await sock.sendMessage(
							sender,
							{
								text: `⚙️ Gunakan:\n${prefix}message set <group|owner|private|dmin> <custom-pesan>\n${prefix}message set  (untuk reset semua)`
							},
							{ quoted: msg }
						);
					}
				}
				break;

			case "group":
				if (!isGroup) {
					await sock.sendMessage(
						sender,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!"
						},
						{ quoted: msg }
					);
					return;
				}
				if (!isAdmin) {
					await sock.sendMessage(
						sender,
						{
							text: config.MSG_NOT_ADMIN
						},
						{ quoted: msg }
					);
					return;
				}

				{
					const [subcmd, valGroup] = args.split(" ");

					if (subcmd?.toLowerCase() === "set") {
						if (valGroup?.toLowerCase() === "on") {
							if (!config.GROUP_WELCOME)
								config.GROUP_WELCOME = {};
							if (config.GROUP_WELCOME[sender]) {
								await sock.sendMessage(
									sender,
									{
										text: "⚠️ Welcome/Leave udah *aktif* dari tadi bro."
									},
									{ quoted: msg }
								);
							} else {
								config.GROUP_WELCOME[sender] = true;
								await saveConfig();
								await sock.sendMessage(
									sender,
									{
										text: "✅ Welcome/Leave berhasil *diaktifkan!*"
									},
									{ quoted: msg }
								);
							}
						} else if (valGroup?.toLowerCase() === "off") {
							if (!config.GROUP_WELCOME)
								config.GROUP_WELCOME = {};
							if (!config.GROUP_WELCOME[sender]) {
								await sock.sendMessage(
									sender,
									{
										text: "⚠️ Welcome/Leave udah *nonaktif* dari tadi bro."
									},
									{ quoted: msg }
								);
							} else {
								config.GROUP_WELCOME[sender] = false;
								await saveConfig();
								await sock.sendMessage(
									sender,
									{
										text: "🛑 Welcome/Leave berhasil *dimatikan!*"
									},
									{ quoted: msg }
								);
							}
						} else if (valGroup?.toLowerCase() === "open") {
							const metadata = await sock.groupMetadata(sender);
							if (metadata.announce === false) {
								await sock.sendMessage(
									sender,
									{
										text: "⚠️ Grup udah *terbuka* dari tadi bro 😅"
									},
									{ quoted: msg }
								);
							} else {
								await sock.groupSettingUpdate(
									sender,
									"not_announcement"
								);
								await sock.sendMessage(
									sender,
									{
										text: "🔓 Grup berhasil *dibuka!* (semua anggota bisa chat)"
									},
									{ quoted: msg }
								);
							}
						} else if (valGroup?.toLowerCase() === "close") {
							const metadata = await sock.groupMetadata(sender);
							if (metadata.announce === true) {
								await sock.sendMessage(
									sender,
									{
										text: "⚠️ Grup udah *tertutup* dari tadi bro 😅"
									},
									{ quoted: msg }
								);
							} else {
								await sock.groupSettingUpdate(
									sender,
									"announcement"
								);
								await sock.sendMessage(
									sender,
									{
										text: "🔒 Grup berhasil *ditutup!* (hanya admin bisa chat)"
									},
									{ quoted: msg }
								);
							}
						} else {
							await sock.sendMessage(
								sender,
								{
									text: "ℹ️ Gunakan: group set on/off/open/close"
								},
								{ quoted: msg }
							);
						}
					} else {
						await sock.sendMessage(
							sender,
							{ text: "ℹ️ Gunakan: group set on/off/open/close" },
							{ quoted: msg }
						);
					}
				}
				break;

			case "ai":
				if (!isOwner) {
					await sock.sendMessage(
						sender,
						{
							text:
								config.MSG_NOT_OWNER ||
								"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
						},
						{ quoted: msg }
					);
					return;
				}
				if (isGroup) {
					await sock.sendMessage(
						sender,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!"
						},
						{ quoted: msg }
					);
					return;
				}

				if (args.toLowerCase() === "on") {
					if (config.AI) {
						await sock.sendMessage(
							sender,
							{
								text: "⚠️ Mode AI udah *aktif* dari tadi bro 😎"
							},
							{ quoted: msg }
						);
					} else {
						config.AI = true;
						await saveConfig();
						await sock.sendMessage(
							sender,
							{ text: "✅ Mode AI berhasil *diaktifkan!* 🤖" },
							{ quoted: msg }
						);
					}
				} else if (args.toLowerCase() === "off") {
					if (!config.AI) {
						await sock.sendMessage(
							sender,
							{
								text: "⚠️ Mode AI udah *nonaktif* dari tadi bro 💤"
							},
							{ quoted: msg }
						);
					} else {
						config.AI = false;
						await saveConfig();
						await sock.sendMessage(
							sender,
							{ text: "🛑 Mode AI berhasil *dimatikan!*" },
							{ quoted: msg }
						);
					}
				} else {
					await sock.sendMessage(
						sender,
						{
							text: `ℹ️ Gunakan: *${prefix}ai on* / *${prefix}ai off*\n\nStatus sekarang: ${
								config.AI ? "ON ✅" : "OFF 🛑"
							}`
						},
						{ quoted: msg }
					);
				}
				break;

			case "set":
				if (!isOwner) {
					await sock.sendMessage(
						sender,
						{
							text:
								config.MSG_NOT_OWNER ||
								"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
						},
						{ quoted: msg }
					);
					return;
				}
				if (isGroup) {
					await sock.sendMessage(
						sender,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!"
						},
						{ quoted: msg }
					);
					return;
				}

				{
					const [key, ...restArgs] = args.split(" ");
					const value = restArgs.join(" ").trim();

					if (!key) {
						await sock.sendMessage(
							sender,
							{
								text: "⚙️ Gunakan: set <owner/mode/prefix> <value>"
							},
							{ quoted: msg }
						);
						break;
					}

					if (key.toLowerCase() === "owner") {
						config.OWNER = value;
						await saveConfig();
						await sock.sendMessage(
							sender,
							{ text: `👑 OWNER berhasil diganti ke: ${value}` },
							{ quoted: msg }
						);
					} else if (key.toLowerCase() === "mode") {
						if (!["public", "self"].includes(value.toLowerCase())) {
							await sock.sendMessage(
								sender,
								{
									text: "❌ Mode hanya bisa 'public' atau 'self'."
								},
								{ quoted: msg }
							);
							break;
						}
						config.MODE = value.toLowerCase();
						await saveConfig();
						await sock.sendMessage(
							sender,
							{ text: `🔄 MODE diganti ke: *${value}*` },
							{ quoted: msg }
						);
					} else if (key.toLowerCase() === "prefix") {
						if (value.toLowerCase() === "on") {
							if (config.PREFIX_ENABLED) {
								await sock.sendMessage(
									sender,
									{
										text: "⚠️ Prefix mode udah *aktif* dari tadi bro."
									},
									{ quoted: msg }
								);
							} else {
								config.PREFIX_ENABLED = true;
								await saveConfig();
								await sock.sendMessage(
									sender,
									{
										text: "✅ Prefix mode berhasil *diaktifkan!*"
									},
									{ quoted: msg }
								);
							}
						} else if (value.toLowerCase() === "off") {
							if (!config.PREFIX_ENABLED) {
								await sock.sendMessage(
									sender,
									{
										text: "⚠️ Prefix mode udah *nonaktif* dari tadi bro."
									},
									{ quoted: msg }
								);
							} else {
								config.PREFIX_ENABLED = false;
								await saveConfig();
								await sock.sendMessage(
									sender,
									{
										text: "🛑 Prefix mode berhasil *dimatikan!*"
									},
									{ quoted: msg }
								);
							}
						} else {
							await sock.sendMessage(
								sender,
								{ text: "❌ Gunakan: set prefix on/off" },
								{ quoted: msg }
							);
						}
					}
				}
				break;

			case "prefix":
				if (!isOwner) {
					await sock.sendMessage(
						sender,
						{
							text:
								config.MSG_NOT_OWNER ||
								"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
						},
						{ quoted: msg }
					);
					return;
				}
				if (isGroup) {
					await sock.sendMessage(
						sender,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!"
						},
						{ quoted: msg }
					);
					return;
				}

				{
					const [sub, ...args2] = args.split(" ");
					const val = args2.join(" ").trim();

					if (sub === "add") {
						if (!val) {
							await sock.sendMessage(
								sender,
								{ text: "❌ Gunakan: prefix add <simbol>" },
								{ quoted: msg }
							);
							break;
						}
						if (!config.PREFIXES.includes(val)) {
							config.PREFIXES.push(val);
							await saveConfig();
							await sock.sendMessage(
								sender,
								{
									text: `➕ Prefix *${val}* berhasil ditambahkan.`
								},
								{ quoted: msg }
							);
						} else {
							await sock.sendMessage(
								sender,
								{
									text: `⚠️ Prefix *${val}* udah ada dari tadi bro.`
								},
								{ quoted: msg }
							);
						}
					} else if (sub === "del") {
						if (!val) {
							await sock.sendMessage(
								sender,
								{ text: "❌ Gunakan: prefix del <simbol>" },
								{ quoted: msg }
							);
							break;
						}
						if (config.PREFIXES.includes(val)) {
							config.PREFIXES = config.PREFIXES.filter(
								p => p !== val
							);
							await saveConfig();
							await sock.sendMessage(
								sender,
								{
									text: `🗑️ Prefix *${val}* berhasil dihapus.`
								},
								{ quoted: msg }
							);
						} else {
							await sock.sendMessage(
								sender,
								{
									text: `⚠️ Prefix *${val}* gak ditemukan bro.`
								},
								{ quoted: msg }
							);
						}
					} else if (sub === "list") {
						await sock.sendMessage(
							sender,
							{
								text: `📌 Prefix aktif: ${config.PREFIXES.join(
									", "
								)}`
							},
							{ quoted: msg }
						);
					} else {
						await sock.sendMessage(
							sender,
							{
								text: "ℹ️ Gunakan: prefix add/del/list <simbol>"
							},
							{ quoted: msg }
						);
					}
				}
				break;

			case "antikudet":
				if (!isGroup) {
					await sock.sendMessage(
						sender,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di grup!"
						},
						{ quoted: msg }
					);
					return;
				}
				if (!isAdmin) {
					await sock.sendMessage(
						sender,
						{
							text: "⚠️ Hanya admin grup yang bisa pakai perintah ini!"
						},
						{ quoted: msg }
					);
					return;
				}

				{
					const opt = args.toLowerCase();
					if (opt === "on") {
						if (!config.GROUP_ANTIKUDETA)
							config.GROUP_ANTIKUDETA = {};
						if (config.GROUP_ANTIKUDETA[sender]) {
							await sock.sendMessage(
								sender,
								{
									text: "⚠️ Anti-kudeta sudah aktif dari tadi bro 😅"
								},
								{ quoted: msg }
							);
						} else {
							config.GROUP_ANTIKUDETA[sender] = true;
							await saveConfig();
							await sock.sendMessage(
								sender,
								{
									text: "✅ Anti-kudeta berhasil *diaktifkan* di grup ini."
								},
								{ quoted: msg }
							);
						}
					} else if (opt === "off") {
						if (!config.GROUP_ANTIKUDETA)
							config.GROUP_ANTIKUDETA = {};
						if (!config.GROUP_ANTIKUDETA[sender]) {
							await sock.sendMessage(
								sender,
								{
									text: "⚠️ Anti-kudeta udah nonaktif dari tadi 😅"
								},
								{ quoted: msg }
							);
						} else {
							config.GROUP_ANTIKUDETA[sender] = false;
							await saveConfig();
							await sock.sendMessage(
								sender,
								{
									text: "🛑 Anti-kudeta berhasil *dimatikan* di grup ini."
								},
								{ quoted: msg }
							);
						}
					} else {
						await sock.sendMessage(
							sender,
							{
								text: `ℹ️ Gunakan: ${prefix}antikudeta on/off`
							},
							{ quoted: msg }
						);
					}
				}
				break;

			case "antitagsw":
				if (!isGroup) {
					await sock.sendMessage(
						sender,
						{ text: "⚠️ Fitur ini hanya bisa dipakai di grup!" },
						{ quoted: msg }
					);
					return;
				}
				if (!isAdmin && !isOwner) {
					await sock.sendMessage(
						sender,
						{
							text: "⚠️ Hanya admin grup atau owner yang bisa pakai perintah ini!"
						},
						{ quoted: msg }
					);
					return;
				}

				{
					const opt = args.toLowerCase();
					if (opt === "on") {
						if (!config.GROUP_ANTITAGSW)
							config.GROUP_ANTITAGSW = {};
						config.GROUP_ANTITAGSW[sender] = true;
						await saveConfig();
						await sock.sendMessage(
							sender,
							{
								text: "✅ Anti-TagSW berhasil *diaktifkan* di grup ini."
							},
							{ quoted: msg }
						);
					} else if (opt === "off") {
						if (!config.GROUP_ANTITAGSW)
							config.GROUP_ANTITAGSW = {};
						config.GROUP_ANTITAGSW[sender] = false;
						await saveConfig();
						await sock.sendMessage(
							sender,
							{
								text: "🛑 Anti-TagSW berhasil *dimatikan* di grup ini."
							},
							{ quoted: msg }
						);
					} else {
						const status = config.GROUP_ANTITAGSW?.[sender]
							? "ON ✅"
							: "OFF 🛑";
						await sock.sendMessage(
							sender,
							{
								text: `ℹ️ Gunakan: ${prefix}antitagsw on/off\nStatus sekarang: ${status}`
							},
							{ quoted: msg }
						);
					}
				}
				break;

			default:
				// === DEV TOOLS (eval & exec) ===
				if (body.startsWith("/")) {
					if (!isOwner) {
						await sock.sendMessage(
							sender,
							{ text: config.MSG_NOT_OWNER },
							{ quoted: m }
						);
						return;
					}

					try {
						const qMsg =
							m.message?.extendedTextMessage?.contextInfo
								?.quotedMessage;
						if (!qMsg) {
							await sock.sendMessage(
								sender,
								{
									text: "⚠️ Tidak ada pesan yang direply untuk dianalisa."
								},
								{ quoted: m }
							);
							return;
						}

						// stringify aman
						function safeStringify(obj, space = 2) {
							const cache = new Set();
							return JSON.stringify(
								obj,
								(key, value) => {
									if (typeof value === "function")
										return `[Function: ${
											value.name || "anonymous"
										}]`;
									if (value instanceof Buffer)
										return `<Buffer length=${value.length}>`;
									if (
										typeof value === "object" &&
										value !== null
									) {
										if (cache.has(value))
											return "[Circular]";
										cache.add(value);
									}
									return value;
								},
								space
							);
						}

						const pretty = safeStringify(qMsg, 2);

						// kalau kepanjangan → kirim sebagai file json
						if (pretty.length > 12000) {
							const fs = require("fs");
							const path = require("path");
							const filePath = path.join(
								__dirname,
								"../database/evald.json"
							);
							fs.writeFileSync(filePath, pretty);

							await sock.sendMessage(
								sender,
								{
									document: { url: filePath },
									mimetype: "application/json",
									fileName: "evald.json",
									caption:
										"📂 Quoted Message Structure (JSON)"
								},
								{ quoted: m }
							);
						} else {
							// tampilkan rapih di chat
							await sock.sendMessage(
								sender,
								{
									text: `📂 *Quoted Message Structure:*\n\n\`\`\`json\n${pretty}\n\`\`\``
								},
								{ quoted: m }
							);
						}
					} catch (e) {
						await sock.sendMessage(
							sender,
							{ text: "❌ Error:\n```" + e + "```" },
							{ quoted: m }
						);
					}
				}

				if (body.startsWith(">")) {
					if (!isOwner) {
						await sock.sendMessage(
							sender,
							{ text: config.MSG_NOT_OWNER },
							{ quoted: m }
						);
						return;
					}

					try {
						// ambil isi pesan yang di-quoted
						const qMsg =
							m.message?.extendedTextMessage?.contextInfo
								?.quotedMessage;
						let code = "";

						if (qMsg?.conversation) code = qMsg.conversation;
						else if (qMsg?.extendedTextMessage?.text)
							code = qMsg.extendedTextMessage.text;
						else if (qMsg?.imageMessage?.caption)
							code = qMsg.imageMessage.caption;
						else if (qMsg?.videoMessage?.caption)
							code = qMsg.videoMessage.caption;
						else if (qMsg?.documentMessage?.caption)
							code = qMsg.documentMessage.caption;

						if (!code.trim()) {
							await sock.sendMessage(
								sender,
								{
									text: "⚠️ Gak ada pesan yang di-reply untuk dieval."
								},
								{ quoted: m }
							);
							return;
						}

						let evaled;
						try {
							// coba eval sebagai expression
							evaled = await eval(`(async () => (${code}))()`);
						} catch {
							// fallback → eval sebagai statement
							evaled = await eval(`(async () => { ${code} })()`);
						}

						if (typeof evaled !== "string") {
							evaled = require("util").inspect(evaled, {
								depth: 2
							});
						}

						await sock.sendMessage(
							sender,
							{ text: "```" + evaled + "```" },
							{ quoted: m }
						);
					} catch (e) {
						await sock.sendMessage(
							sender,
							{ text: "```" + e + "```" },
							{ quoted: m }
						);
					}
				}

				if (body.startsWith("=>")) {
					if (!isOwner) {
						await sock.sendMessage(
							sender,
							{
								text:
									config.MSG_NOT_OWNER ||
									"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
							},
							{ quoted: m }
						);
						return;
					}
					try {
						const evaled = await eval(
							`(async () => { return ${body.slice(3)} })()`
						);
						await sock.sendMessage(
							sender,
							{ text: util.format(evaled) },
							{ quoted: m }
						);
					} catch (e) {
						await sock.sendMessage(
							sender,
							{ text: util.format(e) },
							{ quoted: m }
						);
					}
				}

				if (body.startsWith("$")) {
					if (!isOwner) {
						await sock.sendMessage(
							sender,
							{
								text:
									config.MSG_NOT_OWNER ||
									"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
							},
							{ quoted: m }
						);
						return;
					}
					exec(body.slice(1), (err, stdout, stderr) => {
						if (err)
							return sock.sendMessage(
								sender,
								{ text: util.format(err) },
								{ quoted: m }
							);
						if (stdout)
							return sock.sendMessage(
								sender,
								{ text: stdout },
								{ quoted: m }
							);
						if (stderr)
							return sock.sendMessage(
								sender,
								{ text: stderr },
								{ quoted: m }
							);
					});
				}
				break;
		}
	} catch (error) {
		console.error("Error in handlePesan:", error);
	}
}

module.exports = handlePesan;

// === AUTO RELOAD pesan.js ===
global.handlePesanBackup = handlePesan;

fs.watch(__filename, (eventType, filename) => {
	if (eventType === "change") {
		console.log(
			`[AUTO-RELOAD] Detected change in ${filename}, reloading...`
		);

		delete require.cache[require.resolve(__filename)];
		try {
			const newHandlePesan = require(__filename);
			global.handlePesan = newHandlePesan;
			console.log("[AUTO-RELOAD] pesan.js updated successfully ✅");
		} catch (err) {
			console.error("[AUTO-RELOAD] Error reloading pesan.js:", err);
			if (global.handlePesanBackup) {
				global.handlePesan = global.handlePesanBackup;
				console.log("[AUTO-RELOAD] Rolled back to previous version.");
			}
		}
	}
});
