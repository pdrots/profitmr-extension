const COSTS_KEY = 'rewards-card-costs-v1';
const STATE_KEY = 'rewards-card-scan-state-v1';
const PREFERENCES_KEY = 'rewards-calculator-preferences-v1';
const REGIONAL_COSTS_KEY = 'rewards-calculator-regional-costs-v1';
const MAX_GAME_PRICE = 10_000;
const UNITS_PER_CURRENCY = 4;
const MAX_OVERPAY = 500;
const REGIONS = REWARDS_REGIONS;

const scanButton = document.querySelector('#scan');
const resetButton = document.querySelector('#reset-scan');
const calculateButton = document.querySelector('#calculate');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const cardRates = document.querySelector('#cardRates');
const scanner = document.querySelector('#scanner');

let preferences = { region: 'br', language: 'pt-BR', theme: 'light' };
let regionalValues = createEmptyRegionalValues();
let activeScanState = null;

document.querySelector('#regionMenu').addEventListener('toggle', () => closeOtherMenu('regionMenu', 'languageMenu'));
document.querySelector('#languageMenu').addEventListener('toggle', () => closeOtherMenu('languageMenu', 'regionMenu'));
document.querySelector('#themeToggle').addEventListener('click', toggleTheme);
document.querySelector('#calculate').addEventListener('click', calculateStrategy);
scanButton.addEventListener('click', startScan);
resetButton.addEventListener('click', resetScan);
document.querySelector('#gamePrice').addEventListener('change', saveCurrentRegion);
document.querySelector('#balancePoints').addEventListener('change', saveCurrentRegion);
cardRates.addEventListener('input', onRateInput);
cardRates.addEventListener('change', saveCurrentRegion);
document.querySelectorAll('#gamePrice, #balancePoints').forEach((input) => {
  input.addEventListener('input', () => showResult(copy().changedResult));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  if (changes[COSTS_KEY]?.newValue) {
    mergeBrazilCosts(changes[COSTS_KEY].newValue);
    if (preferences.region === 'br') {
      renderRateFields();
      void saveRegionalValues();
    }
  }
  if (changes[REGIONAL_COSTS_KEY]?.newValue) {
    mergeRegionalValues(changes[REGIONAL_COSTS_KEY].newValue);
    if (preferences.region !== 'br') {
      renderRateFields();
    }
  }
  if (changes[STATE_KEY]?.newValue) {
    activeScanState = changes[STATE_KEY].newValue;
    renderScanState(activeScanState);
  }
});

void restoreSavedValues();

function copy() {
  return COPY[preferences.language];
}

function createEmptyRegionalValues() {
  return Object.fromEntries(Object.keys(REGIONS).map((regionId) => [
    regionId,
    { gamePrice: null, balancePoints: null, rates: {}, customAmount: REGIONS[regionId].customMin, customPoints: null },
  ]));
}

async function restoreSavedValues() {
  try {
    const saved = await chrome.storage.local.get([COSTS_KEY, STATE_KEY, PREFERENCES_KEY, REGIONAL_COSTS_KEY]);
    const storedPreferences = saved[PREFERENCES_KEY];
    if (storedPreferences && isRecord(storedPreferences)) {
      preferences = {
        region: Object.hasOwn(REGIONS, storedPreferences.region) ? storedPreferences.region : 'br',
        language: Object.hasOwn(COPY, storedPreferences.language) ? storedPreferences.language : 'pt-BR',
        theme: storedPreferences.theme === 'dark' ? 'dark' : 'light',
      };
    }
    if (isRecord(saved[REGIONAL_COSTS_KEY])) {
      mergeRegionalValues(saved[REGIONAL_COSTS_KEY]);
    }
    if (isRecord(saved[COSTS_KEY])) {
      mergeBrazilCosts(saved[COSTS_KEY]);
    }
    activeScanState = saved[STATE_KEY] ?? null;
    renderInterface();
    await saveRegionalValues();
  } catch (error) {
    status.textContent = interpolate(copy().restoreError, { error: errorMessage(error) });
  }
}

