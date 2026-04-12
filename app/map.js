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
let lastSubmittedIds = [];
let selectionModeBG = 'block'; // 'block' or 'neighborhood'
const selectedNeighborhoods = new Set();
let blockGroupGeojson = null;
let lastRadiusCircle = null;

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
async function joinRaceToBgs(bgGeojson) {
    const raceRows = await fetchRaceRows();

    function findRaceRow(possibleLabels) {
        return raceRows.find(row => {
            const label = String(row['Label (Grouping)'] || '').toLowerCase().trim();
            return possibleLabels.some(term => label.includes(term));
        });
    }

    const totalRow = findRaceRow(['total:']);
    const whiteRow = findRaceRow(['white alone']);
    const blackRow = findRaceRow(['black or african american alone', 'black alone']);
    const nativeRow = findRaceRow(['american indian and alaska native alone']);
    const asianRow = findRaceRow(['asian alone']);
    const pacificRow = findRaceRow(['native hawaiian and other pacific islander alone']);
    const otherRow = findRaceRow(['some other race alone']);
    const twoPlusRow = findRaceRow(['two or more races']);

    if (!totalRow) {
        console.error('Could not find Total row in race_data.csv');
        return bgGeojson;
    }

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

        const tractNum =
            `${parseInt(tract6.slice(0, 4), 10)}.${tract6.slice(4)}`.replace(/\.00$/, '');

        const estimateCol =
            `Block Group ${bg}; Census Tract ${tractNum}; ${countyName} County; Michigan!!Estimate`;

        p.race_total = Number(String(totalRow?.[estimateCol] ?? '').replace(/,/g, '')) || 0;
        p.race_white = Number(String(whiteRow?.[estimateCol] ?? '').replace(/,/g, '')) || 0;
        p.race_black = Number(String(blackRow?.[estimateCol] ?? '').replace(/,/g, '')) || 0;
        p.race_native = Number(String(nativeRow?.[estimateCol] ?? '').replace(/,/g, '')) || 0;
        p.race_asian = Number(String(asianRow?.[estimateCol] ?? '').replace(/,/g, '')) || 0;
        p.race_pacific = Number(String(pacificRow?.[estimateCol] ?? '').replace(/,/g, '')) || 0;
        p.race_other = Number(String(otherRow?.[estimateCol] ?? '').replace(/,/g, '')) || 0;
        p.race_two_plus = Number(String(twoPlusRow?.[estimateCol] ?? '').replace(/,/g, '')) || 0;
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
        .map(s => key12FromBgGEOID(s))
        .filter(Boolean);
}
async function fetchRaceRows() {
    return await fetchCsvRows('static/data/race_data.csv');
    if (!res.ok) throw new Error('Could not load race_data.json');
    const raw = await res.json();

    const headers = raw[0];
    return raw.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i];
        });
        return obj;
    });
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

        //console.log(joinKey, estimateCol, rawIncome, p.income_median);
    }

    return bgGeojson;
}
async function joinHouseholdToBgs(bgGeojson) {
    const householdRows = await fetchCsvRows('static/data/household_ownership_data.csv');

    function getLabel(row) {
        return String(row['Label'] || row['Label (Grouping)'] || '').trim().toLowerCase();
    }

    function findRow(matchers) {
        return householdRows.find(row => {
            const label = getLabel(row);
            return matchers.some(m => label.includes(m));
        });
    }

    const totalRow = findRow(['total']);
    const ownerRow = findRow(['owner occupied', 'owner-occupied']);
    const renterRow = findRow(['renter occupied', 'renter-occupied']);

    if (!totalRow || !ownerRow || !renterRow) {
        console.error('Could not find one or more required household rows');
        return bgGeojson;
    }

    for (const f of (bgGeojson.features || [])) {
        const p = f.properties || {};

        const bgName = String(p.NAME || '').trim();  
        if (!bgName) continue;

        const tractPart = bgName.slice(0, -1);
        const bgPart = bgName.slice(-1);

        const tractNum = tractPart.length > 2
            ? `${tractPart.slice(0, tractPart.length - 2)}.${tractPart.slice(-2)}`
            : tractPart;

        const estimateCol =
            `Block Group ${bgPart}; Census Tract ${tractNum}; Ingham County; Michigan!!Estimate`;

        const rawTotal = totalRow[estimateCol];
        const rawOwner = ownerRow[estimateCol];
        const rawRenter = renterRow[estimateCol];

        //console.log('HOUSEHOLD LOOKUP', bgName, estimateCol, rawTotal, rawOwner, rawRenter);

        p.household_total = rawTotal !== undefined && rawTotal !== ''
            ? Number(String(rawTotal).replace(/,/g, ''))
            : null;

        p.household_owner = rawOwner !== undefined && rawOwner !== ''
            ? Number(String(rawOwner).replace(/,/g, ''))
            : null;

        p.household_renter = rawRenter !== undefined && rawRenter !== ''
            ? Number(String(rawRenter).replace(/,/g, ''))
            : null;
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

//renders selected id list
function renderSelectedList() {
    const list = document.getElementById('selected-list');

    if (selectionModeBG === 'neighborhood') {
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
            highlightDataRow(id);
        };
    });
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
        Data from 2020 Census
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
    selectionModeBG = 'neighborhood';

    selectedIds.clear();
    selectedNeighborhoods.clear();
    activeId = null;

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
    //console.log('reset ids:', ids);

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
        let data = await joinAcsToBgs(populationACS, arcgisBlockGroups);
        data = await joinRaceToBgs(data);
        
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
        map.addSource('radius-circle', {type: 'geojson',data: {type: 'FeatureCollection',features: []}});
        map.addSource('blocks', {type: 'geojson',data: {type: 'FeatureCollection',features: []}});

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
            if (selectionMode === SelectionMode.LOCKED) return;
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
document.getElementById('clear-selection').addEventListener('click', () => {
    // Step 1: if selection is locked, clicking should ONLY unlock editing
    if (selectionMode === SelectionMode.LOCKED) {
        selectionMode = SelectionMode.BG_SELECT;
        syncSelectionModeUI();
        updateShowDataButton();
        return;
    }

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
    const f = getActiveFilter();
    if (!f) return;

    if (f === 'population-filter') {
        if (selectionModeBG === 'neighborhood') {
            buildNeighborhoodPopulationBox();
        } else {
            buildPopulationBox();
        }
    } else if (f === 'race-filter') {
        buildRaceBox();
    } else if (f === 'income-filter') {
        buildIncomeBox();
    } else if (f === 'food-filter') {
        setCommunityGardensVisible(true);
        buildPlaceholderBox(filterLabels[f]);
    } else if (f === 'housesize-filter') {
        buildHouseholdBox();
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