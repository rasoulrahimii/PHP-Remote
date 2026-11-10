const STALE_MONTHS = 6;
const DEFAULT_SORT = 'hiring';
const NO_OPENINGS = 'no-active-openings';
const HIRING = 'hiring';
const STATUS_BADGES = { [HIRING]: 'Hiring now', [NO_OPENINGS]: 'No openings' };
const STATUS_RANK = { [HIRING]: 0, [NO_OPENINGS]: 2 };
const BENEFITS_PREVIEW = 3;

// Region groups a country belongs to, and the words a location uses for them.
const GROUP_WORDS = {
  eu: ['eu', 'european union'],
  europe: ['europe', 'european'],
  emea: ['emea'],
  middleeast: ['middle east'],
  africa: ['africa'],
  latam: ['latin america', 'latam', 'south america'],
  northamerica: ['north america'],
  americas: ['americas'],
  apac: ['apac', 'asia', 'asia pacific'],
};

const EU = ['eu', 'europe', 'emea'];
const EUROPE = ['europe', 'emea'];
const MIDDLE_EAST = ['middleeast', 'emea'];
const AFRICA = ['africa', 'emea'];
const LATAM = ['latam', 'americas'];
const NORTH_AMERICA = ['northamerica', 'americas'];
const APAC = ['apac'];

