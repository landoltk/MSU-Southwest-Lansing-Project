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

let activeId = null;
const selectedIds = new Set();
const idToName = new Map();
const idToRow = new Map();

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
    const population = document.getElementById('population-filter');
    btn.disabled = !(getActiveFilter() && selectedIds.size)
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

//LOADING FUNCTION
map.on('load', async () => {
    setLoading(true);
    try {
        const data=await joinAcsToBgs(populationACS,arcgisBlockGroups)
        map.addSource('arcgis-layer',{type:'geojson',data,promoteId:'JOINKEY12'})

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
        toggleSelection(id);
        highlightActive(id);
        updateShowDataButton();
        });

        const ids = await fetchRequestedBgs();
        applyDefaultSelection(ids);
        setStatus(`Loaded ${ids.length} BG(s) from list`);
    } catch (e) {
        console.error(e);
        setStatus('Error loading data');
    } finally {
        setLoading(false);
    }
});

document.getElementById('clear-selection').addEventListener('click', () => {
    selectedIds.clear();
    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    renderSelectedList();
    document.getElementById('data-box').style.display = 'none';
    updateShowDataButton();
    document.getElementById('details').textContent = 'Click a polygon to view details.';
});

document.getElementById('show-data-btn').addEventListener('click', () => {
    const f = getActiveFilter()
    if (!f) return
    if (f === 'population-filter') buildPopulationBox()
    else buildPlaceholderBox(filterLabels[f])
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

            updateSelectedFilterText();   // ⭐ ADD THIS LINE
            updateShowDataButton();
            document.getElementById('data-box').style.display = 'none';
        });
    }
});