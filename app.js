// app.js - Nexus CRM Pro
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRCE8uHbyUCrZKdBOqGRf5OKx2TqMX-z0VJRZ1YQoS4-5szkZ31fJbc6diA2ydxhQdVBn2h0G1hT1hn/pub?gid=2040705075&single=true&output=csv';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxlE_a4It3IueNJuWDACwCVdh-AgNMIgH6RsmVdsQ5e2rNhf4MUdPzYtiRz_FECnrRw/exec';

// ─── SUPABASE CONFIG ──────────────────────────────────────────
// URL e clave anon pública (safe para el browser)
const SUPABASE_URL = 'https://dncfzfqxnpkygabrcczz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Ij86JHGSoPgiEdlbp4baZA_wrXjl0vI';
let supabase = null;
let realtimeChannel = null;

// ─── THEME INIT (Se ejecuta apenas carga el script) ──────────
const savedTheme = localStorage.getItem('nexus_theme');
if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.setAttribute('data-theme', 'dark');
} else {
    document.body.removeAttribute('data-theme');
}

window.toggleTheme = function() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('nexus_theme', 'light');
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('nexus_theme', 'dark');
    }
    updateThemeIcons();
};

function updateThemeIcons() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const moon = document.getElementById('theme-icon-moon');
    const sun = document.getElementById('theme-icon-sun');
    if (moon && sun) {
        if (isDark) { moon.style.display = 'none'; sun.style.display = 'block'; }
        else { moon.style.display = 'block'; sun.style.display = 'none'; }
    }
}

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
    
    // Iconos de tema inicial
    updateThemeIcons();

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
            const n = inventarioGlobal.length.toLocaleString();
            document.getElementById('map-total-results').innerText = `Mostrando ${n} propiedades`;
            document.getElementById('badge-map').innerText = n;
            document.getElementById('kpi-inventory').innerText = n + ' props';
            renderMassiveMap(inventarioGlobal);
        }
    });

    // ─── INICIALIZAR SUPABASE ─────────────────────────────────────────
    try {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        cargarDesdeSupabase();
        suscribirRealtime();
    } catch(e) {
        console.warn('Supabase no disponible, usando CSV:', e);
        cargarDesdeCSV();
    }
});

/* ───────────────────────────────────────────────────────────────
   📊  CARGAR DESDE SUPABASE
─────────────────────────────────────────────────────────────── */
async function cargarDesdeSupabase() {
    mostrarIndicadorSync('Conectando a Supabase...', 'loading');
    try {
        const { data, error } = await supabase
            .from('matches')
            .select('*')
            .order('score', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            // Si la tabla está vacía, cargar desde CSV como fallback
            console.warn('Tabla matches vacía, usando CSV...');
            mostrarIndicadorSync('Sin datos en Supabase, usando Google Sheet', 'warning');
            cargarDesdeCSV();
            return;
        }

        const parsed = normalizarDatos(data);
        globalData = parsed;
        document.getElementById('select-asesor').addEventListener('change', aplicarFiltro);
        aplicarFiltro();
        mostrarIndicadorSync('Conectado en tiempo real ⚡', 'ok');
    } catch(e) {
        console.error('Error Supabase:', e);
        mostrarIndicadorSync('Error Supabase — usando CSV', 'error');
        cargarDesdeCSV();
    }
}

/* Fallback: cargar desde Google Sheet CSV */
function cargarDesdeCSV() {
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            let parsed = results.data.filter(r => r['\uD83D\uDC64 COMPRADOR (Lead/Asesor)'] || r.Asesor || r['Fecha Match']);
            parsed = normalizarDatos(parsed);
            globalData = parsed;
            document.getElementById('select-asesor').addEventListener('change', aplicarFiltro);
            aplicarFiltro();
            mostrarIndicadorSync('Google Sheet (sin tiempo real)', 'warning');
        }
    });
}

/* Normalizar datos: tanto de Supabase como de CSV */
function normalizarDatos(rows) {
    return rows.map(r => {
        let s = parseInt(r.score || r.Score || 0);
        r._scoreNum = isNaN(s) ? 0 : s;
        let precioRaw = r.precio || r.Precio || '';
        let c = precioRaw ? String(precioRaw).replace(/\D/g, '') : '';
        r._precioNum = c ? parseInt(c) : 0;
        r._comisionPotencial = Math.round(r._precioNum * 0.03);
        r._barrioLower = (r.barrio || r.Barrio || '').toLowerCase();
        r._asesor = r.asesor || r['\uD83D\uDC64 COMPRADOR (Lead/Asesor)'] || r.Asesor || '';
        r._empresa = r.empresa || r['Empresa (Lead)'] || r.Empresa || '';
        r._zonas = r.zonas_buscadas || r['Zonas Buscadas'] || r.Zona || '';
        // Estado: si ya tiene uno guardado en DB, usarlo; si no, calcular por score
        if (r.estado_kanban) {
            r._estadoNorm = r.estado_kanban;
        } else {
            r._estadoNorm = 'Pendiente';
            if(r._scoreNum >= 80) r._estadoNorm = 'Contactado';
            if(r._scoreNum >= 90) r._estadoNorm = 'Visita';
            if(r._scoreNum >= 95) r._estadoNorm = 'Cerrado';
            if(r._scoreNum < 60)  r._estadoNorm = 'Descartado';
        }
        r._asesorAsignado = r.asesor_asignado || null;
        return r;
    });
}

