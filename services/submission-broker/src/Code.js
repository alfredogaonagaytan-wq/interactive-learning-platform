/**
 * Interactive Learning Platform — submission broker (Google Apps Script web app).
 *
 * Runs inside ONE teacher's own Google account ("Execute as: Me"). It:
 *  - verifies each caller's Google ID token (audience = the app's OAuth client)
 *  - recognises the teacher (script owner / TEACHERS property) and roster students
 *  - stores classes, the private roster, assignments and submissions in the
 *    teacher's Drive (a folder tree + one spreadsheet) — no other server
 *  - re-grades submissions with the same engine the app uses, writes a
 *    teacher-owned report, and returns an HMAC-signed receipt
 * Nothing is sent anywhere except Google's token-verification endpoint.
 *
 * Security model (see docs/14-security-audit.md):
 *  - every request needs a Google ID token for the app's OAuth client whose
 *    nonce names THIS service; the service records its own id when the teacher
 *    first connects, so tokens captured by any other service are useless here
 *  - the teacher is the script owner, pinned to their Google account id
 *  - students are identified only through the private roster, never by
 *    anything they send; Drive file ids never come from requests
 *  - all text written to the sheet is stored as plain text (no formulas)
 */
var VERSION = '0.5.1';
var CORE_BUILD = '__CORE_BUILD__'; // filled in by build.mjs
var ROOT_NAME = 'Interactive Learning Platform';
var SHEETS = {
  Classes: ['classId', 'name', 'section', 'folderId', 'createdAt'],
  Roster: ['studentNumber', 'name', 'email', 'classId', 'status', 'googleSub', 'boundAt'],
  Assignments: ['assignmentId', 'classId', 'title', 'fileId', 'grading', 'dueAt', 'allowLate', 'maxAttempts', 'showScore', 'closed', 'createdAt'],
  Submissions: ['receivedAt', 'assignmentId', 'classId', 'studentNumber', 'attemptId', 'attemptNumber', 'score', 'maxScore', 'needsReview', 'late', 'reportFileId', 'clientScore', 'scoreMismatch', 'receiptId', 'signature'],
};

/* ------------------------------------------------------------------ entry */
function doGet() {
  return json_({ ok: true, service: 'ilp-submission-broker', version: VERSION });
}

