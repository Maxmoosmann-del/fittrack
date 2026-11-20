/* =========================================================
   FITTRACK — Kalorien & Workout Tracker
   Daten liegen lokal im Browser (localStorage).
   ========================================================= */

const STORE = {
  goals: 'ft_goals',
  foods: 'ft_foods',
  log: 'ft_log',
  workouts: 'ft_workouts',
  exercises: 'ft_exercises',
  state: 'ft_state',
  cardio: 'ft_cardio',
  appSettings: 'ft_appsettings',
  water: 'ft_water',
  habits: 'ft_habits',
  habitLog: 'ft_habitlog',
  // Nicht Teil des Backups, aber Teil von "Alle Daten löschen":
  geminiKey: 'ft_gemini_key',
  seeded: 'ft_seeded'
};

const TABS = ['today','foods','workouts'];

// ---------- State ----------
let state = {
  date: todayStr(),
  tab: 'today'
};
let goals = {kcal:2200, protein:150, carbs:250, fat:70};
let foods = []; // {id,name,kcal,protein,carbs,fat}
let log = {};   // {dateStr: [{foodId,grams,meal}]}
let workouts = {}; // {dateStr: [{exercise, sets:[{weight,reps}]}]}
let exerciseNames = []; // remembered names for autocomplete
let cardio = {}; // {dateStr: [{id,name,intensity,duration,kcalBurned}]}
let appSettings = {bodyWeight: 75, cardioAddToBudget: true, waterGoal: 8, waterGlassSize: 250};
let water = {}; // {dateStr: number} — glasses drunk
let habits = []; // [{id, name}] — up to 3 habits
let habitLog = {}; // {dateStr: {habitId: true}}

// ---------- Helpers ----------
function todayStr(d){const x=d||new Date();const y=x.getFullYear();const m=String(x.getMonth()+1).padStart(2,'0');const dd=String(x.getDate()).padStart(2,'0');return `${y}-${m}-${dd}`;}
function fromStr(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);}
function fmtDate(s){
  const d = fromStr(s);
  const today = new Date();today.setHours(0,0,0,0);
  const diff = Math.round((d - today)/(86400000));
  if(diff===0) return 'Heute';
  if(diff===-1) return 'Gestern';
  if(diff===1) return 'Morgen';
  return d.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'});
}
function fmtSubDate(s){
  return fromStr(s).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function $(sel){return document.querySelector(sel)}
function $$(sel){return document.querySelectorAll(sel)}
// Was gehört zu welchem localStorage-Key? save() ohne Argumente schreibt alles,
// save('log','state') nur die genannten Bereiche.
const WRITERS = {
  goals:       ()=>[STORE.goals,       goals],
  foods:       ()=>[STORE.foods,       foods],
  log:         ()=>[STORE.log,         log],
  workouts:    ()=>[STORE.workouts,    workouts],
  exercises:   ()=>[STORE.exercises,   exerciseNames],
  state:       ()=>[STORE.state,       state],
  cardio:      ()=>[STORE.cardio,      cardio],
  appSettings: ()=>[STORE.appSettings, appSettings],
  water:       ()=>[STORE.water,       water],
  habits:      ()=>[STORE.habits,      habits],
  habitLog:    ()=>[STORE.habitLog,    habitLog]
};
function save(...parts){
  const keys = parts.length ? parts : Object.keys(WRITERS);
  try{
    for(const k of keys){
      const [storeKey, value] = WRITERS[k]();
      localStorage.setItem(storeKey, JSON.stringify(value));
    }
    return true;
  }catch(err){
    console.error('Speichern fehlgeschlagen', err);
    toast('Speichern fehlgeschlagen – Gerätespeicher voll?');
    return false;
  }
}
// Jeden Bereich einzeln lesen: ein kaputter Eintrag darf nicht alle folgenden
// mitreißen (vorher hätte ein defektes ft_log auch Wasser und Habits verschluckt).
function read(key){
  try{
    return JSON.parse(localStorage.getItem(key) || 'null');
  }catch(err){
    console.error('Konnte ' + key + ' nicht lesen', err);
    return null;
  }
}
function load(){
  const g  = read(STORE.goals);       if(g)  goals = {...goals,...g};
  const f  = read(STORE.foods);       if(Array.isArray(f)) foods = f;
  const l  = read(STORE.log);         if(l)  log = l;
  const w  = read(STORE.workouts);    if(w)  workouts = w;
  const e  = read(STORE.exercises);   if(Array.isArray(e)) exerciseNames = e;
  const s  = read(STORE.state);       if(s)  state = {...state,...s,date:todayStr()};
  const c  = read(STORE.cardio);      if(c)  cardio = c;
  const as = read(STORE.appSettings); if(as) appSettings = {...appSettings,...as};
  const wa = read(STORE.water);       if(wa) water = wa;
  const hb = read(STORE.habits);      if(Array.isArray(hb)) habits = hb;
  const hl = read(STORE.habitLog);    if(hl) habitLog = hl;
}
function escapeHtml(s){return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// ---------- Toast (with optional undo) ----------
function toast(msg, undoFn) {
  const t = $('#toast');
  t.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (undoFn) {
    const btn = document.createElement('button');
    btn.className = 'undo-btn';
    btn.textContent = 'Rückgängig';
    btn.addEventListener('click', () => {
      undoFn();
      t.classList.remove('show');
      clearTimeout(toast._t);
    });
    t.appendChild(btn);
  }
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), undoFn ? 4000 : 1800);
}

// ---------- Validation ----------
function showFieldError(inputEl, msg) {
  inputEl.classList.add('error');
  inputEl.focus();
  toast(msg);
  inputEl.addEventListener('input', () => inputEl.classList.remove('error'), {once: true});
}

// Number() statt parseInt/parseFloat: "12abc" ist damit ungültig statt still 12.
function toNumber(val) {
  const s = String(val ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function validatePositiveInt(val) {
  const n = toNumber(val);
  return n !== null && n > 0 ? Math.round(n) : null;
}

function validateNonNegativeFloat(val) {
  const n = toNumber(val);
  return n !== null && n >= 0 ? n : null;
}

// ---------- Render ----------
const MEALS = [
  {key:'breakfast', label:'Frühstück'},
  {key:'lunch',     label:'Mittagessen'},
  {key:'dinner',    label:'Abendessen'},
  {key:'snack',     label:'Snacks'}
];

function calcEntry(e, index){
  const f = index ? index.get(e.foodId) : foods.find(x=>x.id===e.foodId);
  if(!f) return {name:'(gelöscht)',kcal:0,protein:0,carbs:0,fat:0,grams:e.grams};
  const r = e.grams/100;
  return {
    name:f.name,
    grams:e.grams,
    kcal: Math.round(f.kcal*r),
    protein: Math.round(f.protein*r*10)/10,
    carbs: Math.round(f.carbs*r*10)/10,
    fat: Math.round(f.fat*r*10)/10
  };
}

// Balkenbreite + ARIA-Werte in einem Rutsch; goal<=0 ergibt 0% statt NaN%.
function setBar(barId, value, goal){
  const bar = $('#'+barId);
  bar.style.width = (goal > 0 ? Math.min(100, value/goal*100) : 0) + '%';
  const wrap = bar.parentElement;
  if(wrap && wrap.getAttribute('role') === 'progressbar'){
    wrap.setAttribute('aria-valuemin', '0');
    wrap.setAttribute('aria-valuemax', String(goal));
    wrap.setAttribute('aria-valuenow', String(Math.round(value)));
  }
}

function renderToday(){
  const day = state.date;               // für Undo-Closures festhalten
  $('#dateLabel').textContent = fmtDate(day);
  $('#dateSub').textContent = fmtSubDate(day);

  const entries = log[day] || [];
  const foodIndex = new Map(foods.map(f=>[f.id, f]));
  const calcs = entries.map(e=>calcEntry(e, foodIndex));

  let totals = {kcal:0,protein:0,carbs:0,fat:0};
  calcs.forEach(c=>{totals.kcal+=c.kcal;totals.protein+=c.protein;totals.carbs+=c.carbs;totals.fat+=c.fat;});
  totals.protein=Math.round(totals.protein);totals.carbs=Math.round(totals.carbs);totals.fat=Math.round(totals.fat);

  const cardioEntries = cardio[day] || [];
  const kcalBurned = cardioEntries.reduce((s,e)=>s+e.kcalBurned,0);
  const effectiveGoal = (appSettings.cardioAddToBudget && kcalBurned > 0)
    ? goals.kcal + kcalBurned : goals.kcal;

  $('#kcalNum').textContent = totals.kcal;
  $('#kcalGoal').textContent = effectiveGoal;
  $('#kcalLeft').textContent = Math.max(effectiveGoal-totals.kcal, 0);
  setBar('kcalBar', totals.kcal, effectiveGoal);

  const burnedRow = $('#cardioBurnedRow');
  if(kcalBurned > 0 && appSettings.cardioAddToBudget){
    burnedRow.style.display='flex';
    $('#cardioBurnedText').textContent = `${kcalBurned} kcal verbrannt → ${effectiveGoal} kcal Tagesbedarf`;
  } else {
    burnedRow.style.display='none';
  }

  $('#proteinNum').textContent = totals.protein;
  $('#proteinGoal').textContent = goals.protein;
  setBar('proteinBar', totals.protein, goals.protein);

  $('#carbsNum').textContent = totals.carbs;
  $('#carbsGoal').textContent = goals.carbs;
  setBar('carbsBar', totals.carbs, goals.carbs);

  $('#fatNum').textContent = totals.fat;
  $('#fatGoal').textContent = goals.fat;
  setBar('fatBar', totals.fat, goals.fat);

  const mealsEl = $('#meals');
  mealsEl.innerHTML='';
  MEALS.forEach(m=>{
    const mealEntries = entries.map((e,i)=>({...e,_i:i})).filter(e=>e.meal===m.key);
    const kcal = mealEntries.reduce((s,e)=>s+calcs[e._i].kcal,0);
    const wrap = document.createElement('div');
    wrap.className='meal';

    const head = document.createElement('div');
    head.className='meal-head';
    head.innerHTML = `<div class="title">${m.label}</div><div class="kcal">${kcal} kcal</div>`;
    wrap.appendChild(head);

    const list = document.createElement('div');
    list.className='entries';
    wrap.appendChild(list);

    mealEntries.forEach(e=>{
      const c = calcs[e._i];
      const div = document.createElement('div');
      div.className='entry';

      const left = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className='name';
      nameEl.textContent = c.name;
      const metaEl = document.createElement('div');
      metaEl.className='meta';
      metaEl.textContent = `${c.grams} g · P ${c.protein}g · K ${c.carbs}g · F ${c.fat}g`;
      left.appendChild(nameEl);
      left.appendChild(metaEl);

      const right = document.createElement('div');
      right.className='right';
      const kcalEl = document.createElement('div');
      kcalEl.className='kcal';
      kcalEl.textContent = `${c.kcal} kcal`;

      const btnRow = document.createElement('div');
      btnRow.className='entry-actions';

      const editBtn = document.createElement('button');
      editBtn.className='mini-btn accent';
      editBtn.setAttribute('aria-label', `${c.name} Portion bearbeiten`);
      editBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;
      editBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        const food = foodIndex.get(e.foodId);
        if(food) openPortionEdit(food, e._i);
      });

      const delBtn = document.createElement('button');
      delBtn.className='mini-btn';
      delBtn.setAttribute('aria-label', `${c.name} aus ${m.label} löschen`);
      delBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
      delBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        const removed = log[day].splice(e._i, 1)[0];
        if (log[day].length === 0) delete log[day];
        save('log'); renderToday();
        toast(`${c.name} entfernt`, () => {
          if (!log[day]) log[day] = [];
          log[day].splice(e._i, 0, removed);
          save('log'); renderToday();
        });
      });

      btnRow.appendChild(editBtn);
      btnRow.appendChild(delBtn);
      right.appendChild(kcalEl);
      right.appendChild(btnRow);

      div.appendChild(left);
      div.appendChild(right);
      list.appendChild(div);
    });

    const addBtn = document.createElement('button');
    addBtn.className='add-btn';
    addBtn.setAttribute('aria-label', `${m.label} hinzufügen`);
    addBtn.textContent = '+ Hinzufügen';
    addBtn.addEventListener('click', ()=>openLogFood(m.key));
    wrap.appendChild(addBtn);

    mealsEl.appendChild(wrap);
  });
}

