// Numbers in everyday words for the big explanation card, in English and Vietnamese (Role 1, card agent).
// Pure: no browser or core imports, no randomness. Gravity is passed in as g0, never written here.
//
// Each comparison divides a part's number by the number of something familiar (REFS, with where each figure comes
// from) and says how many of those things it is: "as heavy as 3 family cars", "fails about 1 time in 50 flights".
// Thrust is a force, so it is compared with a weight: F / g0 is the mass whose weight on Earth equals the push
// (F = m · g0). "Pushes as hard as the weight of 68 family cars" is exact for 68 × 1,500 kg × g0 ≈ 1,000 kN.
// Pressure (kPa) is compared the same way: kPa × 1,000 / g0 is the mass resting on each square metre.

/** Familiar things and their sizes. `v` is in the unit of the list; `real` says where the number comes from. */
export const REFS = Object.freeze({
  mass: [ // kg
    { id: 'sugar', v: 1, en: ['bag of sugar', 'bags of sugar'], vi: 'túi đường 1 kg', real: 'a 1 kg bag' },
    { id: 'adult', v: 70, en: ['grown-up', 'grown-ups'], vi: 'người lớn', real: 'the ICRP reference adult, 70 kg' },
    { id: 'car', v: 1500, en: ['family car', 'family cars'], vi: 'chiếc ô tô gia đình', real: 'a mid-size saloon, about 1.5 t empty (Toyota Camry 2024: 1,555–1,640 kg)' },
    { id: 'bus', v: 12000, en: ['city bus', 'city buses'], vi: 'chiếc xe buýt', real: 'a 12 m single-deck city bus, 11–13 t empty' },
    { id: 'truck', v: 40000, en: ['fully loaded truck', 'fully loaded trucks'], vi: 'chiếc xe tải chở đầy hàng', real: 'EU limit for a five-axle articulated lorry: 40 t' },
    { id: 'whale', v: 150000, en: ['blue whale', 'blue whales'], vi: 'con cá voi xanh', real: 'a large adult blue whale, 100–150 t (NOAA Fisheries)' },
    { id: 'jumbo', v: 400000, en: ['fully loaded jumbo jet', 'fully loaded jumbo jets'], vi: 'chiếc Boeing 747 chở đầy', real: 'Boeing 747-400 maximum take-off weight 396,890 kg (Boeing)' },
  ],
  power: [ // W
    { id: 'led', v: 10, en: ['LED bulb', 'LED bulbs'], vi: 'bóng đèn LED', real: 'a 60 W-equivalent LED bulb draws 8–10 W (US Department of Energy)' },
    { id: 'laptop', v: 60, en: ['laptop', 'laptops'], vi: 'máy tính xách tay', real: 'a laptop charger, 45–65 W' },
    { id: 'kettle', v: 2000, en: ['electric kettle', 'electric kettles'], vi: 'ấm siêu tốc', real: 'an electric kettle, 1.5–3 kW' },
  ],
  price: [ // US dollars
    { id: 'phone', v: 1000, en: ['top-end smartphone', 'top-end smartphones'], vi: 'chiếc điện thoại cao cấp', real: 'flagship phones, about $1,000' },
    { id: 'car', v: 30000, en: ['new family car', 'new family cars'], vi: 'chiếc ô tô gia đình mới', real: 'a new mid-size saloon, about $30,000 (Toyota Camry 2025 from $28,400)' },
    { id: 'house', v: 400000, en: ['house', 'houses'], vi: 'căn nhà', real: 'US median existing-home price 2024, about $410,000 (National Association of Realtors)' },
  ],
  area: [ // m²
    { id: 'parking', v: 12.5, en: ['parking space', 'parking spaces'], vi: 'chỗ đỗ ô tô', real: 'a 2.5 m × 5 m parking bay' },
    { id: 'classroom', v: 60, en: ['classroom', 'classrooms'], vi: 'phòng học', real: 'a school classroom, about 60 m²' },
    { id: 'tennis', v: 261, en: ['tennis court', 'tennis courts'], vi: 'sân quần vợt', real: 'a doubles court, 23.77 m × 10.97 m = 261 m² (ITF)' },
    { id: 'football', v: 7140, en: ['football pitch', 'football pitches'], vi: 'sân bóng đá', real: 'the FIFA pitch, 105 m × 68 m = 7,140 m²' },
  ],
  heat: [ // °C, what a skin or part survives
    { v: 100, en: 'boiling water', vi: 'nước sôi', real: 'water boils at 100 °C at sea level' },
    { v: 250, en: 'a kitchen oven at full heat', vi: 'lò nướng trong bếp ở mức nóng nhất', real: 'domestic ovens top out near 250 °C' },
    { v: 450, en: 'a wood-fired pizza oven', vi: 'lò nướng pizza đốt củi', real: 'wood-fired pizza ovens run at 400–500 °C' },
    { v: 660, en: 'melting aluminium', vi: 'nhôm nóng chảy', real: 'aluminium melts at 660 °C' },
    { v: 1100, en: 'flowing lava', vi: 'dung nham núi lửa', real: 'basalt lava erupts at 1,100–1,200 °C (USGS)' },
    { v: 1450, en: 'melting steel', vi: 'thép nóng chảy', real: 'carbon steel melts at 1,425–1,540 °C' },
  ],
  personHeight: 1.7, // m, an adult
  storey: 3, // m, floor to floor in a block of flats
  truckWidth: 2.5, // m, the road limit for a lorry in most countries (EU 2.55 m)
  speedOfSound: 343, // m/s, dry air at 20 °C
});

