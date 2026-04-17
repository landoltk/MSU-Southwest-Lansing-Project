const map = new maplibregl.Map({
    container: 'map',
    center: [-84.582236, 42.697406],
    zoom: 12,
    style: 'static/map-style.json'
});
map.addControl(new maplibregl.NavigationControl());

const arcgisBlockGroups = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/2010_Block_Groups/FeatureServer/0/query?where=CNTY_CODE%20IN%20(65,45,37)&outFields=*&f=geojson&outSR=4326';
const arcgisBlocksQuery = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/tl_2025_26_tabblock20/FeatureServer/0/query?where=COUNTYFP20%20IN%20(%27065%27,%27045%27,%27037%27)&outFields=*&f=geojson&outSR=4326';
const populationACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/PopulationACS/FeatureServer/0/query?where=1=1&outFields=GEO_ID,B01003_001E&f=json';
const communityGardens = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/Community_Garden_Parcels/FeatureServer/0/query?where=1=1&outFields=*&f=geojson&outSR=4326';

let activeId = null;
const selectedIds = new Set();
const idToName = new Map();
const idToRow = new Map();
let selectionLocked = false;

let blockGroupGeojson = null;
let blockGeojson = null;
let lastRadiusCircle = null;

let blockModeActive = false;
const candidateBlockIds = new Set();
const selectedBlockIds = new Set();

const filterLabels = {
    'food-filter': 'Food',
    'housesize-filter': 'Household Size',
    'race-filter': 'Race',
    'population-filter': 'Population',
    'health-filter': 'Health',
    'income-filter': 'Income'
};

function key12FromAcs(geoId) {
    const d = String(geoId ?? '').replace(/\D/g, '');
    return d.slice(-12) || null;
}

function key12FromLink(link) {
    const d = String(link ?? '').replace(/\D/g, '').slice(-9);
    if (d.length !== 9) return null;
    const c2 = d.slice(0, 2);
    const t6 = d.slice(2, 8);
    const b1 = d.slice(8);
    return '26' + c2.padStart(3, '0') + t6 + b1;
}

function getBlockId(feature) {
    return String(
        feature?.properties?.GEOID20 ??
        feature?.properties?.GEOID ??
        feature?.properties?.BLOCKID ??
        feature?.id ??
        ''
    );
}

function blockToBgId(blockId) {
    const digits = String(blockId || '').replace(/\D/g, '');
    return digits.length >= 12 ? digits.slice(0, 12) : null;
}

function parseBgLabel(name) {
    const s = String(name);
    if (!s.length) return { tract: s, bg: s };
    return { tract: s.slice(0, -1), bg: s.slice(-1) };
}

async function joinAcsToBgs(acsUrl, bgUrl) {
    const [acs, bg] = await Promise.all([
        fetch(acsUrl).then(r => r.json()).then(j => (j.features || []).map(f => f.attributes || {})),
        fetch(bgUrl).then(r => r.json())
    ]);

    const m = new Map();

    for (const r of acs) {
        const k = key12FromAcs(r.GEO_ID);
        if (k) m.set(k, r);
    }

    for (const f of (bg.features || [])) {
        const p = f.properties || {};
        const k = key12FromLink(p.LINK);
        if (!k) continue;
        p.JOINKEY12 = k;
        f.id = k;
        idToName.set(k, String(p.NAME ?? k));
        const row = m.get(k);
        if (row) {
            idToRow.set(k, row);
            p.csv_B01003_001E = row.B01003_001E;
        }
    }

    return bg;
}

async function fetchBlocksGeojson() {
    const geojson = await fetch(arcgisBlocksQuery).then(r => r.json());

    for (const f of (geojson.features || [])) {
        const blockId = getBlockId(f);
        if (!f.properties) f.properties = {};
        f.properties.BLOCKID = blockId;
        f.properties.BGID12 = blockToBgId(blockId);
        f.id = blockId;
    }

    return geojson;
}

