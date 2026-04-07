// basic map initialization
const map = new maplibregl.Map({
    container: 'map',
    center: [-84.582236, 42.697406],
    zoom: 12,
    style: 'static/map-style.json'
});
map.addControl(new maplibregl.NavigationControl());

// arcGIS URLs
const arcgisBlockGroups = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/2010_Block_Groups/FeatureServer/0/query?where=CNTY_CODE%20IN%20(65,45,37)&outFields=*&f=geojson&outSR=4326';
const arcgisBlocks = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/tl_2025_26_tabblock20/FeatureServer/0';
const populationACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/PopulationACS/FeatureServer/0/query?where=1=1&outFields=GEO_ID,B01003_001E&f=json';
const raceACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/RaceACS/FeatureServer/0/query?where=1=1&outFields=*&f=csv';
const communityGardens = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/Community_Garden_Parcels/FeatureServer/0/query?where=1=1&outFields=*&f=geojson&outSR=4326';

let activeId = null;
let blockGroupGeojson = null;
let lastRadiusCircle = null;

const selectedIds = new Set();
const idToName = new Map();
const idToRow = new Map();

let selectionLocked = false; // mode boolean

const filterLabels = {
    'food-filter': 'Food',
    'housesize-filter': 'Household Size',
    'race-filter': 'Race',
    'population-filter': 'Population',
    'health-filter': 'Health',
    'income-filter': 'Income'
};

// HELPER FUNCTIONS

// standardizes ids from GEOID to match LINK from geojson
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

async function fetchArcgisRows(url) {
    const r = await fetch(url);
    const j = await r.json();

    if (j.type === 'FeatureCollection') {
        return (j.features || []).map(f => f.properties || {});
    }

    return (j.features || []).map(f => f.attributes || {});
}

// pull from txt file
async function fetchRequestedBgs() {
    const res = await fetch('static/data/requested_bg.txt', { cache: 'no-store' });
    if (!res.ok) return [];

    const text = await res.text();
    return text
        .split(/\r?\n/)
        .map(s => key12FromLink(s))
        .filter(Boolean);
}

function parseBgLabel(name) {
    const s = String(name);
    if (!s.length) return { tract: s, bg: s };
    return { tract: s.slice(0, -1), bg: s.slice(-1) };
}

function getDisplayMode() {
    if (document.getElementById('radius-display')?.checked) return 'radius';
    if (document.getElementById('neighborhoods-display')?.checked) return 'neighborhoods';
    if (document.getElementById('zipcodes-display')?.checked) return 'zipcodes';
    return 'swl';
}

