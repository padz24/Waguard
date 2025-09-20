// ./lib/allmessage.js

const {
	proto,
	generateWAMessageFromContent,
	WA_DEFAULT_EPHEMERAL
} = require("baileys-x");

async function allMessageTemplate(sock, jid, quotedMsg, options = {}) {
	/**
	 * jid: string → ID chat (private atau group)
	 * quotedMsg: message object yang dikutip (bisa null)
	 * options: konfigurasi pesan, contoh:
	 *   {
	 *     text, caption, footer,
	 *     buttons, interactiveButtons, sections, etc
	 *     image, video, product, listMessage, etc
	 *   }
	 */

	const {
		text,
		caption,
		footer,
		title,
		subtitle,
		buttons,
		interactiveButtons,
		sections,
		image,
		video,
		product,
		listMessage,
		type // misalnya 'text', 'buttons', 'interactive', etc
	} = options;

	// Menset konten pesan berdasarkan tipe
	let messageContent = {};

	if (type === "buttons") {
		// tombol dasar
		messageContent = {
			text: text || caption || "",
			footer: footer || "",
			buttons: buttons || [],
			headerType: options.headerType || 1 // bisa diatur, default 1
		};
		if (image) messageContent.image = image;
		if (video) messageContent.video = video;
	} else if (type === "interactive") {
		// Interaktif lebih maju
		messageContent = {
			text: text || caption || "",
			title: title || "",
			subtitle: subtitle || "",
			footer: footer || "",
			interactiveButtons: interactiveButtons || []
		};
		if (image) messageContent.image = image;
		if (video) messageContent.video = video;
		if (product) messageContent.product = product;
		if (sections) {
			// bisa listMessage interactive
			messageContent = {
				text: text || caption || "",
				footer: footer || "",
				title: title || "",
				buttonText: options.buttonText || "Pilih",
				sections: sections
			};
		}
	} else if (type === "list") {
		// list message
		messageContent = listMessage || {
			text: text || "",
			footer: footer || "",
			title: title || "",
			buttonText: options.buttonText || "Menu",
			sections: sections || []
		};
	} else if (type === "product") {
		// pesan product
		messageContent = {
			product: product, // product object sesuai spec baileys-x
			title: title || "",
			caption: caption || "",
			footer: footer || "",
			interactiveButtons: interactiveButtons || []
		};
	} else {
		// fallback ke teks biasa
		messageContent = { text: text || caption || "" };
	}

	// Kirim
	await sock.sendMessage(jid, messageContent, { quoted: quotedMsg || null });
}

module.exports = { allMessageTemplate };