// ---------- Water Tracker ----------
function renderWater(){
  const goal = appSettings.waterGoal || 8;
  const size = appSettings.waterGlassSize || 250;
  const drunk = water[state.date] || 0;
  const totalMl = drunk * size;

  const el = $('#waterTracker');
  if(!el) return;

  let glasses = '';
  for(let i=0;i<goal;i++){
    const filled = i < drunk;
    glasses += `<button class="glass-btn${filled?' filled':''}" data-idx="${i}" aria-label="Glas ${i+1}${filled?' (gefüllt)':''}" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 3l1 16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-16Z"/>
        ${filled?'<path d="M5 10h14" stroke-width="0" fill="currentColor" opacity="0.25"/><path d="M6 10l.5 9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l.5-9Z" stroke="none" fill="currentColor" opacity="0.35"/>':''}
      </svg>
    </button>`;
  }

  el.innerHTML = `
    <div class="water-header">
      <div>
        <div class="water-count">${drunk}<span class="water-unit"> / ${goal} Gläser</span></div>
        <div class="water-ml">${totalMl > 0 ? totalMl + ' ml' : '0 ml'}</div>
      </div>
      <button class="water-reset-btn" id="waterResetBtn" type="button" aria-label="Wasser zurücksetzen" ${drunk===0?'style="display:none"':''}>↺</button>
    </div>
    <div class="glass-grid">${glasses}</div>
    <div class="water-progress-bar"><span style="width:${Math.min(100,drunk/goal*100)}%"></span></div>
  `;

}

// Ein Listener für den ganzen Tracker statt einer pro Glas bei jedem Render.
$('#waterTracker').addEventListener('click', ev=>{
  if(ev.target.closest('#waterResetBtn')){
    delete water[state.date]; save('water'); renderWater();
    return;
  }
  const btn = ev.target.closest('.glass-btn');
  if(!btn) return;
  const idx = parseInt(btn.dataset.idx);
  const current = water[state.date] || 0;
  // Klick auf ein volles Glas leert ab dort, Klick auf ein leeres füllt bis dorthin auf
  if(idx < current) water[state.date] = idx;
  else water[state.date] = idx + 1;
  if(water[state.date] === 0) delete water[state.date];
  save('water'); renderWater();
});

// ---------- Habit Tracker ----------
// Streak relativ zum ANGEZEIGTEN Tag (state.date), nicht zum echten Heute.
// Ist der angezeigte Tag noch nicht abgehakt, zählt der Streak bis zum Vortag.
function getHabitStreak(habitId){
  const d = fromStr(state.date);
  if(!habitLog[state.date]?.[habitId]) d.setDate(d.getDate()-1);
  let streak = 0;
  while(habitLog[todayStr(d)]?.[habitId]){
    streak++;
    d.setDate(d.getDate()-1);
  }
  return streak;
}

function renderHabits(){
  const el = $('#habitTracker');
  if(!el) return;
  if(habits.length === 0){
    el.innerHTML = '<div class="empty">Noch keine Habits. Füge sie in den Einstellungen hinzu.</div>';
    return;
  }
  const todayDone = habitLog[state.date] || {};
  el.innerHTML = '';
  habits.forEach(h=>{
    const done = !!todayDone[h.id];
    const streak = getHabitStreak(h.id);
    const row = document.createElement('div');
    row.className = 'habit-row' + (done ? ' done' : '');
    row.innerHTML = `
      <button class="habit-check" data-id="${h.id}" type="button" aria-label="${escapeHtml(h.name)} ${done?'als nicht erledigt markieren':'als erledigt markieren'}" aria-pressed="${done}">
        ${done ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
      </button>
      <div class="habit-info">
        <div class="habit-name">${escapeHtml(h.name)}</div>
        ${streak > 0 ? `<div class="habit-streak">🔥 ${streak} Tag${streak===1?'':'e'}</div>` : '<div class="habit-streak muted">Noch kein Streak</div>'}
      </div>
    `;
    row.querySelector('.habit-check').addEventListener('click', ()=>{
      if(!habitLog[state.date]) habitLog[state.date] = {};
      if(habitLog[state.date][h.id]){
        delete habitLog[state.date][h.id];
        if(Object.keys(habitLog[state.date]).length===0) delete habitLog[state.date];
      } else {
        habitLog[state.date][h.id] = true;
      }
      save('habitLog'); renderHabits();
    });
    el.appendChild(row);
  });
}

function renderAll(){
  renderToday();
  renderFoods();
  renderWorkouts();
  renderWater();
  renderHabits();
}

function renderFoods(){
  const q = ($('#foodSearch').value||'').trim().toLowerCase();
  const list = $('#foodsList');
  list.innerHTML='';
  const filtered = foods.filter(f=>!q || f.name.toLowerCase().includes(q));
  if(filtered.length===0){
    list.innerHTML = '<div class="empty">Noch keine Lebensmittel. Tippe oben auf <b>+</b>.</div>';
    return;
  }
  filtered.sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>{
    const div = document.createElement('div');
    div.className = 'food-row';

    const info = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className='name';
    nameEl.textContent = f.name;
    const metaEl = document.createElement('div');
    metaEl.className='meta';
    metaEl.innerHTML = `${f.kcal} kcal · P ${f.protein} · K ${f.carbs} · F ${f.fat} <span class="tag">/100g</span>`;
    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.className='actions';
    const editBtn = document.createElement('button');
    editBtn.setAttribute('aria-label', `${f.name} bearbeiten`);
    editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;
    editBtn.addEventListener('click', ()=>openEditFood(f));
    actions.appendChild(editBtn);

    div.appendChild(info);
    div.appendChild(actions);
    list.appendChild(div);
  });
}

