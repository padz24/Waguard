// function/pesan.js
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");
const util = require("util");
const { exec } = require("child_process");
const { allMessageTemplate } = require("./lib/allmessage");
const {
	WA_DEFAULT_EPHEMERAL,
	generateWAMessageFromContent,
	proto
} = require("baileys-x"); // sesuaikan kalau kamu pakai package lain

const config = require("../database/config.json");
const Lookup = require("./lib/lookup");
const { Msw, Mgc } = require("./lib/messages");

// Helper simpan config
async function saveConfig() {
	const configPath = path.join(__dirname, "../database/config.json");
	await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function getAllCasesFromPesan() {
	try {
		const filePath = __filename; // otomatis baca pesan.js ini
		const fileContent = await fs.readFile(filePath, "utf8"); // ✅ pakai fs.readFile (Promise)

		const regex = /case\s+"([^"]+)":/g;
		let match;
		const commands = [];

		while ((match = regex.exec(fileContent)) !== null) {
			commands.push(match[1]);
		}

		return commands;
	} catch (err) {
		console.error("❌ Gagal membaca case dari pesan.js:", err);
		return [];
	}
}

function categorizeCommands(commands) {
	// mapping kategori
	const ownerOnly = ["ai", "set", "prefix", "botmode", "message"];
	const adminOnly = ["group", "antikudeta"];
	const categorized = {
		General: [],
		"Owner Only": [],
		"Admin Only": []
	};

	// sort alfabetis dulu
	commands.sort((a, b) => a.localeCompare(b));

	for (const cmd of commands) {
		if (ownerOnly.includes(cmd)) {
			categorized["Owner Only"].push(cmd);
		} else if (adminOnly.includes(cmd)) {
			categorized["Admin Only"].push(cmd);
		} else {
			categorized["General"].push(cmd);
		}
	}

	return categorized;
}

