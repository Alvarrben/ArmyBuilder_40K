const STORAGE_KEY = 'forge40k.roster.v1';
const numberFormat = new Intl.NumberFormat('es-ES');
const state = { rows: [], roster: [], selectedFaction: 'Chaos Space Marines', category: 'all', search: '', battleSize: 2000, source: { version: '1.6', date: '22 oct 2026', label: 'MFM v1.6 · snapshot revisada' }, listName: 'La Decimotercera', factionCards: [], selectedDetachment: '' };
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
    desc: row.desc || '', addon: row.addon || ''
  })).filter((row, index) => {
    const original = rows[index];
    return row.faction && row.unit && Number.isFinite(row.points) && (!original.recordtype || original.recordtype === 'unit');
  });
}

function groupedUnits() {
  const filtered = state.rows.filter((row) => row.faction === state.selectedFaction);
  const groups = new Map();
  filtered.forEach((row) => {
    const key = row.unit.toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { name: row.unit, category: row.category, legends: row.legends, options: [] });
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

function availableDetachments() { return state.factionCards.filter((card) => card.kind === 'detachment'); }

function selectedDetachment() { return availableDetachments().find((card) => card.name === state.selectedDetachment); }

function enhancementsForDetachment() {
  return (selectedDetachment()?.costs || []).filter((cost) => cost.type === 'enhancement' && Number.isFinite(cost.points));
}

function enhancementCost(label) { return enhancementsForDetachment().find((cost) => cost.label === label)?.points || 0; }

function isCharacter(unitName) {
  const category = readUnit(unitName)?.category || '';
  return category.includes('CHARACTER') || category.includes('HQ');
}

function renderDetachment() {
  const button = $('#detachmentButton'); const detachment = selectedDetachment();
  button.innerHTML = detachment ? `${escapeHtml(detachment.name)} · ${numberFormat.format(detachment.detachmentPoints || 0)} DP <span>⌄</span>` : 'Seleccionar destacamento <span>⌄</span>';
  const summary = $('#detachmentSummary');
  if (!detachment) { summary.hidden = true; summary.innerHTML = ''; return; }
  const enhancements = enhancementsForDetachment();
  summary.hidden = false;
  summary.innerHTML = `<div class="detachment-summary-head"><strong>${escapeHtml(detachment.name)}</strong><span>${numberFormat.format(detachment.detachmentPoints || 0)} DP</span></div><p>${enhancements.length ? `${numberFormat.format(enhancements.length)} mejoras disponibles. Asigna una a cada personaje desde tu lista.` : 'Este destacamento no tiene mejoras con coste en el catálogo.'} Los DP se muestran aparte y no cuentan como puntos de ejército.</p>`;
}

function chooseDetachment() {
  const options = availableDetachments();
  if (!options.length) { toast('No hay destacamentos disponibles para esta facción en el snapshot cargado.'); return; }
  const dialog = $('#detachmentDialog');
  $('#detachmentOptions').innerHTML = options.map((card) => `<button type="button" class="detachment-option ${card.name === state.selectedDetachment ? 'selected' : ''}" data-detachment="${escapeHtml(card.name)}"><span><strong>${escapeHtml(card.name)}</strong><small>${numberFormat.format(card.costs.filter((cost) => cost.type === 'enhancement').length)} mejoras</small></span><b>${numberFormat.format(card.detachmentPoints || 0)} DP</b></button>`).join('');
  dialog.showModal();
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
  if (state.category === 'CHARACTERS') return unit.category.includes('CHARACTER') || unit.category.includes('HQ');
  return !unit.category.includes('BATTLELINE') && !unit.category.includes('TROOPS') && !unit.category.includes('CHARACTER') && !unit.category.includes('HQ');
}

function renderUnits() {
  const query = state.search.trim().toLocaleLowerCase('es');
  const units = groupedUnits().filter((unit) => categoryMatches(unit) && (!query || unit.name.toLocaleLowerCase('es').includes(query)));
  $('#unitCount').textContent = numberFormat.format(units.length);
  $('#unitsList').innerHTML = units.length ? units.map((unit, index) => {
    const models = [...new Set(unit.options.map((option) => option.models))];
    const bestOption = unit.options[0];
    const role = unit.category.includes('CHARACTER') || unit.category.includes('HQ') ? 'PERSONAJE' : unit.category.includes('BATTLELINE') ? 'LÍNEA' : 'UNIDAD';
    return `<article class="unit-card" data-unit="${escapeHtml(unit.name)}"><div class="unit-symbol ${role === 'PERSONAJE' ? 'character' : ''}">${role === 'PERSONAJE' ? '♟' : ['✣', '◉', '⌖', '✦'][index % 4]}</div><div class="unit-info"><div class="unit-name">${escapeHtml(unit.name)}</div><div class="unit-meta"><span class="role-tag">${role}</span><span>${models.map((model) => escapeHtml(model)).join(' · ')}</span></div></div><div class="unit-point">${numberFormat.format(bestOption.points)}<small>pts</small></div><select class="size-select" aria-label="Tamaño de ${escapeHtml(unit.name)}">${models.map((model) => { const option = unit.options.find((entry) => entry.models === model) || bestOption; return `<option value="${escapeHtml(model)}">${escapeHtml(model.replace(/ models?/i, ''))} · ${numberFormat.format(option.points)}</option>`; }).join('')}</select><button class="add-unit" data-add="${escapeHtml(unit.name)}" title="Añadir ${escapeHtml(unit.name)}" aria-label="Añadir ${escapeHtml(unit.name)}">＋</button></article>`;
  }).join('') : `<div class="empty-catalogue">No hay unidades que coincidan. Importa un catálogo MFM completo o prueba otro filtro.</div>`;
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
  const assigned = new Set(state.roster.map((entry) => entry.enhancement).filter(Boolean));
  $('#rosterItems').innerHTML = state.roster.map((entry, index) => {
    const enhancementSelect = selectedDetachment() && isCharacter(entry.unit) ? `<select class="enhancement-select" data-enhancement-index="${index}" aria-label="Mejora para ${escapeHtml(entry.unit)}"><option value="">Sin mejora</option>${enhancementsForDetachment().filter((cost) => !assigned.has(cost.label) || cost.label === entry.enhancement).map((cost) => `<option value="${escapeHtml(cost.label)}" ${cost.label === entry.enhancement ? 'selected' : ''}>${escapeHtml(cost.label)} · ${numberFormat.format(cost.points)} pts</option>`).join('')}</select>` : entry.enhancement ? `<div class="roster-item-sub">${escapeHtml(entry.enhancement)} · ${numberFormat.format(enhancementCost(entry.enhancement))} pts</div>` : '';
    return `<article class="roster-item"><div class="unit-symbol">${['✣', '◉', '⌖', '✦'][index % 4]}</div><div class="roster-item-main"><div class="roster-item-title">${escapeHtml(entry.unit)}</div><div class="roster-item-sub">${escapeHtml(entry.models)}${entry.range ? ` · ${escapeHtml(entry.range)}` : ''}</div>${enhancementSelect}</div><div class="roster-item-cost">${numberFormat.format((Number(entry.points) || 0) + enhancementCost(entry.enhancement))}<small style="font:500 8px var(--font);color:#819083"> pts</small></div><button class="remove-unit" data-remove="${index}" aria-label="Quitar ${escapeHtml(entry.unit)}">×</button></article>`;
  }).join('');
  const validity = $('#validity');
  validity.classList.toggle('valid', count > 0 && total <= limit); validity.classList.toggle('over', total > limit);
  validity.lastElementChild.textContent = total > limit ? 'Supera el límite de puntos' : count ? 'Lista dentro del límite' : 'Lista en progreso';
  $('#sidebarArmyName').textContent = state.listName; $('#unitTotal').textContent = `${count} ${count === 1 ? 'unidad' : 'unidades'}`;
  save();
}

function save() {
  const payload = { roster: state.roster, selectedFaction: state.selectedFaction, battleSize: state.battleSize, listName: state.listName, selectedDetachment: state.selectedDetachment };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function render() { renderFactionSelect(); renderUnits(); renderDetachment(); renderRoster(); }

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 2800);
}

function addUnit(name, models) {
  const unit = readUnit(name); if (!unit) return;
  const selectedModels = models || unit.options[0].models;
  const initial = selectedCost(unit, selectedModels, state.roster.filter((entry) => entry.unit === name).length + 1);
  state.roster.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, unit: name, models: selectedModels, points: initial.points, range: initial.range });
  save(); renderRoster(); toast(`${name} añadida al roster`);
}