function mergeRegionalValues(values) {
  for (const [regionId, saved] of Object.entries(values)) {
    if (!Object.hasOwn(REGIONS, regionId) || !isRecord(saved)) {
      continue;
    }
    const target = regionalValues[regionId];
    if (Object.hasOwn(saved, 'gamePrice') && (saved.gamePrice === null || isValidPrice(saved.gamePrice))) target.gamePrice = saved.gamePrice;
    if (Object.hasOwn(saved, 'balancePoints') && isValidBalance(saved.balancePoints)) target.balancePoints = saved.balancePoints;
    if (isValidCustomAmount(regionId, saved.customAmount)) target.customAmount = saved.customAmount;
    if (Object.hasOwn(saved, 'customPoints') && (saved.customPoints === null || isPositiveInteger(saved.customPoints))) {
      target.customPoints = saved.customPoints;
    }
    if (isRecord(saved.rates)) {
      for (const amount of REGIONS[regionId].amounts) {
        if (Object.hasOwn(saved.rates, String(amount)) &&
          (saved.rates[String(amount)] === null || isPositiveInteger(saved.rates[String(amount)]))) {
          target.rates[String(amount)] = saved.rates[String(amount)];
        }
      }
    }
  }
}

function mergeBrazilCosts(costs) {
  const brazil = regionalValues.br;
  if (Object.hasOwn(costs, 'gamePrice') && (costs.gamePrice === null || isValidPrice(costs.gamePrice))) {
    brazil.gamePrice = costs.gamePrice;
  }
  if (isValidBalance(costs.balancePoints)) brazil.balancePoints = costs.balancePoints;
  for (const amount of REGIONS.br.amounts) {
    const field = `card${amount}`;
    if (Object.hasOwn(costs, field) && (costs[field] === null || isPositiveInteger(costs[field]))) {
      brazil.rates[String(amount)] = costs[field];
    }
  }
  if (isValidCustomAmount('br', costs.customAmount)) brazil.customAmount = costs.customAmount;
  if (Object.hasOwn(costs, 'customPoints') &&
    (costs.customPoints === null || isPositiveInteger(costs.customPoints))) {
    brazil.customPoints = costs.customPoints;
  }
}

function renderInterface() {
  const text = copy();
  const region = REGIONS[preferences.region];
  document.documentElement.lang = preferences.language;
  document.title = text.title;
  document.body.dataset.theme = preferences.theme;
  document.querySelector('#brandLabel').textContent = `${text.market} · ${text.regionNames[preferences.region]}`;
  document.querySelector('#pageTitle').textContent = text.title;
  document.querySelector('#intro').textContent = text.intro;
  document.querySelector('#websiteLinkLabel').textContent = text.websiteLink;
  document.querySelector('#regionButton').title = text.region;
  document.querySelector('#regionButton').setAttribute('aria-label', text.region);
  document.querySelector('#languageButton').title = text.language;
  document.querySelector('#languageButton').setAttribute('aria-label', text.language);
  document.querySelector('#regionOptions').setAttribute('aria-label', text.region);
  document.querySelector('#languageOptions').setAttribute('aria-label', text.language);
  document.querySelector('#regionCode').textContent = region.currency;
  document.querySelector('#languageCode').textContent =
    LANGUAGES.find((item) => item.value === preferences.language).code;
  document.querySelector('#priceLabel').textContent = `${text.price} · ${currencySymbol()}`;
  document.querySelector('#balanceLabel').textContent = text.balance;
  document.querySelector('.purchase-fields').setAttribute('aria-label', text.price);
  document.querySelector('#gamePrice').placeholder = text.pricePlaceholder;
  document.querySelector('#balancePoints').placeholder = text.balancePlaceholder;
  calculateButton.textContent = text.calculate;
  result.setAttribute('aria-label', text.rates);
  result.textContent = text.emptyResult;
  document.querySelector('#ratesTitle').textContent = text.rates;
  cardRates.setAttribute('aria-label', text.rates);
  document.querySelector('#ratesHint').textContent = text.automaticRates;
  document.querySelector('#scannerTitle').textContent = text.scannerTitle;
  document.querySelector('#scannerNote').textContent = text.scannerNote;
  scanButton.textContent = text.scan;
  resetButton.textContent = text.reset;
  document.querySelector('#footerNote').textContent = text.footer;
  scanner.hidden = false;
  renderMenus();
  renderRateFields();
  renderTheme();
  if (activeScanState?.region === preferences.region) {
    renderScanState(activeScanState);
  } else {
    scanButton.disabled = false;
    status.textContent = text.scanOptional;
  }
}

