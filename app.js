const STORAGE_KEY = 'forge40k.roster.v1';
const numberFormat = new Intl.NumberFormat('es-ES');
const state = { rows: [], roster: [], selectedFaction: 'Chaos Space Marines', category: 'all', search: '', battleSize: 2000, source: { version: '1.6', date: '22 oct 2026', label: 'MFM v1.6 Â· snapshot revisada' }, listName: 'La Decimotercera', factionCards: [], selectedDetachments: [], selectedDisposition: '', warlordId: '', validationMessages: [] };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((part) => part.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some((part) => part.trim())) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((value) => value.trim().toLowerCase());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    faction: row.faction || row.army || '', unit: row.unit || row.name || '',
    category: (row.grouptitle || row.category || 'OTHER').toUpperCase(),
    legends: String(row.legends).toLowerCase() === 'true', range: row.range || '',
    label: row.label || '', models: row.models || row.modelcount || '1 model',
    points: String(row.points || '').trim() ? Number(String(row.points).replace(/[^0-9.-]/g, '')) : Number.NaN,
    desc: row.desc || '', addon: row.addon || '',
    isLeader: /\bLEADER\b/i.test(row.desc || ''), isSupport: /\bSUPPORT\b/i.test(row.desc || ''),
    isEpicHero: /\bEPIC HERO\b/i.test(row.desc || ''),
    canJoin: ((row.desc || '').split(/\b(?:LEADER|SUPPORT)\b\s*\|?/i).slice(1).join('|').split('|')[0] || '').split(/,\s*/).map((name) => name.trim()).filter(Boolean)
  })).filter((row, index) => {
    const original = rows[index];
    return row.faction && row.unit && Number.isFinite(row.points) && (!original.recordtype || original.recordtype === 'unit');
  });
}

function catalogKey(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('es').replace(/[^A-Z0-9]+/g, ' ').trim(); }

async function loadUnitCatalog() {
  const direct = await fetch('./data/units/catalog.json');
  if (direct.ok) return direct.json();
  const parts = Array.from({ length: 10 }, (_, index) => `./data/units/catalog/part-${String(index).padStart(2, '0')}.txt`);
  const encoded = (await Promise.all(parts.map(async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error('No se encontrÃ³ el catÃ¡logo de unidades.');
    return response.text();
  }))).join('');
  const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const stream = new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

function rowsFromUnitCatalog(units, mfmRows) {
  const pointGroups = new Map();
  mfmRows.forEach((row) => {
    const key = `${catalogKey(row.faction)}::${catalogKey(row.unit)}`;
    if (!pointGroups.has(key)) pointGroups.set(key, []);
    pointGroups.get(key).push(row);
  });
  const unitGroups = new Map();
  units.forEach((unit) => {
    const key = `${catalogKey(unit.faction)}::${catalogKey(unit.name)}`;
    if (!unitGroups.has(key)) unitGroups.set(key, []);
    unitGroups.get(key).push(unit);
  });
  const result = []; const represented = new Set();
  for (const [key, variants] of unitGroups) {
    const unit = variants.find((variant) => !variant.isLegends) || variants[0];
    const pointRows = pointGroups.get(key) || [];
    const category = [unit.battlefieldRole, unit.category, unit.isCharacter ? 'CHARACTER' : '', unit.isEpicHero ? 'EPIC HERO' : ''].filter(Boolean).join(' ').toUpperCase() || 'OTHER';
    const isLeader = unit.coreAbilities?.some((ability) => /\bLEADER\b/i.test(ability)) || false;
    const isSupport = unit.coreAbilities?.some((ability) => /\bSUPPORT\b/i.test(ability)) || false;
    const canJoin = isLeader ? (unit.selection?.canLeadUnits || []) : isSupport ? (unit.selection?.canSupportUnits || []) : [];
    const metadata = { category, legends: Boolean(unit.isLegends), isLeader, isSupport, isEpicHero: Boolean(unit.isEpicHero), canJoin, sourceUrl: unit.sourceUrl };
    if (pointRows.length) {
      pointRows.forEach((row) => result.push({ ...row, ...metadata }));
      represented.add(key);
      continue;
    }
    const costs = variants.flatMap((variant) => variant.costs || []);
    const uniqueCosts = new Map(costs.map((cost) => [`${cost.size}|${cost.points}|${cost.tier}`, cost]));
    for (const cost of uniqueCosts.values()) {
      if (!Number.isFinite(Number(cost.points))) continue;
      result.push({
        faction: unit.faction, unit: unit.name, ...metadata, range: cost.tier || '',
        label: cost.size || '', models: cost.size || '1 model', points: Number(cost.points),
        desc: '', addon: '', pointSource: 'Wahapedia'
      });
    }
  }
  mfmRows.forEach((row) => {
    if (!represented.has(`${catalogKey(row.faction)}::${catalogKey(row.unit)}`)) result.push(row);
  });
  return result;
}

