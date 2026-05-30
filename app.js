// app.js - Conectado a Google Sheets en tiempo real
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCE8uHbyUCrZKdBOqGRf5OKx2TqMX-z0VJRZ1YQoS4-5szkZ31fJbc6diA2ydxhQdVBn2h0G1hT1hn/pub?gid=2040705075&single=true&output=csv';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxlE_a4It3IueNJuWDACwCVdh-AgNMIgH6RsmVdsQ5e2rNhf4MUdPzYtiRz_FECnrRw/exec';

document.addEventListener('DOMContentLoaded', () => {
    console.log("Iniciando descarga de datos desde Google Sheets...");
    
    // Iniciar Mapa (sin datos todavía)
    const map = L.map('map').setView([-34.6037, -58.3816], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Fetch y Parse del CSV
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        complete: function(results) {
            let data = results.data;
            if(data && data.length > 0) {
                // Limpiar saltos de línea de los nombres de columnas
                data = data.map(row => {
                    const cleanRow = {};
                    for(let key in row) {
                        const cleanKey = key.replace(/\n/g, '').replace(/\s+/g, ' ').trim();
                        cleanRow[cleanKey] = row[key];
                    }
                    return cleanRow;
                });
                procesarDatos(data, map);
            }
        },
        error: function(err) {
            console.error("Error al cargar CSV:", err);
            document.getElementById('tinder-container').innerHTML = '<p class="text-red-500 p-4">Error al cargar datos.</p>';
        }
    });
});

// Función para enviar la actualización a Google Sheets
window.actualizarEstado = function(id, nuevoEstado, btnElement) {
    // Feedback visual inmediato
    const card = btnElement.closest('.tinder-card-item');
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';

    fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors', // Evita problemas de CORS al escribir
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, estado: nuevoEstado })
    })
    .then(() => {
        // Asumimos éxito al usar no-cors
        card.style.display = 'none';
        console.log(`Estado actualizado para ${id}: ${nuevoEstado}`);
    })
    .catch(error => {
        console.error("Error actualizando Google Sheets:", error);
        alert("Hubo un error al actualizar el estado. Intentá de nuevo.");
        card.style.opacity = '1';
        card.style.pointerEvents = 'auto';
    });
};

function procesarDatos(data, map) {
    // Filtrar filas vacías
    const rows = data.filter(r => r.ID && r.ID.trim() !== '');

    // ── 1. Calcular KPIs ────────────────────────────────────────────────────
    const totalMatches = rows.length;
    let cerrados = 0;
    let fb = 0, ml = 0, zp = 0;
    let compradoresUnique = new Set();
    
    // Para el mapa (simularemos coordenadas basadas en barrios conocidos de CABA)
    const barrioCoords = {
        'palermo': [-34.588, -58.430],
        'belgrano': [-34.562, -58.456],
        'recoleta': [-34.589, -58.397],
        'caballito': [-34.618, -58.437],
        'villa urquiza': [-34.573, -58.481],
        'nuñez': [-34.545, -58.465],
        'almagro': [-34.609, -58.422]
    };
    const heatData = [];
    const conteoBarrios = {};

    rows.forEach(r => {
        // Estado
        if (r.Estado && r.Estado.includes("Cerrado")) cerrados++;
        
        // Fuentes
        const f = (r.Fuente || "").toLowerCase();
        if (f.includes('facebook')) fb++;
        else if (f.includes('mercado')) ml++;
        else if (f.includes('zona')) zp++;

        // Compradores únicos (usando teléfono como ID)
        if (r['Comprador - Teléfono']) compradoresUnique.add(r['Comprador - Teléfono']);

        // Mapa de calor (burbujas)
        const barrio = (r['Barrio / Zona'] || "").toLowerCase();
        for (const [key, coords] of Object.entries(barrioCoords)) {
            if (barrio.includes(key)) {
                heatData.push([coords[0] + (Math.random()*0.01 - 0.005), coords[1] + (Math.random()*0.01 - 0.005), 0.7]);
                conteoBarrios[key] = (conteoBarrios[key] || 0) + 1;
                break;
            }
        }
    });

    // Actualizar UI KPIs
    document.getElementById('kpi-inventario').innerText = '26,447'; // Total estático por ahora
    document.getElementById('kpi-compradores').innerText = compradoresUnique.size;
    document.getElementById('kpi-matches').innerText = totalMatches;
    document.getElementById('kpi-conversion').innerText = ((cerrados / Math.max(1, totalMatches)) * 100).toFixed(1) + '%';

    // ── 2. Actualizar Mapa ──────────────────────────────────────────────────
    if (typeof L.heatLayer !== 'undefined' && heatData.length > 0) {
        L.heatLayer(heatData, { radius: 25, blur: 15, maxZoom: 14, gradient: {0.4: 'blue', 0.6: 'cyan', 0.8: 'yellow', 1.0: 'red'} }).addTo(map);
    }

    // ── 3. Gráfico Chart.js ─────────────────────────────────────────────────
    const ctx = document.getElementById('portalesChart').getContext('2d');
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['ZonaProp', 'MercadoLibre', 'Facebook'],
            datasets: [{
                data: [zp, ml, fb],
                backgroundColor: ['#8b5cf6', '#f59e0b', '#3b82f6'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%' }
    });

    // ── 4. Tinder Cards (Tomar los primeros 15 pendientes) ──────────────────
    const tinderContainer = document.getElementById('tinder-container');
    tinderContainer.innerHTML = '';
    
    const pendientes = rows.filter(r => r.Estado === 'Pendiente').slice(0, 15);
    
    if(pendientes.length === 0) {
        tinderContainer.innerHTML = '<p class="text-gray-500 p-4">No hay oportunidades pendientes.</p>';
    } else {
        pendientes.forEach(m => {
            const card = document.createElement('div');
            card.className = "tinder-card-item flex bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition";
            card.innerHTML = `
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">👤</div>
                        <span class="font-bold text-sm">Lead ${m['Comprador - Asesor WA']}</span>
                        <span class="text-xs px-2 py-1 bg-gray-100 rounded-full text-gray-600">Asesor: ${m.Asesor}</span>
                    </div>
                    <p class="text-xs text-gray-500 mb-2">${m['Comprador - Zonas Buscadas']} | USD ${m['Comprador - Presupuesto']}</p>
                    <div class="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                        <div class="w-6 h-6 rounded bg-orange-100 text-orange-600 flex items-center justify-center text-xs">🏠</div>
                        <div>
                            <p class="font-bold text-xs">${m['Tipo Propiedad']} en ${m['Barrio / Zona'] || m['Barrio/Zona'] || m['Barrio']}</p>
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
