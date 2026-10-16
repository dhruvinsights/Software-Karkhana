# 01. Sharing, Invites & Role-Level Visibility Controls

## 🎯 Objective
Provide fine-grained, multi-tier sharing and access control across **Workspaces**, **Projects**, and individual **Station Interfaces**.

---

## 🏛️ Multi-Tier Access Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│ 1. WORKSPACE LEVEL ACCESS (Organization Scope)              │
│    • Owner, Admin, Member                                   │
│    • Global Workspace Invite Link & Email Dispatch          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. PROJECT LEVEL ACCESS (Product Deliverable Scope)         │
│    • Project Leads (Dev Lead, Design Lead, QA Lead, etc.)   │
│    • Project-specific invite link with assigned role grants │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. INTERFACE / STATION LEVEL VISIBILITY (Role-Based Scope)  │
│    • Dev Interface: Visible to Developers, Leads, Managers  │
│    • Design Interface: Visible to Designers, PMs, Leads     │
│    • QA Station: Visible to QA Engineers, Devs, Leads       │
│    • Security Station: Visible to AppSec, Pentesters, PMs   │
│    • DevOps & Release: Visible to DevOps, Release Mgrs      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 Role-Based Interface Visibility Matrix

| Station / Interface | Product Manager | Developer | Designer | QA Engineer | DevOps | Security / Pentest | Director / Dev Mgr |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Product & Ideas Studio** | Full Edit | View Only | View Only | View Only | View Only | View Only | Signoff Authority |
| **Design Studio & Mocks** | View/Comment | View Only | **Full Edit** | View Only | None | None | Review |
| **Architecture & ADRs** | Review | **Full Edit** | View Only | View Only | Review | Review | Signoff Authority |
| **Developer Code & PRs** | View Status | **Full Edit** | None | View Tests | Review CI | Review Security | Review |
| **QA & Scenario Matrix** | View Pass/Fail | View Bugs | None | **Full Edit** | View Logs | View Reports | Review |
| **AppSec & Pentesting** | View Waivers | View Fixes | None | None | Review | **Full Edit** | Gate Authority |
| **DevOps & Multi-Cloud** | View Deploy | None | None | None | **Full Edit** | Review Scan | Gate Authority |

---

## ✉️ Invite Link Generation & Resend Email Delivery

### 1. Tokenized Invite Links
- Secure cryptographic invite tokens: `https://app.softwarekarkhana.com/invite?token=eyJ...`
- Token payload embeds: `workspace_id`, `project_id` (optional), `role`, `expires_at`, `inviter_id`.
- On clicking link, user is directed through OTP/OAuth verification and immediately enrolled into the target workspace & project with their granted role.

### 2. Email Delivery via Resend
- Direct dispatch using `app/email.py` and Resend REST API.
- Branded HTML template displaying the inviter's name, workspace name, assigned role, and one-click accept button.

### 3. Session Persistence & Refresh
- JWT access tokens stored in `localStorage` + secure `httpOnly` cookie.
- Automatic silent refresh mechanism to prevent session drops during active factory work.
- OTP resend cooldown timer (60s countdown) on the authentication screen to avoid abuse.