function groupedUnits() {
  const filtered = state.rows.filter((row) => row.faction === state.selectedFaction);
  const groups = new Map();
  filtered.forEach((row) => {
    const key = row.unit.toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { name: row.unit, category: row.category, legends: row.legends, sourceUrl: row.sourceUrl || '', options: [] });
    groups.get(key).options.push(row);
  });
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function factions() { return [...new Set(state.rows.map((row) => row.faction))].sort((a, b) => a.localeCompare(b, 'es')); }

function selectedCost(unit, models, copyNumber) {
  const sizeMatches = unit.options.filter((option) => option.models === models);
  const options = sizeMatches.length ? sizeMatches : unit.options;
  const includesCopy = (option) => {
    const tier = `${option.range} ${option.label}`.toUpperCase();
    const bounded = tier.match(/\b(\d+)(?:ST|ND|RD|TH)\s+TO\s+(\d+)(?:ST|ND|RD|TH)\b/);
    if (bounded) return copyNumber >= Number(bounded[1]) && copyNumber <= Number(bounded[2]);
    const open = tier.match(/\b(\d+)(?:ST|ND|RD|TH)\s*\+/);
    if (open) return copyNumber >= Number(open[1]);
    const exact = tier.match(/\b(\d+)(?:ST|ND|RD|TH)\s+UNIT\s+COSTS?\b/);
    if (exact) return copyNumber === Number(exact[1]);
    return true;
  };
  return options.find(includesCopy) || options[0];
}

function readUnit(unitName) { return groupedUnits().find((unit) => unit.name === unitName); }

function legalModelSizes(unitName) {
  const unit = readUnit(unitName); if (!unit) return [];
  return [...new Set(unit.options.map((option) => option.models))].sort((a, b) => {
    const countA = Number(a.match(/\d+/)?.[0] || 0); const countB = Number(b.match(/\d+/)?.[0] || 0);
    return countA - countB || a.localeCompare(b, 'es');
  });
}

function changeUnitSize(index, direction) {
  const entry = state.roster[index]; if (!entry) return;
  const unit = readUnit(entry.unit); const sizes = legalModelSizes(entry.unit); if (sizes.length < 2) return;
  const currentIndex = Math.max(0, sizes.indexOf(entry.models)); const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= sizes.length) return;
  const copyNumber = state.roster.slice(0, index + 1).filter((item) => item.unit === entry.unit).length;
  const nextSize = sizes[nextIndex]; const option = selectedCost(unit, nextSize, copyNumber);
  entry.models = nextSize; entry.points = option?.points ?? entry.points; entry.range = option?.range ?? entry.range;
  save(); renderRoster(); renderUnits();
}

function availableDetachments() { return state.factionCards.filter((card) => card.kind === 'detachment'); }

function selectedDetachments() { return availableDetachments().filter((card) => state.selectedDetachments.includes(card.name)); }

function enhancementsForDetachment() {
  return selectedDetachments().flatMap((detachment) => (detachment.costs || []).filter((cost) => cost.type === 'enhancement' && Number.isFinite(cost.points)).map((cost) => ({ ...cost, detachment: detachment.name, upgrade: /\(upgrade\)/i.test(cost.label) })));
}

function enhancementCost(label) { return enhancementsForDetachment().find((cost) => cost.label === label)?.points || 0; }

