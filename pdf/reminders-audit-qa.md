# Reminders Audit (v2) — QA Checklist

This checklist validates lifecycle audits (CREATE/UPDATE/STATUS) and Email Selected auditing for reminders.

## Prerequisites
- Database migrated with new tables:
  - `reminders_audit_v2`
  - `reminder_email_selected_audit`
- Server running with FEATURE_REMINDERS_AUDIT=true (default).
- Test users: OWNER/ADMIN and EMPLOYEE.

## Lifecycle Audits (CALL/EMAIL)
1. Create a CALL reminder as OWNER. Verify:
   - GET /api/reminders/:id/audit-v2 includes action=CREATE version=1 with snapshot.
2. Update fields (title, due_ts, assignee). Verify:
   - New row action=UPDATE version increments. Diff shows changed keys with from/to.
3. Change status to DONE (CALL) or SENT (EMAIL). Verify:
   - New row action=STATUS with diff.status from PENDING → DONE/SENT.
4. EMPLOYEE scoping:
   - As EMPLOYEE not linked to reminder, GET /api/reminders/:id/audit-v2 returns 403.
   - When assigned to EMPLOYEE or created by them, audits are visible.

## Email Selected Auditing (EMAIL reminders)
1. Select multiple EMAIL reminders in Reminders UI and click "Email selected".
2. On success:
   - POST /api/email/send returns ok.
   - One row per reminder in `reminder_email_selected_audit` with same operation_id and status=SENT; sent_count > 0.
3. On failure (simulate SMTP error or invalid recipient):
   - One row per reminder with status=FAILED; error populated.
4. Global views:
   - GET /api/reminders-email-selected-audit lists recent attempts; filter by operationId/reminderId/status.
5. Aggregation:
   - GET /api/reminders returns emails_sent_attempts for EMAIL reminders; Reminders UI shows "Sent: N" badge when N>0.

## Permissions
- OWNER/ADMIN can view all audit tables.
- EMPLOYEE sees audits only for reminders they created/are assigned to, or via linked meetings.

## Performance
- Verify list endpoints respond within ~300ms for pages of 50 rows.
- Check indexes:
  - reminders_audit_v2 (reminder_id, version), performed_at
  - reminder_email_selected_audit (reminder_id, performed_at), operation_id, partial on (status='SENT')

## Rollback
- Disable FEATURE_REMINDERS_AUDIT to hide endpoints and UI.
- Keep tables for forensic data or drop if needed after export.
