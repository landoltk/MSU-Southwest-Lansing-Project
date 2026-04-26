//basic map initialization
const map = new maplibregl.Map({
    container: 'map',
    center: [-84.582236, 42.697406],
    zoom: 12,
    style: 'static/map-style.json'
});
map.addControl(new maplibregl.NavigationControl());

//arcGIS BASE URLs
const arcgisBlockGroupsBase = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/2020_Michigan_BGs/FeatureServer'
const arcgisBlocksBase = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/tl_2025_26_tabblock20/FeatureServer'
const populationACSBase = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/PopulationACS/FeatureServer'
const raceACSBase = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/RaceACS/FeatureServer'
const communityGardensBase = 'https://services.arcgis.com/uHAHKfH1Z5ye1Oe0/arcgis/rest/services/Community_Garden_Parcels/FeatureServer'

//full arcGIS URLs
const arcgisBlockGroups = arcgisBlockGroupsBase + '/0/query?where=COUNTYFP%20IN%20(65,45,37)&outFields=*&f=geojson&outSR=4326';
const arcgisBlocks = arcgisBlocksBase + '/0/query?where=COUNTYFP20%20IN%20(65,45,37)&outFields=*&f=geojson&outSR=4326'
const populationACS = populationACSBase + '/0/query?where=1=1&outFields=GEO_ID,B01003_001E&f=json'
const raceACS = raceACSBase + '/0/query?where=1=1&outFields=*&f=csv'
const communityGardens = communityGardensBase + '/0/query?where=1=1&outFields=*&f=geojson&outSR=4326'

//global constants
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
let communityGardensOriginal = null;
const gardenPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true
});
let hoveredBlockId = null;
let pinnedBlockId = null;
const DARK_ORANGE = '#ea580c';    
const LIGHT_ORANGE = '#fdba74'; 
let deselectedBlockIds = new Set();

//neighborhood globals
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

//filter globals
const filterLabels = {
    'food-filter': 'Food',
    'housesize-filter': 'Household Size',
    'race-filter': 'Race',
    'population-filter': 'Population',
    'health-filter': 'Health',
    'income-filter': 'Income'
};

//food source points globals
const foodSources = {
  sources: {},     // key -> geojson
  colors: {},      // key -> color
};
const foodPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true });

//Takes food source geojson files and adds the points to the map while following the color coding for different categories
async function loadFoodGeojson({ id, path, color }) {
    const data = await fetch(path).then(r => r.json());

    const category =
        data.name ||
        data.properties?.name ||
        'Unknown Category';

    for (const f of data.features ?? []) {
        if (!f.properties) f.properties = {};
        f.properties._category = category;
    }

    foodSources.sources[id] = data;
    foodSources.colors[id] = color;

    map.addSource(id, {
        type: 'geojson',
        data
    });

    map.addLayer({
        id: `${id}-points`,
        type: 'circle',
        source: id,
        paint: {
        'circle-radius': 4,
        'circle-color': color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5
        },
        layout: { visibility: 'none' }
    });
}

//health points
const healthSources = {
    sources: {},
    colors: {}
}

//loads in points for health and adds to map while following color coding for different categories
async function loadHealthGeojson({ id, path, color }) {
    const data = await fetch(path).then(r => r.json());

    const category =
        typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : 'Health Resource';

    for (const f of data.features ?? []) {
        if (!f.properties) f.properties = {};
        f.properties._category = category;
    }

    healthSources.sources[id] = data;
    healthSources.colors[id] = color;

    map.addSource(id, {
        type: 'geojson',
        data
    });

    map.addLayer({
        id: `${id}-points`,
        type: 'circle',
        source: id,
        paint: {
        'circle-radius': 4,
        'circle-color': color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5
        },
        layout: { visibility: 'none' }
    });
}
//Links each block group ID to corresponding neighborhoods
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

//dynamic request for block level data reducing amount of requests from arcGIS (limit is ~1000 polygons)
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

//attaches ACS loaded data to the BG data within the code to make identification and data pulls easier
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

//attaches Race data to BG data to make data pulls easier
async function joinRaceToBgs(bgGeojson) {
    const raceRows = await fetchCsvRows('static/data/race_data.csv');

    const totalRow = raceRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('total:');
    });

    const whiteRow = raceRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('white alone');
    });

    const blackRow = raceRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('black or african american alone');
    });

    const nativeRow = raceRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('american indian and alaska native alone');
    });

    const asianRow = raceRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('asian alone');
    });

    const pacificRow = raceRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('native hawaiian and other pacific islander alone');
    });

    const otherRow = raceRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('some other race alone');
    });

    const twoPlusRow = raceRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('two or more races');
    });

    for (const f of (bgGeojson.features || [])) {
        const p = f.properties || {};
        const joinKey = p.JOINKEY12 || key12FromLink(p.LINK);
        if (!joinKey) continue;

        const countyCode = joinKey.slice(2, 5);
        const tract6 = joinKey.slice(5, 11);
        const bg = joinKey.slice(11);

        const countyMap = {
            '065': 'Ingham',
            '045': 'Eaton',
            '037': 'Clinton'
        };

        const countyName = countyMap[countyCode];
        if (!countyName) continue;

        const tractNum = `${parseInt(tract6.slice(0, 4), 10)}.${tract6.slice(4)}`.replace(/\.00$/, '');

        const estimateCol =
            `Block Group ${bg}; Census Tract ${tractNum}; ${countyName} County; Michigan!!Estimate`;

        const num = row => Number(String(row?.[estimateCol] ?? '').replace(/,/g, '')) || 0;

        p.race_total = num(totalRow);
        p.race_white = num(whiteRow);
        p.race_black = num(blackRow);
        p.race_native = num(nativeRow);
        p.race_asian = num(asianRow);
        p.race_pacific = num(pacificRow);
        p.race_other = num(otherRow);
        p.race_two_plus = num(twoPlusRow);
    }

    return bgGeojson;
}

//pull from txt file to get default BG selection
async function fetchRequestedBgs() {
    const res = await fetch('static/data/requested_bg.txt', { cache: 'no-store' });
    if (!res.ok) return [];
    const text = await res.text();
    return text
        .split(/\r?\n/)
        .map(s => key12FromBgGEOID(s))
        .filter(Boolean);
}

//attaches Income data to BG data to make data pulls easier
async function joinIncomeToBgs(bgGeojson) {
    const incomeRows = await fetchCsvRows('static/data/income_data.csv');

    // Find the row that actually contains the median household income values
    const incomeRow = incomeRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('median household income');
    });

    if (!incomeRow) {
        console.error('Could not find median household income row in CSV');
        return bgGeojson;
    }

    for (const f of (bgGeojson.features || [])) {
        const p = f.properties || {};
        const joinKey = p.JOINKEY12 || key12FromLink(p.LINK);
        if (!joinKey) continue;

        // Convert JOINKEY12 like 260650017031 into the same ACS-style column header
        const countyCode = joinKey.slice(2, 5);
        const tract6 = joinKey.slice(5, 11);
        const bg = joinKey.slice(11);

        const countyMap = {
            '065': 'Ingham',
            '045': 'Eaton',
            '037': 'Clinton'
        };

        const countyName = countyMap[countyCode];
        if (!countyName) continue;

        const tractNum = `${parseInt(tract6.slice(0, 4), 10)}.${tract6.slice(4)}`.replace(/\.00$/, '');

        const estimateCol =
            `Block Group ${bg}; Census Tract ${tractNum}; ${countyName} County; Michigan!!Estimate`;

        const rawIncome = incomeRow[estimateCol];
        p.income_median = Number(String(rawIncome ?? '').replace(/[$,]/g, '')) || 0;

        //console.log(joinKey, estimateCol, rawIncome, p.income_median);
    }

    return bgGeojson;
}