/* ───────────────────────────────────────────────────────────────
   ⚡  SUSCRIPCIÓN REALTIME
─────────────────────────────────────────────────────────────── */
function suscribirRealtime() {
    if (!supabase) return;

    realtimeChannel = supabase
        .channel('kanban-realtime')
        .on('postgres_changes', {
            event: '*',        // INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'matches'
        }, payload => {
            console.log('Cambio Realtime:', payload);
            manejarCambioRealtime(payload);
        })
        .subscribe(status => {
            if (status === 'SUBSCRIBED') {
                mostrarIndicadorSync('Tiempo real activo ⚡', 'ok');
            }
        });
}

function manejarCambioRealtime(payload) {
    const { eventType, new: newRow, old: oldRow } = payload;

    if (eventType === 'UPDATE') {
        // Actualizar solo el registro cambiado en globalData
        const idx = globalData.findIndex(r => r.id === newRow.id);
        if (idx !== -1) {
            const updated = normalizarDatos([newRow])[0];
            globalData[idx] = updated;
        }
        aplicarFiltro();
        // Mostrar notificación del cambio
        const asesorActual = document.getElementById('select-asesor').value;
        if (newRow.asesor_asignado && newRow.asesor_asignado !== asesorActual) {
            showToast(`🔄 ${newRow.asesor_asignado} actualizó un lead`);
        }
    } else if (eventType === 'INSERT') {
        const nuevo = normalizarDatos([newRow])[0];
        globalData.unshift(nuevo);
        aplicarFiltro();
        showToast(`🔔 Nuevo lead agregado`);
    }
}

/* ───────────────────────────────────────────────────────────────
   📡  GUARDAR ESTADO EN SUPABASE
─────────────────────────────────────────────────────────────── */
async function guardarEstadoEnSupabase(matchId, nuevoEstado, asesorAsignado = null) {
    if (!supabase || !matchId) return;

    const update = { estado_kanban: nuevoEstado };
    if (asesorAsignado) update.asesor_asignado = asesorAsignado;

    const { error } = await supabase
        .from('matches')
        .update(update)
        .eq('id', matchId);

    if (error) {
        console.error('Error guardando estado:', error);
        showToast('⚠️ Error al guardar en Supabase');
    }
}

/* Indicador de estado de sync en el topbar */
function mostrarIndicadorSync(msg, tipo) {
    let el = document.getElementById('sync-indicator');
    if (!el) {
        el = document.createElement('div');
        el.id = 'sync-indicator';
        el.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;padding:4px 10px;border-radius:99px;margin-left:8px;flex-shrink:0;';
        const topbar = document.querySelector('.topbar');
        if (topbar) topbar.appendChild(el);
    }
    const colors = {
        ok:      { bg: '#d1fae5', color: '#065f46', dot: '#10b981' },
        warning: { bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
        error:   { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
        loading: { bg: '#ede9fe', color: '#5b21b6', dot: '#7c3aed' }
    };
    const c = colors[tipo] || colors.loading;
    el.style.background = c.bg;
    el.style.color = c.color;
    el.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${c.dot};${tipo==='loading'?'animation:pulse 1s infinite':''}"></span>${msg}`;
}

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
        filtered = filtered.filter(r => (r._asesor || r.Asesor || '').includes(asesorFiltro));
    }
    renderKanban(filtered);
    if (typeof renderTable === 'function') renderTable(filtered);
    renderAnalytics(filtered);
}

