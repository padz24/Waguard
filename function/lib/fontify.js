// lib/fontify.js

const SCRIPT_FIX = {
	A: "𝓐",
	B: "𝓑",
	C: "𝓒",
	D: "𝓓",
	G: "𝓖",
	J: "𝓙",
	K: "𝓚",
	N: "𝓝",
	Q: "𝓠",
	S: "𝓢",
	T: "𝓣",
	U: "𝓤",
	V: "𝓥",
	W: "𝓦",
	X: "𝓧",
	Y: "𝓨",
	Z: "𝓩"
};

function fromCodePoint(cp) {
	return String.fromCodePoint(cp);
}

const STYLES = {
	bold: {
		upper: 0x1d400,
		lower: 0x1d41a
	},
	italic: {
		upper: 0x1d434,
		lower: 0x1d44e
	},
	bolditalic: {
		upper: 0x1d468,
		lower: 0x1d482
	},
	script: {
		upper: 0x1d49c,
		lower: 0x1d4b6
	},
	circled: {
		upper: 0x24b6,
		lower: 0x24d0,
		digitStart: 0x2460 // ①
	}
};

function isPrintable(cp) {
	return cp >= 0x20 && cp <= 0x10ffff;
}

function mapChar(ch, style) {
	if (!ch) return ch;

	// digits
	if (/\d/.test(ch)) {
		if (style === "circled") {
			const n = Number(ch);
			if (n >= 1 && n <= 20) {
				const cp = STYLES.circled.digitStart + (n - 1);
				if (isPrintable(cp)) return fromCodePoint(cp);
			}
		}
		return ch;
	}

	// uppercase
	if (ch >= "A" && ch <= "Z") {
		// fallback fix khusus script
		if (style === "script" && SCRIPT_FIX[ch]) {
			return SCRIPT_FIX[ch];
		}

		const idx = ch.charCodeAt(0) - 65;
		const def = STYLES[style];
		if (def?.upper) {
			const cp = def.upper + idx;
			if (isPrintable(cp)) return fromCodePoint(cp);
		}
		return ch;
	}

	// lowercase
	if (ch >= "a" && ch <= "z") {
		const idx = ch.charCodeAt(0) - 97;
		const def = STYLES[style];
		if (def?.lower) {
			const cp = def.lower + idx;
			if (isPrintable(cp)) return fromCodePoint(cp);
		}
		return ch;
	}

	return ch;
}

function fontify(text, style = "script") {
	if (typeof text !== "string") return text;
	style = style.toLowerCase();
	if (!STYLES[style]) style = "script";

	let out = "";
	for (const char of text) {
		out += mapChar(char, style);
	}
	return out;
}

module.exports = { fontify, STYLES };
