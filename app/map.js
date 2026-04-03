//basic map initialization
const map = new maplibregl.Map({
    container: 'map',
    center: [-84.582236, 42.697406],
    zoom: 12,
    style: 'static/map-style.json'
});
map.addControl(new maplibregl.NavigationControl());

//arcGIS URLs
const arcgisBlockGroups = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/2010_Block_Groups/FeatureServer/0/query?where=CNTY_CODE%20IN%20(65,45,37)&outFields=*&f=geojson&outSR=4326';
const arcgisBlocks = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/tl_2025_26_tabblock20/FeatureServer/0'
const populationACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/PopulationACS/FeatureServer/0/query?where=1=1&outFields=GEO_ID,B01003_001E&f=json'
const raceACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/RaceACS/FeatureServer/0/query?where=1=1&outFields=*&f=csv'
const communityGardens = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/Community_Garden_Parcels/FeatureServer/0/query?where=1=1&outFields=*&f=geojson&outSR=4326'

let activeId = null;
const selectedIds = new Set();
const idToName = new Map();
const idToRow = new Map();
let selectionLocked = false
let lastSubmittedIds = [];
let selectionMode = 'block'; // 'block' or 'neighborhood'
const selectedNeighborhoods = new Set();

const neighborhoodToBgs = {
    "Coachlight Neighborhood Association": [
        "260650051002"
    ],

    "Wexford Heights Neighborhood Association": [
        "260650051003"
    ],

    "Churchill Downs Community Association": [
        "260650036011",
        "260650036012",
        "260650036013"
    ],

    "Averill Woods Neighborhood Association": [
        "260650017032"
    ],

    "Wood-Mere Neighborhood Organization": [
        "260650017033"
    ],

    "Lewton Rich Neighborhood Association": [
        "260650017031"
    ],

    "Riverview Estates Neighbors United": [
        "260650017031"
    ],

    "Colonial Village Neighborhood": [
        "260650070004",
        "260650070005",
        "260650037005"
    ]
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
    'housesize-filter': 'Household Size',
    'race-filter': 'Race',
    'population-filter': 'Population',
    'health-filter': 'Health',
    'income-filter': 'Income'
};

//HELPER FUNCTIONS
//standardizes ids from GEOID to match LINK from geojson
function key12FromAcs(geoId){const d=String(geoId??'').replace(/\D/g,'');return d.slice(-12)||null}
function key12FromLink(link){const d=String(link??'').replace(/\D/g,'').slice(-9);if(d.length!==9)return null;const c2=d.slice(0,2),t6=d.slice(2,8),b1=d.slice(8);return '26'+c2.padStart(3,'0')+t6+b1}

async function joinAcsToBgs(acsUrl,bgUrl){
    const [acs,bg]=await Promise.all([
        fetch(acsUrl).then(r=>r.json()).then(j=>(j.features||[]).map(f=>f.attributes||{})),
        fetch(bgUrl).then(r=>r.json())
    ])
    const m=new Map()
    for(const r of acs){const k=key12FromAcs(r.GEO_ID);if(k)m.set(k,r)}
    for(const f of (bg.features||[])){
        const p=f.properties||{}
        const k=key12FromLink(p.LINK);if(!k)continue
        p.JOINKEY12=k
        idToName.set(k,String(p.NAME??k))
        const row=m.get(k);if(row){idToRow.set(k,row);p.csv_B01003_001E=row.B01003_001E}
    }
    return bg
}

async function fetchArcgisRows(url) {
    const r = await fetch(url);
    const j = await r.json();
    if (j.type === 'FeatureCollection') {
        return (j.features || []).map(f => f.properties || {});
    }
    return (j.features || []).map(f => f.attributes || {});
}

//pull from txt file
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

//renders selected id list
function renderSelectedList() {
    const list = document.getElementById('selected-list');

    if (selectionMode === 'neighborhood') {
        if (!selectedNeighborhoods.size) {
            list.innerHTML = 'None';
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
                highlightNeighborhood(name);
            };
        });

        return;
    }

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
            highlightDataRow(id);
        };
    });
}

