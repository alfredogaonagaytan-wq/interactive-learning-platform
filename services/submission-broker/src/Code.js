/**
 * Interactive Learning Platform — submission service (Google Apps Script web app).
 *
 * Runs inside ONE teacher's own Google account ("Execute as: Me"). It:
 *  - verifies each caller's Google ID token (audience = the app's OAuth client)
 *  - recognises the teacher (whoever connected it with the one-time code) and roster students
 *  - stores classes, the private roster, assignments and submissions in ONE
 *    folder it creates in the teacher's Drive — no other server
 *  - re-grades submissions with the same engine the app uses, writes a
 *    teacher-owned report, and returns an HMAC-signed receipt
 *
 * Google permissions (appsscript.json): only
 *  - drive.file: the files and folders THIS script creates (Google does not let
 *    it see any other file in the teacher's Drive), used through the Drive API
 *    v3 and Sheets API v4 — not DriveApp/SpreadsheetApp, which need full access
 *  - script.external_request: to call those APIs and Google's token check
 *
 * Security model (see docs/14-security-audit.md and docs/15-drive-file-storage.md):
 *  - every request needs a Google ID token for the app's OAuth client whose
 *    nonce names THIS service; the service records its own id when the teacher
 *    connects, so tokens captured by any other service are useless here
 *  - the teacher proves ownership once with the code printed by setup(), and is
 *    then pinned to their Google account id
 *  - students are identified only through the private roster, never by
 *    anything they send; Drive file ids never come from requests
 *  - sheet values are written RAW: stored exactly, never parsed as formulas
 */
var VERSION = '0.6.0';
var CORE_BUILD = '__CORE_BUILD__'; // filled in by build.mjs
var ROOT_NAME = 'Interactive Learning Platform';
var SHEETS = {
  Classes: ['classId', 'name', 'section', 'folderId', 'createdAt'],
  Roster: ['studentNumber', 'name', 'email', 'classId', 'status', 'googleSub', 'boundAt'],
  Assignments: ['assignmentId', 'classId', 'title', 'fileId', 'grading', 'dueAt', 'allowLate', 'maxAttempts', 'showScore', 'closed', 'createdAt'],
  Submissions: ['receivedAt', 'assignmentId', 'classId', 'studentNumber', 'attemptId', 'attemptNumber', 'score', 'maxScore', 'needsReview', 'late', 'reportFileId', 'clientScore', 'scoreMismatch', 'receiptId', 'signature'],
};
/** Sub-folders of every class folder. */
var CLASS_FOLDERS = { activities: 'Activities and media', submissions: 'Student submissions', recordings: 'Recordings', reports: 'Reports' };
var DRIVE = 'https://www.googleapis.com/drive/v3';
var UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
var SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
var FOLDER_MIME = 'application/vnd.google-apps.folder';
var SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
/** Per-request memo (sheet rows, storage ids). Reset by doPost. */
var memo_ = {};

/* ------------------------------------------------------------------ entry */
function doGet() {
  return json_({ ok: true, service: 'ilp-submission-broker', version: VERSION });
}

function doPost(e) {
  memo_ = {};
  var req;
  var body = (e && e.postData && e.postData.contents) || '{}';
  if (body.length > ILP.MAX_SUBMISSION_CHARS) return json_({ ok: false, error: 'bad-request', message: 'The request is too large.' });
  try {
    req = JSON.parse(body);
  } catch (err) {
    return json_({ ok: false, error: 'bad-request', message: 'Request is not valid JSON.' });
  }
  try {
    var who = verifyCaller_(req.idToken, req.connectCode);
    var result = route_(req.action, who, req);
    return json_({ ok: true, result: result });
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code, message: err.message });
    // Internal details stay in the teacher's own execution log (Apps Script → Executions); the caller gets a reference only.
    var ref = Utilities.getUuid().slice(0, 8);
    console.error('ILP error ' + ref + ': ' + String((err && err.stack) || err).slice(0, 1000));
    return json_({ ok: false, error: 'server-error', message: 'Something went wrong in the submission service. Try again later (reference ' + ref + ').' });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  var e = new Error(message);
  e.code = code;
  throw e;
}

/* --------------------------------------------------------------- identity */
function props_() {
  return PropertiesService.getScriptProperties();
}

/** Reads the token's claims WITHOUT verifying them: only used to discard junk before asking Google. */
function unverifiedClaims_(idToken) {
  var parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    var b64 = parts[1] + '==='.slice((parts[1].length + 3) % 4);
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString());
  } catch (err) {
    return null;
  }
}

