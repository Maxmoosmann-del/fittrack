// Kopfzeile: Titel und Unterzeile je nach Tab.
import { db } from '../store.js';
import { fmtDate, fmtShortDate, isoWeek, todayStr } from '../util.js';
import { $ } from './dom.js';

const TITLES = { foods: 'Lebensmittel', workouts: 'Training' };

export function renderHeader() {
  const { tab, date } = db.state;
  const isFoods = tab === 'foods';
  // "Heute" zeigt den Tag als Titel (Heute/Gestern/Montag …), die anderen Tabs ihren Namen.
  $('#dateLabel').textContent = tab === 'today' ? fmtDate(date) : TITLES[tab];
  const relative = tab === 'workouts' && date !== todayStr() ? `${fmtDate(date)} · ` : '';
  $('#dateSub').textContent = `${relative}FT//KW${isoWeek(date)} · ${fmtShortDate(date)}`;
  $('#dateNav').hidden = isFoods;
  $('#foodsSub').hidden = !isFoods;
  $('#foodCount').textContent = db.foods.length;
}