function doPost(e) {
  var req;
  var body = (e && e.postData && e.postData.contents) || '{}';
  if (body.length > ILP.MAX_SUBMISSION_CHARS) return json_({ ok: false, error: 'bad-request', message: 'The request is too large.' });
  try {
    req = JSON.parse(body);
  } catch (err) {
    return json_({ ok: false, error: 'bad-request', message: 'Request is not valid JSON.' });
  }
  try {
    var who = verifyCaller_(req.idToken);
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

function verifyCaller_(idToken) {
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
  var isTeacher = teacherEmails_().indexOf(email) >= 0 && teacherSubOk_(email, sub);
  // The token must have been requested for THIS service (see brokerNonce in the app).
  var tokenBroker = ILP.brokerIdFromNonce(info.nonce);
  if (!tokenBroker) fail_('unauthenticated', 'This sign-in was not made for this submission service. Sign in again.');
  var bound = props_().getProperty('BROKER_ID');
  if (!bound) {
    if (!isTeacher) fail_('not-connected', 'Your teacher has not finished connecting this submission service yet.');
    withLock_(function () {
      if (!props_().getProperty('BROKER_ID')) props_().setProperty('BROKER_ID', tokenBroker);
    });
    bound = props_().getProperty('BROKER_ID');
  }
  if (tokenBroker !== bound) fail_('unauthenticated', 'This sign-in was made for a different submission service. Sign in again.');
  return { sub: sub, email: email, isTeacher: isTeacher };
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
  var owner = String(props_().getProperty('OWNER_EMAIL') || Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var extra = (props_().getProperty('TEACHERS') || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(String);
  return [owner].concat(extra).filter(String);
}

function requireTeacher_(who) {
  if (!who.isTeacher) fail_('forbidden', 'Only the teacher can do this.');
}

/* ---------------------------------------------------------------- storage */
function setupStorage_() {
  var p = props_();
  var rootId = p.getProperty('ROOT_FOLDER_ID');
  var root = rootId ? DriveApp.getFolderById(rootId) : null;
  if (!root) {
    root = DriveApp.createFolder(ROOT_NAME);
    p.setProperty('ROOT_FOLDER_ID', root.getId());
  }
  var sheetId = p.getProperty('SHEET_ID');
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : null;
  if (!ss) {
    ss = SpreadsheetApp.create('ILP – Private roster and submissions (do not share)');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    p.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(SHEETS[name].map(cell_));
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  if (!p.getProperty('HMAC_SECRET')) p.setProperty('HMAC_SECRET', Utilities.getUuid() + Utilities.getUuid());
  return { root: root, ss: ss };
}

function sheet_(name) {
  return setupStorage_().ss.getSheetByName(name);
}

/**
 * Sheets interprets written text like typed input: "=…" becomes a formula
 * (which could send data to another site when the teacher opens the sheet),
 * "007" becomes 7 and dates become date values. A leading apostrophe stores
 * text exactly as given; it is not part of the value read back.
 */
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') v = v.toISOString();
  if (typeof v === 'string') return v === '' ? '' : "'" + v;
  return v;
}

/** Values read back: dates (from rows written before 0.5.1, or edited by hand) as ISO text. */
function value_(v) {
  if (v === undefined || v === null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : v.toISOString();
  return v;
}

function rowValues_(name, obj) {
  return SHEETS[name].map(function (h) { return cell_(obj[h]); });
}

function rows_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var head = values[0];
  return values.slice(1).map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, k) { o[h] = value_(r[k]); });
    return o;
  });
}

function append_(name, obj) {
  sheet_(name).appendRow(rowValues_(name, obj));
}

function update_(name, rowNumber, obj) {
  sheet_(name).getRange(rowNumber, 1, 1, SHEETS[name].length).setValues([rowValues_(name, obj)]);
}

