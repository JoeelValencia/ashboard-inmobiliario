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
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
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

        // Limitar renderizado para performance (max 30 por columna visualizados)
        if(counts[st] > 30) return;

        const card = document.createElement('div');
        card.className = "kanban-card bg-zinc-900 border border-zinc-700/50 rounded-lg p-3 shadow-md hover:border-zinc-500 transition-colors";
        
        // Botones de accion dependiento del estado
        let actionButtons = '';
        if(st === 'Pendiente') {
            actionButtons = `
                <div class="flex gap-2 mt-3 pt-3 border-t border-zinc-800">
                    <button onclick="window.actualizarEstado('${m.ID}', 'Contactado ✅', this)" class="flex-1 bg-zinc-800 hover:bg-warning/20 text-warning text-[10px] font-bold py-1.5 rounded transition">EN GESTIÓN</button>
                    <button onclick="window.actualizarEstado('${m.ID}', 'Descartado ❌', this)" class="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[10px] font-bold py-1.5 rounded transition">DESCARTAR</button>
                </div>
            `;
        } else if(st === 'Contactado') {
            actionButtons = `
                <div class="flex gap-2 mt-3 pt-3 border-t border-zinc-800">
                    <button onclick="window.actualizarEstado('${m.ID}', 'Cerrado ✅', this)" class="flex-1 bg-zinc-800 hover:bg-accent/20 text-accent text-[10px] font-bold py-1.5 rounded transition">CERRAR MATCH</button>
                    <button onclick="window.actualizarEstado('${m.ID}', 'Descartado ❌', this)" class="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[10px] font-bold py-1.5 rounded transition">PERDIDO</button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div class="font-bold text-sm text-zinc-200">Lead ${m['Comprador - Asesor WA']}</div>
                <div class="text-[10px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">$${m._comisionPotencial.toLocaleString()}</div>
            </div>
            <p class="text-xs text-zinc-400 line-clamp-1 mb-1">Busca: ${m['Comprador - Zonas Buscadas']}</p>
            <div class="flex items-center gap-2 mt-2">
                <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
                <p class="text-[11px] text-zinc-300 line-clamp-1">${m['Tipo Propiedad']} en <span class="capitalize">${m._barrioLower}</span></p>
            </div>
            <div class="flex justify-between items-center mt-2 text-[10px] text-zinc-500">
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
    if (heatLayer) map.removeLayer(heatLayer);
    if (markersLayer) map.removeLayer(markersLayer);
    
    const heatData = [];
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
        heatData.push([lat, lng, 0.8]);

        // Solo dibujar pines para los activos (para no saturar visualmente)
        if((r._estadoNorm === 'Pendiente' || r._estadoNorm === 'Contactado') && renderCount < 100) {
            renderCount++;
            
            let urlPublicacion = r['URL Publicación'] || r['URL\n Publicación'] || '#';
            urlPublicacion = urlPublicacion.trim();
            if(!urlPublicacion.startsWith('http')) urlPublicacion = 'https://' + urlPublicacion;

            // 1. MARCADOR DEL VENDEDOR (PROPIEDAD)
            const propIcon = L.divIcon({
                className: 'leaflet-div-icon',
                html: `<div style="background:#3b82f6; color:white; font-weight:bold; font-size:11px; padding:2px 8px; border-radius:4px; border:1px solid #60a5fa; box-shadow:0 4px 6px rgba(0,0,0,0.3); white-space:nowrap; transform: translate(-50%, -100%); mt-2">USD ${(r._precioNum/1000).toFixed(0)}k</div>`,
                iconSize: [0, 0], iconAnchor: [0, 0]
            });

            const propTooltipHTML = `
                <div class="map-tooltip-card">
                    <div style="background:#3b82f6; padding:8px 12px; font-weight:bold; font-size:12px;">🏠 Propiedad (Venta)</div>
                    <div style="padding:12px;">
                        <div style="font-size:16px; font-weight:bold; margin-bottom:4px;">USD ${r._precioNum.toLocaleString()}</div>
                        <div style="font-size:12px; color:#a1a1aa; margin-bottom:8px;">${r['Tipo Propiedad']} • ${r['Ambientes Prop.'] || r['Amb'] || '?'} amb • <span style="text-transform:capitalize;">${r._barrioLower}</span></div>
                        <div style="font-size:10px; padding:4px 8px; background:#27272a; border-radius:4px; display:inline-block;">📍 Origen: ${r.Fuente}</div>
                        <div style="font-size:10px; color:#3b82f6; margin-top:8px; font-weight:bold;">Clic para ir al aviso original 👉</div>
                    </div>
                </div>
            `;

            const propMarker = L.marker([lat, lng], {icon: propIcon}).addTo(markersLayer);
            propMarker.bindTooltip(propTooltipHTML, { direction: 'top', offset: [0, -25], opacity: 1 });
            propMarker.on('click', () => {
                if(urlPublicacion && urlPublicacion !== 'https://#') window.open(urlPublicacion, '_blank');
                else alert("Esta propiedad no tiene URL de publicación cargada.");
            });

            // 2. MARCADOR DEL COMPRADOR (LEAD) - Ligeramente desplazado
            const leadLat = lat - 0.0008; 
            const leadLng = lng + 0.0005;

            const leadIcon = L.divIcon({
                className: 'leaflet-div-icon',
                html: `<div style="background:#10b981; color:#064e3b; font-weight:bold; font-size:10px; padding:2px 8px; border-radius:12px; border:1px solid #34d399; box-shadow:0 4px 6px rgba(0,0,0,0.3); white-space:nowrap; transform: translate(-50%, -50%); flex; align-items:center; gap:4px;">👤 Lead ${r['Comprador - Asesor WA']}</div>`,
                iconSize: [0, 0], iconAnchor: [0, 0]
            });

            const leadTooltipHTML = `
                <div class="map-tooltip-card" style="border-color: rgba(16, 185, 129, 0.4);">
                    <div style="background:#10b981; color:#064e3b; padding:8px 12px; font-weight:bold; font-size:12px;">👤 Comprador Activo</div>
                    <div style="padding:12px;">
                        <div style="font-size:14px; font-weight:bold; margin-bottom:4px;">Presupuesto: USD ${r['Comprador - Presupuesto']}</div>
                        <div style="font-size:12px; color:#a1a1aa; margin-bottom:8px;">Busca: ${r['Comprador - Zonas Buscadas']}</div>
                        <div style="font-size:10px; padding:4px 8px; background:rgba(16,185,129,0.1); color:#10b981; border-radius:4px; display:inline-block; font-weight:bold;">💰 Comis. Potencial: USD ${r._comisionPotencial.toLocaleString()}</div>
                    </div>
                </div>
            `;

            const leadMarker = L.marker([leadLat, leadLng], {icon: leadIcon}).addTo(markersLayer);
            leadMarker.bindTooltip(leadTooltipHTML, { direction: 'bottom', offset: [0, 10], opacity: 1 });
            
            // Dibujar línea conectora entre Comprador y Propiedad
            L.polyline([[lat, lng], [leadLat, leadLng]], {color: '#52525b', weight: 1, dashArray: '4, 4'}).addTo(markersLayer);
        }
    });

    heatLayer = L.heatLayer(heatData, { radius: 25, blur: 20, maxZoom: 14, gradient: {0.4: 'blue', 0.6: 'cyan', 0.8: 'yellow', 1.0: 'red'} }).addTo(map);

    const topZonasList = Object.entries(conteoBarrios).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const topZonas = document.getElementById('map-zonas-legend');
    topZonas.innerHTML = '';
    topZonasList.forEach(z => {
        topZonas.innerHTML += `<div class="flex justify-between items-center w-48"><span class="capitalize text-zinc-200">${z[0]}</span><span class="text-primary font-mono">${z[1]}</span></div>`;
    });
}

function renderAnalytics(data) {
    // 1. Leaderboard
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
    
    // Sort by revenue descending
    let sorted = Object.keys(stats).map(k => ({name: k, ...stats[k]})).sort((a,b) => b.revenue - a.revenue);
    
    sorted.forEach((s, idx) => {
        let rankColor = idx === 0 ? 'text-warning' : 'text-zinc-500';
        lbContainer.innerHTML += `
            <div class="bg-zinc-800/30 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center font-bold text-white">${s.name.charAt(0)}</div>
                        <span class="font-bold text-zinc-200">${s.name}</span>
                    </div>
                    <span class="font-bold ${rankColor}">#${idx+1}</span>
                </div>
                <div class="space-y-2">
                    <div class="flex justify-between text-xs">
                        <span class="text-zinc-500">Revenue</span>
                        <span class="text-accent font-bold font-mono">$${s.revenue.toLocaleString()}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                        <span class="text-zinc-500">Pipeline Activo</span>
                        <span class="text-zinc-300 font-mono">$${s.pipeline.toLocaleString()}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                        <span class="text-zinc-500">Win Rate</span>
                        <span class="text-zinc-300 font-mono">${s.total > 0 ? Math.round((s.wins/s.total)*100) : 0}%</span>
                    </div>
                </div>
            </div>
        `;
    });

    // 2. Charts
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
        data: { labels: ['ZonaProp', 'MercadoLibre', 'Facebook'], datasets: [{ data: [zp, ml, fb], backgroundColor: ['#8b5cf6', '#f59e0b', '#3b82f6'], borderColor: '#18181b', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { position: 'bottom', labels: { color: '#a1a1aa' } } } }
    });

    if (chartEstados) chartEstados.destroy();
    chartEstados = new Chart(document.getElementById('chart-estados').getContext('2d'), {
        type: 'bar',
        data: { 
            labels: ['Nuevos', 'En Gestión', 'Ganados', 'Perdidos'], 
            datasets: [{ label: 'Leads', data: [counts['Pendiente'], counts['Contactado'], counts['Cerrado'], counts['Descartado']], backgroundColor: ['#3b82f6', '#f59e0b', '#10b981', '#52525b'], borderRadius: 4 }] 
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { display: false }, x: { grid: { display: false }, ticks: { color: '#a1a1aa' } } }, plugins: { legend: { display: false } } }
    });
}
