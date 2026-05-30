// app.js - Nexus CRM Pro
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCE8uHbyUCrZKdBOqGRf5OKx2TqMX-z0VJRZ1YQoS4-5szkZ31fJbc6diA2ydxhQdVBn2h0G1hT1hn/pub?gid=2040705075&single=true&output=csv';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxlE_a4It3IueNJuWDACwCVdh-AgNMIgH6RsmVdsQ5e2rNhf4MUdPzYtiRz_FECnrRw/exec';

// Variables Globales
let map;
let markersLayer;
let heatLayer;
let chartFuentes;
let chartEstados;
let globalData = [];
let clusterIndex = null;
let currentSuperclusterMarkers = [];
let geojsonLayer;
let inventarioGlobal = [];
let barriosPolygons = null;

// Coordenadas base (Simuladas para CABA)
const barrioCoords = {
    'palermo': [-34.588, -58.430], 'belgrano': [-34.562, -58.456], 'recoleta': [-34.589, -58.397],
    'caballito': [-34.618, -58.437], 'urquiza': [-34.573, -58.481], 'nuñez': [-34.545, -58.465],
    'almagro': [-34.609, -58.422], 'flores': [-34.629, -58.463], 'centro': [-34.603, -58.381]
};

document.addEventListener('DOMContentLoaded', () => {
    // Inicializar Mapa
    map = L.map('map').setView([-34.6037, -58.3816], 12);
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: '© Google', maxZoom: 19
    }).addTo(map);

    // Inicializar Supercluster
    clusterIndex = new Supercluster({
        radius: 60,
        maxZoom: 16
    });

    // Evento de zoom y paneo para Supercluster
    map.on('moveend', updateSupercluster);

    // Fetch GeoJSON de Barrios
    fetch('caba_barrios.geojson')
        .then(res => res.json())
        .then(data => {
            barriosPolygons = data;
        }).catch(err => console.log('Error GeoJSON:', err));

    // Fetch Inventario Masivo
    Papa.parse('inventario_unificado.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            inventarioGlobal = results.data;
            document.getElementById('map-total-results').innerText = `Mostrando ${inventarioGlobal.length.toLocaleString()} propiedades`;
            renderMassiveMap(inventarioGlobal);
        }
    });

    // Fetch y Parse del CSV de Matches
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            let parsed = results.data.filter(r => r.Asesor && r['Fecha Match']);
            
            parsed.forEach(r => {
                let s = parseInt(r.Score || 0);
                r._scoreNum = isNaN(s) ? 0 : s;
                let c = r.Precio ? r.Precio.replace(/\D/g, '') : '';
                r._precioNum = c ? parseInt(c) : 0;
                r._comisionPotencial = Math.round(r._precioNum * 0.03);
                r._barrioLower = (r.Barrio || '').toLowerCase();
                r._estadoNorm = 'Pendiente';
                if(r.Score > 80) r._estadoNorm = 'Contactado';
                if(r.Score > 95) r._estadoNorm = 'Cerrado';
                if(r.Score < 60) r._estadoNorm = 'Descartado';
            });

            globalData = parsed;
            document.getElementById('select-asesor').addEventListener('change', aplicarFiltro);
            document.getElementById('filter-barrio-base').addEventListener('change', aplicarFiltro);
            aplicarFiltro();
        }
    });
});

window.switchView = function(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hide'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    
    document.getElementById('view-' + viewName).classList.remove('hide');
    document.getElementById('nav-' + viewName).classList.add('active');
    
    let titles = { 'kanban': 'Pipeline (Kanban)', 'map': 'Intelligence Map', 'analytics': 'Analytics & Equipo' };
    document.getElementById('current-view-title').innerText = titles[viewName];

    if(viewName === 'map') {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

window.actualizarEstado = function(id, nuevoEstado, btnElement) {
    const card = btnElement.closest('.kanban-card');
    card.style.opacity = '0.5'; card.style.pointerEvents = 'none';

    fetch(SCRIPT_URL, {
        method: 'POST', mode: 'no-cors', cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, estado: nuevoEstado })
    }).then(() => {
        const obj = globalData.find(x => x.ID === id);
        if(obj) {
            obj.Estado = nuevoEstado;
            // Logic handled by re-parsing logic in production
        }
        aplicarFiltro();
    }).catch(() => {
        alert("Error de conexión. Intentá de nuevo.");
        card.style.opacity = '1'; card.style.pointerEvents = 'auto';
    });
};