const SEP = { en: { group: ',', dec: '.' }, vi: { group: '.', dec: ',' } };
const L = (lang) => (lang === 'vi' ? 'vi' : 'en');

/** A number with the language's separators (1,234.5 in English, 1.234,5 in Vietnamese), trailing zeros dropped. */
export function num(x, lang = 'en', digits = 0) {
  if (!Number.isFinite(x)) return '—';
  const sep = SEP[L(lang)];
  const [int, frac = ''] = Math.abs(x).toFixed(digits).split('.');
  const f = frac.replace(/0+$/, '');
  const neg = x < 0 && Number(`${int}.${frac || 0}`) !== 0;
  return `${neg ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group)}${f ? sep.dec + f : ''}`;
}

/** A count rounded the way people say it: about one, 1.5, 2.5, 7, 40, 120. */
export function niceCount(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 1.25) return 1;
  if (n < 3) return Math.round(n * 2) / 2;
  if (n < 20) return Math.round(n);
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

/** The familiar thing that makes the nicest count for a value: the biggest one that still fits 0.8 times or more. */
export function pickRef(list, value) {
  const fits = list.filter((r) => value / r.v >= 0.8);
  const ref = fits.length ? fits[fits.length - 1] : list[0];
  return { ref, n: value / ref.v, less: !fits.length };
}

/** "3 family cars" / "3 chiếc ô tô gia đình"; "about one family car" below 1.25. */
export function countPhrase(ref, n, lang = 'en') {
  const c = niceCount(n);
  if (L(lang) === 'vi') return `${n < 1.25 ? 'khoảng ' : ''}${num(c, 'vi', 1)} ${ref.vi}`;
  const [one, many] = ref.en;
  if (n < 1.25) return `about one ${one}`;
  return `${num(c, 'en', 1)} ${c === 1 ? one : many}`;
}

// ---------- the numbers themselves, in each language's units ----------
/** A mass rounded the way massValue shows it (1 kg, 0.1 t, or 1 t above 100 t), so differences match the screen. */
export function massShown(kg) {
  const a = Math.abs(kg);
  const step = a >= 100000 ? 1000 : a >= 1000 ? 100 : 1;
  return Math.round(kg / step) * step;
}
export function massValue(kg, lang = 'en') {
  if (!Number.isFinite(kg)) return '—';
  const vi = L(lang) === 'vi';
  const k = massShown(kg);
  if (Math.abs(k) >= 1000) return `${num(k / 1000, lang, Math.abs(k) >= 100000 ? 0 : 1)} ${vi ? 'tấn' : 't'}`;
  return `${num(k, lang)} kg`;
}
/** Money rounded the way moneyValue shows it ($850, $1.5k, $263k, $1.18M, $1.2B), so differences match the screen. */
export function moneyShown(usd) {
  const a = Math.abs(usd);
  const step = a >= 1e9 ? 1e7 : a >= 1e6 ? 1e4 : a >= 1e4 ? 1e3 : a >= 1e3 ? 100 : 1;
  return Math.round(usd / step) * step;
}
export function moneyValue(usd, lang = 'en') {
  if (!Number.isFinite(usd)) return '—';
  const r = moneyShown(usd);
  const a = Math.abs(r), sign = r < 0 ? '−' : '';
  const vi = L(lang) === 'vi';
  const $ = `${sign}$`;
  if (a >= 1e9) return vi ? `${$}${num(a / 1e9, 'vi', 2)} tỷ` : `${$}${num(a / 1e9, 'en', 2)}B`;
  if (a >= 1e6) return vi ? `${$}${num(a / 1e6, 'vi', 2)} triệu` : `${$}${num(a / 1e6, 'en', 2)}M`;
  if (a >= 1e3) return vi ? `${$}${num(a / 1e3, 'vi', a < 1e4 ? 1 : 0)} nghìn` : `${$}${num(a / 1e3, 'en', a < 1e4 ? 1 : 0)}k`;
  return `${$}${num(a, lang)}`;
}
export const kNValue = (newtons, lang = 'en') => `${num(newtons / 1000, lang)} kN`;
/** Exhaust speed from Isp (v = Isp · g0), in km/s with one decimal. */
export const exhaustValue = (isp, g0, lang = 'en') => `${((isp * g0) / 1000).toFixed(1).replace('.', SEP[L(lang)].dec)} km/s`;
export const metres = (m, lang = 'en') => `${num(m, lang, m < 10 ? 2 : 1)} m`;
export const pctValue = (x, lang = 'en', digits = 0) => `${num(x * 100, lang, digits)} %`;
export const secondsValue = (s, lang = 'en') => `${num(s, lang)} ${L(lang) === 'vi' ? 'giây' : 's'}`;