function verifyCaller_(idToken, connectCode) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 5000) fail_('unauthenticated', 'Sign in with Google first.');
  var clientId = props_().getProperty('CLIENT_ID');
  if (!clientId || clientId.indexOf('__') === 0) fail_('not-configured', 'The submission service is not set up yet (CLIENT_ID missing). Run setup().');
  var claims = unverifiedClaims_(idToken);
  if (!claims || claims.aud !== clientId || !(Number(claims.exp) > Date.now() / 1000)) fail_('unauthenticated', 'Your sign-in could not be verified. Sign in again.');
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var cached = cache.get(key);
  var info;
  if (cached) info = JSON.parse(cached);
  else {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) fail_('unauthenticated', 'Your sign-in could not be verified. Sign in again.');
    info = JSON.parse(res.getContentText());
  }
  var now = Math.floor(Date.now() / 1000);
  if (info.aud !== clientId) fail_('unauthenticated', 'This sign-in was not made for this app.');
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') fail_('unauthenticated', 'Unexpected token issuer.');
  if (!(Number(info.exp) > now)) fail_('unauthenticated', 'Your sign-in has expired. Sign in again.');
  if (String(info.email_verified) !== 'true') fail_('unauthenticated', 'Your Google email address is not verified.');
  var domain = props_().getProperty('ALLOWED_DOMAIN');
  if (domain && info.hd !== domain) fail_('forbidden', 'Use your school Google account (' + domain + ').');
  if (!info.sub) fail_('unauthenticated', 'Your sign-in could not be verified. Sign in again.');
  if (!cached) cache.put(key, JSON.stringify({ aud: info.aud, iss: info.iss, exp: info.exp, email: info.email, email_verified: info.email_verified, sub: info.sub, hd: info.hd || '', nonce: info.nonce || '' }), Math.max(1, Math.min(300, Number(info.exp) - now)));
  var email = String(info.email).toLowerCase();
  var sub = String(info.sub);
  // The token must have been requested for THIS service (see brokerNonce in the app).
  var tokenBroker = ILP.brokerIdFromNonce(info.nonce);
  if (!tokenBroker) fail_('unauthenticated', 'This sign-in was not made for this submission service. Sign in again.');
  if (!props_().getProperty('BROKER_ID')) connect_(tokenBroker, email, sub, connectCode);
  if (tokenBroker !== props_().getProperty('BROKER_ID')) fail_('unauthenticated', 'This sign-in was made for a different submission service. Sign in again.');
  var isTeacher = teacherEmails_().indexOf(email) >= 0 && teacherSubOk_(email, sub);
  return { sub: sub, email: email, isTeacher: isTeacher };
}

/**
 * First use: whoever presents the one-time code from setup() becomes the
 * teacher (pinned to their Google account id), and the service records its own
 * id from the token's nonce. Until then the service accepts nobody.
 */
function connect_(tokenBroker, email, sub, connectCode) {
  if (!connectCode) fail_('not-connected', 'Your teacher has not finished connecting this submission service yet.');
  withLock_(function () {
    var p = props_();
    if (p.getProperty('BROKER_ID')) return;
    var fails = Number(p.getProperty('CONNECT_FAILS') || 0);
    if (fails >= 10) fail_('forbidden', 'Too many wrong connection codes. Run resetConnection in the Apps Script editor to get a new code.');
    var expected = p.getProperty('CONNECT_HASH');
    if (!expected || hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normCode_(connectCode))) !== expected) {
      p.setProperty('CONNECT_FAILS', String(fails + 1));
      fail_('forbidden', 'That connection code is not correct. Copy it from the execution log shown after running setup.');
    }
    p.setProperty('BROKER_ID', tokenBroker);
    p.setProperty('OWNER_EMAIL', email);
    p.setProperty('TEACHER_SUBS', JSON.stringify(pin_({}, email, sub)));
    p.deleteProperty('CONNECT_HASH');
    p.deleteProperty('CONNECT_FAILS');
  });
}

function pin_(o, email, sub) {
  o[email] = sub;
  return o;
}

function normCode_(c) {
  return String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** A new one-time connection code (80 random bits); only its hash is stored. */
function newConnectionCode_() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  var code = '';
  for (var i = 0; i < 16; i++) code += alphabet.charAt(bytes[i] & 31) + (i % 4 === 3 && i < 15 ? '-' : '');
  props_().setProperty('CONNECT_HASH', hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normCode_(code))));
  props_().setProperty('CONNECT_FAILS', '0');
  return code;
}

/** Pins each teacher email to the Google account id that first used it, so a reassigned address cannot inherit the role. */
function teacherSubOk_(email, sub) {
  var pins = JSON.parse(props_().getProperty('TEACHER_SUBS') || '{}');
  if (pins[email]) return pins[email] === sub;
  return withLock_(function () {
    var fresh = JSON.parse(props_().getProperty('TEACHER_SUBS') || '{}');
    if (!fresh[email]) {
      fresh[email] = sub;
      props_().setProperty('TEACHER_SUBS', JSON.stringify(fresh));
    }
    return fresh[email] === sub;
  });
}

