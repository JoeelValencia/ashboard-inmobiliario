// app.js - CRM Multi-Asesor y Analítica Espacial V2
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCE8uHbyUCrZKdBOqGRf5OKx2TqMX-z0VJRZ1YQoS4-5szkZ31fJbc6diA2ydxhQdVBn2h0G1hT1hn/pub?gid=2040705075&single=true&output=csv';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxlE_a4It3IueNJuWDACwCVdh-AgNMIgH6RsmVdsQ5e2rNhf4MUdPzYtiRz_FECnrRw/exec';

let globalData = [];
let map;
let heatLayer;
let markersLayer;
let portalesChart;

document.addEventListener('DOMContentLoaded', () => {
    // Inicializar Mapa
    map = L.map('map').setView([-34.6037, -58.3816], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
    }).addTo(map);

    // Fetch y Parse del CSV
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        complete: function(results) {
            let data = results.data;
            if(data && data.length > 0) {
                // Limpiar headers y preparar datos numéricos
                globalData = data.map(row => {
                    const cleanRow = {};
                    for(let key in row) {
                        const cleanKey = key.replace(/\n/g, '').replace(/\s+/g, ' ').trim();
                        cleanRow[cleanKey] = row[key];
                    }
                    // Parsear Precio para Comisión (6%)
                    let precioStr = cleanRow['Precio Publicado'] || cleanRow['Precio'] || '0';
                    let precioNum = parseInt(precioStr.replace(/\D/g, '')) || 0;
                    cleanRow._precioNum = precioNum;
                    cleanRow._comisionPotencial = precioNum * 0.06;
                    cleanRow._barrioLower = (cleanRow['Barrio / Zona'] || cleanRow['Barrio/Zona'] || cleanRow['Barrio'] || '').toLowerCase();
                    return cleanRow;
                }).filter(r => r.ID && r.ID.trim() !== '');

                renderDashboard();
            }
        }
    });

    // Event Listeners Filtros
    document.getElementById('select-asesor').addEventListener('change', renderDashboard);
    document.getElementById('filter-barrio-base').addEventListener('change', renderDashboard);
    document.getElementById('filter-comision').addEventListener('change', renderDashboard);
});

// Función para enviar la actualización a Google Sheets
window.actualizarEstado = function(id, nuevoEstado, btnElement) {
    const card = btnElement.closest('.tinder-card-item');
    card.style.opacity = '0.5'; card.style.pointerEvents = 'none';

    fetch(SCRIPT_URL, {
        method: 'POST', mode: 'no-cors', cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, estado: nuevoEstado })
    }).then(() => {
        card.style.display = 'none';
    }).catch(() => {
        alert("Error de conexión. Intentá de nuevo.");
        card.style.opacity = '1'; card.style.pointerEvents = 'auto';
    });
};