const COUNTRY_GROUPS = [
  ['Europe', [
    ['Austria', EU], ['Belgium', EU], ['Bulgaria', EU], ['Croatia', EU], ['Cyprus', EU],
    ['Czechia', EU, ['czech republic']], ['Denmark', EU], ['Estonia', EU], ['Finland', EU], ['France', EU],
    ['Germany', EU], ['Greece', EU], ['Hungary', EU], ['Ireland', EU], ['Italy', EU], ['Latvia', EU],
    ['Lithuania', EU], ['Luxembourg', EU], ['Malta', EU], ['Netherlands', EU, ['holland']], ['Poland', EU],
    ['Portugal', EU], ['Romania', EU], ['Slovakia', EU], ['Slovenia', EU], ['Spain', EU], ['Sweden', EU],
    ['Albania', EUROPE], ['Bosnia and Herzegovina', EUROPE, ['bosnia']], ['Iceland', EUROPE], ['Moldova', EUROPE],
    ['Montenegro', EUROPE], ['North Macedonia', EUROPE, ['macedonia']], ['Norway', EUROPE], ['Serbia', EUROPE],
    ['Switzerland', EUROPE], ['Ukraine', EUROPE], ['United Kingdom', EUROPE, ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales']],
  ]],
  ['Middle East and Caucasus', [
    ['Armenia', MIDDLE_EAST], ['Azerbaijan', MIDDLE_EAST], ['Georgia', MIDDLE_EAST], ['Iran', MIDDLE_EAST],
    ['Israel', MIDDLE_EAST], ['Jordan', MIDDLE_EAST], ['Lebanon', MIDDLE_EAST], ['Saudi Arabia', MIDDLE_EAST],
    ['Turkey', MIDDLE_EAST, ['türkiye', 'turkiye']], ['United Arab Emirates', MIDDLE_EAST, ['uae']],
  ]],
  ['Africa', [
    ['Egypt', AFRICA], ['Ghana', AFRICA], ['Kenya', AFRICA], ['Morocco', AFRICA], ['Nigeria', AFRICA],
    ['South Africa', AFRICA], ['Tunisia', AFRICA], ['Uganda', AFRICA],
  ]],
  ['Americas', [
    ['Canada', NORTH_AMERICA], ['United States', NORTH_AMERICA, ['usa', 'us', 'u.s.']],
    ['Mexico', [...LATAM, 'northamerica']], ['Argentina', LATAM], ['Brazil', LATAM], ['Chile', LATAM],
    ['Colombia', LATAM], ['Costa Rica', LATAM], ['Ecuador', LATAM], ['Peru', LATAM], ['Uruguay', LATAM],
  ]],
  ['Asia and Pacific', [
    ['Australia', APAC], ['Bangladesh', APAC], ['China', APAC], ['India', APAC], ['Indonesia', APAC],
    ['Japan', APAC], ['Malaysia', APAC], ['Nepal', APAC], ['New Zealand', APAC], ['Pakistan', APAC],
    ['Philippines', APAC], ['Singapore', APAC], ['Sri Lanka', APAC], ['Thailand', APAC], ['Vietnam', APAC],
  ]],
];

const COUNTRIES = new Map(
  COUNTRY_GROUPS.flatMap(([, countries]) =>
    countries.map(([name, groups, aliases = []]) => [name, { name, groups, words: [name.toLowerCase(), ...aliases] }]),
  ),
);

const form = document.getElementById('filters');
const results = document.getElementById('results');
const summary = document.getElementById('summary');
const template = document.getElementById('card');
const clearButton = document.getElementById('clear');
const copyButton = document.getElementById('copy-link');
const filtersToggle = document.getElementById('filters-toggle');
const filtersCount = document.getElementById('filters-count');
const toTop = document.getElementById('to-top');
const themeToggle = document.getElementById('theme-toggle');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

const staleCutoff = (() => {
  const date = new Date();
  date.setMonth(date.getMonth() - STALE_MONTHS);
  return date.toISOString().slice(0, 10);
})();

const isSafeUrl = (url) => /^https?:\/\//i.test(url);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, words) => words.some((word) => new RegExp(`(^|[^a-z])${escapeRegExp(word)}([^a-z]|$)`).test(text));

/**
 * Whether someone living in `country` can apply, judging by the free-text `location` of the remote role.
 */
function hiresIn(location, country) {
  if (!location) return true;
  const text = location.toLowerCase();

  const except = text.match(/worldwide except (.+)/);
  if (except) return !mentions(except[1], country.words);
  if (mentions(text, ['worldwide', 'anywhere', 'global'])) return true;
  if (mentions(text, country.words)) return true;
  if (country.groups.some((group) => mentions(text, GROUP_WORDS[group]))) return true;

  // Time-zone based roles such as "US Pacific Time overlap" also suit the rest of the Americas.
  const usTimeZone = /(^|[^a-z])us([^a-z]|$)[^,]*(time|overlap)/.test(text);
  return usTimeZone && country.groups.includes('americas');
}

const searchText = (company) =>
  [company.name, company.location || 'anywhere', ...company.industries, ...company.benefits, STATUS_BADGES[company.status] || '']
    .join(' ')
    .toLowerCase();

const sorters = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  newest: (a, b) => b.last_verified.localeCompare(a.last_verified) || sorters.name(a, b),
  oldest: (a, b) => a.last_verified.localeCompare(b.last_verified) || sorters.name(a, b),
  hiring: (a, b) => (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1) || sorters.newest(a, b),
};

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const longDate = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function checkedLabel(date) {
  const days = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(date)) / 86400000);
  if (days < 1) return 'Checked today';
  if (days < 30) return `Checked ${relativeTime.format(-days, 'day')}`;
  if (days < 365) return `Checked ${relativeTime.format(-Math.round(days / 30), 'month')}`;
  return `Checked ${relativeTime.format(-Math.round(days / 365), 'year')}`;
}

function hueOf(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
}

