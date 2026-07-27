// v0.36.0: `:shortcode:` → emoji support for the markdown renderer.
//
// Two design choices:
//   1. NO external emoji dataset. node-emoji / emojibase would add 50–100 KB
//      and pull in 1800+ entries we don't need. This inline map covers ~180 of
//      the most-used shortcodes from GitHub's emoji cheat sheet — the ones a
//      note-taker actually types. Easy to extend.
//   2. Pure function + a marked extension factory, both exported, so the
//      shortcode→emoji logic is unit-testable in isolation (mirrors the
//      editor-logic / reading pure-module pattern).
//
// The extension is wired into buildMarked() in renderer.js. marked walks inline
// tokens; the extension's `inline.text` hook sees raw text and replaces any
// `:name:` it recognizes, leaving unknown `:things:` alone (so `::double::`
// or code spans aren't mangled).

// Common emoji shortcodes → unicode. Curated from GitHub's emoji autocomplete
// + the most-typed smileys, gestures, common objects, and status symbols.
const EMOJI = {
  // smileys & emotion
  smile: '😄', laugh: '😆', blush: '😊', smiley: '😃', wink: '😉', joy: '😂',
  rofl: '🤣', relaxed: '☺️', upside_down: '🙃', melting: '🫠', heart_eyes: '😍',
  kissing_heart: '😘', kissing: '😗', kissing_smiling_eyes: '😙', stuck_out_tongue: '😛',
  stuck_out_tongue_winking_eye: '😜', stuck_out_tongue_closed_eyes: '😝',
  money_mouth: '🤑', nerd: '🤓', sunglasses: '😎', star_struck: '🤩', clown: '🤡',
  cowboy: '🤠', robot: '🤖', ghost: '👻', skull: '💀', skulls: '☠️', poop: '💩',
  smile_cat: '😺', joy_cat: '😹', heart_eyes_cat: '😻', pouting_cat: '😽',
  see_no_evil: '🙈', hear_no_evil: '🙉', speak_no_evil: '🙊', alien: '👽',
  angry: '😠', rage: '😡', cry: '😢', sob: '😭', flushed: '😳', disappointed: '😞',
  worried: '😟', confused: '😕', persevere: '😣', tired_face: '😫', weary: '😩',
  sleepy: '😪', sweat: '😓', cold_sweat: '😰', scream: '😱', astonished: '😲',
  zipper_mouth: '🤐', neutral_face: '😐', expressionless: '😑', no_mouth: '😶',
  rolling_eyes: '🙄', thinking: '🤔', hand_over_mouth: '🤭', shushing: '🤫',
  relieved: '😌', sleeping: '😴', drooling: '🤤', sleepy_face: '😴',
  mask: '😷', dizzy: '💫', zany: '🤪', woozy: '🥴', shiver: '🥶', hot: '🥵',

  // gestures & people
  thumbsup: '👍', thumbsdown: '👎', '+1': '👍', '-1': '👎',
  ok_hand: '👌', peace: '✌️', v: '✌️', vulcan: '🖖', raised_hands: '🙌',
  clap: '👏', wave: '👋', call_me: '🤙', crossed_fingers: '🤞', muscle: '💪',
  point_left: '👈', point_right: '👉', point_up: '👆', point_down: '👇',
  point_up_2: '☝️', fist: '✊', facepunch: '👊', punch: '👊', raised_hand: '✋',
  open_hands: '👐', pray: '🙏', handshake: '🤝', writing: '✍️', nail_care: '💅',
  selfie: '🤳', eyes: '👀', eye: '👁️', tongue: '👅', mouth: '👄', ear: '👂',
  nose: '👃', footprint: '👣', brain: '🧠', anatomical_heart: '🫀', lungs: '🫁',
  tooth: '🦷', bone: '🦴', pregnant: '🤰', breast_feeding: '🤱',
  dancing: '💃', walking: '🚶', runner: '🏃', running: '🏃', couple: '💑',

  // hearts & symbols
  heart: '❤️', hearts: '💕', heartbeat: '💓', broken_heart: '💔', two_hearts: '💕',
  sparkles: '✨', star: '⭐', stars: '🌟', dizzy_symbol: '💫', boom: '💥', collision: '💥',
  anger: '💢', sweat_drops: '💦', droplet: '💧', zzz: '💤', dash: '💨', hole: '🕳️',
  bomb: '💣', speech_balloon: '💬', thought_balloon: '💭', '100': '💯',
  white_check_mark: '✅', check_mark: '✔️', x: '❌', negative_squared_cross_mark: '❎',
  question: '❓', grey_question: '❔', exclamation: '❗', grey_exclamation: '❕',
  warning: '⚠️', no_entry: '⛔', no_entry_sign: '🚫', recycle: '♻️', copyright: '©️',
  registered: '®️', tm: '™️', end: '🔚', back: '🔙', on: '🔛', top: '🔝', soon: '🔜',
  free: '🆓', new: '🆕', ng: '🆖', ok: '🆗', up: '🆙', cool: '🆒', sos: '🆘',
  id: '🆔', vs: '🆚', alphabet: '🔤', abc: '🔡', capital_abcd: '🔠', symbols: '🔣',

  // animals & nature
  dog: '🐶', cat: '🐱', mouse: '🐭', hamster: '🐹', rabbit: '🐰', bear: '🐻',
  panda: '🐼', koala: '🐨', tiger: '🐯', lion: '🦁', cow: '🐮', pig: '🐷',
  frog: '🐸', monkey: '🐵', chicken: '🐔', penguin: '🐧', bird: '🐦', baby_chick: '🐤',
  duck: '🦆', eagle: '🦅', owl: '🦉', bat: '🦇', wolf: '🐺', boar: '🐗', horse: '🐴',
  unicorn: '🦄', honeybee: '🐝', bug: '🐛', butterfly: '🦋', snail: '🐌', turtle: '🐢',
  snake: '🐍', dragon: '🐉', t_rex: '🦖', octopus: '🐙', whale: '🐋', dolphin: '🐬',
  fish: '🐟', tropical_fish: '🐠', blowfish: '🐡', shark: '🦈', crab: '🦀', lobster: '🦞',
  rose: '🌹', tulip: '🌷', cherry_blossom: '🌸', hibiscus: '🌺', sunflower: '🌻',
  blossom: '🌼', herb: '🌿', four_leaf_clover: '🍀', maple_leaf: '🍁', fallen_leaf: '🍂',
  cactus: '🌵', palm_tree: '🌴', evergreen_tree: '🌲', deciduous_tree: '🌳', mushroom: '🍄',
  sun_with_face: '🌞', full_moon_with_face: '🌝', new_moon: '🌑', full_moon: '🌕',
  sun: '☀️', cloud: '☁️', umbrella: '☔', snowflake: '❄️', fire: '🔥', zap: '⚡',
  rainbow: '🌈', star2: '🌟', stars2: '🌠', droplet2: '💧', ocean: '🌊',

  // food & drink
  apple: '🍎', green_apple: '🍏', pear: '🍐', tangerine: '🍊', lemon: '🍋', banana: '🍌',
  watermelon: '🍉', grapes: '🍇', strawberry: '🍓', melon: '🍈', cherries: '🍒', peach: '🍑',
  pineapple: '🍍', coconut: '🥥', kiwi: '🥝', avocado: '🥑', broccoli: '🥦', tomato: '🍅',
  eggplant: '🍆', cucumber: '🥒', carrot: '🥕', hot_pepper: '🌶️', potato: '🥔', corn: '🌽',
  bread: '🍞', cheese: '🧀', egg: '🥚', cooking: '🍳', bacon: '🥓', pancake: '🥞',
  burger: '🍔', fries: '🍟', pizza: '🍕', hotdog: '🌭', sandwich: '🥪', taco: '🌮',
  burrito: '🌯', salad: '🥗', soup: '🍲', sushi: '🍣', ramen: '🍜', noodles: '🍜',
  donut: '🍩', cookie: '🍪', cake: '🍰', birthday: '🎂', chocolate_bar: '🍫', candy: '🍬',
  coffee: '☕', tea: '🍵', beer: '🍺', beers: '🍻', wine: '🍷', tada: '🎉',
  champagne: '🍾', whiskey: '🥃', cocktail: '🍸', tropical_drink: '🍹', milk: '🥛',

  // activities & objects
  soccer: '⚽', basketball: '🏀', football: '🏈', baseball: '⚾', tennis: '🎾', volleyball: '🏐',
  rugby_football: '🏉', '8ball': '🎱', golf: '⛳', ping_pong: '🏓', badminton: '🏸', hockey: '🏒',
  dart: '🎯', bowling: '🎳', video_game: '🎮', slot_machine: '🎰', game_die: '🎲',
  musical_note: '🎵', notes: '🎶', saxophone: '🎷', guitar: '🎸', piano: '🎹', trumpet: '🎺',
  violin: '🎻', headphones: '🎧', radio: '📻', telephone: '☎️', mobile: '📱', computer: '💻',
  desktop: '🖥️', printer: '🖨️', keyboard: '⌨️', mouse: '🖱️', camera: '📷', video_camera: '📹',
  tv: '📺', vhs: '📼', film: '🎬', dvd: '💿', md: '💽', floppy: '💾', candle: '🕯️',
  book: '📖', books: '📚', notebook: '📓', pencil: '📝', pencil2: '✏️', crayon: '🖍️',
  pen: '🖊️', ink: '🖋️', briefcase: '💼', link: '🔗', paperclip: '📎', pushpin: '📌',
  scissors: '✂️', ruler: '📏', triangular_ruler: '📐', lock: '🔒', unlock: '🔓', key: '🔑',
  hammer: '🔨', pick: '⛏️', tools: '🛠️', screwdriver: '🪛', wrench: '🔧', nut_and_bolt: '🔩',
  gear: '⚙️', compass: '🧭', microscope: '🔬', telescope: '🔭', satellite: '📡',
  rocket: '🚀', airplane: '✈️', helicopter: '🚁', train: '🚆', train2: '🚄', bullettrain: '🚅',
  metro: '🚇', tram: '🚊', bus: '🚌', ambulance: '🚑', fire_engine: '🚒', police_car: '🚓',
  taxi: '🚕', car: '🚗', blue_car: '🚙', truck: '🚚', ship: '🚢', speedboat: '🚤', bicycle: '🚲',

  // misc / places / time
  house: '🏠', house_with_garden: '🏡', office: '🏢', post_office: '🏣', hospital: '🏥',
  bank: '🏦', hotel: '🏨', church: '⛪', mosque: '🕌', synagogue: '🕍', kaaba: '🕋',
  school: '🏫', convenience_store: '🏪', factory: '🏭', wedding: '💒', Tokyo: '🗼',
  statue: '🗽', tent: '⛺', foggy: '🌫️', night: '🌃', sunrise: '🌅', city_sunset: '🌆',
  clock: '⏰', hourglass: '⌛', hourglass_flowing_sand: '⏳', watch: '⌚', alarm: '⏰',
  moneybag: '💰', yen: '💴', dollar: '💵', euro: '💶', pound: '💷', money_with_wings: '💸',
  credit_card: '💳', chart: '📈', chart_down: '📉', currency_exchange: '💱', heavy_dollar_sign: '💲',
  email: '✉️', mail: '📧', envelope: '✉️', package: '📦', fax: '📠', bath: '🛀', shower: '🚿',
  toilet: '🚽', door: '🚪', bed: '🛏️', couch: '🛋️', smoking: '🚬', cigar: '🚬', no_smoking: '🚭',
  megaphone: '📣', speaker: '📢', bell: '🔔', no_bell: '🔕', medal: '🏅', trophy: '🏆', ribbon: '🎗️',
  microphone: '🎤', level_slider: '🎚️', knob: '🎛️',
};

