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
const populationACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/PopulationACS/FeatureServer/0/query?where=1=1&outFields=*&f=json'
const raceACS = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/RaceACS/FeatureServer/0/query?where=1=1&outFields=*&f=json'

let activeId = null;
const selectedIds = new Set();
const idToName = new Map();
const idToRow = new Map();

//HELPER FUNCTIONS
//standardizes ids from GEOID to match LINK from geojson
function toCountyTract9(input) {
    const digits = String(input ?? '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length >= 12) {
        const g12 = digits.slice(-12);
        return g12.slice(2, 5) + g12.slice(5, 11);
    }
    return digits.slice(-9).padStart(9, '0');
}

async function fetchArcgisRows(url) {
    const r = await fetch(url);
    const j = await r.json();
    if (j.type === 'FeatureCollection') {
        return (j.features || []).map(f => f.properties || {});
    }
    return (j.features || []).map(f => f.attributes || {});
}

async function joinToFeatures(tableUrl, bgUrl) {
    const [rowsRaw, bg] = await Promise.all([
        fetchArcgisRows(tableUrl),
        fetch(bgUrl).then(r => r.json())
    ]);

    const rows = rowsRaw.slice(2)

    const m = new Map();
    for (const r of rows) {
        const k = toCountyTract9(r?.geo_id ?? r?.GEO_ID);
        if (k) m.set(k, r);
    }

    for (const f of (bg.features || [])) {
        const k = toCountyTract9(f?.properties?.LINK);
        if (k) {
        f.properties.LINK = k;
        idToName.set(k, String(f.properties?.NAME ?? k));
        const row = m.get(k);
        if (row) {
            idToRow.set(k, row);
            for (const [kk, v] of Object.entries(row)) {
            if (kk === 'geo_id') continue;
            if (!(kk in f.properties)) f.properties['csv_' + kk] = v;
            }
        }
        }
    }
    return bg;
}

//pull from txt file
async function fetchRequestedBgs() {
    const res = await fetch('/data/requested_bg.txt', { cache: 'no-store' });
    if (!res.ok) return [];
    const text = await res.text();
    return text
        .split(/\r?\n/)
        .map(s => toCountyTract9(s))
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
        focusFeature(id);
        highlightActive(id);
        highlightDataRow(id);
        };
    });
}

//data button logic
function updateShowDataButton() {
    const btn = document.getElementById('show-data-btn');
    const population = document.getElementById('population-filter');
    btn.disabled = !(population && population.checked && selectedIds.size);
}
/*
//gets coord bounding box
function bboxOfGeometry(geom) {
    function up(coords, box) {
        for (const c of coords) {
        if (typeof c[0] === 'number') {
            const [x, y] = c;
            box[0] = Math.min(box[0], x);
            box[1] = Math.min(box[1], y);
            box[2] = Math.max(box[2], x);
            box[3] = Math.max(box[3], y);
        } else {
            up(c, box);
        }
        }
    }

    if (!geom) return null;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    if (geom.type === 'Polygon') up(geom.coordinates, box);
    else if (geom.type === 'MultiPolygon') up(geom.coordinates, box);
    else return null;
    if (!isFinite(box[0])) return null;
    return [[box[0], box[1]], [box[2], box[3]]];
}

//smooth zoom to selected region
function focusFeature(id) {
    const feats = map.querySourceFeatures('arcgis-layer', {
        filter: ['==', 'LINK', id]
    });
    if (!feats.length) return;
    const f = feats[0];
    const b = bboxOfGeometry(f.geometry);
    if (b) map.fitBounds(b, { padding: 40, duration: 600, maxZoom: 15 });
}
*/

