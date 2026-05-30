// app.js - Lógica principal del Dashboard Web

document.addEventListener('DOMContentLoaded', () => {
    console.log("Inicializando Dashboard...");

    // ── 1. Inicializar Mapa (Leaflet) ────────────────────────────────────────
    const map = L.map('map').setView([-34.6037, -58.3816], 12); // Centro CABA

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Datos simulados de calor (lat, lng, intensidad) - Luego se leerán de Google Sheets
    const heatData = [
        [-34.588, -58.430, 0.8], // Palermo
        [-34.562, -58.456, 0.6], // Belgrano
        [-34.589, -58.397, 0.5], // Recoleta
        [-34.573, -58.444, 0.9], // Colegiales
        [-34.618, -58.437, 0.4]  // Caballito
    ];

    if (typeof L.heatLayer !== 'undefined') {
        const heat = L.heatLayer(heatData, {
            radius: 25,
            blur: 15,
            maxZoom: 14,
            gradient: {0.4: 'blue', 0.6: 'cyan', 0.8: 'yellow', 1.0: 'red'}
        }).addTo(map);
    }

    // ── 2. Inicializar Gráficos (Chart.js) ──────────────────────────────────
    const ctx = document.getElementById('portalesChart').getContext('2d');
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['ZonaProp', 'MercadoLibre', 'Facebook'],
            datasets: [{
                data: [1386, 25024, 37],
                backgroundColor: ['#8b5cf6', '#f59e0b', '#3b82f6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' }
            },
            cutout: '70%'
        }
    });

    // ── 3. Cargar KPIs Simulados ─────────────────────────────────────────────
    // Esto luego se reemplazará por un fetch() al CSV de Google Sheets
    document.getElementById('kpi-inventario').innerText = '26,447';
    document.getElementById('kpi-compradores').innerText = '50';
    document.getElementById('kpi-conversion').innerText = '12.5%';
    document.getElementById('kpi-matches').innerText = '1,569';

    // ── 4. Cargar Tinder Cards ───────────────────────────────────────────────
    const tinderContainer = document.getElementById('tinder-container');
    const matchesSimulados = [
        {
            comprador: "Carlos G. (Joel)",
            busqueda: "Palermo, Belgrano | USD 180k",
            propiedad: "Dpto en Av. Santa Fe 3200",
            propInfo: "3 amb | 85 m² | USD 175k",
            fuente: "ZP"
        },
        {
            comprador: "Valeria R. (David)",
            busqueda: "Caballito | USD 120k",
            propiedad: "PH en Acoyte 120",
            propInfo: "2 amb | 50 m² | USD 115k",
            fuente: "ML"
        }
    ];

    tinderContainer.innerHTML = ''; // Limpiar skeleton
    matchesSimulados.forEach(m => {
        const card = document.createElement('div');
        card.className = "flex bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition";
        card.innerHTML = `
            <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                    <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">👤</div>
                    <span class="font-bold text-sm">${m.comprador}</span>
                </div>
                <p class="text-xs text-gray-500 mb-2">${m.busqueda}</p>
                <div class="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                    <div class="w-6 h-6 rounded bg-orange-100 text-orange-600 flex items-center justify-center text-xs">🏠</div>
                    <div>
                        <p class="font-bold text-xs">${m.propiedad}</p>
                        <p class="text-xs text-gray-500">${m.propInfo} • ${m.fuente}</p>
                    </div>
                </div>
            </div>
            <div class="flex flex-col gap-2 justify-center border-l border-gray-100 pl-4 ml-4">
                <button class="tinder-btn w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center hover:bg-green-200">✅</button>
                <button class="tinder-btn w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center hover:bg-red-200">❌</button>
            </div>
        `;
        tinderContainer.appendChild(card);
    });

    // Top Zonas
    const topZonas = document.getElementById('top-zonas-container');
    topZonas.innerHTML = `
        <div class="flex justify-between items-center text-sm"><span class="font-bold">Palermo</span><span class="text-gray-500">158 Matches</span></div>
        <div class="flex justify-between items-center text-sm"><span class="font-bold">Caballito</span><span class="text-gray-500">206 Matches</span></div>
        <div class="flex justify-between items-center text-sm"><span class="font-bold">Recoleta</span><span class="text-gray-500">143 Matches</span></div>
    `;
});
