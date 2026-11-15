const MAX_WAIT_MS = 15_000;
const MAX_PLAUSIBLE_CARD_COST = 200_000;
const CUSTOM_RECALCULATION_DELAY_MS = 1_000;
const CARD_LOOKUP = createCardLookup();
const CARD = CARD_LOOKUP[new URL(location.href).pathname.split('/').pop()];
const REGION = CARD ? REWARDS_REGIONS[CARD.regionId] : null;
let completed = false;
let customAmount = null;
let customInputChanged = false;
let hasAmbiguousCosts = false;
let customInputFound = false;
let lastCandidates = [];
let observer = null;
let rewardReadTimer = null;

if (CARD && REGION) {
  observer = new MutationObserver(() => {
    if (customInputChanged) {
      return;
    }
    if (CARD.custom && prepareCustomAmount()) {
      customInputChanged = true;
      setTimeout(tryReadReward, CUSTOM_RECALCULATION_DELAY_MS);
      return;
    }
    scheduleRewardRead();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });

  if (CARD.custom) {
    customAmount = getRequestedCustomAmount();
    const changed = customAmount === null ? prepareCustomAmount() : false;
    customInputChanged = true;
    customInputFound = customAmount !== null || customInputFound;
    scheduleCustomRead(changed ? CUSTOM_RECALCULATION_DELAY_MS : 500);
  } else {
    scheduleRewardRead();
  }
  setTimeout(() => {
    if (!completed) {
      finish({
        status: 'error',
        message: hasAmbiguousCosts
          ? `A página mostrou vários custos possíveis (${lastCandidates.map(formatPoints).join(', ')} pontos). Não foi possível identificar o custo de ${formatCurrency(CARD.custom ? customAmount : CARD.amount)}; confira o cartão manualmente.`
          : !CARD.custom
            ? `Não foi possível identificar com segurança o custo de ${formatCurrency(CARD.amount)}. Confira se a página carregou e informe o valor manualmente.`
            : customInputFound
              ? `O valor personalizado foi atualizado, mas o custo em pontos não apareceu em 15 segundos. Confira o cartão de ${REGION.currency} manualmente.`
              : 'O campo de valor do cartão personalizado não foi encontrado. Confira o cartão manualmente.',
      });
    }
  }, MAX_WAIT_MS);
}

function createCardLookup() {
  const lookup = {};
  for (const [regionId, region] of Object.entries(REWARDS_REGIONS)) {
    for (const amount of region.amounts) {
      lookup[region.fixedSkus[String(amount)]] = {
        regionId,
        amount,
        field: `rate:${amount}`,
        custom: false,
      };
    }
    lookup[region.customSku] = {
      regionId,
      amount: region.customMin,
      field: 'customPoints',
      custom: true,
    };
  }
  return lookup;
}

function tryReadReward() {
  if (completed) {
    return;
  }
  const { candidates, rejected, pointMatches } = findVisiblePointValues();
  const selected = selectPointCost(candidates, pointMatches);
  if (selected !== null) {
    finish({
      status: 'found',
      points: selected,
      ...(customAmount === null ? {} : { customAmount }),
      message: rejected.length > 0
        ? `Custo detectado: ${formatPoints(selected)}. Ignorado valor alto que parece ser o saldo total da conta (${rejected.map(formatPoints).join(', ')} pontos). Confira antes de usar.`
        : 'Foi encontrado um valor de pontos. Confira-o antes de usar.',
    });
  } else if (candidates.length > 1) {
    hasAmbiguousCosts = true;
    lastCandidates = candidates;
  } else if (rejected.length > 0) {
    hasAmbiguousCosts = true;
    lastCandidates = rejected;
  }
}

function scheduleCustomRead(delay) {
  setTimeout(() => {
    if (completed) {
      return;
    }
    tryReadReward();
    if (!completed) {
      scheduleCustomRead(750);
    }
  }, delay);
}

function scheduleRewardRead(delay = 800) {
  clearTimeout(rewardReadTimer);
  rewardReadTimer = setTimeout(tryReadReward, delay);
}

function findVisiblePointValues() {
  const text = document.body?.innerText ?? '';
  const discountValues = findDiscountPointValues();
  const pointMatches = findPointMatches(text)
    .filter((match) =>
      !discountValues.has(match.value) &&
      !isDiscountPointMatch(text, match),
    );
  const allValues = [...new Set(pointMatches.map((match) => match.value))].sort((a, b) => a - b);
  return {
    candidates: allValues.filter((value) => value <= MAX_PLAUSIBLE_CARD_COST),
    rejected: allValues.filter((value) => value > MAX_PLAUSIBLE_CARD_COST),
    pointMatches: pointMatches.filter((match) => match.value <= MAX_PLAUSIBLE_CARD_COST),
  };
}