function syncSelectedFill() {
    map.setFilter('default-selected-fill', [
        'in',
        ['get', 'LINK'],
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
    map.setFilter('active-bg-highlight', ['==', 'LINK', id]);
    highlightDataRow(id);
}

//implements default selection
function applyDefaultSelection(ids) {
    ids.forEach(id => selectedIds.add(String(id)));
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton()

}

//shows data visualization box for selected group
function buildDataBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');
    if (!selectedIds.size) {
        box.style.display = 'none';
        return;
    }

    const headerLeft = 'Block Group';
    const headerRight = 'Population';

    const rowsHtml = [...selectedIds].map(id => {
        const name = idToName.get(id) || id;
        const row = idToRow.get(id) || {};
        const raw = row['csv_B01003_001E'];
        const val = Number.isFinite(Number(raw)) ? Number(raw).toLocaleString() : (raw ?? '');
        const isActive = activeId === id;   
        return `<tr data-id="${id}"${isActive ? ' style="background:#fde68a;"' : ''}>
                <td style="padding:6px 8px; border-bottom:1px solid #eee;">${name}</td>
                <td style="padding:6px 8px; border-bottom:1px solid #eee; text-align:right;">${val}</td>
                </tr>`;
    }).join('');

    const html = `
        <h4 style="margin:0 0 8px 0; color:#166534;">${headerLeft} | ${headerRight}</h4>
        <table style="border-collapse:collapse; width:100%">
        <thead>
            <tr>
            <th style="text-align:left; padding:6px 8px; border-bottom:1px solid #ddd;">${headerLeft}</th>
            <th style="text-align:right; padding:6px 8px; border-bottom:1px solid #ddd;">${headerRight}</th>
            </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        </table>
    `;

    content.innerHTML = html;
    box.style.display = 'block';
}

//hyperlink highlight for data
function highlightDataRow(id) {
    const rows = document.querySelectorAll('#data-box tbody tr');
    rows.forEach(tr => {
        if (tr.getAttribute('data-id') === String(id)) tr.style.background = '#fde68a';
        else tr.style.background = '';
    });
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
        const data = await joinToFeatures(populationACS, arcgisBlockGroups);
        

        console.log('idToRow size:', idToRow.size);
        console.log([...idToRow.entries()].slice(0, 3));


        map.addSource('arcgis-layer', {
        type: 'geojson',
        data,
        promoteId: 'LINK'
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
        filter: ['in', ['get', 'LINK'], ['literal', []]]
        });

        map.addLayer({
        id: 'active-bg-highlight',
        type: 'fill',
        source: 'arcgis-layer',
        paint: { 'fill-color': '#fde68a', 'fill-opacity': 0.4 },
        filter: ['==', 'LINK', '___none___']
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

        map.on('mouseenter', 'bg-fill', () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', 'bg-fill', () => map.getCanvas().style.cursor = '');

        map.on('click', 'bg-fill', e => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const id = String(f.id ?? f.properties?.LINK ?? '');
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
    map.setFilter('default-selected-fill', ['in', ['get', 'LINK'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'LINK', '___none___']);
    renderSelectedList();
    document.getElementById('data-box').style.display = 'none';
    updateShowDataButton();
    document.getElementById('details').textContent = 'Click a polygon to view details.';
});

document.getElementById('show-data-btn').addEventListener('click', () => {
    const pop = document.getElementById('population-filter');
    if (pop && pop.checked) buildDataBox();
});

document.getElementById('close-data-box').addEventListener('click', () => {
    document.getElementById('data-box').style.display = 'none';
});

const drawerToggle = document.getElementById('drawer-toggle');
const drawerPanel = document.getElementById('drawer-panel');

drawerToggle.addEventListener('click', () => {
    drawerPanel.classList.toggle('open');
    drawerToggle.classList.toggle('open');
});

['food-filter', 'housesize-filter', 'race-filter', 'population-filter', 'bgdesc-filter'].forEach(id => {
    const cb = document.getElementById(id);
    if (cb) {
        cb.addEventListener('change', () => {
        if (cb.checked) {
            ['food-filter', 'housesize-filter', 'race-filter', 'population-filter', 'bgdesc-filter'].forEach(other => {
            if (other !== id) {
                const o = document.getElementById(other);
                if (o) o.checked = false;
            }
            });
        }
        updateShowDataButton();
        document.getElementById('data-box').style.display = 'none';
        });
    }
});