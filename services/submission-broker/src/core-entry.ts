// Entry for the Apps Script bundle: exposes the same grading engine the app uses.
export {
  AssignmentSchema, SubmissionPayloadSchema, RosterRowSchema, ReceiptFields, bindStudent, rosterProblems, redactAnswerKeys, canHideAnswerKeys,
  parseActivity, gradeActivity, buildReport, selectItemIds, canonicalJson, CURRENT_SCHEMA_VERSION,
} from '@ilp/core';
