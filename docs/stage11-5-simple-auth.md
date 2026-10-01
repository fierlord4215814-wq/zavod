# Stage 11.5 - Simple Internal Auth

## Scope

Stage 11.5 adds a simple internal login layer for the factory platform:

- login by phone number;
- password with a minimum length of 4 characters;
- password hash storage only;
- first-login/reset-required password setup;
- ADMIN password reset through guarded backend endpoints;
- bearer token for normal frontend sessions;
- dev-login preserved for local regression scripts.

This stage does not add SMS, email recovery, OAuth, production identity management, refresh-token rotation or external SSO.

## Password Rules

Passwords are never stored in plain text. The backend stores `passwordHash` generated with scrypt and never returns it through API responses. Audit details must not contain passwords, hashes, tokens, `DATABASE_URL`, JWT secrets or other credentials.

The seed provides development-only phone/password credentials for test users. Those credentials are for local smoke/regression work only and must not be reused outside a dev database.

## Login Flow

1. User enters phone and password.
2. Backend normalizes the phone number and verifies the password hash.
3. If the account is blocked or deleted, login is rejected.
4. If `passwordResetRequired` is true, backend returns a short-lived password setup token.
5. After setting a new password, backend clears `passwordResetRequired` and returns a normal auth token.
6. Frontend stores the auth token locally for now and then loads `/auth/me`.

The current implementation uses a simple HMAC signed bearer token. Later production hardening can move this to httpOnly cookies or DB-backed sessions.

## Admin Reset

`POST /admin/users/:id/password-reset` is available only to ADMIN users with `users.password.reset`. It does not return a password and does not expose the old password. It only sets `passwordResetRequired=true`; the target user must set a new password on the next login.

Management-scoped password reset is intentionally not enabled by default. It can be added later when department/factory scope rules are formalized for that operation.

## Dev Login

`POST /auth/dev-login` remains available for dev/regression scripts. Normal frontend login uses phone/password. Dev-login must stay clearly marked as dev-only and should not become the production path.

## Audit

Auth-related audit actions:

- `LOGIN_SUCCESS`;
- `LOGIN_FAILED`;
- `LOGOUT`;
- `PASSWORD_CHANGED`;
- `PASSWORD_SET_AFTER_RESET`;
- `ADMIN_PASSWORD_RESET`;
- `ACCESS_DENIED`.

Failed login audit uses masked phone data and avoids leaking whether a phone exists.

## Regression Checklist

- phone/password login succeeds;
- wrong password fails;
- blocked user cannot login;
- `/auth/me` does not expose password hash;
- ADMIN can require password reset;
- WORKER cannot reset another user's password;
- reset flow requires setting a new password;
- old password fails after reset;
- new password succeeds;
- dev-login still works for regression;
- Stage 6-11 regressions remain green.

## Temporary Decisions

- Token is stored in localStorage for the PWA dev/runtime phase.
- There is no SMS/email recovery.
- There is no refresh-token rotation yet.
- Failed login counting is recorded, but full rate limiting is left for a later auth hardening stage.
