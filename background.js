if (typeof REWARDS_REGIONS === 'undefined') {
  importScripts('regions.js');
}

const STATE_KEY = 'rewards-card-scan-state-v1';
const COSTS_KEY = 'rewards-card-costs-v1';
const REGIONAL_COSTS_KEY = 'rewards-calculator-regional-costs-v1';
const TIMEOUT_ALARM = 'rewards-card-scan-timeout';
const SCAN_TIMEOUT_MINUTES = 0.5;
const STALE_SCAN_TIMEOUT_MS = 2 * 60 * 1000;
let resultQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'scan-cards') {
    startScan(message.region, message.customAmount, message.customMaxAmount).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: errorMessage(error) });
    });
    return true;
  }

  if (message?.type === 'reset-scan') {
    resetScan().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: errorMessage(error) });
    });
    return true;
  }

  if (message?.type === 'card-scan-result') {
    enqueueResult(() => recordResult(message, sender)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: errorMessage(error) });
    });
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TIMEOUT_ALARM) {
    enqueueResult(finishTimedOutScan).catch((error) => {
      console.error('Could not finish the Microsoft Rewards scan:', errorMessage(error));
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (typeof changeInfo.url === 'string' && !changeInfo.url.startsWith('https://rewards.bing.com/redeem/sku/')) {
    enqueueResult(() => recordRedirect(tabId)).catch((error) => {
      console.error('Could not record a Microsoft Rewards redirect:', errorMessage(error));
    });
  }
});

async function startScan(regionId, requestedAmount, requestedMaxAmount) {
  if (!Object.hasOwn(REWARDS_REGIONS, regionId)) {
    return { ok: false, error: 'Região não suportada para leitura.' };
  }
  const region = REWARDS_REGIONS[regionId];
  const stored = await chrome.storage.local.get(STATE_KEY);
  const previous = stored[STATE_KEY];
  if (previous?.status === 'scanning' && Array.isArray(previous.cards) && previous.region) {
    if (Date.now() - previous.startedAt < STALE_SCAN_TIMEOUT_MS) {
      return { ok: true, message: 'A leitura já está em andamento. Reabra este popup para ver o progresso.' };
    }
    await resetScan('Leitura anterior travada foi encerrada. Iniciando uma nova leitura.');
  } else if (previous?.status === 'scanning') {
    await resetScan('Leitura anterior incompatível foi encerrada. Iniciando uma nova leitura.');
  }

  if (requestedAmount !== undefined &&
    (!Number.isInteger(requestedAmount) ||
      requestedAmount < region.customMin ||
      requestedAmount > region.customMax)) {
    return { ok: false, error: 'Valor do cartão personalizado fora dos limites da região.' };
  }
  if (requestedMaxAmount !== undefined && requestedMaxAmount !== region.customMax) {
    return { ok: false, error: 'Valor máximo do cartão personalizado inválido.' };
  }

  const scanId = crypto.randomUUID();
  const savedCosts = await chrome.storage.local.get([COSTS_KEY, REGIONAL_COSTS_KEY]);
  const regionalCustomAmount = savedCosts[REGIONAL_COSTS_KEY]?.[regionId]?.customAmount;
  const legacyCustomAmount = regionId === 'br' ? savedCosts[COSTS_KEY]?.customAmount : null;
  const savedCustomAmount = Number.isInteger(regionalCustomAmount) ? regionalCustomAmount : legacyCustomAmount;
  const customAmount = Number.isInteger(requestedAmount) &&
      requestedAmount >= region.customMin && requestedAmount <= region.customMax
    ? requestedAmount
    : Number.isInteger(savedCustomAmount) &&
        savedCustomAmount >= region.customMin &&
        savedCustomAmount <= region.customMax
      ? savedCustomAmount
      : region.customMin;
  const cards = [
    ...region.amounts.map((amount) => ({
      field: `rate:${amount}`,
      amount,
      sku: region.fixedSkus[String(amount)],
    })),
    { field: 'customPoints', amount: customAmount, sku: region.customSku },
  ];
  if (customAmount !== region.customMax) {
    cards.push({
      field: 'customMaxPoints',
      amount: region.customMax,
      sku: region.customSku,
    });
  }
  const tabMap = {};
  const state = {
    scanId,
    region: regionId,
    status: 'scanning',
    message: 'Preparando as páginas dos cartões...',
    startedAt: Date.now(),
    customAmount,
    customMaxAmount: region.customMax,
    cards,
    tabs: tabMap,
    results: {},
  };
  await chrome.storage.local.set({ [STATE_KEY]: state });
  chrome.alarms.create(TIMEOUT_ALARM, { delayInMinutes: SCAN_TIMEOUT_MINUTES });

  for (const card of cards) {
    const currentState = await chrome.storage.local.get(STATE_KEY);
    if (currentState[STATE_KEY]?.scanId !== scanId || currentState[STATE_KEY]?.status !== 'scanning') {
      break;
    }
    try {
      const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
      if (typeof tab.id !== 'number') {
        await saveResult(scanId, card, { status: 'error', message: 'Não foi possível criar uma aba.' });
        continue;
      }

      tabMap[String(tab.id)] = card.field;
      const current = await chrome.storage.local.get(STATE_KEY);
      if (current[STATE_KEY]?.scanId === scanId) {
        await chrome.storage.local.set({
          [STATE_KEY]: {
            ...current[STATE_KEY],
            tabs: { ...current[STATE_KEY].tabs, [String(tab.id)]: card.field },
            message: 'Abrindo os cartões em abas de fundo...',
          },
        });
      }
      await chrome.tabs.update(tab.id, {
        url: card.field === 'customPoints' || card.field === 'customMaxPoints'
          ? `https://rewards.bing.com/redeem/sku/${card.sku}?c=${card.amount}&profitmrField=${card.field}`
          : `https://rewards.bing.com/redeem/sku/${card.sku}`,
      });
    } catch (error) {
      await saveResult(scanId, card, {
        status: 'error',
        message: `Não foi possível abrir a página: ${errorMessage(error)}`,
      });
    }
  }

  return { ok: true, message: 'Leitura iniciada. Reabra a extensão para conferir os resultados.' };
}

async function resetScan(message = 'Leitura cancelada. Os custos salvos foram mantidos.') {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];
  await chrome.alarms.clear(TIMEOUT_ALARM);
  if (!state) {
    return { ok: true, message: 'Leitura reiniciada. Nenhum custo salvo foi removido.' };
  }

  await chrome.storage.local.set({
    [STATE_KEY]: {
      ...state,
      status: 'cancelled',
      message,
    },
  });
  const tabIds = Object.keys(state.tabs ?? {})
    .map(Number)
    .filter((tabId) => Number.isInteger(tabId));
  const outcomes = await Promise.allSettled(tabIds.map((tabId) => chrome.tabs.remove(tabId)));
  const failed = outcomes.filter((outcome) => outcome.status === 'rejected').length;
  return {
    ok: true,
    message: failed
      ? `${message} Não foi possível fechar ${failed} aba(s); feche-as manualmente.`
      : message,
  };
}