async function fetchRequestedBgs() {
    const res = await fetch('static/data/requested_bg.txt', { cache: 'no-store' });
    if (!res.ok) return [];
    const text = await res.text();
    return text.split(/\r?\n/).map(s => key12FromLink(s)).filter(Boolean);
}

function getDisplayMode() {
    if (document.getElementById('radius-display')?.checked) return 'radius';
    return 'swl';
}

function renderSelectedList() {
    const list = document.getElementById('selected-list');

    if (!selectedIds.size) {
        list.innerHTML = 'None';
        return;
    }

    const items = [...selectedIds].map(id => {
        const name = idToName.get(id) || id;
        const p = parseBgLabel(name);
        const label = p.tract && p.bg ? `Tract ${p.tract}, BG ${p.bg}` : name;
        return `
        <li>
            <a href="#" class="bg-link" data-id="${id}">
                ${label}
            </a>
        </li>`;
    });

    const blockSummary = blockModeActive
        ? `<div style="margin:0 0 8px 0; font-size:12px; color:#555;">Selected Blocks: ${selectedBlockIds.size.toLocaleString()}</div>`
        : '';

    list.innerHTML = `
        ${blockSummary}
        <ul style="margin:8px 0 0 18px; padding:0;">
            ${items.join('')}
        </ul>`;

    document.querySelectorAll('.bg-link').forEach(a => {
        a.onclick = e => {
            e.preventDefault();
            const id = String(a.getAttribute('data-id'));
            highlightActive(id);
            highlightDataRow(id);
        };
    });
}

function getActiveFilter() {
    return Object.keys(filterLabels).find(id => {
        const cb = document.getElementById(id);
        return cb && cb.checked;
    });
}

function updateSelectedFilterText() {
    const el = document.getElementById('selected-filter-display');
    const active = getActiveFilter();
    if (!el) return;
    el.textContent = active ? `Selected Filter: ${filterLabels[active]}` : 'Selected Filter: None';
}

function updateShowDataButton() {
    const btn = document.getElementById('show-data-btn');
    if (!btn) return;
    btn.disabled = !(selectionLocked && getActiveFilter() && selectedIds.size);
}

function syncSelectedFill() {
    map.setFilter('default-selected-fill', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', [...selectedIds]]
    ]);
}

function syncBlockCandidateFill() {
    if (!map.getLayer('block-candidate-fill')) return;
    map.setFilter('block-candidate-fill', [
        'in',
        ['get', 'BLOCKID'],
        ['literal', [...candidateBlockIds]]
    ]);
    map.setFilter('block-outline', [
        'in',
        ['get', 'BLOCKID'],
        ['literal', [...candidateBlockIds]]
    ]);
}

function syncBlockSelectedFill() {
    if (!map.getLayer('block-selected-fill')) return;
    map.setFilter('block-selected-fill', [
        'in',
        ['get', 'BLOCKID'],
        ['literal', [...selectedBlockIds]]
    ]);
}

function setBlockLayersVisible(flag) {
    const v = flag ? 'visible' : 'none';
    ['block-candidate-fill', 'block-selected-fill', 'block-outline'].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
    });
}

function clearRadiusCircle() {
    lastRadiusCircle = null;
    if (map.getSource('radius-circle')) {
        map.getSource('radius-circle').setData({
            type: 'FeatureCollection',
            features: []
        });
    }
}

function setCommunityGardensVisible(flag) {
    const v = flag ? 'visible' : 'none';
    if (map.getLayer('community-gardens-fill')) {
        map.setLayoutProperty('community-gardens-fill', 'visibility', v);
        map.setLayoutProperty('community-gardens-outline', 'visibility', v);
    }
}

function toggleSelection(id) {
    const key = String(id);
    if (selectedIds.has(key)) selectedIds.delete(key);
    else selectedIds.add(key);
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
}

function highlightActive(id) {
    activeId = String(id);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', String(id)]);
    highlightDataRow(id);
}

function applyDefaultSelection(ids) {
    selectedIds.clear();
    ids.forEach(id => selectedIds.add(String(id)));
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
}

function buildPopulationBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    if (!selectedIds.size) {
        box.style.display = 'none';
        return;
    }

    const rowsHtml = [...selectedIds].map(id => {
        const name = idToName.get(id) || id;
        const row = idToRow.get(id) || {};
        const raw = row['B01003_001E'];
        const val = Number.isFinite(Number(raw)) ? Number(raw).toLocaleString() : (raw ?? '');
        return `<tr data-id="${id}"><td style="padding:6px 8px;border-bottom:1px solid #eee;">${name}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${val}</td></tr>`;
    }).join('');

    content.innerHTML = `<table style="border-collapse:collapse;width:100%">
        <thead>
            <tr>
                <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Population</th>
            </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
    </table>`;

    box.style.display = 'block';
}

function buildPlaceholderBox(label) {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');
    content.innerHTML = `<h4>${label}</h4><p>Data coming soon.</p>`;
    box.style.display = 'block';
}

function highlightDataRow(id) {
    const rows = document.querySelectorAll('#data-box tbody tr');
    rows.forEach(tr => {
        if (tr.getAttribute('data-id') === String(id)) tr.style.background = '#fde68a';
        else tr.style.background = '';
    });
}

function updateDisplayMethodUI() {
    const radiusControls = document.getElementById('radius-controls');
    const blockControls = document.getElementById('block-controls');
    const details = document.getElementById('details');

    if (radiusControls) {
        radiusControls.style.display = getDisplayMode() === 'radius' ? 'block' : 'none';
    }

    if (blockControls) {
        blockControls.style.display = blockModeActive ? 'block' : 'none';
    }

    if (!details) return;

    if (blockModeActive && getDisplayMode() === 'radius') {
        details.textContent = 'Block + Radius mode: click anywhere on the map to recalculate the selected blocks.';
    } else if (blockModeActive) {
        details.textContent = 'Block mode: click orange census blocks to refine your submitted selection.';
    } else if (getDisplayMode() === 'radius') {
        details.textContent = 'Radius mode: click anywhere on the map to select block groups within the radius.';
    } else {
        details.textContent = 'Click a polygon to view details.';
    }
}

function enterBlockMode() {
    if (!selectionLocked || !selectedIds.size) {
        alert('Submit a block-group selection first, then enable Block Level.');
        const cb = document.getElementById('block-display');
        if (cb) cb.checked = false;
        return;
    }

    blockModeActive = true;
    candidateBlockIds.clear();
    selectedBlockIds.clear();

    for (const feature of (blockGeojson?.features || [])) {
        const blockId = getBlockId(feature);
        const bgId = feature?.properties?.BGID12 || blockToBgId(blockId);
        if (blockId && bgId && selectedIds.has(bgId)) {
            candidateBlockIds.add(blockId);
            selectedBlockIds.add(blockId);
        }
    }

    syncBlockCandidateFill();
    syncBlockSelectedFill();
    setBlockLayersVisible(true);
    renderSelectedList();
    updateDisplayMethodUI();
}

function exitBlockMode() {
    blockModeActive = false;
    candidateBlockIds.clear();
    selectedBlockIds.clear();
    syncBlockCandidateFill();
    syncBlockSelectedFill();
    setBlockLayersVisible(false);
    renderSelectedList();
    updateDisplayMethodUI();
}

function recomputeSelectedBgsFromBlocks() {
    selectedIds.clear();

    selectedBlockIds.forEach(blockId => {
        const bgId = blockToBgId(blockId);
        if (bgId) selectedIds.add(bgId);
    });

    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();

    const details = document.getElementById('details');
    if (details) {
        details.textContent = `Block level updated: ${selectedBlockIds.size.toLocaleString()} block(s) selected across ${selectedIds.size.toLocaleString()} block group(s).`;
    }
}

function toggleBlockSelection(blockId) {
    const id = String(blockId);
    if (!candidateBlockIds.has(id)) return;

    if (selectedBlockIds.has(id)) selectedBlockIds.delete(id);
    else selectedBlockIds.add(id);

    syncBlockSelectedFill();
    recomputeSelectedBgsFromBlocks();
}