function renderKanban(data) {
    const cols = {
        'Pendiente':  document.getElementById('col-pendientes'),
        'Contactado': document.getElementById('col-contactados'),
        'Visita':     document.getElementById('col-visita'),
        'Cerrado':    document.getElementById('col-cerrados'),
        'Descartado': document.getElementById('col-descartados')
    };
    
    for(let k in cols) if(cols[k]) cols[k].innerHTML = '';

    let pipelineActive = 0;
    let revenueGen = 0;
    let counts = { 'Pendiente': 0, 'Contactado': 0, 'Visita': 0, 'Cerrado': 0, 'Descartado': 0 };

    const scoreColors = {
        'Pendiente':  { bg: '#ede9fe', color: '#5b21b6' },
        'Contactado': { bg: '#fef3c7', color: '#92400e' },
        'Visita':     { bg: '#cffafe', color: '#155e75' },
        'Cerrado':    { bg: '#d1fae5', color: '#065f46' },
        'Descartado': { bg: '#f4f4f5', color: '#71717a' }
    };

    data.forEach(m => {
        let st = m._estadoNorm;
        if(!counts.hasOwnProperty(st)) st = 'Pendiente';
        counts[st]++;
        if(st === 'Pendiente' || st === 'Contactado' || st === 'Visita') pipelineActive += m._comisionPotencial;
        if(st === 'Cerrado') revenueGen += m._comisionPotencial;

        const sc = scoreColors[st] || scoreColors['Pendiente'];
        const card = document.createElement('div');
        card.className = 'kanban-card';
        card.innerHTML = `
            <div class="card-score" style="background:${sc.bg};color:${sc.color}">Score ${m._scoreNum}</div>
            <div class="card-title">${m._asesor || 'Lead ' + (m.ID || '')}</div>
            <div class="card-sub">${m._empresa ? '🏢 ' + m._empresa + ' &nbsp;·&nbsp; ' : ''}📍 ${m._barrioLower || m._zonas || '–'}</div>
            <div class="card-meta">
                <span class="card-tag">${m['\uD83C\uDFE2 VENDEDOR (Fuente/Agencia)'] || m.Fuente || 'ML'}</span>
                <span class="card-price">USD ${m._precioNum > 0 ? m._precioNum.toLocaleString('es-AR') : '–'}</span>
            </div>
            <button class="btn-assign" onclick="asignarme(this.closest('.kanban-card'))">✋ Asignarme</button>
        `;
        // Guardar datos del match en el elemento para el tooltip
        card._matchData = m;
        if(cols[st]) cols[st].appendChild(card);
    });

    document.getElementById('count-pendientes').innerText  = counts['Pendiente'];
    document.getElementById('count-contactados').innerText = counts['Contactado'];
    document.getElementById('count-visita').innerText      = counts['Visita'];
    document.getElementById('count-cerrados').innerText    = counts['Cerrado'];
    document.getElementById('count-descartados').innerText = counts['Descartado'];
    document.getElementById('badge-kanban').innerText = data.length;
    document.getElementById('kpi-pipeline').innerText  = 'USD ' + pipelineActive.toLocaleString('es-AR');
    document.getElementById('kpi-revenue').innerText   = 'USD ' + revenueGen.toLocaleString('es-AR');
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
    
    // Update analytics stats
    const total = data.length;
    const cerrados = data.filter(m => m._estadoNorm === 'Cerrado').length;
    const avgScore = total > 0 ? Math.round(data.reduce((acc, m) => acc + m._scoreNum, 0) / total) : 0;
    if(document.getElementById('stat-total-matches')) document.getElementById('stat-total-matches').innerText = total.toLocaleString();
    if(document.getElementById('stat-leads')) document.getElementById('stat-leads').innerText = new Set(data.map(m => m._asesor)).size;
    if(document.getElementById('stat-efectividad')) document.getElementById('stat-efectividad').innerText = (total > 0 ? Math.round((cerrados/total)*100) : 0) + '%';
    if(document.getElementById('stat-score')) document.getElementById('stat-score').innerText = avgScore;

    sorted.forEach((s, idx) => {
        const isFirst = idx === 0;
        const medals = ['🥇','🥈','🥉',''];
        const card = document.createElement('div');
        card.className = 'leader-card' + (isFirst ? ' top' : '');
        card.innerHTML = `
            <div class="leader-avatar">${s.name.charAt(0)}</div>
            <div class="leader-name">${medals[idx] || ''} ${s.name}</div>
            <div class="leader-rank">#${idx+1} en el ranking</div>
            <div class="leader-stat">
                <span class="leader-stat-label">Revenue</span>
                <span class="leader-stat-value" style="color:var(--success)">$${s.revenue.toLocaleString()}</span>
            </div>
            <div class="leader-stat">
                <span class="leader-stat-label">Pipeline</span>
                <span class="leader-stat-value">$${s.pipeline.toLocaleString()}</span>
            </div>
            <div class="leader-stat">
                <span class="leader-stat-label">Efectividad</span>
                <span class="pill pill-purple">${s.total > 0 ? Math.round((s.wins/s.total)*100) : 0}%</span>
            </div>
        `;
        lbContainer.appendChild(card);
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

/* ──────────────────────────────────────────────────────────────
   🔍  BÚSQUEDA EN TIEMPO REAL EN EL KANBAN
────────────────────────────────────────────────────────────── */
function filtrarKanbanPorTexto(query) {
    // Centralizamos todo el filtrado (texto + chips) en una sola función
    aplicarFiltrosChips();
}

/* ──────────────────────────────────────────────────────────────
   💬  TOOLTIP AL PASAR EL MOUSE SOBRE UNA TARJETA
────────────────────────────────────────────────────────────── */
(function initCardTooltip() {
    const tooltip = document.getElementById('card-tooltip');
    if (!tooltip) return;

    document.addEventListener('mouseover', e => {
        const card = e.target.closest('.kanban-card:not(.skeleton)');
        if (!card || e.target.closest('.btn-assign')) { tooltip.classList.remove('visible'); return; }

        const data = card._matchData;
        if (!data) return;

        const precio = data._precioNum > 0 ? 'USD ' + data._precioNum.toLocaleString('es-AR') : '–';
        const comision = data._comisionPotencial > 0 ? 'USD ' + data._comisionPotencial.toLocaleString('es-AR') : '–';
        const zonas = data._zonas || data._barrioLower || '–';
        const asesor = data._asesor || '–';
        const fuente = data['🏢 VENDEDOR (Fuente/Agencia)'] || data.Fuente || '–';
        const fecha = data['Fecha Match'] || '–';
        const score = data._scoreNum || '–';

        tooltip.innerHTML = `
            <div class="card-tooltip-title">${asesor}</div>
            <div class="card-tooltip-row"><span>🏷️ Score</span><span>${score} pts</span></div>
            <div class="card-tooltip-row"><span>📍 Zona buscada</span><span>${zonas.substring(0,30)}</span></div>
            <div class="card-tooltip-row"><span>💰 Precio</span><span>${precio}</span></div>
            <hr class="card-tooltip-divider">
            <div class="card-tooltip-row"><span>🏢 Fuente</span><span>${fuente.substring(0,22)}</span></div>
            <div class="card-tooltip-row"><span>📅 Fecha match</span><span>${fecha}</span></div>
            <div class="card-tooltip-row"><span>💵 Comisión est.</span><span>${comision}</span></div>
            <hr class="card-tooltip-divider">
            <div class="card-tooltip-note">💡 Click en "Asignarme" para tomar este lead</div>
        `;

        // Posicionar
        const rect = card.getBoundingClientRect();
        let top = rect.top + window.scrollY;
        let left = rect.right + 10;
        // Si se sale de la pantalla por la derecha, mostrar a la izquierda
        if (left + 270 > window.innerWidth) left = rect.left - 270;
        tooltip.style.top = Math.max(8, top) + 'px';
        tooltip.style.left = left + 'px';
        tooltip.classList.add('visible');
    });

    document.addEventListener('mouseout', e => {
        const card = e.target.closest('.kanban-card:not(.skeleton)');
        if (card && !card.contains(e.relatedTarget)) tooltip.classList.remove('visible');
        if (!e.target.closest('.kanban-card')) tooltip.classList.remove('visible');
    });
})();

/* ──────────────────────────────────────────────────────────────
   ✋  BOTÓN "ASIGNARME" EN CADA TARJETA
────────────────────────────────────────────────────────────── */
function asignarme(card) {
    const asesorActual = document.getElementById('select-asesor').value;
    if (asesorActual === 'Todos') {
        showToast('⚠️ Seleccioná primero tu nombre en el selector del sidebar');
        return;
    }
    const data = card._matchData;
    const nombre = data ? (data._asesor || 'Lead') : 'Lead';
    card.style.outline = '2px solid var(--brand)';
    card.querySelector('.btn-assign').textContent = '✓ Asignado';
    card.querySelector('.btn-assign').style.background = 'var(--success)';
    showToast(`✅ ${asesorActual} tomó el lead de ${nombre}`);

    // ⚡ Guardar en Supabase
    if (data && data.id) {
        guardarEstadoEnSupabase(data.id, data._estadoNorm, asesorActual);
    }
}

/* ──────────────────────────────────────────────────────────────
   🔔  TOAST HELPER
────────────────────────────────────────────────────────────── */
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

/* ──────────────────────────────────────────────────────────────
   🖱️  DRAG & DROP EN EL KANBAN
────────────────────────────────────────────────────────────── */
(function initDragDrop() {
    let dragCard = null;
    let ghost = null;
    let offsetX = 0, offsetY = 0;
    let originalCol = null;

    const colNames = {
        'col-pendientes':  'Nuevos Contactos',
        'col-contactados': 'En Gestión',
        'col-visita':      'Visita Agendada',
        'col-cerrados':    'Operación Ganada',
        'col-descartados': 'Descartados'
    };

    // Inicializar drag en tarjetas nuevas (se llama desde renderKanban)
    window.initDragOnCards = function() {
        document.querySelectorAll('.kanban-card:not(.skeleton)').forEach(card => {
            if (card._dragInited) return;
            card._dragInited = true;
            card.addEventListener('mousedown', onMouseDown);
        });
    };

    function onMouseDown(e) {
        // No iniciar drag si el click es en el botón de asignar
        if (e.target.closest('.btn-assign')) return;
        if (e.button !== 0) return;

        dragCard = e.currentTarget;
        originalCol = dragCard.closest('.kanban-cards');

        const rect = dragCard.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        // Crear ghost visual
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.innerHTML = dragCard.innerHTML;
        ghost.style.left = (e.clientX - offsetX) + 'px';
        ghost.style.top  = (e.clientY - offsetY) + 'px';
        document.body.appendChild(ghost);

        // Marcar tarjeta original como "arrastrando"
        setTimeout(() => dragCard.classList.add('dragging'), 0);

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup',   onMouseUp);
        e.preventDefault();
    }

    function onMouseMove(e) {
        if (!ghost) return;
        ghost.style.left = (e.clientX - offsetX) + 'px';
        ghost.style.top  = (e.clientY - offsetY) + 'px';

        // Limpiar highlight anterior
        document.querySelectorAll('.kanban-cards.drag-over').forEach(c => c.classList.remove('drag-over'));

        // Detectar columna bajo el cursor (ignorando el ghost)
        ghost.style.display = 'none';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        ghost.style.display = '';

        const targetCol = el ? el.closest('.kanban-cards') : null;
        if (targetCol && targetCol !== originalCol) {
            targetCol.classList.add('drag-over');
        }
    }

    function onMouseUp(e) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   onMouseUp);

        if (ghost) { ghost.remove(); ghost = null; }
        if (!dragCard) return;

        dragCard.classList.remove('dragging');

        // Detectar columna destino
        ghost = null;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const targetCol = el ? el.closest('.kanban-cards') : null;

        document.querySelectorAll('.kanban-cards.drag-over').forEach(c => c.classList.remove('drag-over'));

        if (targetCol && targetCol !== originalCol) {
            // Mover tarjeta a la nueva columna
            targetCol.appendChild(dragCard);

            const colId = targetCol.id;
            const newState = colNames[colId] || colId;
            const leadName = dragCard._matchData ? (dragCard._matchData._asesor || 'Lead') : 'Lead';

            // ⚡ Mapear columna a estado y guardar en Supabase
            const colToEstado = {
                'col-pendientes':  'Pendiente',
                'col-contactados': 'Contactado',
                'col-visita':      'Visita',
                'col-cerrados':    'Cerrado',
                'col-descartados': 'Descartado'
            };
            const nuevoEstado = colToEstado[colId];
            if (dragCard._matchData) {
                dragCard._matchData._estadoNorm = nuevoEstado;
                const matchId = dragCard._matchData.id;
                if (matchId) guardarEstadoEnSupabase(matchId, nuevoEstado);
            }

            // Actualizar contadores
            actualizarContadores();

            // Toast de confirmación
            const emojis = {
                'col-pendientes':  '🔵',
                'col-contactados': '🟡',
                'col-visita':      '🩵',
                'col-cerrados':    '🟢',
                'col-descartados': '⚪'
            };
            showToast(`${emojis[colId] || '📋'} "${leadName}" movido a ${newState}`);
        }

        dragCard = null;
        originalCol = null;
    }

    // Actualizar badges/contadores sin re-renderizar todo
    function actualizarContadores() {
        const colMap = {
            'col-pendientes':  'count-pendientes',
            'col-contactados': 'count-contactados',
            'col-visita':      'count-visita',
            'col-cerrados':    'count-cerrados',
            'col-descartados': 'count-descartados'
        };
        Object.entries(colMap).forEach(([colId, countId]) => {
            const col = document.getElementById(colId);
            const counter = document.getElementById(countId);
            if (col && counter) {
                const n = col.querySelectorAll('.kanban-card:not(.skeleton)').length;
                counter.textContent = n;
            }
        });
    }

    // Hook: cada vez que se renderiza el kanban, inicializar drag en las nuevas tarjetas
    const origRenderKanban = window.renderKanban;
    if (origRenderKanban) {
        window.renderKanban = function(data) {
            origRenderKanban(data);
            setTimeout(window.initDragOnCards, 50);
        };
    }

    // También inicializar en tarjetas ya existentes
    document.addEventListener('DOMContentLoaded', () => setTimeout(window.initDragOnCards, 500));
    setTimeout(window.initDragOnCards, 1000);
})();

/* ──────────────────────────────────────────────────────────────
   🏷️  FILTER CHIPS — Precio y Zona
────────────────────────────────────────────────────────────── */
let activeFilters = { precio: null, zona: null };

function activarChip(btn, tipo) {
    const group = btn.closest('.filter-chips');
    const wasActive = btn.classList.contains('active');

    // Desactivar todos en el grupo
    group.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));

    if (wasActive) {
        // Toggle off
        activeFilters[tipo] = null;
    } else {
        btn.classList.add('active');
        if (tipo === 'precio') {
            activeFilters.precio = { min: +btn.dataset.min, max: +btn.dataset.max };
        } else {
            activeFilters.zona = btn.dataset.zona;
        }
    }

    aplicarFiltrosChips();
}