function renderMenus() {
  const text = copy();
  const regionOptions = document.querySelector('#regionOptions');
  regionOptions.replaceChildren();
  for (const [regionId, region] of Object.entries(REGIONS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `menu-option${preferences.region === regionId ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(preferences.region === regionId));
    const name = document.createElement('span');
    name.textContent = text.regionNames[regionId];
    const currency = document.createElement('span');
    currency.className = 'option-meta';
    currency.textContent = region.currency;
    button.append(name, currency);
    button.addEventListener('click', () => selectRegion(regionId));
    regionOptions.append(button);
  }

  const languageOptions = document.querySelector('#languageOptions');
  languageOptions.replaceChildren();
  for (const language of LANGUAGES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `menu-option${preferences.language === language.value ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(preferences.language === language.value));
    const name = document.createElement('span');
    name.textContent = text.languageNames[language.value];
    const code = document.createElement('span');
    code.className = 'option-meta';
    code.textContent = language.code;
    button.append(name, code);
    button.addEventListener('click', () => selectLanguage(language.value));
    languageOptions.append(button);
  }
}

function renderRateFields() {
  const region = REGIONS[preferences.region];
  const values = regionalValues[preferences.region];
  const text = copy();
  const fragment = document.createDocumentFragment();
  for (const amount of region.amounts) {
    const label = document.createElement('label');
    label.textContent = text.fixedCard(formatCurrency(amount));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.inputMode = 'numeric';
    input.placeholder = preferences.region === 'br' ? text.unqueried : text.points;
    input.value = values.rates[String(amount)] ?? '';
    input.dataset.amount = String(amount);
    input.dataset.kind = 'fixed';
    input.disabled = preferences.region === 'br';
    label.append(input);
    fragment.append(label);
  }

  const customAmountLabel = document.createElement('label');
  customAmountLabel.textContent = `${text.customCard} · ${text.referenceAmount} (${currencySymbol()})`;
  const customAmountInput = document.createElement('input');
  customAmountInput.id = 'customAmount';
  customAmountInput.type = 'number';
  customAmountInput.min = String(region.customMin);
  customAmountInput.max = String(region.customMax);
  customAmountInput.step = '1';
  customAmountInput.value = String(values.customAmount);
  customAmountInput.addEventListener('input', () => {
    if (Number(customAmountInput.value) !== values.customAmount) {
      values.customPoints = null;
      const pointsInput = cardRates.querySelector('[data-kind="custom-points"]');
      if (pointsInput) pointsInput.value = '';
      showResult(text.customChanged);
    }
  });
  customAmountInput.addEventListener('change', saveCurrentRegion);
  customAmountLabel.append(customAmountInput);
  fragment.append(customAmountLabel);

  const customPointsInputLabel = document.createElement('label');
  customPointsInputLabel.textContent = text.customPoints;
  const customPointsInput = document.createElement('input');
  customPointsInput.type = 'number';
  customPointsInput.min = '1';
  customPointsInput.step = '1';
  customPointsInput.inputMode = 'numeric';
  customPointsInput.placeholder = preferences.region === 'br' ? text.unqueried : text.points;
  customPointsInput.value = values.customPoints ?? '';
  customPointsInput.dataset.kind = 'custom-points';
  customPointsInput.disabled = preferences.region === 'br';
  customPointsInputLabel.append(customPointsInput);
  fragment.append(customPointsInputLabel);
  cardRates.replaceChildren(fragment);

  const current = regionalValues[preferences.region];
  document.querySelector('#gamePrice').value = current.gamePrice ?? '';
  document.querySelector('#balancePoints').value = current.balancePoints ?? '';
  document.querySelector('#gamePrice').max = String(MAX_GAME_PRICE);
}

function renderTheme() {
  const button = document.querySelector('#themeToggle');
  const label = preferences.theme === 'light' ? copy().switchToDark : copy().switchToLight;
  button.setAttribute('aria-label', label);
  button.title = label;
}

function selectRegion(regionId) {
  if (!REGIONS[regionId] || regionId === preferences.region) {
    closeMenus();
    return;
  }
  void saveCurrentRegion();
  preferences.region = regionId;
  closeMenus();
  renderInterface();
  showResult(copy().emptyResult);
  void savePreferences();
}

function selectLanguage(language) {
  if (!COPY[language]) {
    return;
  }
  preferences.language = language;
  closeMenus();
  renderInterface();
  showResult(copy().emptyResult);
  void savePreferences();
}

function toggleTheme() {
  preferences.theme = preferences.theme === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = preferences.theme;
  renderTheme();
  void savePreferences();
}

function closeOtherMenu(menuId, otherMenuId) {
  if (document.querySelector(`#${menuId}`).open) {
    document.querySelector(`#${otherMenuId}`).open = false;
  }
}

function closeMenus() {
  document.querySelector('#regionMenu').open = false;
  document.querySelector('#languageMenu').open = false;
}

function onRateInput(event) {
  if (event.target.matches('input')) {
    showResult(copy().changedResult);
  }
}

function currentFormValues() {
  const regionId = preferences.region;
  const values = regionalValues[regionId];
  values.gamePrice = readPersistedValue('gamePrice', document.querySelector('#gamePrice').value);
  values.balancePoints = readPersistedValue('balancePoints', document.querySelector('#balancePoints').value);
  values.customAmount = readPersistedValue('customAmount', cardRates.querySelector('#customAmount').value)
    ?? REGIONS[regionId].customMin;
  if (regionId !== 'br') {
    const customPoints = cardRates.querySelector('[data-kind="custom-points"]').value;
    values.customPoints = readPersistedValue('customPoints', customPoints);
  }
  values.rates = { ...values.rates };
  for (const input of cardRates.querySelectorAll('[data-kind="fixed"]')) {
    values.rates[input.dataset.amount] = readPersistedValue('rate', input.value);
  }
  return values;
}

async function saveCurrentRegion() {
  const savedRegion = preferences.region;
  try {
    currentFormValues();
    await saveRegionalValues();
    if (savedRegion === 'br') {
      await saveBrazilCosts();
    }
  } catch (error) {
    status.textContent = interpolate(copy().savedError, { error: errorMessage(error) });
  }
}

async function saveRegionalValues() {
  try {
    await chrome.storage.local.set({ [REGIONAL_COSTS_KEY]: regionalValues });
  } catch (error) {
    status.textContent = interpolate(copy().savedError, { error: errorMessage(error) });
  }
}

async function saveBrazilCosts() {
  const br = regionalValues.br;
  const costs = {
    gamePrice: br.gamePrice,
    balancePoints: br.balancePoints,
    customAmount: br.customAmount,
    customPoints: br.customPoints,
  };
  for (const amount of REGIONS.br.amounts) {
    costs[`card${amount}`] = br.rates[String(amount)] ?? null;
  }
  await chrome.storage.local.set({ [COSTS_KEY]: costs });
}

async function savePreferences() {
  try {
    await chrome.storage.local.set({ [PREFERENCES_KEY]: preferences });
  } catch (error) {
    status.textContent = interpolate(copy().savedError, { error: errorMessage(error) });
  }
}

function calculateStrategy() {
  const text = copy();
  const region = REGIONS[preferences.region];
  const values = currentFormValues();
  const gamePrice = values.gamePrice;
  const balancePoints = values.balancePoints;
  const customAmount = values.customAmount;
  const customPoints = preferences.region === 'br'
    ? values.customPoints
    : readPersistedValue('customPoints', cardRates.querySelector('[data-kind="custom-points"]').value);
  values.customPoints = customPoints;

  if (!isValidPrice(gamePrice)) {
    showResult(interpolate(text.priceInvalid, {
      zero: formatCurrency(0),
      max: formatCurrency(MAX_GAME_PRICE),
    }));
    return;
  }
  if (
    region.amounts.some((amount) => !isPositiveInteger(values.rates[String(amount)])) ||
    !isPositiveInteger(customPoints)
  ) {
    showResult(text.costsMissing);
    return;
  }
  if (!isValidCustomAmount(preferences.region, customAmount)) {
    showResult(interpolate(text.customInvalid, {
      min: formatCurrency(region.customMin),
      max: formatCurrency(region.customMax),
    }));
    return;
  }

  const options = region.amounts.map((amount) => ({
    amount: Math.round(amount * UNITS_PER_CURRENCY),
    points: values.rates[String(amount)],
  }));
  for (let amount = region.customMin; amount <= region.customMax; amount++) {
    options.push({
      amount: amount * UNITS_PER_CURRENCY,
      points: Math.ceil((customPoints * amount) / customAmount),
    });
  }

  const targetAmount = Math.ceil(gamePrice * UNITS_PER_CURRENCY - Number.EPSILON);
  const maxAmount = targetAmount + MAX_OVERPAY * UNITS_PER_CURRENCY;
  const bestPoints = new Array(maxAmount + 1).fill(Number.POSITIVE_INFINITY);
  const bestCardCount = new Array(maxAmount + 1).fill(Number.POSITIVE_INFINITY);
  const previousAmount = new Array(maxAmount + 1).fill(-1);
  const previousOption = new Array(maxAmount + 1).fill(-1);
  bestPoints[0] = 0;
  bestCardCount[0] = 0;

  for (let amount = 0; amount <= maxAmount; amount++) {
    if (!Number.isFinite(bestPoints[amount])) continue;
    for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
      const nextAmount = amount + options[optionIndex].amount;
      if (nextAmount > maxAmount) continue;
      const nextPoints = bestPoints[amount] + options[optionIndex].points;
      const nextCardCount = bestCardCount[amount] + 1;
      if (
        nextPoints < bestPoints[nextAmount] ||
        (nextPoints === bestPoints[nextAmount] && nextCardCount < bestCardCount[nextAmount])
      ) {
        bestPoints[nextAmount] = nextPoints;
        bestCardCount[nextAmount] = nextCardCount;
        previousAmount[nextAmount] = amount;
        previousOption[nextAmount] = optionIndex;
      }
    }
  }

  let chosenAmount = -1;
  for (let amount = targetAmount; amount <= maxAmount; amount++) {
    if (!Number.isFinite(bestPoints[amount])) continue;
    if (
      chosenAmount < 0 ||
      bestPoints[amount] < bestPoints[chosenAmount] ||
      (bestPoints[amount] === bestPoints[chosenAmount] && amount < chosenAmount) ||
      (bestPoints[amount] === bestPoints[chosenAmount] &&
        amount === chosenAmount &&
        bestCardCount[amount] < bestCardCount[chosenAmount])
    ) {
      chosenAmount = amount;
    }
  }

  if (chosenAmount < 0) {
    showResult(text.noCombination);
    return;
  }

  const counts = new Map();
  let amount = chosenAmount;
  while (amount > 0) {
    const optionIndex = previousOption[amount];
    const previous = previousAmount[amount];
    if (optionIndex < 0 || previous < 0) {
      showResult(text.invalidPlan);
      return;
    }
    const option = options[optionIndex];
    const key = `${option.amount}:${option.points}`;
    const card = counts.get(key) ?? { amount: option.amount, points: option.points, count: 0 };
    card.count++;
    counts.set(key, card);
    amount = previous;
  }

  const cards = [...counts.values()]
    .sort((first, second) => second.amount - first.amount || second.points - first.points);
  renderPlan({
    gamePrice,
    balancePoints,
    customAmount,
    totalAmount: chosenAmount,
    totalPoints: bestPoints[chosenAmount],
    cards,
  });
  void saveCurrentRegion();
}