// Pattern: `:shortcode:` where shortcode is one of the keys above. The
// lookbehind/lookahead prevent matching inside URLs (`http://x:y`), times
// (`12:30`), and wiki-links (`[[Page:Section]]`). Only word characters,
// digits, `+`, and `-` are valid shortcode bodies (matches GitHub's grammar).
const SHORTCODE_RE = /(?<![\w:/#]):[a-zA-Z0-9_+-]+:(?![\w:])/g;

// Replace every recognized `:shortcode:` in `text` with its emoji. Unknown
// shortcodes are left untouched (so we don't mangle prose that happens to use
// colons, like `note: see below`). Exported for unit testing.
export function replaceEmojis(text) {
  if (!text || text.indexOf(':') === -1) return text;
  return text.replace(SHORTCODE_RE, (match) => {
    const name = match.slice(1, -1); // strip both colons
    return EMOJI[name] || match;
  });
}

// marked v18 extension: an inline-level renderer hook that runs on every text
// token. Cheap because replaceEmojis early-exits when there's no `:` in the
// text (the overwhelmingly common case). marked skips inline-text rendering
// inside code spans (those are emitted as `codespan` tokens), so emoji
// replacement naturally stays scoped to prose.
export function markedEmojiExt() {
  return {
    async: false,
    renderer: {
      text({ text }) {
        return replaceEmojis(text);
      },
    },
  };
}

// Exposed for tests + so callers can ask "is this shortcode recognized?".
export function hasEmoji(name) {
  return Object.prototype.hasOwnProperty.call(EMOJI, name);
}

// The full map size, exposed for a sanity-check test.
export const EMOJI_COUNT = Object.keys(EMOJI).length;

// v0.41.0: raw map exposed for the autocomplete source (buildCandidates needs
// to enumerate keys + read the glyph for the dropdown hint). Kept read-only
// by convention — callers must not mutate.
export const EMOJI_MAP = EMOJI;
