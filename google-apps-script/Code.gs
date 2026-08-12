const SPREADSHEET_ID = "1ew6L7q_sT8C8jro0rFBAlMfx1bZGw0rWSQ5NCbNWqjw";
const SHEET_NAME = "ai";
const HEADERS = [
  "dátum",
  "cím",
  "forrás",
  "link",
  "téma",
  "típus",
  "pontszám",
  "szövegkörnyezet",
  "elfogadva",
  "azonosító",
];

function doGet() {
  return HtmlService.createHtmlOutput("K-Monitor sajtófigyelő – Google Táblázatok-kapcsolat");
}

function doPost(event) {
  const requestId = String(event && event.parameter && event.parameter.request_id || "");
  try {
    const payload = JSON.parse(String(event.parameter.payload || "{}"));
    validatePayload_(payload);

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
      ensureHeaders_(sheet);

      const row = findRowById_(sheet, payload.id);
      if (payload.action === "remove") {
        if (row) sheet.deleteRow(row);
      } else {
        const values = [[
          payload.date || "",
          payload.title || "",
          payload.source || "",
          payload.url || "",
          payload.topic || "",
          payload.article_type || "",
          payload.score === "" ? "" : Number(payload.score),
          payload.context || "",
          payload.accepted_at ? new Date(payload.accepted_at) : new Date(),
          payload.id,
        ]];
        if (row) sheet.getRange(row, 1, 1, HEADERS.length).setValues(values);
        else sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues(values);
        sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1).setNumberFormat("yyyy-mm-dd");
        sheet.getRange(2, 9, Math.max(1, sheet.getLastRow() - 1), 1).setNumberFormat("yyyy-mm-dd hh:mm");
      }
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    return response_({ source: "kmonitor-sheet", requestId: requestId, ok: true });
  } catch (error) {
    return response_({
      source: "kmonitor-sheet",
      requestId: requestId,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
}

function validatePayload_(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Hiányzó adatok.");
  if (payload.action !== "accept" && payload.action !== "remove") throw new Error("Ismeretlen művelet.");
  if (!payload.id || String(payload.id).length > 200) throw new Error("Érvénytelen azonosító.");
  if (payload.action === "accept" && (!payload.url || !payload.title)) throw new Error("Hiányzó cikkadatok.");
}

function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (current.every(function (value) { return !value; })) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#173f3a")
      .setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  } else if (current.join("\u0000") !== HEADERS.join("\u0000")) {
    throw new Error("Az ai munkalap fejlécsora nem a várt szerkezetű.");
  }
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const match = sheet.getRange(2, 10, lastRow - 1, 1)
    .createTextFinder(String(id))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function response_(message) {
  const json = JSON.stringify(message).replace(/</g, "\\u003c");
  return HtmlService.createHtmlOutput(
    "<!doctype html><meta charset=\"utf-8\"><script>parent.postMessage(" + json + ", '*');<\/script>"
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
