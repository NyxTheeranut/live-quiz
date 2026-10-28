/**
 * Live quiz / vote: Google Sheets side.
 * Paste into: your spreadsheet > Extensions > Apps Script > Code.gs
 * Fill in the three constants, save, reload the spreadsheet.
 *
 * Two jobs:
 *  1. doGet: serves the "Awards" and "Nominees" (and optional "Quiz") tabs as JSON,
 *     so host.html can load them with one button instead of copy-paste.
 *     Deploy > Manage deployments > Edit > New version  (keeps the same /exec link).
 *     Execute as: Me. Who has access: Anyone. The ACCESS_CODE below is the lock.
 *  2. The "Quiz" menu: pulls the results of a finished game back into the sheet.
 *
 * Sheet tabs (row 1 is a header and is skipped):
 *   Awards    A: award name   B: definition   C: seconds to vote (optional)
 *   Nominees  A: name         B: group (team / department)
 *   Quiz      A: question  B..E: choices  F: correct (A-D or ก-ง)  G: seconds   (quiz mode only)
 */
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XXXXXXXXXXXXXXXXXXXXXXXX'; // same key as config.js
const ACCESS_CODE  = 'CHANGE-ME';                                // typed into host.html; keeps strangers out

function doGet(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!e || !e.parameter || e.parameter.code !== ACCESS_CODE) return out({ error: 'wrong or missing code' });
  const ss = SpreadsheetApp.getActive();
  const tab = (name, width) => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, width).getDisplayValues()
      .filter(r => String(r[0]).trim() !== '');
  };
  return out({ awards: tab('Awards', 3), nominees: tab('Nominees', 2), quiz: tab('Quiz', 7) });
}

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

  // Sheet 1: every answer / vote
  const raw = ss.getSheetByName('Game ' + pin) || ss.insertSheet('Game ' + pin);
  raw.clear();
  raw.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  if (rows.length) raw.getRange(2, 1, rows.length, cols.length).setValues(rows.map(r => cols.map(c => c === 'is_correct' ? (r[c] === null ? '' : (r[c] ? 1 : 0)) : (r[c] === null ? '' : r[c]))));
  raw.setFrozenRows(1);

  // Sheet 2: votes per award and nominee (vote games), built with a formula so it stays live
  const board = ss.getSheetByName('Board ' + pin) || ss.insertSheet('Board ' + pin);
  board.clear();
  board.getRange('A1').setFormula(
    `=QUERY('Game ${pin}'!A:H, "select C, D, count(A) where A is not null group by C, D order by C, count(A) desc ` +
    `label C 'award', D 'nominee', count(A) 'votes'", 1)`
  );

  ui.alert(`Imported ${rows.length} rows into "Game ${pin}" and "Board ${pin}".`);
}