function renderDashboard() {
    const asesorFiltro = document.getElementById('select-asesor').value;
    const barrioFiltro = document.getElementById('filter-barrio-base').value;
    const comisionFiltro = parseInt(document.getElementById('filter-comision').value) || 0;

    // ── 1. Filtrado de Datos ────────────────────────────────────────────────
    let filteredRows = globalData;

    // Filtro Asesor
    if (asesorFiltro !== "Todos") {
        filteredRows = filteredRows.filter(r => (r.Asesor || '').includes(asesorFiltro));
    }

    // Filtro Comisión Mínima
    if (comisionFiltro > 0) {
        filteredRows = filteredRows.filter(r => r._comisionPotencial >= comisionFiltro);
    }

    // Filtro Barrio Base (Logística)
    if (barrioFiltro !== "all") {
        let keywords = [];
        if (barrioFiltro === "palermo") keywords = ["palermo", "recoleta", "belgrano"];
        if (barrioFiltro === "caballito") keywords = ["caballito", "almagro", "flores"];
        if (barrioFiltro === "villa urquiza") keywords = ["urquiza", "nuñez", "saavedra"];
        
        filteredRows = filteredRows.filter(r => {
            return keywords.some(k => r._barrioLower.includes(k));
        });
    }

    // ── 2. Calcular KPIs ────────────────────────────────────────────────────
    const totalMatches = filteredRows.length;
    let cerrados = 0;
    let comisionTotal = 0;
    let fb = 0, ml = 0, zp = 0;
    let compradoresUnique = new Set();
    
    // Coordenadas base (Simuladas para CABA por falta de geocoding)
    const barrioCoords = {
        'palermo': [-34.588, -58.430], 'belgrano': [-34.562, -58.456],
        'recoleta': [-34.589, -58.397], 'caballito': [-34.618, -58.437],
        'urquiza': [-34.573, -58.481], 'nuñez': [-34.545, -58.465],
        'almagro': [-34.609, -58.422], 'flores': [-34.629, -58.463]
    };
    
    const heatData = [];
    const markersData = [];
    const conteoBarrios = {};

    filteredRows.forEach(r => {
        if (r.Estado && r.Estado.includes("Cerrado")) cerrados++;
        comisionTotal += r._comisionPotencial;
        
        const f = (r.Fuente || "").toLowerCase();
        if (f.includes('facebook')) fb++; else if (f.includes('mercado')) ml++; else zp++;
        if (r['Comprador - Teléfono']) compradoresUnique.add(r['Comprador - Teléfono']);

        // Geocoding Simulado de Alta Densidad
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
        markersData.push({lat, lng, title: r['Tipo Propiedad'] + ' en ' + r._barrioLower, price: r._precioNum, id: r.ID});
    });

    // Actualizar UI KPIs
    document.getElementById('kpi-inventario').innerText = '26,447'; 
    document.getElementById('kpi-compradores').innerText = compradoresUnique.size;
    document.getElementById('kpi-matches').innerText = totalMatches;
    document.getElementById('kpi-conversion').innerText = totalMatches > 0 ? ((cerrados / totalMatches) * 100).toFixed(1) + '%' : '0%';
    document.getElementById('kpi-comision').innerText = 'USD ' + comisionTotal.toLocaleString('es-AR');

    // ── 3. Actualizar Mapa ──────────────────────────────────────────────────
    if (heatLayer) map.removeLayer(heatLayer);
    if (markersLayer) map.removeLayer(markersLayer);
    
    heatLayer = L.heatLayer(heatData, { radius: 20, blur: 15, maxZoom: 14, gradient: {0.4: 'blue', 0.6: 'cyan', 0.8: 'yellow', 1.0: 'red'} }).addTo(map);
    
    markersLayer = L.layerGroup().addTo(map);
    // Solo mostrar los primeros 50 marcadores para no saturar el navegador
    markersData.slice(0, 50).forEach(m => {
        L.marker([m.lat, m.lng]).addTo(markersLayer).bindPopup(`<b>${m.title}</b><br>USD ${m.price.toLocaleString()}<br>ID: ${m.id}`);
    });

    // ── 4. Gráfico Chart.js ─────────────────────────────────────────────────
    if (portalesChart) portalesChart.destroy();
    const ctx = document.getElementById('portalesChart').getContext('2d');
    portalesChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['ZonaProp', 'MercadoLibre', 'Facebook'],
            datasets: [{ data: [zp, ml, fb], backgroundColor: ['#8b5cf6', '#f59e0b', '#3b82f6'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%' }
    });

    // ── 5. Tinder Cards (Tomar pendientes) ──────────────────────────────────
    const tinderContainer = document.getElementById('tinder-container');
    tinderContainer.innerHTML = '';
    
    const pendientes = filteredRows.filter(r => r.Estado === 'Pendiente').slice(0, 15);
    
    if(pendientes.length === 0) {
        tinderContainer.innerHTML = '<p class="text-gray-500 p-4">No hay oportunidades en esta vista.</p>';
    } else {
        pendientes.forEach(m => {
            const card = document.createElement('div');
            card.className = "tinder-card-item flex bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition";
            card.innerHTML = `
                <div class="flex-1">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">👤</div>
                            <span class="font-bold text-sm">Lead ${m['Comprador - Asesor WA']}</span>
                        </div>
                        <span class="text-xs px-2 py-1 bg-green-100 rounded-full text-green-700 font-bold">Comisión: USD ${m._comisionPotencial.toLocaleString('es-AR')}</span>
                    </div>
                    <p class="text-xs text-gray-500 mb-2">Busca: ${m['Comprador - Zonas Buscadas']} | USD ${m['Comprador - Presupuesto']}</p>
                    <div class="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                        <div class="w-6 h-6 rounded bg-orange-100 text-orange-600 flex items-center justify-center text-xs">🏠</div>
                        <div>
                            <p class="font-bold text-xs">${m['Tipo Propiedad']} en ${m._barrioLower}</p>
                            <p class="text-xs text-gray-500">${m['Ambientes Prop.'] || m['Amb'] || '?'} amb | USD ${m['Precio Publicado'] || m['Precio']} • ${m.Fuente}</p>
                        </div>
                    </div>
                </div>
                <div class="flex flex-col gap-2 justify-center border-l border-gray-100 pl-4 ml-4">
                    <button onclick="window.actualizarEstado('${m.ID}', 'Contactado', this)" class="tinder-btn w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center hover:bg-green-200" title="Aceptar (Contactado)">✅</button>
                    <button onclick="window.actualizarEstado('${m.ID}', 'Descartado ❌', this)" class="tinder-btn w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center hover:bg-red-200" title="Descartar">❌</button>
                </div>
            `;
            tinderContainer.appendChild(card);
        });
    }

    // Top Zonas
    const topZonasList = Object.entries(conteoBarrios).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const topZonas = document.getElementById('top-zonas-container');
    topZonas.innerHTML = '';
    topZonasList.forEach(z => {
        topZonas.innerHTML += `<div class="flex justify-between items-center text-sm"><span class="font-bold capitalize">${z[0]}</span><span class="text-gray-500">${z[1]} Matches</span></div>`;
    });
}
