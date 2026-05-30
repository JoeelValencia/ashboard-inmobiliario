// app.js - Nexus CRM Pro
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCE8uHbyUCrZKdBOqGRf5OKx2TqMX-z0VJRZ1YQoS4-5szkZ31fJbc6diA2ydxhQdVBn2h0G1hT1hn/pub?gid=2040705075&single=true&output=csv';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxlE_a4It3IueNJuWDACwCVdh-AgNMIgH6RsmVdsQ5e2rNhf4MUdPzYtiRz_FECnrRw/exec';

let globalData = [];
let map;
let heatLayer;
let markersLayer;
let chartFuentes, chartEstados;

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

    // Fetch y Parse del CSV
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        complete: function(results) {
            let data = results.data;
            if(data && data.length > 0) {
                globalData = data.map(row => {
                    const cleanRow = {};
                    for(let key in row) {
                        const cleanKey = key.replace(/\n/g, '').replace(/\s+/g, ' ').trim();
                        cleanRow[cleanKey] = row[key];
                    }
                    let precioStr = cleanRow['Precio Publicado'] || cleanRow['Precio'] || '0';
                    let precioNum = parseInt(precioStr.replace(/\D/g, '')) || 0;
                    cleanRow._precioNum = precioNum;
                    cleanRow._comisionPotencial = precioNum * 0.06;
                    cleanRow._barrioLower = (cleanRow['Barrio / Zona'] || cleanRow['Barrio/Zona'] || cleanRow['Barrio'] || '').toLowerCase();
                    // Normalizar Estado
                    let st = (cleanRow.Estado || "Pendiente").trim();
                    if(st.toLowerCase().includes("cerrado") || st.toLowerCase().includes("ganado")) cleanRow._estadoNorm = "Cerrado";
                    else if(st.toLowerCase().includes("descartado") || st.includes("❌")) cleanRow._estadoNorm = "Descartado";
                    else if(st.toLowerCase().includes("contactado") || st.includes("✅")) cleanRow._estadoNorm = "Contactado";
                    else cleanRow._estadoNorm = "Pendiente";
                    
                    return cleanRow;
                }).filter(r => r.ID && r.ID.trim() !== '');

                renderAll();
            }
        }
    });

    document.getElementById('select-asesor').addEventListener('change', renderAll);
    document.getElementById('filter-barrio-base').addEventListener('change', renderAll);
});

// View Routing
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
        // Optimistic UI update
        const obj = globalData.find(x => x.ID === id);
        if(obj) {
            obj.Estado = nuevoEstado;
            if(nuevoEstado.includes("Cerrado")) obj._estadoNorm = "Cerrado";
            else if(nuevoEstado.includes("Descartado")) obj._estadoNorm = "Descartado";
            else if(nuevoEstado.includes("Contactado")) obj._estadoNorm = "Contactado";
            else obj._estadoNorm = "Pendiente";
        }
        renderAll();
    }).catch(() => {
        alert("Error de conexión. Intentá de nuevo.");
        card.style.opacity = '1'; card.style.pointerEvents = 'auto';
    });
};

function renderAll() {
    const asesorFiltro = document.getElementById('select-asesor').value;
    const barrioFiltro = document.getElementById('filter-barrio-base').value;

    // 1. Filter Data
    let filtered = globalData;
    if (asesorFiltro !== "Todos") {
        filtered = filtered.filter(r => (r.Asesor || '').includes(asesorFiltro));
    }
    if (barrioFiltro !== "all") {
        let keywords = [];
        if (barrioFiltro === "palermo") keywords = ["palermo", "recoleta", "belgrano"];
        if (barrioFiltro === "caballito") keywords = ["caballito", "almagro", "flores"];
        filtered = filtered.filter(r => keywords.some(k => r._barrioLower.includes(k)));
    }

    renderKanban(filtered);
    renderMap(filtered);
    renderAnalytics(filtered);
}