async function handlePesan(
	sock,
	m,
	userDatabase,
	saveUserDatabase,
	currentMode
) {
	const remoteJid = m.key.remoteJid;
	const isGroup = remoteJid.endsWith("@g.us");
	const participant = isGroup ? m.key.participant || remoteJid : remoteJid;

	// ambil nomor tanpa @
	const formatSender = participant.split("@")[0];

	// lookup nomor → negara
	const Look = await Lookup(formatSender);

	// pushName fallback ke nomor aja (biar gak dobel nama & nomor)
	const pushName = m.pushName || formatSender;

	// === quotedMsg sesuai konteks ===
	const quotedMsg = isGroup
		? await Mgc(remoteJid, formatSender, pushName, Look?.country)
		: await Msw(remoteJid, formatSender, pushName, Look?.country);

	if (!config.OWNERS) config.OWNERS = [config.OWNER].filter(Boolean);

	// === Ambil isi pesan ===
	let textMessage = "";
	if (m.message?.conversation) textMessage = m.message.conversation;
	else if (m.message?.extendedTextMessage?.text)
		textMessage = m.message.extendedTextMessage.text;
	else if (m.message?.imageMessage?.caption)
		textMessage = m.message.imageMessage.caption;
	else if (m.message?.videoMessage?.caption)
		textMessage = m.message.videoMessage.caption;
	else if (m.message?.documentMessage?.caption)
		textMessage = m.message.documentMessage.caption;
	else if (m.message?.buttonsMessage?.contentText)
		textMessage = m.message.buttonsMessage.contentText;
	else if (m.message?.buttonsResponseMessage?.selectedButtonId)
		textMessage =
			m.message.buttonsResponseMessage.selectedDisplayText ||
			m.message.buttonsResponseMessage.selectedButtonId;
	else if (m.message?.listMessage?.description)
		textMessage = m.message.listMessage.description;
	else if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId)
		textMessage =
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
			if (params.id) textMessage = params.id;
			else if (params.text) textMessage = params.text;
		} catch (e) {
			console.error("Error parsing interactive message paramsJson:", e);
		}
	} else if (m.message?.templateButtonReplyMessage?.selectedId)
		textMessage =
			m.message.templateButtonReplyMessage.selectedDisplayText ||
			m.message.templateButtonReplyMessage.selectedId;
	else if (m.message?.reactionMessage?.text)
		textMessage = m.message.reactionMessage.text;

	// ====== Command Parsing ======
	let actualCommand = "";
	let actualArgs = "";
	let usedPrefix = "";
	let isCommand = false;
	const budy = textMessage || "";
	const isOwner =
		Array.isArray(config.OWNERS) && config.OWNERS.includes(formatSender);
	const botJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";

	// ambil metadata grup kalau group
	let groupMetadata = null;
	let groupName = "";
	try {
		if (isGroup) {
			groupMetadata = await sock.groupMetadata(remoteJid);
			groupName = groupMetadata?.subject || "";
		}
	} catch (e) {
		groupMetadata = null;
		groupName = "";
	}

	const isAdmin =
		isGroup && groupMetadata?.participants
			? groupMetadata.participants.some(
					p =>
						p.jid === botJid &&
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
			if (!textMessage) continue;
			if (textMessage.toLowerCase().startsWith(p.toLowerCase())) {
				usedPrefix = p;
				const fullCommand = textMessage.slice(p.length).trim();
				actualCommand = fullCommand.split(" ")[0].toLowerCase();
				actualArgs = fullCommand.split(" ").slice(1).join(" ");
				isCommand = true;
				break;
			}
		}
	} else {
		if (textMessage && textMessage.trim() !== "") {
			actualCommand = textMessage.toLowerCase().trim().split(" ")[0];
			actualArgs = textMessage.trim().split(" ").slice(1).join(" ");
			isCommand = true;
		}
	}

	// === AI MODE (skip kalau command) ===
	if (!isCommand && config.AI === true) {
		if (m.key && m.key.fromMe) return;
		if (budy == "$" || budy == "=>" || budy == ">") return;
		if (!textMessage || textMessage.trim() === "") return;
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
					{ role: "user", content: textMessage }
				]
			);

			const replyRaw =
				response.data?.data || "😵 Waguard lagi bengong...";
			const reply = replyRaw
				.replace(/##+/g, ">")
				.replace(/\*\*(.*?)\*\*/g, "*$1*");

			await allMessageTemplate(sock, remoteJid, quotedMsg, {
				type: "text",
				text: reply
			});
		} catch (err) {
			console.error("Error call AI:", err);
			await allMessageTemplate(sock, remoteJid, quotedMsg, {
				type: "text",
				text: "😖 Aduh, Waguard lagi bad mood, coba lagi bentar yaa~"
			});
		}
		return;
	}

	logCommand(budy, formatSender, pushName, isGroup, groupName);
	// 🚨 Deteksi bug / virtex
	if (config.ANTIBUG || config.ANTIVIRTEX) {
		if (budy && typeof budy === "string") {
			// contoh filter: panjang pesan terlalu gila
			if (config.ANTIVIRTEX && budy.length > 5000) {
				await sock.sendMessage(remoteJid, {
					text: "⚠️ Pesan terdeteksi sebagai *virtex* (terlalu panjang), otomatis dihapus!"
				});
				return;
			}

			// contoh filter bug tertentu (karakter aneh / nol width / unicode rusak)
			const bugPattern = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/;
			if (config.ANTIBUG && bugPattern.test(budy)) {
				await sock.sendMessage(remoteJid, {
					text: "⚠️ Pesan terdeteksi sebagai *bug text*, diblokir otomatis!"
				});
				return;
			}
		}
	}

	// === Init database user ===
	if (!userDatabase[remoteJid]) {
		userDatabase[remoteJid] = {
			name: m.pushName || "Anonim",
			lastActivity: Date.now(),
			count: 0
		};
		await saveUserDatabase(userDatabase);
	}
	userDatabase[remoteJid].lastActivity = Date.now();
	userDatabase[remoteJid].count++;
	await saveUserDatabase(userDatabase);

	// === Commands ===
	try {
		switch (actualCommand) {
			case "menu":
				{
					const allCases = await getAllCasesFromPesan();
					const categorized = categorizeCommands(allCases);

					let menuText = `
⟡✦⟡───── 𝑴𝒊𝒅𝒏𝒊𝒈𝒉𝒕 𝑪𝒊𝒓𝒄𝒍𝒆 ─────⟡✦⟡
`;

					// General (main menu)
					if (categorized["General"]?.length > 0) {
						menuText += `
  ✧ 𝑴𝒂𝒊𝒏 𝑴𝒆𝒏𝒖\n`;
						categorized["General"].forEach((cmd, i, arr) => {
							let prefix =
								i === arr.length - 1 ? "  └─ ✦" : "  ├─ ✦";
							menuText += `${prefix} ${cmd}\n`;
						});
					}

					// Admin Only
					if (
						isGroup &&
						isAdmin &&
						categorized["Admin Only"]?.length > 0
					) {
						menuText += `
  ✧ 𝑮𝒓𝒐𝒖𝒑 𝑭𝒆𝒂𝒕𝒖𝒓𝒆𝒔\n`;
						categorized["Admin Only"].forEach((cmd, i, arr) => {
							let prefix =
								i === arr.length - 1 ? "  └─ ✦" : "  ├─ ✦";
							menuText += `${prefix} ${cmd}\n`;
						});
					}

					// Tools / Reminder
					if (categorized["Tools"]?.length > 0) {
						menuText += `
  ✧ 𝑹𝒆𝒎𝒊𝒏𝒅𝒆𝒓 & 𝑻𝒐𝒐𝒍𝒔\n`;
						categorized["Tools"].forEach((cmd, i, arr) => {
							let prefix =
								i === arr.length - 1 ? "  └─ ✦" : "  ├─ ✦";
							menuText += `${prefix} ${cmd}\n`;
						});
					}

					// Owner Only
					if (isOwner && categorized["Owner Only"]?.length > 0) {
						menuText += `
  ✧ 𝑶𝒘𝒏𝒆𝒓 𝑶𝒏𝒍𝒚\n`;
						categorized["Owner Only"].forEach((cmd, i, arr) => {
							let prefix =
								i === arr.length - 1 ? "  └─ ✦" : "  ├─ ✦";
							menuText += `${prefix} ${cmd}\n`;
						});
					}

					// Info
					menuText += `
  ✧ 𝑰𝒏𝒇𝒐
  ├─ ✦ AI Status: ${config.AI ? "𝑶𝑵 ✅" : "𝑶𝑭𝑭 🛑"}
  ├─ ✦ Mode: ${config.MODE || "public"}
  └─ ✦ Prefix: ${config.PREFIXES.join(" ")}
`;

					menuText += `
⟡✦⟡────────────────────────⟡✦⟡
`;

					await sock.sendMessage(
						remoteJid,
						{ text: menuText },
						{ quoted: quotedMsg }
					);
				}
				break;

			case "owner":
				if (!isOwner) {
					await sock.sendMessage(
						remoteJid,
						{ text: config.MSG_NOT_OWNER },
						{ quoted: quotedMsg }
					);
					return;
				}

				// parsing argumen
				const [subcmd, ...restOwner] = actualArgs.split(" ");
				let targetNumber = restOwner.join(" ").trim();

				// kalau group dan mention user
				if (
					isGroup &&
					m.message?.extendedTextMessage?.contextInfo?.mentionedJid
						?.length
				) {
					targetNumber =
						m.message.extendedTextMessage.contextInfo.mentionedJid[0].split(
							"@"
						)[0];
				}

				// sanitize nomor
				if (targetNumber) {
					targetNumber = targetNumber.replace(/[^0-9]/g, ""); // buang non-digit
				}

				if (subcmd === "add") {
					if (!targetNumber) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `❌ Gunakan: ${usedPrefix}owner add <nomor/@tag>`
							},
							{ quoted: quotedMsg }
						);
						return;
					}
					if (!config.OWNERS) config.OWNERS = [];
					if (config.OWNERS.includes(targetNumber)) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `⚠️ Nomor *${targetNumber}* sudah jadi owner.`
							},
							{ quoted: quotedMsg }
						);
					} else {
						config.OWNERS.push(targetNumber);
						await saveConfig();
						await sock.sendMessage(
							remoteJid,
							{
								text: `✅ Nomor *${targetNumber}* berhasil ditambahkan ke owner.`
							},
							{ quoted: quotedMsg }
						);
					}
				} else if (subcmd === "del") {
					if (!targetNumber) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `❌ Gunakan: ${usedPrefix}owner del <nomor/@tag>`
							},
							{ quoted: quotedMsg }
						);
						return;
					}
					if (!config.OWNERS) config.OWNERS = [];
					if (!config.OWNERS.includes(targetNumber)) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `⚠️ Nomor *${targetNumber}* tidak ada di daftar owner.`
							},
							{ quoted: quotedMsg }
						);
					} else {
						config.OWNERS = config.OWNERS.filter(
							o => o !== targetNumber
						);
						await saveConfig();
						await sock.sendMessage(
							remoteJid,
							{
								text: `🗑️ Nomor *${targetNumber}* berhasil dihapus dari owner.`
							},
							{ quoted: quotedMsg }
						);
					}
				} else if (!subcmd || subcmd === "list") {
					if (!config.OWNERS || config.OWNERS.length === 0) {
						await sock.sendMessage(
							remoteJid,
							{ text: "📭 Belum ada owner yang terdaftar." },
							{ quoted: quotedMsg }
						);
					} else {
						const list = config.OWNERS.map(
							(o, i) => ` ${i + 1}. ${o}@s.whatsapp.net`
						).join("\n");
						await sock.sendMessage(
							remoteJid,
							{ text: `👑 *Daftar Owner:*\n${list}` },
							{ quoted: quotedMsg }
						);
					}
				} else {
					await sock.sendMessage(
						remoteJid,
						{
							text: `ℹ️ Gunakan: ${usedPrefix}owner add/del/list <nomor/@tag>`
						},
						{ quoted: quotedMsg }
					);
				}
				break;

			case "reminder":
				if (!isGroup) {
					await sock.sendMessage(
						remoteJid,
						{ text: "⚠️ Perintah ini hanya berlaku di grup." },
						{ quoted: quotedMsg }
					);
					return;
				}
				if (!isAdmin) {
					await sock.sendMessage(
						remoteJid,
						{ text: "⚠️ Hanya admin grup yang bisa set reminder." },
						{ quoted: quotedMsg }
					);
					return;
				}

				if (actualArgs.toLowerCase() === "on") {
					if (!config.REMINDER) config.REMINDER = {};
					config.REMINDER[remoteJid] = true;
					await saveConfig();

					await sock.sendMessage(
						remoteJid,
						{
							text: "✅ Reminder sholat berhasil *diaktifkan* untuk grup ini."
						},
						{ quoted: quotedMsg }
					);
				} else if (actualArgs.toLowerCase() === "off") {
					if (!config.REMINDER) config.REMINDER = {};
					config.REMINDER[remoteJid] = false;
					await saveConfig();

					await sock.sendMessage(
						remoteJid,
						{
							text: "🛑 Reminder sholat berhasil *dimatikan* untuk grup ini."
						},
						{ quoted: quotedMsg }
					);
				} else {
					const status = config.REMINDER?.[remoteJid]
						? "ON ✅"
						: "OFF 🛑";
					await sock.sendMessage(
						remoteJid,
						{
							text: `ℹ️ Gunakan: ${usedPrefix}reminder on/off\nStatus sekarang: ${status}`
						},
						{ quoted: quotedMsg }
					);
				}
				break;

			case "setcity":
				if (!isOwner) {
					await sock.sendMessage(
						remoteJid,
						{ text: config.MSG_NOT_OWNER },
						{ quoted: quotedMsg }
					);
					return;
				}

				{
					const cityId = actualArgs.trim();
					if (!cityId) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `❌ Gunakan: ${usedPrefix}setcity <id_kota>\n\nContoh: ${usedPrefix}setcity 1632`
							},
							{ quoted: quotedMsg }
						);
						return;
					}

					if (!/^\d+$/.test(cityId)) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `⚠️ ID kota harus berupa angka, bukan huruf.\n\nContoh: ${usedPrefix}setcity 1632`
							},
							{ quoted: quotedMsg }
						);
						return;
					}

					// reset daftar kota → hanya berisi cityId ini
					config.CITIES = [cityId];
					await saveConfig();

					await sock.sendMessage(
						remoteJid,
						{
							text: `✅ Daftar kota berhasil di-set ke: *${cityId}*`
						},
						{ quoted: quotedMsg }
					);
				}
				break;

			case "addcity":
				if (!isOwner) {
					await sock.sendMessage(
						remoteJid,
						{ text: config.MSG_NOT_OWNER },
						{ quoted: quotedMsg }
					);
					return;
				}

				{
					const cityId = actualArgs.trim();
					if (!cityId) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `❌ Gunakan: ${usedPrefix}addcity <id_kota>\n\nContoh: ${usedPrefix}addcity 1632`
							},
							{ quoted: quotedMsg }
						);
						return;
					}

					if (!/^\d+$/.test(cityId)) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `⚠️ ID kota harus berupa angka, bukan huruf.\n\nContoh: ${usedPrefix}addcity 1632`
							},
							{ quoted: quotedMsg }
						);
						return;
					}

					if (!config.CITIES) config.CITIES = [];
					if (config.CITIES.includes(cityId)) {
						await sock.sendMessage(
							remoteJid,
							{
								text: `⚠️ ID kota *${cityId}* sudah ada di daftar.`
							},
							{ quoted: quotedMsg }
						);
					} else {
						config.CITIES.push(cityId);
						await saveConfig();

						await sock.sendMessage(
							remoteJid,
							{
								text: `✅ ID kota *${cityId}* berhasil ditambahkan.\n\n📌 Daftar saat ini: ${config.CITIES.join(
									", "
								)}`
							},
							{ quoted: quotedMsg }
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

					await sock.sendMessage(
						remoteJid,
						{ text },
						{ quoted: quotedMsg }
					);
				}
				break;

			case "antibug":
				if (!isOwner && !isAdmin && isGroup) {
					await sock.sendMessage(
						remoteJid,
						{
							text: "⚠️ Fitur antibug hanya bisa dipakai Owner atau Admin grup!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}

				if (actualArgs.toLowerCase() === "on") {
					config.ANTIBUG = true;
					await saveConfig();
					await sock.sendMessage(
						remoteJid,
						{ text: "✅ Fitur *AntiBug* berhasil diaktifkan." },
						{ quoted: quotedMsg }
					);
				} else if (actualArgs.toLowerCase() === "off") {
					config.ANTIBUG = false;
					await saveConfig();
					await sock.sendMessage(
						remoteJid,
						{ text: "🛑 Fitur *AntiBug* berhasil dimatikan." },
						{ quoted: quotedMsg }
					);
				} else {
					await sock.sendMessage(
						remoteJid,
						{ text: `ℹ️ Gunakan: ${usedPrefix}antibug on/off` },
						{ quoted: quotedMsg }
					);
				}
				break;

			case "antivirtex":
				if (!isOwner && !isAdmin && isGroup) {
					await sock.sendMessage(
						remoteJid,
						{
							text: "⚠️ Fitur antivirtex hanya bisa dipakai Owner atau Admin grup!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}

				if (actualArgs.toLowerCase() === "on") {
					config.ANTIVIRTEX = true;
					await saveConfig();
					await sock.sendMessage(
						remoteJid,
						{ text: "✅ Fitur *AntiVirtex* berhasil diaktifkan." },
						{ quoted: quotedMsg }
					);
				} else if (actualArgs.toLowerCase() === "off") {
					config.ANTIVIRTEX = false;
					await saveConfig();
					await sock.sendMessage(
						remoteJid,
						{ text: "🛑 Fitur *AntiVirtex* berhasil dimatikan." },
						{ quoted: quotedMsg }
					);
				} else {
					await sock.sendMessage(
						remoteJid,
						{ text: `ℹ️ Gunakan: ${usedPrefix}antivirtex on/off` },
						{ quoted: quotedMsg }
					);
				}
				break;

			case "message":
				if (!isOwner) {
					await sock.sendMessage(
						remoteJid,
						{ text: config.MSG_NOT_OWNER },
						{ quoted: quotedMsg }
					);
					return;
				}

				{
					const [sub, type, ...rest] = actualArgs.split(" ");
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
								remoteJid,
								{
									text: "✅ Semua pesan default sudah dikembalikan."
								},
								{ quoted: quotedMsg }
							);
						} else if (
							["group", "owner", "private", "admin"].includes(
								type.toLowerCase()
							)
						) {
							if (!customMsg) {
								await sock.sendMessage(
									remoteJid,
									{
										text: `⚠️ Gunakan: ${usedPrefix}message set <group|owner|private|admin> <custom-pesan>`
									},
									{ quoted: quotedMsg }
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
								remoteJid,
								{
									text: `✅ Pesan default untuk *${type}* berhasil diubah ke:\n\n${customMsg}`
								},
								{ quoted: quotedMsg }
							);
						} else {
							await sock.sendMessage(
								remoteJid,
								{
									text: `⚠️ Tipe pesan tidak dikenal!\nGunakan: ${usedPrefix}message set <group|owner|private|admin> <custom-pesan>`
								},
								{ quoted: quotedMsg }
							);
						}
					} else {
						await sock.sendMessage(
							remoteJid,
							{
								text: `⚙️ Gunakan:\n${usedPrefix}message set <group|owner|private|dmin> <custom-pesan>\n${usedPrefix}message set  (untuk reset semua)`
							},
							{ quoted: quotedMsg }
						);
					}
				}
				break;

			case "group":
				if (!isGroup) {
					await sock.sendMessage(
						remoteJid,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}
				if (!isAdmin) {
					await sock.sendMessage(
						remoteJid,
						{
							text: config.MSG_NOT_ADMIN
						},
						{ quoted: quotedMsg }
					);
					return;
				}

				{
					const [subcmd, valGroup] = actualArgs.split(" ");

					if (subcmd?.toLowerCase() === "set") {
						if (valGroup?.toLowerCase() === "on") {
							if (!config.GROUP_WELCOME)
								config.GROUP_WELCOME = {};
							if (config.GROUP_WELCOME[remoteJid]) {
								await sock.sendMessage(
									remoteJid,
									{
										text: "⚠️ Welcome/Leave udah *aktif* dari tadi bro."
									},
									{ quoted: quotedMsg }
								);
							} else {
								config.GROUP_WELCOME[remoteJid] = true;
								await saveConfig();
								await sock.sendMessage(
									remoteJid,
									{
										text: "✅ Welcome/Leave berhasil *diaktifkan!*"
									},
									{ quoted: quotedMsg }
								);
							}
						} else if (valGroup?.toLowerCase() === "off") {
							if (!config.GROUP_WELCOME)
								config.GROUP_WELCOME = {};
							if (!config.GROUP_WELCOME[remoteJid]) {
								await sock.sendMessage(
									remoteJid,
									{
										text: "⚠️ Welcome/Leave udah *nonaktif* dari tadi bro."
									},
									{ quoted: quotedMsg }
								);
							} else {
								config.GROUP_WELCOME[remoteJid] = false;
								await saveConfig();
								await sock.sendMessage(
									remoteJid,
									{
										text: "🛑 Welcome/Leave berhasil *dimatikan!*"
									},
									{ quoted: quotedMsg }
								);
							}
						} else if (valGroup?.toLowerCase() === "open") {
							const metadata =
								await sock.groupMetadata(remoteJid);
							if (metadata.announce === false) {
								await sock.sendMessage(
									remoteJid,
									{
										text: "⚠️ Grup udah *terbuka* dari tadi bro 😅"
									},
									{ quoted: quotedMsg }
								);
							} else {
								await sock.groupSettingUpdate(
									remoteJid,
									"not_announcement"
								);
								await sock.sendMessage(
									remoteJid,
									{
										text: "🔓 Grup berhasil *dibuka!* (semua anggota bisa chat)"
									},
									{ quoted: quotedMsg }
								);
							}
						} else if (valGroup?.toLowerCase() === "close") {
							const metadata =
								await sock.groupMetadata(remoteJid);
							if (metadata.announce === true) {
								await sock.sendMessage(
									remoteJid,
									{
										text: "⚠️ Grup udah *tertutup* dari tadi bro 😅"
									},
									{ quoted: quotedMsg }
								);
							} else {
								await sock.groupSettingUpdate(
									remoteJid,
									"announcement"
								);
								await sock.sendMessage(
									remoteJid,
									{
										text: "🔒 Grup berhasil *ditutup!* (hanya admin bisa chat)"
									},
									{ quoted: quotedMsg }
								);
							}
						} else {
							await sock.sendMessage(
								remoteJid,
								{
									text: "ℹ️ Gunakan: group set on/off/open/close"
								},
								{ quoted: quotedMsg }
							);
						}
					} else {
						await sock.sendMessage(
							remoteJid,
							{ text: "ℹ️ Gunakan: group set on/off/open/close" },
							{ quoted: quotedMsg }
						);
					}
				}
				break;

			case "ai":
				if (!isOwner) {
					await sock.sendMessage(
						remoteJid,
						{
							text:
								config.MSG_NOT_OWNER ||
								"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}
				if (isGroup) {
					await sock.sendMessage(
						remoteJid,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}

				if (actualArgs.toLowerCase() === "on") {
					if (config.AI) {
						await sock.sendMessage(
							remoteJid,
							{
								text: "⚠️ Mode AI udah *aktif* dari tadi bro 😎"
							},
							{ quoted: quotedMsg }
						);
					} else {
						config.AI = true;
						await saveConfig();
						await sock.sendMessage(
							remoteJid,
							{ text: "✅ Mode AI berhasil *diaktifkan!* 🤖" },
							{ quoted: quotedMsg }
						);
					}
				} else if (actualArgs.toLowerCase() === "off") {
					if (!config.AI) {
						await sock.sendMessage(
							remoteJid,
							{
								text: "⚠️ Mode AI udah *nonaktif* dari tadi bro 💤"
							},
							{ quoted: quotedMsg }
						);
					} else {
						config.AI = false;
						await saveConfig();
						await sock.sendMessage(
							remoteJid,
							{ text: "🛑 Mode AI berhasil *dimatikan!*" },
							{ quoted: quotedMsg }
						);
					}
				} else {
					await sock.sendMessage(
						remoteJid,
						{
							text: `ℹ️ Gunakan: *${usedPrefix}ai on* / *${usedPrefix}ai off*\n\nStatus sekarang: ${
								config.AI ? "ON ✅" : "OFF 🛑"
							}`
						},
						{ quoted: quotedMsg }
					);
				}
				break;

			case "set":
				if (!isOwner) {
					await sock.sendMessage(
						remoteJid,
						{
							text:
								config.MSG_NOT_OWNER ||
								"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}
				if (isGroup) {
					await sock.sendMessage(
						remoteJid,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}

				{
					const [key, ...restArgs] = actualArgs.split(" ");
					const value = restArgs.join(" ").trim();

					if (!key) {
						await sock.sendMessage(
							remoteJid,
							{
								text: "⚙️ Gunakan: set <owner/mode/prefix> <value>"
							},
							{ quoted: quotedMsg }
						);
						break;
					}

					if (key.toLowerCase() === "owner") {
						config.OWNER = value;
						await saveConfig();
						await sock.sendMessage(
							remoteJid,
							{ text: `👑 OWNER berhasil diganti ke: ${value}` },
							{ quoted: quotedMsg }
						);
					} else if (key.toLowerCase() === "mode") {
						if (!["public", "self"].includes(value.toLowerCase())) {
							await sock.sendMessage(
								remoteJid,
								{
									text: "❌ Mode hanya bisa 'public' atau 'self'."
								},
								{ quoted: quotedMsg }
							);
							break;
						}
						config.MODE = value.toLowerCase();
						await saveConfig();
						await sock.sendMessage(
							remoteJid,
							{ text: `🔄 MODE diganti ke: *${value}*` },
							{ quoted: quotedMsg }
						);
					} else if (key.toLowerCase() === "prefix") {
						if (value.toLowerCase() === "on") {
							if (config.PREFIX_ENABLED) {
								await sock.sendMessage(
									remoteJid,
									{
										text: "⚠️ Prefix mode udah *aktif* dari tadi bro."
									},
									{ quoted: quotedMsg }
								);
							} else {
								config.PREFIX_ENABLED = true;
								await saveConfig();
								await sock.sendMessage(
									remoteJid,
									{
										text: "✅ Prefix mode berhasil *diaktifkan!*"
									},
									{ quoted: quotedMsg }
								);
							}
						} else if (value.toLowerCase() === "off") {
							if (!config.PREFIX_ENABLED) {
								await sock.sendMessage(
									remoteJid,
									{
										text: "⚠️ Prefix mode udah *nonaktif* dari tadi bro."
									},
									{ quoted: quotedMsg }
								);
							} else {
								config.PREFIX_ENABLED = false;
								await saveConfig();
								await sock.sendMessage(
									remoteJid,
									{
										text: "🛑 Prefix mode berhasil *dimatikan!*"
									},
									{ quoted: quotedMsg }
								);
							}
						} else {
							await sock.sendMessage(
								remoteJid,
								{ text: "❌ Gunakan: set prefix on/off" },
								{ quoted: quotedMsg }
							);
						}
					}
				}
				break;

			case "prefix":
				if (!isOwner) {
					await sock.sendMessage(
						remoteJid,
						{
							text:
								config.MSG_NOT_OWNER ||
								"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}
				if (isGroup) {
					await sock.sendMessage(
						remoteJid,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di dalam grup!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}

				{
					const [sub, ...args2] = actualArgs.split(" ");
					const val = args2.join(" ").trim();

					if (sub === "add") {
						if (!val) {
							await sock.sendMessage(
								remoteJid,
								{ text: "❌ Gunakan: prefix add <simbol>" },
								{ quoted: quotedMsg }
							);
							break;
						}
						if (!config.PREFIXES.includes(val)) {
							config.PREFIXES.push(val);
							await saveConfig();
							await sock.sendMessage(
								remoteJid,
								{
									text: `➕ Prefix *${val}* berhasil ditambahkan.`
								},
								{ quoted: quotedMsg }
							);
						} else {
							await sock.sendMessage(
								remoteJid,
								{
									text: `⚠️ Prefix *${val}* udah ada dari tadi bro.`
								},
								{ quoted: quotedMsg }
							);
						}
					} else if (sub === "del") {
						if (!val) {
							await sock.sendMessage(
								remoteJid,
								{ text: "❌ Gunakan: prefix del <simbol>" },
								{ quoted: quotedMsg }
							);
							break;
						}
						if (config.PREFIXES.includes(val)) {
							config.PREFIXES = config.PREFIXES.filter(
								p => p !== val
							);
							await saveConfig();
							await sock.sendMessage(
								remoteJid,
								{
									text: `🗑️ Prefix *${val}* berhasil dihapus.`
								},
								{ quoted: quotedMsg }
							);
						} else {
							await sock.sendMessage(
								remoteJid,
								{
									text: `⚠️ Prefix *${val}* gak ditemukan bro.`
								},
								{ quoted: quotedMsg }
							);
						}
					} else if (sub === "list") {
						await sock.sendMessage(
							remoteJid,
							{
								text: `📌 Prefix aktif: ${config.PREFIXES.join(
									", "
								)}`
							},
							{ quoted: quotedMsg }
						);
					} else {
						await sock.sendMessage(
							remoteJid,
							{
								text: "ℹ️ Gunakan: prefix add/del/list <simbol>"
							},
							{ quoted: quotedMsg }
						);
					}
				}
				break;

			case "antikudet":
				if (!isGroup) {
					await sock.sendMessage(
						remoteJid,
						{
							text:
								config.MSG_NOT_GROUP ||
								"⚠️ Fitur ini hanya bisa dipakai di grup!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}
				if (!isAdmin) {
					await sock.sendMessage(
						remoteJid,
						{
							text: "⚠️ Hanya admin grup yang bisa pakai perintah ini!"
						},
						{ quoted: quotedMsg }
					);
					return;
				}

				{
					const opt = actualArgs.toLowerCase();
					if (opt === "on") {
						if (!config.GROUP_ANTIKUDETA)
							config.GROUP_ANTIKUDETA = {};
						if (config.GROUP_ANTIKUDETA[remoteJid]) {
							await sock.sendMessage(
								remoteJid,
								{
									text: "⚠️ Anti-kudeta sudah aktif dari tadi bro 😅"
								},
								{ quoted: quotedMsg }
							);
						} else {
							config.GROUP_ANTIKUDETA[remoteJid] = true;
							await saveConfig();
							await sock.sendMessage(
								remoteJid,
								{
									text: "✅ Anti-kudeta berhasil *diaktifkan* di grup ini."
								},
								{ quoted: quotedMsg }
							);
						}
					} else if (opt === "off") {
						if (!config.GROUP_ANTIKUDETA)
							config.GROUP_ANTIKUDETA = {};
						if (!config.GROUP_ANTIKUDETA[remoteJid]) {
							await sock.sendMessage(
								remoteJid,
								{
									text: "⚠️ Anti-kudeta udah nonaktif dari tadi 😅"
								},
								{ quoted: quotedMsg }
							);
						} else {
							config.GROUP_ANTIKUDETA[remoteJid] = false;
							await saveConfig();
							await sock.sendMessage(
								remoteJid,
								{
									text: "🛑 Anti-kudeta berhasil *dimatikan* di grup ini."
								},
								{ quoted: quotedMsg }
							);
						}
					} else {
						await sock.sendMessage(
							remoteJid,
							{
								text: `ℹ️ Gunakan: ${usedPrefix}antikudeta on/off`
							},
							{ quoted: quotedMsg }
						);
					}
				}
				break;

			default:
				// === DEV TOOLS (eval & exec) ===
				if (budy.startsWith("=>")) {
					if (!isOwner) {
						await sock.sendMessage(
							remoteJid,
							{
								text:
									config.MSG_NOT_OWNER ||
									"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
							},
							{ quoted: quotedMsg }
						);
						return;
					}
					try {
						const evaled = await eval(
							`(async () => { return ${budy.slice(3)} })()`
						);
						await sock.sendMessage(
							remoteJid,
							{ text: util.format(evaled) },
							{ quoted: m }
						);
					} catch (e) {
						await sock.sendMessage(
							remoteJid,
							{ text: util.format(e) },
							{ quoted: m }
						);
					}
				}

				if (budy.startsWith(">")) {
					if (!isOwner) {
						await sock.sendMessage(
							remoteJid,
							{
								text:
									config.MSG_NOT_OWNER ||
									"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
							},
							{ quoted: quotedMsg }
						);
						return;
					}
					try {
						const evaled = await eval(
							`(async () => { ${
								budy.startsWith(">>") ? "return" : ""
							} ${budy.slice(2)} })()`
						);
						await sock.sendMessage(
							remoteJid,
							{ text: util.format(evaled) },
							{ quoted: m }
						);
					} catch (e) {
						await sock.sendMessage(
							remoteJid,
							{ text: util.format(e) },
							{ quoted: m }
						);
					}
				}

				if (budy.startsWith("$")) {
					if (!isOwner) {
						await sock.sendMessage(
							remoteJid,
							{
								text:
									config.MSG_NOT_OWNER ||
									"⚠️ Fitur ini hanya bisa dipakai oleh owner bot!"
							},
							{ quoted: quotedMsg }
						);
						return;
					}
					exec(budy.slice(1), (err, stdout, stderr) => {
						if (err)
							return sock.sendMessage(
								remoteJid,
								{ text: util.format(err) },
								{ quoted: m }
							);
						if (stdout)
							return sock.sendMessage(
								remoteJid,
								{ text: stdout },
								{ quoted: m }
							);
						if (stderr)
							return sock.sendMessage(
								remoteJid,
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
