//basic map initialization
const map = new maplibregl.Map({
    container: 'map',
    center: [-84.582236, 42.697406],
    zoom: 12,
    style: 'static/map-style.json', //osm_liberty style json
});
map.addControl(new maplibregl.NavigationControl());

//working URL including filter
const arcgisBlockGroups = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/2010_Block_Groups/FeatureServer/0/query?where=CNTY_CODE%20IN%20(65,45,37)&outFields=*&f=geojson&outSR=4326';
const arcgisBlocks = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/tl_2025_26_tabblock20/FeatureServer/0'
const sexByAgeACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/SexByAge_ACS2024/FeatureServer/0/query?where=1=1&outFields=*&f=json'

//helper functions
function parseBgLabel(name) {
    const s = String(name);
    if (!s.length) return { tract: s, bg: s };
    return { tract: s.slice(0, -1), bg: s.slice(-1) };
}

function renderSelectedList() {
    const list = document.getElementById('bg-list');
    const items = Array.from(selectedIds).map(id => ({ id, name: idToName.get(id) || '' }));
    items.sort((a,b) => {
        const an = a.name || '';
        const bn = b.name || '';
        const ap = parseBgLabel(an);
        const bp = parseBgLabel(bn);
        const at = parseInt(ap.tract || '0', 10);
        const bt = parseInt(bp.tract || '0', 10);
        if (at !== bt) return at - bt;
        return parseInt(ap.bg || '0', 10) - parseInt(bp.bg || '0', 10);
    });
    list.innerHTML = items.map(({id,name}) => {
        const p = parseBgLabel(name);
        const label = p.tract && p.bg ? `Tract ${p.tract}, BG ${p.bg}` : name;
        return `<li style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #f3f4f6">
        <span>${label}</span>
        <button data-id="${id}" style="padding:2px 6px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer">Remove</button>
        </li>`;
    }).join('');
    list.querySelectorAll('button[data-id]').forEach(btn => {
        btn.onclick = () => {
        const id = String(btn.getAttribute('data-id'));
        if (selectedIds.has(id)) {
            selectedIds.delete(id);
            map.setFeatureState({ source: 'arcgis-layer', id }, { selected: false });
            renderSelectedList();
        }
        };
    });
}

document.getElementById('bg-clear').onclick = () => {
    for (const id of selectedIds) map.setFeatureState({ source: 'arcgis-layer', id }, { selected: false });
    selectedIds.clear();
    renderSelectedList();
};

//csv helpers
function last9Digits(s){
    const d=String(s??'').replace(/\D/g,'')
    const t=d.slice(-9)
    return t.padStart(9,'0')
}
async function fetchArcgisRows(url){
    const r=await fetch(url); const j=await r.json()
    if (j.type==='FeatureCollection') return (j.features||[]).map(f=>f.properties||{})
    return (j.features||[]).map(f=>f.attributes||{})
}

async function joinTableToBg(tableQueryUrl,bgQueryUrl,opts={}){
    const csvKey=opts.csvKey||'geo_id'
    const geoKey=opts.geoKey||'LINK'
    const prefix=opts.prefix||'csv_'
    const [rows,bg]=await Promise.all([fetchArcgisRows(tableQueryUrl),fetch(bgQueryUrl).then(r=>r.json())])
    const m=new Map(rows.map(r=>[last9Digits(r[csvKey]),r]))
    for(const f of bg.features||[]){
        const key=last9Digits(f?.properties?.[geoKey])
        const row=m.get(key)
        if(row){
        for(const [k,v] of Object.entries(row)){
            if(k===csvKey) continue
            if(!(k in f.properties)) f.properties[prefix+k]=v
        }
        }
    }
    return bg
}

//default selection
async function fetchRequestedBgs() {
    const res = await fetch('/data/requested_bg.txt', { cache: 'no-store' });
    if (!res.ok) return [];
    const text = await res.text();
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function applyInitialSelection(ids) {
    const src = map.getSource('arcgis-layer');
    if (!src) return;
    for (const id of ids) {
        const k = String(id);
        map.setFeatureState({ source: 'arcgis-layer', id: k }, { selected: true });
        selectedIds.add(k);
        idToName.set(k, k);
    }
    renderSelectedList();
}

//fill polygon layer
map.on('load', async () => {
    const data=await joinTableToBg(sexByAgeACS,arcgisBlockGroups,{csvKey:'geo_id',geoKey:'LINK',prefix:'csv_'})
    map.addSource('arcgis-layer', { type: 'geojson', data, promoteId: 'NAME' });
    map.addLayer({ id: 'arcgis-fill', type: 'fill', source: 'arcgis-layer', paint: { 'fill-color': ['case', ['boolean', ['feature-state','selected'], false], '#f59e0b', '#2b8a3e'], 'fill-opacity': 0.4 } });
    map.addLayer({ id: 'arcgis-outline', type: 'line', source: 'arcgis-layer', paint: { 'line-color': '#2b8a3e', 'line-width': 1 } });

    //default selection
    const ids = await fetchRequestedBgs();
    if (map.isSourceLoaded('arcgis-layer')) {
    applyInitialSelection(ids);
    } else {
    const onData = e => {
        if (e.sourceId === 'arcgis-layer' && map.isSourceLoaded('arcgis-layer')) {
        map.off('sourcedata', onData);
        applyInitialSelection(ids);
        }
    };
    map.on('sourcedata', onData);
    }
});

//selection logic
let selectionMode = 'bg';
const selectedIds = new Set();
const idToName = new Map();
map.on('click', 'arcgis-fill', e => {
    if (!e.features?.length) return;
    const f = e.features[0];
    const id = String(f.id);
    const name = String(f.properties?.NAME ?? '');
    if (!name) return;
    idToName.set(id, name);
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
        map.setFeatureState({ source: 'arcgis-layer', id }, { selected: false });
    } else {
        selectedIds.add(id);
        map.setFeatureState({ source: 'arcgis-layer', id }, { selected: true });
    }
    renderSelectedList();
});
map.on('mouseenter', 'arcgis-fill', () => map.getCanvas().style.cursor = 'pointer');
map.on('mouseleave', 'arcgis-fill', () => map.getCanvas().style.cursor = '');

//block mode
//todo