function selectBlockGroupsByRadius(centerLngLat, radiusMiles) {
    if (!blockGroupGeojson || !map.getSource('radius-circle')) return;
    if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) return;

    const circle = turf.circle([centerLngLat.lng, centerLngLat.lat], radiusMiles, {
        steps: 64,
        units: 'miles'
    });

    lastRadiusCircle = circle;
    map.getSource('radius-circle').setData(circle);

    selectedIds.clear();

    for (const feature of (blockGroupGeojson.features || [])) {
        const id = String(feature.properties?.JOINKEY12 ?? feature.id ?? '');
        if (!id) continue;

        try {
            if (turf.booleanIntersects(feature, circle)) selectedIds.add(id);
        } catch (err) {
            console.warn('Intersection check failed for feature:', id, err);
        }
    }

    activeId = null;
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();

    const details = document.getElementById('details');
    if (details) {
        details.textContent = `Radius selection complete: ${selectedIds.size} block group(s) selected within ${radiusMiles} mile(s).`;
    }
}

function selectBlocksByRadius(centerLngLat, radiusMiles) {
    if (!blockGeojson || !map.getSource('radius-circle')) return;
    if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) return;

    const circle = turf.circle([centerLngLat.lng, centerLngLat.lat], radiusMiles, {
        steps: 64,
        units: 'miles'
    });

    lastRadiusCircle = circle;
    map.getSource('radius-circle').setData(circle);

    selectedBlockIds.clear();

    for (const feature of (blockGeojson.features || [])) {
        const blockId = getBlockId(feature);
        if (!blockId || !candidateBlockIds.has(blockId)) continue;

        try {
            if (turf.booleanIntersects(feature, circle)) selectedBlockIds.add(blockId);
        } catch (err) {
            console.warn('Block intersection failed for block:', blockId, err);
        }
    }

    syncBlockSelectedFill();
    recomputeSelectedBgsFromBlocks();

    const details = document.getElementById('details');
    if (details) {
        details.textContent = `Block radius selection complete: ${selectedBlockIds.size.toLocaleString()} block(s) selected within ${radiusMiles} mile(s).`;
    }
}

async function resetToSouthwestLansing() {
    const ids = await fetchRequestedBgs();

    selectedIds.clear();
    activeId = null;
    selectionLocked = false;

    ids.forEach(id => selectedIds.add(String(id)));

    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
    syncSelectionModeUI();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    clearRadiusCircle();
    setCommunityGardensVisible(false);

    const blockCheckbox = document.getElementById('block-display');
    if (blockCheckbox) blockCheckbox.checked = false;
    exitBlockMode();

    document.getElementById('data-box').style.display = 'none';
    updateDisplayMethodUI();
}

function setLoading(flag) {
    const btn = document.getElementById('reload');
    if (btn) {
        btn.disabled = flag;
        btn.textContent = flag ? 'Loading...' : 'Reload list';
    }
}

function setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
}

function syncSelectionModeUI() {
    const btn = document.getElementById('clear-selection');
    if (!btn) return;
    btn.textContent = selectionLocked ? 'Edit Selection' : 'Unselect All';
}