function aplicarFiltrosChips() {
    const q = (document.getElementById('kanban-search')?.value || '').trim().toLowerCase();
    const items = document.querySelectorAll('.kanban-cards .kanban-card:not(.skeleton), #leads-table-body tr');
    let visibleCards = 0;

    items.forEach(item => {
        const data = item._matchData;
        if (!data) { item.style.display = ''; return; }

        let mostrar = true;

        // Filtro de texto
        if (q && !item.textContent.toLowerCase().includes(q)) mostrar = false;

        // Filtro de precio
        if (activeFilters.precio && mostrar) {
            const p = data._precioNum || 0;
            if (p < activeFilters.precio.min || p > activeFilters.precio.max) mostrar = false;
        }

        // Filtro de zona
        if (activeFilters.zona && mostrar) {
            const texto = ((data._barrioLower || '') + ' ' + (data._zonas || '')).toLowerCase();
            if (!texto.includes(activeFilters.zona)) mostrar = false;
        }

        item.style.display = mostrar ? '' : 'none';
        
        if (mostrar && item.classList.contains('kanban-card')) {
            visibleCards++;
        }
    });

    // Actualizar contador de búsqueda
    const hasFilter = activeFilters.precio || activeFilters.zona || q;
    const countEl = document.getElementById('search-count');
    const countNum = document.getElementById('search-count-num');
    if (hasFilter && countEl) {
        countEl.style.display = 'block';
        countNum.textContent = visibleCards;
    } else if (countEl) {
        countEl.style.display = 'none';
    }
}

