const {
	default: makeWASocket,
	useMultiFileAuthState,
	makeInMemoryStore,
	DisconnectReason,
	makeCacheableSignalKeyStore,
	downloadMediaMessage
} = require("baileys-x");

const pino = require("pino");
const fs = require("fs").promises;
const path = require("path");
const readline = require("readline");
const axios = require("axios");
const moment = require("moment-timezone");

// 🖼️ Banner
const banner = `
\x1b[36m
██████╗  █████╗ ██████╗ ███████╗    ██╗    ██╗ █████╗     ██████╗  ██████╗ ████████╗
██╔══██╗██╔══██╗██╔══██╗██╔════╝    ██║    ██║██╔══██╗    ██╔══██╗██╔═══██╗╚══██╔══╝
██████╔╝███████║██║  ██║█████╗      ██║ █╗ ██║███████║    ██████╔╝██║   ██║   ██║   
██╔═══╝ ██╔══██║██║  ██║██╔══╝      ██║███╗██║██╔══██║    ██╔═══╝ ██║   ██║   ██║   
██║     ██║  ██║██████╔╝███████╗    ╚███╔███╔╝██║  ██║    ██║     ╚██████╔╝   ██║   
╚═╝     ╚═╝  ╚═╝╚═════╝ ╚══════╝     ╚══╝╚══╝ ╚═╝  ╚═╝    ╚═╝      ╚═════╝    ╚═╝   
\x1b[0m
`;

// 📝 Logger with fallback
let logger;
try {
	logger = pino({
		transport: {
			target: "pino-pretty",
			options: {
				colorize: true,
				levelFirst: true,
				translateTime: "HH:MM:ss"
			}
		},
		level: "debug"
	});
} catch (e) {
	logger = pino({ level: "debug" });
	console.log("[WARN] pino-pretty not installed, using plain logger.");
}

// 📂 Path database
const USER_DATABASE_PATH = path.resolve(__dirname, "./database", "user.json");

// ✅ Load config & function
console.log(banner);
logger.info("[BOOT] Starting WhatsApp Bot...");
logger.info("[LOAD] Loading config.json...");
const config = require("./database/config.json");

logger.info("[LOAD] Loading pesan.js...");
const handlePesan = require("./function/pesan");

logger.info("[LOAD] Loading libs...");
const lookup = require("./function/lib/lookup");
const allmessage = require("./function/lib/allmessage");
const messages = require("./function/lib/messages");

logger.info("[OK] All modules and functions loaded.");

// 🌍 Global init
global.handlePesan = handlePesan;
global.handlePesanBackup = handlePesan;

// 🗂️ Hitung ukuran folder
async function getFolderSize(folderPath) {
	try {
		const files = await fs.readdir(folderPath);
		let totalSize = 0;
		for (const file of files) {
			const filePath = path.join(folderPath, file);
			const stats = await fs.stat(filePath);
			if (stats.isFile()) {
				totalSize += stats.size;
			}
		}
		return totalSize;
	} catch (error) {
		logger.error("Error calculating folder size: %o", error);
		return 0;
	}
}

// 🧹 Auto-clean session
async function cleanSessionFolder() {
	const sessionPath = path.resolve(__dirname, "./session");
	const folderSize = await getFolderSize(sessionPath);
	const threshold = 20 * 1024;

	if (folderSize >= threshold) {
		try {
			const files = await fs.readdir(sessionPath);
			let deletedCount = 0;
			for (const file of files) {
				if (file.endsWith(".json") && file !== "creds.json") {
					await fs.unlink(path.join(sessionPath, file));
					deletedCount++;
				}
			}
			if (deletedCount > 0) {
				logger.warn(
					`[AUTO-CLEAN] Deleted ${deletedCount} JSON files (size ${folderSize} bytes).`
				);
			}
		} catch (error) {
			logger.error(
				"[AUTO-CLEAN] Error cleaning session folder: %o",
				error
			);
		}
	}
}

// 📂 Load DB
async function loadUserDatabase() {
	try {
		logger.info("[DB] Loading user database...");
		const database = await fs.readFile(USER_DATABASE_PATH, "utf-8");
		logger.info("[DB] User database loaded.");
		return JSON.parse(database);
	} catch (e) {
		if (e.code === "ENOENT") {
			logger.warn("[DB] user.json not found, creating new database...");
			return {};
		}
		logger.error("[DB] Failed to load user database: %o", e);
		return {};
	}
}

// 💾 Save DB
async function saveUserDatabase(database) {
	try {
		logger.debug("[DB] Saving user database...");
		const dirPath = path.dirname(USER_DATABASE_PATH);
		try {
			await fs.access(dirPath);
		} catch {
			logger.warn("[DB] Database folder not found, creating new...");
			await fs.mkdir(dirPath, { recursive: true });
		}
		await fs.writeFile(
			USER_DATABASE_PATH,
			JSON.stringify(database, null, 2),
			"utf-8"
		);
		logger.info("[DB] User database saved successfully.");
	} catch (e) {
		logger.error("[DB] Failed to save user database: %o", e);
	}
}