function battleLimits() { return state.battleSize <= 1000 ? { points: 1000, dp: 2, enhancements: 2, units: 2 } : { points: 2000, dp: 3, enhancements: 4, units: 3 }; }
function detachmentPoints() { return selectedDetachments().reduce((sum, card) => sum + (Number(card.detachmentPoints) || 0), 0); }
function forceDispositions() { const known = ['TAKE AND HOLD', 'PURGE THE FOE', 'DISRUPTION', 'RECONNAISSANCE', 'PRIORITY ASSETS']; return [...new Set(selectedDetachments().flatMap((card) => card.text || []).map((line) => line.toUpperCase()).filter((line) => known.includes(line)))]; }
function unitMeta(unitName) { const unit = readUnit(unitName); return unit?.options[0] || {}; }
function isCharacter(unitName) { const unit = readUnit(unitName); return Boolean(unit?.category.includes('CHARACTER') || unit?.category.includes('HQ') || unit?.options.some((option) => option.isLeader || option.isSupport)); }
function isEpicHero(unitName) { return unitMeta(unitName).isEpicHero; }
function isWarlordEligible(unitName) { return isCharacter(unitName); }
function roleOf(unit) { return unit.options.some((option) => option.category.includes('BATTLELINE') || option.category.includes('TROOPS')) ? 'BATTLELINE' : unit.options.some((option) => option.category.includes('DEDICATED TRANSPORT')) ? 'DEDICATED TRANSPORT' : ''; }
function maxCopies(unitName) { const role = roleOf(readUnit(unitName) || { options: [] }); return role === 'BATTLELINE' || role === 'DEDICATED TRANSPORT' ? battleLimits().units * 2 : isEpicHero(unitName) ? 1 : battleLimits().units; }
function enhancementCount() { return state.roster.filter((entry) => entry.enhancement).length; }
function rosterProblems() {
  const problems = []; const limit = battleLimits(); const dp = detachmentPoints();
  if (state.roster.length && !selectedDetachments().length) problems.push('Selecciona al menos un destacamento para la facciÃ³n.');
  const incursionException = state.battleSize <= 1000 && selectedDetachments().length === 1 && dp === 3;
  if (dp > limit.dp && !incursionException) problems.push(`Destacamentos: ${dp}/${limit.dp} DP.`);
  const names = [...new Set(state.roster.map((entry) => entry.unit))];
  names.forEach((name) => { const count = state.roster.filter((entry) => entry.unit === name).length; if (count > maxCopies(name)) problems.push(`${name}: ${count}/${maxCopies(name)} unidades.`); });
  const enhancementNames = state.roster.map((entry) => entry.enhancement).filter(Boolean);
  const countedUpgrades = new Set(); let enhancementTotal = 0;
  state.roster.forEach((entry) => {
    if (!entry.enhancement) return;
    const upgrade = enhancementsForDetachment().find((cost) => cost.label === entry.enhancement)?.upgrade;
    if (upgrade) { if (!countedUpgrades.has(entry.enhancement)) { countedUpgrades.add(entry.enhancement); enhancementTotal += 1; } }
    else enhancementTotal += 1;
  });
  if (enhancementTotal > limit.enhancements) problems.push(`Mejoras: ${enhancementTotal}/${limit.enhancements}.`);
  enhancementNames.forEach((name) => { const cost = enhancementsForDetachment().find((item) => item.label === name); const copies = enhancementNames.filter((item) => item === name).length; if (cost?.upgrade ? copies > 3 : copies > 1) problems.push(`${name}: ${cost?.upgrade ? 'mÃ¡ximo 3 copias' : 'no se puede repetir'}.`); });
  const attachedEnhancements = new Map();
  state.roster.forEach((entry) => { if (entry.enhancement) { const group = entry.attachedTo || entry.id; attachedEnhancements.set(group, [...(attachedEnhancements.get(group) || []), entry.unit]); } });
  attachedEnhancements.forEach((units) => { if (units.length > 1) problems.push(`${units.join(', ')} forman una unidad adjunta con mÃ¡s de una mejora.`); });
  if (!state.warlordId || !state.roster.some((entry) => entry.id === state.warlordId && isWarlordEligible(entry.unit))) problems.push('Selecciona un Warlord vÃ¡lido (Personaje de la facciÃ³n).');
  state.roster.filter((entry) => unitMeta(entry.unit).isSupport || unitMeta(entry.unit).isLeader && entry.attachedTo).forEach((entry) => {
    const meta = unitMeta(entry.unit); const target = state.roster.find((candidate) => candidate.id === entry.attachedTo);
    const valid = target && !unitMeta(target.unit).isLeader && !unitMeta(target.unit).isSupport && (!meta.canJoin.length || meta.canJoin.some((name) => name.toLocaleLowerCase('es') === target.unit.toLocaleLowerCase('es')));
    if (meta.isSupport && !valid) problems.push(`${entry.unit} debe unirse a una unidad compatible.`);
    else if (entry.attachedTo && !valid) problems.push(`${entry.unit} no puede unirse a esa unidad segÃºn el MFM.`);
  });
  return problems;
}

function renderDetachment() {
  const button = $('#detachmentButton'); const detachments = selectedDetachments();
  button.innerHTML = detachments.length ? `${detachments.length} destacamento(s) Â· ${detachmentPoints()}/${battleLimits().dp} DP <span>âŒ„</span>` : 'Seleccionar destacamentos <span>âŒ„</span>';
  const summary = $('#detachmentSummary');
  if (!detachments.length) { summary.hidden = true; summary.innerHTML = ''; renderDisposition(); return; }
  const enhancements = enhancementsForDetachment();
  summary.hidden = false;
  summary.innerHTML = `<div class="detachment-summary-head"><strong>${detachments.map((card) => escapeHtml(card.name)).join(' + ')}</strong><span>${detachmentPoints()}/${battleLimits().dp} DP</span></div><p>${enhancements.length} mejoras disponibles entre los destacamentos elegidos. Los DP no cuentan como puntos de ejÃ©rcito.${state.battleSize <= 1000 && detachments.length === 1 && detachmentPoints() === 3 ? ' ExcepciÃ³n Incursion: destacamento Ãºnico de 3 DP.' : ''}</p>`;
  renderDisposition();
}