function renderWorkouts(){
  const dateKey = state.date;           // für Undo-Closures festhalten
  $('#dateLabel').textContent = fmtDate(dateKey);
  $('#dateSub').textContent = fmtSubDate(dateKey);
  $('#todayWorkoutTitle').textContent = fmtDate(dateKey);

  const list = $('#exercisesList');
  list.innerHTML='';
  const day = workouts[dateKey] || [];
  if(day.length===0){
    list.innerHTML = '<div class="empty">Noch keine Übungen heute. Tippe oben auf <b>+</b>.</div>';
  } else {
    day.forEach((ex, exIdx)=>{
      const card = document.createElement('div');
      card.className='workout-card';

      const titleRow = document.createElement('div');
      titleRow.className='ex-title';
      const exName = document.createElement('span');
      exName.textContent = ex.exercise;
      const delExBtn = document.createElement('button');
      delExBtn.className='text-btn';
      delExBtn.textContent='Entfernen';
      delExBtn.setAttribute('aria-label', `${ex.exercise} entfernen`);
      delExBtn.addEventListener('click', () => {
        const removed = workouts[dateKey][exIdx];
        workouts[dateKey].splice(exIdx, 1);
        if(workouts[dateKey].length===0) delete workouts[dateKey];
        save('workouts'); renderWorkouts();
        toast(`${removed.exercise} entfernt`, () => {
          if(!workouts[dateKey]) workouts[dateKey]=[];
          workouts[dateKey].splice(exIdx, 0, removed);
          save('workouts'); renderWorkouts();
        });
      });
      titleRow.appendChild(exName);
      titleRow.appendChild(delExBtn);
      card.appendChild(titleRow);

      const s = ex.sets[0] || {weight:0, reps:0};
      const inputRow = document.createElement('div');
      inputRow.className='grid-2';
      inputRow.style.marginTop='10px';

      const wField = document.createElement('div');
      wField.className='field';
      const wLabel = document.createElement('label');
      wLabel.textContent='Gewicht (kg)';
      const wInp = document.createElement('input');
      wInp.type='number'; wInp.inputMode='decimal';
      wInp.value=s.weight||''; wInp.placeholder='0'; wInp.min='0';
      wInp.setAttribute('aria-label', `${ex.exercise} Gewicht in kg`);
      wInp.addEventListener('change', e=>{
        if(!workouts[dateKey]?.[exIdx]) return;
        if(!workouts[dateKey][exIdx].sets[0]) workouts[dateKey][exIdx].sets[0]={weight:0,reps:0};
        workouts[dateKey][exIdx].sets[0].weight = toNumber(e.target.value)||0; save('workouts');
      });
      wField.appendChild(wLabel); wField.appendChild(wInp);

      const rField = document.createElement('div');
      rField.className='field';
      const rLabel = document.createElement('label');
      rLabel.textContent='Wiederholungen';
      const rInp = document.createElement('input');
      rInp.type='number'; rInp.inputMode='numeric';
      rInp.value=s.reps||''; rInp.placeholder='0'; rInp.min='0';
      rInp.setAttribute('aria-label', `${ex.exercise} Wiederholungen`);
      rInp.addEventListener('change', e=>{
        if(!workouts[dateKey]?.[exIdx]) return;
        if(!workouts[dateKey][exIdx].sets[0]) workouts[dateKey][exIdx].sets[0]={weight:0,reps:0};
        workouts[dateKey][exIdx].sets[0].reps = Math.round(toNumber(e.target.value)||0); save('workouts');
      });
      rField.appendChild(rLabel); rField.appendChild(rInp);

      inputRow.appendChild(wField); inputRow.appendChild(rField);
      card.appendChild(inputRow);

      list.appendChild(card);
    });
  }

  // --- Cardio section ---
  renderCardioList();

  const hist = $('#historyList');
  hist.innerHTML='';
  const dates = Object.keys(workouts).filter(d=>d!==dateKey).sort().reverse();
  if(dates.length===0){
    hist.innerHTML = '<div class="empty">Noch kein Verlauf.</div>';
  } else {
    dates.slice(0,30).forEach(d=>{
      const day = workouts[d];
      const totalSets = day.reduce((s,ex)=>s+ex.sets.length,0);
      const div = document.createElement('div');
      div.className='history-item';

      const headEl = document.createElement('div');
      headEl.className='head';
      const dateLabel = document.createElement('div');
      dateLabel.className='date-l';
      dateLabel.innerHTML = `${fmtDate(d)} <span class="muted" style="font-weight:400">· ${fmtSubDate(d)}</span>`;
      const goBtn = document.createElement('button');
      goBtn.className='text-btn';
      goBtn.textContent='Öffnen';
      goBtn.setAttribute('aria-label', `${fmtDate(d)} Workout öffnen`);
      goBtn.addEventListener('click',()=>{state.date=d;save('state');renderAll();});
      headEl.appendChild(dateLabel);
      headEl.appendChild(goBtn);

      const summary = document.createElement('div');
      summary.className='summary';
      summary.textContent = `${day.length} Übung${day.length!==1?'en':''} · ${totalSets} Sätze`;

      const exList = document.createElement('div');
      exList.className='ex-list';
      day.forEach(ex=>{
        const exEl = document.createElement('div');
        exEl.className='ex';
        const nameB = document.createElement('b');
        nameB.textContent = ex.exercise;
        exEl.appendChild(nameB);
        exEl.append(` — ${ex.sets.map(s=>`${s.weight||0}kg × ${s.reps||0}`).join(', ')}`);
        exList.appendChild(exEl);
      });

      div.appendChild(headEl);
      div.appendChild(summary);
      div.appendChild(exList);
      hist.appendChild(div);
    });
  }
}

// ---------- Cardio Preset Data ----------
const PRESET_CARDIO = [
  {name:'Spaziergang',             intensity:'niedrig',   met:3.5},
  {name:'Wandern',                 intensity:'niedrig',   met:4.5},
  {name:'Radfahren (gemäßigt)',    intensity:'mittel',    met:6},
  {name:'Schwimmen',               intensity:'mittel',    met:7},
  {name:'Joggen (moderat)',        intensity:'mittel',    met:7.5},
  {name:'Rudern (Ergometer)',      intensity:'mittel',    met:7},
  {name:'Radfahren (intensiv)',    intensity:'hoch',      met:10},
  {name:'Laufen (schnell)',        intensity:'hoch',      met:11},
  {name:'Seilspringen',            intensity:'hoch',      met:11},
  {name:'HIIT',                    intensity:'sehr hoch', met:12},
  {name:'Spinning',                intensity:'sehr hoch', met:13},
  {name:'Yoga / Stretching',       intensity:'niedrig',   met:2.5},
];

function calcCardioKcal(met, durationMin) {
  const kg = appSettings.bodyWeight || 75;
  return Math.round(met * kg * durationMin / 60);
}

function renderCardioList() {
  const dateKey = state.date;           // für Undo-Closures festhalten
  const list = $('#cardioList');
  list.innerHTML = '';
  const entries = cardio[dateKey] || [];
  if (entries.length === 0) {
    list.innerHTML = '<div class="empty" style="margin-bottom:8px">Noch kein Cardio heute.</div>';
    return;
  }
  entries.forEach((e, idx) => {
    const div = document.createElement('div');
    div.className = 'cardio-entry';

    const left = document.createElement('div');
    left.className = 'left';
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = e.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const badge = document.createElement('span');
    badge.className = `intensity ${e.intensity.replace(' ','-')}`;
    badge.textContent = e.intensity;
    meta.appendChild(badge);
    meta.append(` · ${e.duration} min`);
    left.appendChild(nameEl);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.className = 'right';
    const kcalEl = document.createElement('div');
    kcalEl.className = 'kcal-burned';
    kcalEl.textContent = `${e.kcalBurned} kcal`;
    const delBtn = document.createElement('button');
    delBtn.className = 'text-btn';
    delBtn.style.marginTop = '4px';
    delBtn.textContent = 'Löschen';
    delBtn.setAttribute('aria-label', `${e.name} entfernen`);
    delBtn.addEventListener('click', () => {
      const removed = cardio[dateKey].splice(idx, 1)[0];
      if (cardio[dateKey].length === 0) delete cardio[dateKey];
      save('cardio'); renderWorkouts(); renderToday();
      toast(`${removed.name} entfernt`, () => {
        if (!cardio[dateKey]) cardio[dateKey] = [];
        cardio[dateKey].splice(idx, 0, removed);
        save('cardio'); renderWorkouts(); renderToday();
      });
    });
    right.appendChild(kcalEl);
    right.appendChild(delBtn);

    div.appendChild(left);
    div.appendChild(right);
    list.appendChild(div);
  });
}

