const { parsePhoneNumberFromString } = require("libphonenumber-js");

async function Lookup(nomer) {
	const pn = parsePhoneNumberFromString(`+${nomer}`);
	if (pn && pn.isValid()) {
		return {
			valid: true,
			international: pn.formatNational(),
			country: pn.country
		};
	} else {
		return { valid: false };
	}
}

module.exports = Lookup;