/** "2 min 7 s" / "2 phút 7 giây". */
export function durationValue(s, lang = 'en') {
  const vi = L(lang) === 'vi';
  const t = Math.round(s), m = Math.floor(t / 60), r = t % 60;
  if (!m) return vi ? `${r} giây` : `${r} s`;
  return vi ? `${m} phút${r ? ` ${r} giây` : ''}` : `${m} min${r ? ` ${r} s` : ''}`;
}

// ---------- one number in words ----------
/** "As heavy as 3 family cars." */
export function massWords(kg, lang = 'en') {
  if (!(kg > 0)) return '';
  const { ref, n, less } = pickRef(REFS.mass, kg);
  if (L(lang) === 'vi') return less ? `Nhẹ hơn một ${ref.vi}.` : `Nặng bằng ${countPhrase(ref, n, 'vi')}.`;
  return less ? `Lighter than a ${ref.en[0]}.` : `As heavy as ${countPhrase(ref, n, 'en')}.`;
}

/** The push compared with the weight of familiar things on Earth: thrust / g0 is the mass it could hold up. */
export function thrustWords(newtons, g0, lang = 'en') {
  if (!(newtons > 0) || !(g0 > 0)) return '';
  const kg = newtons / g0;
  const { ref, n } = pickRef(REFS.mass, kg);
  const held = massValue(kg, lang);
  if (L(lang) === 'vi') return `Đẩy mạnh bằng sức nặng của ${countPhrase(ref, n, 'vi')} trên Trái Đất: đủ giữ ${held} lơ lửng.`;
  return `Pushes as hard as the weight of ${countPhrase(ref, n, 'en')} on Earth: enough to hold ${held} in the air.`;
}

/** Exhaust speed from Isp: v = Isp · g0. */
export function exhaustWords(isp, g0, lang = 'en') {
  if (!(isp > 0) || !(g0 > 0)) return '';
  const v = isp * g0;
  const k = (v / 1000).toFixed(1).replace('.', SEP[L(lang)].dec), times = num(niceCount(v / REFS.speedOfSound), lang, 1);
  if (L(lang) === 'vi') return `Khí phụt ra với tốc độ ${k} km/s, gấp khoảng ${times} lần tốc độ âm thanh.`;
  return `The gas leaves at ${k} km/s, about ${times} times the speed of sound.`;
}

/** "Enough to run 2 laptops." */
export function powerWords(watts, lang = 'en') {
  if (!(watts > 0)) return '';
  const { ref, n, less } = pickRef(REFS.power, watts);
  if (L(lang) === 'vi') return less ? `Ít hơn một ${ref.vi}.` : `Đủ cho ${countPhrase(ref, n, 'vi')} chạy cùng lúc.`;
  return less ? `Less than one ${ref.en[0]} uses.` : `Enough to run ${countPhrase(ref, n, 'en')} at once.`;
}

/** "The price of 40 new family cars. That is 24 % of the $5M you have." */
export function priceWords(usd, { budget = null, lang = 'en' } = {}) {
  if (!(usd > 0)) return L(lang) === 'vi' ? 'Miễn phí.' : 'Free.';
  const { ref, n, less } = pickRef(REFS.price, usd);
  const vi = L(lang) === 'vi';
  let s = vi ? (less ? `Rẻ hơn một ${ref.vi}.` : `Bằng giá ${countPhrase(ref, n, 'vi')}.`) : (less ? `Less than a ${ref.en[0]}.` : `The price of ${countPhrase(ref, n, 'en')}.`);
  if (budget > 0) {
    const share = usd / budget;
    const money = moneyValue(budget, lang);
    if (share > 1) s += vi ? ` Nhiều hơn tất cả số tiền bạn đang có (${money}).` : ` More than all the money you have (${money}).`;
    else if (share < 0.01) s += vi ? ` Chưa tới 1 % số tiền bạn đang có (${money}).` : ` Less than 1 % of the ${money} you have.`;
    else s += vi ? ` Bằng ${num(share * 100, 'vi')} % số tiền bạn đang có (${money}).` : ` That is ${num(share * 100, 'en')} % of the ${money} you have.`;
  }
  return s;
}