map.on('load', async () => {
    setLoading(true);

    try {
        const data = await joinAcsToBgs(populationACS, arcgisBlockGroups);
        const blocks = await fetchBlocksGeojson();

        blockGroupGeojson = data;
        blockGeojson = blocks;

        map.addSource('arcgis-layer', { type: 'geojson', data, promoteId: 'JOINKEY12' });
        map.addSource('blocks-layer', { type: 'geojson', data: blocks, promoteId: 'BLOCKID' });
        map.addSource('community-gardens', { type: 'geojson', data: communityGardens });
        map.addSource('radius-circle', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        map.addLayer({
            id: 'bg-fill',
            type: 'fill',
            source: 'arcgis-layer',
            paint: { 'fill-color': '#2b8a3e', 'fill-opacity': 0.25 }
        });

        map.addLayer({
            id: 'bg-outline',
            type: 'line',
            source: 'arcgis-layer',
            paint: { 'line-color': '#166534', 'line-width': 1 }
        });

        map.addLayer({
            id: 'default-selected-fill',
            type: 'fill',
            source: 'arcgis-layer',
            paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.6 },
            filter: ['in', ['get', 'JOINKEY12'], ['literal', []]]
        });

        map.addLayer({
            id: 'active-bg-highlight',
            type: 'fill',
            source: 'arcgis-layer',
            paint: { 'fill-color': '#fde68a', 'fill-opacity': 0.4 },
            filter: ['==', 'JOINKEY12', '___none___']
        });

        map.addLayer({
            id: 'block-candidate-fill',
            type: 'fill',
            source: 'blocks-layer',
            paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.18 },
            layout: { visibility: 'none' },
            filter: ['in', ['get', 'BLOCKID'], ['literal', []]]
        });

        map.addLayer({
            id: 'block-selected-fill',
            type: 'fill',
            source: 'blocks-layer',
            paint: { 'fill-color': '#ea580c', 'fill-opacity': 0.58 },
            layout: { visibility: 'none' },
            filter: ['in', ['get', 'BLOCKID'], ['literal', []]]
        });

        map.addLayer({
            id: 'block-outline',
            type: 'line',
            source: 'blocks-layer',
            paint: { 'line-color': '#c2410c', 'line-width': 0.5 },
            layout: { visibility: 'none' },
            filter: ['in', ['get', 'BLOCKID'], ['literal', []]]
        });

        map.addLayer({
            id: 'community-gardens-fill',
            type: 'fill',
            source: 'community-gardens',
            paint: { 'fill-color': '#5fe653', 'fill-opacity': 0.6 },
            layout: { visibility: 'none' }
        });

        map.addLayer({
            id: 'community-gardens-outline',
            type: 'line',
            source: 'community-gardens',
            paint: { 'line-color': '#45ac3b', 'line-width': 1 },
            layout: { visibility: 'none' }
        });

        map.addLayer({
            id: 'radius-circle-fill',
            type: 'fill',
            source: 'radius-circle',
            paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.15 }
        });

        map.addLayer({
            id: 'radius-circle-outline',
            type: 'line',
            source: 'radius-circle',
            paint: { 'line-color': '#2563eb', 'line-width': 2 }
        });

        map.on('mouseenter', 'bg-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'bg-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        map.on('mouseenter', 'block-candidate-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'block-candidate-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        map.on('click', 'bg-fill', e => {
            if (!e.features?.length) return;
            if (getDisplayMode() === 'radius') return;
            if (blockModeActive) return;

            const f = e.features[0];
            const id = String(f.id ?? f.properties?.JOINKEY12 ?? '');
            if (!id) return;

            if (!selectionLocked) {
                toggleSelection(id);
                highlightActive(id);
                updateShowDataButton();
            }
        });

        map.on('click', 'block-candidate-fill', e => {
            if (!blockModeActive || selectionLocked) return;
            if (!e.features?.length) return;

            const blockId = getBlockId(e.features[0]);
            if (!blockId) return;

            toggleBlockSelection(blockId);
        });

        map.on('click', e => {
            if (selectionLocked) return;
            if (getDisplayMode() !== 'radius') return;

            const radiusInput = document.getElementById('radius-input');
            const radiusMiles = Number(radiusInput?.value || 1);

            if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
                alert('Please enter a valid radius greater than 0.');
                return;
            }

            if (blockModeActive) selectBlocksByRadius(e.lngLat, radiusMiles);
            else selectBlockGroupsByRadius(e.lngLat, radiusMiles);
        });

        const ids = await fetchRequestedBgs();
        applyDefaultSelection(ids);
        setStatus(`Loaded ${ids.length} BG(s) from list`);
        syncSelectionModeUI();
        updateDisplayMethodUI();
    } catch (e) {
        console.error(e);
        setStatus('Error loading data');
    } finally {
        setLoading(false);
    }
});