/* ──────────────────────────────────────────────────────────────
   📋  DRAWER DE DETALLE — Abrir / Cerrar / Contenido
────────────────────────────────────────────────────────────── */
let drawerCurrentCard = null;

function abrirDrawer(card) {
    const data = card._matchData;
    if (!data) return;
    drawerCurrentCard = card;

    const drawer = document.getElementById('lead-drawer');
    const overlay = document.getElementById('drawer-overlay');
    const body = document.getElementById('drawer-body');
    const title = document.getElementById('drawer-title');

    const nombre = data._asesor || 'Lead sin nombre';
    const score = data._scoreNum || 0;
    const precio = data._precioNum > 0 ? 'USD ' + data._precioNum.toLocaleString('es-AR') : 'A consultar';
    const comision = data._comisionPotencial > 0 ? 'USD ' + data._comisionPotencial.toLocaleString('es-AR') : '–';
    const barrio = (data._barrioLower || data._zonas || '–').replace(/,/g, ' · ');
    const empresa = data._empresa || '–';
    const fuente = data['🏢 VENDEDOR (Fuente/Agencia)'] || data.Fuente || '–';
    const fecha = data['Fecha Match'] || data['Fecha'] || '–';
    const zonas = data._zonas || data['Zonas Buscadas'] || '–';
    const tipo = data.tipo_propiedad || data['Tipo'] || '–';
    const operacion = data.operacion || data['Operacion'] || '–';

    // Score color
    const scoreColor = score >= 90 ? '#10b981' : score >= 75 ? '#f59e0b' : '#7c3aed';
    const scoreBg = score >= 90 ? '#d1fae5' : score >= 75 ? '#fef3c7' : '#ede9fe';

    title.textContent = nombre;

    body.innerHTML = `
        <!-- Score badge -->
        <div class="drawer-section">
            <div class="drawer-score-badge" style="background:${scoreBg};color:${scoreColor}">
                ⭐ Score de compatibilidad: <strong>${score} pts</strong>
            </div>
        </div>

        <!-- Precio -->
        <div class="drawer-section">
            <div class="drawer-section-title">💰 Precio y Comisión Estimada</div>
            <div class="drawer-price">${precio}</div>
            <div class="drawer-commission">✅ Comisión estimada (3%): ${comision}</div>
        </div>

        <!-- Comprador (Lead) -->
        <div class="drawer-section">
            <div class="drawer-section-title">👤 Comprador / Lead</div>
            <div class="drawer-row">
                <span class="drawer-row-label">Nombre / Asesor</span>
                <span class="drawer-row-value">${nombre}</span>
            </div>
            <div class="drawer-row">
                <span class="drawer-row-label">Empresa</span>
                <span class="drawer-row-value">${empresa}</span>
            </div>
            <div class="drawer-row">
                <span class="drawer-row-label">Zonas buscadas</span>
                <span class="drawer-row-value">${zonas}</span>
            </div>
        </div>

        <!-- Propiedad -->
        <div class="drawer-section">
            <div class="drawer-section-title">🏠 Propiedad</div>
            <div class="drawer-row">
                <span class="drawer-row-label">Barrio</span>
                <span class="drawer-row-value">${barrio}</span>
            </div>
            <div class="drawer-row">
                <span class="drawer-row-label">Tipo</span>
                <span class="drawer-row-value">${tipo}</span>
            </div>
            <div class="drawer-row">
                <span class="drawer-row-label">Operación</span>
                <span class="drawer-row-value">${operacion}</span>
            </div>
            <div class="drawer-row">
                <span class="drawer-row-label">Fuente</span>
                <span class="drawer-row-value"><span class="drawer-tag">${fuente}</span></span>
            </div>
        </div>

        <!-- Historial -->
        <div class="drawer-section">
            <div class="drawer-section-title">📅 Historial</div>
            <div class="drawer-row">
                <span class="drawer-row-label">Fecha del match</span>
                <span class="drawer-row-value">${fecha}</span>
            </div>
            <div class="drawer-row">
                <span class="drawer-row-label">Estado actual</span>
                <span class="drawer-row-value"><span class="drawer-tag">${data._estadoNorm || 'Pendiente'}</span></span>
            </div>
        </div>
    `;

    drawer.classList.add('open');
    overlay.classList.add('open');
}