// ---------- Cardio Modal ----------
function populateCardioSelect() {
  const sel = $('#cardioSelect');
  sel.innerHTML = '';
  PRESET_CARDIO.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${p.name} (${p.intensity})`;
    sel.appendChild(opt);
  });
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Eigene Aktivität…';
  sel.appendChild(custom);
}

function updateCardioKcalEst() {
  const val = $('#cardioSelect').value;
  const dur = validatePositiveInt($('#cardioDuration').value) || 0;
  if (val === 'custom') {
    $('#cardioKcalEst').textContent = '–';
    return;
  }
  const preset = PRESET_CARDIO[parseInt(val)];
  if (preset) {
    $('#cardioKcalEst').textContent = calcCardioKcal(preset.met, dur) + ' kcal';
  }
}

$('#addCardioBtn').addEventListener('click', () => {
  populateCardioSelect();
  $('#cardioDuration').value = 30;
  $('#cardioKcalOverride').value = '';
  $('#cardioCustomNameField').style.display = 'none';
  updateCardioKcalEst();
  openModal('cardioModal');
});

$('#cardioSelect').addEventListener('change', () => {
  const isCustom = $('#cardioSelect').value === 'custom';
  $('#cardioCustomNameField').style.display = isCustom ? 'block' : 'none';
  updateCardioKcalEst();
});
$('#cardioDuration').addEventListener('input', updateCardioKcalEst);

$('#cancelCardio').addEventListener('click', () => closeModal('cardioModal'));
$('#confirmCardio').addEventListener('click', () => {
  const val = $('#cardioSelect').value;
  const dur = validatePositiveInt($('#cardioDuration').value);
  if (!dur) { showFieldError($('#cardioDuration'), 'Bitte eine Dauer eingeben'); return; }
  const override = validatePositiveInt($('#cardioKcalOverride').value);

  let name, intensity, kcalBurned;
  if (val === 'custom') {
    name = $('#cardioCustomName').value.trim();
    if (!name) { showFieldError($('#cardioCustomName'), 'Bitte einen Namen eingeben'); return; }
    intensity = 'mittel';
    kcalBurned = override || Math.round(7 * (appSettings.bodyWeight||75) * dur / 60);
  } else {
    const preset = PRESET_CARDIO[parseInt(val)];
    name = preset.name;
    intensity = preset.intensity;
    kcalBurned = override || calcCardioKcal(preset.met, dur);
  }

  if (!cardio[state.date]) cardio[state.date] = [];
  cardio[state.date].push({id: uid(), name, intensity, duration: dur, kcalBurned});
  save('cardio'); closeModal('cardioModal'); renderWorkouts(); renderToday();
  toast(`${name} hinzugefügt · ${kcalBurned} kcal verbrannt`);
});

// Die Datumsnavigation gehört zu "Heute" und "Workouts", nicht zu "Lebensmittel".
function setDateNavVisible(){
  $('#dateNav').style.display = state.tab==='foods' ? 'none' : 'flex';
}

function renderAllTabs(){
  setDateNavVisible();
  if(state.tab==='today'){renderToday(); renderWater(); renderHabits();}
  else if(state.tab==='foods'){renderFoods();}
  else if(state.tab==='workouts'){renderWorkouts();}
}

// ---------- Tabs ----------
$$('nav.bottom button').forEach(b=>b.addEventListener('click',()=>{
  state.tab = b.dataset.tab;
  $$('nav.bottom button').forEach(x=>x.classList.toggle('active', x===b));
  $$('.page').forEach(p=>p.classList.remove('active'));
  $('#page-'+state.tab).classList.add('active');
  save('state'); renderAllTabs();
}));

// ---------- Date nav ----------
function shiftDay(delta){
  const d = fromStr(state.date);
  d.setDate(d.getDate()+delta);
  state.date = todayStr(d);
  save('state');
  renderAllTabs();
}
$('#prevDay').addEventListener('click',()=>shiftDay(-1));
$('#nextDay').addEventListener('click',()=>shiftDay(1));

// Läuft die App über Mitternacht, springt sie beim nächsten Öffnen auf den neuen Tag –
// aber nur, wenn man nicht bewusst einen anderen Tag ausgewählt hat.
let lastKnownToday = todayStr();
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState !== 'visible') return;
  const now = todayStr();
  if(now === lastKnownToday) return;
  if(state.date === lastKnownToday){ state.date = now; save('state'); renderAllTabs(); }
  lastKnownToday = now;
});

// ---------- Modal helpers ----------
function openModal(id){$('#'+id).classList.add('show');}
function closeModal(id){
  if(id === 'barcodeModal') stopBarcodeCamera();
  $('#'+id).classList.remove('show');
}
$$('.modal-overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o) closeModal(o.id);}));

// ---------- Settings ----------
function openSettings(){
  $('#goalKcal').value = goals.kcal;
  $('#goalProtein').value = goals.protein;
  $('#goalCarbs').value = goals.carbs;
  $('#goalFat').value = goals.fat;
  $('#bodyWeight').value = appSettings.bodyWeight || 75;
  $('#cardioAddToBudget').checked = appSettings.cardioAddToBudget;
  $('#geminiKey').value = localStorage.getItem(STORE.geminiKey) || '';
  $('#waterGoalInput').value = appSettings.waterGoal || 8;
  $('#waterGlassSizeInput').value = appSettings.waterGlassSize || 250;
  // Habit-Felder füllen und die zugehörige ID am Feld merken (nicht über die Position)
  for(let i=0;i<3;i++){
    const h = habits[i];
    const inp = $('#habitInput'+(i+1));
    inp.value = h ? h.name : '';
    inp.dataset.habitId = h ? h.id : '';
  }
  openModal('settingsModal');
}
$('#settingsBtn').addEventListener('click', openSettings);
// Feld leeren = Gewohnheit aufgeben. Danach eingetippter Text ist eine neue Gewohnheit
// und erbt nicht den Streak der alten.
for(let i=1;i<=3;i++){
  const inp = $('#habitInput'+i);
  inp.addEventListener('input', ()=>{ if(!inp.value.trim()) inp.dataset.habitId=''; });
}
$('#saveGoals').addEventListener('click',()=>{
  const kcalVal = validatePositiveInt($('#goalKcal').value);
  if(!kcalVal){showFieldError($('#goalKcal'),'Bitte einen gültigen Kalorienwert eingeben');return;}
  const proteinVal = validatePositiveInt($('#goalProtein').value);
  if(!proteinVal){showFieldError($('#goalProtein'),'Bitte Protein-Ziel eingeben');return;}
  const carbsVal = validatePositiveInt($('#goalCarbs').value);
  if(!carbsVal){showFieldError($('#goalCarbs'),'Bitte Kohlenhydrat-Ziel eingeben');return;}
  const fatVal = validatePositiveInt($('#goalFat').value);
  if(!fatVal){showFieldError($('#goalFat'),'Bitte Fett-Ziel eingeben');return;}
  const weight = toNumber($('#bodyWeight').value);
  if(weight === null || weight <= 0){showFieldError($('#bodyWeight'),'Bitte ein gültiges Körpergewicht eingeben');return;}
  const wGoal = validatePositiveInt($('#waterGoalInput').value);
  if(!wGoal){showFieldError($('#waterGoalInput'),'Bitte ein gültiges Wasser-Tagesziel eingeben');return;}
  const wSize = validatePositiveInt($('#waterGlassSizeInput').value);
  if(!wSize){showFieldError($('#waterGlassSizeInput'),'Bitte eine gültige Glasgröße eingeben');return;}

  goals = {kcal:kcalVal, protein:proteinVal, carbs:carbsVal, fat:fatVal};
  appSettings.bodyWeight = weight;
  appSettings.cardioAddToBudget = $('#cardioAddToBudget').checked;
  appSettings.waterGoal = wGoal;
  appSettings.waterGlassSize = wSize;

  const geminiKey = $('#geminiKey').value.trim();
  if(geminiKey) localStorage.setItem(STORE.geminiKey, geminiKey);
  else localStorage.removeItem(STORE.geminiKey);

  // Gewohnheiten: ID kommt vom Feld, nicht von der Position im Array
  const newHabits = [];
  for(let i=0;i<3;i++){
    const inp = $('#habitInput'+(i+1));
    const name = inp.value.trim();
    if(!name) continue;
    const knownId = inp.dataset.habitId && habits.some(h=>h.id===inp.dataset.habitId)
      ? inp.dataset.habitId : uid();
    inp.dataset.habitId = knownId;
    newHabits.push({id: knownId, name});
  }
  habits = newHabits;
  pruneHabitLog();

  save(); closeModal('settingsModal'); renderAll(); setDateNavVisible(); toast('Einstellungen gespeichert');
});

// Abhak-Historie von gelöschten Gewohnheiten entfernen
function pruneHabitLog(){
  const keep = new Set(habits.map(h=>h.id));
  for(const ds of Object.keys(habitLog)){
    for(const id of Object.keys(habitLog[ds])) if(!keep.has(id)) delete habitLog[ds][id];
    if(Object.keys(habitLog[ds]).length === 0) delete habitLog[ds];
  }
}

$('#resetData').addEventListener('click',()=>{
  if(confirm('Wirklich ALLE Daten löschen? Das kann nicht rückgängig gemacht werden.')){
    Object.values(STORE).forEach(k=>localStorage.removeItem(k));
    location.reload();
  }
});

// ---------- Backup ----------
$('#exportData').addEventListener('click',()=>{
  const data = {
    v:2, exportedAt:new Date().toISOString(),
    goals, foods, log, workouts, exerciseNames,
    cardio, appSettings, water, habits, habitLog
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `fittrack-backup-${todayStr()}.json`; a.click();
  URL.revokeObjectURL(url);
  toast('Backup erstellt');
});
$('#importData').addEventListener('click',()=>$('#importFile').click());
$('#importFile').addEventListener('change', async e=>{
  const file = e.target.files[0];
  e.target.value='';
  if(!file) return;
  try{
    const d = JSON.parse(await file.text());
    if(!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Kein FitTrack-Backup');
    if(!confirm('Backup einspielen? Deine aktuellen Daten werden dabei ersetzt.')) return;
    applyBackup(d);
    save(); renderAll(); setDateNavVisible(); closeModal('settingsModal'); toast('Daten importiert');
  }catch(err){
    console.error(err);
    toast('Datei konnte nicht gelesen werden.');
  }
});

// Backup einspielen. Nur übernehmen, was plausibel aussieht – eine kaputte Datei
// soll nicht z. B. das Kalorienziel auf 0 setzen (Division durch 0 in den Balken).
function applyBackup(d){
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const pos = (v, fallback) => { const n = toNumber(v); return n !== null && n > 0 ? n : fallback; };
  const nonNeg = v => { const n = toNumber(v); return n !== null && n >= 0 ? n : 0; };
  const isDateKey = k => /^\d{4}-\d{2}-\d{2}$/.test(k);

  if(isObj(d.goals)){
    goals = {
      kcal:    Math.round(pos(d.goals.kcal,    goals.kcal)),
      protein: Math.round(pos(d.goals.protein, goals.protein)),
      carbs:   Math.round(pos(d.goals.carbs,   goals.carbs)),
      fat:     Math.round(pos(d.goals.fat,     goals.fat))
    };
  }
  if(Array.isArray(d.foods)){
    foods = d.foods
      .filter(f => isObj(f) && f.id && f.name)
      .map(f => ({id:String(f.id), name:String(f.name), kcal:nonNeg(f.kcal),
                  protein:nonNeg(f.protein), carbs:nonNeg(f.carbs), fat:nonNeg(f.fat)}));
  }
  const validIds = new Set(foods.map(f=>f.id));
  if(isObj(d.log)){
    log = {};
    for(const [ds, list] of Object.entries(d.log)){
      if(!isDateKey(ds) || !Array.isArray(list)) continue;
      const clean = list
        .filter(e => isObj(e) && validIds.has(String(e.foodId)) && pos(e.grams, 0) > 0)
        .map(e => ({foodId:String(e.foodId), grams:pos(e.grams,100),
                    meal: MEALS.some(m=>m.key===e.meal) ? e.meal : 'snack'}));
      if(clean.length) log[ds] = clean;
    }
  }
  if(isObj(d.workouts)){
    workouts = {};
    for(const [ds, list] of Object.entries(d.workouts)){
      if(!isDateKey(ds) || !Array.isArray(list)) continue;
      const clean = list
        .filter(ex => isObj(ex) && ex.exercise)
        .map(ex => ({exercise:String(ex.exercise),
                     sets:(Array.isArray(ex.sets)?ex.sets:[]).map(s=>({weight:nonNeg(s?.weight), reps:Math.round(nonNeg(s?.reps))}))}));
      if(clean.length) workouts[ds] = clean;
    }
  }
  if(isObj(d.cardio)){
    cardio = {};
    for(const [ds, list] of Object.entries(d.cardio)){
      if(!isDateKey(ds) || !Array.isArray(list)) continue;
      const clean = list
        .filter(c => isObj(c) && c.name)
        .map(c => ({id:String(c.id||uid()), name:String(c.name), intensity:String(c.intensity||'mittel'),
                    duration:Math.round(nonNeg(c.duration)), kcalBurned:Math.round(nonNeg(c.kcalBurned))}));
      if(clean.length) cardio[ds] = clean;
    }
  }
  if(isObj(d.water)){
    water = {};
    for(const [ds, n] of Object.entries(d.water)){
      const glasses = Math.round(nonNeg(n));
      if(isDateKey(ds) && glasses > 0) water[ds] = glasses;
    }
  }
  if(Array.isArray(d.habits)){
    habits = d.habits.filter(h=>isObj(h)&&h.id&&h.name).slice(0,3)
                     .map(h=>({id:String(h.id), name:String(h.name)}));
  }
  if(isObj(d.habitLog)){
    habitLog = {};
    for(const [ds, marks] of Object.entries(d.habitLog)){
      if(!isDateKey(ds) || !isObj(marks)) continue;
      const clean = {};
      for(const [id, v] of Object.entries(marks)) if(v) clean[id] = true;
      if(Object.keys(clean).length) habitLog[ds] = clean;
    }
    pruneHabitLog();
  }
  if(isObj(d.appSettings)){
    appSettings = {
      bodyWeight:        pos(d.appSettings.bodyWeight, appSettings.bodyWeight),
      cardioAddToBudget: d.appSettings.cardioAddToBudget !== false,
      waterGoal:   Math.round(pos(d.appSettings.waterGoal,      appSettings.waterGoal)),
      waterGlassSize: Math.round(pos(d.appSettings.waterGlassSize, appSettings.waterGlassSize))
    };
  }
  if(Array.isArray(d.exerciseNames)){
    exerciseNames = d.exerciseNames.filter(n=>typeof n === 'string').slice(0,40);
  }
}

// ---------- Foods CRUD ----------
let editingFoodId = null;
function openCreateFood(){
  editingFoodId = null;
  $('#foodModalTitle').textContent='Neues Lebensmittel';
  $('#foodName').value=''; $('#foodKcal').value=''; $('#foodProtein').value=''; $('#foodCarbs').value=''; $('#foodFat').value='';
  $('#deleteFood').style.display='none';
  openModal('foodModal');
  setTimeout(()=>$('#foodName').focus(),50);
}
function openEditFood(f){
  editingFoodId = f.id;
  $('#foodModalTitle').textContent='Bearbeiten';
  $('#foodName').value=f.name;$('#foodKcal').value=f.kcal;$('#foodProtein').value=f.protein;$('#foodCarbs').value=f.carbs;$('#foodFat').value=f.fat;
  $('#deleteFood').style.display='block';
  openModal('foodModal');
}
$('#addFoodBtn').addEventListener('click',openCreateFood);
$('#cancelFood').addEventListener('click',()=>closeModal('foodModal'));
$('#saveFood').addEventListener('click',()=>{
  const name = $('#foodName').value.trim();
  if(!name){showFieldError($('#foodName'),'Bitte einen Namen eingeben');return;}
  const kcalVal = validateNonNegativeFloat($('#foodKcal').value);
  if(kcalVal===null){showFieldError($('#foodKcal'),'Bitte einen gültigen Kalorienwert eingeben');return;}
  const proteinVal = validateNonNegativeFloat($('#foodProtein').value);
  if(proteinVal===null){showFieldError($('#foodProtein'),'Bitte einen gültigen Proteinwert eingeben');return;}
  const carbsVal = validateNonNegativeFloat($('#foodCarbs').value);
  if(carbsVal===null){showFieldError($('#foodCarbs'),'Bitte einen gültigen Kohlenhydratwert eingeben');return;}
  const fatVal = validateNonNegativeFloat($('#foodFat').value);
  if(fatVal===null){showFieldError($('#foodFat'),'Bitte einen gültigen Fettwert eingeben');return;}
  const data = {name, kcal:kcalVal, protein:proteinVal, carbs:carbsVal, fat:fatVal};
  if(editingFoodId){
    const i = foods.findIndex(x=>x.id===editingFoodId);
    if(i>=0) foods[i] = {...foods[i],...data};
  } else {
    foods.push({id:uid(),...data});
  }
  save('foods'); closeModal('foodModal');
  if(state.tab==='foods') renderFoods();
  if($('#logFoodModal').classList.contains('show')) renderLogFoodResults();
  toast('Gespeichert');
});
$('#deleteFood').addEventListener('click',()=>{
  if(!editingFoodId) return;
  const idx = foods.findIndex(x=>x.id===editingFoodId);
  if(idx < 0) return;
  const removed = foods[idx];
  foods.splice(idx, 1);
  save('foods'); closeModal('foodModal'); renderFoods();
  toast(`${removed.name} gelöscht`, () => {
    foods.splice(idx, 0, removed);
    save('foods'); renderFoods();
  });
});
$('#foodSearch').addEventListener('input',renderFoods);

// ---------- Barcode Scanner ----------
let barcodeStream = null;
let barcodeScanActive = false;
let barcodeContext = 'foods'; // 'foods' | 'log'

function stopBarcodeCamera(){
  barcodeScanActive = false;
  if(barcodeStream){barcodeStream.getTracks().forEach(t=>t.stop()); barcodeStream=null;}
  const v = $('#barcodeVideo'); if(v) v.srcObject = null;
}

function showBarcodeManual(){
  $('#barcodeViewfinder').style.display='none';
  $('#barcodeHint').style.display='none';
  $('#barcodeLoading').style.display='none';
  $('#barcodeManual').style.display='block';
}

function fillBarcodeResult(product){
  $('#barcodeProductName').value = product.name || '';
  $('#barcodeKcal').value    = product.kcal    || 0;
  $('#barcodeProtein').value = product.protein || 0;
  $('#barcodeCarbs').value   = product.carbs   || 0;
  $('#barcodeFat').value     = product.fat     || 0;
  $('#barcodeManual').style.display='none';
  $('#barcodeLoading').style.display='none';
  $('#barcodeResult').style.display='block';
}

// Ohne Timeout dreht sich der Spinner bei schlechtem Netz endlos.
async function fetchWithTimeout(url, options = {}, timeoutMs = 20000){
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    return await fetch(url, {...options, signal: ctrl.signal});
  }catch(err){
    if(err.name === 'AbortError') throw new Error('Zeitüberschreitung – Verbindung prüfen');
    throw err;
  }finally{
    clearTimeout(timer);
  }
}

async function lookupBarcode(barcode){
  const res = await fetchWithTimeout(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`);
  if(!res.ok) throw new Error('Netzwerkfehler');
  const data = await res.json();
  if(data.status !== 1 || !data.product) return null;
  const p = data.product;
  const n = p.nutriments || {};
  const kcal = Math.round(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? (n['energy_100g'] ? n['energy_100g']/4.184 : 0));
  return {
    name:    p.product_name_de || p.product_name || p.brands || 'Unbekanntes Produkt',
    kcal,
    protein: Math.round((n['proteins_100g']       ||0)*10)/10,
    carbs:   Math.round((n['carbohydrates_100g']  ||0)*10)/10,
    fat:     Math.round((n['fat_100g']            ||0)*10)/10
  };
}

