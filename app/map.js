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
let blockGroupGeojson = null;
let lastRadiusCircle = null;
let pinnedTableId = null;
let hoveredTableId = null;
let hoveredNeighborhoodName = null;
let pinnedNeighborhoodName = null;

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
    'housesize-filter': 'Household Ownership',
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
async function fetchRaceRows() {
    const rows = await fetchCsvRows('static/data/race_data.csv');
    const out = {};

    rows.forEach(row => {
        const key = String(row.geoid || row.GEOID || row.GEO_ID || '').replace(/\D/g, '').slice(-12);
        if (!key) return;

        out[key] = {
            race_total: row.race_total,
            race_white: row.race_white,
            race_black: row.race_black,
            race_native: row.race_native,
            race_asian: row.race_asian,
            race_pacific: row.race_pacific,
            race_other: row.race_other,
            race_two_plus: row.race_two_plus
        };
    });

    return out;
}
async function fetchIncomeRows() {
    const rows = await fetchCsvRows('static/data/income_data.csv');
    const out = {};

    rows.forEach(row => {
        const key = String(row.geoid || row.GEOID || row.GEO_ID || '').replace(/\D/g, '').slice(-12);
        if (!key) return;

        out[key] = {
            income_median: row.income_median
        };
    });

    return out;
}
async function fetchHouseholdRows() {
    const rows = await fetchCsvRows('static/data/household_ownership_data.csv');
    const out = {};

    rows.forEach(row => {
        const key = String(row.geoid || row.GEOID || row.GEO_ID || '').replace(/\D/g, '').slice(-12);
        if (!key) return;

        out[key] = {
            household_total: row.household_total,
            household_owner: row.household_owner,
            household_renter: row.household_renter
        };
    });

    return out;
}
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

        console.log(joinKey, estimateCol, rawIncome, p.income_median);
    }

    return bgGeojson;
}

   
async function joinHouseholdToBgs(bgGeojson) {
    const householdRows = await fetchCsvRows('static/data/household_ownership_data.csv');

    console.log('Household labels:',
        householdRows.map(r => r['Label (Grouping)']).filter(Boolean)
    );

    const totalRow = householdRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('average household size') &&
               label.includes('occupied housing units') &&
               !label.includes('owner-occupied') &&
               !label.includes('renter-occupied');
    });

    const ownerRow = householdRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('average household size') &&
               label.includes('owner-occupied');
    });

    const renterRow = householdRows.find(row => {
        const label = String(row['Label (Grouping)'] || '').toLowerCase();
        return label.includes('average household size') &&
               label.includes('renter-occupied');
    });

    console.log('Matched household rows:', {
        total: totalRow?.['Label (Grouping)'],
        owner: ownerRow?.['Label (Grouping)'],
        renter: renterRow?.['Label (Grouping)']
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

        const numOrNull = row => {
            const raw = String(row?.[estimateCol] ?? '').replace(/,/g, '').trim();
            if (!raw || raw === '(X)' || raw === 'N' || raw === '-') return null;
            const val = Number(raw);
            return Number.isFinite(val) ? val : null;
        };

        p.household_total = numOrNull(totalRow);
        p.household_owner = numOrNull(ownerRow);
        p.household_renter = numOrNull(renterRow);
    }

    return bgGeojson;
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
function getNeighborhoodFeatures(name) {
    const ids = (neighborhoodToBgs[name] || []).map(String);

    return (blockGroupGeojson.features || []).filter(
        f => ids.includes(String(f.properties?.JOINKEY12))
    );
}

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
    const s = String(name);
    if (!s.length) return { tract: s, bg: s };
    return { tract: s.slice(0, -1), bg: s.slice(-1) };
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
//renders selected id list
function renderSelectedList() {
    const list = document.getElementById('selected-list');

    if (selectionMode === 'neighborhood') {
        list.innerHTML = '';
        return;
    }

    if (!selectedIds.size) {
        list.innerHTML = '';
        return;
    }
}
function getDisplayMode() {
    if (document.getElementById('radius-display')?.checked) return 'radius';
    if (document.getElementById('neighborhoods-display')?.checked) return 'neighborhoods';
    if (document.getElementById('zipcodes-display')?.checked) return 'zipcodes';
    if (document.getElementById('block-display')?.checked) return 'block';
    return 'swl';
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
            details.textContent = 'Radius mode: click anywhere on the map to select block groups within the radius.';
        } else if (mode === 'neighborhoods') {
            details.textContent = 'Neighborhood mode: click a white neighborhood to select its block groups.';
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
function key12FromGeoName(name) {
    const s = String(name ?? '').trim();

    const bgMatch = s.match(/Block Group\s+(\d+)/i);
    const tractMatch = s.match(/Census Tract\s+([\d.]+)/i);
    const countyMatch = s.match(/(Ingham|Eaton|Clinton)\s+County/i);

    if (!bgMatch || !tractMatch || !countyMatch) return null;

    const bg = bgMatch[1];
    const tractRaw = tractMatch[1].replace('.', '');
    const tract = tractRaw.padStart(6, '0');

    const countyName = countyMatch[1].toLowerCase();
    const countyCodeMap = {
        ingham: '065',
        eaton: '045',
        clinton: '037'
    };

    const county = countyCodeMap[countyName];
    if (!county) return null;

    return `26${county}${tract}${bg}`;
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
            id,
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
    ` + rows.map(({ id, name, total }) => `
        <tr data-id="${id}">
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
    pinnedTableId = null;
    hoveredTableId = null;
    attachDataRowInteractions();
    updateTableAndMapHighlight();
}
function buildRaceBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

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
            asian: Number(p.race_asian) || 0,
            other:
                (Number(p.race_native) || 0) +
                (Number(p.race_other) || 0) +
                (Number(p.race_two_plus) || 0)
        };
    });

    const totals = rows.reduce(
        (acc, r) => {
            acc.total += r.total;
            acc.white += r.white;
            acc.black += r.black;
            acc.asian += r.asian;
            acc.other += r.other;
            return acc;
        },
        {
            total: 0,
            white: 0,
            black: 0,
            asian: 0,
            other: 0
        }
    );

    content.innerHTML = `
        <div style="margin-bottom:10px; font-size:13px; color:#555;">
            Race data acquired from 2020 Census
        </div>

        <div style="overflow-x:auto;">
            <table style="border-collapse:collapse;width:100%; min-width:800px;">
                <thead>
                    <tr>
                        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Total</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">White</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Black</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Asian</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Other</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="font-weight:bold;background:#f3f4f6;">
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;">Group Total</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.total.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.white.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.black.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.asian.toLocaleString()}</td>
                        <td style="padding:6px 8px;border-bottom:2px solid #ccc;text-align:right;">${totals.other.toLocaleString()}</td>
                    </tr>

                    ${rows.map(r => `
                        <tr data-id="${r.id}">
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${r.name}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.total.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.white.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.black.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.asian.toLocaleString()}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${r.other.toLocaleString()}</td>
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
function buildIncomeBox() {
    const box = document.getElementById('data-box');
    const content = document.getElementById('data-box-content');

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
        const income = Number(p.income_median)

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
                    <td style="padding:6px 8px;border-bottom:1px solid #eee;">${name}</td>
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
            total: p.household_total,
            owner: p.household_owner,
            renter: p.household_renter
        };
    });

    const validTotals = rows.map(r => r.total).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    const validOwners = rows.map(r => r.owner).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    const validRenters = rows.map(r => r.renter).filter(v => v !== null && v !== undefined && !Number.isNaN(v));

    const avgTotal = validTotals.length
        ? (validTotals.reduce((a, b) => a + b, 0) / validTotals.length).toFixed(2)
        : '0.00';

    const avgOwner = validOwners.length
        ? (validOwners.reduce((a, b) => a + b, 0) / validOwners.length).toFixed(2)
        : '0.00';

    const avgRenter = validRenters.length
        ? (validRenters.reduce((a, b) => a + b, 0) / validRenters.length).toFixed(2)
        : '0.00';

    content.innerHTML = `
        <div style="margin-bottom:10px; font-size:13px; color:#555;">
            Average people per owned and rented household<br>
            Data from U.S. Census Bureau, ACS 5-Year Estimates
        </div>

        <div style="margin-bottom:8px; padding:8px 10px; background:#f3f4f6; border:1px solid #d1d5db; border-radius:6px;">
            <strong>Group Averages</strong><br>
            Total: ${avgTotal} &nbsp; | &nbsp; Owned: ${avgOwner} &nbsp; | &nbsp; Rented: ${avgRenter}
        </div>

        <div style="overflow-x:auto;">
            <table style="border-collapse:collapse;width:100%; min-width:700px;">
                <thead>
                    <tr>
                        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;">Block Group</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Total</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Owned</th>
                        <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;">Rented</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr data-id="${r.id}">
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${r.name}</td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                                ${r.total !== null && r.total !== undefined ? Number(r.total).toFixed(2) : '(NULL)'}
                            </td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                                ${r.owner !== null && r.owner !== undefined ? Number(r.owner).toFixed(2) : '(NULL)'}
                            </td>
                            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                                ${r.renter !== null && r.renter !== undefined ? Number(r.renter).toFixed(2) : '(NULL)'}
                            </td>
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
    pinnedTableId = null;
    hoveredTableId = null;
    attachDataRowInteractions();
    updateTableAndMapHighlight();
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
function updateNeighborhoodHighlight() {
    const name = hoveredNeighborhoodName || pinnedNeighborhoodName || null;
    highlightNeighborhood(name);
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
    updateNeighborhoodHighlight();

    renderSelectedList();
    updateShowDataButton();

    document.getElementById('details').textContent =
        `${selectedNeighborhoods.size} neighborhood(s) selected.`;
}
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
function updateTableAndMapHighlight() {
    const id = pinnedTableId || hoveredTableId || null;

    if (id) {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', String(id)]);
        highlightDataRow(id);
    } else {
        map.setFilter('active-bg-highlight', ['==', 'JOINKEY12', '___none___']);

        const rows = document.querySelectorAll('#data-box tbody tr');
        rows.forEach(tr => tr.classList.remove('row-active'));
    }
}

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
        if (tr.getAttribute('data-id') === String(id)) {
            tr.style.background = '#fde68a';
        } else {
            tr.style.background = '';
        }
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
    clearRadiusCircle();
    document.getElementById('data-box').style.display = 'none';
    document.getElementById('details').textContent = 'Click a polygon to view details.';
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
        
        blockGroupGeojson = data;
        map.addSource('arcgis-layer',{type:'geojson',data,promoteId:'JOINKEY12'})
        map.addSource('community-gardens', {type: 'geojson', data: communityGardens})
        map.addSource('radius-circle', {type: 'geojson',data: {type: 'FeatureCollection',features: []}
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
            if (getDisplayMode() === 'radius') return;
        
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
    clearRadiusCircle();
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
                if (other !== cb) {
                    other.checked = false;
                }
            });

            // leaving neighborhood mode when switching away from it
            if (cb.id !== 'neighborhoods-display' && selectionMode === 'neighborhood') {
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
const zipcodesCheckbox = document.getElementById('zipcodes-display');
const blockCheckbox = document.getElementById('block-display');

if (radiusCheckbox) {
    radiusCheckbox.addEventListener('change', () => {
        updateDisplayMethodUI();
        if (!radiusCheckbox.checked) {
            clearRadiusCircle();
        }
    });
}

if (zipcodesCheckbox) {
    zipcodesCheckbox.addEventListener('change', () => {
        clearRadiusCircle();
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
updateDisplayMethodUI();
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