async function startSholatReminder(sock) {
	setInterval(async () => {
		if (!config.CITIES || config.CITIES.length === 0) return;

		const now = moment().tz("Asia/Jakarta");
		const currentTime = now.format("HH:mm");
		const today = now.format("YYYY-MM-DD"); // format sesuai API

		for (const cityId of config.CITIES) {
			try {
				const res = await axios.get(
					`https://api.myquran.com/v2/sholat/jadwal/${cityId}/${today}`
				);

				const lokasi = res.data?.data?.lokasi;
				const daerah = res.data?.data?.daerah;
				const jadwal = res.data?.data?.jadwal;
				if (!jadwal) continue;

				const times = {
					Subuh: jadwal.subuh,
					Dzuhur: jadwal.dzuhur,
					Ashar: jadwal.ashar,
					Maghrib: jadwal.maghrib,
					Isya: jadwal.isya
				};

				for (const [sholat, waktu] of Object.entries(times)) {
					// cocokkan jam sekarang dengan jadwal
					if (currentTime === waktu) {
						for (const [gid, active] of Object.entries(
							config.REMINDER || {}
						)) {
							if (active) {
								await sock.sendMessage(gid, {
									text: `🕌 Waktunya sholat *${sholat}* untuk wilayah *${lokasi} - ${daerah}* sekarang (${waktu}).`
								});
							}
						}
					}
				}
			} catch (err) {
				console.error(
					`❌ Gagal ambil jadwal sholat untuk kota ID ${cityId}:`,
					err?.response?.data || err.message
				);
			}
		}
	}, 60 * 1000); // cek tiap 1 menit
}

// ⚡ Connect WhatsApp
async function connectToWhatsApp() {
	logger.info("[BOOT] Connecting to WhatsApp...");
	let loadData = await loadUserDatabase();

	logger.info("[AUTH] Loading session...");
	const { state, saveCreds: creds } =
		await useMultiFileAuthState("./session");

	logger.info("[SOCKET] Creating WhatsApp socket...");
	const sock = makeWASocket({
		printQRInTerminal: false,
		syncFullHistory: true,
		markOnlineOnConnect: true,
		connectTimeoutMs: 60000,
		defaultQueryTimeoutMs: 0,
		keepAliveIntervalMs: 2710,
		generateHighQualityLinkPreview: true,
		version: [2, 3000, 1023223821],
		browser: ["Ubuntu", "Chrome", "20.0.04"],
		logger,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger)
		}
	});

	// 🔐 Pairing (first login)
	if (!sock.authState.creds.registered) {
		const nomer = await prompt(
			"Please enter your WhatsApp number (62xxxx): "
		);
		const pairing = await sock.requestPairingCode(nomer, "PADZDDIL");
		logger.info("Your pairing code: " + pairing);
	}

	// Store
	const memorys = makeInMemoryStore({ logger });
	memorys.bind(sock.ev);

	// 🔌 Connection handler
	sock.ev.on("connection.update", update => {
		const { connection, lastDisconnect } = update;
		if (connection === "close") {
			const shouldReconnect =
				lastDisconnect?.error?.["output"]?.["statusCode"] !==
				DisconnectReason.loggedOut;
			logger.warn("[DISCONNECTED] Connection closed.");
			if (shouldReconnect) {
				logger.info("[RECONNECT] Trying to reconnect...");
				connectToWhatsApp();
			}
		} else if (connection === "open") {
			console.clear();
			console.log(banner);
			logger.info("[CONNECTED] WhatsApp Bot is ready 🚀");
			setInterval(cleanSessionFolder, 5 * 60 * 1000);
			startSholatReminder(sock);
		}
	});

	// 🔑 Save creds
	sock.ev.on("creds.update", creds);

	// 📨 Messages handler
	sock.ev.on("messages.upsert", async ({ messages: messh, type }) => {
		if (type === "notify") {
			for (const mssggh of messh) {
				if (!mssggh.message) continue;
				const idgc = mssggh.key.remoteJid.endsWith("@g.us");
				if (config.MODE === "self" && idgc) continue;

				logger.debug("[MSG] New message received.");
				await global.handlePesan(
					sock,
					mssggh,
					loadData,
					saveUserDatabase,
					config.MODE
				);
			}
		}
	});
}

// 📥 Prompt
function prompt(isidalam) {
	const isiluar = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	return new Promise(resolve =>
		isiluar.question(isidalam, ans => {
			isiluar.close();
			resolve(ans.trim());
		})
	);
}

// 🚀 Start
connectToWhatsApp();