function cerrarDrawer() {
    document.getElementById('lead-drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
    drawerCurrentCard = null;
}

function asignarDesdeDrawer() {
    if (!drawerCurrentCard) return;
    asignarme(drawerCurrentCard);
    cerrarDrawer();
}

// Cerrar con Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrarDrawer();
});

// Abrir drawer al hacer click en una tarjeta (sin drag) o en una fila de tabla
document.addEventListener('click', e => {
    const card = e.target.closest('.kanban-card:not(.skeleton)');
    const row = e.target.closest('#leads-table-body tr');
    
    const targetEl = card || row;
    if (!targetEl) return;
    
    if (e.target.closest('.btn-assign')) return; // no abrir si clickeó asignarme
    if (targetEl._dragged) return;               // no abrir si fue un drag
    
    abrirDrawer(targetEl);
});

/* ──────────────────────────────────────────────────────────────
   📋  TABLE VIEW LOGIC
────────────────────────────────────────────────────────────── */
let currentSortCol = 'score';
let currentSortDesc = true;
let currentViewMode = 'board';

window.toggleKanbanView = function(mode) {
    currentViewMode = mode;
    document.getElementById('btn-view-board').classList.toggle('active', mode === 'board');
    document.getElementById('btn-view-table').classList.toggle('active', mode === 'table');
    
    const board = document.querySelector('.kanban-board');
    const table = document.getElementById('kanban-table-container');
    
    if (mode === 'board') {
        board.classList.remove('hide');
        table.classList.remove('active');
    } else {
        board.classList.add('hide');
        table.classList.add('active');
        aplicarFiltro(); // Forzar render de la tabla
    }
};