//data button logic
function getActiveFilter(){
    return Object.keys(filterLabels).find(id => {
        const cb = document.getElementById(id)
        return cb && cb.checked
    })
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
    btn.disabled = !(selectionLocked && getActiveFilter() && selectedIds.size);
}

function syncSelectedFill() {
    map.setFilter('default-selected-fill', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', [...selectedIds]]
    ]);
}
function syncNeighborhoodBaseFill() {
    const neighborhoodIds = [...new Set(
        Object.values(neighborhoodToBgs).flat().map(String)
    )];

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

//implements default selection
function applyDefaultSelection(ids) {
    ids.forEach(id => selectedIds.add(String(id)));
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton()
}

//different filters data visualization boxes
function buildPopulationBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    if (!selectedIds.size) {
        box.style.display = 'none';
        return;
    }

    let groupTotal = 0;

    const rows = [...selectedIds].map(id => {
        const name = idToName.get(id) || id;
        const row = idToRow.get(id) || {};
        const raw = row['B01003_001E'];
        const val = Number(raw);

        const total = Number.isFinite(val) ? val : 0;
        groupTotal += total;

        return {
            name,
            total
        };
    });

    const rowsHtml = `
        <tr style="font-weight:bold;background:#f3f4f6;">
            <td style="padding:6px 8px;border-bottom:2px solid #ccc;">
                Group Total
            </td>
            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">
                ${groupTotal.toLocaleString()}
            </td>
        </tr>
    ` + rows.map(({ name, total }) => `
        <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">
                ${name}
            </td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                ${total.toLocaleString()}
            </td>
        </tr>
    `).join('');

    content.innerHTML = `
        <table style="border-collapse:collapse;width:100%">
            <thead>
                <tr>
                    <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                    <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Population</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;

    box.style.display = 'block';
}
function buildNeighborhoodPopulationBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    if (!selectedNeighborhoods.size) {
        box.style.display = 'none';
        return;
    }

    let groupTotal = 0;

    const rows = [...selectedNeighborhoods].map(name => {
        const total = getNeighborhoodPopulation(name);
        groupTotal += total;
    
        return { name, total };
    });
    
    const rowsHtml = `
        <tr style="font-weight:bold;background:#f3f4f6;">
            <td style="padding:6px 8px;border-bottom:2px solid #ccc;">
                Group Total
            </td>
            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">
                ${groupTotal.toLocaleString()}
            </td>
        </tr>
    ` +
    rows.map(({ name, total }) => `
        <tr data-name="${name}">
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">
                ${name}
            </td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                ${total.toLocaleString()}
            </td>
        </tr>
    `).join('');

    content.innerHTML = `
        <table style="border-collapse:collapse;width:100%">
            <thead>
                <tr>
                    <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Neighborhood</th>
                    <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Population</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;

    box.style.display = 'block';
}

function buildPlaceholderBox(label){
    const box = document.getElementById('data-box')
    const content = document.getElementById('data-box-content')
    content.innerHTML = `<h4>${label}</h4><p>Data coming soon.</p>`
    box.style.display = 'block'
}
function selectAllNeighborhoods() {
    selectionMode = 'neighborhood';

    selectedIds.clear();
    selectedNeighborhoods.clear();
    activeId = null;
    selectionLocked = false;

    syncNeighborhoodBaseFill();   // white neighborhood BGs
    syncSelectedFill();           // no blue selection yet
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

    renderSelectedList();
    updateShowDataButton();

    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent =
        'Click a white neighborhood block group to select its neighborhood(s).';
}

function exitNeighborhoodMode() {
    selectionMode = 'block';

    selectedIds.clear();
    selectedNeighborhoods.clear();
    activeId = null;
    selectionLocked = false;

    clearNeighborhoodBaseFill();
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent = 'Click a polygon to view details.';
}

