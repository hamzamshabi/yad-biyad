// Everything about a report that someone else decides lives here, so it can change in one place:
// the 13 types and their agencies, when a reading counts as sure, and the send itself.

// The agencies and the type to agency table started from the design (app_design/gen_canvas.py, the NotThis screen).
// Hamza approved it on 2 Nov 2026, with one change: the design's "المرور والطوارئ الموحد 993 · 911" is two agencies now,
// so حادث goes to 993 and استغاثة عامة to 911. The priority is still missing; it belongs to the backend member.
const AGENCIES = {
  rc: {name: 'الهلال الأحمر', number: '997'},
  cd: {name: 'الدفاع المدني', number: '998'},
  po: {name: 'الشرطة', number: '999'},
  tr: {name: 'المرور', number: '993'},
  un: {name: 'الطوارئ الموحد', number: '911'},
};

// In the order of the "all types" screen. The names are the ones the reading service answers in type_ar.
const TYPES = [
  {name: 'إسعاف', icon: 'ambulance', agency: 'rc'},
  {name: 'ضيق تنفس', icon: 'wind', agency: 'rc'},
  {name: 'سكتة أو جلطة', icon: 'pulse', agency: 'rc'},
  {name: 'نزيف', icon: 'drop', agency: 'rc'},
  {name: 'صرع', icon: 'zap', agency: 'rc'},
  {name: 'حريق', icon: 'flame', agency: 'cd'},
  {name: 'غاز أو انفجار', icon: 'alert', agency: 'cd'},
  {name: 'غرق', icon: 'waves', agency: 'cd'},
  {name: 'شرطة', icon: 'shield', agency: 'po'},
  {name: 'سلاح أو تهديد', icon: 'cross', agency: 'po'},
  {name: 'شخص مفقود', icon: 'search', agency: 'po'},
  {name: 'حادث', icon: 'car', agency: 'tr'},
  {name: 'استغاثة عامة', icon: 'buoy', agency: 'un'},
];

// A reading the service marks as a report opens "تأكّد قبل الإرسال" with the type already chosen only when its p_normal is
// below this number. Otherwise it opens "هل تقصد؟", where the person taps the type first. Hamza decides the number
// (SCREENS_BRIEF rule 6). While it is null, no reading counts as sure, so every report goes through "هل تقصد؟".
// Hamza, 2 Nov 2026: stays null for now.
const SURE_BELOW = null;

// The one place a report leaves the app. There is no report server yet, so this is a demo: nothing is sent anywhere.
// The real request replaces the body and keeps the contract: resolve with {id, at} once the server has the report,
// throw when it does not, and the app shows the "not sent" screen and tries again.
// With ?debug=1&fail=1 it always fails, to check that screen.
async function sendReport(report) {
  const q = new URLSearchParams(location.search);
  if (!navigator.onLine || (q.get('debug') === '1' && q.get('fail') === '1')) throw new Error('offline');
  return {id: `YB-${Math.floor(1000 + Math.random() * 9000)}`, at: new Date(), demo: true};
}