window.renderTable = function(data) {
    const tbody = document.getElementById('leads-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Sort data
    const sorted = [...data].sort((a, b) => {
        let valA, valB;
        if (currentSortCol === 'score') { valA = a._scoreNum; valB = b._scoreNum; }
        else if (currentSortCol === 'cliente') { valA = (a._asesor || '').toLowerCase(); valB = (b._asesor || '').toLowerCase(); }
        else if (currentSortCol === 'precio') { valA = a._precioNum; valB = b._precioNum; }
        else if (currentSortCol === 'zona') { valA = (a._barrioLower || '').toLowerCase(); valB = (b._barrioLower || '').toLowerCase(); }
        else if (currentSortCol === 'estado') { valA = (a._estadoNorm || '').toLowerCase(); valB = (b._estadoNorm || '').toLowerCase(); }
        else if (currentSortCol === 'asesor') { valA = (a._asesorAsignado || '').toLowerCase(); valB = (b._asesorAsignado || '').toLowerCase(); }
        
        if (valA < valB) return currentSortDesc ? 1 : -1;
        if (valA > valB) return currentSortDesc ? -1 : 1;
        return 0;
    });

    sorted.forEach(d => {
        const tr = document.createElement('tr');
        tr._matchData = d;
        
        // Formateos
        const scoreColor = d._scoreNum >= 90 ? '#10b981' : d._scoreNum >= 75 ? '#f59e0b' : '#7c3aed';
        const scoreBg = d._scoreNum >= 90 ? '#d1fae5' : d._scoreNum >= 75 ? '#fef3c7' : '#ede9fe';
        const precioTxt = d._precioNum > 0 ? 'USD ' + d._precioNum.toLocaleString('es-AR') : '–';
        const zonasTxt = (d._barrioLower || d._zonas || '').substring(0, 30);
        
        tr.innerHTML = `
            <td><span class="drawer-tag" style="background:${scoreBg};color:${scoreColor}">${d._scoreNum}</span></td>
            <td style="font-weight:700">${d._asesor || 'Lead'}</td>
            <td style="font-weight:800;color:var(--success)">${precioTxt}</td>
            <td style="text-transform:capitalize">${zonasTxt}</td>
            <td><span class="drawer-tag">${d._estadoNorm || 'Pendiente'}</span></td>
            <td><span class="drawer-tag" style="background:var(--bg);color:var(--muted)">${d._asesorAsignado || 'Sin asignar'}</span></td>
        `;
        
        tbody.appendChild(tr);
    });

    // Reaplicar filtros para ocular filas si hay búsqueda/chips activos
    aplicarFiltrosChips();
};

window.sortTable = function(col) {
    if (currentSortCol === col) {
        currentSortDesc = !currentSortDesc;
    } else {
        currentSortCol = col;
        currentSortDesc = true;
    }
    aplicarFiltro();
};

/* ─── COMMAND PALETTE (⌘K) ────────────────────────────────── */
let cmdkSelectedIndex = -1;
let cmdkResultsData = [];

window.openCmdK = function() {
    const overlay = document.getElementById('cmdk-overlay');
    if (overlay.classList.contains('open')) return;
    overlay.classList.add('open');
    const input = document.getElementById('cmdk-input');
    input.value = '';
    renderCmdkResults();
    setTimeout(() => input.focus(), 50);
};

window.closeCmdK = function() {
    document.getElementById('cmdk-overlay').classList.remove('open');
};

document.addEventListener('keydown', e => {
    // Abrir con Cmd+K o Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCmdK();
    }
    // Cerrar con Escape
    if (e.key === 'Escape' && document.getElementById('cmdk-overlay').classList.contains('open')) {
        closeCmdK();
    }
    
    // Navegación con flechas si está abierto
    if (document.getElementById('cmdk-overlay').classList.contains('open')) {
        const items = document.querySelectorAll('.cmdk-item');
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            cmdkSelectedIndex = (cmdkSelectedIndex + 1) % items.length;
            updateCmdkSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            cmdkSelectedIndex = (cmdkSelectedIndex - 1 + items.length) % items.length;
            updateCmdkSelection(items);
        } else if (e.key === 'Enter' && cmdkSelectedIndex >= 0) {
            e.preventDefault();
            items[cmdkSelectedIndex].click();
        }
    }
});