async function handleBarcodeFound(barcode){
  stopBarcodeCamera();
  $('#barcodeViewfinder').style.display='none';
  $('#barcodeHint').style.display='none';
  $('#barcodeManual').style.display='none';
  $('#barcodeLoadingText').textContent='Produkt wird gesucht…';
  $('#barcodeLoading').style.display='block';
  try{
    const product = await lookupBarcode(barcode);
    if(!product){ showBarcodeManual(); toast(`Barcode nicht in Datenbank – bitte manuell eingeben`); }
    else fillBarcodeResult(product);
  }catch(err){
    showBarcodeManual(); toast('Suche fehlgeschlagen: '+err.message);
  }
}

async function startBarcodeScanner(){
  try{
    barcodeStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    const video = $('#barcodeVideo');
    video.srcObject = barcodeStream;
    await video.play();
    $('#barcodeViewfinder').style.display='block';
    $('#barcodeHint').style.display='block';
    barcodeScanActive = true;
    const detector = new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128']});
    const scan = async()=>{
      if(!barcodeScanActive) return;
      try{
        if(video.readyState >= 2){
          const codes = await detector.detect(video);
          if(codes.length>0){ await handleBarcodeFound(codes[0].rawValue); return; }
        }
      }catch(e){}
      setTimeout(scan, 250);
    };
    scan();
  }catch(err){ showBarcodeManual(); toast('Kamerazugriff verweigert'); }
}

