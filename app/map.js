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
const arcgisBlocks = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/tl_2025_26_tabblock20/FeatureServer/0/query?where=COUNTYFP20%20IN%20(65,45,37)&outFields=*&f=geojson&outSR=4326'
const populationACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/PopulationACS/FeatureServer/0/query?where=1=1&outFields=GEO_ID,B01003_001E&f=json'
const raceACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/RaceACS/FeatureServer/0/query?where=1=1&outFields=*&f=csv'
const communityGardens = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/Community_Garden_Parcels/FeatureServer/0/query?where=1=1&outFields=*&f=geojson&outSR=4326'

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

const filterLabels = {
    'food-filter': 'Food',
    'housesize-filter': 'Household Size',
    'race-filter': 'Race',
    'population-filter': 'Population',
    'health-filter': 'Health',
    'income-filter': 'Income'
};

const blockHoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false
})


//HELPER FUNCTIONS
//id standardization
function key12FromBgGEOID(geoid) {
    const d = String(geoid ?? '').replace(/\D/g, '')
    return d.length === 12 ? d : null
}

function key12FromBlockGEOID(geoid20) {
    const d = String(geoid20 ?? '').replace(/\D/g, '')
    return d.length === 15 ? d.slice(0, 12) : null
}

function key12FromAcs(geoId) {
    const d = String(geoId ?? '').replace(/\D/g, '')
    return d.length >= 12 ? d.slice(-12) : null
}

//adds standard joinkey to block geojson
function attachJoinKeyToBlocks(blockGeojson) {
    for (const f of blockGeojson.features ?? []) {
        const p = f.properties ?? {}
        const k = key12FromBlockGEOID(p.GEOID20)
        if (k) p.JOINKEY12 = k
    }
}

//dynamic request for block level data
async function loadBlocksForSelectedBgs() {
    const where = [...selectedIds]
        .map(k => `GEOID20 LIKE '${k}%'`)
        .join(' OR ')
    const url =
        'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/' +
        'tl_2025_26_tabblock20/FeatureServer/0/query' +
        `?where=${encodeURIComponent(where)}&outFields=*&f=geojson&outSR=4326`
    const blocks = await fetch(url).then(r => r.json())
    attachJoinKeyToBlocks(blocks)
    map.getSource('blocks').setData(blocks)
    return blocks
}

