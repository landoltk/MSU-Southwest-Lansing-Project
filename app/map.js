//basic map initialization
const map = new maplibregl.Map({
    container: 'map',
    center: [-84.582236, 42.697406],
    zoom: 12,
    style: 'static/map-style.json'
});
map.addControl(new maplibregl.NavigationControl());

//arcGIS URLs
const arcgisBlockGroups = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/2020_Michigan_BGs/FeatureServer/0/query?where=COUNTYFP%20IN%20(65,45,37)&outFields=*&f=geojson&outSR=4326';
const populationACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/PopulationACS/FeatureServer/0/query?where=1=1&outFields=GEO_ID,B01003_001E&f=json';
const communityGardens = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/Community_Garden_Parcels/FeatureServer/0/query?where=1=1&outFields=*&f=geojson&outSR=4326';

let activeId = null;
const selectedIds = new Set();
const selectedBlockIds = new Set();
const idToName = new Map();
const idToRow = new Map();

const SelectionMode = {
    BG_SELECT: 'bg-select',
    BLOCK_SELECT: 'block-select',
    LOCKED: 'locked-select'
};

let selectionMode = SelectionMode.BG_SELECT;
let lastSubmittedIds = [];
let selectionModeBG = 'block'; // 'block' or 'neighborhood'
const selectedNeighborhoods = new Set();
let blockGroupGeojson = null;
let lastRadiusCircle = null;

let pinnedTableId = null;
let hoveredTableId = null;
let hoveredNeighborhoodName = null;
let pinnedNeighborhoodName = null;

const neighborhoodToBgs = {
    "Coachlight Neighborhood Association": ["260650051002"],
    "Wexford Heights Neighborhood Association": ["260650051003"],
    "Churchill Downs Community Association": ["260650036011", "260650036012", "260650036013"],
    "Averill Woods Neighborhood Association": ["260650017032"],
    "Wood-Mere Neighborhood Organization": ["260650017033"],
    "Lewton Rich Neighborhood Association": ["260650017031"],
    "Riverview Estates Neighbors United": ["260650017031"],
    "Colonial Village Neighborhood": ["260650070004", "260650070005", "260650037005"]
};

const bgToNeighborhoods = new Map();

function buildBgToNeighborhoods() {
    Object.entries(neighborhoodToBgs).forEach(([neighborhood, ids]) => {
        ids.forEach(id => {
            const key = String(id);
            if (!bgToNeighborhoods.has(key)) {
                bgToNeighborhoods.set(key, []);
            }
            bgToNeighborhoods.get(key).push(neighborhood);
        });
    });
}
buildBgToNeighborhoods();

const filterLabels = {
    'food-filter': 'Food',
    'housesize-filter': 'Household Ownership',
    'race-filter': 'Race',
    'population-filter': 'Population',
    'health-filter': 'Health',
    'income-filter': 'Income'
};

const blockHoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false
});

// -------------------- HELPERS --------------------

function key12FromBgGEOID(geoid) {
    const d = String(geoid ?? '').replace(/\D/g, '');
    return d.length === 12 ? d : null;
}

function key12FromBlockGEOID(geoid20) {
    const d = String(geoid20 ?? '').replace(/\D/g, '');
    return d.length === 15 ? d.slice(0, 12) : null;
}

function key12FromAcs(geoId) {
    const d = String(geoId ?? '').replace(/\D/g, '');
    return d.length >= 12 ? d.slice(-12) : null;
}

function attachJoinKeyToBlocks(blockGeojson) {
    for (const f of blockGeojson.features ?? []) {
        const p = f.properties ?? {};
        const k = key12FromBlockGEOID(p.GEOID20);
        if (k) p.JOINKEY12 = k;
    }
}

async function loadBlocksForSelectedBgs() {
    const where = [...selectedIds]
        .map(k => `GEOID20 LIKE '${k}%'`)
        .join(' OR ');

    const url =
        'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/' +
        'tl_2025_26_tabblock20/FeatureServer/0/query' +
        `?where=${encodeURIComponent(where)}&outFields=*&f=geojson&outSR=4326`;

    const blocks = await fetch(url).then(r => r.json());
    attachJoinKeyToBlocks(blocks);
    map.getSource('blocks').setData(blocks);
    return blocks;
}

async function joinAcsToBgs(acsUrl, bgUrl) {
    const [acs, bg] = await Promise.all([
        fetch(acsUrl)
            .then(r => r.json())
            .then(j => (j.features ?? []).map(f => f.attributes ?? {})),
        fetch(bgUrl).then(r => r.json())
    ]);

    const acsMap = new Map();

    for (const r of acs) {
        const k = key12FromAcs(r.GEO_ID);
        if (k) acsMap.set(k, r);
    }

    for (const f of (bg.features ?? [])) {
        const p = f.properties ?? {};
        const k = key12FromBgGEOID(p.GEOID);
        if (!k) continue;

        p.JOINKEY12 = k;
        idToName.set(k, p.NAME ?? k);

        const row = acsMap.get(k);
        if (row) {
            idToRow.set(k, row);
            p.csv_B01003_001E = row.B01003_001E;
        }
    }

    return bg;
}

