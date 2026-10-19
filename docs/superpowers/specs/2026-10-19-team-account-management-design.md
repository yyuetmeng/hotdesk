# Team account management — design

Date: 2026-10-19. Owner decisions (chat, 2026-10-19) are marked **(owner)**; everything else is the designer's
call and is marked *(call)*.

## 1. Intent

Admins want to hand day-to-day account upkeep to each project team instead of doing every change themselves
**(owner)**. An admin can give an ordinary user an extra permission, "manage team accounts", for one or more of
that user's project teams. That user then gets a cut-down Manage Users page for the people in those teams.

It is a permission, not a role or a title: the person stays a normal user everywhere else **(owner: "you dont
have to name it team lead")**.

**Goals.**
- An admin chooses who has the permission and for which of their project teams **(owner)**.
- People with it can look after their teammates' accounts without asking an admin.

**Non-goals.** New roles; letting them create, import or delete users; changing team membership; audit-log access.

**Anti-goals.**
- A non-admin able to take over an account (password, email, username) or make anyone an admin.
- A non-admin able to widen their own reach (add people to their teams, touch their own account).
- Anything hidden only in the page and not refused by the server.

## 2. Who and whose accounts

- **The permission** is per user and per project team: an admin ticks, for a user, which of **that user's own**
  project teams they may manage **(owner)**. Only teams the user belongs to can be ticked *(call)*.
- If the user later leaves a team, or the team is deleted, their permission for that team ends with it *(call)*.
- Admins don't need it: they already manage everyone.
- **Manageable people** for a holder: users who belong to at least one of the holder's chosen teams, **never**
  admin accounts and **never** the holder's own account **(owner)**.

## 3. What a holder can do (server-enforced)

Allowed, for manageable people only **(owner)**:
- see them in the users table (name, username, email, teams, status, access dates, usual seat, allowance — the
  columns admins see, read-only where not listed below);
- edit **name**, **access start/end dates**, **usual seat** and **booking allowance**;
- **turn the account on or off**;
- **resend the invitation** email.

Refused (admin only) **(owner)**: role, email, username, setting a password, delete, project-team membership,
creating users, Upload Users. Any request for these, or for a person outside the holder's scope, is refused by
the server: 403 "You can only manage accounts in your project teams." for out-of-scope people, 403 "Only an
administrator can change this." for a refused field *(call: wording)*.

Booking allowance is capped at what an admin could set; there is no extra cap for holders *(call)*.

## 4. Screens

### 4.1 Admin: granting it (Manage Users → edit a user)
- In the edit panel, under the user's project teams, a section **"Can manage accounts for"** with a checkbox per
  team the user belongs to *(call: placement)*. Unticking all removes the permission.
- Not shown for admin accounts.
- The users table shows a small marker for holders *(call)*.

### 4.2 Holder: the cut-down Manage Users page
- The **Manage Users** menu item appears for holders as well as admins.
- They see only the top part: filters and the users table, limited to manageable people, and the edit panel
  **(owner: "just the top part")**.
- Hidden for holders: the security summary tiles (they come from the admin-only audit log), **New user**,
  **Upload Users**, the **Project Teams** section, the edit panel's **History** tab, and the role, email,
  username, password, teams and delete controls *(call: tiles and History follow from "no audit access")*.
- A line at the top: "You can manage accounts in: Engineering, Design." *(call)*.

## 5. Audit
- Holders' changes are audited exactly like an admin's (same events, the holder as actor).
- Granting or removing the permission is audited as a user change by the admin *(call)*.

## 6. Tests (backend, local Postgres; frontend smoke for pure helpers)
- A holder lists only manageable people: teammates in chosen teams; not admins; not themselves; not people only in
  their unchosen teams.
- Each allowed edit works; each refused field is a 403; out-of-scope people are a 403 (also by guessing an id).
- A holder cannot grant themselves or others the permission.
- Losing team membership ends the permission for that team.
- Admin pages and endpoints that holders must not reach (departments editing, audit, import, create, delete)
  stay 403 for them.

## 7. Settled details *(all calls)*
- **Same rules as admins.** A holder's edit goes through the same validation and side effects as an admin's: the
  usual seat must be a seat on a published floor, and turning an account off does what it does today. Holders
  are a narrower *who*, not a different *how*.
- **Effective at once.** Scope (the permission, the chosen teams, team membership, the target's role) is read
  from the database on every request, never from the sign-in token, so removing the permission or a team takes
  effect on the holder's next request.
- **Knowing you're a holder.** The signed-in user's profile response says which teams they manage (empty for
  most people). The menu item, the page route and the "You can manage accounts in…" line use it.
- **Mixed saves.** For a holder, a field sent with its current value is ignored, and a refused field sent with a
  **different** value refuses the whole save (403, nothing changed). The holder's edit panel sends only the
  fields it shows.
- **Other teams.** The table shows a manageable person's project teams as admins see them (team names are not
  secret: the Colleague Finder lists them). Membership in teams outside the holder's choice changes nothing.
- **Granting** is part of the admin's normal user save, one audit event.

## 8. Left to the builder
Storage shape for the permission, whether holders use the existing user endpoints with a wider guard or their
own endpoints, component layout (follow Manage Users), exact wording tweaks.