function initials(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ---- State ---------------------------------------------------------------

function readState() {
  const data = new FormData(form);
  return {
    q: (data.get('q') || '').trim(),
    country: data.get('country') || '',
    industry: data.get('industry') || '',
    status: data.get('status') || '',
    sort: data.get('sort') || DEFAULT_SORT,
    recent: data.has('recent'),
  };
}

function writeState(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.country) params.set('country', state.country);
  if (state.industry) params.set('industry', state.industry);
  if (state.status) params.set('status', state.status);
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  if (state.recent) params.set('recent', '1');
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

function setStatus(value) {
  for (const radio of form.querySelectorAll('input[name="status"]')) radio.checked = radio.value === value;
}

function restoreState() {
  const params = new URLSearchParams(location.search);
  form.q.value = params.get('q') || '';
  // Older links used "region"; keep them working when it names a country.
  const country = params.get('country') || params.get('region') || '';
  setCountry(country);
  form.industry.value = params.get('industry') || '';
  let status = params.get('status') || '';
  if (params.get('hiring') === '1' || params.get('open') === '1') status = 'hiring';
  setStatus(['hiring', 'closed'].includes(status) ? status : '');
  form.sort.value = sorters[params.get('sort')] ? params.get('sort') : DEFAULT_SORT;
  form.recent.checked = params.get('recent') === '1';
}

function activeFilterCount(state) {
  return [state.q, state.country, state.industry, state.status, state.recent].filter(Boolean).length;
}

// ---- Options ---------------------------------------------------------------

function fillIndustries(companies) {
  const counts = new Map();
  for (const company of companies) {
    for (const industry of company.industries) counts.set(industry, (counts.get(industry) || 0) + 1);
  }
  const names = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  for (const name of names) form.industry.append(new Option(`${name} (${counts.get(name)})`, name));
}

// ---- Searchable country picker ---------------------------------------------

const combo = {
  input: document.getElementById('country-input'),
  list: document.getElementById('country-list'),
  clear: document.getElementById('country-clear'),
  counts: new Map(),
  options: [],
  active: -1,
};

const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function setCountry(name, { notify = false } = {}) {
  const value = COUNTRIES.has(name) ? name : '';
  form.country.value = value;
  combo.input.value = value;
  combo.clear.hidden = !value;
  if (notify) form.dispatchEvent(new Event('input'));
}

function countryMatches(query) {
  const q = fold(query.trim());
  const all = COUNTRY_GROUPS.flatMap(([group, countries]) => countries.map(([name]) => ({ group, country: COUNTRIES.get(name) })));
  if (!q) return all;
  const scored = [];
  for (const entry of all) {
    const words = entry.country.words.map(fold);
    const name = words[0];
    let score = null;
    if (words.includes(q)) score = -1;
    else if (name.startsWith(q)) score = 0;
    else if (words.some((word) => word.startsWith(q))) score = 1;
    else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    if (score !== null) scored.push({ ...entry, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name));
}

function optionItem(id, label, count, value) {
  const item = document.createElement('li');
  item.id = id;
  item.className = 'combo-option';
  item.setAttribute('role', 'option');
  item.dataset.value = value;
  item.setAttribute('aria-selected', String(form.country.value === value));
  const text = document.createElement('span');
  text.textContent = label;
  const badge = document.createElement('span');
  badge.className = 'combo-count';
  badge.textContent = count;
  badge.setAttribute('aria-label', `${count} companies`);
  item.append(text, badge);
  return item;
}

function renderCountryList() {
  const query = combo.input.value === form.country.value ? '' : combo.input.value;
  const matches = countryMatches(query);
  const items = [];
  combo.options = [];
  if (!query.trim()) {
    const anywhere = optionItem('country-opt-any', 'Anywhere', combo.counts.get(''), '');
    combo.options.push(anywhere);
    items.push(anywhere);
  }
  let group = '';
  matches.forEach((entry, index) => {
    if (!query.trim() && entry.group !== group) {
      group = entry.group;
      const heading = document.createElement('li');
      heading.className = 'combo-group';
      heading.setAttribute('role', 'presentation');
      heading.textContent = group;
      items.push(heading);
    }
    const option = optionItem(`country-opt-${index}`, entry.country.name, combo.counts.get(entry.country.name), entry.country.name);
    combo.options.push(option);
    items.push(option);
  });
  if (combo.options.length === 0) {
    const none = document.createElement('li');
    none.className = 'combo-empty';
    none.textContent = 'No country matches. Try another spelling.';
    items.push(none);
  }
  combo.list.replaceChildren(...items);
  const selected = combo.options.findIndex((option) => option.dataset.value === form.country.value);
  setActive(query.trim() ? 0 : Math.max(selected, 0));
}

function setActive(index) {
  combo.options.forEach((option) => option.classList.remove('active'));
  combo.active = combo.options.length ? Math.max(0, Math.min(index, combo.options.length - 1)) : -1;
  const option = combo.options[combo.active];
  if (option) {
    option.classList.add('active');
    combo.input.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  } else {
    combo.input.removeAttribute('aria-activedescendant');
  }
}

function openCountryList() {
  if (!combo.list.hidden) return;
  combo.list.hidden = false;
  combo.input.setAttribute('aria-expanded', 'true');
  renderCountryList();
}

function closeCountryList({ restore = true } = {}) {
  combo.list.hidden = true;
  combo.input.setAttribute('aria-expanded', 'false');
  combo.input.removeAttribute('aria-activedescendant');
  if (restore) combo.input.value = form.country.value;
}

function chooseCountry(option) {
  setCountry(option.dataset.value, { notify: true });
  closeCountryList();
}

function setupCountryPicker(companies) {
  combo.counts.set('', companies.length);
  for (const country of COUNTRIES.values()) {
    combo.counts.set(country.name, companies.filter((company) => hiresIn(company.location, country)).length);
  }

  combo.input.addEventListener('focus', () => {
    combo.input.select();
    openCountryList();
  });
  combo.input.addEventListener('click', openCountryList);
  combo.input.addEventListener('input', (event) => {
    event.stopPropagation();
    if (combo.list.hidden) {
      combo.list.hidden = false;
      combo.input.setAttribute('aria-expanded', 'true');
    }
    renderCountryList();
  });
  combo.input.addEventListener('keydown', (event) => {
    const open = !combo.list.hidden;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return openCountryList();
      setActive(combo.active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open && combo.options[combo.active]) chooseCountry(combo.options[combo.active]);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        closeCountryList();
      } else if (form.country.value) {
        setCountry('', { notify: true });
      }
    } else if (event.key === 'Tab' && open) {
      closeCountryList();
    }
  });
  combo.input.addEventListener('blur', () => {
    // Let a click on an option land before closing.
    setTimeout(() => {
      if (document.activeElement !== combo.input) closeCountryList();
    }, 120);
  });

  combo.list.addEventListener('mousedown', (event) => event.preventDefault());
  combo.list.addEventListener('click', (event) => {
    const option = event.target.closest('.combo-option');
    if (option) chooseCountry(option);
  });
  combo.list.addEventListener('mousemove', (event) => {
    const option = event.target.closest('.combo-option');
    const index = combo.options.indexOf(option);
    if (index >= 0 && index !== combo.active) {
      combo.options.forEach((item) => item.classList.remove('active'));
      option.classList.add('active');
      combo.active = index;
      combo.input.setAttribute('aria-activedescendant', option.id);
    }
  });

  combo.clear.addEventListener('click', () => {
    setCountry('', { notify: true });
    combo.input.focus();
  });
}