function updateDisplayMethodUI() {
    const radiusControls = document.getElementById('radius-controls');
    const details = document.getElementById('details');

    if (radiusControls) {
        radiusControls.style.display = getDisplayMode() === 'radius' ? 'block' : 'none';
    }

    if (details) {
        if (getDisplayMode() === 'radius') {
            details.textContent = 'Radius mode: click anywhere on the map to select block groups within the radius.';
        } else {
            details.textContent = 'Click a polygon to view details.';
        }
    }
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

// renders selected id list
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

    list.innerHTML = `
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

// data button logic
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

    if (active) {
        el.textContent = `Selected Filter: ${filterLabels[active]}`;
    } else {
        el.textContent = 'Selected Filter: None';
    }
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

function toggleSelection(id) {
    const key = String(id);
    if (selectedIds.has(key)) selectedIds.delete(key);
    else selectedIds.add(key);

    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
}

function highlightActive(id) {
    activeId = id;
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', id]);
    highlightDataRow(id);
}

// implements default selection
function applyDefaultSelection(ids) {
    selectedIds.clear();
    ids.forEach(id => selectedIds.add(String(id)));
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
}

// radius selection
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
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();

    const details = document.getElementById('details');
    if (details) {
        details.textContent = `Radius selection complete: ${selectedIds.size} block group(s) selected within ${radiusMiles} mile(s).`;
    }
}

// different filters data visualization boxes
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

function setCommunityGardensVisible(flag) {
    const v = flag ? 'visible' : 'none';

    if (map.getLayer('community-gardens-fill')) {
        map.setLayoutProperty('community-gardens-fill', 'visibility', v);
        map.setLayoutProperty('community-gardens-outline', 'visibility', v);
    }
}

// hyperlink highlight for data
function highlightDataRow(id) {
    const rows = document.querySelectorAll('#data-box tbody tr');
    rows.forEach(tr => {
        if (tr.getAttribute('data-id') === String(id)) tr.style.background = '#fde68a';
        else tr.style.background = '';
    });
}

async function resetToSouthwestLansing() {
    const ids = await fetchRequestedBgs();
    console.log('reset ids:', ids);

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

    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent = 'Click a polygon to view details.';
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
    if (el) {
        el.textContent = msg;
        el.style.display = msg ? 'inline' : 'none';
    }
}

// swap unselect all button with edit selection
function syncSelectionModeUI() {
    const btn = document.getElementById('clear-selection');
    if (!btn) return;

    if (selectionLocked) {
        btn.textContent = 'Edit Selection';
    } else {
        btn.textContent = 'Unselect All';
    }
}

// LOADING FUNCTION
map.on('load', async () => {
    setLoading(true);

    try {
        const data = await joinAcsToBgs(populationACS, arcgisBlockGroups);
        blockGroupGeojson = data;

        map.addSource('arcgis-layer', { type: 'geojson', data, promoteId: 'JOINKEY12' });
        map.addSource('community-gardens', { type: 'geojson', data: communityGardens });
        map.addSource('radius-circle', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
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
            id: 'radius-circle-fill',
            type: 'fill',
            source: 'radius-circle',
            paint: {
                'fill-color': '#60a5fa',
                'fill-opacity': 0.15
            }
        });

        map.addLayer({
            id: 'radius-circle-outline',
            type: 'line',
            source: 'radius-circle',
            paint: {
                'line-color': '#2563eb',
                'line-width': 2
            }
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

        map.on('mouseenter', 'bg-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'bg-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        // manual polygon selection mode
        map.on('click', 'bg-fill', e => {
            if (!e.features?.length) return;
            if (getDisplayMode() === 'radius') return;

            const f = e.features[0];
            const id = String(f.id ?? f.properties?.JOINKEY12 ?? '');
            if (!id) return;

            if (!selectionLocked) {
                toggleSelection(id);
                highlightActive(id);
                updateShowDataButton();
            }
        });

        // radius selection mode
        map.on('click', e => {
            if (selectionLocked) return;
            if (getDisplayMode() !== 'radius') return;

            const radiusInput = document.getElementById('radius-input');
            const radiusMiles = Number(radiusInput?.value || 1);

            if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
                alert('Please enter a valid radius greater than 0.');
                return;
            }

            selectBlockGroupsByRadius(e.lngLat, radiusMiles);
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

// Button Listeners
document.getElementById('clear-selection').addEventListener('click', () => {
    if (selectionLocked) {
        selectionLocked = false;
        setCommunityGardensVisible(false);
        document.getElementById('data-box').style.display = 'none';

        map.setFilter(
            'default-selected-fill',
            ['in', ['get', 'JOINKEY12'], ['literal', [...selectedIds]]]
        );

        syncSelectionModeUI();
        updateShowDataButton();
        return;
    }

    selectedIds.clear();
    activeId = null;

    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

    renderSelectedList();
    document.getElementById('data-box').style.display = 'none';
    setCommunityGardensVisible(false);

    if (getDisplayMode() !== 'radius') {
        clearRadiusCircle();
    }

    updateShowDataButton();
});

document.getElementById('submit-selection').addEventListener('click', () => {
    if (!selectedIds.size) return;

    selectionLocked = true;

    map.setFilter(
        'default-selected-fill',
        ['in', ['get', 'JOINKEY12'], ['literal', [...selectedIds]]]
    );
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

    syncSelectionModeUI();
    updateShowDataButton();
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

document.getElementById('reload').addEventListener('click', async () => {
    await resetToSouthwestLansing();
});

const drawerToggle = document.getElementById('drawer-toggle');
const drawerPanel = document.getElementById('drawer-panel');

const filtersDrawerToggle = document.getElementById('filters-drawer-toggle');
const filtersDrawerPanel = document.getElementById('filters-drawer-panel');
const swlDisplay = document.getElementById('swl-display');
const neighborhoodsDisplay = document.getElementById('neighborhoods-display');
const zipcodesDisplay = document.getElementById('zipcodes-display');
const radiusDisplay = document.getElementById('radius-display');

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
    updateDisplayMethodUI();
});

neighborhoodsDisplay.addEventListener('change', () => {
    clearRadiusCircle();
    updateDisplayMethodUI();
});

zipcodesDisplay.addEventListener('change', () => {
    clearRadiusCircle();
    updateDisplayMethodUI();
});

radiusDisplay.addEventListener('change', () => {
    updateDisplayMethodUI();
    if (!radiusDisplay.checked) {
        clearRadiusCircle();
    } else {
        document.getElementById('details').textContent = 'Radius mode: click anywhere on the map to select block groups within the radius.';
    }
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
                [
                    'food-filter',
                    'housesize-filter',
                    'race-filter',
                    'population-filter',
                    'health-filter',
                    'income-filter'
                ].forEach(other => {
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

// initial UI state
updateSelectedFilterText();
updateDisplayMethodUI();