async function recordResult(message, sender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    return { ok: false, error: 'Resultado recebido sem uma aba identificada.' };
  }
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];
  if (
    !state ||
    state.status !== 'scanning' ||
    state.region !== message.region ||
    state.tabs[String(tabId)] !== message.field
  ) {
    return { ok: false, error: 'O resultado não corresponde à leitura atual.' };
  }
  if (state.results[message.field]) {
    return { ok: false, error: 'Este cartão já foi processado nesta leitura.' };
  }

  const configuredCard = state.cards?.find((item) => item.field === message.field);
  if (!configuredCard) {
    return { ok: false, error: 'Cartão desconhecido.' };
  }
  const card = configuredCard;

  const status = message.status === 'found' &&
      Number.isSafeInteger(message.points) &&
      message.points > 0
    ? 'found'
    : 'error';
  const result = {
    status,
    message: status === 'found'
      ? message.message || 'Pontos encontrados; confira o valor.'
      : message.message || 'Não foi possível detectar os pontos nesta página.',
  };
  if (status === 'found') {
    result.points = message.points;
    if (
      Number.isInteger(message.customAmount) &&
      message.customAmount >= REWARDS_REGIONS[state.region].customMin &&
      message.customAmount <= REWARDS_REGIONS[state.region].customMax
    ) {
      result.customAmount = message.customAmount;
    }
  }

  await saveResult(state.scanId, card, result);
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    await updateMessage(state.scanId, `Resultado salvo, mas uma aba não pôde ser fechada: ${errorMessage(error)}`);
  }
  return { ok: true };
}

