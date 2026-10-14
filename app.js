(function(){
  "use strict";

  const $ = (sel, ctx) => (ctx||document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx||document).querySelectorAll(sel));

  const STORAGE_KEY = 'misionapp-data';
  const THEME_KEY = 'misionapp-theme';
  const DEFAULT_CENTER = [-9.19, -75.0152]; // Perú (vista completa del país)
  const DEFAULT_ZOOM = 5;

  const STATUS_LABEL = { no:'No visitada', visited:'Visitada', pending:'Pendiente' };
  const STATUS_CLASS = { no:'status-no', visited:'status-visited', pending:'status-pending' };
  const STATUS_COLOR_VAR = { no:'--danger', visited:'--ok', pending:'--warn' };

  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>'
  };

  function escapeHtml(str){
    return String(str==null?'':str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function todayISO(){
    const d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function fmtDate(iso){
    if(!iso) return '—';
    const parts = iso.split('-');
    if(parts.length!==3) return iso;
    return parts[2]+'/'+parts[1]+'/'+parts[0];
  }
  function fmtLatLng(lat,lng){
    return lat.toFixed(5)+', '+lng.toFixed(5);
  }

  /* ============== STATE ============== */
  function getDefaultState(){
    return {
      churches: [],
      houses: [],
      nextId: 1
    };
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || !Array.isArray(parsed.churches) || !Array.isArray(parsed.houses)) return null;
      if(typeof parsed.nextId !== 'number') parsed.nextId = computeNextId(parsed);
      return parsed;
    }catch(e){ return null; }
  }
  function computeNextId(s){
    let max = 0;
    s.churches.forEach(c=>{ if(c.id>max) max=c.id; });
    s.houses.forEach(h=>{ if(h.id>max) max=h.id; });
    return max+1;
  }
  function saveState(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch(e){ console.error('No se pudo guardar en localStorage', e); }
  }

  let state = loadState() || getDefaultState();
  let currentFilter = 'all';

  /* ============== THEME ============== */
  function applyTheme(theme){
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    $('#btnTheme').innerHTML = theme==='light' ? ICONS.moon : ICONS.sun;
    $('#btnTheme').title = theme==='light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro';
  }
  function initTheme(){
    const saved = localStorage.getItem(THEME_KEY) || 'light';
    applyTheme(saved);
  }

  /* ============== MAP ============== */
  const map = L.map('map', { zoomControl:true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  /* Capa 2D: mapa estándar OpenStreetMap */
  const topoLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);

  /* Capa 3D: imagen satelital/aérea con relieve (Esri World Imagery) */
  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    maxNativeZoom: 17,
    errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  });

  /* Control flotante 3D / 2D (arriba a la derecha del mapa) */
  let currentMapView = '2d';
  const mapViewToggle = L.control({ position:'topright' });
  mapViewToggle.onAdd = function(){
    const container = L.DomUtil.create('div', 'leaflet-bar map-view-toggle');
    container.innerHTML =
      '<button type="button" class="mvt-btn" id="btn3D" title="Vista satelital con relieve">3D</button>' +
      '<button type="button" class="mvt-btn active" id="btn2D" title="Vista topográfica plana">2D</button>';
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };
  mapViewToggle.addTo(map);

  function setMapView(view){
    if(view === currentMapView) return;
    const btn3D = $('#btn3D'), btn2D = $('#btn2D');
    if(view === '3d'){
      map.removeLayer(topoLayer);
      satelliteLayer.addTo(map);
      btn3D.classList.add('active'); btn2D.classList.remove('active');
    } else {
      map.removeLayer(satelliteLayer);
      topoLayer.addTo(map);
      btn2D.classList.add('active'); btn3D.classList.remove('active');
    }
    currentMapView = view;
  }
  $('#btn3D').addEventListener('click', ()=> setMapView('3d'));
  $('#btn2D').addEventListener('click', ()=> setMapView('2d'));

  const churchLayer = L.layerGroup().addTo(map);
  const houseLayer = L.layerGroup().addTo(map);
  const meLayer = L.layerGroup().addTo(map);

  function churchIcon(){
    return L.divIcon({ className:'', html:'<div class="church-pin"></div>', iconSize:[19,19], iconAnchor:[9,9] });
  }
  function houseIcon(status){
    const color = 'var('+(STATUS_COLOR_VAR[status]||'--danger')+')';
    return L.divIcon({ className:'', html:'<div class="house-pin" style="background:'+color+'"></div>', iconSize:[17,17], iconAnchor:[8,8] });
  }
  function meIcon(){
    return L.divIcon({
      className:'',
      html:'<div class="me-marker-wrap"><div class="me-pulse"></div><div class="me-dot"></div></div>',
      iconSize:[22,22], iconAnchor:[11,11]
    });
  }

  function buildChurchTooltip(c){
    return '<div class="tt-title">'+escapeHtml(c.name)+'</div><div class="tt-row">Iglesia · '+fmtLatLng(c.lat,c.lng)+'</div>';
  }
  function buildHouseTooltip(h){
    let rows = '<div class="tt-title">'+escapeHtml(h.name)+'</div>';
    rows += '<div class="tt-row">'+STATUS_LABEL[h.status]+(h.date?' · '+fmtDate(h.date):'')+'</div>';
    if(h.address) rows += '<div class="tt-row">'+escapeHtml(h.address)+'</div>';
    if(h.phone) rows += '<div class="tt-row">'+escapeHtml(h.phone)+'</div>';
    return rows;
  }

  function redrawMarkers(){
    churchLayer.clearLayers();
    houseLayer.clearLayers();
    state.churches.forEach(c=>{
      const m = L.marker([c.lat,c.lng], { icon: churchIcon() });
      m.bindTooltip(buildChurchTooltip(c), { direction:'top', offset:[0,-8], className:'lf-tt' });
      m.on('click', ()=> openModalForEdit('church', c.id));
      m.addTo(churchLayer);
    });
    state.houses.forEach(h=>{
      const m = L.marker([h.lat,h.lng], { icon: houseIcon(h.status) });
      m.bindTooltip(buildHouseTooltip(h), { direction:'top', offset:[0,-7], className:'lf-tt' });
      m.on('click', ()=> openModalForEdit('house', h.id));
      m.addTo(houseLayer);
    });
  }

  function flyToRecord(lat,lng){
    map.flyTo([lat,lng], Math.max(map.getZoom(), 16));
  }

  /* ============== PICKING MODE ============== */
  let pickingState = null; // { onPick, onCancel }
  const mapEl = document.getElementById('map');

  function startPicking(labelText, onPick, onCancel){
    pickingState = { onPick, onCancel };
    mapEl.classList.add('picking');
    $('#pickBannerText').textContent = labelText;
    $('#pickBanner').style.display = 'flex';
    map.on('click', onMapClickForPicking);
  }
  function onMapClickForPicking(e){
    finishPicking(e.latlng.lat, e.latlng.lng);
  }
  function finishPicking(lat,lng){
    if(!pickingState) return;
    const cb = pickingState.onPick;
    stopPickingUi();
    pickingState = null;
    if(cb) cb({lat,lng});
  }
  function cancelPicking(){
    if(!pickingState) return;
    const onCancel = pickingState.onCancel;
    stopPickingUi();
    pickingState = null;
    if(onCancel) onCancel();
  }
  function stopPickingUi(){
    mapEl.classList.remove('picking');
    $('#pickBanner').style.display = 'none';
    map.off('click', onMapClickForPicking);
  }

  /* ============== ADDRESS SEARCH ============== */
  async function searchAddress(){
    const q = $('#searchInput').value.trim();
    if(!q) return;
    const btn = $('#btnSearch');
    btn.disabled = true;
    try{
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
      const resp = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      const results = await resp.json();
      if(!results || results.length===0){
        alert('No se encontraron resultados para "'+q+'".');
        return;
      }
      const lat = parseFloat(results[0].lat);
      const lon = parseFloat(results[0].lon);
      if(pickingState){
        map.flyTo([lat,lon], 17);
        finishPicking(lat, lon);
      } else {
        map.flyTo([lat,lon], 16);
      }
    }catch(err){
      alert('No se pudo completar la búsqueda de dirección. Verifica tu conexión a internet.');
    }finally{
      btn.disabled = false;
    }
  }

  /* ============== LOCATE ME ============== */
  function locateMe(){
    if(!navigator.geolocation){
      alert('Tu navegador no soporta geolocalización.');
      return;
    }
    const btn = $('#btnLocateMe');
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        meLayer.clearLayers();
        L.marker([lat,lng], { icon: meIcon() }).addTo(meLayer);
        map.flyTo([lat,lng], 16);
        btn.disabled = false;
      },
      err=>{
        alert('No se pudo obtener tu ubicación: ' + (err && err.message ? err.message : 'permiso denegado o señal no disponible.'));
        btn.disabled = false;
      },
      { enableHighAccuracy:true, timeout:10000 }
    );
  }

  /* ============== RENDER: CHURCHES ============== */
  function renderChurches(){
    const tbody = $('#churchTbody');
    $('#churchCount').textContent = state.churches.length;
    if(state.churches.length===0){
      tbody.innerHTML = '<tr class="empty-row"><td colspan="2">Aún no agregaste ninguna iglesia.</td></tr>';
      return;
    }
    tbody.innerHTML = state.churches.map(c => (
      '<tr>' +
        '<td class="name-cell" data-action="fly" data-type="church" data-id="'+c.id+'">'+escapeHtml(c.name)+'</td>' +
        '<td><div class="row-actions">' +
          '<button class="icon-btn" data-action="edit" data-type="church" data-id="'+c.id+'" title="Editar">'+ICONS.edit+'</button>' +
          '<button class="icon-btn del" data-action="delete" data-type="church" data-id="'+c.id+'" title="Eliminar">'+ICONS.trash+'</button>' +
        '</div></td>' +
      '</tr>'
    )).join('');
  }

  /* ============== RENDER: HOUSES ============== */
  function filteredHouses(){
    if(currentFilter==='all') return state.houses;
    return state.houses.filter(h=>h.status===currentFilter);
  }
  function renderHouses(){
    const tbody = $('#houseTbody');
    const list = filteredHouses();
    $('#houseCount').textContent = list.length + (currentFilter==='all' ? '' : ' / '+state.houses.length);
    if(list.length===0){
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No hay casas en este filtro.</td></tr>';
    } else {
      tbody.innerHTML = list.map(h => (
        '<tr>' +
          '<td class="name-cell" data-action="fly" data-type="house" data-id="'+h.id+'">'+escapeHtml(h.name)+'</td>' +
          '<td><span class="status-pill '+STATUS_CLASS[h.status]+'"><span class="dot"></span>'+STATUS_LABEL[h.status]+'</span></td>' +
          '<td class="muted">'+fmtDate(h.date)+'</td>' +
          '<td><div class="row-actions">' +
            '<button class="icon-btn" data-action="edit" data-type="house" data-id="'+h.id+'" title="Editar">'+ICONS.edit+'</button>' +
            '<button class="icon-btn del" data-action="delete" data-type="house" data-id="'+h.id+'" title="Eliminar">'+ICONS.trash+'</button>' +
          '</div></td>' +
        '</tr>'
      )).join('');
    }
    updateKpis();
  }

  function updateKpis(){
    $('#kpiTotal').textContent = state.houses.length;
    $('#kpiVisited').textContent = state.houses.filter(h=>h.status==='visited').length;
    $('#kpiPending').textContent = state.houses.filter(h=>h.status==='pending').length;
  }

  function renderAll(){
    renderChurches();
    renderHouses();
    redrawMarkers();
  }

  /* ============== TABLE / TAB DELEGATION ============== */
  document.body.addEventListener('click', function(e){
    const actionBtn = e.target.closest('[data-action]');
    if(!actionBtn) return;
    const action = actionBtn.dataset.action;
    const type = actionBtn.dataset.type;
    const id = parseInt(actionBtn.dataset.id, 10);
    if(action==='edit') openModalForEdit(type, id);
    else if(action==='delete') deleteRecord(type, id);
    else if(action==='fly'){
      const rec = findRecord(type, id);
      if(rec) flyToRecord(rec.lat, rec.lng);
    }
  });

  $('#houseTabs').addEventListener('click', function(e){
    const tab = e.target.closest('.tab');
    if(!tab) return;
    $all('.tab', $('#houseTabs')).forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    renderHouses();
  });

  function findRecord(type, id){
    const list = type==='church' ? state.churches : state.houses;
    return list.find(r=>r.id===id);
  }

  function deleteRecord(type, id){
    const rec = findRecord(type, id);
    if(!rec) return;
    const label = type==='church' ? 'la iglesia' : 'la casa';
    if(!confirm('¿Eliminar '+label+' "'+rec.name+'"? Esta acción no se puede deshacer.')) return;
    if(type==='church') state.churches = state.churches.filter(r=>r.id!==id);
    else state.houses = state.houses.filter(r=>r.id!==id);
    saveState();
    renderAll();
  }

  /* ============== MODAL ============== */
  let modalType = null;   // 'church' | 'house'
  let modalEditId = null; // id or null (new)
  let modalLocation = null; // {lat,lng} or null

  function updateLocationDisplay(){
    $('#locationDisplay').textContent = modalLocation ? fmtLatLng(modalLocation.lat, modalLocation.lng) : 'Sin ubicación · usa "Cambiar en mapa"';
  }

  function setModalFieldsVisibility(type){
    const isHouse = type==='house';
    $('#fieldAddressWrap').style.display = isHouse ? 'flex' : 'none';
    $('#fieldPhoneWrap').style.display = isHouse ? 'flex' : 'none';
    $('#fieldStatusWrap').style.display = isHouse ? 'flex' : 'none';
    $('#fieldDateWrap').style.display = isHouse ? 'flex' : 'none';
    $('#fieldNotesWrap').style.display = isHouse ? 'flex' : 'none';
  }

  function resetForm(){
    $('#fieldName').value = '';
    $('#fieldAddress').value = '';
    $('#fieldPhone').value = '';
    $('#fieldStatus').value = 'no';
    $('#fieldDate').value = '';
    $('#fieldNotes').value = '';
    $('#fieldNameWrap').classList.remove('has-error');
    $('#fieldLocationWrap').classList.remove('has-error');
  }

  function fillForm(type, rec){
    $('#fieldName').value = rec.name || '';
    if(type==='house'){
      $('#fieldAddress').value = rec.address || '';
      $('#fieldPhone').value = rec.phone || '';
      $('#fieldStatus').value = rec.status || 'no';
      $('#fieldDate').value = rec.date || '';
      $('#fieldNotes').value = rec.notes || '';
    }
  }

  function showModal(){
    $('#modalTitle').textContent = (modalEditId ? 'Editar ' : 'Agregar ') + (modalType==='church' ? 'iglesia' : 'casa');
    setModalFieldsVisibility(modalType);
    updateLocationDisplay();
    $('#modalOverlay').classList.add('open');
  }
  function hideModal(){
    $('#modalOverlay').classList.remove('open');
  }

  function openModalForNew(type, presetLocation){
    resetForm();
    modalType = type;
    modalEditId = null;
    modalLocation = presetLocation || null;
    showModal();
  }
  function openModalForEdit(type, id){
    const rec = findRecord(type, id);
    if(!rec) return;
    resetForm();
    fillForm(type, rec);
    modalType = type;
    modalEditId = id;
    modalLocation = { lat: rec.lat, lng: rec.lng };
    showModal();
  }
  function openModalReopenAfterPick(loc){
    modalLocation = loc;
    showModal();
  }

  $('#btnAddChurch').addEventListener('click', ()=>{
    startPicking('Haz clic en el mapa para ubicar la iglesia', (loc)=>{
      openModalForNew('church', loc);
    }, null);
  });
  $('#btnAddHouse').addEventListener('click', ()=>{
    startPicking('Haz clic en el mapa para ubicar la casa', (loc)=>{
      openModalForNew('house', loc);
    }, null);
  });

  $('#btnChangeLocation').addEventListener('click', ()=>{
    hideModal();
    const label = modalType==='church' ? 'Haz clic en el mapa para ubicar la iglesia' : 'Haz clic en el mapa para ubicar la casa';
    startPicking(label, (loc)=>{
      openModalReopenAfterPick(loc);
    }, ()=>{
      showModal();
    });
  });

  $('#btnModalClose').addEventListener('click', hideModal);
  $('#btnModalCancel').addEventListener('click', hideModal);
  $('#modalOverlay').addEventListener('click', (e)=>{ if(e.target.id==='modalOverlay') hideModal(); });

  $('#fieldStatus').addEventListener('change', function(){
    if(this.value==='visited' && !$('#fieldDate').value){
      $('#fieldDate').value = todayISO();
    }
  });

  $('#btnModalSave').addEventListener('click', ()=>{
    const name = $('#fieldName').value.trim();
    let valid = true;

    $('#fieldNameWrap').classList.remove('has-error');
    $('#fieldLocationWrap').classList.remove('has-error');

    if(!name){ $('#fieldNameWrap').classList.add('has-error'); valid = false; }
    if(!modalLocation){ $('#fieldLocationWrap').classList.add('has-error'); valid = false; }
    if(!valid) return;

    if(modalType==='church'){
      if(modalEditId){
        const rec = findRecord('church', modalEditId);
        rec.name = name; rec.lat = modalLocation.lat; rec.lng = modalLocation.lng;
      } else {
        state.churches.push({ id: state.nextId++, name, lat: modalLocation.lat, lng: modalLocation.lng });
      }
    } else {
      let status = $('#fieldStatus').value;
      let date = $('#fieldDate').value;
      if(status==='visited' && !date) date = todayISO();
      const payload = {
        name, lat: modalLocation.lat, lng: modalLocation.lng,
        address: $('#fieldAddress').value.trim(),
        phone: $('#fieldPhone').value.trim(),
        status, notes: $('#fieldNotes').value.trim(), date
      };
      if(modalEditId){
        const rec = findRecord('house', modalEditId);
        Object.assign(rec, payload);
      } else {
        payload.id = state.nextId++;
        state.houses.push(payload);
      }
    }
    saveState();
    renderAll();
    hideModal();
  });

  /* ============== EXPORT / IMPORT ============== */
  function exportData(){
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'misionapp-datos.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  function importData(file){
    const reader = new FileReader();
    reader.onload = function(){
      let parsed;
      try{ parsed = JSON.parse(reader.result); }
      catch(e){ alert('El archivo no es un JSON válido.'); return; }
      if(!parsed || !Array.isArray(parsed.churches) || !Array.isArray(parsed.houses)){
        alert('El archivo no tiene el formato esperado (se requieren las claves "churches" y "houses").');
        return;
      }
      if(!confirm('Esto reemplazará todos los datos actuales ('+state.churches.length+' iglesias y '+state.houses.length+' casas) por los del archivo importado. ¿Continuar?')) return;
      state = {
        churches: parsed.churches,
        houses: parsed.houses,
        nextId: typeof parsed.nextId==='number' ? parsed.nextId : computeNextId(parsed)
      };
      saveState();
      renderAll();
    };
    reader.onerror = function(){ alert('No se pudo leer el archivo seleccionado.'); };
    reader.readAsText(file);
  }

  $('#fileImport').addEventListener('change', function(){
    if(this.files && this.files[0]) importData(this.files[0]);
    this.value = '';
  });

  /* ============== WIRE UP BUTTONS WITH ICONS/LABELS ============== */
  $('#btnExport').innerHTML = ICONS.download + ' Exportar';
  $('#btnImport').innerHTML = ICONS.upload + ' Importar';
  $('#btnSearch').innerHTML = ICONS.search;
  $('#btnLocateMe').innerHTML = ICONS.locate + ' Mi ubicación';
  $('#btnAddChurch').innerHTML = ICONS.plus + ' Agregar iglesia';
  $('#btnAddHouse').innerHTML = ICONS.plus + ' Agregar casa';

  $('#btnExport').addEventListener('click', exportData);
  $('#btnImport').addEventListener('click', ()=> $('#fileImport').click());
  $('#btnSearch').addEventListener('click', searchAddress);
  $('#searchInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') searchAddress(); });
  $('#btnLocateMe').addEventListener('click', locateMe);
  $('#btnCancelPick').addEventListener('click', cancelPicking);
  $('#btnTheme').addEventListener('click', ()=>{
    const cur = document.body.getAttribute('data-theme');
    applyTheme(cur==='light' ? 'dark' : 'light');
  });

  /* ============== INIT ============== */
  initTheme();
  renderAll();
  setTimeout(()=> map.invalidateSize(), 200);

})();