function download(filename, text, type) {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function exportRoster() {
  const payload = { game: 'Warhammer 40,000', edition: 11, name: state.listName, faction: state.selectedFaction, battleSize: state.battleSize, detachment: selectedDetachment() ? { name: selectedDetachment().name, detachmentPoints: selectedDetachment().detachmentPoints } : null, points: rosterPoints(), source: state.source, units: state.roster };
  download(`${state.listName.trim().replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase() || 'lista'}-forge.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('Lista exportada en formato JSON');
}

function setData(text, source, factionCards = []) {
  const normalized = normalizeRows(parseCsv(text));
  if (!normalized.length) throw new Error('No se encontraron filas válidas. Revisa que sea el CSV de puntos del MFM.');
  state.rows = normalized;
  state.roster = state.roster.filter((entry) => normalized.some((row) => row.faction === state.selectedFaction && row.unit === entry.unit));
  state.source = source; state.factionCards = factionCards;
  if (!availableDetachments().some((card) => card.name === state.selectedDetachment)) state.selectedDetachment = '';
  state.roster.forEach((entry) => { if (!enhancementsForDetachment().some((cost) => cost.label === entry.enhancement)) entry.enhancement = ''; });
  render(); save();
  $('#sourceText').textContent = `Puntos de unidad desde ${source.label}. La extracción completa incluye wargear, mejoras y destacamentos en data/mfm-snapshot.json y data/mfm-points.csv.`;
  toast(`Catálogo cargado: ${numberFormat.format(normalized.length)} entradas`);
}

function openImportMenu() {
  $('#importDialog').showModal();
}

async function updateFromMfm() {
  toast('Cargando el snapshot local…');
  try {
    const [csvResponse, snapshotResponse] = await Promise.all([fetch('./data/mfm-points.csv'), fetch('./data/mfm-snapshot.json')]);
    if (!csvResponse.ok || !snapshotResponse.ok) throw new Error('Primero ejecuta node scripts/scrape-mfm.mjs para generar el snapshot.');
    const [csv, snapshot] = await Promise.all([csvResponse.text(), snapshotResponse.json()]);
    const date = snapshot.scrapedAt?.slice(0, 10) || 'sin fecha';
    setData(csv, { version: snapshot.manualVersion || 'unknown', date, label: `${snapshot.manualVersion || 'MFM'} · scrape ${date}` }, snapshot.factions.find((faction) => faction.name.toLocaleLowerCase('es') === state.selectedFaction.toLocaleLowerCase('es'))?.cards || []);
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
  if (saved.selectedDetachment) state.selectedDetachment = saved.selectedDetachment;
  $('#listName').value = state.listName; $('#battleSize').value = String(state.battleSize);
  Promise.all([fetch('./data/mfm-points.csv'), fetch('./data/mfm-snapshot.json')]).then(async ([csvResponse, snapshotResponse]) => {
    if (!csvResponse.ok || !snapshotResponse.ok) throw new Error('Snapshot scrapeado todavía no disponible.');
    const [csv, snapshot] = await Promise.all([csvResponse.text(), snapshotResponse.json()]);
    const date = snapshot.scrapedAt?.slice(0, 10) || 'sin fecha';
    setData(csv, { version: snapshot.manualVersion || 'unknown', date, label: `${snapshot.manualVersion || 'MFM'} · scrape ${date}` }, snapshot.factions.find((faction) => faction.name.toLocaleLowerCase('es') === state.selectedFaction.toLocaleLowerCase('es'))?.cards || []);
  }).catch(() => fetch('./data/points.csv').then((response) => response.text()).then((csv) => setData(csv, state.source)).catch(() => {
    state.rows = normalizeRows(parseCsv(`faction,unit,groupTitle,legends,range,label,models,points\nChaos Space Marines,Chaos Bikers,OTHER,false,1st-2nd,Your Unit Costs,3 models,80`)); render();
  }));
  $('#listName').addEventListener('input', (event) => { state.listName = event.target.value || 'Lista sin nombre'; save(); renderRoster(); });
  $('#factionSelect').addEventListener('change', async (event) => {
    state.selectedFaction = event.target.value; state.roster = []; state.selectedDetachment = ''; state.factionCards = [];
    try { const response = await fetch('./data/mfm-snapshot.json'); const snapshot = await response.json(); state.factionCards = snapshot.factions.find((faction) => faction.name.toLocaleLowerCase('es') === state.selectedFaction.toLocaleLowerCase('es'))?.cards || []; } catch {}
    save(); render();
  });
  $('#battleSize').addEventListener('change', (event) => { state.battleSize = Number(event.target.value); save(); renderRoster(); });
  $('#unitSearch').addEventListener('input', (event) => { state.search = event.target.value; renderUnits(); });
  $('#categoryTabs').addEventListener('click', (event) => { const tab = event.target.closest('[data-category]'); if (!tab) return; state.category = tab.dataset.category; document.querySelectorAll('.category-tab').forEach((button) => button.classList.toggle('selected', button === tab)); renderUnits(); });
  $('#unitsList').addEventListener('click', (event) => { const button = event.target.closest('[data-add]'); if (!button) return; const card = button.closest('.unit-card'); addUnit(button.dataset.add, card.querySelector('.size-select')?.value); });
  $('#rosterItems').addEventListener('click', (event) => { const button = event.target.closest('[data-remove]'); if (!button) return; state.roster.splice(Number(button.dataset.remove), 1); save(); renderRoster(); });
  $('#rosterItems').addEventListener('change', (event) => { const select = event.target.closest('[data-enhancement-index]'); if (!select) return; const entry = state.roster[Number(select.dataset.enhancementIndex)]; if (!entry) return; entry.enhancement = select.value; save(); renderRoster(); });
  $('#clearRoster').addEventListener('click', () => { if (!state.roster.length) return; state.roster = []; save(); renderRoster(); toast('Roster vaciado'); });
  $('#exportButton').addEventListener('click', exportRoster);
  $('#importButton').addEventListener('click', openImportMenu);
  $('#updateMfmButton').addEventListener('click', () => { $('#importDialog').close(); updateFromMfm(); });
  $('#localImportButton').addEventListener('click', () => { $('#importDialog').close(); $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; try { setData(await file.text(), { version: 'local', date: new Date().toLocaleDateString('es-ES'), label: `CSV local · ${file.name}` }); } catch (error) { toast(error.message); } event.target.value = ''; });
  $('#topAddButton').addEventListener('click', () => $('#unitSearch').focus()); $('#emptyAddButton').addEventListener('click', () => { $('#addUnits').scrollIntoView({ behavior: 'smooth' }); $('#unitSearch').focus(); });
  $('#sourceLink').addEventListener('click', () => window.open('https://mfm.warhammer-community.com/en', '_blank', 'noopener,noreferrer'));
  $('#helpButton').addEventListener('click', () => $('#helpDialog').showModal());
  $('#newArmyButton').addEventListener('click', () => { state.listName = 'Nueva lista'; state.roster = []; state.selectedDetachment = ''; $('#listName').value = state.listName; save(); render(); toast('Nueva lista preparada'); });
  $('#detachmentButton').addEventListener('click', chooseDetachment);
  $('#detachmentOptions').addEventListener('click', (event) => { const option = event.target.closest('[data-detachment]'); if (!option) return; state.selectedDetachment = option.dataset.detachment; state.roster.forEach((entry) => { if (!enhancementsForDetachment().some((cost) => cost.label === entry.enhancement)) entry.enhancement = ''; }); $('#detachmentDialog').close(); save(); render(); toast(`Destacamento ${state.selectedDetachment} seleccionado`); });
  $('#filterButton').addEventListener('click', () => toast('Elige una categoría con las pestañas del arsenal.'));
  $('#listMenuButton').addEventListener('click', exportRoster); $('#rosterMenuButton').addEventListener('click', exportRoster);
  document.addEventListener('keydown', (event) => { if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#unitSearch').focus(); } });
}

init();