function renderPlan(plan) {
  const text = copy();
  result.replaceChildren();
  result.classList.add('has-result');
  const title = document.createElement('div');
  title.className = 'result-title';
  title.textContent = text.estimate(formatPoints(plan.totalPoints));
  result.append(title);
  result.append(document.createTextNode(
    text.cardsToCover(formatCurrency(plan.totalAmount / UNITS_PER_CURRENCY), formatCurrency(plan.gamePrice)) +
      (plan.totalAmount / UNITS_PER_CURRENCY > plan.gamePrice
        ? text.abovePrice(formatCurrency(plan.totalAmount / UNITS_PER_CURRENCY - plan.gamePrice))
        : ''),
  ));

  for (const card of plan.cards) {
    const row = document.createElement('div');
    row.className = 'result-row';
    const description = document.createElement('span');
    description.textContent = `${card.count} × ${formatCurrency(card.amount / UNITS_PER_CURRENCY)}`;
    const cardPoints = document.createElement('strong');
    cardPoints.textContent = `${formatPoints(card.count * card.points)} ${text.points}`;
    row.append(description, cardPoints);
    result.append(row);
  }

  const estimateNote = document.createElement('p');
  estimateNote.className = 'result-note';
  estimateNote.textContent = text.estimateNote(formatCurrency(plan.customAmount));
  result.append(estimateNote);
  if (plan.balancePoints !== null) {
    const balance = document.createElement('div');
    balance.className = 'result-balance';
    balance.textContent = plan.balancePoints >= plan.totalPoints
      ? text.enough(formatPoints(plan.balancePoints - plan.totalPoints))
      : text.short(formatPoints(plan.totalPoints - plan.balancePoints));
    result.append(balance);
  }
}

