'use strict';

// Production-safe system definitions only. No factories, people, phones,
// credentials, assignments, shifts, chats or other operational/demo data.
const catalog = {
  "version": 1,
  "permissions": [
    [
      "admin.read",
      "Read admin/config inventory"
    ],
    [
      "config.read",
      "Read configuration inventory"
    ],
    [
      "admin.overview.read",
      "Read admin overview"
    ],
    [
      "admin.users.read",
      "Read admin users"
    ],
    [
      "admin.users.manage",
      "Manage admin users and access"
    ],
    [
      "admin.roles.read",
      "Read roles and permissions"
    ],
    [
      "admin.roles.manage",
      "Manage role permissions"
    ],
    [
      "admin.factories.read",
      "Read factories config"
    ],
    [
      "admin.factories.manage",
      "Manage factories config"
    ],
    [
      "admin.departments.read",
      "Read departments config"
    ],
    [
      "admin.departments.manage",
      "Manage departments config"
    ],
    [
      "admin.lines.read",
      "Read lines config"
    ],
    [
      "admin.lines.manage",
      "Manage lines config"
    ],
    [
      "factory.read",
      "View selected factory data"
    ],
    [
      "factory.manage",
      "Manage factories and factory access"
    ],
    [
      "users.manage",
      "Manage users, roles, departments and access"
    ],
    [
      "users.password.reset",
      "Reset user passwords"
    ],
    [
      "lines.read",
      "View lines"
    ],
    [
      "lines.manage",
      "Manage line statuses, positions and staffing templates"
    ],
    [
      "assignments.manage",
      "Assign and unassign employees"
    ],
    [
      "tasks.read",
      "View tasks"
    ],
    [
      "tasks.create",
      "Create tasks"
    ],
    [
      "tasks.take",
      "Take tasks into work"
    ],
    [
      "tasks.done",
      "Complete tasks"
    ],
    [
      "tasks.redirect",
      "Redirect tasks"
    ],
    [
      "tasks.comment",
      "Comment tasks"
    ],
    [
      "tasks.read-receipts.read",
      "Read task receipts"
    ],
    [
      "tasks.escalation.manage",
      "Manage task escalation"
    ],
    [
      "tasks.manage",
      "Create and manage tasks"
    ],
    [
      "tasks.settings.read",
      "Read task settings"
    ],
    [
      "tasks.settings.manage",
      "Manage task settings"
    ],
    [
      "wash.read",
      "View wash sessions"
    ],
    [
      "wash.manage",
      "Start and complete wash sessions"
    ],
    [
      "wash.message.create",
      "Create wash messages"
    ],
    [
      "wash.issue.create",
      "Create wash issues"
    ],
    [
      "wash.issue.resolve",
      "Resolve wash issues"
    ],
    [
      "wash.control.create",
      "Create wash control items and mini tasks"
    ],
    [
      "wash.control.manage",
      "Manage wash control items and mini tasks"
    ],
    [
      "wash.okk-review.read",
      "Read wash OKK reviews"
    ],
    [
      "wash.okk-review.manage",
      "Create wash OKK reviews"
    ],
    [
      "wash.settings.read",
      "Read wash settings"
    ],
    [
      "wash.settings.manage",
      "Manage wash settings"
    ],
    [
      "okk.read",
      "View OKK records"
    ],
    [
      "okk.manage",
      "Create and manage OKK records"
    ],
    [
      "stock.read",
      "View stock defects"
    ],
    [
      "stock.manage",
      "Create and manage stock defects"
    ],
    [
      "returns.read",
      "View returns"
    ],
    [
      "returns.publication.read",
      "Просмотр публикаций возвратов без права управления"
    ],
    [
      "returns.manage",
      "Create and manage returns"
    ],
    [
      "orders.read",
      "View orders/minimum stock"
    ],
    [
      "orders.take",
      "Take minimum stock items into work"
    ],
    [
      "orders.request",
      "Create replenishment order requests"
    ],
    [
      "orders.restock",
      "Restock minimum stock items"
    ],
    [
      "orders.items.manage",
      "Create and manage minimum stock items"
    ],
    [
      "orders.requests.manage",
      "Close order requests"
    ],
    [
      "orders.archive.read",
      "View orders/minimum stock archive"
    ],
    [
      "orders.settings.read",
      "Read orders/minimum stock settings"
    ],
    [
      "orders.settings.manage",
      "Manage orders/minimum stock settings"
    ],
    [
      "checklists.templates.read",
      "Read checklist templates"
    ],
    [
      "checklists.templates.manage",
      "Manage checklist templates"
    ],
    [
      "checklists.runs.read",
      "Read checklist runs"
    ],
    [
      "checklists.runs.manage",
      "Manage checklist runs"
    ],
    [
      "checklists.runs.self",
      "Start and fill own checklist runs"
    ],
    [
      "checklists.archive.read",
      "Read checklist archive"
    ],
    [
      "checklists.settings.read",
      "Read checklist settings"
    ],
    [
      "checklists.settings.manage",
      "Manage checklist settings"
    ],
    [
      "shift-log.read",
      "View shift log"
    ],
    [
      "shift-log.create",
      "Create shift log entries"
    ],
    [
      "shift-log.comment",
      "Comment shift log entries"
    ],
    [
      "shift-log.manage",
      "Create and manage shift log records"
    ],
    [
      "shift-log.important.manage",
      "Manage important shift log notices"
    ],
    [
      "shift-log.archive.read",
      "Read shift log archive"
    ],
    [
      "shift-log.reads.read",
      "Read shift log acknowledgements"
    ],
    [
      "defrost.read",
      "Read defrost events"
    ],
    [
      "defrost.manage",
      "Start and complete defrost events"
    ],
    [
      "defrost.calendar.read",
      "Read defrost calendar"
    ],
    [
      "defrost.settings.read",
      "Read defrost settings"
    ],
    [
      "defrost.settings.manage",
      "Manage defrost settings"
    ],
    [
      "chats.read",
      "Read visible chats"
    ],
    [
      "chats.write",
      "Write messages in visible chats"
    ],
    [
      "chats.manage",
      "Create and manage scoped chats"
    ],
    [
      "chats.archive.read",
      "Read chat archive"
    ],
    [
      "chats.settings.read",
      "Read chat settings"
    ],
    [
      "chats.settings.manage",
      "Manage chat settings"
    ],
    [
      "notifications.read",
      "Read own and scoped notifications"
    ],
    [
      "ops.overview.read",
      "Read operational overview"
    ],
    [
      "ops.events.read",
      "Read operational event timeline"
    ],
    [
      "ops.audit.read",
      "Read scoped operational audit"
    ],
    [
      "ops.audit.full",
      "Read full operational audit including access-denied details"
    ],
    [
      "ops.statistics.read",
      "Read operational module summaries"
    ],
    [
      "audit.read",
      "View audit log"
    ],
    [
      "announcements.read",
      "View announcements"
    ],
    [
      "announcements.create",
      "Create announcements"
    ],
    [
      "announcements.manage",
      "Manage announcements"
    ],
    [
      "announcements.archive.read",
      "Read announcement archive"
    ],
    [
      "announcements.settings.read",
      "Read announcement settings"
    ],
    [
      "announcements.settings.manage",
      "Manage announcement settings"
    ],
    [
      "people.read",
      "Read people directory"
    ],
    [
      "people.profile.read",
      "Read people profiles"
    ],
    [
      "people.profile.manage",
      "Manage people profiles"
    ],
    [
      "people.phone.read",
      "Read visible phone numbers"
    ],
    [
      "people.skills.read",
      "Read people skills"
    ],
    [
      "people.skills.manage",
      "Manage people skills"
    ],
    [
      "people.recommendations.manage",
      "Manage skill recommendations"
    ],
    [
      "people.notes.read",
      "Read management profile notes"
    ],
    [
      "people.notes.manage",
      "Manage management profile notes"
    ],
    [
      "shift.self.read",
      "View own shift and employee card"
    ],
    [
      "shift.self.manage",
      "Manage own shift attendance"
    ],
    [
      "shift.future.read",
      "Read future shift planning"
    ],
    [
      "shift.future.manage",
      "Manage future shift planning"
    ],
    [
      "shift.current.read",
      "Read current shift operations"
    ],
    [
      "shift.current.manage",
      "Manage current shift operations"
    ],
    [
      "shift.past.read",
      "Read operational shift history"
    ],
    [
      "shift.return.manage",
      "Approve or reject return-to-shift requests"
    ],
    [
      "shift.contractor-lead.manage",
      "Submit contractor shift plans"
    ],
    [
      "shift.settings.read",
      "Read shift settings"
    ],
    [
      "shift.settings.manage",
      "Manage shift settings"
    ],
    [
      "company.members.read",
      "Read members of the selected external company"
    ],
    [
      "company.members.manage",
      "Manage members of the selected external company"
    ]
  ],
  "rolePermissions": {
    "ADMIN": [
      "admin.read",
      "config.read",
      "admin.overview.read",
      "admin.users.read",
      "admin.users.manage",
      "admin.roles.read",
      "admin.roles.manage",
      "admin.factories.read",
      "admin.factories.manage",
      "admin.departments.read",
      "admin.departments.manage",
      "admin.lines.read",
      "admin.lines.manage",
      "factory.read",
      "factory.manage",
      "users.manage",
      "users.password.reset",
      "lines.read",
      "lines.manage",
      "assignments.manage",
      "tasks.read",
      "tasks.create",
      "tasks.take",
      "tasks.done",
      "tasks.redirect",
      "tasks.comment",
      "tasks.read-receipts.read",
      "tasks.escalation.manage",
      "tasks.manage",
      "tasks.settings.read",
      "tasks.settings.manage",
      "wash.read",
      "wash.manage",
      "wash.message.create",
      "wash.issue.create",
      "wash.issue.resolve",
      "wash.control.create",
      "wash.control.manage",
      "wash.okk-review.read",
      "wash.okk-review.manage",
      "wash.settings.read",
      "wash.settings.manage",
      "okk.read",
      "okk.manage",
      "stock.read",
      "stock.manage",
      "returns.read",
      "returns.publication.read",
      "returns.manage",
      "orders.read",
      "orders.take",
      "orders.request",
      "orders.restock",
      "orders.items.manage",
      "orders.requests.manage",
      "orders.archive.read",
      "orders.settings.read",
      "orders.settings.manage",
      "checklists.templates.read",
      "checklists.templates.manage",
      "checklists.runs.read",
      "checklists.runs.manage",
      "checklists.runs.self",
      "checklists.archive.read",
      "checklists.settings.read",
      "checklists.settings.manage",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "shift-log.manage",
      "shift-log.important.manage",
      "shift-log.archive.read",
      "shift-log.reads.read",
      "defrost.read",
      "defrost.manage",
      "defrost.calendar.read",
      "defrost.settings.read",
      "defrost.settings.manage",
      "chats.read",
      "chats.write",
      "chats.manage",
      "chats.archive.read",
      "chats.settings.read",
      "chats.settings.manage",
      "notifications.read",
      "ops.overview.read",
      "ops.events.read",
      "ops.audit.read",
      "ops.audit.full",
      "ops.statistics.read",
      "audit.read",
      "announcements.read",
      "announcements.create",
      "announcements.manage",
      "announcements.archive.read",
      "announcements.settings.read",
      "announcements.settings.manage",
      "people.read",
      "people.profile.read",
      "people.profile.manage",
      "people.phone.read",
      "people.skills.read",
      "people.skills.manage",
      "people.recommendations.manage",
      "people.notes.read",
      "people.notes.manage",
      "shift.self.read",
      "shift.self.manage",
      "shift.future.read",
      "shift.future.manage",
      "shift.current.read",
      "shift.current.manage",
      "shift.past.read",
      "shift.return.manage",
      "shift.contractor-lead.manage",
      "shift.settings.read",
      "shift.settings.manage",
      "company.members.read",
      "company.members.manage"
    ],
    "MANAGEMENT": [
      "factory.read",
      "lines.read",
      "lines.manage",
      "shift.current.read",
      "shift.future.read",
      "shift.past.read",
      "tasks.read",
      "tasks.take",
      "tasks.done",
      "tasks.comment",
      "tasks.read-receipts.read",
      "tasks.escalation.manage",
      "wash.read",
      "wash.message.create",
      "wash.issue.create",
      "wash.issue.resolve",
      "wash.control.create",
      "wash.control.manage",
      "okk.read",
      "stock.read",
      "returns.read",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "audit.read",
      "shift-log.manage",
      "shift-log.important.manage",
      "shift-log.archive.read",
      "shift-log.reads.read",
      "orders.read",
      "orders.take",
      "orders.request",
      "orders.restock",
      "orders.items.manage",
      "orders.requests.manage",
      "orders.archive.read",
      "checklists.templates.read",
      "checklists.templates.manage",
      "checklists.runs.read",
      "checklists.runs.manage",
      "checklists.runs.self",
      "checklists.archive.read",
      "defrost.read",
      "defrost.manage",
      "defrost.calendar.read",
      "chats.read",
      "chats.write",
      "chats.manage",
      "chats.archive.read",
      "notifications.read",
      "ops.overview.read",
      "ops.events.read",
      "ops.audit.read",
      "ops.statistics.read",
      "announcements.read",
      "announcements.create",
      "announcements.manage",
      "announcements.archive.read",
      "announcements.settings.read",
      "people.read",
      "people.profile.read",
      "people.profile.manage",
      "people.phone.read",
      "people.skills.read",
      "people.skills.manage",
      "people.recommendations.manage",
      "people.notes.read",
      "people.notes.manage",
      "returns.publication.read",
      "returns.manage"
    ],
    "MASTER": [
      "factory.read",
      "shift.current.read",
      "shift.current.manage",
      "shift.future.read",
      "shift.future.manage",
      "shift.past.read",
      "shift.return.manage",
      "lines.read",
      "lines.manage",
      "assignments.manage",
      "tasks.read",
      "tasks.create",
      "tasks.take",
      "tasks.done",
      "tasks.redirect",
      "tasks.comment",
      "tasks.read-receipts.read",
      "tasks.manage",
      "wash.read",
      "wash.manage",
      "wash.message.create",
      "wash.issue.create",
      "wash.issue.resolve",
      "wash.control.create",
      "wash.control.manage",
      "okk.read",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "shift-log.manage",
      "returns.read",
      "orders.read",
      "orders.take",
      "orders.request",
      "checklists.templates.read",
      "checklists.runs.read",
      "checklists.runs.self",
      "defrost.read",
      "defrost.calendar.read",
      "chats.read",
      "chats.write",
      "notifications.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "people.skills.manage",
      "people.recommendations.manage",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read"
    ],
    "WORKER": [
      "announcements.read",
      "people.profile.read",
      "people.skills.read",
      "shift.self.read",
      "shift.self.manage",
      "defrost.read",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read"
    ],
    "OKK": [
      "factory.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "lines.read",
      "lines.manage",
      "tasks.read",
      "tasks.create",
      "tasks.take",
      "tasks.done",
      "tasks.comment",
      "wash.read",
      "wash.okk-review.read",
      "wash.okk-review.manage",
      "wash.issue.create",
      "wash.issue.resolve",
      "okk.read",
      "okk.manage",
      "returns.read",
      "returns.manage",
      "orders.read",
      "orders.take",
      "orders.request",
      "checklists.templates.read",
      "checklists.runs.read",
      "checklists.runs.self",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read"
    ],
    "STORE": [
      "factory.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "returns.read",
      "returns.manage",
      "orders.read",
      "orders.take",
      "orders.restock",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read"
    ],
    "TECH_KIPIA": [
      "factory.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "lines.read",
      "shift.current.read",
      "shift.future.read",
      "tasks.read",
      "tasks.take",
      "tasks.done",
      "tasks.comment",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read"
    ],
    "TECH_HOLOD": [
      "factory.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "lines.read",
      "shift.current.read",
      "shift.future.read",
      "tasks.read",
      "tasks.take",
      "tasks.done",
      "tasks.comment",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "defrost.read",
      "defrost.manage",
      "defrost.calendar.read",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read"
    ],
    "TECH_ELECTRIC": [
      "factory.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "lines.read",
      "shift.current.read",
      "shift.future.read",
      "tasks.read",
      "tasks.take",
      "tasks.done",
      "tasks.comment",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read"
    ],
    "TECH_MECHANIC": [
      "factory.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "lines.read",
      "shift.current.read",
      "shift.future.read",
      "tasks.read",
      "tasks.take",
      "tasks.done",
      "tasks.comment",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read"
    ],
    "TECH_SANTECHNIK": [
      "factory.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "lines.read",
      "shift.current.read",
      "shift.future.read",
      "tasks.read",
      "tasks.take",
      "tasks.done",
      "tasks.comment",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read"
    ],
    "TECHNOLOG": [
      "factory.read",
      "announcements.read",
      "people.read",
      "people.profile.read",
      "people.skills.read",
      "lines.read",
      "lines.manage",
      "returns.read",
      "tasks.read",
      "tasks.take",
      "tasks.done",
      "tasks.comment",
      "orders.read",
      "orders.take",
      "orders.request",
      "checklists.templates.read",
      "checklists.runs.read",
      "checklists.runs.self",
      "shift-log.read",
      "shift-log.create",
      "shift-log.comment",
      "defrost.read",
      "defrost.calendar.read",
      "chats.read",
      "chats.write",
      "notifications.read",
      "returns.publication.read",
      "announcements.create",
      "people.phone.read",
      "wash.read"
    ],
    "CONTRACTOR": [
      "shift.self.read",
      "shift.self.manage",
      "returns.publication.read"
    ],
    "CONTRACTOR_LEAD": [
      "shift.self.read",
      "shift.self.manage",
      "shift.contractor-lead.manage",
      "company.members.read",
      "company.members.manage",
      "returns.publication.read",
      "announcements.read",
      "announcements.create",
      "people.read",
      "people.phone.read"
    ],
    "OTHER": [
      "returns.publication.read",
      "announcements.read",
      "announcements.create",
      "people.read",
      "people.phone.read"
    ]
  }
};

// Membership eligibility is distinct from browsing the factory chat directory.
catalog.permissions.push(['chats.access', 'Доступ к разрешённым чатам']);
for (const [role, permissions] of Object.entries(catalog.rolePermissions)) {
  if (role === 'WORKER' || role === 'CONTRACTOR') {
    catalog.rolePermissions[role] = permissions.filter((code) => !code.startsWith('chats.'));
  } else {
    permissions.push('chats.access');
  }
}
module.exports = Object.freeze(catalog);