function aplicarFiltro() {
    const asesorFiltro = document.getElementById('select-asesor').value;
    let filtered = globalData;
    if (asesorFiltro !== "Todos") {
        filtered = filtered.filter(r => (r.Asesor || '').includes(asesorFiltro));
    }
    renderKanban(filtered);
    renderAnalytics(filtered);
}

function renderKanban(data) {
    const cols = {
        'Pendiente': document.getElementById('col-pendientes'),
        'Contactado': document.getElementById('col-contactados'),
        'Cerrado': document.getElementById('col-cerrados'),
        'Descartado': document.getElementById('col-descartados')
    };
    
    for(let k in cols) cols[k].innerHTML = '';

    let pipelineActive = 0;
    let revenueGen = 0;
    let counts = { 'Pendiente': 0, 'Contactado': 0, 'Cerrado': 0, 'Descartado': 0 };

    data.forEach(m => {
        let st = m._estadoNorm;
        counts[st]++;
        if(st === 'Pendiente' || st === 'Contactado') pipelineActive += m._comisionPotencial;
        if(st === 'Cerrado') revenueGen += m._comisionPotencial;

        const card = document.createElement('div');
        card.className = "kanban-card bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow";
        card.innerHTML = `
            <div class="font-extrabold text-sm text-gray-900 mb-2">Lead ${m.ID}</div>
            <div class="text-[11px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full font-bold mb-2">USD ${m._comisionPotencial.toLocaleString()}</div>
            <div class="text-xs text-gray-500 capitalize">${m._barrioLower}</div>
        `;
        cols[st].appendChild(card);
    });

    document.getElementById('count-pendientes').innerText = counts['Pendiente'];
    document.getElementById('count-contactados').innerText = counts['Contactado'];
    document.getElementById('count-cerrados').innerText = counts['Cerrado'];
    document.getElementById('count-descartados').innerText = counts['Descartado'];
    document.getElementById('kpi-pipeline').innerText = 'USD ' + pipelineActive.toLocaleString('es-AR');
    document.getElementById('kpi-revenue').innerText = 'USD ' + revenueGen.toLocaleString('es-AR');
}

function renderMap(data) {
    // Legacy function, use renderMassiveMap
}

function limpiarFiltrosMapa() {
    document.getElementById('map-f-ubicacion').value = '';
    document.getElementById('map-f-operacion').value = '';
    document.getElementById('map-f-tipo').value = '';
    document.getElementById('map-f-origen').value = '';
    document.getElementById('map-f-pmin').value = '';
    document.getElementById('map-f-pmax').value = '';
    if(geojsonLayer) map.removeLayer(geojsonLayer);
    aplicarFiltrosMapa();
}

function aplicarFiltrosMapa() {
    const fUbicacion = document.getElementById('map-f-ubicacion').value.toLowerCase();
    const fOperacion = document.getElementById('map-f-operacion').value.toLowerCase();
    const fTipo = document.getElementById('map-f-tipo').value.toLowerCase();
    const fOrigen = document.getElementById('map-f-origen').value.toLowerCase();
    const pMin = parseFloat(document.getElementById('map-f-pmin').value) || 0;
    const pMax = parseFloat(document.getElementById('map-f-pmax').value) || Infinity;

    // 1. Filtrar Propiedades (Venta/Alquiler)
    let filtrados = [];
    if (fOperacion !== 'comprador') {
        filtrados = inventarioGlobal.filter(p => {
            const precio = parseFloat(p.precio) || 0;
            let match = true;
            if(fOperacion && !(p.tipo_operacion || '').toLowerCase().includes(fOperacion)) match = false;
            if(fTipo && !(p.tipo_propiedad || '').toLowerCase().includes(fTipo)) match = false;
            if(fOrigen && !(p.fuente || '').toLowerCase().includes(fOrigen)) match = false;
            if(precio < pMin || precio > pMax) match = false;
            if(fUbicacion) {
                const searchStr = `${p.calle || ''} ${p.barrio || ''} ${p.localidad || ''} ${p.partido || ''} ${p.zona || ''}`.toLowerCase();
                if(!searchStr.includes(fUbicacion)) match = false;
            }
            return match;
        });
    }

    // 2. Filtrar Compradores Únicos (Leads del Excel Matching)
    let leadsFiltrados = [];
    if (fOperacion === '' || fOperacion === 'comprador') {
        const uniqueBuyers = new Map();
        
        globalData.forEach(r => {
            const phone = r['Comprador - Asesor WA'] || '';
            const pres = r['Comprador - Presupuesto'] || r.Presupuesto || '';
            const zonas = r['Comprador - Zonas Buscadas'] || r['Zonas Buscadas'] || '';
            if (!phone && !zonas) return; 
            
            const key = phone + '_' + zonas;
            if (!uniqueBuyers.has(key)) {
                let mainZone = '';
                if (zonas) mainZone = zonas.split(',')[0].trim().toLowerCase();

                if (fUbicacion && !zonas.toLowerCase().includes(fUbicacion)) return;

                uniqueBuyers.set(key, {
                    phone: phone,
                    presupuesto: pres,
                    zonas: zonas,
                    mainZone: mainZone,
                    comisionMax: r._comisionPotencial || 0
                });
            } else {
                let existing = uniqueBuyers.get(key);
                if ((r._comisionPotencial || 0) > existing.comisionMax) {
                    existing.comisionMax = r._comisionPotencial;
                }
            }
        });

        leadsFiltrados = Array.from(uniqueBuyers.values());
    }

    document.getElementById('map-total-results').innerText = `${filtrados.length.toLocaleString()} prop. | ${leadsFiltrados.length} compradores`;
    
    // Cargar los datos en Supercluster y actualizar vista
    loadDataToSupercluster(filtrados, leadsFiltrados);
}