function renderDisposition() {
  const select = $('#forceDisposition'); if (!select) return;
  const options = forceDispositions();
  if (!options.includes(state.selectedDisposition)) state.selectedDisposition = options[0] || '';
  select.innerHTML = `<option value="">Elegir para la partidaâ€¦</option>${options.map((item) => `<option value="${escapeHtml(item)}" ${item === state.selectedDisposition ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
  $('#dispositionControl').hidden = !options.length;
}

function chooseDetachment() {
  const options = availableDetachments();
  if (!options.length) { toast('No hay destacamentos disponibles para esta facciÃ³n en el snapshot cargado.'); return; }
  const dialog = $('#detachmentDialog');
  $('#detachmentOptions').innerHTML = `<div class="detachment-budget">Presupuesto: ${detachmentPoints()}/${battleLimits().dp} DP <button type="button" class="text-button" data-clear-detachments>Limpiar</button></div>${options.map((card) => `<button type="button" class="detachment-option ${state.selectedDetachments.includes(card.name) ? 'selected' : ''}" data-detachment="${escapeHtml(card.name)}"><span><strong>${escapeHtml(card.name)}</strong><small>${numberFormat.format(card.costs.filter((cost) => cost.type === 'enhancement').length)} mejoras</small></span><b>${numberFormat.format(card.detachmentPoints || 0)} DP ${state.selectedDetachments.includes(card.name) ? 'âœ“' : '+'}</b></button>`).join('')}`;
  if (!dialog.open) dialog.showModal();
}

function renderFactionSelect() {
  const select = $('#factionSelect'); const available = factions();
  const sameFaction = available.find((faction) => faction.toLocaleLowerCase('es') === state.selectedFaction.toLocaleLowerCase('es'));
  if (sameFaction) state.selectedFaction = sameFaction;
  if (!available.includes(state.selectedFaction)) state.selectedFaction = available[0] || '';
  select.innerHTML = available.map((faction) => `<option value="${escapeHtml(faction)}" ${faction === state.selectedFaction ? 'selected' : ''}>${escapeHtml(faction)}</option>`).join('');
  $('#catalogueStatus').textContent = `${numberFormat.format(groupedUnits().length)} unidades`;
}

function categoryMatches(unit) {
  if (state.category === 'all') return true;
  if (state.category === 'BATTLELINE') return unit.category.includes('BATTLELINE') || unit.category.includes('TROOPS');
  if (state.category === 'CHARACTERS') return isCharacter(unit.name);
  return !unit.category.includes('BATTLELINE') && !unit.category.includes('TROOPS') && !isCharacter(unit.name);
}

function renderUnits() {
  const query = state.search.trim().toLocaleLowerCase('es');
  const units = groupedUnits().filter((unit) => categoryMatches(unit) && (!query || unit.name.toLocaleLowerCase('es').includes(query)));
  $('#unitCount').textContent = numberFormat.format(units.length);
  $('#unitsList').innerHTML = units.length ? units.map((unit, index) => {
    const models = [...new Set(unit.options.map((option) => option.models))];
    const bestOption = unit.options[0];
    const character = isCharacter(unit.name); const role = character ? 'PERSONAJE' : unit.category.includes('BATTLELINE') ? 'LÃNEA' : unit.category.includes('DEDICATED TRANSPORT') ? 'TRANSPORTE' : 'UNIDAD';
    const copies = state.roster.filter((entry) => entry.unit === unit.name).length; const max = maxCopies(unit.name);
    const name = unit.sourceUrl ? `<a class="unit-name unit-source-link" href="${escapeHtml(unit.sourceUrl)}" target="_blank" rel="noreferrer" title="Abrir ficha en Wahapedia">${escapeHtml(unit.name)} â†—</a>` : `<div class="unit-name">${escapeHtml(unit.name)}</div>`;
    return `<article class="unit-card" data-unit="${escapeHtml(unit.name)}"><div class="unit-symbol ${character ? 'character' : ''}">${character ? 'â™Ÿ' : ['âœ£', 'â—‰', 'âŒ–', 'âœ¦'][index % 4]}</div><div class="unit-info"><div>${name}</div><div class="unit-meta"><span class="role-tag">${role}</span><span>${models.map((model) => escapeHtml(model)).join(' Â· ')}</span><span>${copies}/${max}</span></div></div><div class="unit-point">${numberFormat.format(bestOption.points)}<small>pts</small></div><select class="size-select" aria-label="TamaÃ±o de ${escapeHtml(unit.name)}">${models.map((model) => { const option = unit.options.find((entry) => entry.models === model) || bestOption; return `<option value="${escapeHtml(model)}">${escapeHtml(model.replace(/ models?/i, ''))} Â· ${numberFormat.format(option.points)}</option>`; }).join('')}</select><button class="add-unit" data-add="${escapeHtml(unit.name)}" title="AÃ±adir ${escapeHtml(unit.name)}" aria-label="AÃ±adir ${escapeHtml(unit.name)}" ${copies >= max ? 'disabled' : ''}>ï¼‹</button></article>`;
  }).join('') : `<div class="empty-catalogue">No hay unidades que coincidan. Importa un catÃ¡logo MFM completo o prueba otro filtro.</div>`;
}

function rosterPoints() {
  const seen = new Map();
  return state.roster.reduce((sum, entry) => {
    const unit = readUnit(entry.unit); if (!unit) return sum;
    const copy = (seen.get(entry.unit) || 0) + 1; seen.set(entry.unit, copy);
    const option = selectedCost(unit, entry.models, copy);
    entry.points = option?.points ?? entry.points;
    entry.range = option?.range ?? '';
    return sum + (Number(entry.points) || 0) + enhancementCost(entry.enhancement);
  }, 0);
}

function renderRoster() {
  const total = rosterPoints(); const limit = state.battleSize; const count = state.roster.length;
  $('#totalPoints').textContent = numberFormat.format(total); $('#pointsLimit').textContent = numberFormat.format(limit);
  $('#pointsProgress').style.width = `${Math.min(100, total / limit * 100)}%`;
  $('#remainingPoints').textContent = total > limit ? `${numberFormat.format(total - limit)} pts por encima` : `${numberFormat.format(limit - total)} pts disponibles`;
  $('#unitTotal').textContent = `${count} ${count === 1 ? 'unidad' : 'unidades'}`; $('#rosterCount').textContent = String(count);
  $('#rosterEmpty').hidden = count > 0; $('#rosterItems').hidden = count === 0;
  $('#sidebarPoints').textContent = numberFormat.format(total);
  const assigned = state.roster.map((entry) => entry.enhancement).filter(Boolean);
  const warlordSelect = $('#warlordSelect');
  if (warlordSelect) warlordSelect.innerHTML = `<option value="">Designar Warlordâ€¦</option>${state.roster.filter((entry) => isWarlordEligible(entry.unit)).map((entry) => `<option value="${escapeHtml(entry.id)}" ${state.warlordId === entry.id ? 'selected' : ''}>${escapeHtml(entry.unit)}</option>`).join('')}`;
  $('#rosterItems').innerHTML = state.roster.map((entry, index) => {
    const canEnhance = isCharacter(entry.unit) && !isEpicHero(entry.unit);
    const enhancementTotal = new Set(assigned).size; const hasRoom = enhancementTotal < battleLimits().enhancements || Boolean(entry.enhancement);
    const allowedEnhancements = enhancementsForDetachment().filter((cost) => (!assigned.includes(cost.label) || cost.label === entry.enhancement || (cost.upgrade && assigned.filter((label) => label === cost.label).length < 3)) && (hasRoom || cost.label === entry.enhancement));
    const enhancementSelect = selectedDetachments().length && (canEnhance || enhancementsForDetachment().some((cost) => cost.upgrade)) ? `<select class="enhancement-select" data-enhancement-index="${index}" aria-label="Mejora para ${escapeHtml(entry.unit)}"><option value="">Sin mejora</option>${allowedEnhancements.filter((cost) => canEnhance || cost.upgrade).map((cost) => `<option value="${escapeHtml(cost.label)}" ${cost.label === entry.enhancement ? 'selected' : ''}>${escapeHtml(cost.label)} Â· ${numberFormat.format(cost.points)} pts</option>`).join('')}</select>` : entry.enhancement ? `<div class="roster-item-sub">${escapeHtml(entry.enhancement)} Â· ${numberFormat.format(enhancementCost(entry.enhancement))} pts</div>` : '';
    const meta = unitMeta(entry.unit); const targets = state.roster.filter((candidate) => candidate.id !== entry.id && !unitMeta(candidate.unit).isLeader && !unitMeta(candidate.unit).isSupport && (!meta.canJoin.length || meta.canJoin.some((name) => name.toLocaleLowerCase('es') === candidate.unit.toLocaleLowerCase('es'))));
    const attachment = (meta.isLeader || meta.isSupport) ? `<select class="attachment-select" data-attach-index="${index}" aria-label="Asignar ${escapeHtml(entry.unit)}"><option value="">${meta.isSupport ? 'Asignar unidad de apoyoâ€¦' : 'Sin unidad asignada'}</option>${targets.map((target) => `<option value="${escapeHtml(target.id)}" ${entry.attachedTo === target.id ? 'selected' : ''}>Se une a ${escapeHtml(target.unit)}</option>`).join('')}</select>` : '';
    const modelSizes = legalModelSizes(entry.unit); const modelSizeControl = modelSizes.length > 1 ? `<div class="model-size-control"><button type="button" data-model-step="-1" data-index="${index}" aria-label="Reducir tamaÃƒÂ±o de ${escapeHtml(entry.unit)}" ${modelSizes.indexOf(entry.models) <= 0 ? 'disabled' : ''}>âˆ’</button><span>${escapeHtml(entry.models)}</span><button type="button" data-model-step="1" data-index="${index}" aria-label="Aumentar tamaÃƒÂ±o de ${escapeHtml(entry.unit)}" ${modelSizes.indexOf(entry.models) >= modelSizes.length - 1 ? 'disabled' : ''}>+</button></div>` : `<div class="roster-item-sub">${escapeHtml(entry.models)}</div>`;
    return `<article class="roster-item"><div class="unit-symbol ${isCharacter(entry.unit) ? 'character' : ''}">${['âœ£', 'â—‰', 'âŒ–', 'âœ¦'][index % 4]}</div><div class="roster-item-main"><div class="roster-item-title">${escapeHtml(entry.unit)}${state.warlordId === entry.id ? ' Â· WARLORD' : ''}</div>${modelSizeControl}<div class="roster-item-sub">${entry.range ? escapeHtml(entry.range) : 'TamaÃƒÂ±o legal segÃƒÂºn el MFM'}</div>${attachment}${enhancementSelect}</div><div class="roster-item-cost">${numberFormat.format((Number(entry.points) || 0) + enhancementCost(entry.enhancement))}<small style="font:500 8px var(--font);color:#819083"> pts</small></div><button class="remove-unit" data-remove="${index}" aria-label="Quitar ${escapeHtml(entry.unit)}">Ã—</button></article>`;
  }).join('');
  const validity = $('#validity');
  const problems = rosterProblems(); state.validationMessages = problems;
  validity.classList.toggle('valid', count > 0 && total <= limit && !problems.length); validity.classList.toggle('over', total > limit || problems.length > 0);
  validity.lastElementChild.textContent = total > limit ? 'Supera el lÃ­mite de puntos' : problems[0] || (count ? 'Lista dentro del lÃ­mite' : 'Lista en progreso');
  const details = $('#validationDetails'); details.hidden = !problems.length; details.innerHTML = problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('');
  $('#sidebarArmyName').textContent = state.listName; $('#unitTotal').textContent = `${count} ${count === 1 ? 'unidad' : 'unidades'}`;
  save();
}

function save() {
  const payload = { roster: state.roster, selectedFaction: state.selectedFaction, battleSize: state.battleSize, listName: state.listName, selectedDetachments: state.selectedDetachments, selectedDisposition: state.selectedDisposition, warlordId: state.warlordId };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function render() { renderFactionSelect(); renderUnits(); renderDetachment(); renderRoster(); }

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 2800);
}

