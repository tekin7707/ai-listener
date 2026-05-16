const en = require('./i18n/en.json');
const tr = require('./i18n/tr.json');

const dictionaries = { en, tr };
const requested = (process.env.AI_AGENT_LANG || 'en').toLowerCase().slice(0, 2);
const lang = dictionaries[requested] ? requested : 'en';
const dict = dictionaries[lang];

function lookup(key) {
  return key.split('.').reduce((d, k) => (d && typeof d === 'object' ? d[k] : undefined), dict);
}

function t(key, params = {}) {
  const value = lookup(key);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce(
    (s, [k, v]) => s.split(`{${k}}`).join(String(v)),
    value
  );
}

module.exports = { t, lang };