function showResult(message) {
  result.classList.remove('has-result');
  result.textContent = message;
}

async function startScan() {
  scanButton.disabled = true;
  status.textContent = copy().startScan;
  const region = REGIONS[preferences.region];
  const customAmount = readPositiveInteger(cardRates.querySelector('#customAmount').value);
  if (!isValidCustomAmount(preferences.region, customAmount)) {
    status.textContent = interpolate(copy().scanCustomInvalid, {
      min: formatCurrency(region.customMin),
      max: formatCurrency(region.customMax),
    });
    scanButton.disabled = false;
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'scan-cards',
      region: preferences.region,
      customAmount,
    });
    status.textContent = response?.ok
      ? `${response.message} ${copy().scanClosePopup}`
      : interpolate(copy().scanStartError, { error: response?.error ?? copy().scanStartErrorUnknown });
  } catch (error) {
    status.textContent = interpolate(copy().scanStartError, { error: errorMessage(error) });
  } finally {
    const saved = await chrome.storage.local.get(STATE_KEY);
    if (saved[STATE_KEY]?.region === preferences.region) {
      activeScanState = saved[STATE_KEY];
      renderScanState(activeScanState);
    } else {
      activeScanState = saved[STATE_KEY] ?? null;
      scanButton.disabled = false;
    }
  }
}