async function fetchRequestedBgs() {
    const res = await fetch('static/data/requested_bg.txt', { cache: 'no-store' });
    if (!res.ok) return [];
    const text = await res.text();
    return text
        .split(/\r?\n/)
        .map(s => key12FromBgGEOID(s))
        .filter(Boolean);
}

async function fetchCsvRows(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load CSV: ${url}`);
    const text = await res.text();

    const lines = text.trim().split(/\r?\n/);
    const headers = parseCsvLine(lines[0]);

    return lines.slice(1).map(line => {
        const values = parseCsvLine(line);
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = values[i] ?? '';
        });
        return obj;
    });
}

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];

        if (ch === '"' && inQuotes && next === '"') {
            cur += '"';
            i++;
        } else if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }

    out.push(cur);
    return out;
}

function parseBgLabel(name) {
    const s = String(name ?? '');
    if (!s.length) return { tract: s, bg: s };
    return {
        tract: s.slice(5, -1),
        bg: s.slice(-1)
    };
}

function formatBgId(joinKey12) {
    const d = String(joinKey12 ?? '').replace(/\D/g, '');
    if (d.length !== 12) return joinKey12;

    const county = parseInt(d.slice(2, 5), 10);
    const tractRaw = d.slice(5, 11);
    const tract = `${parseInt(tractRaw.slice(0, -2), 10)}.${tractRaw.slice(-2)}`;
    const bg = parseInt(d.slice(11), 10);

    return `County ${county} · Tract ${tract} · Block Group ${bg}`;
}

function formatBlockId(geoid20) {
    const d = String(geoid20 ?? '').replace(/\D/g, '');
    if (d.length !== 15) return geoid20;
    const tractRaw = d.slice(5, 11);
    return `County ${parseInt(d.slice(2, 5), 10)} · Tract ${parseInt(tractRaw.slice(0, -2), 10)}.${tractRaw.slice(-2)} · Block Group ${d.slice(11, 12)} · Block ${parseInt(d.slice(12), 10)}`;
}

function getDisplayMode() {
    if (document.getElementById('radius-display')?.checked) return 'radius';
    if (document.getElementById('neighborhoods-display')?.checked) return 'neighborhoods';
    return 'swl';
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
    btn.disabled = !(
        selectionMode === SelectionMode.LOCKED &&
        getActiveFilter() &&
        selectedIds.size
    );
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

    if (selectionMode === SelectionMode.BLOCK_SELECT || selectionMode === SelectionMode.LOCKED) {
        btn.textContent = 'Edit Selection';
    } else {
        btn.textContent = 'Unselect All';
    }
}

function syncSelectionHeader() {
    const header = document.getElementById('selection-mode');
    if (!header) return;

    if (selectionMode === SelectionMode.BG_SELECT) {
        header.textContent = 'Selecting Block Groups';
    } else if (selectionMode === SelectionMode.BLOCK_SELECT) {
        header.textContent = 'Selecting Blocks:';
    } else {
        header.textContent = 'Selection Locked:';
    }
}

function syncSelectedFill() {
    map.setFilter('default-selected-fill', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', [...selectedIds]]
    ]);
}

function syncNeighborhoodBaseFill() {
    const neighborhoodIds = [...new Set(Object.values(neighborhoodToBgs).flat().map(String))];
    map.setFilter('neighborhood-base-fill', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', neighborhoodIds]
    ]);
}

function clearNeighborhoodBaseFill() {
    map.setFilter('neighborhood-base-fill', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', []]
    ]);
}

function syncBlockSelectedFill() {
    map.setFilter('block-selected', [
        'in',
        ['get', 'GEOID20'],
        ['literal', [...selectedBlockIds]]
    ]);
    map.setFilter('block-selected-outline', [
        'in',
        ['get', 'GEOID20'],
        ['literal', [...selectedBlockIds]]
    ]);
}

function updateTableAndMapHighlight() {
    const id = pinnedTableId || hoveredTableId || null;

    if (id) {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', String(id)]);
        highlightDataRow(id);
    } else {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
        const rows = document.querySelectorAll('#data-box tbody tr[data-id]');
        rows.forEach(tr => {
            tr.style.background = '';
        });
    }
}

function attachDataRowInteractions() {
    const rows = document.querySelectorAll('#data-box tbody tr[data-id]');

    rows.forEach(tr => {
        const id = String(tr.getAttribute('data-id'));

        tr.addEventListener('mouseenter', () => {
            hoveredTableId = id;
            updateTableAndMapHighlight();
        });

        tr.addEventListener('mouseleave', () => {
            hoveredTableId = null;
            updateTableAndMapHighlight();
        });

        tr.addEventListener('click', () => {
            pinnedTableId = id;
            activeId = id;
            updateTableAndMapHighlight();
        });
    });
}

function highlightDataRow(id) {
    const rows = document.querySelectorAll('#data-box tbody tr[data-id]');
    rows.forEach(tr => {
        tr.style.background = tr.getAttribute('data-id') === String(id) ? '#fde68a' : '';
    });
}

function highlightActive(id) {
    activeId = String(id);
    pinnedTableId = String(id);
    hoveredTableId = null;
    updateTableAndMapHighlight();
}

function toggleSelection(id) {
    const key = String(id);
    if (selectedIds.has(key)) selectedIds.delete(key);
    else selectedIds.add(key);
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
}

function applyDefaultSelection(ids) {
    ids.forEach(id => selectedIds.add(String(id)));
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
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

function recomputeSelectedIdsFromBlocks() {
    selectedIds.clear();

    const blockSource = map.getSource('blocks')?._data;
    if (!blockSource) {
        syncSelectedFill();
        renderSelectedList();
        updateShowDataButton();
        return;
    }

    for (const feature of (blockSource.features || [])) {
        const blockId = String(feature.properties?.GEOID20 ?? '');
        if (!blockId || !selectedBlockIds.has(blockId)) continue;

        const bgId =
            String(feature.properties?.JOINKEY12 ?? '') ||
            key12FromBlockGEOID(blockId);

        if (bgId) selectedIds.add(bgId);
    }

    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
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
            if (turf.booleanIntersects(feature, circle)) {
                selectedIds.add(id);
            }
        } catch (err) {
            console.warn('Intersection check failed for feature:', id, err);
        }
    }

    activeId = null;
    pinnedTableId = null;
    hoveredTableId = null;
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
    const blockSource = map.getSource('blocks')?._data;
    if (!blockSource || !map.getSource('radius-circle')) return;
    if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) return;

    const circle = turf.circle([centerLngLat.lng, centerLngLat.lat], radiusMiles, {
        steps: 64,
        units: 'miles'
    });

    lastRadiusCircle = circle;
    map.getSource('radius-circle').setData(circle);

    selectedBlockIds.clear();

    for (const feature of (blockSource.features || [])) {
        const blockId = String(feature.properties?.GEOID20 ?? '');
        if (!blockId) continue;

        try {
            if (turf.booleanIntersects(feature, circle)) {
                selectedBlockIds.add(blockId);
            }
        } catch (err) {
            console.warn('Block radius intersection failed for block:', blockId, err);
        }
    }

    syncBlockSelectedFill();
    recomputeSelectedIdsFromBlocks();

    activeId = null;
    pinnedTableId = null;
    hoveredTableId = null;
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

    const details = document.getElementById('details');
    if (details) {
        details.textContent = `Radius selection complete: ${selectedBlockIds.size} block(s) selected within ${radiusMiles} mile(s).`;
    }
}

function getNeighborhoodFeatures(name) {
    const ids = (neighborhoodToBgs[name] || []).map(String);
    return (blockGroupGeojson.features || []).filter(
        f => ids.includes(String(f.properties?.JOINKEY12))
    );
}

function highlightNeighborhood(name) {
    if (!name) {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
        return;
    }

    const ids = (neighborhoodToBgs[name] || []).map(String);

    map.setFilter('active-bg-highlight', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', ids]
    ]);

    document.getElementById('details').textContent =
        `${name}: ${ids.length} block group(s) highlighted.`;
}

function highlightNeighborhoodRow(name) {
    const rows = document.querySelectorAll('#data-box tbody tr[data-name]');
    rows.forEach(tr => {
        const rowName = String(tr.getAttribute('data-name') || '');
        tr.style.background = rowName === String(name) ? '#fde68a' : '';
    });
}

function updateNeighborhoodTableAndMapHighlight() {
    const name = pinnedNeighborhoodName || hoveredNeighborhoodName || null;

    if (name) {
        highlightNeighborhood(name);
        highlightNeighborhoodRow(name);
    } else {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
        document.querySelectorAll('#data-box tbody tr[data-name]').forEach(tr => {
            tr.style.background = '';
        });
    }
}

function selectNeighborhoodsFromBg(bgId) {
    const id = String(bgId);
    const neighborhoods = bgToNeighborhoods.get(id) || [];

    if (!neighborhoods.length) {
        document.getElementById('details').textContent =
            `No neighborhood mapping found for block group ${id}.`;
        return;
    }

    const wasSelected = selectedIds.has(id);

    if (wasSelected) {
        neighborhoods.forEach(name => selectedNeighborhoods.delete(name));
    } else {
        neighborhoods.forEach(name => selectedNeighborhoods.add(name));
    }

    selectedIds.clear();
    selectedNeighborhoods.forEach(name => {
        (neighborhoodToBgs[name] || []).forEach(bg => {
            selectedIds.add(String(bg));
        });
    });

    syncNeighborhoodBaseFill();
    syncSelectedFill();

    if (!wasSelected) {
        pinnedNeighborhoodName = neighborhoods[0] || null;
    } else if (pinnedNeighborhoodName && !selectedNeighborhoods.has(pinnedNeighborhoodName)) {
        pinnedNeighborhoodName = [...selectedNeighborhoods][0] || null;
    }

    hoveredNeighborhoodName = null;
    updateNeighborhoodTableAndMapHighlight();

    renderSelectedList();
    updateShowDataButton();

    document.getElementById('details').textContent =
        `${selectedNeighborhoods.size} neighborhood(s) selected.`;
}

function selectAllNeighborhoods() {
    selectionModeBG = 'neighborhood';

    selectedIds.clear();
    selectedNeighborhoods.clear();
    activeId = null;
    hoveredNeighborhoodName = null;
    pinnedNeighborhoodName = null;

    syncNeighborhoodBaseFill();
    syncSelectedFill();
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

    renderSelectedList();
    updateShowDataButton();

    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent =
        'Click a white neighborhood block group to select its neighborhood(s).';
}

function exitNeighborhoodMode() {
    selectionModeBG = 'block';

    selectedIds.clear();
    selectedNeighborhoods.clear();
    activeId = null;

    clearNeighborhoodBaseFill();
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent = 'Click a polygon to view details.';
}

function setCommunityGardensVisible(flag) {
    const v = flag ? 'visible' : 'none';

    if (map.getLayer('community-gardens-fill')) {
        map.setLayoutProperty('community-gardens-fill', 'visibility', v);
        map.setLayoutProperty('community-gardens-outline', 'visibility', v);
    }
}

function renderSelectedList() {
    const list = document.getElementById('selected-list');

    if (selectionModeBG === 'neighborhood') {
        if (!selectedNeighborhoods.size) {
            list.innerHTML = '';
            return;
        }

        const items = [...selectedNeighborhoods].map(name => `
            <li>
                <a href="#" class="neighborhood-link" data-name="${name}">
                    ${name}
                </a>
            </li>
        `);

        list.innerHTML = `
            <ul style="margin:8px 0 0 18px; padding:0;">
                ${items.join('')}
            </ul>
        `;

        document.querySelectorAll('.neighborhood-link').forEach(a => {
            a.onclick = e => {
                e.preventDefault();
                const name = a.getAttribute('data-name');
                pinnedNeighborhoodName = name;
                hoveredNeighborhoodName = null;
                updateNeighborhoodTableAndMapHighlight();
            };
        });

        return;
    }

    if (!selectedIds.size) {
        list.innerHTML = '';
        return;
    }

    const items = [...selectedIds].map(id => {
        const name = idToName.get(id) ?? id;
        const p = parseBgLabel(name);
        const label = p.tract && p.bg ? `Tract ${p.tract}, BG ${p.bg}` : name;

        return `
        <li>
            <a href="#" class="bg-link" data-id="${id}">
                ${label} (${id})
            </a>
        </li>`;
    });

    list.innerHTML = `
        <ul style="margin:8px 0 0 18px; padding:0;">
        ${items.join('')}
        </ul>`;

    document.querySelectorAll('.bg-link').forEach(a => {
        a.onclick = e => {
            e.preventDefault();
            const id = String(a.getAttribute('data-id'));
            highlightActive(id);
        };
    });
}

function buildPopulationBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    if (selectionMode === SelectionMode.LOCKED && selectedBlockIds.size) {
        const src = map.getSource('blocks')?._data;
        if (!src) return;

        const byBg = {};
        let grandTotal = 0;

        for (const f of src.features ?? []) {
            const p = f.properties ?? {};
            if (!selectedBlockIds.has(String(p.GEOID20))) continue;
            const bg = p.JOINKEY12;
            if (!bg) continue;

            const pop = Number(p.POP20) || 0;
            byBg[bg] = (byBg[bg] || 0) + pop;
            grandTotal += pop;
        }

        content.innerHTML = `
            <table style="border-collapse:collapse;width:100%">
                <thead>
                    <tr>
                        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Population</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="font-weight:bold;background:#f3f4f6;">
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;">Total</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${grandTotal.toLocaleString()}</td>
                    </tr>
                    ${Object.entries(byBg).map(([bg, total]) => `
                        <tr data-id="${bg}">
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${formatBgId(bg)}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${total.toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        box.style.display = 'block';
        pinnedTableId = null;
        hoveredTableId = null;
        attachDataRowInteractions();
        updateTableAndMapHighlight();
        return;
    }

    if (!selectedIds.size) {
        box.style.display = 'none';
        return;
    }

    let groupTotal = 0;

    const rows = [...selectedIds].map(id => {
        const row = idToRow.get(id) || {};
        const total = Number(row['B01003_001E']) || 0;
        groupTotal += total;
        return { id, total };
    });

    content.innerHTML = `
        <table style="border-collapse:collapse;width:100%">
            <thead>
                <tr>
                    <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                    <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Population</th>
                </tr>
            </thead>
            <tbody>
                <tr style="font-weight:bold;background:#f3f4f6;">
                    <td style="padding:6px 8px;border-bottom:2px solid #ccc;">Group Total</td>
                    <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${groupTotal.toLocaleString()}</td>
                </tr>
                ${rows.map(({ id, total }) => `
                    <tr data-id="${id}">
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${formatBgId(id)}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${total.toLocaleString()}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    box.style.display = 'block';
    pinnedTableId = null;
    hoveredTableId = null;
    attachDataRowInteractions();
    updateTableAndMapHighlight();
}

function buildRaceBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');
    content.innerHTML = `<h4>Race</h4><p>Data coming soon.</p>`;
    box.style.display = 'block';
}

function buildIncomeBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');
    content.innerHTML = `<h4>Income</h4><p>Data coming soon.</p>`;
    box.style.display = 'block';
}

function buildHouseholdBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    if (selectionMode === SelectionMode.LOCKED && selectedBlockIds.size) {
        const src = map.getSource('blocks')?._data;
        if (!src) return;

        const byBg = {};
        let totalHousing = 0;
        let totalPopulation = 0;

        for (const f of src.features ?? []) {
            const p = f.properties ?? {};
            if (!selectedBlockIds.has(String(p.GEOID20))) continue;
            const bg = p.JOINKEY12;
            if (!bg) continue;

            const housing = Number(p.HOUSING20) || 0;
            const pop = Number(p.POP20) || 0;

            if (!byBg[bg]) byBg[bg] = { housing: 0, pop: 0 };
            byBg[bg].housing += housing;
            byBg[bg].pop += pop;

            totalHousing += housing;
            totalPopulation += pop;
        }

        content.innerHTML = `
            <table style="border-collapse:collapse;width:100%">
                <thead>
                    <tr>
                        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Housing Units</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Avg Household Size</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="font-weight:bold;background:#f3f4f6;">
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;">Total</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totalHousing.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totalHousing ? (totalPopulation / totalHousing).toFixed(2) : '—'}</td>
                    </tr>
                    ${Object.entries(byBg).map(([bg, v]) => `
                        <tr data-id="${bg}">
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${formatBgId(bg)}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${v.housing.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${v.housing ? (v.pop / v.housing).toFixed(2) : '—'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        box.style.display = 'block';
        pinnedTableId = null;
        hoveredTableId = null;
        attachDataRowInteractions();
        updateTableAndMapHighlight();
        return;
    }

    box.style.display = 'none';
}

function buildPlaceholderBox(label) {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');
    content.innerHTML = `<h4>${label}</h4><p>Data coming soon.</p>`;
    box.style.display = 'block';
}

async function resetToSouthwestLansing() {
    const ids = await fetchRequestedBgs();

    selectedIds.clear();
    selectedBlockIds.clear();
    selectedNeighborhoods.clear();
    activeId = null;
    pinnedTableId = null;
    hoveredTableId = null;
    hoveredNeighborhoodName = null;
    pinnedNeighborhoodName = null;
    lastSubmittedIds = [];

    ids.forEach(id => selectedIds.add(String(id)));

    selectionModeBG = 'block';
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
    clearNeighborhoodBaseFill();
    syncBlockSelectedFill();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    clearRadiusCircle();
    setCommunityGardensVisible(false);

    document.getElementById('reset-last-selection').disabled = true;
    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent = 'Click a polygon to view details.';
    updateDisplayMethodUI();
}

async function setSelectionMode(mode) {
    selectionMode = mode;
    syncSelectionModeUI();
    syncSelectionHeader();
    updateDisplayMethodUI();

    if (mode === SelectionMode.BG_SELECT) {
        map.setLayoutProperty('bg-fill', 'visibility', 'visible');
        map.setLayoutProperty('bg-outline', 'visibility', 'visible');
        map.setLayoutProperty('default-selected-fill', 'visibility', 'visible');
        map.setLayoutProperty('active-bg-highlight', 'visibility', 'visible');
        map.setLayoutProperty('block-fill', 'visibility', 'none');
        map.setLayoutProperty('block-outline', 'visibility', 'none');
        map.setLayoutProperty('block-selected', 'visibility', 'none');
        map.setLayoutProperty('block-selected-outline', 'visibility', 'none');
        selectedBlockIds.clear();
        syncBlockSelectedFill();
        updateShowDataButton();
        return;
    }

    if (mode === SelectionMode.BLOCK_SELECT) {
        if (selectedBlockIds.size === 0) {
            const blocks = await loadBlocksForSelectedBgs();
            for (const f of blocks.features ?? []) {
                const id = String(f.properties?.GEOID20);
                if (id) selectedBlockIds.add(id);
            }
        }

        map.setLayoutProperty('bg-fill', 'visibility', 'none');
        map.setLayoutProperty('bg-outline', 'visibility', 'none');
        map.setLayoutProperty('default-selected-fill', 'visibility', 'none');
        map.setLayoutProperty('active-bg-highlight', 'visibility', 'none');
        map.setLayoutProperty('block-fill', 'visibility', 'visible');
        map.setLayoutProperty('block-outline', 'visibility', 'visible');
        map.setLayoutProperty('block-selected', 'visibility', 'visible');
        map.setLayoutProperty('block-selected-outline', 'visibility', 'visible');
        syncBlockSelectedFill();
        recomputeSelectedIdsFromBlocks();
        updateShowDataButton();
        return;
    }

    if (mode === SelectionMode.LOCKED) {
        map.setLayoutProperty('block-fill', 'visibility', 'none');
        map.setLayoutProperty('block-outline', 'visibility', 'none');
        map.setLayoutProperty('block-selected', 'visibility', 'visible');
        map.setLayoutProperty('block-selected-outline', 'visibility', 'visible');
        syncBlockSelectedFill();
        recomputeSelectedIdsFromBlocks();
        updateShowDataButton();
    }
}

function updateDisplayMethodUI() {
    const radiusControls = document.getElementById('radius-controls');
    const neighborhoodControls = document.getElementById('neighborhood-controls');
    const details = document.getElementById('details');

    const mode = getDisplayMode();

    if (radiusControls) {
        radiusControls.style.display = mode === 'radius' ? 'block' : 'none';
    }

    if (neighborhoodControls) {
        neighborhoodControls.style.display = mode === 'neighborhoods' ? 'block' : 'none';
    }

    if (details) {
        if (mode === 'radius') {
            if (selectionMode === SelectionMode.BLOCK_SELECT) {
                details.textContent = 'Radius mode: click anywhere on the map to select blocks within the radius.';
            } else {
                details.textContent = 'Radius mode: click anywhere on the map to select block groups within the radius.';
            }
        } else if (mode === 'neighborhoods') {
            details.textContent = 'Neighborhood mode: click a white neighborhood to select its block groups.';
        } else {
            details.textContent = 'Click a polygon to view details.';
        }
    }
}

// -------------------- MAP LOAD --------------------

map.on('load', async () => {
    setLoading(true);

    try {
        const data = await joinAcsToBgs(populationACS, arcgisBlockGroups);
        blockGroupGeojson = data;

        map.addSource('arcgis-layer', { type: 'geojson', data, promoteId: 'JOINKEY12' });
        map.addSource('community-gardens', { type: 'geojson', data: communityGardens });
        map.addSource('radius-circle', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        map.addSource('blocks', {
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
            id: 'neighborhood-base-fill',
            type: 'fill',
            source: 'arcgis-layer',
            paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.65 },
            filter: ['in', ['get', 'JOINKEY12'], ['literal', []]]
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
            id: 'block-fill',
            type: 'fill',
            source: 'blocks',
            paint: { 'fill-color': '#2b8a3e', 'fill-opacity': 0.25 },
            layout: { visibility: 'none' }
        });

        map.addLayer({
            id: 'block-outline',
            type: 'line',
            source: 'blocks',
            paint: { 'line-color': '#c2410c', 'line-width': 0.5 },
            layout: { visibility: 'none' }
        });

        map.addLayer({
            id: 'block-selected',
            type: 'fill',
            source: 'blocks',
            paint: { 'fill-color': '#f97316', 'fill-opacity': 0.5 },
            layout: { visibility: 'none' },
            filter: ['in', ['get', 'GEOID20'], ['literal', []]]
        });

        map.addLayer({
            id: 'block-selected-outline',
            type: 'line',
            source: 'blocks',
            paint: { 'line-color': '#c2410c', 'line-width': 0.5 },
            layout: { visibility: 'none' },
            filter: ['in', ['get', 'GEOID20'], ['literal', []]]
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

        map.on('click', 'bg-fill', e => {
            if (selectionMode !== SelectionMode.BG_SELECT) return;
            if (!e.features?.length) return;
            if (getDisplayMode() === 'radius') return;

            const f = e.features[0];
            const id = String(f.id ?? f.properties?.JOINKEY12 ?? '');
            if (!id) return;

            if (selectionModeBG === 'neighborhood') {
                const neighborhoodIds = new Set(Object.values(neighborhoodToBgs).flat().map(String));
                if (neighborhoodIds.has(id)) {
                    selectNeighborhoodsFromBg(id);
                }
                return;
            }

            toggleSelection(id);
            highlightActive(id);
            updateShowDataButton();
        });

        map.on('click', e => {
            if (selectionMode === SelectionMode.LOCKED) return;
            if (getDisplayMode() !== 'radius') return;

            const radiusInput = document.getElementById('radius-input');
            const radiusMiles = Number(radiusInput?.value || 1);

            if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
                alert('Please enter a valid radius greater than 0.');
                return;
            }

            if (selectionMode === SelectionMode.BLOCK_SELECT) {
                selectBlocksByRadius(e.lngLat, radiusMiles);
            } else {
                selectBlockGroupsByRadius(e.lngLat, radiusMiles);
            }
        });

        map.on('click', 'block-fill', e => {
            if (selectionMode !== SelectionMode.BLOCK_SELECT) return;
            if (!e.features?.length) return;

            const id = String(e.features[0].properties.GEOID20);
            if (selectedBlockIds.has(id)) selectedBlockIds.delete(id);
            else selectedBlockIds.add(id);

            syncBlockSelectedFill();
            recomputeSelectedIdsFromBlocks();
        });

        map.on('mousemove', 'block-selected', e => {
            if (selectionMode !== SelectionMode.LOCKED) return;
            if (!e.features?.length) return;

            const p = e.features[0].properties ?? {};
            const label = formatBlockId(p.GEOID20);

            map.getCanvas().style.cursor = 'pointer';
            blockHoverPopup
                .setLngLat(e.lngLat)
                .setHTML(
                    `<div style="font:12px/1.3 sans-serif">
                        <div><strong>Block ID</strong></div>
                        <div>${label}</div>
                    </div>`
                )
                .addTo(map);
        });

        map.on('mouseleave', 'block-selected', () => {
            map.getCanvas().style.cursor = '';
            blockHoverPopup.remove();
        });

        const ids = await fetchRequestedBgs();
        applyDefaultSelection(ids);
        setStatus(`Loaded ${ids.length} BG(s) from list`);
        syncSelectionModeUI();
        syncSelectionHeader();
        updateDisplayMethodUI();
    } catch (e) {
        console.error(e);
        setStatus('Error loading data');
    } finally {
        setLoading(false);
    }
});

// -------------------- BUTTON LISTENERS --------------------

document.getElementById('clear-selection').addEventListener('click', () => {
    if (selectionMode === SelectionMode.LOCKED) {
        setSelectionMode(SelectionMode.BLOCK_SELECT);
        return;
    } else if (selectionMode === SelectionMode.BLOCK_SELECT) {
        setSelectionMode(SelectionMode.BG_SELECT);
        return;
    } else {
        if (selectionModeBG === 'neighborhood') {
            selectedIds.clear();
            selectedNeighborhoods.clear();
            activeId = null;

            syncNeighborhoodBaseFill();
            syncSelectedFill();
            renderSelectedList();
            updateShowDataButton();

            map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
            document.getElementById('data-box').style.display = 'none';
            document.getElementById('details').textContent =
                'Click a white neighborhood block group to select its neighborhood(s).';
            return;
        }
        selectedIds.clear();
    }

    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    clearRadiusCircle();
    selectedBlockIds.clear();
    syncBlockSelectedFill();
    renderSelectedList();
    document.getElementById('data-box').style.display = 'none';
    syncSelectionModeUI();
    updateShowDataButton();
});

document.getElementById('submit-selection').addEventListener('click', () => {
    if (!selectedIds.size) return;

    lastSubmittedIds = [...selectedIds];
    document.getElementById('reset-last-selection').disabled = false;

    if (selectionMode === SelectionMode.BG_SELECT) {
        setSelectionMode(SelectionMode.BLOCK_SELECT);
        return;
    }

    if (selectionMode === SelectionMode.BLOCK_SELECT) {
        if (!selectedBlockIds.size) return;
        setSelectionMode(SelectionMode.LOCKED);
    }
});

const filterIds = [
    'food-filter',
    'housesize-filter',
    'race-filter',
    'population-filter',
    'health-filter',
    'income-filter'
];

filterIds.forEach(id => {
    const cb = document.getElementById(id);
    if (!cb) return;

    cb.addEventListener('change', () => {
        if (cb.checked) {
            filterIds.forEach(otherId => {
                if (otherId !== id) {
                    const other = document.getElementById(otherId);
                    if (other) other.checked = false;
                }
            });
        }

        updateSelectedFilterText();
        updateShowDataButton();
        document.getElementById('data-box').style.display = 'none';
    });
});

document.getElementById('reset-last-selection').addEventListener('click', () => {
    if (!lastSubmittedIds.length) return;

    selectedIds.clear();
    lastSubmittedIds.forEach(id => selectedIds.add(String(id)));

    activeId = null;
    pinnedTableId = null;
    hoveredTableId = null;

    if (selectionModeBG === 'neighborhood') {
        selectedNeighborhoods.clear();

        lastSubmittedIds.forEach(id => {
            const neighborhoods = bgToNeighborhoods.get(String(id)) || [];
            neighborhoods.forEach(name => selectedNeighborhoods.add(name));
        });

        syncNeighborhoodBaseFill();
    }

    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    document.getElementById('data-box').style.display = 'none';

    if (selectionModeBG === 'neighborhood') {
        document.getElementById('details').textContent = 'Neighborhood selection restored.';
    } else {
        document.getElementById('details').textContent = 'Click a polygon to view details.';
    }
});

document.getElementById('show-data-btn').addEventListener('click', () => {
    const f = getActiveFilter();
    if (!f) return;

    if (f === 'population-filter') buildPopulationBox();
    else if (f === 'race-filter') buildRaceBox();
    else if (f === 'income-filter') buildIncomeBox();
    else if (f === 'housesize-filter') buildHouseholdBox();
    else if (f === 'food-filter') {
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
const demoDrawerToggle = document.getElementById('demo-drawer-toggle');
const demoDrawerPanel = document.getElementById('demo-drawer-panel');

function closeAllDrawers() {
    drawerPanel.classList.remove('open');
    drawerToggle.classList.remove('open');
    filtersDrawerPanel.classList.remove('open');
    filtersDrawerToggle.classList.remove('open');
    demoDrawerPanel.classList.remove('open');
    demoDrawerToggle.classList.remove('open');
}

function switchDrawer(panel, toggle) {
    const isAlreadyOpen = panel.classList.contains('open');

    closeAllDrawers();

    if (!isAlreadyOpen) {
        setTimeout(() => {
            panel.classList.add('open');
            toggle.classList.add('open');
            if (toggle === demoDrawerToggle) {
                drawerToggle.classList.add('open');
                filtersDrawerToggle.classList.add('open');
            }
        }, 300);
    }
}

drawerToggle.addEventListener('click', () => {
    switchDrawer(drawerPanel, drawerToggle);
});

filtersDrawerToggle.addEventListener('click', () => {
    switchDrawer(filtersDrawerPanel, filtersDrawerToggle);
});

demoDrawerToggle.addEventListener('click', () => {
    switchDrawer(demoDrawerPanel, demoDrawerToggle);
});

const displayCheckboxes = document.querySelectorAll('.display-checkbox');
const resetSwlBtn = document.getElementById('reset-swl');

displayCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
        if (cb.checked) {
            displayCheckboxes.forEach(other => {
                if (other !== cb) other.checked = false;
            });

            if (cb.id !== 'neighborhoods-display' && selectionModeBG === 'neighborhood') {
                exitNeighborhoodMode();
            }

            if (cb.id !== 'radius-display') {
                clearRadiusCircle();
            }
        }

        updateDisplayMethodUI();
    });
});

const radiusCheckbox = document.getElementById('radius-display');
const neighborhoodsCheckbox = document.getElementById('neighborhoods-display');

if (radiusCheckbox) {
    radiusCheckbox.addEventListener('change', () => {
        if (!radiusCheckbox.checked) {
            clearRadiusCircle();
        }
        updateDisplayMethodUI();
    });
}

if (neighborhoodsCheckbox) {
    neighborhoodsCheckbox.addEventListener('change', () => {
        if (neighborhoodsCheckbox.checked) {
            selectAllNeighborhoods();
        } else {
            exitNeighborhoodMode();
        }

        clearRadiusCircle();
        updateDisplayMethodUI();
    });
}

if (resetSwlBtn) {
    resetSwlBtn.addEventListener('click', async () => {
        displayCheckboxes.forEach(cb => {
            cb.checked = false;
        });

        filterIds.forEach(id => {
            const cb = document.getElementById(id);
            if (cb) cb.checked = false;
        });

        updateSelectedFilterText();
        await setSelectionMode(SelectionMode.BG_SELECT);
        await resetToSouthwestLansing();
    });
}

document.getElementById('reload').addEventListener('click', async () => {
    await resetToSouthwestLansing();
});

updateSelectedFilterText();
updateDisplayMethodUI();
syncSelectionHeader();