function loadDataToSupercluster(properties, leads) {
    const geojsonFeatures = [];
    
    // Convertir propiedades a GeoJSON
    properties.forEach(p => {
        let lat = -34.6037 + (Math.random() * 0.1 - 0.05);
        let lng = -58.3816 + (Math.random() * 0.1 - 0.05);
        const b = (p.barrio || '').toLowerCase();
        for (const [key, coords] of Object.entries(barrioCoords)) {
            if (b.includes(key)) {
                lat = coords[0] + (Math.random()*0.015 - 0.0075);
                lng = coords[1] + (Math.random()*0.015 - 0.0075);
                break;
            }
        }
        
        geojsonFeatures.push({
            type: "Feature",
            properties: { ...p, isLead: false, cluster: false },
            geometry: { type: "Point", coordinates: [lng, lat] }
        });
    });

    // Convertir leads a GeoJSON
    leads.forEach(l => {
        let lat = -34.6037 + (Math.random() * 0.1 - 0.05);
        let lng = -58.3816 + (Math.random() * 0.1 - 0.05);
        const b = l.mainZone;
        for (const [key, coords] of Object.entries(barrioCoords)) {
            if (b.includes(key)) {
                lat = coords[0] + (Math.random()*0.015 - 0.0075);
                lng = coords[1] + (Math.random()*0.015 - 0.0075);
                break;
            }
        }
        
        geojsonFeatures.push({
            type: "Feature",
            properties: { ...l, isLead: true, cluster: false },
            geometry: { type: "Point", coordinates: [lng, lat] }
        });
    });

    // Cargar en el motor
    clusterIndex.load(geojsonFeatures);
    
    // Forzar actualización visual
    updateSupercluster();
}

