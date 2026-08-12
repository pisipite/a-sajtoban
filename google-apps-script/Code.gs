const SPREADSHEET_ID = "1ew6L7q_sT8C8jro0rFBAlMfx1bZGw0rWSQ5NCbNWqjw";
const SHEET_NAME = "ai";
const HELPER_SHEET_NAME = "segéd";
const HELPER_TOPIC_HEADER = "téma";
const HELPER_TYPE_HEADER = "típus";
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

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (payload.action === "options") {
      return response_({
        source: "kmonitor-sheet",
        requestId: requestId,
        ok: true,
        options: classificationOptions_(spreadsheet),
      });
    }
    if (payload.action === "accept") {
      const options = classificationOptions_(spreadsheet);
      const requestedType = String(payload.article_type || "").trim().toLocaleLowerCase();
      if (!options.types.some(function (type) { return type.toLocaleLowerCase() === requestedType; })) {
        throw new Error("A típus csak a segéd munkalap listájából választható.");
      }
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
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
        addTopicIfMissing_(spreadsheet, payload.topic);
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
  if (payload.action !== "accept" && payload.action !== "remove" && payload.action !== "options") throw new Error("Ismeretlen művelet.");
  if (payload.action === "options") return;
  if (!payload.id || String(payload.id).length > 200) throw new Error("Érvénytelen azonosító.");
  if (payload.action === "accept" && (!payload.url || !payload.title || !payload.topic || !payload.article_type)) {
    throw new Error("A cikk, a téma és a típus megadása kötelező.");
  }
  if (String(payload.topic || "").length > 200 || String(payload.article_type || "").length > 100) {
    throw new Error("Túl hosszú téma vagy típus.");
  }
}

function classificationOptions_(spreadsheet) {
  const helper = spreadsheet.getSheetByName(HELPER_SHEET_NAME);
  if (!helper) throw new Error("A segéd munkalap nem található.");
  const columns = helperColumns_(helper);
  return {
    topics: columnValues_(helper, columns.topic),
    types: columnValues_(helper, columns.type),
  };
}

function helperColumns_(sheet) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function (value) { return String(value || "").trim().toLowerCase(); });
  const topic = headers.indexOf(HELPER_TOPIC_HEADER) + 1;
  const type = headers.indexOf(HELPER_TYPE_HEADER) + 1;
  if (!topic || !type) throw new Error("A segéd munkalapon nincs téma vagy típus oszlop.");
  return { topic: topic, type: type };
}

function columnValues_(sheet, column) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const seen = {};
  return sheet.getRange(2, column, lastRow - 1, 1).getDisplayValues()
    .map(function (row) { return String(row[0] || "").trim(); })
    .filter(function (value) {
      const key = value.toLocaleLowerCase();
      if (!value || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function addTopicIfMissing_(spreadsheet, topicValue) {
  const topic = String(topicValue || "").trim();
  if (!topic) return;
  const helper = spreadsheet.getSheetByName(HELPER_SHEET_NAME);
  if (!helper) throw new Error("A segéd munkalap nem található.");
  const topicColumn = helperColumns_(helper).topic;
  const values = columnValues_(helper, topicColumn);
  const normalized = topic.toLocaleLowerCase();
  if (values.some(function (value) { return value.toLocaleLowerCase() === normalized; })) return;

  const lastRow = Math.max(1, helper.getLastRow());
  const cells = lastRow > 1 ? helper.getRange(2, topicColumn, lastRow - 1, 1).getDisplayValues() : [];
  let lastTopicRow = 1;
  cells.forEach(function (row, index) {
    if (String(row[0] || "").trim()) lastTopicRow = index + 2;
  });
  helper.getRange(lastTopicRow + 1, topicColumn).setValue(topic);
}

function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  for (let index = 0; index < HEADERS.length; index += 1) {
    if (current[index] && current[index] !== HEADERS[index]) {
      throw new Error("Az ai munkalap fejlécsora nem a várt szerkezetű.");
    }
  }
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight("bold")
    .setBackground("#173f3a")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);
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