function renderKanban(data) {
    const cols = {
        'Pendiente': document.getElementById('col-pendientes'),
        'Contactado': document.getElementById('col-contactados'),
        'Cerrado': document.getElementById('col-cerrados'),
        'Descartado': document.getElementById('col-descartados')
    };
    
    // Clear cols
    for(let k in cols) cols[k].innerHTML = '';

    let pipelineActive = 0;
    let revenueGen = 0;
    let counts = { 'Pendiente': 0, 'Contactado': 0, 'Cerrado': 0, 'Descartado': 0 };

    data.forEach(m => {
        let st = m._estadoNorm;
        counts[st]++;
        
        if(st === 'Pendiente' || st === 'Contactado') pipelineActive += m._comisionPotencial;
        if(st === 'Cerrado') revenueGen += m._comisionPotencial;

        if(counts[st] > 30) return;

        const card = document.createElement('div');
        // LIGHT MODE CARD STYLES
        card.className = "kanban-card bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing";
        
        let actionButtons = '';
        if(st === 'Pendiente') {
            actionButtons = `
                <div class="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                    <button onclick="window.actualizarEstado('${m.ID}', 'Contactado ✅', this)" class="flex-1 bg-warning/10 hover:bg-warning/20 text-warning text-[11px] font-bold py-2 rounded-lg transition-colors border border-warning/20">CONTACTAR</button>
                    <button onclick="window.actualizarEstado('${m.ID}', 'Descartado ❌', this)" class="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-500 text-[11px] font-bold py-2 rounded-lg transition-colors border border-gray-200">DESCARTAR</button>
                </div>
            `;
        } else if(st === 'Contactado') {
            actionButtons = `
                <div class="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                    <button onclick="window.actualizarEstado('${m.ID}', 'Cerrado ✅', this)" class="flex-1 bg-success hover:bg-emerald-600 text-white text-[11px] font-bold py-2 rounded-lg transition-colors shadow-sm">GANADA 🎉</button>
                    <button onclick="window.actualizarEstado('${m.ID}', 'Descartado ❌', this)" class="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-500 text-[11px] font-bold py-2 rounded-lg transition-colors border border-gray-200">PERDIDA</button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div class="font-extrabold text-sm text-gray-900">Lead ${m['Comprador - Asesor WA']}</div>
                <div class="text-[11px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full font-bold">USD ${m._comisionPotencial.toLocaleString()}</div>
            </div>
            <p class="text-xs text-gray-500 line-clamp-1 mb-2 font-medium">Busca: ${m['Comprador - Zonas Buscadas']}</p>
            <div class="flex items-center gap-2 mt-3 bg-gray-50 p-2 rounded-lg border border-gray-100">
                <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>
                <p class="text-[11px] text-gray-700 font-semibold line-clamp-1">${m['Tipo Propiedad']} en <span class="capitalize">${m._barrioLower}</span></p>
            </div>
            <div class="flex justify-between items-center mt-3 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                <span>Asesor: ${m.Asesor}</span>
                <span>${m.Fuente}</span>
            </div>
            ${actionButtons}
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
    if (markersLayer) map.removeLayer(markersLayer);
    // Removemos la capa de calor vieja si existe (ya no la dibujamos más)
    if (typeof heatLayer !== 'undefined' && heatLayer) map.removeLayer(heatLayer);
    
    const conteoBarrios = {};
    markersLayer = L.layerGroup().addTo(map);

    let renderCount = 0;

    data.forEach(r => {
        let lat = -34.6037 + (Math.random() * 0.1 - 0.05);
        let lng = -58.3816 + (Math.random() * 0.1 - 0.05);
        
        for (const [key, coords] of Object.entries(barrioCoords)) {
            if (r._barrioLower.includes(key)) {
                lat = coords[0] + (Math.random()*0.02 - 0.01);
                lng = coords[1] + (Math.random()*0.02 - 0.01);
                conteoBarrios[key] = (conteoBarrios[key] || 0) + 1;
                break;
            }
        }

        if((r._estadoNorm === 'Pendiente' || r._estadoNorm === 'Contactado') && renderCount < 150) {
            renderCount++;
            
            let urlPublicacion = r['URL Publicación'] || r['URL\n Publicación'] || '#';
            urlPublicacion = urlPublicacion.trim();
            if(!urlPublicacion.startsWith('http')) urlPublicacion = 'https://' + urlPublicacion;

            // 1. MARCADOR DEL VENDEDOR (PROPIEDAD) - ZONAPROP ORANGE (#ed5f2b)
            const propIcon = L.divIcon({
                className: 'leaflet-div-icon',
                html: `<div style="background:#ed5f2b; color:white; font-family: sans-serif; font-weight:600; font-size:12px; padding:3px 8px; border-radius:12px; border:1.5px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.2); white-space:nowrap; transform: translate(-50%, -100%); cursor:pointer; transition: transform 0.1s;">USD ${(r._precioNum/1000).toFixed(0)}K</div>`,
                iconSize: [0, 0], iconAnchor: [0, 0]
            });

            const propTooltipHTML = `
                <div class="map-tooltip-card">
                    <div style="background:#ed5f2b; color:white; padding:10px 14px; font-weight:bold; font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">🏠 Propiedad (Venta)</div>
                    <div style="padding:14px;">
                        <div style="font-size:18px; font-weight:900; color:#1f2937; margin-bottom:4px;">USD ${r._precioNum.toLocaleString()}</div>
                        <div style="font-size:13px; color:#6b7280; font-weight:500; margin-bottom:10px;">${r['Tipo Propiedad']} • ${r['Ambientes Prop.'] || r['Amb'] || '?'} amb • <span style="text-transform:capitalize;">${r._barrioLower}</span></div>
                        <div style="font-size:11px; padding:4px 8px; background:#f3f4f6; color:#4b5563; border-radius:6px; display:inline-block; font-weight:bold;">📍 Origen: ${r.Fuente}</div>
                        <div style="font-size:11px; color:#ed5f2b; margin-top:12px; font-weight:bold;">Haz clic para ver el aviso original 👉</div>
                    </div>
                </div>
            `;

            const propMarker = L.marker([lat, lng], {icon: propIcon}).addTo(markersLayer);
            propMarker.bindTooltip(propTooltipHTML, { direction: 'top', offset: [0, -25], opacity: 1 });
            propMarker.on('click', () => {
                if(urlPublicacion && urlPublicacion !== 'https://#') window.open(urlPublicacion, '_blank');
                else alert("Esta propiedad no tiene URL de publicación cargada.");
            });

            // 2. MARCADOR DEL COMPRADOR (LEAD) - SUBTLE WHITE PILL
            const leadLat = lat - 0.0006; 
            const leadLng = lng + 0.0004;

            const leadIcon = L.divIcon({
                className: 'leaflet-div-icon',
                html: `<div style="background:white; color:#6b7280; font-weight:bold; font-size:9px; padding:2px 6px; border-radius:12px; border:1px solid #d1d5db; box-shadow:0 1px 2px rgba(0,0,0,0.1); white-space:nowrap; transform: translate(-50%, -50%); display:flex; align-items:center; gap:2px; opacity: 0.9;">👤 ${r['Comprador - Asesor WA']}</div>`,
                iconSize: [0, 0], iconAnchor: [0, 0]
            });

            const leadTooltipHTML = `
                <div class="map-tooltip-card">
                    <div style="background:#10b981; color:white; padding:10px 14px; font-weight:bold; font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">👤 Comprador Activo</div>
                    <div style="padding:14px;">
                        <div style="font-size:14px; font-weight:900; color:#1f2937; margin-bottom:4px;">Presupuesto: USD ${r['Comprador - Presupuesto']}</div>
                        <div style="font-size:13px; color:#6b7280; font-weight:500; margin-bottom:10px;">Busca: ${r['Comprador - Zonas Buscadas']}</div>
                        <div style="font-size:11px; padding:4px 8px; background:#ecfdf5; color:#059669; border-radius:6px; display:inline-block; font-weight:bold; border:1px solid #d1fae5;">💰 Comisión: USD ${r._comisionPotencial.toLocaleString()}</div>
                    </div>
                </div>
            `;

            const leadMarker = L.marker([leadLat, leadLng], {icon: leadIcon}).addTo(markersLayer);
            leadMarker.bindTooltip(leadTooltipHTML, { direction: 'bottom', offset: [0, 10], opacity: 1 });
            
            // Eliminamos la linea conector (polyline) para no ensuciar el mapa y que quede limpio como ZonaProp
        }
    });

    heatLayer = L.heatLayer(heatData, { radius: 25, blur: 20, maxZoom: 14, gradient: {0.4: 'blue', 0.6: 'cyan', 0.8: 'yellow', 1.0: 'red'} }).addTo(map);

    const topZonasList = Object.entries(conteoBarrios).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const topZonas = document.getElementById('map-zonas-legend');
    topZonas.innerHTML = '';
    topZonasList.forEach(z => {
        topZonas.innerHTML += `<div class="flex justify-between items-center w-full mb-1"><span class="capitalize text-gray-700 font-semibold">${z[0]}</span><span class="text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-md">${z[1]}</span></div>`;
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