function updateCmdkSelection(items) {
    items.forEach((item, idx) => {
        if (idx === cmdkSelectedIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

document.getElementById('cmdk-input')?.addEventListener('input', e => {
    renderCmdkResults(e.target.value);
});

function renderCmdkResults(query = '') {
    const q = query.trim().toLowerCase();
    const container = document.getElementById('cmdk-results');
    if (!container) return;
    
    container.innerHTML = '';
    cmdkSelectedIndex = -1;
    
    if (!q) {
        container.innerHTML = '<div class="cmdk-empty">Empezá a escribir para buscar...</div>';
        return;
    }
    
    // Filtrar
    cmdkResultsData = globalData.filter(d => {
        const text = ((d._asesor || '') + ' ' + (d._zonas || '') + ' ' + (d._barrioLower || '') + ' ' + (d.Fuente || '')).toLowerCase();
        return text.includes(q);
    }).slice(0, 50); // Limitar a 50 resultados
    
    if (cmdkResultsData.length === 0) {
        container.innerHTML = '<div class="cmdk-empty">No se encontraron resultados</div>';
        return;
    }
    
    cmdkResultsData.forEach((d, idx) => {
        const el = document.createElement('div');
        el.className = 'cmdk-item';
        
        const scoreColor = d._scoreNum >= 90 ? '#10b981' : d._scoreNum >= 75 ? '#f59e0b' : '#7c3aed';
        const scoreBg = d._scoreNum >= 90 ? '#d1fae5' : d._scoreNum >= 75 ? '#fef3c7' : '#ede9fe';
        const precioTxt = d._precioNum > 0 ? 'USD ' + d._precioNum.toLocaleString('es-AR') : 'Consultar';
        const zonasTxt = (d._barrioLower || d._zonas || '').substring(0, 30);
        
        el.innerHTML = `
            <div class="cmdk-item-score" style="background:${scoreBg};color:${scoreColor}">${d._scoreNum}</div>
            <div class="cmdk-item-info">
                <div class="cmdk-item-title">${d._asesor || 'Lead'} <span style="font-weight:400;color:var(--muted);margin-left:4px;">— ${d._estadoNorm || 'Pendiente'}</span></div>
                <div class="cmdk-item-subtitle">${zonasTxt} • ${d.Fuente || 'Desconocido'}</div>
            </div>
            <div class="cmdk-item-price">${precioTxt}</div>
        `;
        
        el._matchData = d;
        
        el.addEventListener('click', () => {
            closeCmdK();
            
            // Si la vista actual NO es el Kanban o la tabla, cambiar a Kanban
            if(document.getElementById('view-kanban').classList.contains('hide')) {
                switchView('kanban');
            }
            
            abrirDrawer(el);
        });
        
        container.appendChild(el);
    });
}