function addUnit(name, models) {
  const unit = readUnit(name); if (!unit) return;
  const copies = state.roster.filter((entry) => entry.unit === name).length;
  if (copies >= maxCopies(name)) { toast(`LÃ­mite de ${maxCopies(name)} unidades para ${name}.`); return; }
  const selectedModels = models || unit.options[0].models;
  const initial = selectedCost(unit, selectedModels, state.roster.filter((entry) => entry.unit === name).length + 1);
  state.roster.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, unit: name, models: selectedModels, points: initial.points, range: initial.range });
  save(); renderRoster(); toast(`${name} aÃ±adida al roster`);
}

function download(filename, text, type) {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function exportRoster() {
  const payload = { game: 'Warhammer 40,000', edition: 11, name: state.listName, faction: state.selectedFaction, battleSize: state.battleSize, detachments: selectedDetachments().map(({ name, detachmentPoints: dp }) => ({ name, detachmentPoints: dp })), detachmentPoints: detachmentPoints(), forceDisposition: state.selectedDisposition, warlordId: state.warlordId, points: rosterPoints(), validation: rosterProblems(), source: state.source, units: state.roster };
  download(`${state.listName.trim().replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase() || 'lista'}-forge.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('Lista exportada en formato JSON');
}

function setData(text, source, factionCards = [], unitCatalog = []) {
  const pointRows = normalizeRows(parseCsv(text));
  const normalized = unitCatalog.length ? rowsFromUnitCatalog(unitCatalog, pointRows) : pointRows;
  if (!normalized.length) throw new Error('No se encontraron filas vÃ¡lidas. Revisa que sea el CSV de puntos del MFM.');
  state.rows = normalized;
  state.roster = state.roster.filter((entry) => normalized.some((row) => row.faction === state.selectedFaction && row.unit === entry.unit));
  state.source = source; state.factionCards = factionCards;
  state.selectedDetachments = state.selectedDetachments.filter((name) => availableDetachments().some((card) => card.name === name));
  state.roster.forEach((entry) => { if (!enhancementsForDetachment().some((cost) => cost.label === entry.enhancement)) entry.enhancement = ''; });
  render(); save();
  $('#sourceText').textContent = unitCatalog.length ? `CatÃ¡logo de unidades, perfiles y roles desde Wahapedia; costes del MFM cuando coinciden y de Wahapedia cuando faltan. Las habilidades enlazan a su ficha de origen. ${source.label}.` : `Puntos cargados desde ${source.label}. ImportaciÃ³n local sin el catÃ¡logo de fichas Wahapedia.`;
  toast(`CatÃ¡logo cargado: ${numberFormat.format(normalized.length)} entradas`);
}

function openImportMenu() {
  $('#importDialog').showModal();
}

async function updateFromMfm() {
  toast('Cargando el snapshot localâ€¦');
  try {
    const [csvResponse, snapshotResponse] = await Promise.all([fetch('./data/mfm-points.csv'), fetch('./data/mfm-snapshot.json')]);
    if (!csvResponse.ok || !snapshotResponse.ok) throw new Error('Primero ejecuta node scripts/scrape-mfm.mjs para generar el snapshot.');
    const [csv, snapshot, catalog] = await Promise.all([csvResponse.text(), snapshotResponse.json(), loadUnitCatalog().catch(() => ({ units: [] }))]);
    const date = snapshot.scrapedAt?.slice(0, 10) || 'sin fecha';
    setData(csv, { version: snapshot.manualVersion || 'unknown', date, label: `${snapshot.manualVersion || 'MFM'} Â· scrape ${date}` }, snapshot.factions.find((faction) => faction.name.toLocaleLowerCase('es') === state.selectedFaction.toLocaleLowerCase('es'))?.cards || [], catalog.units || []);
  } catch (error) {
    toast(`${error.message} Puedes importar un CSV desde tu dispositivo.`);
  }
}

function init() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (saved.listName) state.listName = saved.listName;
  if (saved.roster) state.roster = saved.roster;
  if (saved.selectedFaction) state.selectedFaction = saved.selectedFaction;
  if (saved.battleSize) state.battleSize = saved.battleSize;
  state.selectedDetachments = saved.selectedDetachments || (saved.selectedDetachment ? [saved.selectedDetachment] : []);
  state.selectedDisposition = saved.selectedDisposition || ''; state.warlordId = saved.warlordId || '';
  $('#listName').value = state.listName; $('#battleSize').value = String(state.battleSize);
  Promise.all([fetch('./data/mfm-points.csv'), fetch('./data/mfm-snapshot.json')]).then(async ([csvResponse, snapshotResponse]) => {
    if (!csvResponse.ok || !snapshotResponse.ok) throw new Error('Snapshot scrapeado todavÃ­a no disponible.');
    const [csv, snapshot, catalog] = await Promise.all([csvResponse.text(), snapshotResponse.json(), loadUnitCatalog().catch(() => ({ units: [] }))]);
    const date = snapshot.scrapedAt?.slice(0, 10) || 'sin fecha';
    setData(csv, { version: snapshot.manualVersion || 'unknown', date, label: `${snapshot.manualVersion || 'MFM'} Â· scrape ${date}` }, snapshot.factions.find((faction) => faction.name.toLocaleLowerCase('es') === state.selectedFaction.toLocaleLowerCase('es'))?.cards || [], catalog.units || []);
  }).catch(() => fetch('./data/points.csv').then((response) => response.text()).then((csv) => setData(csv, state.source)).catch(() => {
    state.rows = normalizeRows(parseCsv(`faction,unit,groupTitle,legends,range,label,models,points\nChaos Space Marines,Chaos Bikers,OTHER,false,1st-2nd,Your Unit Costs,3 models,80`)); render();
  }));
  $('#listName').addEventListener('input', (event) => { state.listName = event.target.value || 'Lista sin nombre'; save(); renderRoster(); });
  $('#factionSelect').addEventListener('change', async (event) => {
    state.selectedFaction = event.target.value; state.roster = []; state.selectedDetachments = []; state.selectedDisposition = ''; state.warlordId = ''; state.factionCards = [];
    try { const response = await fetch('./data/mfm-snapshot.json'); const snapshot = await response.json(); state.factionCards = snapshot.factions.find((faction) => faction.name.toLocaleLowerCase('es') === state.selectedFaction.toLocaleLowerCase('es'))?.cards || []; } catch {}
    save(); render();
  });
  $('#battleSize').addEventListener('change', (event) => { state.battleSize = Number(event.target.value); save(); render(); });
  $('#unitSearch').addEventListener('input', (event) => { state.search = event.target.value; renderUnits(); });
  $('#categoryTabs').addEventListener('click', (event) => { const tab = event.target.closest('[data-category]'); if (!tab) return; state.category = tab.dataset.category; document.querySelectorAll('.category-tab').forEach((button) => button.classList.toggle('selected', button === tab)); renderUnits(); });
  $('#unitsList').addEventListener('click', (event) => { const button = event.target.closest('[data-add]'); if (!button) return; const card = button.closest('.unit-card'); addUnit(button.dataset.add, card.querySelector('.size-select')?.value); });
  $('#rosterItems').addEventListener('click', (event) => {
    const step = event.target.closest('[data-model-step]'); if (step) { changeUnitSize(Number(step.dataset.index), Number(step.dataset.modelStep)); return; }
    const button = event.target.closest('[data-remove]'); if (!button) return; state.roster.splice(Number(button.dataset.remove), 1); save(); renderRoster(); renderUnits();
  });
  $('#rosterItems').addEventListener('change', (event) => { const select = event.target.closest('[data-enhancement-index]'); if (!select) return; const entry = state.roster[Number(select.dataset.enhancementIndex)]; if (!entry) return; entry.enhancement = select.value; save(); renderRoster(); });
  $('#clearRoster').addEventListener('click', () => { if (!state.roster.length) return; state.roster = []; save(); renderRoster(); toast('Roster vaciado'); });
  $('#exportButton').addEventListener('click', exportRoster);
  $('#importButton').addEventListener('click', openImportMenu);
  $('#updateMfmButton').addEventListener('click', () => { $('#importDialog').close(); updateFromMfm(); });
  $('#localImportButton').addEventListener('click', () => { $('#importDialog').close(); $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; try { setData(await file.text(), { version: 'local', date: new Date().toLocaleDateString('es-ES'), label: `CSV local Â· ${file.name}` }); } catch (error) { toast(error.message); } event.target.value = ''; });
  $('#topAddButton').addEventListener('click', () => $('#unitSearch').focus()); $('#emptyAddButton').addEventListener('click', () => { $('#addUnits').scrollIntoView({ behavior: 'smooth' }); $('#unitSearch').focus(); });
  $('#sourceLink').addEventListener('click', () => window.open('https://mfm.warhammer-community.com/en', '_blank', 'noopener,noreferrer'));
  $('#helpButton').addEventListener('click', () => $('#helpDialog').showModal());
  $('#newArmyButton').addEventListener('click', () => { state.listName = 'Nueva lista'; state.roster = []; state.selectedDetachments = []; state.selectedDisposition = ''; state.warlordId = ''; $('#listName').value = state.listName; save(); render(); toast('Nueva lista preparada'); });
  $('#detachmentButton').addEventListener('click', chooseDetachment);
  $('#detachmentOptions').addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-detachments]')) { state.selectedDetachments = []; state.roster.forEach((entry) => { entry.enhancement = ''; }); save(); render(); chooseDetachment(); return; }
    const option = event.target.closest('[data-detachment]'); if (!option) return;
    const name = option.dataset.detachment; const card = availableDetachments().find((item) => item.name === name); const selected = state.selectedDetachments.includes(name);
    const next = selected ? state.selectedDetachments.filter((item) => item !== name) : [...state.selectedDetachments, name];
    const nextDp = next.reduce((sum, item) => sum + (availableDetachments().find((entry) => entry.name === item)?.detachmentPoints || 0), 0);
    const exception = state.battleSize <= 1000 && next.length === 1 && nextDp === 3;
    if (!selected && nextDp > battleLimits().dp && !exception) { toast(`Ese destacamento supera el presupuesto de ${battleLimits().dp} DP.`); return; }
    state.selectedDetachments = next;
    state.roster.forEach((entry) => { if (!enhancementsForDetachment().some((cost) => cost.label === entry.enhancement)) entry.enhancement = ''; });
    save(); render(); chooseDetachment(); toast(`${card.name} ${selected ? 'quitado' : 'aÃ±adido'}`);
  });
  $('#warlordSelect').addEventListener('change', (event) => { state.warlordId = event.target.value; save(); renderRoster(); });
  $('#forceDisposition').addEventListener('change', (event) => { state.selectedDisposition = event.target.value; save(); renderRoster(); });
  $('#rosterItems').addEventListener('change', (event) => { const attach = event.target.closest('[data-attach-index]'); if (attach) { const entry = state.roster[Number(attach.dataset.attachIndex)]; if (entry) { entry.attachedTo = attach.value; save(); renderRoster(); } } });
  $('#filterButton').addEventListener('click', () => toast('Elige una categorÃ­a con las pestaÃ±as del arsenal.'));
  $('#listMenuButton').addEventListener('click', exportRoster); $('#rosterMenuButton').addEventListener('click', exportRoster);
  document.addEventListener('keydown', (event) => { if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#unitSearch').focus(); } });
}

init();