async function resetScan() {
  resetButton.disabled = true;
  status.textContent = copy().resetInProgress;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'reset-scan' });
    status.textContent = response?.message ?? copy().scanReset;
    scanButton.disabled = false;
  } catch (error) {
    status.textContent = interpolate(copy().scanResetError, { error: errorMessage(error) });
  } finally {
    resetButton.disabled = false;
  }
}

function renderScanState(state) {
  if (!state || typeof state.scanId !== 'string' || preferences.region !== state.region) {
    return;
  }
  const text = copy();
  const resultMessages = Object.values(state.results ?? {}).map((entry) =>
    entry.status === 'found'
      ? text.scanResult(formatCurrency(entry.amount), formatPoints(entry.points), entry.message)
      : text.scanFailure(formatCurrency(entry.amount), entry.message),
  );
  status.textContent = [state.message, ...resultMessages].filter(Boolean).join('\n');
  scanButton.disabled = state.status === 'scanning';
  resetButton.disabled = false;
  for (const [field, entry] of Object.entries(state.results ?? {})) {
    if (entry?.status !== 'found') continue;
    if (field.startsWith('rate:')) {
      regionalValues[state.region].rates[field.slice('rate:'.length)] = entry.points;
    }
    if (field === 'customPoints') {
      regionalValues[state.region].customPoints = entry.points;
      if (isValidCustomAmount(state.region, entry.customAmount)) {
        regionalValues[state.region].customAmount = entry.customAmount;
      }
    }
  }
  renderRateFields();
  void saveCurrentRegion();
}

function readPositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function readPersistedValue(field, input) {
  if (typeof input !== 'string' || input.trim() === '') return null;
  const value = Number(input);
  if (field === 'gamePrice') return isValidPrice(value) ? value : null;
  if (field === 'balancePoints') return isValidBalance(value) ? value : null;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isValidPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_GAME_PRICE;
}

function isValidBalance(value) {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function isValidCustomAmount(regionId, value) {
  const region = REGIONS[regionId];
  return Number.isInteger(value) && value >= region.customMin && value <= region.customMax;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPoints(value) {
  return new Intl.NumberFormat(preferences.language, { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value) {
  const region = REGIONS[preferences.region];
  return new Intl.NumberFormat(region.locale, { style: 'currency', currency: region.currency }).format(value);
}

function currencySymbol() {
  const region = REGIONS[preferences.region];
  return new Intl.NumberFormat(region.locale, { style: 'currency', currency: region.currency })
    .formatToParts(0)
    .find((part) => part.type === 'currency').value;
}

function interpolate(message, values) {
  return message.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
