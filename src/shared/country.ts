/** Country identifiers come from the platform ICU data, never the device language/time zone. */
const countryNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const chineseNames = new Intl.DisplayNames(['zh-CN'], { type: 'region', fallback: 'none' });
// Current ISO alpha-2 codes only: ICU also accepts retired aliases (e.g. DD -> Germany).
const COUNTRIES = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' '
  )
);

export function normalizeCountryCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  if (!COUNTRIES.has(code)) return undefined;
  return countryNames.of(code) ? code.toLowerCase() : undefined;
}

/** IPIP returns Chinese country names; resolve all recognized countries, including HK/MO/TW. */
export function countryFromChineseLocation(location: readonly string[]): string | undefined {
  if (location[0] === '中国') {
    const territory = { 香港: 'hk', 澳门: 'mo', 台湾: 'tw' }[location[1]];
    return territory ?? 'cn';
  }
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (normalizeCountryCode(code) && chineseNames.of(code) === location[0])
        return code.toLowerCase();
    }
  }
  return undefined;
}