function fillStats(companies) {
  const set = (key, value) => (document.querySelector(`[data-stat="${key}"]`).textContent = value);
  const latest = companies.reduce((max, company) => (company.last_verified > max ? company.last_verified : max), '');
  set('total', companies.length);
  set('hiring', companies.filter((company) => company.status === HIRING).length);
  set('checked', latest ? longDate.format(new Date(latest)) : '–');
}

// ---- Rendering ---------------------------------------------------------------

function iconLink(label, icon, href) {
  const anchor = document.createElement('a');
  anchor.className = 'icon-link';
  anchor.append(document.getElementById(`icon-${icon}`).content.firstElementChild.cloneNode(true));
  anchor.setAttribute('aria-label', label);
  anchor.title = label;
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  return anchor;
}

function renderCard(company, state) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.style.setProperty('--hue', hueOf(company.name));
  card.querySelector('.avatar').textContent = initials(company.name);

  const name = card.querySelector('.name a');
  name.textContent = company.name;
  const openRoles = card.querySelector('.open-roles');
  if (isSafeUrl(company.url)) {
    name.href = company.url;
    openRoles.href = company.url;
    openRoles.setAttribute('aria-label', `Open roles at ${company.name}`);
    if (company.status === HIRING) openRoles.querySelector('.label').textContent = 'See open roles';
  } else {
    openRoles.remove();
  }

  const badge = STATUS_BADGES[company.status];
  if (badge) {
    const status = card.querySelector('.status');
    status.textContent = badge;
    status.classList.add(company.status);
    status.hidden = false;
    card.classList.add(company.status);
  }

  const location = card.querySelector('.location span');
  if (company.location) {
    location.textContent = `Remote: ${company.location}`;
  } else {
    location.textContent = 'Remote: anywhere';
    location.title = 'No region limit listed';
  }

  const chips = card.querySelector('.chips');
  for (const industry of company.industries) {
    const item = document.createElement('li');
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = industry;
    chip.dataset.industry = industry;
    chip.title = `Show only ${industry} companies`;
    if (state.industry === industry) chip.setAttribute('aria-pressed', 'true');
    item.append(chip);
    chips.append(item);
  }

  const benefits = card.querySelector('.benefits');
  company.benefits.forEach((benefit, index) => {
    const item = document.createElement('li');
    item.textContent = benefit;
    if (index >= BENEFITS_PREVIEW) item.className = 'extra';
    benefits.append(item);
  });
  if (company.benefits.length > BENEFITS_PREVIEW) {
    const extra = company.benefits.length - BENEFITS_PREVIEW;
    const item = document.createElement('li');
    item.className = 'more-item';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'benefits-toggle';
    more.textContent = `+${extra} more`;
    more.setAttribute('aria-expanded', 'false');
    item.append(more);
    benefits.append(item);
  }

  const links = card.querySelector('.links');
  if (isSafeUrl(company.linkedin)) links.append(iconLink(`${company.name} on LinkedIn`, 'linkedin', company.linkedin));
  if (company.glassdoor && isSafeUrl(company.glassdoor)) links.append(iconLink(`${company.name} on Glassdoor`, 'glassdoor', company.glassdoor));

  const verified = card.querySelector('.verified');
  verified.dateTime = company.last_verified;
  verified.textContent = checkedLabel(company.last_verified);
  verified.title = `Last checked by hand on ${company.last_verified}`;
  if (company.last_verified < staleCutoff) {
    verified.classList.add('stale');
    verified.title += `, more than ${STALE_MONTHS} months ago`;
  }

  return card;
}