function openBarcodeModal(context){
  barcodeContext = context;
  ['barcodeViewfinder','barcodeHint','barcodeManual','barcodeLoading','barcodeResult']
    .forEach(id=>($('#'+id).style.display='none'));
  $('#barcodeManualInput').value='';
  openModal('barcodeModal');
  if('BarcodeDetector' in window) startBarcodeScanner();
  else showBarcodeManual();
}

// Kamera nicht weiterlaufen lassen, wenn die App in den Hintergrund geht
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) stopBarcodeCamera(); });
window.addEventListener('pagehide', stopBarcodeCamera);

$('#barcodeFoodsBtn').addEventListener('click', ()=>openBarcodeModal('foods'));
$('#barcodeFoodLogBtn').addEventListener('click', ()=>{ closeModal('logFoodModal'); openBarcodeModal('log'); });

$('#barcodeManualSearch').addEventListener('click', async()=>{
  const barcode = $('#barcodeManualInput').value.trim();
  if(!barcode){showFieldError($('#barcodeManualInput'),'Bitte Barcode eingeben');return;}
  await handleBarcodeFound(barcode);
});
$('#barcodeManualInput').addEventListener('keydown', e=>{ if(e.key==='Enter') $('#barcodeManualSearch').click(); });

$('#barcodeScanAgain').addEventListener('click', ()=>{
  $('#barcodeResult').style.display='none';
  if('BarcodeDetector' in window) startBarcodeScanner();
  else showBarcodeManual();
});

$('#barcodeConfirm').addEventListener('click', ()=>{
  const name = $('#barcodeProductName').value.trim();
  if(!name){showFieldError($('#barcodeProductName'),'Bitte Namen eingeben');return;}
  const values = {
    name,
    kcal:    validateNonNegativeFloat($('#barcodeKcal').value)    ?? 0,
    protein: validateNonNegativeFloat($('#barcodeProtein').value) ?? 0,
    carbs:   validateNonNegativeFloat($('#barcodeCarbs').value)   ?? 0,
    fat:     validateNonNegativeFloat($('#barcodeFat').value)     ?? 0
  };
  // Gleicher Name = gleiches Lebensmittel: aktualisieren statt doppelt anlegen.
  // (Vorher wurden bei einem Treffer die gerade korrigierten Werte verworfen.)
  const existing = foods.find(f=>f.name.toLowerCase()===name.toLowerCase());
  let finalFood;
  if(existing){ Object.assign(existing, values); finalFood = existing; }
  else { finalFood = {id: uid(), ...values}; foods.push(finalFood); }
  save('foods');
  closeModal('barcodeModal');
  if(barcodeContext==='log'){
    openPortion(finalFood);
  } else {
    renderFoods();
    toast(`${finalFood.name} ${existing?'aktualisiert':'gespeichert'}`);
  }
});

// Gemini-Fallback: Foto der Nährwerttabelle
$('#barcodeLabelFile').addEventListener('change', async e=>{
  const file = e.target.files[0];
  e.target.value='';
  if(!file) return;
  if(!localStorage.getItem(STORE.geminiKey)){
    toast('Bitte zuerst Gemini API-Key in den Einstellungen eingeben');
    closeModal('barcodeModal'); openSettings(); return;
  }
  stopBarcodeCamera();
  $('#barcodeManual').style.display='none';
  $('#barcodeViewfinder').style.display='none';
  $('#barcodeHint').style.display='none';
  $('#barcodeLoadingText').textContent='KI liest Nährwerttabelle…';
  $('#barcodeLoading').style.display='block';
  try{
    const img = await prepareImage(file);
    const result = await askGemini(img.base64, img.mime, GEMINI_PROMPT_LABEL);
    fillBarcodeResult({
      name:    result.name    || '',
      kcal:    validateNonNegativeFloat(result.kcal)    ?? 0,
      protein: validateNonNegativeFloat(result.protein) ?? 0,
      carbs:   validateNonNegativeFloat(result.carbs)   ?? 0,
      fat:     validateNonNegativeFloat(result.fat)     ?? 0
    });
  }catch(err){
    $('#barcodeLoading').style.display='none';
    $('#barcodeManual').style.display='block';
    toast('Fehler: '+err.message);
  }
});

// ---------- Log Food (add to meal) ----------
let activeMeal = 'breakfast';
function openLogFood(meal){
  activeMeal = meal;
  $('#logFoodTitle').textContent = MEALS.find(m=>m.key===meal).label + ' hinzufügen';
  $('#logFoodSearch').value='';
  renderLogFoodResults();
  openModal('logFoodModal');
  setTimeout(()=>$('#logFoodSearch').focus(),50);
}
function renderLogFoodResults(){
  const q = $('#logFoodSearch').value.trim().toLowerCase();
  const res = $('#logFoodResults');
  res.innerHTML='';
  let list = foods.slice();
  if(q) list = list.filter(f=>f.name.toLowerCase().includes(q));
  list.sort((a,b)=>a.name.localeCompare(b.name));
  if(list.length===0){
    res.innerHTML = '<div class="empty">Keine Treffer. Du kannst unten ein neues Lebensmittel anlegen.</div>';
    return;
  }
  list.slice(0,40).forEach(f=>{
    const div = document.createElement('div');
    div.className='food-row';

    const info = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className='name'; nameEl.textContent=f.name;
    const metaEl = document.createElement('div');
    metaEl.className='meta';
    metaEl.innerHTML=`${f.kcal} kcal · P ${f.protein} / K ${f.carbs} / F ${f.fat} <span class="tag">/100g</span>`;
    info.appendChild(nameEl); info.appendChild(metaEl);

    const btn = document.createElement('button');
    btn.className='icon-btn';
    btn.setAttribute('aria-label', `${f.name} auswählen`);
    btn.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

    div.appendChild(info); div.appendChild(btn);
    div.addEventListener('click',()=>openPortion(f));
    res.appendChild(div);
  });
}
$('#logFoodSearch').addEventListener('input',renderLogFoodResults);
$('#openCreateFood').addEventListener('click',()=>{closeModal('logFoodModal'); openCreateFood();});

// ---------- Portion ----------
let portionFood = null;
let portionMode = 'grams'; // 'grams' | 'portions'
let editingLogEntry = null; // {index} when editing existing entry, null when adding

function setPortionMode(mode){
  portionMode = mode;
  $('#portionTabGrams').classList.toggle('active', mode==='grams');
  $('#portionTabPortions').classList.toggle('active', mode==='portions');
  $('#portionGramsArea').style.display   = mode==='grams'    ? 'block' : 'none';
  $('#portionPortionsArea').style.display = mode==='portions' ? 'block' : 'none';
  updatePortionPreview();
}

function _openPortionModal(f, prefillGrams, editIdx){
  portionFood = f;
  editingLogEntry = editIdx !== null ? editIdx : null;
  $('#portionFoodName').textContent = f.name;
  $('#portionFoodMacros').textContent = `${f.kcal} kcal · P ${f.protein} / K ${f.carbs} / F ${f.fat} pro 100g`;
  setPortionMode('grams');
  $('#portionGrams').value = prefillGrams || 100;
  $('#portionCount').value = 1;
  $('#portionSize').value  = 100;
  $('#confirmPortion').textContent = editIdx !== null ? 'Aktualisieren' : 'Hinzufügen';
  $('#deleteLogEntry').style.display = editIdx !== null ? 'block' : 'none';
  updatePortionPreview();
  openModal('portionModal');
  setTimeout(()=>{$('#portionGrams').focus();$('#portionGrams').select();},50);
}

function openPortion(f){
  closeModal('logFoodModal');
  _openPortionModal(f, 100, null);
}

function openPortionEdit(f, logIndex){
  const currentGrams = log[state.date]?.[logIndex]?.grams || 100;
  _openPortionModal(f, currentGrams, logIndex);
}

function getPortionGrams(){
  if(portionMode==='grams'){
    return validateNonNegativeFloat($('#portionGrams').value) || 0;
  } else {
    const count = validateNonNegativeFloat($('#portionCount').value) || 0;
    const size  = validateNonNegativeFloat($('#portionSize').value)  || 100;
    return count * size;
  }
}

function updatePortionPreview(){
  if(!portionFood) return;
  const g = getPortionGrams();
  const r = g/100;
  $('#portionKcal').textContent    = Math.round(portionFood.kcal*r) + ' kcal';
  $('#portionProtein').textContent = (Math.round(portionFood.protein*r*10)/10) + ' g';
  $('#portionCarbs').textContent   = (Math.round(portionFood.carbs*r*10)/10) + ' g';
  $('#portionFat').textContent     = (Math.round(portionFood.fat*r*10)/10) + ' g';
}