function highlightNeighborhood(name) {
    const ids = (neighborhoodToBgs[name] || []).map(String);

    map.setFilter('active-bg-highlight', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', ids]
    ]);

    document.getElementById('details').textContent =
        `${name}: ${ids.length} block group(s) highlighted.`;
}
function selectNeighborhoodsFromBg(bgId) {
    const id = String(bgId);
    const neighborhoods = bgToNeighborhoods.get(id) || [];

    if (!neighborhoods.length) {
        document.getElementById('details').textContent =
            `No neighborhood mapping found for block group ${id}.`;
        return;
    }

    // Check whether this clicked BG is already part of the current blue selection
    const isAlreadySelected = selectedIds.has(id);

    if (isAlreadySelected) {
        // Remove all neighborhoods associated with this clicked BG
        neighborhoods.forEach(name => selectedNeighborhoods.delete(name));
    } else {
        // Add all neighborhoods associated with this clicked BG
        neighborhoods.forEach(name => selectedNeighborhoods.add(name));
    }

    // Rebuild selectedIds from the currently selected neighborhoods
    selectedIds.clear();
    selectedNeighborhoods.forEach(name => {
        (neighborhoodToBgs[name] || []).forEach(bg => {
            selectedIds.add(String(bg));
        });
    });

    syncNeighborhoodBaseFill();
    syncSelectedFill();

    if (selectedIds.has(id)) {
        map.setFilter('active-bg-highlight', [
            '==',
            'JOINKEY12',
            id
        ]);
    } else {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    }

    renderSelectedList();
    updateShowDataButton();

    document.getElementById('details').textContent =
        `${selectedNeighborhoods.size} neighborhood(s) selected.`;
}
function getNeighborhoodPopulation(neighborhoodName) {
    const ids = neighborhoodToBgs[neighborhoodName] || [];

    let total = 0;

    ids.forEach(id => {
        const row = idToRow.get(String(id)) || {};
        const raw = row['B01003_001E'];
        const num = Number(raw);

        if (Number.isFinite(num)) {
            total += num;
        }
    });

    return total;
}
function setCommunityGardensVisible(flag) {
    const v = flag ? 'visible' : 'none';

    if (map.getLayer('community-gardens-fill')) {
        map.setLayoutProperty('community-gardens-fill', 'visibility', v);
        map.setLayoutProperty('community-gardens-outline', 'visibility', v);
    }
}


//hyperlink highlight for data
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

    ids.forEach(id => selectedIds.add(String(id)));

    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

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
    if (el) el.textContent = msg;
}

//swap unselect all button with edit selection
function syncSelectionModeUI() {
    const btn = document.getElementById('clear-selection');
    if (selectionLocked) {
        btn.textContent = 'Edit Selection';
    } else {
        btn.textContent = 'Unselect All';
    }
}

