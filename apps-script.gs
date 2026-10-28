/**
 * Live quiz → Google Sheets results export.
 * Paste into: your results spreadsheet → Extensions → Apps Script → Code.gs
 * Fill in the two constants, save, reload the spreadsheet, then use the "Quiz" menu.
 */
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XXXXXXXXXXXXXXXXXXXXXXXX'; // same key as config.js

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Quiz')
    .addItem('Pull results for a game…', 'pullResults')
    .addToUi();
}

function pullResults() {
  const ui = SpreadsheetApp.getUi();
  const pinAsk = ui.prompt('Game PIN', 'The 6-digit PIN shown on the host screen', ui.ButtonSet.OK_CANCEL);
  if (pinAsk.getSelectedButton() !== ui.Button.OK) return;
  const tokenAsk = ui.prompt('Host token', 'Shown at the bottom of the final results screen', ui.ButtonSet.OK_CANCEL);
  if (tokenAsk.getSelectedButton() !== ui.Button.OK) return;

  const pin = pinAsk.getResponseText().trim();
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/get_results', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_KEY },
    payload: JSON.stringify({ p_pin: pin, p_token: tokenAsk.getResponseText().trim() }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    ui.alert('Could not fetch results', res.getContentText(), ui.ButtonSet.OK);
    return;
  }

  const rows = JSON.parse(res.getContentText());
  const cols = ['nickname', 'question', 'prompt', 'choice', 'correct', 'is_correct', 'elapsed_ms', 'points'];
  const ss = SpreadsheetApp.getActive();

  // Sheet 1: every answer
  const raw = ss.getSheetByName('Game ' + pin) || ss.insertSheet('Game ' + pin);
  raw.clear();
  raw.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  if (rows.length) raw.getRange(2, 1, rows.length, cols.length).setValues(rows.map(r => cols.map(c => c === 'is_correct' ? (r[c] ? 1 : 0) : r[c])));
  raw.setFrozenRows(1);

  // Sheet 2: leaderboard, built with a formula so it stays live if you edit the raw sheet
  const board = ss.getSheetByName('Board ' + pin) || ss.insertSheet('Board ' + pin);
  board.clear();
  board.getRange('A1').setFormula(
    `=QUERY('Game ${pin}'!A:H, "select A, sum(H), count(B), avg(F) ` +
    `where A is not null group by A order by sum(H) desc ` +
    `label sum(H) 'total points', count(B) 'answered', avg(F) 'accuracy'", 1)`
  );

  ui.alert(`Imported ${rows.length} answers into "Game ${pin}" and "Board ${pin}".`);
}
