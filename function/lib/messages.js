// function/lib/messages.js
// Membuat fake quoted contact message (vcard) untuk dijadikan quoted saat reply

function makeVCard(name, region, sender) {
	// sender: nomor tanpa @
	// waid harus hanya nomor (contoh: 6281234567890)
	// format TEL: TEL;type=CELL;type=VOICE;waid=<waid>:<formatted>
	const waid = sender.replace(/[^0-9]/g, "");
	const vcard =
		"BEGIN:VCARD\n" +
		"VERSION:3.0\n" +
		`FN:${name}\n` +
		`ORG:${region};\n` +
		`TEL;type=CELL;type=VOICE;waid=${waid}:${waid}\n` +
		"END:VCARD";
	return vcard;
}

async function Msw(sendr, sender, name, region) {
	const vcard = makeVCard(name, region, sender);
	const fakeId = `${Date.now()}`;

	const quoted = {
		key: {
			remoteJid: "status@broadcast", // ✅ langsung ke jid user
			fromMe: false,
			id: fakeId,
			participant: `${sender}@s.whatsapp.net`
		},
		message: {
			contactMessage: {
				displayName: name,
				vcard,
				contacts: [{ vcard }]
			}
		}
	};

	return quoted;
}

async function Mgc(sendr, sender, name, region) {
	const vcard = makeVCard(name, region, sender);
	const fakeId = `${Date.now()}`;

	const quoted = {
		key: {
			remoteJid: "1234567890@g.us",
			fromMe: false,
			id: fakeId,
			participant: sendr.endsWith("@g.us")
				? `${sender}@s.whatsapp.net`
				: undefined
		},
		message: {
			contactMessage: {
				displayName: name,
				vcard,
				contacts: [{ vcard }]
			}
		}
	};

	return quoted;
}

module.exports = { Msw, Mgc };