$('#portionTabGrams').addEventListener('click', ()=>setPortionMode('grams'));
$('#portionTabPortions').addEventListener('click', ()=>setPortionMode('portions'));
$('#portionGrams').addEventListener('input', updatePortionPreview);
$('#portionCount').addEventListener('input', updatePortionPreview);
$('#portionSize').addEventListener('input', updatePortionPreview);
$('#cancelPortion').addEventListener('click',()=>{ editingLogEntry=null; closeModal('portionModal'); });

$('#confirmPortion').addEventListener('click',()=>{
  const g = getPortionGrams();
  if(!g || g<=0){
    showFieldError(portionMode==='grams' ? $('#portionGrams') : $('#portionCount'), 'Bitte eine Menge angeben');
    return;
  }
  if(editingLogEntry !== null){
    if(log[state.date]?.[editingLogEntry]) log[state.date][editingLogEntry].grams = g;
    editingLogEntry = null;
    save('log'); closeModal('portionModal'); renderToday(); toast('Portion aktualisiert');
  } else {
    if(!log[state.date]) log[state.date] = [];
    log[state.date].push({foodId:portionFood.id, grams:g, meal:activeMeal});
    save('log'); closeModal('portionModal'); renderToday(); toast('Hinzugefügt');
  }
});

$('#deleteLogEntry').addEventListener('click', ()=>{
  if(editingLogEntry === null) return;
  const idx = editingLogEntry;
  const day = state.date;              // für die Undo-Closure festhalten
  const removed = log[day].splice(idx, 1)[0];
  if(log[day].length===0) delete log[day];
  editingLogEntry = null;
  save('log'); closeModal('portionModal'); renderToday();
  toast('Eintrag entfernt', ()=>{
    if(!log[day]) log[day]=[];
    log[day].splice(idx, 0, removed);
    save('log'); renderToday();
  });
});

// ---------- Exercises ----------
function getLastExerciseValues(name) {
  const lower = name.toLowerCase();
  const dates = Object.keys(workouts).filter(d=>d!==state.date).sort().reverse();
  for (const d of dates) {
    const ex = workouts[d].find(e=>e.exercise.toLowerCase()===lower);
    if (ex && ex.sets && ex.sets[0]) return {weight: ex.sets[0].weight||0, reps: ex.sets[0].reps||0};
  }
  return null;
}

$('#addExerciseBtn').addEventListener('click',()=>{
  $('#exerciseName').value='';
  $('#exerciseWeight').value='';
  $('#exerciseReps').value='';
  $('#lastExerciseInfo').style.display='none';
  refreshExerciseHints();
  openModal('exerciseModal');
  setTimeout(()=>$('#exerciseName').focus(),50);
});
function refreshExerciseHints(){
  const dl = $('#exerciseHints');
  dl.innerHTML = exerciseNames.map(n=>`<option value="${escapeHtml(n)}">`).join('');
}
$('#exerciseName').addEventListener('input',()=>{
  const n = $('#exerciseName').value.trim();
  const last = n ? getLastExerciseValues(n) : null;
  if(last){
    $('#exerciseWeight').value = last.weight;
    $('#exerciseReps').value = last.reps;
    $('#lastExerciseValues').textContent = `${last.weight} kg × ${last.reps} Wdh.`;
    $('#lastExerciseInfo').style.display='block';
  } else {
    $('#lastExerciseInfo').style.display='none';
  }
});
$('#cancelExercise').addEventListener('click',()=>closeModal('exerciseModal'));
$('#confirmExercise').addEventListener('click',()=>{
  const n = $('#exerciseName').value.trim();
  if(!n){showFieldError($('#exerciseName'),'Bitte einen Übungsnamen eingeben');return;}
  const weight = validateNonNegativeFloat($('#exerciseWeight').value) ?? 0;
  const reps = Math.round(validateNonNegativeFloat($('#exerciseReps').value) ?? 0);
  if(!exerciseNames.includes(n)){exerciseNames.unshift(n);exerciseNames=exerciseNames.slice(0,40);}
  if(!workouts[state.date]) workouts[state.date]=[];
  workouts[state.date].push({exercise:n, sets:[{weight, reps}]});
  save('workouts','exercises'); closeModal('exerciseModal'); renderWorkouts(); toast('Übung hinzugefügt');
});

// ---------- KI-Scanner ----------
// Modellname zentral: lässt sich austauschen, wenn Google ein Modell abschaltet.
// Achtung bei den 2.5-Modellen: die "denken" per Default und brauchen dann
// thinkingConfig:{thinkingBudget:0}, sonst geht das Token-Budget fürs Denken drauf.
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_PROMPT_MEAL  = 'Analysiere diese Mahlzeit. Antworte NUR mit einem JSON-Objekt ohne Markdown oder Erklärung: {"name":"Name auf Deutsch","kcal":500,"protein":25,"carbs":60,"fat":15,"grams":350}. Schätze Gesamtwerte für die sichtbare Portion.';
const GEMINI_PROMPT_LABEL = 'Lies die Nährwerttabelle. Antworte NUR mit JSON ohne Markdown: {"name":"Produktname","kcal":100,"protein":5,"carbs":12,"fat":3}. Alle Werte pro 100g.';

let scanImage = null;   // {dataUrl, base64, mime}

function readFileAsDataURL(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload  = ()=>resolve(r.result);
    r.onerror = ()=>reject(new Error('Bild konnte nicht gelesen werden'));
    r.readAsDataURL(file);
  });
}

// Handyfotos sind schnell 4–8 MB. Vor dem Upload auf max. 1024 px verkleinern:
// spart Wartezeit und Datenvolumen, für Nährwerttabellen reicht die Auflösung locker.
async function prepareImage(file, maxSize = 1024){
  const dataUrl = await readFileAsDataURL(file);
  const mime = (dataUrl.match(/data:([^;]+)/) || [,'image/jpeg'])[1];
  try{
    const img = await new Promise((resolve, reject)=>{
      const i = new Image();
      i.onload = ()=>resolve(i);
      i.onerror = ()=>reject(new Error('Format nicht lesbar'));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    if(scale === 1 && dataUrl.length < 1.5e6) return {dataUrl, base64: dataUrl.split(',')[1], mime};
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(img.width  * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', 0.85);
    return {dataUrl: out, base64: out.split(',')[1], mime: 'image/jpeg'};
  }catch(err){
    // z. B. exotische Formate: dann eben ungerechnet hochladen
    return {dataUrl, base64: dataUrl.split(',')[1], mime};
  }
}

// Eine Stelle für beide Gemini-Aufrufe (Mahlzeit + Nährwerttabelle).
// Key im Header statt in der URL – so landet er nicht im Verlauf oder in Logs.
async function askGemini(base64, mime, prompt){
  const key = localStorage.getItem(STORE.geminiKey) || '';
  if(!key) throw new Error('Kein API-Key hinterlegt');
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': key},
      body: JSON.stringify({
        contents: [{parts: [
          {inlineData: {mimeType: mime, data: base64}},
          {text: prompt}
        ]}],
        generationConfig: {temperature: 0.1, maxOutputTokens: 200}
      })
    },
    45000
  );
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('Keine Nährwerte erkannt');
  return JSON.parse(match[0]);
}

function resetScanModal() {
  scanImage = null;
  $('#scanPreview').style.display = 'none';
  $('#scanUploadArea').style.display = 'block';
  $('#scanAnalyse').style.display = 'none';
  $('#scanLoading').style.display = 'none';
  $('#scanResults').style.display = 'none';
  $('#scanFile').value = '';
}

$('#scanBtn').addEventListener('click', () => {
  if (!localStorage.getItem(STORE.geminiKey)) {
    toast('Bitte zuerst Gemini API-Key in den Einstellungen eingeben');
    openSettings();
    return;
  }
  resetScanModal();
  openModal('scanModal');
});

$('#scanFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try{
    scanImage = await prepareImage(file);
    $('#scanPreview').src = scanImage.dataUrl;
    $('#scanPreview').style.display = 'block';
    $('#scanAnalyse').style.display = 'flex';
  }catch(err){
    toast('Fehler: ' + err.message);
  }
});

$('#scanAnalyse').addEventListener('click', async () => {
  if (!scanImage) return;
  $('#scanUploadArea').style.display = 'none';
  $('#scanAnalyse').style.display = 'none';
  $('#scanLoading').style.display = 'block';
  try {
    const result = await askGemini(scanImage.base64, scanImage.mime, GEMINI_PROMPT_MEAL);
    $('#scanLoading').style.display = 'none';
    $('#scanName').value = result.name || '';
    $('#scanKcal').value = validateNonNegativeFloat(result.kcal) ?? 0;
    $('#scanGrams').value = validatePositiveInt(result.grams) ?? 100;
    $('#scanProtein').value = validateNonNegativeFloat(result.protein) ?? 0;
    $('#scanCarbs').value = validateNonNegativeFloat(result.carbs) ?? 0;
    $('#scanFat').value = validateNonNegativeFloat(result.fat) ?? 0;
    $('#scanResults').style.display = 'block';
  } catch(err) {
    $('#scanLoading').style.display = 'none';
    $('#scanUploadArea').style.display = 'block';
    $('#scanAnalyse').style.display = 'flex';
    toast('Fehler: ' + err.message);
  }
});

$('#scanReset').addEventListener('click', resetScanModal);