function findDiscountPointValues() {
  const values = new Set();
  const discountPattern = /desconto|discount(?:ed)?|savings?|saved|ahorro|rebaja/i;
  for (const element of document.querySelectorAll('body *')) {
    if (element.getClientRects().length === 0 || element.getAttribute('aria-hidden') === 'true') {
      continue;
    }
    const text = [
      element.innerText,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
    ].filter((value) => typeof value === 'string').join(' ').trim();
    if (!text || text.length > 500 || !discountPattern.test(text)) {
      continue;
    }
    const pointValues = new Set(findPointMatches(text).map((match) => match.value));
    if (pointValues.size === 1) {
      values.add([...pointValues][0]);
    }
  }
  return values;
}

function isDiscountPointMatch(text, pointMatch) {
  const numberPattern = '[\\d]+(?:[.,\\u00a0\\u202f ]\\d{3})*';
  const unitPattern = '(?:points?|pontos?|puntos?|pts)';
  const discountPattern = '(?:desconto|discount(?:ed)?|savings?|saved|ahorro|rebaja)';
  const inlineSpace = '[\\t \\u00a0\\u202f]*';
  const patterns = [
    new RegExp(`(${numberPattern})${inlineSpace}${unitPattern}${inlineSpace}(?:de${inlineSpace})?${discountPattern}`, 'gi'),
    new RegExp(`${discountPattern}${inlineSpace}(?:de${inlineSpace})?(${numberPattern})${inlineSpace}${unitPattern}`, 'gi'),
  ];
  return patterns.some((pattern) => [...text.matchAll(pattern)].some((match) => {
    const value = Number(match[1].replace(/\D/g, ''));
    const index = match.index + match[0].indexOf(match[1]);
    return value === pointMatch.value && index === pointMatch.index;
  }));
}

function findPointMatches(text) {
  const patterns = [
    /([\d]+(?:[.,\u00a0\u202f ]\d{3})*)[\s\u00a0\u202f]{0,80}(?:points?|pontos?|puntos?|pts)\b/gi,
    /(?:points?|pontos?|puntos?|pts)[\s\u00a0\u202f]{0,80}[:\-]?[\s\u00a0\u202f]{0,80}([\d]+(?:[.,\u00a0\u202f ]\d{3})*)/gi,
  ];
  const matches = [];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1].replace(/\D/g, ''));
      const index = match.index + match[0].indexOf(match[1]);
      const key = `${value}:${index}`;
      if (Number.isSafeInteger(value) && value > 0 && !seen.has(key)) {
        seen.add(key);
        matches.push({ value, index });
      }
    }
  }
  return matches;
}

function selectPointCost(candidates, pointMatches) {
  if (candidates.length === 0) {
    return null;
  }

  const amount = CARD.custom ? customAmount : CARD.amount;
  const geometricMatch = findGeometricPointCost(candidates, amount);
  if (geometricMatch !== null) {
    return geometricMatch;
  }

  const text = document.body?.innerText ?? '';
  const amountPositions = createAmountPatterns(amount)
    .flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match.index));
  if (CARD.custom) {
    amountPositions.push(...[...text.matchAll(/valor personalizado|personalizado|custom/gi)]
      .map((match) => match.index));
  }
  if (amountPositions.length === 0) {
    return null;
  }

  const nearbyMatches = pointMatches
    .map((pointMatch) => ({
      ...pointMatch,
      distance: Math.min(
        ...amountPositions.map((position) => Math.abs(pointMatch.index - position)),
      ),
    }))
    .filter((pointMatch) => Number.isFinite(pointMatch.distance) && pointMatch.distance <= 500);
  if (nearbyMatches.length === 0) {
    return null;
  }

  const closestDistance = Math.min(...nearbyMatches.map((pointMatch) => pointMatch.distance));
  const closestValues = new Set(
    nearbyMatches
      .filter((pointMatch) => pointMatch.distance === closestDistance)
      .map((pointMatch) => pointMatch.value),
  );
  return closestValues.size === 1 ? [...closestValues][0] : null;
}

function findGeometricPointCost(candidates, amount) {
  const candidateSet = new Set(candidates);
  const amountPatterns = createAmountPatterns(amount);
  const amountAnchors = [];
  const pointAnchors = new Map();

  for (const element of document.querySelectorAll('body *')) {
    if (element.getClientRects().length === 0 || element.getAttribute('aria-hidden') === 'true') {
      continue;
    }
    const text = typeof element.innerText === 'string' ? element.innerText.trim() : '';
    if (!text || text.length > 500) {
      continue;
    }
    const bounds = element.getBoundingClientRect();
    const center = {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };

    if (matchesAnyPattern(text, amountPatterns)) {
      amountAnchors.push({ textLength: text.length, center });
    }

    const pointMatches = findPointMatches(text)
      .filter((match) => candidateSet.has(match.value) && !isDiscountPointMatch(text, match));
    const values = new Set(pointMatches.map((match) => match.value));
    if (values.size !== 1) {
      continue;
    }
    const value = [...values][0];
    const current = pointAnchors.get(value);
    if (!current || text.length < current.textLength) {
      pointAnchors.set(value, { textLength: text.length, center });
    }
  }

  if (amountAnchors.length === 0 || pointAnchors.size === 0) {
    return null;
  }
  const shortestAmountAnchor = Math.min(...amountAnchors.map((anchor) => anchor.textLength));
  const anchors = amountAnchors.filter((anchor) => anchor.textLength === shortestAmountAnchor);
  const scored = [...pointAnchors].map(([value, point]) => ({
    value,
    distance: Math.min(...anchors.map((anchor) => Math.hypot(
      point.center.x - anchor.center.x,
      point.center.y - anchor.center.y,
    ))),
  })).sort((left, right) => left.distance - right.distance);

  if (scored.length === 0 || scored[0].distance > 600) {
    return null;
  }
  if (scored.length > 1 && Math.abs(scored[1].distance - scored[0].distance) < 20) {
    return null;
  }
  return scored[0].value;
}