function emptyState(state) {
  const empty = document.createElement('li');
  empty.className = 'empty';
  const title = document.createElement('p');
  title.className = 'empty-title';
  title.textContent = 'No companies match these filters';
  const hint = document.createElement('p');
  hint.textContent = state.status === 'hiring'
    ? 'Try showing companies with no open roles too: they hired remotely in the last year and may post again.'
    : 'Try a shorter search or remove a filter.';
  const actions = document.createElement('div');
  actions.className = 'empty-actions';
  if (state.status === 'hiring') {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'button';
    all.textContent = 'Include companies with no openings';
    all.addEventListener('click', () => {
      setStatus('');
      form.dispatchEvent(new Event('input'));
    });
    actions.append(all);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button primary';
  reset.textContent = 'Clear all filters';
  reset.addEventListener('click', clearFilters);
  actions.append(reset);
  empty.append(title, hint, actions);
  return empty;
}

function render(companies) {
  const state = readState();
  writeState(state);

  const country = COUNTRIES.get(state.country);
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = companies
    .filter((company) => !country || hiresIn(company.location, country))
    .filter((company) => !state.industry || company.industries.includes(state.industry))
    .filter((company) => state.status !== 'hiring' || company.status === HIRING)
    .filter((company) => state.status !== 'closed' || company.status === NO_OPENINGS)
    .filter((company) => !state.recent || company.last_verified >= staleCutoff)
    .filter((company) => terms.every((term) => company.search.includes(term)))
    .sort(sorters[state.sort]);

  const hiring = visible.filter((company) => company.status === HIRING).length;
  const shown = visible.length === companies.length
    ? `${companies.length} companies`
    : `${visible.length} of ${companies.length} companies`;
  const where = country ? ` that hire in ${country.name}` : '';
  summary.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = shown;
  summary.append(strong, `${where}${hiring ? ` · ${hiring} hiring now` : ''}`);

  const count = activeFilterCount(state);
  clearButton.hidden = count === 0;
  filtersCount.hidden = count === 0;
  filtersCount.textContent = count;

  results.removeAttribute('aria-busy');
  results.replaceChildren(...(visible.length ? visible.map((company) => renderCard(company, state)) : [emptyState(state)]));
}

function clearFilters() {
  const sort = form.sort.value;
  form.reset();
  form.sort.value = sort;
  setCountry('');
  form.dispatchEvent(new Event('input'));
}

// ---- Interactions ---------------------------------------------------------------

function scrollToResults() {
  form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function setupResultsClicks() {
  results.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (chip) {
      form.industry.value = form.industry.value === chip.dataset.industry ? '' : chip.dataset.industry;
      form.dispatchEvent(new Event('input'));
      scrollToResults();
      return;
    }
    const more = event.target.closest('.benefits-toggle');
    if (more) {
      const list = more.closest('.benefits');
      const expanded = list.classList.toggle('expanded');
      more.setAttribute('aria-expanded', String(expanded));
      more.textContent = expanded ? 'Show less' : `+${list.querySelectorAll('.extra').length} more`;
    }
  });
}