function updateSupercluster() {
    if (!clusterIndex) return;

    // Remover marcadores anteriores
    currentSuperclusterMarkers.forEach(m => map.removeLayer(m));
    currentSuperclusterMarkers = [];

    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const zoom = map.getZoom();

    const clusters = clusterIndex.getClusters(bbox, zoom);

    clusters.forEach(c => {
        const [lng, lat] = c.geometry.coordinates;
        const isCluster = c.properties.cluster;

        if (isCluster) {
            // Dibujar Burbuja Cluster
            const count = c.properties.point_count;
            const size = count < 100 ? 30 : count < 1000 ? 40 : 50;
            const color = count < 100 ? '#f59e0b' : count < 1000 ? '#ea580c' : '#c2410c'; // Yellow to Orange to Dark Orange
            
            const clusterIcon = L.divIcon({
                className: 'leaflet-div-icon',
                html: `<div style="background:${color}; color:white; width:${size}px; height:${size}px; display:flex; align-items:center; justify-content:center; border-radius:50%; font-weight:bold; font-size:12px; border:2px solid rgba(255,255,255,0.5); box-shadow:0 2px 5px rgba(0,0,0,0.3); transition:all 0.2s;">${count}</div>`,
                iconSize: [size, size],
                iconAnchor: [size/2, size/2]
            });
            
            const marker = L.marker([lat, lng], {icon: clusterIcon}).addTo(map);
            marker.on('click', () => {
                map.flyTo([lat, lng], zoom + 2);
            });
            currentSuperclusterMarkers.push(marker);

        } else {
            // Dibujar Marcador Individual
            const props = c.properties;
            if (props.isLead) {
                // LEAD (Comprador)
                const phoneDisplay = props.phone ? props.phone : 'Anónimo';
                const leadIcon = L.divIcon({
                    className: 'leaflet-div-icon',
                    html: `<div style="background:#10b981; color:white; font-weight:bold; font-size:10px; padding:3px 8px; border-radius:12px; border:2px solid white; box-shadow:0 4px 6px rgba(0,0,0,0.2); white-space:nowrap; transform: translate(-50%, -50%); display:flex; align-items:center; gap:4px; z-index: 1000;">👤 Lead ${phoneDisplay}</div>`,
                    iconSize: [0, 0], iconAnchor: [0, 0]
                });

                const leadTooltipHTML = `
                    <div class="map-tooltip-card">
                        <div style="background:#10b981; color:white; padding:10px 14px; font-weight:bold; font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">👤 Comprador Activo</div>
                        <div style="padding:14px;">
                            <div style="font-size:14px; font-weight:900; color:#1f2937; margin-bottom:4px;">Presupuesto: USD ${props.presupuesto}</div>
                            <div style="font-size:13px; color:#6b7280; font-weight:500; margin-bottom:10px;">Busca: ${props.zonas}</div>
                            <div style="font-size:11px; padding:4px 8px; background:#ecfdf5; color:#059669; border-radius:6px; display:inline-block; font-weight:bold; border:1px solid #d1fae5;">💰 Com. Potencial: USD ${props.comisionMax.toLocaleString()}</div>
                        </div>
                    </div>
                `;

                const marker = L.marker([lat, lng], {icon: leadIcon}).addTo(map);
                marker.bindTooltip(leadTooltipHTML, { direction: 'bottom', offset: [0, 10], opacity: 1 });
                currentSuperclusterMarkers.push(marker);

            } else {
                // PROPIEDAD (Venta/Alquiler)
                const precio = parseFloat(props.precio) || 0;
                let precioTxt = (precio/1000).toFixed(0) + 'K';
                if(precio > 1000000) precioTxt = (precio/1000000).toFixed(1) + 'M';

                const propIcon = L.divIcon({
                    className: 'leaflet-div-icon',
                    html: `<div style="background:#ed5f2b; color:white; font-family: sans-serif; font-weight:600; font-size:11px; padding:2px 6px; border-radius:12px; border:1px solid white; box-shadow:0 1px 3px rgba(0,0,0,0.2); white-space:nowrap; transform: translate(-50%, -50%); cursor:pointer; transition: transform 0.1s;">USD ${precioTxt}</div>`,
                    iconSize: [0, 0], iconAnchor: [0, 0]
                });

                const propTooltipHTML = `
                    <div class="map-tooltip-card">
                        <div style="background:#ed5f2b; color:white; padding:8px 12px; font-weight:bold; font-size:11px; text-transform:uppercase;">🏠 ${props.tipo_propiedad || 'Propiedad'} (${props.tipo_operacion || 'Venta'})</div>
                        <div style="padding:12px;">
                            <div style="font-size:16px; font-weight:900; color:#1f2937; margin-bottom:2px;">USD ${precio.toLocaleString()}</div>
                            <div style="font-size:12px; color:#6b7280; font-weight:500; margin-bottom:8px;">${props.Ambientes || '?'} amb • ${props.dormitorios || '?'} dorm • <span style="text-transform:capitalize;">${props.barrio}</span></div>
                            <div style="font-size:10px; padding:3px 6px; background:#f3f4f6; color:#4b5563; border-radius:4px; display:inline-block; font-weight:bold;">📍 ${props.fuente}</div>
                            <div style="font-size:10px; color:#ed5f2b; margin-top:8px; font-weight:bold;">Ver aviso original 👉</div>
                        </div>
                    </div>
                `;

                const marker = L.marker([lat, lng], {icon: propIcon}).addTo(map);
                marker.bindTooltip(propTooltipHTML, { direction: 'top', offset: [0, -10], opacity: 1 });
                marker.on('click', () => {
                    if(props.url && props.url !== 'nan' && props.url.startsWith('http')) window.open(props.url, '_blank');
                });
                currentSuperclusterMarkers.push(marker);
            }
        }
    });
}