$('#scanConfirm').addEventListener('click', () => {
  const name = $('#scanName').value.trim();
  if (!name) { showFieldError($('#scanName'), 'Bitte einen Namen eingeben'); return; }
  const grams = validateNonNegativeFloat($('#scanGrams').value);
  if (!grams) { showFieldError($('#scanGrams'), 'Bitte eine Portionsgröße eingeben'); return; }
  const totalKcal    = validateNonNegativeFloat($('#scanKcal').value)    ?? 0;
  const totalProtein = validateNonNegativeFloat($('#scanProtein').value) ?? 0;
  const totalCarbs   = validateNonNegativeFloat($('#scanCarbs').value)   ?? 0;
  const totalFat     = validateNonNegativeFloat($('#scanFat').value)     ?? 0;
  const meal = $('#scanMealSelect').value;
  // Werte auf 100g umrechnen für die Lebensmittel-Datenbank
  const r = 100 / grams;
  const food = {
    id: uid(), name,
    kcal:    Math.round(totalKcal    * r),
    protein: Math.round(totalProtein * r * 10) / 10,
    carbs:   Math.round(totalCarbs   * r * 10) / 10,
    fat:     Math.round(totalFat     * r * 10) / 10
  };
  foods.push(food);
  if (!log[state.date]) log[state.date] = [];
  log[state.date].push({foodId: food.id, grams, meal});
  save('foods','log'); closeModal('scanModal'); renderToday();
  toast(`${name} hinzugefügt`);
});

// ---------- PWA install ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault(); deferredPrompt = e;
  $('#installBanner').classList.add('show');
});
$('#installBtn').addEventListener('click', async ()=>{
  if(!deferredPrompt){$('#installBanner').classList.remove('show');return;}
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#installBanner').classList.remove('show');
});
window.addEventListener('appinstalled', ()=>$('#installBanner').classList.remove('show'));

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

// ---------- Standard-Lebensmittel ----------
const PRESET_FOODS = [
  // Proteinquellen
  {name:'Hühnerbrust (gegart)',    kcal:165, protein:31,  carbs:0,   fat:3.6},
  {name:'Putenbrust (gegart)',     kcal:135, protein:30,  carbs:0,   fat:1},
  {name:'Rinderhack (mager)',      kcal:215, protein:21,  carbs:0,   fat:14},
  {name:'Rindfleisch (Steak)',     kcal:217, protein:26,  carbs:0,   fat:12},
  {name:'Schweineschnitzel',       kcal:143, protein:22,  carbs:0,   fat:6},
  {name:'Lachs',                   kcal:208, protein:20,  carbs:0,   fat:13},
  {name:'Forelle',                 kcal:119, protein:21,  carbs:0,   fat:3.4},
  {name:'Thunfisch (in Wasser)',   kcal:116, protein:26,  carbs:0,   fat:0.5},
  {name:'Garnelen (gekocht)',      kcal:99,  protein:21,  carbs:0,   fat:1.1},
  {name:'Ei (gekocht)',            kcal:155, protein:13,  carbs:1.1, fat:11},
  {name:'Eiweiß (roh)',            kcal:52,  protein:11,  carbs:0.7, fat:0.2},
  {name:'Magerquark',              kcal:60,  protein:12,  carbs:4,   fat:0.2},
  {name:'Quark (20% Fett)',        kcal:106, protein:12,  carbs:4,   fat:5},
  {name:'Skyr',                    kcal:63,  protein:11,  carbs:4,   fat:0.2},
  {name:'Griechischer Joghurt',    kcal:59,  protein:10,  carbs:3.6, fat:0.4},
  {name:'Joghurt (3,5%)',          kcal:61,  protein:3.5, carbs:4.7, fat:3.5},
  {name:'Hüttenkäse',              kcal:98,  protein:11,  carbs:3.4, fat:4.3},
  {name:'Tofu (natur)',            kcal:76,  protein:8,   carbs:1.9, fat:4.8},
  {name:'Whey Protein',            kcal:375, protein:75,  carbs:6,   fat:5},
  {name:'Proteinriegel (Ø)',       kcal:370, protein:30,  carbs:40,  fat:8},
  // Milchprodukte & Käse
  {name:'Vollmilch',               kcal:61,  protein:3.2, carbs:4.8, fat:3.3},
  {name:'Hafermilch',              kcal:46,  protein:1,   carbs:9,   fat:1.5},
  {name:'Mozzarella',              kcal:254, protein:18,  carbs:2.2, fat:20},
  {name:'Gouda (45%)',             kcal:356, protein:25,  carbs:0,   fat:28},
  {name:'Frischkäse (Doppelrahm)',kcal:342,  protein:5.8, carbs:2.7, fat:34},
  {name:'Butter',                  kcal:717, protein:0.9, carbs:0.1, fat:81},
  // Kohlenhydrate
  {name:'Haferflocken',            kcal:370, protein:13,  carbs:62,  fat:7},
  {name:'Reis (gekocht)',          kcal:130, protein:2.7, carbs:28,  fat:0.3},
  {name:'Pasta (gekocht)',         kcal:158, protein:5.5, carbs:31,  fat:0.9},
  {name:'Kartoffeln (gekocht)',    kcal:77,  protein:2,   carbs:17,  fat:0.1},
  {name:'Süßkartoffel (gekocht)',  kcal:86,  protein:1.6, carbs:20,  fat:0.1},
  {name:'Quinoa (gekocht)',        kcal:120, protein:4.4, carbs:21,  fat:1.9},
  {name:'Vollkornbrot',            kcal:247, protein:8.5, carbs:41,  fat:3.4},
  {name:'Toastbrot',               kcal:265, protein:8,   carbs:49,  fat:3.2},
  {name:'Weißbrot / Brötchen',     kcal:270, protein:9,   carbs:50,  fat:3.2},
  {name:'Cornflakes',              kcal:378, protein:7,   carbs:84,  fat:0.9},
  // Obst
  {name:'Banane',                  kcal:89,  protein:1.1, carbs:23,  fat:0.3},
  {name:'Apfel',                   kcal:52,  protein:0.3, carbs:14,  fat:0.2},
  {name:'Orange',                  kcal:47,  protein:0.9, carbs:12,  fat:0.1},
  {name:'Erdbeeren',               kcal:32,  protein:0.7, carbs:7.7, fat:0.3},
  {name:'Beeren (gemischt)',       kcal:57,  protein:0.7, carbs:14,  fat:0.3},
  {name:'Mango',                   kcal:60,  protein:0.8, carbs:15,  fat:0.4},
  {name:'Weintrauben',             kcal:69,  protein:0.7, carbs:18,  fat:0.2},
  // Gemüse
  {name:'Brokkoli',                kcal:34,  protein:2.8, carbs:7,   fat:0.4},
  {name:'Spinat',                  kcal:23,  protein:2.9, carbs:3.6, fat:0.4},
  {name:'Paprika (rot)',           kcal:31,  protein:1,   carbs:6,   fat:0.3},
  {name:'Tomaten',                 kcal:18,  protein:0.9, carbs:3.9, fat:0.2},
  {name:'Gurke',                   kcal:15,  protein:0.7, carbs:3.1, fat:0.1},
  {name:'Möhren',                  kcal:41,  protein:0.9, carbs:9.6, fat:0.2},
  {name:'Zucchini',                kcal:17,  protein:1.2, carbs:3.1, fat:0.3},
  {name:'Blumenkohl',              kcal:25,  protein:1.9, carbs:5,   fat:0.3},
  {name:'Mais (Dose)',             kcal:86,  protein:2.9, carbs:19,  fat:1.2},
  {name:'Feldsalat',               kcal:19,  protein:1.8, carbs:3.6, fat:0.4},
  // Fette & Nüsse
  {name:'Olivenöl',                kcal:884, protein:0,   carbs:0,   fat:100},
  {name:'Avocado',                 kcal:160, protein:2,   carbs:9,   fat:15},
  {name:'Mandeln',                 kcal:579, protein:21,  carbs:22,  fat:50},
  {name:'Walnüsse',                kcal:654, protein:15,  carbs:14,  fat:65},
  {name:'Cashews',                 kcal:553, protein:18,  carbs:30,  fat:44},
  {name:'Erdnussbutter',           kcal:588, protein:25,  carbs:20,  fat:50},
  // Sonstiges
  {name:'Dunkle Schokolade (85%)', kcal:598, protein:8,   carbs:20,  fat:43},
  {name:'Olivenöl-Dressing (Ø)',   kcal:300, protein:0,   carbs:5,   fat:30},
];

// ---------- Boot ----------
load();

// Standard-Lebensmittel nur beim allerersten Start anlegen. Vorher kamen sie
// zurück, sobald man die eigene Liste komplett geleert hatte.
if (!localStorage.getItem(STORE.seeded)) {
  if (foods.length === 0) {
    foods = PRESET_FOODS.map(f => ({id: uid(), ...f}));
    save('foods');
  }
  localStorage.setItem(STORE.seeded, '1');
}

state.date = todayStr();
if (!TABS.includes(state.tab)) state.tab = 'today';   // kaputter gespeicherter Wert darf den Start nicht killen

$$('nav.bottom button').forEach(b=>b.classList.toggle('active', b.dataset.tab===state.tab));
$$('.page').forEach(p=>p.classList.remove('active'));
$('#page-'+state.tab).classList.add('active');
renderAll();
setDateNavVisible();   // wurde beim Start nie gesetzt -> Datumsleiste blieb versteckt