function timeOf_(v) {
  var t = Date.parse(String(value_(v)));
  return isNaN(t) ? null : t;
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
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
function publicClass_(c) { return { classId: c.classId, name: c.name, section: c.section, createdAt: String(c.createdAt) }; }
function publicAssignment_(a) {
  return { assignmentId: a.assignmentId, classId: a.classId, title: a.title, grading: a.grading, dueAt: a.dueAt ? String(a.dueAt) : null, allowLate: a.allowLate === true || a.allowLate === 'TRUE' || a.allowLate === 'true', maxAttempts: a.maxAttempts === '' ? null : Number(a.maxAttempts), showScore: String(a.showScore) !== 'false', closed: String(a.closed) === 'true', createdAt: String(a.createdAt) };
}

/* ---------------------------------------------------------------- teacher */
function whoami_(who) {
  if (who.isTeacher) {
    setupStorage_();
    return { role: 'teacher', email: who.email, version: VERSION, coreOk: typeof ILP_CORE_BUILD !== 'undefined' && ILP_CORE_BUILD === CORE_BUILD };
  }
  return { role: 'student', email: who.email, version: VERSION };
}

function createClass_(req) {
  var name = String(req.name || '').trim();
  if (!name) fail_('bad-request', 'Give the class a name.');
  return withLock_(function () {
    var s = setupStorage_();
    var id = newId_('cls');
    var classes = childFolder_(s.root, 'Classes');
    var folder = classes.createFolder(safeName_(name + (req.section ? ' ' + req.section : '')) + ' (' + id + ')');
    ['Published Activities', 'Assignments', 'Student Reports', 'Recordings', 'Class Analytics'].forEach(function (n) { folder.createFolder(n); });
    var row = { classId: id, name: name, section: String(req.section || ''), folderId: folder.getId(), createdAt: new Date().toISOString() };
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
    var all = rows_('Roster');
    var mine = all.filter(function (r) { return r.classId === classId; });
    // Keep existing Google-account bindings: matched by student number, never set by the client.
    var result = incoming.map(function (r) {
      var prev = mine.filter(function (m) { return String(m.studentNumber).toLowerCase() === r.studentNumber.toLowerCase(); })[0];
      var keepBinding = prev && String(prev.email).toLowerCase() === r.email;
      return { studentNumber: r.studentNumber, name: r.name, email: r.email, classId: classId, status: r.status, googleSub: keepBinding ? String(prev.googleSub) : '', boundAt: keepBinding ? String(prev.boundAt) : '' };
    });
    var sh = sheet_('Roster');
    var others = all.filter(function (r) { return r.classId !== classId; }).map(stripRow_);
    var data = others.concat(result);
    sh.clearContents();
    sh.appendRow(SHEETS.Roster.map(cell_));
    if (data.length) sh.getRange(2, 1, data.length, SHEETS.Roster.length).setValues(data.map(function (o) { return rowValues_('Roster', o); }));
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
  return withLock_(function () {
    var id = newId_('asg');
    var folder = childFolder_(childFolder_(DriveApp.getFolderById(cls.folderId), 'Assignments'), safeName_(activity.title) + ' (' + id + ')');
    var media = folder.createFolder('media');
    var assetIds = [];
    assets.forEach(function (a) {
      if (!/^ast_[0-9a-f]{40}$/.test(a.id)) fail_('bad-request', 'Invalid media id.');
      media.createFile(Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, a.id));
      assetIds.push(a.id);
    });
    var assignment = ILP.AssignmentSchema.parse({
      kind: 'ilp.assignment', id: id, classId: cls.classId, title: String(req.title || activity.title), activityId: activity.id,
      version: Number(req.version || 1), contentHash: String(req.contentHash || ''), grading: grading,
      dueAt: req.dueAt || null, allowLate: req.allowLate !== false, maxAttempts: req.maxAttempts || null, showScore: req.showScore !== false, createdAt: new Date().toISOString(),
    });
    var file = folder.createFile(Utilities.newBlob(JSON.stringify({ assignment: assignment, activity: activity, assetIds: assetIds }), 'application/json', 'assignment.json'));
    append_('Assignments', { assignmentId: id, classId: cls.classId, title: assignment.title, fileId: file.getId(), grading: grading, dueAt: assignment.dueAt || '', allowLate: assignment.allowLate, maxAttempts: assignment.maxAttempts || '', showScore: assignment.showScore, closed: false, createdAt: assignment.createdAt });
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
  var file;
  try {
    file = DriveApp.getFileById(String(s.reportFileId));
  } catch (err) {
    fail_('not-found', 'The report file was moved or deleted in Drive.');
  }
  return JSON.parse(file.getBlob().getDataAsString());
}

/* ---------------------------------------------------------------- student */
function loadAssignment_(assignmentId) {
  var row = rows_('Assignments').filter(function (x) { return x.assignmentId === assignmentId; })[0];
  if (!row) fail_('not-found', 'This assignment does not exist or was removed.');
  var doc;
  try {
    doc = JSON.parse(DriveApp.getFileById(String(row.fileId)).getBlob().getDataAsString());
  } catch (err) {
    fail_('not-found', 'This assignment’s file was moved or deleted in the teacher’s Drive.');
  }
  doc.row = row;
  doc.assignment.closed = String(row.closed) === 'true';
  doc.assignment.dueAt = row.dueAt ? String(row.dueAt) : null; // value_ already turned date values into ISO text
  doc.assignment.showScore = String(row.showScore) !== 'false';
  doc.activity = ILP.parseActivity(doc.activity);
  return doc;
}

/** Resolve the caller to a roster student of the assignment's class, binding the Google account on first use. */
function studentFor_(who, classId) {
  return withLock_(function () {
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
  if (doc.assetIds.indexOf(req.assetId) < 0) fail_('not-found', 'Media not found.');
  var folder = DriveApp.getFileById(doc.row.fileId).getParents().next().getFoldersByName('media').next();
  var it = folder.getFilesByName(req.assetId);
  if (!it.hasNext()) fail_('not-found', 'Media not found.');
  var blob = it.next().getBlob();
  return { id: req.assetId, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function signReceipt_(r) {
  var fields = ILP.ReceiptFields.map(function (k) { return k + '=' + (r[k] === null || r[k] === undefined ? '' : r[k]); }).join('&');
  var sig = Utilities.computeHmacSha256Signature(fields, props_().getProperty('HMAC_SECRET'));
  return sig.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
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
    var classFolder = DriveApp.getFolderById(cls.folderId);
    var reportFolder = childFolder_(childFolder_(classFolder, 'Student Reports'), safeName_(a.title) + ' (' + a.id + ')');
    var file = reportFolder.createFile(Utilities.newBlob(JSON.stringify({ report: report, payload: { responses: p.responses, presentedItemIds: presented, clientScore: p.clientScore } }, null, 2), 'application/json', safeName_(student.studentNumber) + '__' + p.attemptId + '.json'));
    if (p.recordings.length) {
      var recFolder = childFolder_(childFolder_(classFolder, 'Recordings'), safeName_(a.title) + ' (' + a.id + ')');
      p.recordings.forEach(function (r, i) {
        var mime = recCheck.mimes[i];
        recFolder.createFile(Utilities.newBlob(decoded[i], mime, safeName_(student.studentNumber) + '__' + p.attemptId + '__' + r.itemId + '__' + safeName_(r.targetId) + '.' + ILP.EXTENSIONS[mime]));
      });
    }
    var receipt = {
      receiptId: newId_('rct'), assignmentId: a.id, attemptId: p.attemptId, studentNumber: String(student.studentNumber), receivedAt: now.toISOString(), late: late, duplicate: false,
      score: report.totals.score, maxScore: report.totals.maxScore, needsReview: report.totals.needsReview,
    };
    receipt.signature = signReceipt_(receipt);
    append_('Submissions', {
      receivedAt: receipt.receivedAt, assignmentId: a.id, classId: a.classId, studentNumber: receipt.studentNumber, attemptId: p.attemptId, attemptNumber: attempt.attemptNumber,
      score: receipt.score, maxScore: receipt.maxScore, needsReview: receipt.needsReview, late: late, reportFileId: file.getId(), clientScore: p.clientScore === null ? '' : p.clientScore,
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

/* ------------------------------------------------------------------ setup */
/**
 * Run once from the Apps Script editor (select "setup" → Run) after pasting
 * the app's OAuth client id below. Creates the Drive folder and private sheet.
 */
function setup() {
  var CLIENT_ID = '__CLIENT_ID__';
  var ALLOWED_DOMAIN = ''; // e.g. 'myschool.kr' to accept only school accounts
  props_().setProperty('CLIENT_ID', CLIENT_ID);
  props_().setProperty('OWNER_EMAIL', String(Session.getEffectiveUser().getEmail() || '').toLowerCase());
  if (ALLOWED_DOMAIN) props_().setProperty('ALLOWED_DOMAIN', ALLOWED_DOMAIN);
  var s = setupStorage_();
  Logger.log('Ready. Folder: ' + s.root.getUrl() + ' · Sheet: ' + s.ss.getUrl());
}

/**
 * Run from the editor only if you moved the service to a NEW deployment (a new
 * web-app URL). Afterwards press Connect in the app again; until then the
 * service accepts nobody.
 */
function resetConnection() {
  props_().deleteProperty('BROKER_ID');
  Logger.log('Connection reset. Open the app → Classes → Submission service, paste the new URL and press Connect.');
}