function renderAnalytics(data) {
    const asesores = ['Joel', 'David', 'Vicente', 'Claudia'];
    let stats = {};
    asesores.forEach(a => stats[a] = { pipeline: 0, revenue: 0, wins: 0, total: 0 });

    data.forEach(m => {
        const ag = asesores.find(a => (m.Asesor || '').includes(a));
        if(ag) {
            stats[ag].total++;
            if(m._estadoNorm === 'Pendiente' || m._estadoNorm === 'Contactado') stats[ag].pipeline += m._comisionPotencial;
            if(m._estadoNorm === 'Cerrado') {
                stats[ag].revenue += m._comisionPotencial;
                stats[ag].wins++;
            }
        }
    });

    const lbContainer = document.getElementById('leaderboard-container');
    lbContainer.innerHTML = '';
    
    let sorted = Object.keys(stats).map(k => ({name: k, ...stats[k]})).sort((a,b) => b.revenue - a.revenue);
    
    sorted.forEach((s, idx) => {
        let isFirst = idx === 0;
        let rankColor = isFirst ? 'text-warning' : 'text-gray-400';
        let bgClass = isFirst ? 'bg-gradient-to-br from-white to-orange-50 border-orange-200' : 'bg-white border-gray-200';
        
        lbContainer.innerHTML += `
            <div class="${bgClass} border rounded-xl shadow-sm p-6 flex flex-col justify-between transform transition hover:-translate-y-1 hover:shadow-md">
                <div class="flex justify-between items-start mb-6">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center font-extrabold text-gray-800 text-lg shadow-inner">${s.name.charAt(0)}</div>
                        <span class="font-extrabold text-gray-900 text-lg">${s.name}</span>
                    </div>
                    <span class="font-black text-2xl ${rankColor}">#${idx+1}</span>
                </div>
                <div class="space-y-3">
                    <div class="flex justify-between text-sm items-center">
                        <span class="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Revenue</span>
                        <span class="text-success font-black text-lg">$${s.revenue.toLocaleString()}</span>
                    </div>
                    <div class="flex justify-between text-sm items-center">
                        <span class="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Pipeline</span>
                        <span class="text-gray-700 font-bold">$${s.pipeline.toLocaleString()}</span>
                    </div>
                    <div class="flex justify-between text-sm items-center">
                        <span class="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Efectividad</span>
                        <span class="text-primary font-black bg-primary/10 px-2 py-0.5 rounded-full text-xs">${s.total > 0 ? Math.round((s.wins/s.total)*100) : 0}%</span>
                    </div>
                </div>
            </div>
        `;
    });

    let fb = 0, ml = 0, zp = 0;
    let counts = { 'Pendiente': 0, 'Contactado': 0, 'Cerrado': 0, 'Descartado': 0 };
    data.forEach(m => {
        const f = (m.Fuente || "").toLowerCase();
        if (f.includes('facebook')) fb++; else if (f.includes('mercado')) ml++; else zp++;
        counts[m._estadoNorm]++;
    });

    if (chartFuentes) chartFuentes.destroy();
    chartFuentes = new Chart(document.getElementById('chart-fuentes').getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['ZonaProp', 'MercadoLibre', 'Facebook'], datasets: [{ data: [zp, ml, fb], backgroundColor: ['#6422b9', '#f59e0b', '#3b82f6'], borderColor: '#ffffff', borderWidth: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#4b5563', font: {family: 'Inter', weight: 'bold'} } } } }
    });

    if (chartEstados) chartEstados.destroy();
    chartEstados = new Chart(document.getElementById('chart-estados').getContext('2d'), {
        type: 'bar',
        data: { 
            labels: ['Nuevos', 'En Gestión', 'Ganados', 'Perdidos'], 
            datasets: [{ label: 'Leads', data: [counts['Pendiente'], counts['Contactado'], counts['Cerrado'], counts['Descartado']], backgroundColor: ['#6422b9', '#f59e0b', '#10b981', '#9ca3af'], borderRadius: 6 }] 
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { display: false }, x: { grid: { display: false }, ticks: { color: '#6b7280', font: {family: 'Inter', weight: 'bold'} } } }, plugins: { legend: { display: false } } }
    });
}