async function joinAcsToBgs(acsUrl, bgUrl) {
    const [acs, bg] = await Promise.all([
        fetch(acsUrl).then(r => r.json()).then(j =>
        (j.features ?? []).map(f => f.attributes ?? {})
        ),
        fetch(bgUrl).then(r => r.json())
    ])

    const acsMap = new Map()
    for (const r of acs) {
        const k = key12FromAcs(r.GEO_ID)
        if (k) acsMap.set(k, r)
    }

    for (const f of (bg.features ?? [])) {
        const p = f.properties ?? {}
        const k = key12FromBgGEOID(p.GEOID)
        if (!k) continue

        p.JOINKEY12 = k
        idToName.set(k, p.NAME ?? k)

        const row = acsMap.get(k)
        if (row) {
        idToRow.set(k, row)
        p.csv_B01003_001E = row.B01003_001E
        }
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
        .map(s => key12FromBgGEOID(s))
        .filter(Boolean);
}

function parseBgLabel(name) {
    const s = String(name ?? '');
    if (!s.length) return { tract: s, bg: s };
    return {
        tract: s.slice(5, -1),
        bg: s.slice(-1)
    };
}

//renders selected id list
function renderSelectedList() {
    const list = document.getElementById('selected-list');
    if (!selectedIds.size) {
        list.innerHTML = 'None';
        return;
    }

    const items = [...selectedIds].map(id => {
        const name = idToName.get(id) ?? id;
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

//filters logic
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

//data button logic
function updateShowDataButton() {
    const btn = document.getElementById('show-data-btn');
    btn.disabled = !(
        selectionMode === SelectionMode.LOCKED &&
        getActiveFilter() &&
        selectedIds.size
    );
}

function syncSelectedFill() {
    map.setFilter('default-selected-fill', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', [...selectedIds]]
    ]);
}

function syncBlockSelectedFill() {
    map.setFilter('block-selected', [
        'in',
        ['get', 'GEOID20'],
        ['literal', [...selectedBlockIds]]
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
function buildPopulationBox(){
    const box=document.getElementById('data-box');
    const content=document.getElementById('data-box-content')
    if(!selectedIds.size){box.style.display='none';return}
    const rowsHtml=[...selectedIds].map(id=>{
        const name=idToName.get(id)||id
        const row=idToRow.get(id)||{}
        const raw=row['B01003_001E']
        const val=Number.isFinite(Number(raw))?Number(raw).toLocaleString():(raw??'')
        return `<tr data-id="${id}"><td style="padding:6px 8px;border-bottom:1px solid #eee;">${name}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${val}</td></tr>`
    }).join('')
    content.innerHTML=`<table style="border-collapse:collapse;width:100%"><thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Population</th></tr></thead><tbody>${rowsHtml}</tbody></table>`
    box.style.display='block'
}

function buildPlaceholderBox(label){
    const box = document.getElementById('data-box')
    const content = document.getElementById('data-box-content')
    content.innerHTML = `<h4>${label}</h4><p>Data coming soon.</p>`
    box.style.display = 'block'
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

    if (
        selectionMode === SelectionMode.BLOCK_SELECT ||
        selectionMode === SelectionMode.LOCKED
    ) {
        btn.textContent = 'Edit Selection';
    } else {
        btn.textContent = 'Unselect All';
    }
}

function syncSelectionHeader() {
    const header = document.getElementById('selection-mode');

    if (selectionMode === SelectionMode.BG_SELECT) {
        header.textContent = "Selecting Block Groups";
    } else if (selectionMode === SelectionMode.BLOCK_SELECT) {
        header.textContent = "Selecting Blocks:";
    } else {
        header.textContent = "Selection Locked:";
    }
}

//selection mode helper
async function setSelectionMode(mode) {
    selectionMode = mode
    syncSelectionModeUI()
    syncSelectionHeader()

    if (mode === SelectionMode.BG_SELECT) {
        map.setLayoutProperty('bg-fill', 'visibility', 'visible')
        map.setLayoutProperty('bg-outline', 'visibility', 'visible')
        map.setLayoutProperty('default-selected-fill', 'visibility', 'visible')
        map.setLayoutProperty('active-bg-highlight', 'visibility', 'visible')
        map.setLayoutProperty('block-fill', 'visibility', 'none')
        map.setLayoutProperty('block-outline', 'visibility', 'none')
        map.setLayoutProperty('block-selected', 'visibility', 'none')
        selectedBlockIds.clear()
        updateShowDataButton()
        return
    }

    if (mode === SelectionMode.BLOCK_SELECT) {
        const blocks = await loadBlocksForSelectedBgs()
        selectedBlockIds.clear()
        for (const f of blocks.features ?? []) {
        const id = String(f.properties?.GEOID20)
        if (id) selectedBlockIds.add(id)
        }
        map.setLayoutProperty('bg-fill', 'visibility', 'none')
        map.setLayoutProperty('bg-outline', 'visibility', 'none')
        map.setLayoutProperty('default-selected-fill', 'visibility', 'none')
        map.setLayoutProperty('active-bg-highlight', 'visibility', 'none')
        map.setLayoutProperty('block-fill', 'visibility', 'visible')
        map.setLayoutProperty('block-outline', 'visibility', 'visible')
        map.setLayoutProperty('block-selected', 'visibility', 'visible')
        syncBlockSelectedFill()
        updateShowDataButton()
        return
    }

    if (mode === SelectionMode.LOCKED) {
        updateShowDataButton()
    }
}

map.on('load', async () => {
    setLoading(true);
    try {
        const data=await joinAcsToBgs(populationACS,arcgisBlockGroups)
        
        map.addSource('arcgis-layer', {
            type: 'geojson',
            data,
            promoteId: 'JOINKEY12'
        });

        map.addSource('community-gardens', {
            type: 'geojson',
            data: communityGardens
        });

        map.addSource('blocks', {
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
            id: 'block-fill',
            type: 'fill',
            source: 'blocks',
            paint: {
                'fill-color': '#2b8a3e',
                'fill-opacity': 0.25
            },
            layout: { visibility: 'none' }
        });

        map.addLayer({
            id: 'block-outline',
            type: 'line',
            source: 'blocks',
            paint: {
                'line-color': '#c2410c',
                'line-width': 0.5
            },
            layout: { visibility: 'none' }
        });

        map.addLayer({
            id: 'block-selected',
            type: 'fill',
            source: 'blocks',
            paint: {
                'fill-color': '#f97316',
                'fill-opacity': 0.5
            },
            layout: { visibility: 'none' },
            filter: ['in', ['get', 'GEOID20'], ['literal', []]]
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

        //bg on-click
        map.on('click', 'bg-fill', e => {
            if (selectionMode !== SelectionMode.BG_SELECT) return;
            if (!e.features?.length) return;

            const id = String(e.features[0].properties.JOINKEY12);
            toggleSelection(id);
            highlightActive(id);
        });

        //block on-click
        map.on('click', 'block-fill', e => {
            if (selectionMode !== SelectionMode.BLOCK_SELECT) return
            if (!e.features?.length) return
            const id = String(e.features[0].properties.GEOID20)
            if (selectedBlockIds.has(id)) selectedBlockIds.delete(id)
            else selectedBlockIds.add(id)
            syncBlockSelectedFill()
        });

        //block hover
        map.on('mousemove', 'block-selected', e => {
            if (selectionMode !== SelectionMode.LOCKED) return
            if (!e.features?.length) return
            const p = e.features[0].properties ?? {}
            const pop = p.POP20 ?? 'N/A'
            const housing = p.HOUSING20 ?? 'N/A'
            map.getCanvas().style.cursor = 'pointer'
            blockHoverPopup
                .setLngLat(e.lngLat)
                .setHTML(
                `<div style="font:12px/1.3 sans-serif">
                    <div><strong>Block</strong></div>
                    <div>Population: ${pop}</div>
                    <div>Housing Units: ${housing}</div>
                </div>`
                )
                .addTo(map)
        });

        map.on('mouseleave', 'block-selected', () => {
            map.getCanvas().style.cursor = ''
            blockHoverPopup.remove()
        })

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
document.getElementById('clear-selection').addEventListener('click', async () => {
    if (
        selectionMode === SelectionMode.BLOCK_SELECT ||
        selectionMode === SelectionMode.LOCKED
    ) {
        await setSelectionMode(SelectionMode.BG_SELECT)
        setCommunityGardensVisible(false)
        document.getElementById('data-box').style.display = 'none'
        map.setFilter(
        'default-selected-fill',
        ['in', ['get', 'JOINKEY12'], ['literal', [...selectedIds]]]
        )
        updateShowDataButton()
        return
    }

    selectedIds.clear()
    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]])
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___'])
    renderSelectedList()
    document.getElementById('data-box').style.display = 'none'
    updateShowDataButton()
});

document.getElementById('submit-selection').addEventListener('click', () => {
    if (selectionMode === SelectionMode.BG_SELECT) {
        if (!selectedIds.size) return
        setSelectionMode(SelectionMode.BLOCK_SELECT)
        return
    }

    if (selectionMode === SelectionMode.BLOCK_SELECT) {
        if (!selectedBlockIds.size) return
        setSelectionMode(SelectionMode.LOCKED)
    }
});

document.getElementById('show-data-btn').addEventListener('click', () => {
    const f = getActiveFilter()
    if (!f) return
    if (f === 'population-filter') {
        buildPopulationBox()
    } else if (f === 'food-filter') {
        setCommunityGardensVisible(true);
        buildPlaceholderBox(filterLabels[f]);
    } else {
        buildPlaceholderBox(filterLabels[f])
    }
});

document.getElementById('close-data-box').addEventListener('click', () => {
    document.getElementById('data-box').style.display = 'none';
});

const drawerToggle = document.getElementById('drawer-toggle');
const drawerPanel = document.getElementById('drawer-panel');

drawerToggle.addEventListener('click', () => {
    const filtersHandle = document.getElementById('filters-drawer-toggle');

    // if About is about to open, force Filters closed first
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
const filtersDrawerToggle = document.getElementById('filters-drawer-toggle');
const filtersDrawerPanel = document.getElementById('filters-drawer-panel');
const swlDisplay = document.getElementById('swl-display');

swlDisplay.addEventListener('click', async () => {
    await resetToSouthwestLansing();
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
        if (selectionMode !== SelectionMode.LOCKED) {
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