/** "As big as 3 tennis courts." */
export function areaWords(m2, lang = 'en') {
  if (!(m2 > 0)) return '';
  const { ref, n, less } = pickRef(REFS.area, m2);
  if (L(lang) === 'vi') return less ? `Nhỏ hơn một ${ref.vi}.` : `Rộng bằng ${countPhrase(ref, n, 'vi')}.`;
  return less ? `Smaller than a ${ref.en[0]}.` : `As big as ${countPhrase(ref, n, 'en')}.`;
}

/** Height and width together: "About as tall as a grown-up and as wide as a truck." */
export function sizeWords({ height = 0, diameter = 0 } = {}, lang = 'en') {
  const vi = L(lang) === 'vi';
  const parts = [];
  if (height > 0) {
    if (height < 2.6) {
      const n = height / REFS.personHeight;
      if (n < 0.75) parts.push(vi ? 'thấp hơn một người lớn' : 'shorter than a grown-up');
      else if (n < 1.25) parts.push(vi ? 'cao cỡ một người lớn' : 'about as tall as a grown-up');
      else parts.push(vi ? `cao gấp ${num(niceCount(n), 'vi', 1)} lần một người lớn` : `${num(niceCount(n), 'en', 1)} times as tall as a grown-up`);
    } else {
      const floors = Math.max(1, Math.round(height / REFS.storey));
      if (floors === 1) parts.push(vi ? 'cao cỡ một căn nhà một tầng' : 'about as tall as a one-storey house');
      else parts.push(vi ? `cao bằng tòa nhà ${floors} tầng` : `as tall as a ${floors}-storey building`);
    }
  }
  if (diameter > 0) {
    const r = diameter / REFS.truckWidth;
    if (r < 0.85) parts.push(vi ? 'hẹp hơn chiều ngang một chiếc xe tải' : 'narrower than a truck is wide');
    else if (r <= 1.15) parts.push(vi ? 'rộng cỡ chiều ngang một chiếc xe tải' : 'about as wide as a truck');
    else parts.push(vi ? `rộng gấp ${num(r, 'vi', 1)} lần chiều ngang một chiếc xe tải` : `${num(r, 'en', 1)} times as wide as a truck`);
  }
  if (!parts.length) return '';
  const s = parts.join(vi ? ', ' : ' and ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

/** "1 in 50": how many flights per failure, rounded the way people say it. Infinity when it never fails. */
export function flightsPerFailure(r) {
  const f = 1 - r;
  if (!(f > 1e-6)) return Infinity;
  const n = 1 / f;
  if (n < 100) return Math.max(1, Math.round(n));
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

/** "Fails about 1 time in 50 flights." */
export function reliabilityWords(r, lang = 'en') {
  if (!Number.isFinite(r)) return '';
  const n = flightsPerFailure(r);
  if (L(lang) === 'vi') return n === Infinity ? 'Gần như không bao giờ hỏng.' : `Cứ khoảng ${num(n, 'vi')} chuyến bay thì hỏng 1 lần.`;
  return n === Infinity ? 'Almost never fails.' : `Fails about 1 time in ${num(n, 'en')} flights.`;
}

/** What a heat limit means: "More than boiling water (100 °C), less than a kitchen oven at full heat (250 °C)." */
export function heatWords(tempC, lang = 'en') {
  if (!Number.isFinite(tempC)) return '';
  const vi = L(lang) === 'vi';
  const list = REFS.heat;
  const below = list.filter((x) => x.v <= tempC).at(-1);
  const above = list.find((x) => x.v > tempC);
  const deg = (x) => `${num(x.v, lang)} °C`;
  if (!below) return vi ? `Không chịu được nóng bằng ${above.vi} (${deg(above)}).` : `Cannot take the heat of ${above.en} (${deg(above)}).`;
  if (!above) return vi ? `Chịu được nóng hơn cả ${below.vi} (${deg(below)}).` : `Survives more heat than even ${below.en} (${deg(below)}).`;
  return vi ? `Chịu được nóng hơn ${below.vi} (${deg(below)}), nhưng không bằng ${above.vi} (${deg(above)}).` : `Survives more heat than ${below.en} (${deg(below)}), but not ${above.en} (${deg(above)}).`;
}

/** A pressure as the weight resting on every square metre: kPa × 1000 / g0 kilograms per m². */
export function pressureWords(kPa, g0, lang = 'en') {
  if (!(kPa > 0) || !(g0 > 0)) return '';
  const kg = (kPa * 1000) / g0;
  const { ref, n } = pickRef(REFS.mass, kg);
  if (L(lang) === 'vi') return `Như sức nặng của ${countPhrase(ref, n, 'vi')} đè lên mỗi mét vuông.`;
  return `Like the weight of ${countPhrase(ref, n, 'en')} pressing on every square metre.`;
}

// ---------- the card's number lines ----------
const LABELS = {
  mass: { en: 'Weight', vi: 'Khối lượng' },
  dry: { en: 'Weight when empty', vi: 'Khối lượng khi rỗng' },
  propellant: { en: 'Propellant it holds', vi: 'Nhiên liệu chứa được' },
  wet: { en: 'Weight when full', vi: 'Khối lượng khi đầy' },
  thrust: { en: 'Push (thrust) at sea level', vi: 'Lực đẩy ở mặt đất' },
  exhaust: { en: 'Exhaust speed in space', vi: 'Tốc độ khí phụt ngoài không gian' },
  burn: { en: 'Burn time', vi: 'Thời gian cháy' },
  power: { en: 'Electric power', vi: 'Công suất điện' },
  chute: { en: 'Parachute drag area', vi: 'Diện tích cản của dù' },
  size: { en: 'Size (tall × wide)', vi: 'Kích thước (cao × rộng)' },
  height: { en: 'Height', vi: 'Chiều cao' },
  holdFee: { en: 'A day of waiting', vi: 'Chờ thêm một ngày' },
  climate: { en: 'Usual temperature', vi: 'Nhiệt độ thường gặp' },
  reliability: { en: 'Reliability', vi: 'Độ tin cậy' },
  price: { en: 'Price', vi: 'Giá' },
  heat: { en: 'Takes heat up to', vi: 'Chịu nhiệt tới' },
  strength: { en: 'Air pressure it takes', vi: 'Áp lực gió chịu được' },
  areal: { en: 'Weight of one square metre', vi: 'Khối lượng mỗi mét vuông' },
  fee: { en: 'Fee', vi: 'Phí' },
  kitFee: { en: 'Launch fees with its own equipment', vi: 'Phí phóng, gồm cả thiết bị' },
  feeNow: { en: 'Launch fees as set up now', vi: 'Phí phóng theo thiết bị đang chọn' },
  heatHere: { en: 'Engine fire the pad takes here', vi: 'Sức lửa bệ chịu được ở đây' },
  forecast: { en: 'Forecast for launch day', vi: 'Dự báo hôm phóng' },
  catch: { en: 'Bad engines it catches', vi: 'Động cơ hỏng bắt được' },
  padRel: { en: 'Whole-ship reliability', vi: 'Độ tin cậy cả tàu' },
  tempC: { en: 'Temperature on the day', vi: 'Nhiệt độ hôm phóng' },
  heatLimit: { en: 'Engine fire it can take', vi: 'Sức lửa động cơ chịu được' },
};
/** Short meanings of the less obvious words, shown under the number (the content agent's term: entries win). */
export const MEANINGS = {
  heatLimit: { en: 'How much engine push the pad takes at liftoff. A stronger ship must hold its engines back, or the pad and the engines get hurt.', vi: 'Bệ chịu được lực đẩy động cơ tới mức nào lúc cất cánh. Tàu mạnh hơn thế thì phải giảm ga, nếu không bệ và động cơ sẽ bị hỏng.' },
  thrust: { en: 'How hard the engines push. To leave the pad, the push must be bigger than the weight of the whole ship.', vi: 'Sức đẩy của động cơ. Muốn rời bệ, lực đẩy phải lớn hơn sức nặng của cả con tàu.' },
  exhaust: { en: 'The faster the gas leaves, the further each kilogram of propellant takes the ship.', vi: 'Khí phụt ra càng nhanh thì mỗi ký nhiên liệu đưa tàu đi càng xa.' },
  reliability: { en: 'The chance it does its job on one flight.', vi: 'Khả năng nó làm đúng việc của mình trong một chuyến bay.' },
  power: { en: 'Electricity for the computers, radios and life support.', vi: 'Điện cho máy tính, radio và hệ thống duy trì sự sống.' },
  chute: { en: 'The bigger the drag area, the slower the capsule falls.', vi: 'Diện tích cản càng lớn thì khoang rơi càng chậm.' },
  propellant: { en: 'Fuel and the oxygen to burn it. Space has no air, so the rocket carries both.', vi: 'Nhiên liệu và chất oxy hóa để đốt nó. Ngoài không gian không có không khí nên tên lửa phải mang theo cả hai.' },
  strength: { en: 'At full speed in thick air (Max-Q), the wind presses on the skin hardest; real rockets see about 30–35 kPa.', vi: 'Khi bay nhanh nhất trong lớp không khí dày (Max-Q), gió ép lên vỏ mạnh nhất; tên lửa thật chịu khoảng 30–35 kPa.' },
};
export const labelFor = (id, lang = 'en') => LABELS[id]?.[L(lang)] ?? id;

/**
 * The number lines of the card for one part: [{ id, label, value, words, meaning }].
 * fig: partFigures() of the part (mass, cost, wet, reliability, power, chuteCdA, engine, booster); def: the part;
 * diameter in metres; count engines in a cluster (fig already includes them in mass and cost); budget: money now.
 */
export function numbersFor({ def, fig, g0, lang = 'en', budget = null, diameter = 0, count = 1 }) {
  const lines = [];
  const line = (id, value, words, meaning = null, note = null) => lines.push({ id, label: labelFor(id, lang), value, words, meaning: meaning ? meaning[L(lang)] : null, note });
  if (!def || !fig) return lines;
  const propellant = (def.fuel?.mass ?? 0) + (def.booster?.propellant ?? 0);
  if (propellant > 0) {
    line('dry', massValue(fig.mass, lang), massWords(fig.mass, lang));
    line('propellant', massValue(propellant, lang), massWords(propellant, lang), MEANINGS.propellant);
  } else line('mass', massValue(fig.mass, lang), massWords(fig.mass, lang));
  if (fig.engine) {
    const n = fig.engine.count ?? count ?? 1;
    const sl = fig.engine.totalThrustSL ?? fig.engine.thrustSL * n;
    line('thrust', `${kNValue(sl, lang)}${n > 1 ? (L(lang) === 'vi' ? ` (${n} động cơ)` : ` (${n} engines)`) : ''}`, thrustWords(sl, g0, lang), MEANINGS.thrust);
    line('exhaust', exhaustValue(fig.engine.ispVac, g0, lang), exhaustWords(fig.engine.ispVac, g0, lang), MEANINGS.exhaust, `Isp ${secondsValue(fig.engine.ispVac, lang)}`);
  }
  if (fig.booster) {
    const sl = fig.booster.ispVac > 0 ? fig.booster.thrust * (fig.booster.ispSL / fig.booster.ispVac) : fig.booster.thrust;
    line('thrust', kNValue(sl, lang), thrustWords(sl, g0, lang), MEANINGS.thrust);
    if (fig.booster.burnTime) line('burn', durationValue(fig.booster.burnTime, lang), '');
  }
  if (fig.power > 0) line('power', `${num(fig.power, lang)} W`, powerWords(fig.power, lang), MEANINGS.power);
  if (fig.chuteCdA > 0) line('chute', `${num(fig.chuteCdA, lang)} m²`, areaWords(fig.chuteCdA, lang), MEANINGS.chute);
  if (def.height > 0) line(diameter > 0 ? 'size' : 'height', `${metres(def.height, lang)}${diameter > 0 ? ` × ${metres(diameter, lang)}` : ''}`, sizeWords({ height: def.height, diameter }, lang));
  if (Number.isFinite(fig.reliability)) line('reliability', pctValue(fig.reliability, lang, fig.reliability > 0.995 && fig.reliability < 1 ? 1 : 0), reliabilityWords(fig.reliability, lang), MEANINGS.reliability);
  line('price', moneyValue(fig.cost, lang), priceWords(fig.cost, { budget, lang }));
  return lines;
}

// ---------- compared with the part installed now ----------
const pct = (r) => Math.round(Math.abs(r - 1) * 100);

/**
 * Sentences comparing a part (next) with the one installed now (now): both partFigures() results; name is the
 * installed part's name. Only differences worth saying are returned.
 */
export function compareWords({ now, next, name, subject = null, g0, lang = 'en', propellantNow = 0, propellantNext = 0 }) {
  void g0;
  const vi = L(lang) === 'vi';
  const out = [];
  if (!now || !next) return out;
  const yours = subject ?? (vi ? `${name} đang lắp` : `your ${name}`);
  // weight
  const dm = next.mass - now.mass; // exact: a 60 kg change on a 2.8 t part is said as 60 kg, not as 0.1 t
  if (Math.abs(dm) >= Math.max(5, 0.02 * now.mass)) {
    const { ref, n, less } = pickRef(REFS.mass, Math.abs(dm));
    const what = less ? (vi ? `chưa tới một ${ref.vi}` : `less than a ${ref.en[0]}`) : countPhrase(ref, n, lang);
    out.push(vi ? `${dm > 0 ? 'Nặng' : 'Nhẹ'} hơn ${yours} ${massValue(Math.abs(dm), 'vi')} (${what}).` : `${massValue(Math.abs(dm), 'en')} ${dm > 0 ? 'heavier' : 'lighter'} than ${yours}: ${what} ${dm > 0 ? 'more' : 'less'}.`);
  } else out.push(vi ? `Nặng gần bằng ${yours}.` : `About as heavy as ${yours}.`);
  // propellant
  const dp = propellantNext - propellantNow;
  if (Math.abs(dp) >= Math.max(10, 0.02 * propellantNow) && (propellantNow || propellantNext)) {
    out.push(vi ? `Chứa ${dp > 0 ? 'nhiều' : 'ít'} hơn ${massValue(Math.abs(dp), 'vi')} nhiên liệu.` : `Holds ${massValue(Math.abs(dp), 'en')} ${dp > 0 ? 'more' : 'less'} propellant.`);
  }
  // push
  const thrustOf = (f) => (f.engine ? (f.engine.totalThrustSL ?? f.engine.thrustSL) : f.booster ? f.booster.thrust * (f.booster.ispVac > 0 ? f.booster.ispSL / f.booster.ispVac : 1) : 0);
  const tNow = thrustOf(now), tNext = thrustOf(next);
  if (tNow > 0 && tNext > 0) {
    const r = tNext / tNow;
    if (r >= 2) out.push(vi ? `Đẩy mạnh gấp ${num(r, 'vi', 1)} lần ${yours}.` : `Pushes ${num(r, 'en', 1)} times as hard as ${yours}.`);
    else if (r >= 1.03) out.push(vi ? `Đẩy mạnh hơn ${yours} ${pct(r)} %.` : `Pushes ${pct(r)} % harder than ${yours}.`);
    else if (r <= 0.97) out.push(vi ? `Đẩy yếu hơn ${yours} ${pct(r)} %.` : `Pushes ${pct(r)} % less than ${yours}.`);
    else out.push(vi ? `Đẩy mạnh ngang ${yours}.` : `Pushes about as hard as ${yours}.`);
    if (next.engine && now.engine) {
      const di = next.engine.ispVac - now.engine.ispVac;
      if (Math.abs(di) >= 1) {
        const p = num(Math.abs(di / now.engine.ispVac) * 100, lang, 1);
        out.push(vi ? `Khí phụt ${di > 0 ? 'nhanh' : 'chậm'} hơn ${p} %, nên cùng lượng nhiên liệu tàu đi được ${di > 0 ? 'xa' : 'gần'} hơn ${p} %.` : `The gas leaves ${p} % ${di > 0 ? 'faster' : 'slower'}, so the same propellant gives ${p} % ${di > 0 ? 'more' : 'less'} speed.`);
      }
    }
  }
  // power
  if (now.power > 0 && next.power > 0 && Math.abs(next.power / now.power - 1) >= 0.03) {
    const r = next.power / now.power;
    if (r >= 2) out.push(vi ? `Cho điện gấp ${num(r, 'vi', 1)} lần ${yours}.` : `${num(r, 'en', 1)} times the electric power of ${yours}.`);
    else out.push(vi ? `Cho ${r > 1 ? 'nhiều' : 'ít'} điện hơn ${yours} ${pct(r)} %.` : `${pct(r)} % ${r > 1 ? 'more' : 'less'} electric power than ${yours}.`);
  }
  // price
  const dc = moneyShown(next.cost) - moneyShown(now.cost);
  if (Math.abs(dc) >= Math.max(500, 0.01 * now.cost)) out.push(vi ? `${dc > 0 ? 'Đắt' : 'Rẻ'} hơn ${yours} ${moneyValue(Math.abs(dc), 'vi')}.` : `${moneyValue(Math.abs(dc), 'en')} ${dc > 0 ? 'more expensive' : 'cheaper'} than ${yours}.`);
  else out.push(vi ? `Giá gần bằng ${yours}.` : `About the same price as ${yours}.`);
  // reliability
  const fNow = flightsPerFailure(now.reliability), fNext = flightsPerFailure(next.reliability);
  if (fNow !== fNext) {
    const first = (n) => (n === Infinity ? (vi ? 'Gần như không bao giờ hỏng' : 'Almost never fails') : (vi ? `Cứ khoảng ${num(n, 'vi')} chuyến bay thì hỏng 1 lần` : `Fails about 1 time in ${num(n, 'en')} flights`));
    const then = (n) => (n === Infinity ? (vi ? 'gần như không bao giờ hỏng' : 'almost never') : (vi ? `${num(n, 'vi')} chuyến hỏng 1 lần` : `1 in ${num(n, 'en')}`));
    out.push(vi ? `${first(fNext)}, so với ${then(fNow)} của ${yours}.` : `${first(fNext)}, against ${then(fNow)} for ${yours}.`);
  }
  return out;
}

/**
 * Short phrases for one choice against the one fitted now (both partFigures()): "120 kg heavier", "$50k more",
 * "+12 s Isp", "15 % less push", "fails 1 in 60 (now 1 in 50)". Empty when nothing changes.
 */
export function effectWords({ now, next, lang = 'en' }) {
  const vi = L(lang) === 'vi';
  const out = [];
  if (!now || !next) return out;
  const fNow = flightsPerFailure(now.reliability), fNext = flightsPerFailure(next.reliability);
  if (fNow !== fNext) {
    const first = (x) => (x === Infinity ? (vi ? 'gần như không hỏng' : 'almost never fails') : vi ? `cứ ${num(x, 'vi')} chuyến hỏng 1 lần` : `fails 1 in ${num(x, 'en')}`);
    const then = (x) => (x === Infinity ? (vi ? 'gần như không hỏng' : 'almost never') : vi ? (fNext === Infinity ? `cứ ${num(x, 'vi')} chuyến hỏng 1 lần` : num(x, 'vi')) : `1 in ${num(x, 'en')}`);
    out.push(vi ? `${first(fNext)} (hiện là ${then(fNow)})` : `${first(fNext)} (now ${then(fNow)})`);
  }
  const tOf = (f) => f.engine?.thrust ?? f.booster?.thrust ?? 0;
  if (tOf(now) > 0 && Math.abs(tOf(next) / tOf(now) - 1) >= 0.005) {
    const r = tOf(next) / tOf(now);
    out.push(vi ? `lực đẩy ${r > 1 ? 'tăng' : 'giảm'} ${pct(r)} %` : `${pct(r)} % ${r > 1 ? 'more' : 'less'} push`);
  }
  const iOf = (f) => f.engine?.ispVac ?? f.booster?.ispVac ?? 0;
  const di = iOf(next) - iOf(now);
  if (iOf(now) > 0 && Math.abs(di) >= 0.5) out.push(vi ? `Isp ${di > 0 ? '+' : '−'}${num(Math.abs(di), 'vi')} giây` : `Isp ${di > 0 ? '+' : '−'}${num(Math.abs(di), 'en')} s`);
  if (now.power > 0 && Math.abs(next.power / now.power - 1) >= 0.005) {
    const r = next.power / now.power;
    out.push(vi ? `điện ${r > 1 ? 'tăng' : 'giảm'} ${pct(r)} %` : `${pct(r)} % ${r > 1 ? 'more' : 'less'} power`);
  }
  if (now.chuteCdA > 0 && Math.abs(next.chuteCdA / now.chuteCdA - 1) >= 0.005) {
    const r = next.chuteCdA / now.chuteCdA;
    out.push(vi ? `lực cản ${r > 1 ? 'tăng' : 'giảm'} ${pct(r)} %` : `${pct(r)} % ${r > 1 ? 'more' : 'less'} drag`);
  }
  const dm = next.mass - now.mass;
  if (Math.abs(dm) >= 1) out.push(vi ? `${dm > 0 ? 'nặng' : 'nhẹ'} hơn ${massValue(Math.abs(dm), 'vi')}` : `${massValue(Math.abs(dm), 'en')} ${dm > 0 ? 'heavier' : 'lighter'}`);
  const dc = moneyShown(next.cost) - moneyShown(now.cost);
  if (Math.abs(dc) >= 1) out.push(vi ? `${dc > 0 ? 'đắt' : 'rẻ'} hơn ${moneyValue(Math.abs(dc), 'vi')}` : `${moneyValue(Math.abs(dc), 'en')} ${dc > 0 ? 'more' : 'cheaper'}`);
  return out;
}

/** Air temperature on launch day in words: "Colder than inside a fridge (4 °C)." */
export function weatherWords(tempC, lang = 'en') {
  if (!Number.isFinite(tempC)) return '';
  const vi = L(lang) === 'vi';
  const d = (v) => `${num(v, lang)} °C`;
  if (tempC < 0) return vi ? `Dưới điểm đóng băng (${d(0)}): nước đóng thành đá.` : `Below freezing (${d(0)}): water turns to ice.`;
  if (tempC < 5) return vi ? `Lạnh như trong tủ lạnh (khoảng ${d(4)}).` : `As cold as inside a fridge (about ${d(4)}).`;
  if (tempC < 15) return vi ? 'Một buổi sáng mát, cần áo khoác.' : 'A cool morning: coat weather.';
  if (tempC < 28) return vi ? 'Dễ chịu, như trong phòng.' : 'Mild, like indoors.';
  return vi ? 'Một ngày hè nóng.' : 'A hot summer day.';
}
