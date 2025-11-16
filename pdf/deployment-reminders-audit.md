# Deployment Plan — Reminders Audit

## Sequence
1. Database migrations
   - Ensure DB connection env set for server.
   - Run migrations:
     - 008_create_reminders_audit_v2.sql
     - 009_create_reminder_email_selected_audit.sql
   - Verify tables and indexes created.
2. Server deploy/restart
   - Deploy server with FEATURE_REMINDERS_AUDIT=true (default) or set in environment.
   - Health-check key endpoints:
     - GET /api/reminders-audit-v2
     - GET /api/reminders-email-selected-audit
     - Existing reminders list still works and includes emails_sent_attempts when available.
3. Client deploy
   - Build and deploy client.
   - Validate Reminders UI shows "Sent: N" for EMAIL reminders where applicable.
   - Validate History tabs: Reminders Audit (v2) and Reminders Email Selected.

## Rollback
- Immediate: set FEATURE_REMINDERS_AUDIT=false on server env and restart to hide new features.
- Optional cleanup: export audit data, then drop tables if required by policy.

## Notes
- All endpoints enforce EMPLOYEE visibility mirroring Meetings scoping.
- Email Selected audit writes occur within POST /api/email/send; existing flows are preserved.