document.getElementById('clear-selection').addEventListener('click', () => {
    if (selectionLocked) {
        selectionLocked = false;
        setCommunityGardensVisible(false);
        document.getElementById('data-box').style.display = 'none';
        map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', [...selectedIds]]]);
        syncSelectionModeUI();
        updateShowDataButton();
        return;
    }

    if (blockModeActive) {
        selectedBlockIds.clear();
        syncBlockSelectedFill();
        recomputeSelectedBgsFromBlocks();
        document.getElementById('data-box').style.display = 'none';
        return;
    }

    selectedIds.clear();
    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    renderSelectedList();
    document.getElementById('data-box').style.display = 'none';
    updateShowDataButton();
});

document.getElementById('submit-selection').addEventListener('click', () => {
    if (!selectedIds.size) return;

    selectionLocked = true;
    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', [...selectedIds]]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    syncSelectionModeUI();
    updateShowDataButton();

    if (document.getElementById('block-display')?.checked) {
        enterBlockMode();
    }
});

document.getElementById('show-data-btn').addEventListener('click', () => {
    const f = getActiveFilter();
    if (!f) return;

    if (f === 'population-filter') {
        buildPopulationBox();
    } else if (f === 'food-filter') {
        setCommunityGardensVisible(true);
        buildPlaceholderBox(filterLabels[f]);
    } else {
        buildPlaceholderBox(filterLabels[f]);
    }
});

document.getElementById('close-data-box').addEventListener('click', () => {
    document.getElementById('data-box').style.display = 'none';
});

const drawerToggle = document.getElementById('drawer-toggle');
const drawerPanel = document.getElementById('drawer-panel');
const filtersDrawerToggle = document.getElementById('filters-drawer-toggle');
const filtersDrawerPanel = document.getElementById('filters-drawer-panel');
const swlDisplay = document.getElementById('swl-display');
const radiusDisplay = document.getElementById('radius-display');
const blockDisplay = document.getElementById('block-display');

drawerToggle.addEventListener('click', () => {
    const filtersHandle = document.getElementById('filters-drawer-toggle');

    if (!drawerPanel.classList.contains('open')) {
        filtersDrawerPanel.classList.remove('open');
        filtersDrawerToggle.classList.remove('open');
    }

    drawerPanel.classList.toggle('open');
    drawerToggle.classList.toggle('open');

    if (drawerPanel.classList.contains('open')) {
        filtersHandle.style.opacity = '0';
        filtersHandle.style.pointerEvents = 'none';
    } else {
        filtersHandle.style.opacity = '1';
        filtersHandle.style.pointerEvents = 'auto';
    }
});

swlDisplay.addEventListener('click', async () => {
    await resetToSouthwestLansing();
});

radiusDisplay.addEventListener('change', () => {
    if (!radiusDisplay.checked) clearRadiusCircle();
    updateDisplayMethodUI();
});

blockDisplay.addEventListener('change', () => {
    if (blockDisplay.checked) enterBlockMode();
    else exitBlockMode();
});

filtersDrawerToggle.addEventListener('click', () => {
    filtersDrawerPanel.classList.toggle('open');
    filtersDrawerToggle.classList.toggle('open');
});

[
    'food-filter',
    'housesize-filter',
    'race-filter',
    'population-filter',
    'health-filter',
    'income-filter'
].forEach(id => {
    const cb = document.getElementById(id);
    if (cb) {
        cb.addEventListener('change', () => {
            if (!selectionLocked) {
                cb.checked = false;
                return;
            }

            if (cb.checked) {
                ['food-filter', 'housesize-filter', 'race-filter', 'population-filter', 'health-filter', 'income-filter']
                    .forEach(other => {
                        if (other !== id) {
                            const o = document.getElementById(other);
                            if (o) o.checked = false;
                        }
                    });
            }

            updateSelectedFilterText();
            setCommunityGardensVisible(false);
            document.getElementById('data-box').style.display = 'none';
            updateShowDataButton();
        });
    }
});

updateSelectedFilterText();
updateDisplayMethodUI();