function matchesAnyPattern(text, patterns) {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function createAmountPatterns(amount) {
  const formatted = formatCurrency(amount);
  const number = new Intl.NumberFormat(REGION.locale, {
    maximumFractionDigits: 2,
  }).format(amount);
  const symbol = new Intl.NumberFormat(REGION.locale, {
    style: 'currency',
    currency: REGION.currency,
  }).formatToParts(amount).find((part) => part.type === 'currency').value;
  const flexibleFormatted = escapeRegExp(formatted).replace(/[\s\u00a0\u202f]+/g, '\\s*');
  const flexibleNumber = escapeRegExp(number).replace(/[\s\u00a0\u202f]+/g, '\\s*');
  const flexibleSymbol = escapeRegExp(symbol);
  const currencyCode = escapeRegExp(REGION.currency);
  return [
    new RegExp(`(?<![\\d.,])${flexibleFormatted}(?![\\d.,])`, 'gi'),
    new RegExp(`(?<![\\d.,])(?:${flexibleSymbol}|${currencyCode})\\s*${flexibleNumber}(?![\\d.,])`, 'gi'),
    new RegExp(`(?<![\\d.,])${flexibleNumber}\\s*(?:${flexibleSymbol}|${currencyCode})(?![\\d.,])`, 'gi'),
  ];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCustomCard() {
  return CARD?.custom === true;
}

function getRequestedCustomAmount() {
  const value = Number(new URL(location.href).searchParams.get('c'));
  return isValidCustomAmount(value) ? value : null;
}

function isValidCustomAmount(value) {
  return Number.isInteger(value) && value >= REGION.customMin && value <= REGION.customMax;
}

function prepareCustomAmount() {
  const input = findCustomAmountInput();
  if (!input) {
    return false;
  }
  customInputFound = true;

  const minimum = Number(input.min ?? input.getAttribute('aria-valuemin'));
  const current = Number(input.value);
  const target = isValidCustomAmount(current)
    ? current
    : isValidCustomAmount(minimum)
      ? minimum
      : REGION.customMin;

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) {
    customInputFound = false;
    return false;
  }

  if (current !== target) {
    setter.call(input, String(target));
  }
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: String(target),
  }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
  input.blur();
  customAmount = target;
  return true;
}

function findCustomAmountInput() {
  const candidates = [...document.querySelectorAll('input, [role="spinbutton"]')].filter((input) => {
    const label = [
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder'),
      input.getAttribute('name'),
      input.getAttribute('id'),
      ...Array.from(input.labels ?? [], (item) => item.innerText),
    ].filter(Boolean).join(' ');
    const minimum = Number(input.min ?? input.getAttribute('aria-valuemin'));
    const maximum = Number(input.max ?? input.getAttribute('aria-valuemax'));
    const hasCustomRange = minimum >= REGION.customMin || maximum === REGION.customMax;
    const identifiesAmount = /valor|amount|gift|value|reais|R\$|dólares|euros|currency|importe|importe|cantidad/i.test(label);
    return input.getClientRects().length > 0 &&
      !input.disabled &&
      (input.type === 'number' || input.getAttribute('role') === 'spinbutton' || identifiesAmount) &&
      (hasCustomRange || identifiesAmount);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function finish(result) {
  if (completed) {
    return;
  }
  completed = true;
  observer.disconnect();
  chrome.runtime.sendMessage({
    type: 'card-scan-result',
    region: CARD.regionId,
    field: CARD.field,
    ...result,
  }).then((response) => {
    if (!response?.ok) {
      console.error('Microsoft Rewards card scan result was rejected:', response?.error);
    }
  }).catch((error) => {
    console.error('Microsoft Rewards card scan could not report its result:', error);
  });
}

function formatPoints(value) {
  return new Intl.NumberFormat(REGION.locale).format(value);
}

function formatCurrency(value) {
  return new Intl.NumberFormat(REGION.locale, {
    style: 'currency',
    currency: REGION.currency,
  }).format(value);
}