//LOADING FUNCTION
map.on('load', async () => {
    setLoading(true);
    try {
        const data=await joinAcsToBgs(populationACS,arcgisBlockGroups)
        map.addSource('arcgis-layer',{type:'geojson',data,promoteId:'JOINKEY12'})
        map.addSource('community-gardens', {type: 'geojson', data: communityGardens})

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
        paint: {
            'fill-color': '#ffffff',
            'fill-opacity': 0.65
        },
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
            id: 'community-gardens-fill',
            type: 'fill',
            source: 'community-gardens',
            paint: { 'fill-color': '#5fe653', 'fill-opacity': 0.6},
            layout: {visibility: 'none'}
        })

        map.addLayer({
            id: 'community-gardens-outline',
            type: 'line',
            source: 'community-gardens',
            paint: {'line-color': '#45ac3b','line-width': 1},
            layout: {visibility: 'none'}
        })

        //on hover LINK display for troubleshooting
        /*
        let hoverPopup = new maplibregl.Popup({ closeButton:false, closeOnClick:false });
        map.on('mousemove', 'bg-fill', e => {
            if (!e.features?.length) return;
            const f = e.features[0];
            const id = String(f.properties?.LINK ?? '');
            map.getCanvas().style.cursor = 'pointer';
            hoverPopup
            .setLngLat(e.lngLat)
            .setHTML(`<div style="font:12px/1.2 sans-serif">LINK: ${id}</div>`)
            .addTo(map);
        });
        map.on('mouseleave', 'bg-fill', () => {
            map.getCanvas().style.cursor = '';
            hoverPopup.remove();
        });
        */

        map.on('mouseenter', 'bg-fill', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

        map.on('mouseleave', 'bg-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        map.on('click', 'bg-fill', e => {
            if (!e.features?.length) return;
        
            const f = e.features[0];
            const id = String(f.id ?? f.properties?.JOINKEY12 ?? '');
            if (!id) return;
        
            if (selectionMode === 'neighborhood') {
                const neighborhoodIds = new Set(
                    Object.values(neighborhoodToBgs).flat().map(String)
                );
        
                if (neighborhoodIds.has(id)) {
                    selectNeighborhoodsFromBg(id);
                }
                return;
            }
        
            if (!selectionLocked) {
                toggleSelection(id);
                highlightActive(id);
                updateShowDataButton();
            }
        });

        const ids = await fetchRequestedBgs();
        applyDefaultSelection(ids);
        setStatus(`Loaded ${ids.length} BG(s) from list`);
        syncSelectionModeUI();
    } catch (e) {
        console.error(e);
        setStatus('Error loading data');
    } finally {
        setLoading(false);
    }
});

//Button Listeners
document.getElementById('clear-selection').addEventListener('click', () => {
    // Step 1: if selection is locked, clicking should ONLY unlock editing
    if (selectionLocked) {
        selectionLocked = false;
        syncSelectionModeUI();
        updateShowDataButton();
        return;
    }

    // Step 2: neighborhood mode clear behavior
    if (selectionMode === 'neighborhood') {
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

    // Step 3: normal block mode clear behavior
    selectedIds.clear();
    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    renderSelectedList();
    document.getElementById('data-box').style.display = 'none';
    updateShowDataButton();
});
document.getElementById('submit-selection').addEventListener('click', () => {
    if (!selectedIds.size) return;

    lastSubmittedIds = [...selectedIds];

    document.getElementById('reset-last-selection').disabled = false;

    selectionLocked = true;
    map.setFilter(
        'default-selected-fill',
        ['in', ['get', 'JOINKEY12'], ['literal', [...selectedIds]]]
    );
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    syncSelectionModeUI();
    updateShowDataButton();
});
document.getElementById('reset-last-selection').addEventListener('click', () => {
    if (!lastSubmittedIds.length) return;

    selectedIds.clear();
    lastSubmittedIds.forEach(id => selectedIds.add(String(id)));

    activeId = null;

    // If we're in neighborhood mode, rebuild selectedNeighborhoods
    if (selectionMode === 'neighborhood') {
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

    if (selectionMode === 'neighborhood') {
        document.getElementById('details').textContent =
            'Neighborhood selection restored.';
    } else {
        document.getElementById('details').textContent =
            'Click a polygon to view details.';
    }
});

document.getElementById('show-data-btn').addEventListener('click', () => {
    const f = getActiveFilter();
    if (!f) return;

    if (f === 'population-filter') {
        if (selectionMode === 'neighborhood') {
            buildNeighborhoodPopulationBox();
        } else {
            buildPopulationBox();
        }
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
                if (other !== cb) {
                    other.checked = false;
                }
            });
        }
    });
});
const neighborhoodsCheckbox = document.getElementById('neighborhoods-display');

if (neighborhoodsCheckbox) {
    neighborhoodsCheckbox.addEventListener('change', () => {
        if (neighborhoodsCheckbox.checked) {
            selectAllNeighborhoods();
        } else {
            exitNeighborhoodMode();
        }
    });
}
resetSwlBtn.addEventListener('click', async () => {
    await resetToSouthwestLansing();
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
            ['food-filter', 'housesize-filter', 'race-filter', 'population-filter', 'bgdesc-filter']
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