function teacherEmails_() {
  var owner = String(props_().getProperty('OWNER_EMAIL') || '').toLowerCase();
  var extra = (props_().getProperty('TEACHERS') || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(String);
  return [owner].concat(extra).filter(String);
}

function requireTeacher_(who) {
  if (!who.isTeacher) fail_('forbidden', 'Only the teacher can do this.');
}

/* ---------------------------------------------- Google APIs (drive.file) */
/**
 * One authorised call to the Drive or Sheets API with this script's own
 * token. Under drive.file Google answers 404 for every file the script did not
 * create, so a missing file and a file outside the app look the same.
 */
function api_(method, url, body, opts) {
  opts = opts || {};
  var params = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (opts.blob) {
    params.payload = opts.blob;
    params.contentType = opts.contentType || 'application/octet-stream';
  } else if (body !== undefined) {
    params.payload = JSON.stringify(body);
    params.contentType = 'application/json';
  }
  var res = UrlFetchApp.fetch(url, params);
  var code = res.getResponseCode();
  if (code === 404) {
    var nf = new Error('Google API: not found');
    nf.notFound = true;
    throw nf;
  }
  if (code === 429 || code >= 500) fail_('busy', 'Google Drive is busy. It will be retried shortly.');
  if (code >= 400) throw new Error('Google API ' + code + ': ' + res.getContentText().slice(0, 300));
  if (opts.raw) return res;
  var text = res.getContentText();
  return text ? JSON.parse(text) : {};
}

/** Drive query string literal. */
function q_(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/** Creates a file or folder (metadata only) inside a folder this script created. Every file is tagged ilp=<kind>. */
function driveCreate_(name, mimeType, parentId, kind, extra) {
  var appProperties = { ilp: kind };
  Object.keys(extra || {}).forEach(function (k) { appProperties[k] = String(extra[k]); });
  return api_('post', DRIVE + '/files?fields=id,name,webViewLink', { name: name, mimeType: mimeType, parents: [parentId], appProperties: appProperties });
}

function driveFile_(name, mimeType, parentId, kind, blob, extra) {
  var f = driveCreate_(name, mimeType, parentId, kind, extra);
  api_('patch', UPLOAD + '/files/' + f.id + '?uploadType=media&fields=id', undefined, { blob: blob, contentType: mimeType });
  return f;
}

function driveText_(id) {
  return api_('get', DRIVE + '/files/' + encodeURIComponent(id) + '?alt=media', undefined, { raw: true }).getContentText();
}

function driveBytes_(id) {
  return api_('get', DRIVE + '/files/' + encodeURIComponent(id) + '?alt=media', undefined, { raw: true }).getContent();
}

function driveMeta_(id) {
  return api_('get', DRIVE + '/files/' + encodeURIComponent(id) + '?fields=id,name,mimeType,parents,trashed,webViewLink,size');
}

/** Lists files matching q. Under drive.file Google returns only files this script may use. */
function driveList_(q) {
  var out = [];
  var token = '';
  do {
    var r = api_('get', DRIVE + '/files?pageSize=1000&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,size,appProperties,parents)') + '&q=' + encodeURIComponent(q) + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    out = out.concat(r.files || []);
    token = r.nextPageToken || '';
  } while (token);
  return out;
}

function childFolder_(parentId, name, kind) {
  var found = driveList_(q_(parentId) + ' in parents and name = ' + q_(name) + " and mimeType = '" + FOLDER_MIME + "' and trashed = false");
  return found.length ? found[0].id : driveCreate_(name, FOLDER_MIME, parentId, kind).id;
}

/* ---------------------------------------------------------------- storage */
function storage_() {
  if (memo_.storage) return memo_.storage;
  var p = props_();
  var rootId = p.getProperty('ROOT_FOLDER_ID');
  var sheetId = p.getProperty('SHEET_ID');
  if (!rootId || !sheetId) fail_('not-configured', 'The submission service has no storage yet. Run setup in the Apps Script editor.');
  memo_.storage = { rootId: rootId, sheetId: sheetId };
  return memo_.storage;
}

/** Creates the storage folder, the private sheet and its tabs if they do not exist (or are no longer reachable). */
function ensureStorage_() {
  var p = props_();
  var rootId = p.getProperty('ROOT_FOLDER_ID');
  var root = null;
  if (rootId) {
    try {
      root = driveMeta_(rootId);
      if (root.trashed) root = null;
    } catch (err) {
      if (!err.notFound) throw err;
    }
  }
  if (!root) {
    // Created at the top of My Drive; the teacher may move it anywhere afterwards (the script keeps access to it).
    root = api_('post', DRIVE + '/files?fields=id,name,webViewLink', { name: ROOT_NAME, mimeType: FOLDER_MIME, appProperties: { ilp: 'root' } });
    p.setProperty('ROOT_FOLDER_ID', root.id);
    p.deleteProperty('SHEET_ID');
  }
  var sheetId = p.getProperty('SHEET_ID');
  if (!sheetId) {
    sheetId = driveCreate_('ILP – Private roster and submissions (do not share)', SHEET_MIME, root.id, 'sheet').id;
    var reqs = Object.keys(SHEETS).map(function (t) { return { addSheet: { properties: { title: t } } }; });
    reqs.push({ deleteSheet: { sheetId: 0 } });
    api_('post', SHEETS_API + '/' + sheetId + ':batchUpdate', { requests: reqs });
    p.setProperty('SHEET_ID', sheetId);
    memo_ = {};
    Object.keys(SHEETS).forEach(function (t) { sheetsPut_(t + '!A1', [SHEETS[t]]); });
  }
  childFolder_(root.id, 'Classes', 'classes');
  memo_ = {};
  return { root: root, sheetId: sheetId };
}

function colLetter_(n) {
  var s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetsPut_(range, values) {
  api_('put', SHEETS_API + '/' + storage_().sheetId + '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW', { values: values });
}

/** Values are written RAW: Sheets stores them exactly as given and never turns text into formulas, numbers or dates. */
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return v;
}

/** Values read back. A date typed into the sheet by hand arrives as a serial number; its column readers handle that. */
function value_(v) {
  return v === undefined || v === null ? '' : v;
}

function rowValues_(name, obj) {
  return SHEETS[name].map(function (h) { return cell_(obj[h]); });
}

function rows_(name) {
  memo_.rows = memo_.rows || {};
  if (memo_.rows[name]) return memo_.rows[name];
  var r = api_('get', SHEETS_API + '/' + storage_().sheetId + '/values/' + encodeURIComponent(name + '!A2:' + colLetter_(SHEETS[name].length)) + '?valueRenderOption=UNFORMATTED_VALUE');
  var head = SHEETS[name];
  memo_.rows[name] = (r.values || []).map(function (row, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, k) { o[h] = value_(row[k]); });
    return o;
  }).filter(function (o) { return head.some(function (h) { return o[h] !== ''; }); });
  return memo_.rows[name];
}