//helper function for BG data joins to pull data from csvs
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
//Returns all block groups corresponded with one neighbhorhood. How we grab three block groups for one neighborhood
function getNeighborhoodFeatures(name) {
    const ids = (neighborhoodToBgs[name] || []).map(String);

    return (blockGroupGeojson.features || []).filter(
        f => ids.includes(String(f.properties?.JOINKEY12))
    );
}
//Builds the data box for neighborhoods built around the neighborhood names.
function buildNeighborhoodTable(config) {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    if (!selectedNeighborhoods.size) {
        box.style.display = 'none';
        return;
    }

    const rows = [...selectedNeighborhoods].map(name => {
        const features = getNeighborhoodFeatures(name);

        const row = { name };

        config.columns.forEach(col => {
            let values = features
                .map(f => {
                    if (col.compute) return col.compute(f.properties || {});
                    const v = Number(f.properties?.[col.key]);
                    return Number.isFinite(v) ? v : null;
                })
                .filter(v => v !== null);

            if (!values.length) {
                row[col.key || col.label] = null;
            } else if (col.method === 'sum') {
                row[col.key || col.label] = values.reduce((a, b) => a + b, 0);
            } else {
                row[col.key || col.label] = values.reduce((a, b) => a + b, 0) / values.length;
            }
        });

        return row;
    });

    content.innerHTML = `
        ${config.summary ? config.summary(rows) : ''}

        <div style="margin-bottom:10px; font-size:13px; color:#555;">
            ${config.subtitle || ''}
        </div>

        <table style="border-collapse:collapse;width:100%">
            <thead>
                <tr>
                    <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Neighborhood</th>
                    ${config.columns.map(col => `
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">
                            ${col.label}
                        </th>
                    `).join('')}
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr data-name="${row.name}">
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${row.name}</td>
                        ${config.columns.map(col => {
                            const key = col.key || col.label;
                            const val = row[key];
                            return `
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                                    ${col.format ? col.format(val) : val}
                                </td>
                            `;
                        }).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    box.style.display = 'block';
    pinnedNeighborhoodName = null;
    hoveredNeighborhoodName = null;
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

    document.querySelectorAll('#data-box tbody tr[data-name]').forEach(tr => {
        const name = tr.getAttribute('data-name');
    
        tr.addEventListener('mouseenter', () => {
            hoveredNeighborhoodName = name;
            updateNeighborhoodTableAndMapHighlight();
        });
    
        tr.addEventListener('mouseleave', () => {
            hoveredNeighborhoodName = null;
            updateNeighborhoodTableAndMapHighlight();
        });
    
        tr.addEventListener('click', () => {
            pinnedNeighborhoodName = name;
            hoveredNeighborhoodName = null;
            updateNeighborhoodTableAndMapHighlight();
        });
    });
    updateNeighborhoodTableAndMapHighlight();
}

//csv reader helper function
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


//table and map highlighting for mouse actions
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

//renders selected id list
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

    document.querySelectorAll('.bg-link').forEach(a => {
        a.onclick = e => {
            e.preventDefault();
            const id = String(a.getAttribute('data-id'));
            highlightActive(id);
            highlightDataRow(id);
        };
    });
}

//pulls current display mode
function getDisplayMode() {
    if (document.getElementById('radius-display')?.checked) return 'radius';
    if (document.getElementById('neighborhoods-display')?.checked) return 'neighborhoods';
    if (document.getElementById('block-display')?.checked) return 'block';
    return 'swl';
}

//selection mode updating function
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
            details.textContent = 'Radius mode: click anywhere on the map to select block groups within the radius.';
        } else if (mode === 'neighborhoods') {
            details.textContent = 'Neighborhood mode: click a white neighborhood to select its block groups.';
        } else {
            details.textContent = 'Click a polygon to view details.';
        }
    }
}

//radius clear helper
function clearRadiusCircle() {
    lastRadiusCircle = null;

    if (map.getSource('radius-circle')) {
        map.getSource('radius-circle').setData({
            type: 'FeatureCollection',
            features: []
        });
    }
}

//block group selection by radius using turf.js for intersection
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

//filter pull
function getActiveFilter(){
    return Object.keys(filterLabels).find(id => {
        const cb = document.getElementById(id)
        return cb && cb.checked
    })
}

//filter text update
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

//show data activationd helper
function updateShowDataButton() {
    const btn = document.getElementById('show-data-btn');
    btn.disabled = !(
        selectionMode === SelectionMode.LOCKED &&
        getActiveFilter() &&
        selectedIds.size
    );
}

//limits map to selected block groups list
function syncSelectedFill() {
    map.setFilter('default-selected-fill', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', [...selectedIds]]
    ]);
}

//limits map to selected blocks list
function syncBlockSelectedFill() {
    map.setFilter('block-selected', [
        'in',
        ['get', 'GEOID20'],
        ['literal', [...selectedBlockIds]]
    ]);
}
// highlights block groups corresponding with neighborhoods
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
// Clears all neighborhood highlighting from the map
function clearNeighborhoodBaseFill() {
    map.setFilter('neighborhood-base-fill', [
        'in',
        ['get', 'JOINKEY12'],
        ['literal', []]
    ]);
}

//on click bg selection
function toggleSelection(id) {
    const key = String(id);
    if (selectedIds.has(key)) selectedIds.delete(key);
    else selectedIds.add(key);
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();
}

//highlight block groups
function highlightActive(id) {
    activeId = String(id);
    pinnedTableId = String(id);
    hoveredTableId = null;
    updateTableAndMapHighlight();
}

//implements default selection
function applyDefaultSelection(ids) {
    ids.forEach(id => selectedIds.add(String(id)));
    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton()
}

//block level data aggregation for block groups
function aggregateBlocksByBg() {
    const src = map.getSource('blocks')?._data
    if (!src) return {}

    const out = {}

    for (const f of src.features ?? []) {
    const p = f.properties ?? {}
    const blockId = String(p.GEOID20)
    if (!selectedBlockIds.has(blockId)) continue

    const bg = p.JOINKEY12
    if (!bg) continue

    if (!out[bg]) {
    out[bg] = { pop: 0, housing: 0 }
    }

    out[bg].pop += Number(p.POP20) || 0
    out[bg].housing += Number(p.HOUSING20) || 0
    }

    return out
}

//formatting helper for geoids for data tables
function formatBgId(joinKey12) {
    const d = String(joinKey12 ?? '').replace(/\D/g, '');
    if (d.length !== 12) return joinKey12;

    const county = parseInt(d.slice(2, 5), 10);

    const tractRaw = d.slice(5, 11);
    const tract =
    `${parseInt(tractRaw.slice(0, -2), 10)}.${tractRaw.slice(-2)}`;

    const bg = parseInt(d.slice(11), 10);

    return `County ${county} · Tract ${tract} · Block Group ${bg}`;
}

//block id formatting for hover block
function formatBlockId(geoid20) {
    const d = String(geoid20 ?? '').replace(/\D/g, '')
    if (d.length !== 15) return geoid20
    const tractRaw = d.slice(5, 11); 
    return `County ${parseInt(d.slice(2, 5), 10)} · Tract ${parseInt(tractRaw.slice(0, -2), 10)}.${tractRaw.slice(-2)} · Block Group ${d.slice(11, 12)} · Block ${parseInt(d.slice(12), 10)}`
}

//helper for block id box top left
function setBlockHoverBox(html) {
    const box = document.getElementById('block-hover-box');
    if (!box) return;

    if (!html) {
        box.style.display = 'none';
        box.innerHTML = '';
    } else {
        box.innerHTML = html;
        box.style.display = 'block';
    }
}

//clean up helper
function closeAllPopups() {
    if (foodPopup) foodPopup.remove();
    if (gardenPopup) gardenPopup.remove();
}

//different filters data visualization boxes
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
            <div style="margin-bottom:10px; font-size:13px; color:#555;">
                Data from U.S. Census Bureau, 2024
            </div>
            <thead>
            <tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Population</th>
            </tr>
            </thead>
            <tbody>
            <tr style="font-weight:bold;background:#f3f4f6;">
            <td style="padding:6px 8px;border-bottom:2px solid #ccc;">Total</td>
            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">
            ${grandTotal.toLocaleString()}
            </td>
            </tr>
            ${Object.entries(byBg).map(([bg, total]) => `
            <tr data-id="${bg}">
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">
                ${formatBgId(bg)}
            </td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                ${total.toLocaleString()}
            </td>
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

    box.style.display = 'block';
    pinnedTableId = null;
    hoveredTableId = null;
    attachDataRowInteractions();
    updateTableAndMapHighlight();
}
//For building the data box for the Race filter
function buildRaceBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    // BLOCK MODE: estimate race counts based on selected block population share
    if (selectionMode === SelectionMode.LOCKED && selectedBlockIds.size) {
        const src = map.getSource('blocks')?._data;
        if (!src) return;

        const byBg = {};

        // sum selected block population within each block group
        for (const f of src.features ?? []) {
            const p = f.properties ?? {};
            const blockId = String(p.GEOID20);
            const bgId = String(p.JOINKEY12 || '');

            if (!selectedBlockIds.has(blockId)) continue;
            if (!bgId) continue;

            const pop = Number(p.POP20) || 0;

            if (!byBg[bgId]) {
                byBg[bgId] = {
                    selectedPop: 0
                };
            }

            byBg[bgId].selectedPop += pop;
        }

        const rows = Object.keys(byBg).map(id => {
            const feature = (blockGroupGeojson.features || []).find(
                f => String(f.properties?.JOINKEY12) === String(id)
            );

            const p = feature?.properties || {};
            const totalBgPop = Number(p.csv_B01003_001E) || 0;
            const selectedPop = byBg[id].selectedPop;
            const proportion = totalBgPop > 0 ? selectedPop / totalBgPop : 0;

            return {
                id,
                name: id,
                totalPop: totalBgPop,
                selectedPop,
                proportion,
                total: Math.round((Number(p.race_total) || 0) * proportion),
                white: Math.round((Number(p.race_white) || 0) * proportion),
                black: Math.round((Number(p.race_black) || 0) * proportion),
                native: Math.round((Number(p.race_native) || 0) * proportion),
                asian: Math.round((Number(p.race_asian) || 0) * proportion),
                pacific: Math.round((Number(p.race_pacific) || 0) * proportion),
                other: Math.round((Number(p.race_other) || 0) * proportion),
                twoPlus: Math.round((Number(p.race_two_plus) || 0) * proportion)
            };
        });

        const totals = rows.reduce(
            (acc, r) => {
                acc.total += r.total;
                acc.white += r.white;
                acc.black += r.black;
                acc.native += r.native;
                acc.asian += r.asian;
                acc.pacific += r.pacific;
                acc.other += r.other;
                acc.twoPlus += r.twoPlus;
                return acc;
            },
            {
                total: 0,
                white: 0,
                black: 0,
                native: 0,
                asian: 0,
                pacific: 0,
                other: 0,
                twoPlus: 0
            }
        );

        content.innerHTML = `
            <div style="margin-bottom:10px; font-size:13px; color:#555;">
                Data from U.S. Census Bureau, ACS 5-Year Estimates 2024. Block level estimates made based on population ratios.
            </div>

            <div style="overflow-x:auto;">
                <table style="border-collapse:collapse;width:100%; min-width:1000px;">
                    <thead>
                        <tr>
                            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Total</th>
                            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">White</th>
                            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Black</th>
                            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Native</th>
                            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Asian</th>
                            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Pacific</th>
                            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Other Race</th>
                            <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Two+</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="font-weight:bold;background:#f3f4f6;">
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;">Group Total</td>
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.total.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.white.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.black.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.native.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.asian.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.pacific.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.other.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.twoPlus.toLocaleString()}</td>
                        </tr>

                        ${rows.map(r => `
                            <tr data-id="${r.id}">
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;">${formatBgId(r.name)}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.total.toLocaleString()}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.white.toLocaleString()}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.black.toLocaleString()}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.native.toLocaleString()}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.asian.toLocaleString()}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.pacific.toLocaleString()}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.other.toLocaleString()}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.twoPlus.toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        box.style.display = 'block';
        pinnedTableId = null;
        hoveredTableId = null;
        attachDataRowInteractions();
        updateTableAndMapHighlight();
        return;
    }

    // NORMAL MODE: use full block group race values
    if (!selectedIds.size) {
        box.style.display = 'none';
        return;
    }

    const rows = [...selectedIds].map(id => {
        const feature = (blockGroupGeojson.features || []).find(
            f => String(f.properties?.JOINKEY12) === String(id)
        );

        const p = feature?.properties || {};
        const name = idToName.get(id) || id;

        return {
            id,
            name,
            total: Number(p.race_total) || 0,
            white: Number(p.race_white) || 0,
            black: Number(p.race_black) || 0,
            native: Number(p.race_native) || 0,
            asian: Number(p.race_asian) || 0,
            pacific: Number(p.race_pacific) || 0,
            other: Number(p.race_other) || 0,
            twoPlus: Number(p.race_two_plus) || 0
        };
    });

    const totals = rows.reduce(
        (acc, r) => {
            acc.total += r.total;
            acc.white += r.white;
            acc.black += r.black;
            acc.native += r.native;
            acc.asian += r.asian;
            acc.pacific += r.pacific;
            acc.other += r.other;
            acc.twoPlus += r.twoPlus;
            return acc;
        },
        {
            total: 0,
            white: 0,
            black: 0,
            native: 0,
            asian: 0,
            pacific: 0,
            other: 0,
            twoPlus: 0
        }
    );

    content.innerHTML = `
        <div style="margin-bottom:10px; font-size:13px; color:#555;">
            Race data acquired from 2020 Census
        </div>

        <div style="overflow-x:auto;">
            <table style="border-collapse:collapse;width:100%; min-width:1400px;">
                <thead>
                    <tr>
                        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Total</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">White</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Black</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Native</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Asian</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Pacific</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Other Race</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Two+</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="font-weight:bold;background:#f3f4f6;">
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;">Group Total</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.total.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.white.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.black.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.native.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.asian.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.pacific.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.other.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.twoPlus.toLocaleString()}</td>
                    </tr>

                    ${rows.map(r => `
                        <tr data-id="${r.id}">
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${formatBgId(r.name)}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.total.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.white.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.black.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.native.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.asian.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.pacific.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.other.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.twoPlus.toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    box.style.display = 'block';
    pinnedTableId = null;
    hoveredTableId = null;
    attachDataRowInteractions();
    updateTableAndMapHighlight();
}
// Builds and attaches the income data box to display for the block groups
function buildIncomeBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    if (selectionMode === SelectionMode.LOCKED && selectedBlockIds.size) {
        const src = map.getSource('blocks')?._data;
        if (!src) return;

        const selectedBgIds = new Set();

        for (const f of src.features ?? []) {
            const p = f.properties ?? {};
            const blockId = String(p.GEOID20);
            const bgId = String(p.JOINKEY12 || '');

            if (!selectedBlockIds.has(blockId)) continue;
            if (!bgId) continue;

            selectedBgIds.add(bgId);
        }

        const rows = [...selectedBgIds].map(id => {
            const feature = (blockGroupGeojson.features || []).find(
                f => String(f.properties?.JOINKEY12) === String(id)
            );

            const p = feature?.properties || {};
            const income = Number(p.income_median);

            return { id, name: id, income };
        });

        const validIncomes = rows
            .map(r => r.income)
            .filter(v => Number.isFinite(v) && v > 0);

        const avgIncome = validIncomes.length
            ? Math.round(validIncomes.reduce((sum, v) => sum + v, 0) / validIncomes.length)
            : 0;

        content.innerHTML = `
            <div style="margin-bottom:6px; padding:8px 10px; background:#f3f4f6; border:1px solid #d1d5db; border-radius:6px; font-weight:600;">
                Average Median Household Income: $${avgIncome.toLocaleString()}
            </div>

            <div style="margin-bottom:10px; font-size:13px; color:#555;">
                Data from U.S. Census Bureau, ACS 5-Year Estimates 2024
            </div>

            <table style="border-collapse:collapse;width:100%">
                <thead>
                    <tr>
                        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Median Household Income</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(({ id, name, income }) => `
                        <tr data-id="${id}">
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${formatBgId(name)}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                                ${Number.isFinite(income) && income > 0
                                    ? `$${income.toLocaleString()}`
                                    : '(NULL)'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div style="margin-top:10px; font-size:13px; color:#555;">
                (NULL) means there was not enough valid household income data for that block group
            </div>
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

    const rows = [...selectedIds].map(id => {
        const feature = (blockGroupGeojson.features || []).find(
            f => String(f.properties?.JOINKEY12) === String(id)
        );

        const p = feature?.properties || {};
        const name = idToName.get(id) || id;
        const income = Number(p.income_median);

        return { id, name, income };
    });

    const validIncomes = rows
        .map(r => r.income)
        .filter(v => Number.isFinite(v) && v > 0);

    const avgIncome = validIncomes.length
        ? Math.round(validIncomes.reduce((sum, v) => sum + v, 0) / validIncomes.length)
        : 0;

    content.innerHTML = `
        <div style="margin-bottom:6px; padding:8px 10px; background:#f3f4f6; border:1px solid #d1d5db; border-radius:6px; font-weight:600;">
            Average Median Household Income: $${avgIncome.toLocaleString()}
        </div>

        <div style="margin-bottom:10px; font-size:13px; color:#555;">
            Data from U.S. Census Bureau, ACS 5-Year Estimates
        </div>

        <table style="border-collapse:collapse;width:100%">
            <thead>
                <tr>
                    <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                    <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Median Household Income</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(({ id, name, income }) => `
                    <tr data-id="${id}">
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${formatBgId(name)}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                            ${Number.isFinite(income) && income > 0
                                ? `$${income.toLocaleString()}`
                                : '(NULL)'}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <div style="margin-top:10px; font-size:13px; color:#555;">
            (NULL) means there was not enough valid household income data for that block group
        </div>
    `;

    box.style.display = 'block';
    pinnedTableId = null;
    hoveredTableId = null;
    attachDataRowInteractions();
    updateTableAndMapHighlight();
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
            <div style="margin-bottom:10px; font-size:13px; color:#555;">
                Data from U.S. Census Bureau, 2024
            </div>
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
            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">
            ${totalHousing.toLocaleString()}
            </td>
            <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">
            ${totalHousing ? (totalPopulation / totalHousing).toFixed(2) : '—'}
            </td>
            </tr>
            ${Object.entries(byBg).map(([bg, v]) => `
            <tr data-id="${bg}">
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">
                ${formatBgId(bg)}
            </td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                ${v.housing.toLocaleString()}
            </td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                ${v.housing ? (v.pop / v.housing).toFixed(2) : '—'}
            </td>
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
//Builds the neighborhood box from the population attached at the block level
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
            <div style="margin-bottom:10px; font-size:13px; color:#555;">
                Data from U.S. Census Bureau, 2024
            </div>
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
    pinnedTableId = null;
    hoveredTableId = null;
    attachDataRowInteractions();
    updateTableAndMapHighlight();
}
// Builds and displays the food source legend in the data box
function buildFoodBox(){
    const box = document.getElementById('data-box')
    const content = document.getElementById('data-box-content')
    content.innerHTML = 
    `<div style="margin-top:12px">
        <div style="font-weight:600; margin-bottom:6px">Food Sources</div>
        <div style="display:grid; grid-template-columns:auto 1fr; gap:6px 10px; font-size:13px">

            <span style="width:12px; height:12px; background:#383fc5; border-radius:50%"></span>
            <span>Food Pantries</span>

            <span style="width:12px; height:12px; background:#1d7918; border-radius:50%"></span>
            <span>Community / Extra Gardens</span>

            <span style="width:12px; height:12px; background:#90de4c; border-radius:50%"></span>
            <span>Farmers Markets & Gardens</span>

            <span style="width:12px; height:12px; background:#b939c8; border-radius:50%"></span>
            <span>Large Grocery Stores & Supermarkets</span>

            <span style="width:12px; height:12px; background:#e92b2b; border-radius:50%"></span>
            <span>Pharmacies & Dollar Stores</span>

            <span style="width:12px; height:12px; background:#ec840d; border-radius:50%"></span>
            <span>Restaurants</span>

            <span style="width:12px; height:12px; background:#5d9ee7; border-radius:50%"></span>
            <span>Schools, Churches & Community Centers</span>

            <span style="width:12px; height:12px; background:#e5e239; border-radius:50%"></span>
            <span>Small Grocery & Convenience Stores</span>
        </div>
    </div>
    <div style="margin-bottom:10px; font-size:13px; color:#555;">
        Data from Grace Densham, Landscape Architecture Department, Michigan State University
    </div>`
    box.style.display = 'block'
}
// Builds and displays the health source legend in the data box
function buildHealthBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

    content.innerHTML = `
        <div style="margin-top:12px">
        <div style="font-weight:600; margin-bottom:6px">
            Health & Community Resources
        </div>

        <div style="display:grid; grid-template-columns:auto 1fr; gap:6px 10px; font-size:13px">
            <span style="width:12px; height:12px; background:#9eee3c; border-radius:50%"></span>
            <span>Libraries</span>

            <span style="width:12px; height:12px; background:#166534; border-radius:50%"></span>
            <span>Parks</span>

            <span style="width:12px; height:12px; background:#1756b3; border-radius:50%"></span>
            <span>Recreational Centers</span>

            <span style="width:12px; height:12px; background:#d8991d; border-radius:50%"></span>
            <span>Soup Kitchens</span>

            <span style="width:12px; height:12px; background:#e00303; border-radius:50%"></span>
            <span>Hospitals & Clinics</span>
        </div>
        </div>

        <p style="margin-top:10px; font-size:13px; color:#555">
        Health-related points are displayed in the region based on criteria
        from the Healthy City Assessment project by Frank Luginbill,
        Noah Mueller, Jun Han, and Amman Thasin pulled by Google Maps API, 2026.
        </p>
    `;
    box.style.display = 'block';
}
// Builds a placeholder data box for filters that are not yet implemented, nice for future works
function buildPlaceholderBox(label){
    const box = document.getElementById('data-box')
    const content = document.getElementById('data-box-content')
    content.innerHTML = `<h4>${label}</h4><p>Data coming soon.</p>`
    box.style.display = 'block'
}
// Initializes the neighborhood state, drops all other block groups and highlights those included in neighborhoods.
function selectAllNeighborhoods() {
    selectionModeBG = 'neighborhood';

    selectedIds.clear();
    selectedNeighborhoods.clear();
    activeId = null;
    hoveredNeighborhoodName = null;
    pinnedNeighborhoodName = null;

    map.setLayoutProperty('bg-fill', 'visibility', 'none');
    map.setLayoutProperty('bg-outline', 'visibility', 'none');
    map.setLayoutProperty('default-selected-fill', 'visibility', 'visible');
    map.setLayoutProperty('active-bg-highlight', 'visibility', 'visible');
    map.setLayoutProperty('neighborhood-base-fill', 'visibility', 'visible');
    map.setLayoutProperty('block-deselected', 'visibility', 'none');
    map.setPaintProperty('default-selected-fill', 'fill-color', '#3b82f6');
    map.setPaintProperty('default-selected-fill', 'fill-opacity', 0.65);

    syncNeighborhoodBaseFill();
    syncSelectedFill();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

    renderSelectedList();
    updateShowDataButton();

    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent =
        'Click a light blue neighborhood block group to select its neighborhood(s).';
}
// Enters a fresh neighborhood state, this is so you can be at any level or on any button and clicking this sends you to default neighborhoods
async function enterNeighborhoodModeFresh() {
    activeId = null;
    hoveredTableId = null;
    pinnedTableId = null;
    hoveredNeighborhoodName = null;
    pinnedNeighborhoodName = null;
    hoveredBlockId = null;
    pinnedBlockId = null;

    selectedIds.clear();
    selectedNeighborhoods.clear();
    selectedBlockIds.clear();
    deselectedBlockIds.clear();
    lastSubmittedIds = [];

    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    map.setFilter('neighborhood-base-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('block-selected', ['in', ['get', 'GEOID20'], ['literal', []]]);
    map.setFilter('block-deselected', ['in', ['get', 'GEOID20'], ['literal', []]]);
    map.setFilter('active-block-highlight', ['==', ['get', 'GEOID20'], '___none___']);

    if (map.getSource('blocks')) {
        map.getSource('blocks').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    clearRadiusCircle();
    document.getElementById('data-box').style.display = 'none';

    selectionModeBG = 'block';
    await setSelectionMode(SelectionMode.BG_SELECT);

    selectAllNeighborhoods();
}
//Like the neighborhood fresh function, this allows you to be on any level and selecting Radius will always take you to default radius mode
async function enterRadiusModeFresh() {
    activeId = null;
    hoveredTableId = null;
    pinnedTableId = null;
    hoveredNeighborhoodName = null;
    pinnedNeighborhoodName = null;
    hoveredBlockId = null;
    pinnedBlockId = null;

    selectedIds.clear();
    selectedNeighborhoods.clear();
    selectedBlockIds.clear();
    deselectedBlockIds.clear();
    lastSubmittedIds = [];

    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    map.setFilter('neighborhood-base-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('block-selected', ['in', ['get', 'GEOID20'], ['literal', []]]);
    map.setFilter('block-deselected', ['in', ['get', 'GEOID20'], ['literal', []]]);
    map.setFilter('active-block-highlight', ['==', ['get', 'GEOID20'], '___none___']);

    if (map.getSource('blocks')) {
        map.getSource('blocks').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    clearRadiusCircle();
    document.getElementById('data-box').style.display = 'none';

    selectionModeBG = 'block';
    await setSelectionMode(SelectionMode.BG_SELECT);

    document.getElementById('details').textContent =
        'Radius mode: click anywhere on the map to select block groups within the radius.';
}
// Allows clean exit from neighborhood while restoring default block group selection logic
function exitNeighborhoodMode() {
    selectionModeBG = 'block';

    selectedIds.clear();
    selectedNeighborhoods.clear();
    selectedBlockIds.clear();
    deselectedBlockIds.clear();

    activeId = null;
    hoveredNeighborhoodName = null;
    pinnedNeighborhoodName = null;
    hoveredBlockId = null;
    pinnedBlockId = null;

    map.setLayoutProperty('bg-fill', 'visibility', 'visible');
    map.setLayoutProperty('bg-outline', 'visibility', 'visible');
    map.setLayoutProperty('default-selected-fill', 'visibility', 'visible');
    map.setLayoutProperty('active-bg-highlight', 'visibility', 'visible');
    map.setLayoutProperty('neighborhood-base-fill', 'visibility', 'none');
    map.setLayoutProperty('block-fill', 'visibility', 'none');
    map.setLayoutProperty('block-outline', 'visibility', 'none');
    map.setLayoutProperty('block-selected', 'visibility', 'none');
    map.setLayoutProperty('block-selected-outline', 'visibility', 'none');
    map.setLayoutProperty('block-deselected', 'visibility', 'none');
    map.setLayoutProperty('active-block-highlight', 'visibility', 'none');

    clearNeighborhoodBaseFill();
    syncSelectedFill();

    map.setFilter('block-selected', ['in', ['get', 'GEOID20'], ['literal', []]]);
    map.setFilter('block-deselected', ['in', ['get', 'GEOID20'], ['literal', []]]);
    map.setFilter('active-block-highlight', ['==', ['get', 'GEOID20'], '___none___']);

    if (map.getSource('blocks')) {
        map.getSource('blocks').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    renderSelectedList();
    updateShowDataButton();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent = 'Click a polygon to view details.';
}
// Highlights all block groups associated with a given neighborhood name
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
// Updates the highlight so the previous highlight will disappear when a new one is selected
function updateNeighborhoodHighlight() {
    const name = hoveredNeighborhoodName || pinnedNeighborhoodName || null;
    highlightNeighborhood(name);
}
//Selection logic for neighborhood block groups.
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
    updateNeighborhoodHighlight();

    renderSelectedList();
    updateShowDataButton();

    document.getElementById('details').textContent =
        `${selectedNeighborhoods.size} neighborhood(s) selected.`;
}
// How to highlight the neighborhoods in the data box to show on the map
function highlightNeighborhoodRow(name) {
    const rows = document.querySelectorAll('#data-box tbody tr[data-name]');

    rows.forEach(tr => {
        if (tr.getAttribute('data-name') === String(name)) {
            tr.style.background = '#fde68a';
        } else {
            tr.style.background = '';
        }
    });
}

//creates and updates highlights for table and map for table hover
function updateTableAndMapHighlight() {
    const id = pinnedTableId || hoveredTableId || null;

    if (selectionMode === SelectionMode.LOCKED) {
        if (id) {
            map.setFilter('active-block-highlight', [
                'all',
                ['==', ['get', 'JOINKEY12'], String(id)],
                ['in', ['get', 'GEOID20'], ['literal', [...selectedBlockIds]]]
            ]);
            highlightDataRow(id);
        } else {
            map.setFilter('active-block-highlight', [
                '==',
                ['get', 'GEOID20'],
                '___none___'
            ]);

            const rows = document.querySelectorAll('#data-box tbody tr');
            rows.forEach(tr => tr.classList.remove('row-active'));
        }
        return;
    }

    if (id) {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', String(id)]);
        highlightDataRow(id);
    } else {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

        const rows = document.querySelectorAll('#data-box tbody tr');
        rows.forEach(tr => tr.classList.remove('row-active'));
    }
}
//Combines table highlighting with highlighting the said block groups on the map
function updateNeighborhoodTableAndMapHighlight() {
    const name = pinnedNeighborhoodName || hoveredNeighborhoodName || null;

    if (name) {
        highlightNeighborhood(name);
        highlightNeighborhoodRow(name);
    } else {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

        const rows = document.querySelectorAll('#data-box tbody tr[data-name]');
        rows.forEach(tr => {
            tr.style.background = '';
        });
    }
}
//Pulls the population for each block group corresponding with the neighborhoods
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

//garden layer visibility helper function
function setCommunityGardensVisible(flag) {
    const v = flag ? 'visible' : 'none';

    if (flag) {
        filterCommunityGardensToSelectedBlocks();
    }

    if (map.getLayer('community-gardens-fill')) {
        map.setLayoutProperty('community-gardens-fill', 'visibility', v);
        map.setLayoutProperty('community-gardens-outline', 'visibility', v);
    }
}

//food source points visibility helper function
function setFoodSourcesVisible(flag) {
    Object.keys(foodSources.sources).forEach(id => {
        if (!map.getLayer(`${id}-points`)) return;

        map.setLayoutProperty(
        `${id}-points`,
        'visibility',
        flag ? 'visible' : 'none'
        );
    });

    if (flag) {
        filterFoodPointsToSelectedBlocks();
    }
}

//health source points visibility helper function
function setHealthSourcesVisible(flag) {
    Object.keys(healthSources.sources).forEach(id => {
        if (!map.getLayer(`${id}-points`)) return;

        map.setLayoutProperty(
        `${id}-points`,
        'visibility',
        flag ? 'visible' : 'none'
        );
    });

    if (flag) {
        filterHealthPointsToSelectedBlocks();
    }
}

//hyperlink highlight for data
function highlightDataRow(id) {
    const rows = document.querySelectorAll('#data-box tbody tr');

    rows.forEach(tr => {
        if (tr.getAttribute('data-id') === String(id)) {
            tr.style.background = '#fde68a';
        } else {
            tr.style.background = '';
        }
    });
}

//SWL default selection reset
async function resetToSouthwestLansing() {
    const ids = await fetchRequestedBgs();
    exitNeighborhoodMode();
    //console.log('reset ids:', ids);
    //uncheck checkboxes for neighborhood and radius
    const checkboxes = document.querySelectorAll('.display-checkbox');
    checkboxes.forEach((checkbox) => {
        checkbox.checked = false;
    });

    selectedIds.clear();
    activeId = null;

    ids.forEach(id => selectedIds.add(String(id)));

    syncSelectedFill();
    renderSelectedList();
    updateShowDataButton();

    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    clearRadiusCircle();
    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent = 'Click a polygon to view details.';
    updateDisplayMethodUI();
}

//status set helper function
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

//selection text update function
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

//block highlight updater for on click on hover
function updateLockedBlockHighlight() {
    const id = pinnedBlockId || hoveredBlockId || '___none___';

    map.setFilter('active-block-highlight', [
        '==',
        ['get', 'GEOID20'],
        String(id)
    ]);
}

//selection mode helper, controls what is visible and what updates for each selection mode
async function setSelectionMode(mode) {
    selectionMode = mode
    syncSelectionModeUI()
    syncSelectionHeader()

    if (mode === SelectionMode.BG_SELECT) {
        closeAllPopups();
        setCommunityGardensVisible(false);
        setFoodSourcesVisible(false);
        setHealthSourcesVisible(false);
        document.getElementById('neighborhoods-display').disabled = false;
        document.getElementById('radius-display').disabled = false;
        document.getElementById('reset-swl').disabled = false;
        map.setLayoutProperty('bg-fill', 'visibility', 'visible')
        map.setLayoutProperty('bg-outline', 'visibility', 'visible')
        map.setLayoutProperty('default-selected-fill', 'visibility', 'visible')
        map.setLayoutProperty('active-bg-highlight', 'visibility', 'visible')
        map.setLayoutProperty('block-fill', 'visibility', 'none')
        map.setLayoutProperty('block-outline', 'visibility', 'none')
        map.setLayoutProperty('block-selected', 'visibility', 'none')
        map.setLayoutProperty('block-selected-outline', 'visibility', 'none')
        map.setLayoutProperty('active-block-highlight', 'visibility', 'none');
        map.setLayoutProperty('block-deselected', 'visibility', 'none');
        hoveredBlockId = null;
        pinnedBlockId = null;
        map.setFilter('active-block-highlight', ['==', ['get', 'GEOID20'], '___none___']);
        selectedBlockIds.clear()
        syncSelectedFill();
        updateShowDataButton()
        return
    }

    if (mode === SelectionMode.BLOCK_SELECT) {
        closeAllPopups();
        setCommunityGardensVisible(false);
        setFoodSourcesVisible(false);
        setHealthSourcesVisible(false);
        document.getElementById('neighborhoods-display').disabled = false;
        document.getElementById('radius-display').disabled = false;
        document.getElementById('reset-swl').disabled = false;
        //checks if blocks have been loaded before to prevent wipe when going from locked back to block select
        if (selectedBlockIds.size === 0) {
            let blocks;
    
            // if we came from neighborhood mode, only load the SELECTED neighborhood BGs
            if (selectionModeBG === 'neighborhood') {
                blocks = await loadBlocksForSelectedBgs();
    
                selectedBlockIds.clear();
                deselectedBlockIds.clear();
    
                for (const f of blocks.features ?? []) {
                    const id = String(f.properties?.GEOID20);
                    if (id) selectedBlockIds.add(id);
                }
            } else {
                blocks = await loadBlocksForSelectedBgs();
    
                selectedBlockIds.clear();
                deselectedBlockIds.clear();
    
                for (const f of blocks.features ?? []) {
                    const id = String(f.properties?.GEOID20);
                    if (id) selectedBlockIds.add(id);
                }
            }
        }
    
        // turn off all BG / neighborhood visuals
        map.setLayoutProperty('bg-fill', 'visibility', 'none');
        map.setLayoutProperty('bg-outline', 'visibility', 'none');
        map.setLayoutProperty('default-selected-fill', 'visibility', 'none');
        map.setLayoutProperty('active-bg-highlight', 'visibility', 'none');
        map.setLayoutProperty('neighborhood-base-fill', 'visibility', 'none');
    
        // clear old blue filters so nothing lingers underneath
        map.setFilter('default-selected-fill', [
            'in',
            ['get', 'JOINKEY12'],
            ['literal', []]
        ]);
        map.setFilter('neighborhood-base-fill', [
            'in',
            ['get', 'JOINKEY12'],
            ['literal', []]
        ]);
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    
        // turn on block editing layers
        map.setLayoutProperty('block-fill', 'visibility', 'visible');
        map.setLayoutProperty('block-outline', 'visibility', 'visible');
        map.setLayoutProperty('block-selected', 'visibility', 'visible');
        map.setLayoutProperty('block-selected-outline', 'visibility', 'visible');
        map.setLayoutProperty('block-deselected', 'visibility', 'visible');
        map.setLayoutProperty('active-block-highlight', 'visibility', 'none');
    
        // selected blocks = dark orange
        map.setPaintProperty('block-selected', 'fill-color', '#ea580c');
        map.setPaintProperty('block-selected', 'fill-opacity', 0.65);
    
        hoveredBlockId = null;
        pinnedBlockId = null;
        map.setFilter('active-block-highlight', ['==', ['get', 'GEOID20'], '___none___']);
    
        map.setFilter('block-selected', [
            'in',
            ['get', 'GEOID20'],
            ['literal', [...selectedBlockIds]]
        ]);
    
        map.setFilter('block-deselected', [
            'in',
            ['get', 'GEOID20'],
            ['literal', [...deselectedBlockIds]]
        ]);
    
        updateShowDataButton();
        return;
    }
    
    if (mode === SelectionMode.LOCKED) {
        setCommunityGardensVisible(false);
        setFoodSourcesVisible(false);
        setHealthSourcesVisible(false);
        syncBlockSelectedFill()
        filterFoodPointsToSelectedBlocks();
        filterCommunityGardensToSelectedBlocks();
        clearRadiusCircle();

        document.getElementById('neighborhoods-display').disabled = true;
        document.getElementById('radius-display').disabled = true;
        document.getElementById('reset-swl').disabled = true;

        map.setLayoutProperty('bg-fill', 'visibility', 'none');
        map.setLayoutProperty('bg-outline', 'visibility', 'none');
        map.setLayoutProperty('default-selected-fill', 'visibility', 'none');
        map.setLayoutProperty('active-bg-highlight', 'visibility', 'none');
    
        map.setLayoutProperty('block-fill', 'visibility', 'none');
        map.setLayoutProperty('block-outline', 'visibility', 'none');
        map.setLayoutProperty('block-selected', 'visibility', 'visible');
        map.setLayoutProperty('block-selected-outline', 'visibility', 'visible');
        map.setLayoutProperty('block-deselected', 'visibility', 'none');
        map.setLayoutProperty('active-block-highlight', 'visibility', 'visible');
        map.setLayoutProperty('neighborhood-base-fill', 'visibility', 'none');
        map.setPaintProperty('block-selected', 'fill-color', '#22c55e');
        map.setPaintProperty('block-selected', 'fill-opacity', 0.55);
        
        map.setFilter('block-selected', [
            'in',
            ['get', 'GEOID20'],
            ['literal', [...selectedBlockIds]]
        ]);
    
        hoveredTableId = null;
        pinnedTableId = null;
        map.setFilter('active-block-highlight', ['==', ['get', 'JOINKEY12'], '___none___']);
    
        updateShowDataButton();
        return;
    }
}

//block level filtering
function getSelectedBlockPolygons() {
    const src = map.getSource('blocks')?._data;
    if (!src) return [];

    return (src.features ?? []).filter(f =>
        selectedBlockIds.has(String(f.properties?.GEOID20))
    );
}

//filters down food points to block selection
function filterFoodPointsToSelectedBlocks() {
    const blockPolys = getSelectedBlockPolygons();

    for (const [id, original] of Object.entries(foodSources.sources)) {
        if (!map.getSource(id)) continue;

        if (!blockPolys.length) {
        map.getSource(id).setData({
            type: 'FeatureCollection',
            name: original.name,
            features: []
        });
        continue;
        }

        const filtered = [];

        for (const pt of original.features ?? []) {
        for (const poly of blockPolys) {
            try {
            if (turf.booleanPointInPolygon(pt, poly)) {
                filtered.push(pt);
                break;
            }
            } catch (_) {}
        }
        }

        map.getSource(id).setData({
        type: 'FeatureCollection',
        name: original.name,
        features: filtered
        });
    }
}

//filters down community gardens to block selection
function filterCommunityGardensToSelectedBlocks() {
    const src = map.getSource('community-gardens');
    if (!src || !communityGardensOriginal) return;

    const blockPolys = getSelectedBlockPolygons();

    if (!blockPolys.length) {
        src.setData({
        type: 'FeatureCollection',
        features: []
        });
        return;
    }

    const filtered = [];

    for (const garden of communityGardensOriginal.features) {
        if (!garden.geometry) continue;

        for (const block of blockPolys) {
        try {
            if (turf.booleanIntersects(garden, block)) {
            filtered.push(garden);
            break;
            }
        } catch (err) {
            console.warn('Intersection failed', err);
        }
        }
    }

    src.setData({
        type: 'FeatureCollection',
        features: filtered
    });
    
    console.log(
    'Filtering gardens:',
    communityGardensOriginal?.features?.length,
    'blocks:',
    getSelectedBlockPolygons().length
    );
}

//filters health points down to block selection
function filterHealthPointsToSelectedBlocks() {
    const blockPolys = getSelectedBlockPolygons();

    for (const [id, original] of Object.entries(healthSources.sources)) {
        const src = map.getSource(id);
        if (!src) continue;

        if (!blockPolys.length) {
        src.setData({
            type: 'FeatureCollection',
            name: original.name,
            features: []
        });
        continue;
        }

        const filtered = [];

        for (const pt of original.features ?? []) {
        for (const poly of blockPolys) {
            try {
            if (turf.booleanPointInPolygon(pt, poly)) {
                filtered.push(pt);
                break;
            }
            } catch (_) {}
        }
        }

        src.setData({
        type: 'FeatureCollection',
        name: original.name,
        features: filtered
        });
    }
}
// MAP CLICK AND HOVER EVENTS
map.on('click', 'neighborhood-base-fill', e => {
    if (selectionMode !== SelectionMode.BG_SELECT) return;
    if (selectionModeBG !== 'neighborhood') return;
    if (!e.features?.length) return;
    const f = e.features[0];
    const id = String(f.id ?? f.properties?.JOINKEY12 ?? '');
    if (!id) return;

    const neighborhoodIds = new Set(
        Object.values(neighborhoodToBgs).flat().map(String)
    );

    if (neighborhoodIds.has(id)) {
        selectNeighborhoodsFromBg(id);
    }
});
map.on('mouseenter', 'neighborhood-base-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'neighborhood-base-fill', () => {
    map.getCanvas().style.cursor = '';
});
map.on('mousemove', 'block-selected', e => {
    if (selectionMode !== SelectionMode.LOCKED) return;
    if (!e.features?.length) return;

    hoveredBlockId = String(e.features[0].properties.GEOID20);
    updateLockedBlockHighlight();
});

map.on('mouseleave', 'block-selected', () => {
    if (selectionMode !== SelectionMode.LOCKED) return;

    hoveredBlockId = null;
    updateLockedBlockHighlight();
});

map.on('click', 'block-selected', e => {
    if (selectionMode !== SelectionMode.LOCKED) return;
    if (!e.features?.length) return;

    pinnedBlockId = String(e.features[0].properties.GEOID20);
    hoveredBlockId = null;
    updateLockedBlockHighlight();
});
//MAP LOADING SECTION
map.on('load', async () => {
    setLoading(true);
    try {
        let data = await joinAcsToBgs(populationACS, arcgisBlockGroups);
        try {
            data = await joinRaceToBgs(data);
            console.log('Race loaded');
        } catch (err) {
            console.error('Race failed:', err);
        }
        
        try {
            data = await joinIncomeToBgs(data);
            console.log('Income join loaded successfully');
        } catch (err) {
            console.error('Income join failed:', err);
        }
        try {
            data = await joinHouseholdToBgs(data);
            console.log('Household join loaded successfully');
        } catch (err) {
            console.error('Household join failed:', err);
        }
        
        //data sources
        blockGroupGeojson = data;
        map.addSource('arcgis-layer',{type:'geojson',data,promoteId:'JOINKEY12'})
        map.addSource('radius-circle', {type: 'geojson',data: {type: 'FeatureCollection',features: []}});
        map.addSource('blocks', {type: 'geojson',data: {type: 'FeatureCollection',features: []}});
        communityGardensOriginal = await fetch(communityGardens).then(r => r.json());   
        map.addSource('community-gardens', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        //map layers
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
            'fill-color': '#93c5fd',
            'fill-opacity': 0.55
        },
        layout: { visibility: 'none' },
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
            id: 'block-selected-outline',
            type: 'line',
            source: 'blocks',
            paint: {
                'line-color': '#c2410c',
                'line-width': 0.5
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
            id: 'active-block-highlight',
            type: 'fill',
            source: 'blocks',
            paint: {
                'fill-color': '#fde68a',
                'fill-opacity': 0.6
            },
            layout: { visibility: 'none' },
            filter: ['==', ['get', 'GEOID20'], '___none___']
        });
        map.addLayer({
            id: 'block-deselected',
            type: 'fill',
            source: 'blocks',
            paint: {
                'fill-color': LIGHT_ORANGE,
                'fill-opacity': 0.35
            },
            filter: ['==', ['get', 'GEOID20'], '___none___']
        });

        //food sources
        await loadFoodGeojson({
            id: 'food-pantry',
            path: 'static/data/food_sources/food_pantries.geojson',
            color: '#383fc5'
        });

        await loadFoodGeojson({
            id: 'extra-gardens',
            path: 'static/data/food_sources/extra_gardens.geojson',
            color: '#1d7918'
        });

        await loadFoodGeojson({
            id: 'gardens-farmermarkets',
            path: 'static/data/food_sources/gardens_farmermarkets.geojson',
            color: '#90de4c'
        });

        await loadFoodGeojson({
            id: 'large-grocery',
            path: 'static/data/food_sources/large_grocery_and_supermarkets.geojson',
            color: '#b939c8'
        });

        await loadFoodGeojson({
            id: 'pharmacy-dollarstore',
            path: 'static/data/food_sources/pharmacy_dollar_store.geojson',
            color: '#e92b2b'
        });

        await loadFoodGeojson({
            id: 'restaurants',
            path: 'static/data/food_sources/restaurants.geojson',
            color: '#ec840d'
        });

        await loadFoodGeojson({
            id: 'schools-churches',
            path: 'static/data/food_sources/schools_churches_communitycenters.geojson',
            color: '#5d9ee7'
        });

        await loadFoodGeojson({
            id: 'small-grocery',
            path: 'static/data/food_sources/small_grocery_convenience_store.geojson',
            color: '#e5e239'
        });

        //health sources
        await loadHealthGeojson({
            id: 'libraries',
            path: 'static/data/health_points/Libraries.geojson',
            color: '#9eee3c'
        })

        await loadHealthGeojson({
            id: 'parks',
            path: 'static/data/health_points/Parks.geojson',
            color: '#166534'
        })

        await loadHealthGeojson({
            id: 'rec-centers',
            path: 'static/data/health_points/Recreational Centers.geojson',
            color: '#1756b3'
        })

        await loadHealthGeojson({
            id: 'soup-kitchens',
            path: 'static/data/health_points/Soup Kitchens.geojson',
            color: '#d8991d'
        })

        await loadHealthGeojson({
            id: 'hospitals',
            path: 'static/data/health_points/Hospitals and Clinics.geojson',
            color: '#e00303'
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

        //hover and click functionality
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
            if (getDisplayMode() === 'radius') return;
        
            const f = e.features[0];
            const id = String(f.id ?? f.properties?.JOINKEY12 ?? '');
            if (!id) return;
        
            if (selectionModeBG === 'neighborhood') {
                const neighborhoodIds = new Set(
                    Object.values(neighborhoodToBgs).flat().map(String)
                );
        
                if (neighborhoodIds.has(id)) {
                    selectNeighborhoodsFromBg(id);
                }
                return;
            }
        
            if (selectionMode === SelectionMode.BG_SELECT || selectionMode === SelectionMode.BLOCK_SELECT) {
                toggleSelection(id);
                highlightActive(id);
                updateShowDataButton();
            }
        });
        map.on('click', e => {
            if (selectionMode === SelectionMode.LOCKED || selectionMode === SelectionMode.BLOCK_SELECT) return;
            if (getDisplayMode() !== 'radius') return;
        
            const radiusInput = document.getElementById('radius-input');
            const radiusMiles = Number(radiusInput?.value || 1);
        
            if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
                alert('Please enter a valid radius greater than 0.');
                return;
            }
        
            selectBlockGroupsByRadius(e.lngLat, radiusMiles);
        });

        //block on-click
        map.on('click', 'block-fill', e => {
            if (selectionMode !== SelectionMode.BLOCK_SELECT) return;
            if (!e.features?.length) return;
        
            const id = String(e.features[0].properties.GEOID20);
        
            if (selectedBlockIds.has(id)) {
                selectedBlockIds.delete(id);
                deselectedBlockIds.add(id);
            } else {
                selectedBlockIds.add(id);
                deselectedBlockIds.delete(id);
            }
        
            map.setFilter('block-selected', [
                'in',
                ['get', 'GEOID20'],
                ['literal', [...selectedBlockIds]]
            ]);
        
            map.setFilter('block-deselected', [
                'in',
                ['get', 'GEOID20'],
                ['literal', [...deselectedBlockIds]]
            ]);
        });

        map.on('mousemove', 'block-selected', e => {
            if (selectionMode !== SelectionMode.LOCKED) return;
            if (!e.features?.length) return;

            const p = e.features[0].properties ?? {};
            const label = formatBlockId(p.GEOID20);

            map.getCanvas().style.cursor = 'pointer';

            setBlockHoverBox(`
                <div style="font-weight:600;margin-bottom:4px">Block ID</div>
                <div>${label}</div>
            `);
        });

        map.on('mouseleave', 'block-selected', () => {
            map.getCanvas().style.cursor = '';
            setBlockHoverBox(null);
        });

        //gardens on-click
        map.on('click', 'community-gardens-fill', e => {
            if (selectionMode !== SelectionMode.LOCKED) return;
            if (getActiveFilter() !== 'food-filter') return;
            if (!e.features?.length) return;

            const p = e.features[0].properties ?? {};

            const pick = (...vals) => {
                for (const v of vals) {
                if (typeof v === 'string' && v.trim().length) {
                    return v.trim();
                }
                }
                return null;
            };

            const name =
                pick(
                p.CNVYNAME,
                p.OWNERNME1,
                p.OWNERNME2,
                p.OWNERNAME,
                p.PARCELNO,
                p.PARCELNUM
                ) || 'Community Garden';

            const composedAddress = [
                typeof p.ADD_NUM === 'string' && p.ADD_NUM.trim(),
                typeof p.STREET === 'string' && p.STREET.trim(),
                typeof p.CITY === 'string' && p.CITY.trim(),
                typeof p.STATE === 'string' && p.STATE.trim(),
                typeof p.ZIP_CODE === 'string' && p.ZIP_CODE.trim()
            ].filter(Boolean).join(' ');

            const address =
                pick(
                p.SITEADDRES,
                composedAddress
                ) || 'Address not available';

            gardenPopup
                .setLngLat(e.lngLat)
                .setHTML(`
                <div style="font:13px/1.4 sans-serif">
                    <div style="font-weight:600">${name}</div>
                    <div style="margin-top:4px">${address}</div>
                </div>
                `)
                .addTo(map);
        });

        map.on('mouseenter', 'community-gardens-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'community-gardens-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        //food source point on click
        Object.keys(foodSources.sources).forEach(id => {
            map.on('click', `${id}-points`, e => {
                if (selectionMode !== SelectionMode.LOCKED) return;
                if (getActiveFilter() !== 'food-filter') return;
                if (!e.features?.length) return;

                const f = e.features[0];
                const p = f.properties ?? {};

                const name = p.Name ?? 'Unnamed Location';
                const desc = p.description ?? 'No description available';
                const category = p._category || 'Uncategorized';

                foodPopup
                    .setLngLat(e.lngLat)
                    .setHTML(`
                    <div style="font:13px/1.4 sans-serif">
                        <div style="font-weight:600">${name}</div>
                        <div style="color:#555;margin:2px 0"><em>${category}</em></div>
                        <div>${desc}</div>
                    </div>
                    `)
                    .addTo(map);
            })

            map.on('mouseenter', `${id}-points`, () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', `${id}-points`, () => {
                map.getCanvas().style.cursor = '';
            });
        })

        //health points on-click
        Object.keys(healthSources.sources).forEach(id => {
            map.on('click', `${id}-points`, e => {
                if (selectionMode !== SelectionMode.LOCKED) return;
                if (getActiveFilter() !== 'health-filter') return;
                if (!e.features?.length) return;

                const p = e.features[0].properties ?? {};

                const name =
                typeof p.Name === 'string' && p.Name.trim()
                    ? p.Name.trim()
                    : 'Health Resource';

                const desc =
                typeof p.description === 'string' && p.description.trim()
                    ? p.description.trim()
                    : 'No description available';

                const category = p._category || 'Health';

                foodPopup
                .setLngLat(e.lngLat)
                .setHTML(`
                    <div style="font:13px/1.4 sans-serif">
                    <div style="font-weight:600">${name}</div>
                    <div style="color:#555;margin:2px 0"><em>${category}</em></div>
                    <div>${desc}</div>
                    </div>
                `)
                .addTo(map);
            });
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
    if (selectionMode === SelectionMode.LOCKED) {
        setSelectionMode(SelectionMode.BLOCK_SELECT);
        return;
    } else if (selectionMode === SelectionMode.BLOCK_SELECT) {
        setSelectionMode(SelectionMode.BG_SELECT);
        return
    } else {
        // Step 2: neighborhood mode clear behavior
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

    // Step 3: normal block mode clear behavior
    map.setFilter('default-selected-fill', ['in', ['get', 'JOINKEY12'], ['literal', []]]);
    map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);
    clearRadiusCircle();
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
        if (!selectedIds.size) return
        setSelectionMode(SelectionMode.BLOCK_SELECT)
        return
    }

    if (selectionMode === SelectionMode.BLOCK_SELECT) {
        if (!selectedBlockIds.size) return
        setSelectionMode(SelectionMode.LOCKED)
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

//filters checkboxes listener
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

    // If we're in neighborhood mode, rebuild selectedNeighborhoods
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
        document.getElementById('details').textContent =
            'Neighborhood selection restored.';
    } else {
        document.getElementById('details').textContent =
            'Click a polygon to view details.';
    }
});

document.getElementById('show-data-btn').addEventListener('click', () => {
    setCommunityGardensVisible(false);
    setFoodSourcesVisible(false);
    setHealthSourcesVisible(false);
    const f = getActiveFilter();
    if (!f) return;

    if (selectionMode === 'neighborhood') {
        if (f === 'population-filter') {
            buildNeighborhoodTable({
                subtitle: 'Population data',
                columns: [
                    {
                        key: 'csv_B01003_001E',
                        label: 'Population',
                        method: 'sum',
                        format: v => Number.isFinite(v) ? Math.round(v).toLocaleString() : '(NULL)'
                    }
                ]
            });
        } else if (f === 'income-filter') {
            buildNeighborhoodTable({
                subtitle: 'Data from U.S. Census Bureau, ACS 5-Year Estimates',
                columns: [
                    {
                        key: 'income_median',
                        label: 'Median Household Income',
                        method: 'avg',
                        format: v => Number.isFinite(v) && v > 0 ? `$${Math.round(v).toLocaleString()}` : '(NULL)'
                    }
                ],
                summary: rows => {
                    const vals = rows.map(r => r.income_median).filter(v => Number.isFinite(v) && v > 0);
                    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
                    return `
                        <div style="margin-bottom:6px; padding:8px 10px; background:#f3f4f6; border:1px solid #d1d5db; border-radius:6px; font-weight:600;">
                            Average Median Household Income: $${avg.toLocaleString()}
                        </div>
                    `;
                }
            });
        } else if (f === 'housesize-filter') {
            buildNeighborhoodTable({
                subtitle: 'Data from U.S. Census Bureau, ACS 5-Year Estimates',
                columns: [
                    {
                        key: 'household_total',
                        label: 'Total',
                        method: 'avg',
                        format: v => Number.isFinite(v) ? v.toFixed(2) : '(NULL)'
                    },
                    {
                        key: 'household_owner',
                        label: 'Owned',
                        method: 'avg',
                        format: v => Number.isFinite(v) ? v.toFixed(2) : '(NULL)'
                    },
                    {
                        key: 'household_renter',
                        label: 'Rented',
                        method: 'avg',
                        format: v => Number.isFinite(v) ? v.toFixed(2) : '(NULL)'
                    }
                ]
            });
        } else if (f === 'race-filter') {
            buildNeighborhoodTable({
                subtitle: 'Race data acquired from 2020 Census',
                columns: [
                    { key: 'race_total', label: 'Total', method: 'sum', format: v => Number.isFinite(v) ? Math.round(v).toLocaleString() : '(NULL)' },
                    { key: 'race_white', label: 'White', method: 'sum', format: v => Number.isFinite(v) ? Math.round(v).toLocaleString() : '(NULL)' },
                    { key: 'race_black', label: 'Black', method: 'sum', format: v => Number.isFinite(v) ? Math.round(v).toLocaleString() : '(NULL)' },
                    { key: 'race_asian', label: 'Asian', method: 'sum', format: v => Number.isFinite(v) ? Math.round(v).toLocaleString() : '(NULL)' },
                    {
                        label: 'Other',
                        method: 'sum',
                        compute: p =>
                            (Number(p.race_native) || 0) +
                            (Number(p.race_pacific) || 0) +
                            (Number(p.race_other) || 0) +
                            (Number(p.race_two_plus) || 0),
                        format: v => Number.isFinite(v) ? Math.round(v).toLocaleString() : '(NULL)'
                    }
                ]
            });
        }
        return;
    }

    if (f === 'population-filter') buildPopulationBox();
    else if (f === 'race-filter') buildRaceBox();
    else if (f === 'income-filter') buildIncomeBox();
    else if (f === 'housesize-filter') buildHouseholdBox();
    else if (f === 'health-filter') {
        setHealthSourcesVisible(true);
        buildHealthBox();
    } else if (f === 'food-filter') {
        setCommunityGardensVisible(true);
        setFoodSourcesVisible(true);
        buildFoodBox();
    } else {
        buildPlaceholderBox(filterLabels[f]);
    }
});

document.getElementById('close-data-box').addEventListener('click', () => {
    document.getElementById('data-box').style.display = 'none';
});

//drawer constants
const drawerToggle = document.getElementById('drawer-toggle');
const drawerPanel = document.getElementById('drawer-panel');
const filtersDrawerToggle = document.getElementById('filters-drawer-toggle');
const filtersDrawerPanel = document.getElementById('filters-drawer-panel');
const demoDrawerToggle = document.getElementById('demo-drawer-toggle');
const demoDrawerPanel = document.getElementById('demo-drawer-panel');

//clean close of all drawers
function closeAllDrawers() {
    drawerPanel.classList.remove('open');
    drawerToggle.classList.remove('open');

    filtersDrawerPanel.classList.remove('open');
    filtersDrawerToggle.classList.remove('open');

    demoDrawerPanel.classList.remove('open');
    demoDrawerToggle.classList.remove('open');
}

//cleanly closes drawers to open new one if one is already open
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

//drawer listeners
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
//selection mode checkboxes listener
displayCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
        if (cb.checked) {
            displayCheckboxes.forEach(other => {
                if (other !== cb) {
                    other.checked = false;
                }
            });

            // leaving neighborhood mode when switching away from it
            if (cb.id !== 'neighborhoods-display' && selectionModeBG === 'neighborhood') {
                exitNeighborhoodMode();
            }

            // clear radius circle when switching away from radius
            if (cb.id !== 'radius-display') {
                clearRadiusCircle();
            }
        }

        updateDisplayMethodUI();
    });
});

const radiusCheckbox = document.getElementById('radius-display');
const blockCheckbox = document.getElementById('block-display');

if (radiusCheckbox) {
    radiusCheckbox.addEventListener('change', async () => {
        if (radiusCheckbox.checked) {
            await enterRadiusModeFresh();
        } else {
            clearRadiusCircle();
            document.getElementById('details').textContent = 'Click a polygon to view details.';
        }

        updateDisplayMethodUI();
    });
}

if (blockCheckbox) {
    blockCheckbox.addEventListener('change', () => {
        clearRadiusCircle();
        updateDisplayMethodUI();
    });
}
const neighborhoodsCheckbox = document.getElementById('neighborhoods-display');

if (neighborhoodsCheckbox) {
    neighborhoodsCheckbox.addEventListener('change', async () => {
        if (neighborhoodsCheckbox.checked) {
            await enterNeighborhoodModeFresh(); // 🔥 THIS is the fix
        } else {
            exitNeighborhoodMode();
        }

        clearRadiusCircle();
        updateDisplayMethodUI();
    });
}
updateDisplayMethodUI();

//SWL reset button listener
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
            closeAllPopups();
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
            document.getElementById('data-box').style.display = 'none';
            updateShowDataButton();
        });
    }
});