function setupView() {
  const buttons = document.querySelectorAll('.view-switch button');
  const apply = (view) => {
    results.classList.toggle('list', view === 'list');
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  };
  let saved = 'cards';
  try {
    saved = localStorage.getItem('view') === 'list' ? 'list' : 'cards';
  } catch (error) {}
  apply(saved);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      apply(button.dataset.view);
      try {
        localStorage.setItem('view', button.dataset.view);
      } catch (error) {}
    });
  }
}

function setupFiltersToggle() {
  filtersToggle.addEventListener('click', () => {
    const open = form.classList.toggle('open');
    filtersToggle.setAttribute('aria-expanded', String(open));
  });
}

function setupCopyLink() {
  const label = copyButton.querySelector('span');
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      label.textContent = 'Link copied';
    } catch (error) {
      label.textContent = 'Copy failed';
    }
    copyButton.classList.add('done');
    setTimeout(() => {
      label.textContent = 'Copy link';
      copyButton.classList.remove('done');
    }, 1800);
  });
}

function setupShowHiring() {
  document.getElementById('show-hiring').addEventListener('click', () => {
    setStatus('hiring');
    form.dispatchEvent(new Event('input'));
    scrollToResults();
  });
}

function setupToTop() {
  const update = () => {
    toTop.hidden = window.scrollY < 900;
  };
  addEventListener('scroll', update, { passive: true });
  update();
  toTop.addEventListener('click', () => {
    scrollToResults();
    form.q.focus({ preventScroll: true });
  });
}

function setupShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))) return;
    event.preventDefault();
    form.q.focus();
    form.q.select();
  });
  form.q.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && form.q.value) {
      form.q.value = '';
      form.dispatchEvent(new Event('input'));
    }
  });
}

// ---- Theme ---------------------------------------------------------------

function currentTheme() {
  return document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
}

function syncThemeToggle() {
  const dark = currentTheme() === 'dark';
  themeToggle.setAttribute('aria-checked', String(dark));
  themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

function setupThemeToggle() {
  syncThemeToggle();
  darkQuery.addEventListener('change', syncThemeToggle);
  themeToggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch (error) {}
    syncThemeToggle();
  });
}

async function main() {
  setupView();
  setupFiltersToggle();
  setupToTop();
  try {
    const response = await fetch('companies.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const companies = (await response.json()).map((company) => ({ ...company, search: searchText(company) }));

    fillStats(companies);
    fillIndustries(companies);
    setupCountryPicker(companies);
    restoreState();
    form.addEventListener('input', () => render(companies));
    form.addEventListener('submit', (event) => event.preventDefault());
    clearButton.addEventListener('click', clearFilters);
    setupResultsClicks();
    setupCopyLink();
    setupShowHiring();
    setupShortcuts();
    render(companies);
  } catch (error) {
    results.removeAttribute('aria-busy');
    results.replaceChildren();
    summary.textContent = `Could not load the company list (${error.message}). Try reloading the page.`;
  }
}

setupThemeToggle();
main();