async function saveResult(scanId, card, result) {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];
  if (!state || state.scanId !== scanId || state.status !== 'scanning') {
    return;
  }

  const results = { ...state.results, [card.field]: { ...result, amount: card.amount } };
  const finished = Object.keys(results).length >= state.cards.length;
  const failures = Object.values(results).filter((entry) => entry.status !== 'found').length;
  const nextState = {
    ...state,
    results,
    status: finished ? (failures === 0 ? 'complete' : 'partial') : 'scanning',
    message: finished
      ? failures === 0
        ? 'Leitura concluída. Confira os pontos detectados antes de enviar.'
        : 'Leitura parcial. Confira os campos não detectados ou preencha-os manualmente.'
      : `Leitura em andamento: ${Object.keys(results).length} de ${state.cards.length} páginas respondidas.`,
  };
  await chrome.storage.local.set({ [STATE_KEY]: nextState });
  await applyFoundCosts(nextState);

  if (finished) {
    await chrome.alarms.clear(TIMEOUT_ALARM);
  }
}

async function applyFoundCosts(state) {
  const regionId = state.region;
  const stored = await chrome.storage.local.get([COSTS_KEY, REGIONAL_COSTS_KEY]);
  const regionalCosts = { ...(stored[REGIONAL_COSTS_KEY] ?? {}) };
  const regionCosts = { ...(regionalCosts[regionId] ?? {}) };
  const rates = { ...(regionCosts.rates ?? {}) };
  const legacyCosts = { ...(stored[COSTS_KEY] ?? {}) };
  let changed = false;
  for (const card of state.cards) {
    const field = card.field;
    const result = state.results[field];
    if (result?.status === 'found') {
      if (field === 'customPoints') {
        regionCosts.customPoints = result.points;
        if (result.customAmount) {
          regionCosts.customAmount = result.customAmount;
        }
      } else if (field === 'customMaxPoints') {
        regionCosts.customMaxPoints = result.points;
      } else {
        rates[String(card.amount)] = result.points;
      }
      changed = true;
      if (regionId === 'br') {
        if (field === 'customPoints') {
          legacyCosts.customPoints = result.points;
          if (result.customAmount) {
            legacyCosts.customAmount = result.customAmount;
          }
        } else if (field === 'customMaxPoints') {
          legacyCosts.customMaxPoints = result.points;
        } else {
          legacyCosts[`card${card.amount}`] = result.points;
        }
      }
    }
  }
  if (changed) {
    regionCosts.rates = rates;
    regionalCosts[regionId] = regionCosts;
    const changes = { [REGIONAL_COSTS_KEY]: regionalCosts };
    if (regionId === 'br') {
      changes[COSTS_KEY] = legacyCosts;
    }
    await chrome.storage.local.set(changes);
  }
}

async function recordRedirect(tabId) {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];
  const field = state?.tabs?.[String(tabId)];
  const card = state?.cards?.find((item) => item.field === field);
  if (state?.status !== 'scanning' || !card) {
    return;
  }
  await saveResult(state.scanId, card, {
    status: 'error',
    message: 'A Microsoft redirecionou a página. Confirme se você está conectado ao Rewards.',
  });
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    await updateMessage(state.scanId, `Não foi possível fechar uma aba redirecionada: ${errorMessage(error)}`);
  }
}

async function finishTimedOutScan() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];
  if (!state || state.status !== 'scanning') {
    return;
  }
  if (!Array.isArray(state.cards) || !Object.hasOwn(REWARDS_REGIONS, state.region)) {
    await resetScan('Leitura incompatível encerrada. Inicie uma nova leitura.');
    return;
  }

  const pendingTabIds = Object.entries(state.tabs ?? {})
    .filter(([, field]) => !state.results[field])
    .map(([tabId]) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId));
  const results = { ...state.results };
  for (const card of state.cards) {
    if (!results[card.field]) {
      results[card.field] = {
        status: 'error',
        amount: card.amount,
        message: 'A página não respondeu a tempo. Confirme login e tente novamente.',
      };
    }
  }
  const nextState = {
    ...state,
    results,
    status: 'partial',
    message: 'Tempo limite atingido. Confira os campos não detectados ou tente novamente.',
  };
  await chrome.storage.local.set({ [STATE_KEY]: nextState });
  await closeTabs(pendingTabIds, state.scanId);
}

async function closeTabs(tabIds, scanId) {
  const outcomes = await Promise.allSettled(tabIds.map((tabId) => chrome.tabs.remove(tabId)));
  if (outcomes.some((outcome) => outcome.status === 'rejected')) {
    await updateMessage(scanId, 'Tempo limite atingido. Algumas abas não puderam ser fechadas.');
  }
}

async function updateMessage(scanId, message) {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];
  if (state?.scanId === scanId) {
    await chrome.storage.local.set({ [STATE_KEY]: { ...state, message } });
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function enqueueResult(task) {
  const result = resultQueue.then(task);
  resultQueue = result.then(() => undefined, () => undefined);
  return result;
}