function append_(name, obj) {
  api_('post', SHEETS_API + '/' + storage_().sheetId + '/values/' + encodeURIComponent(name + '!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { values: [rowValues_(name, obj)] });
  if (memo_.rows) delete memo_.rows[name];
}

function update_(name, rowNumber, obj) {
  sheetsPut_(name + '!A' + rowNumber + ':' + colLetter_(SHEETS[name].length) + rowNumber, [rowValues_(name, obj)]);
  if (memo_.rows) delete memo_.rows[name];
}

/** Milliseconds for a stored time: ISO text (written by the service) or a serial date (typed by hand). */
function timeOf_(v) {
  if (typeof v === 'number') return Math.round((v - 25569) * 864e5);
  var t = Date.parse(String(value_(v)));
  return isNaN(t) ? null : t;
}

function isoOf_(v) {
  var t = timeOf_(v);
  return v === '' || t === null ? '' : new Date(t).toISOString();
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    fail_('busy', 'The submission service is busy. It will be retried shortly.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toLowerCase();
}

function safeName_(s) {
  return String(s).replace(/[\\/:*?"<>|#]+/g, ' ').slice(0, 80).trim() || 'untitled';
}

/* ----------------------------------------------------------------- router */
function route_(action, who, req) {
  switch (action) {
    case 'whoami': return whoami_(who);
    case 'classes.list': requireTeacher_(who); return rows_('Classes').map(publicClass_);
    case 'classes.create': requireTeacher_(who); return createClass_(req);
    case 'roster.get': requireTeacher_(who); return rows_('Roster').filter(function (r) { return r.classId === req.classId; }).map(stripRow_);
    case 'roster.put': requireTeacher_(who); return putRoster_(req);
    case 'assignments.create': requireTeacher_(who); return createAssignment_(req);
    case 'assignments.list': requireTeacher_(who); return rows_('Assignments').filter(function (a) { return !req.classId || a.classId === req.classId; }).map(publicAssignment_);
    case 'assignments.update': requireTeacher_(who); return updateAssignment_(req);
    case 'submissions.list': requireTeacher_(who); return rows_('Submissions').filter(function (s) { return s.assignmentId === req.assignmentId; }).map(stripRow_);
    case 'submissions.report': requireTeacher_(who); return readReport_(req);
    case 'storage.info': requireTeacher_(who); return storageInfo_();
    case 'storage.export': requireTeacher_(who); return storageExport_();
    case 'student.assignment': return studentAssignment_(who, req);
    case 'student.asset': return studentAsset_(who, req);
    case 'student.submit': return studentSubmit_(who, req);
    case 'student.receipts': return studentReceipts_(who, req);
    default: fail_('bad-request', 'Unknown action.');
  }
}

function stripRow_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; });
  return o;
}
function publicClass_(c) { return { classId: c.classId, name: String(c.name), section: String(c.section), createdAt: String(c.createdAt) }; }
function publicAssignment_(a) {
  return { assignmentId: a.assignmentId, classId: a.classId, title: String(a.title), grading: a.grading, dueAt: a.dueAt ? isoOf_(a.dueAt) || null : null, allowLate: a.allowLate === true || a.allowLate === 'TRUE' || a.allowLate === 'true', maxAttempts: a.maxAttempts === '' ? null : Number(a.maxAttempts), showScore: String(a.showScore) !== 'false', closed: String(a.closed) === 'true', createdAt: String(a.createdAt) };
}

/* ---------------------------------------------------------------- teacher */
function whoami_(who) {
  if (who.isTeacher) return { role: 'teacher', email: who.email, version: VERSION, coreOk: typeof ILP_CORE_BUILD !== 'undefined' && ILP_CORE_BUILD === CORE_BUILD };
  return { role: 'student', email: who.email, version: VERSION };
}

function classFolder_(cls, key) {
  return childFolder_(String(cls.folderId), CLASS_FOLDERS[key], key);
}

function createClass_(req) {
  var name = String(req.name || '').trim();
  if (!name) fail_('bad-request', 'Give the class a name.');
  return withLock_(function () {
    var s = storage_();
    var id = newId_('cls');
    var classes = childFolder_(s.rootId, 'Classes', 'classes');
    var folder = driveCreate_(safeName_(name + (req.section ? ' ' + req.section : '')) + ' (' + id + ')', FOLDER_MIME, classes, 'class', { classId: id });
    Object.keys(CLASS_FOLDERS).forEach(function (k) { driveCreate_(CLASS_FOLDERS[k], FOLDER_MIME, folder.id, k); });
    var row = { classId: id, name: name, section: String(req.section || ''), folderId: folder.id, createdAt: new Date().toISOString() };
    append_('Classes', row);
    return publicClass_(row);
  });
}

function classRow_(classId) {
  var c = rows_('Classes').filter(function (x) { return x.classId === classId; })[0];
  if (!c) fail_('not-found', 'Class not found.');
  return c;
}

function putRoster_(req) {
  var classId = String(req.classId || '');
  classRow_(classId);
  var incoming = (req.rows || []).map(function (r) {
    var parsed = ILP.RosterRowSchema.safeParse({ studentNumber: r.studentNumber, name: r.name || '', email: r.email, classId: classId, status: r.status || 'active' });
    if (!parsed.success) fail_('bad-request', 'Roster row for “' + (r.studentNumber || r.email || '?') + '” is invalid.');
    return parsed.data;
  });
  var problems = ILP.rosterProblems(incoming);
  if (problems.length) fail_('bad-request', problems[0].message);
  return withLock_(function () {
    if (memo_.rows) delete memo_.rows.Roster;
    var all = rows_('Roster');
    var mine = all.filter(function (r) { return r.classId === classId; });
    // Keep existing Google-account bindings: matched by student number, never set by the client.
    var result = incoming.map(function (r) {
      var prev = mine.filter(function (m) { return String(m.studentNumber).toLowerCase() === r.studentNumber.toLowerCase(); })[0];
      var keepBinding = prev && String(prev.email).toLowerCase() === r.email;
      return { studentNumber: r.studentNumber, name: r.name, email: r.email, classId: classId, status: r.status, googleSub: keepBinding ? String(prev.googleSub) : '', boundAt: keepBinding ? String(prev.boundAt) : '' };
    });
    var others = all.filter(function (r) { return r.classId !== classId; }).map(stripRow_);
    var data = others.concat(result);
    var last = colLetter_(SHEETS.Roster.length);
    api_('post', SHEETS_API + '/' + storage_().sheetId + '/values/' + encodeURIComponent('Roster!A2:' + last) + ':clear', {});
    if (data.length) sheetsPut_('Roster!A2:' + last + (data.length + 1), data.map(function (o) { return rowValues_('Roster', o); }));
    delete memo_.rows.Roster;
    return result.map(function (r) { return { studentNumber: r.studentNumber, name: r.name, email: r.email, classId: classId, status: r.status, googleSub: r.googleSub ? 'bound' : '', boundAt: r.boundAt }; });
  });
}

function createAssignment_(req) {
  var cls = classRow_(String(req.classId || ''));
  var activity;
  try {
    activity = ILP.parseActivity(req.activity);
  } catch (err) {
    fail_('bad-request', 'The activity could not be read: ' + err.message);
  }
  var grading = req.grading === 'hidden' ? 'hidden' : 'client';
  if (grading === 'hidden' && !ILP.canHideAnswerKeys(activity).ok) fail_('bad-request', 'This activity contains question types whose answers cannot be hidden.');
  var assets = req.assets || [];
  assets.forEach(function (a) { if (!/^ast_[0-9a-f]{40}$/.test(a.id)) fail_('bad-request', 'Invalid media id.'); });
  return withLock_(function () {
    var id = newId_('asg');
    var folder = driveCreate_(safeName_(activity.title) + ' (' + id + ')', FOLDER_MIME, classFolder_(cls, 'activities'), 'assignment', { assignmentId: id }).id;
    var assetFiles = {};
    assets.forEach(function (a) {
      var mime = String(a.mime || 'application/octet-stream');
      assetFiles[a.id] = { fileId: driveFile_(a.id, mime, folder, 'media', Utilities.newBlob(Utilities.base64Decode(a.base64), mime, a.id), { asset: a.id }).id, mime: mime };
    });
    var assignment = ILP.AssignmentSchema.parse({
      kind: 'ilp.assignment', id: id, classId: cls.classId, title: String(req.title || activity.title), activityId: activity.id,
      version: Number(req.version || 1), contentHash: String(req.contentHash || ''), grading: grading,
      dueAt: req.dueAt || null, allowLate: req.allowLate !== false, maxAttempts: req.maxAttempts || null, showScore: req.showScore !== false, createdAt: new Date().toISOString(),
    });
    var file = driveFile_('assignment.json', 'application/json', folder, 'assignment-file', Utilities.newBlob(JSON.stringify({ assignment: assignment, activity: activity, assetIds: Object.keys(assetFiles), assetFiles: assetFiles }), 'application/json', 'assignment.json'));
    append_('Assignments', { assignmentId: id, classId: cls.classId, title: assignment.title, fileId: file.id, grading: grading, dueAt: assignment.dueAt || '', allowLate: assignment.allowLate, maxAttempts: assignment.maxAttempts || '', showScore: assignment.showScore, closed: false, createdAt: assignment.createdAt });
    return assignment;
  });
}

function updateAssignment_(req) {
  return withLock_(function () {
    var a = rows_('Assignments').filter(function (x) { return x.assignmentId === req.assignmentId; })[0];
    if (!a) fail_('not-found', 'Assignment not found.');
    if (req.closed !== undefined) a.closed = !!req.closed;
    if (req.dueAt !== undefined) {
      if (req.dueAt && (typeof req.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(req.dueAt) || isNaN(Date.parse(req.dueAt)))) fail_('bad-request', 'The due date is not valid.');
      a.dueAt = req.dueAt ? new Date(req.dueAt).toISOString() : '';
    }
    if (req.showScore !== undefined) a.showScore = !!req.showScore;
    update_('Assignments', a._row, a);
    return publicAssignment_(a);
  });
}

function readReport_(req) {
  var s = rows_('Submissions').filter(function (x) { return x.assignmentId === req.assignmentId && x.attemptId === req.attemptId; })[0];
  if (!s) fail_('not-found', 'Submission not found.');
  try {
    return JSON.parse(driveText_(String(s.reportFileId)));
  } catch (err) {
    if (err.notFound) fail_('not-found', 'The report file was moved to the trash or deleted in Drive.');
    throw err;
  }
}

/** Storage location and usage. Lists only this service's own files: under drive.file Google returns nothing else. */
function storageInfo_() {
  var s = storage_();
  var root = driveMeta_(s.rootId);
  var files = driveList_('trashed = false');
  var byKind = {};
  var bytes = 0;
  files.forEach(function (f) {
    var kind = (f.appProperties && f.appProperties.ilp) || 'other';
    var size = Number(f.size || 0);
    byKind[kind] = byKind[kind] || { files: 0, bytes: 0 };
    byKind[kind].files++;
    byKind[kind].bytes += size;
    bytes += size;
  });
  return { version: VERSION, folder: { id: root.id, name: root.name, url: root.webViewLink, trashed: !!root.trashed }, sheetUrl: 'https://docs.google.com/spreadsheets/d/' + s.sheetId + '/edit', files: files.length, bytes: bytes, byKind: byKind, permission: 'drive.file' };
}

/** A backup of the private sheet (classes, roster, assignments, submissions). Files are backed up with Drive's own Download. */
function storageExport_() {
  var out = { kind: 'ilp.serviceBackup', version: VERSION, exportedAt: new Date().toISOString() };
  Object.keys(SHEETS).forEach(function (t) { out[t] = rows_(t).map(stripRow_); });
  return out;
}

/* ---------------------------------------------------------------- student */
function loadAssignment_(assignmentId) {
  var row = rows_('Assignments').filter(function (x) { return x.assignmentId === assignmentId; })[0];
  if (!row) fail_('not-found', 'This assignment does not exist or was removed.');
  var doc;
  try {
    doc = JSON.parse(driveText_(String(row.fileId)));
  } catch (err) {
    if (err.notFound) fail_('not-found', 'This assignment’s file was moved to the trash or deleted in the teacher’s Drive.');
    throw err;
  }
  doc.row = row;
  doc.assignment.closed = String(row.closed) === 'true';
  doc.assignment.dueAt = row.dueAt ? isoOf_(row.dueAt) || null : null;
  doc.assignment.showScore = String(row.showScore) !== 'false';
  doc.activity = ILP.parseActivity(doc.activity);
  doc.assetFiles = doc.assetFiles || {};
  return doc;
}

/** Resolve the caller to a roster student of the assignment's class, binding the Google account on first use. */
function studentFor_(who, classId) {
  return withLock_(function () {
    if (memo_.rows) delete memo_.rows.Roster;
    var roster = rows_('Roster');
    var mine = roster.filter(function (r) { return r.classId === classId; }).map(function (r) {
      return { studentNumber: String(r.studentNumber), name: String(r.name), email: String(r.email).toLowerCase(), classId: r.classId, status: r.status || 'active', googleSub: String(r.googleSub || ''), boundAt: String(r.boundAt || ''), _row: r._row };
    });
    var res = ILP.bindStudent(mine, classId, who.sub, who.email, new Date().toISOString());
    if (!res.ok) {
      var msg = { 'not-enrolled': 'Your Google account is not on this class roster. Ask your teacher to add ' + who.email + '.', withdrawn: 'You are no longer enrolled in this class.', 'bound-to-other-account': 'This student number is already linked to a different Google account. Ask your teacher.' }[res.reason];
      fail_('forbidden', msg);
    }
    if (res.newlyBound) {
      var src = mine.filter(function (m) { return m.studentNumber === res.row.studentNumber; })[0];
      update_('Roster', src._row, res.row);
    }
    return res.row;
  });
}

function studentAssignment_(who, req) {
  var doc = loadAssignment_(String(req.assignmentId || ''));
  var student = who.isTeacher ? { studentNumber: 'TEACHER-PREVIEW' } : studentFor_(who, doc.assignment.classId);
  var activity = doc.assignment.grading === 'hidden' ? ILP.redactAnswerKeys(doc.activity) : doc.activity;
  var mine = rows_('Submissions').filter(function (s) { return s.assignmentId === doc.assignment.id && String(s.studentNumber) === String(student.studentNumber); });
  return { assignment: doc.assignment, activity: activity, assetIds: doc.assetIds, studentNumber: student.studentNumber, submissions: mine.length };
}

function studentAsset_(who, req) {
  var doc = loadAssignment_(String(req.assignmentId || ''));
  if (!who.isTeacher) studentFor_(who, doc.assignment.classId);
  var entry = Object.prototype.hasOwnProperty.call(doc.assetFiles, req.assetId) ? doc.assetFiles[req.assetId] : null;
  if (!entry || doc.assetIds.indexOf(req.assetId) < 0) fail_('not-found', 'Media not found.');
  var bytes;
  try {
    bytes = driveBytes_(String(entry.fileId));
  } catch (err) {
    if (err.notFound) fail_('not-found', 'Media not found.');
    throw err;
  }
  return { id: req.assetId, mime: entry.mime, base64: Utilities.base64Encode(bytes) };
}

function signReceipt_(r) {
  var fields = ILP.ReceiptFields.map(function (k) { return k + '=' + (r[k] === null || r[k] === undefined ? '' : r[k]); }).join('&');
  var sig = Utilities.computeHmacSha256Signature(fields, props_().getProperty('HMAC_SECRET'));
  return hex_(sig);
}

function studentSubmit_(who, req) {
  var parsed = ILP.SubmissionPayloadSchema.safeParse(req.payload);
  if (!parsed.success) fail_('bad-request', 'The submission is incomplete or damaged.');
  var p = parsed.data;
  if (JSON.stringify(p.responses).length > ILP.MAX_RESPONSES_CHARS) fail_('bad-request', 'The answers are too large to submit.');
  var doc = loadAssignment_(p.assignmentId);
  var a = doc.assignment;
  if (who.isTeacher) fail_('forbidden', 'Teachers cannot submit as students. Use a student test account.');
  var student = studentFor_(who, a.classId);
  return withLock_(function () {
    if (memo_.rows) delete memo_.rows.Submissions;
    var subs = rows_('Submissions').filter(function (s) { return s.assignmentId === a.id && String(s.studentNumber) === String(student.studentNumber); });
    var existing = subs.filter(function (s) { return s.attemptId === p.attemptId; })[0];
    var showScore = a.showScore;
    if (existing) {
      return {
        receiptId: existing.receiptId, assignmentId: a.id, attemptId: p.attemptId, studentNumber: String(student.studentNumber), receivedAt: String(existing.receivedAt),
        late: String(existing.late) === 'true', duplicate: true, score: showScore ? Number(existing.score) : null, maxScore: showScore ? Number(existing.maxScore) : null,
        needsReview: Number(existing.needsReview), signature: existing.signature,
      };
    }
    if (a.closed) fail_('closed', 'This assignment is closed.');
    var now = new Date();
    var due = a.dueAt ? timeOf_(a.dueAt) : null;
    var late = due !== null && now.getTime() > due;
    if (late && !a.allowLate) fail_('past-due', 'The due date has passed and late work is not accepted.');
    var used = {};
    subs.forEach(function (s) { used[s.attemptId] = true; });
    if (a.maxAttempts && Object.keys(used).length >= a.maxAttempts) fail_('attempt-limit', 'You have used all ' + a.maxAttempts + ' attempts.');
    // Question selection is re-derived from the attempt id, so a client cannot choose easier questions.
    var presented = ILP.selectItemIds(doc.activity, p.attemptId);
    // Recordings are checked by their bytes, before anything is written.
    var decoded = p.recordings.map(function (r) { return Utilities.base64Decode(r.base64); });
    var recCheck = ILP.checkRecordings(doc.activity, presented, p.recordings.map(function (r, i) {
      return { itemId: r.itemId, targetId: r.targetId, size: decoded[i].length, head: new Uint8Array(decoded[i].slice(0, 16).map(function (x) { return x & 0xff; })) };
    }));
    if (!recCheck.ok) fail_('bad-request', recCheck.problem);
    var attempt = {
      kind: 'ilp.attempt', schemaVersion: 1, id: p.attemptId, activityId: doc.activity.id, version: a.version, contentHash: a.contentHash, mode: 'student', assignmentId: a.id,
      attemptNumber: Object.keys(used).length + 1, status: 'submitted', presentedItemIds: presented, responses: p.responses, checks: p.checks, hintsUsed: p.hintsUsed, mediaPlays: {},
      startedAt: p.startedAt, updatedAt: p.submittedAt, submittedAt: now.toISOString(), sync: 'synced',
    };
    var report = ILP.buildReport(doc.activity, attempt, { revealAnswers: true, studentNumber: String(student.studentNumber), classId: a.classId, now: now });
    report.integrity = { generatedBy: 'broker', verified: true, note: 'Re-graded by the teacher’s submission service from the raw responses. Received ' + now.toISOString() + (late ? ' (late)' : '') + '.' };
    var cls = classRow_(a.classId);
    var folderName = safeName_(a.title) + ' (' + a.id + ')';
    var reportFolder = childFolder_(classFolder_(cls, 'submissions'), folderName, 'assignment-submissions');
    var file = driveFile_(safeName_(student.studentNumber) + '__' + p.attemptId + '.json', 'application/json', reportFolder, 'submission', Utilities.newBlob(JSON.stringify({ report: report, payload: { responses: p.responses, presentedItemIds: presented, clientScore: p.clientScore } }, null, 2), 'application/json', 'report.json'), { assignmentId: a.id });
    if (p.recordings.length) {
      var recFolder = childFolder_(classFolder_(cls, 'recordings'), folderName, 'assignment-recordings');
      p.recordings.forEach(function (r, i) {
        var mime = recCheck.mimes[i];
        driveFile_(safeName_(student.studentNumber) + '__' + p.attemptId + '__' + r.itemId + '__' + safeName_(r.targetId) + '.' + ILP.EXTENSIONS[mime], mime, recFolder, 'recording', Utilities.newBlob(decoded[i], mime, 'recording'), { assignmentId: a.id });
      });
    }
    var receipt = {
      receiptId: newId_('rct'), assignmentId: a.id, attemptId: p.attemptId, studentNumber: String(student.studentNumber), receivedAt: now.toISOString(), late: late, duplicate: false,
      score: report.totals.score, maxScore: report.totals.maxScore, needsReview: report.totals.needsReview,
    };
    receipt.signature = signReceipt_(receipt);
    append_('Submissions', {
      receivedAt: receipt.receivedAt, assignmentId: a.id, classId: a.classId, studentNumber: receipt.studentNumber, attemptId: p.attemptId, attemptNumber: attempt.attemptNumber,
      score: receipt.score, maxScore: receipt.maxScore, needsReview: receipt.needsReview, late: late, reportFileId: file.id, clientScore: p.clientScore === null ? '' : p.clientScore,
      scoreMismatch: p.clientScore !== null && Math.abs(p.clientScore - receipt.score) > 0.001, receiptId: receipt.receiptId, signature: receipt.signature,
    });
    if (!showScore) { receipt.score = null; receipt.maxScore = null; }
    return receipt;
  });
}

function studentReceipts_(who, req) {
  var doc = loadAssignment_(String(req.assignmentId || ''));
  var student = studentFor_(who, doc.assignment.classId);
  return rows_('Submissions').filter(function (s) { return s.assignmentId === doc.assignment.id && String(s.studentNumber) === String(student.studentNumber); }).map(function (s) {
    return { receiptId: s.receiptId, attemptId: s.attemptId, receivedAt: String(s.receivedAt), late: String(s.late) === 'true' };
  });
}

/* ------------------------------------------------------- editor functions */
/**
 * Run once from the Apps Script editor (select "setup" → Run). Creates the
 * storage folder "Interactive Learning Platform" with a private sheet, and
 * prints the one-time connection code to paste into the app.
 */
function setup() {
  var CLIENT_ID = '__CLIENT_ID__';
  var ALLOWED_DOMAIN = ''; // e.g. 'myschool.kr' to accept only school accounts
  memo_ = {};
  props_().setProperty('CLIENT_ID', CLIENT_ID);
  if (ALLOWED_DOMAIN) props_().setProperty('ALLOWED_DOMAIN', ALLOWED_DOMAIN);
  if (!props_().getProperty('HMAC_SECRET')) props_().setProperty('HMAC_SECRET', Utilities.getUuid() + Utilities.getUuid());
  var s = ensureStorage_();
  Logger.log('Storage folder: ' + s.root.name + ' — ' + s.root.webViewLink + ' (you may move it anywhere in your Drive).');
  if (props_().getProperty('BROKER_ID')) Logger.log('Already connected to the app. To connect again (new deployment), run resetConnection.');
  else Logger.log('Connection code (paste it into the app when you press Connect): ' + newConnectionCode_());
}

/**
 * Run from the editor if you moved the service to a NEW deployment (a new
 * web-app URL), or to hand it to another teacher account. Prints a new
 * connection code; until it is used the service accepts nobody.
 */
function resetConnection() {
  ['BROKER_ID', 'OWNER_EMAIL', 'TEACHER_SUBS'].forEach(function (k) { props_().deleteProperty(k); });
  Logger.log('Connection reset. New connection code: ' + newConnectionCode_());
}

/**
 * Optional live check of what this script can do in your Drive (run from the
 * editor after setup). To also confirm that it CANNOT see your other files,
 * paste the link of any file of yours into PROBE_FILE_LINK first.
 */
function checkPermissions() {
  var PROBE_FILE_LINK = '';
  memo_ = {};
  var s = storage_();
  var log = function (ok, what) { Logger.log((ok ? 'OK    ' : 'FAIL  ') + what); };
  var f = driveFile_('permission-check.txt', 'text/plain', s.rootId, 'selftest', Utilities.newBlob('created ' + new Date().toISOString(), 'text/plain', 'x'));
  log(true, 'create a file in the storage folder');
  log(driveText_(f.id).indexOf('created') === 0, 'read it back');
  api_('patch', UPLOAD + '/files/' + f.id + '?uploadType=media', undefined, { blob: Utilities.newBlob('updated', 'text/plain', 'x'), contentType: 'text/plain' });
  log(driveText_(f.id) === 'updated', 'update it');
  log(driveList_(q_(s.rootId) + ' in parents and trashed = false').some(function (x) { return x.id === f.id; }), 'list the storage folder');
  api_('patch', DRIVE + '/files/' + f.id, { trashed: true });
  api_('delete', DRIVE + '/files/' + f.id, undefined, { raw: true });
  log(true, 'delete it');
  var probe = /[-\w]{25,}/.exec(PROBE_FILE_LINK);
  if (probe) {
    try {
      driveMeta_(probe[0]);
      log(false, 'the script CAN see the file you pasted — it should not (check the scopes in appsscript.json)');
    } catch (err) {
      log(!!err.notFound, err.notFound ? 'the script cannot see the file you pasted (as intended)' : 'unexpected error: ' + err);
    }
  } else Logger.log('(Paste a link into PROBE_FILE_LINK to also check that other files are invisible to the script.)');
}
