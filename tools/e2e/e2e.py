"""End-to-end journey against a REAL running server with REAL sign-in.

PM signs in by one-time code -> workspace -> product -> idea -> reviewers approve
-> project created with leads -> leads invite their team (email + link) -> access
is enforced -> bugs are raised, assigned and closed -> ledger chain verifies.
"""
import os
import sys
import time

import httpx

BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:8099")
CODE = os.environ.get("DEV_OTP_CODE", "424242")
ok_count = 0
failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok_count
    if cond:
        ok_count += 1
        print(f"  PASS  {name}")
    else:
        failures.append(f"{name} {detail}")
        print(f"  FAIL  {name}  {detail}")


def login(c: httpx.Client, email: str) -> dict:
    r = c.post("/api/auth/send-otp", json={"email": email})
    assert r.status_code == 200, (email, r.status_code, r.text)
    r = c.post("/api/auth/verify-otp", json={"email": email, "code": CODE})
    assert r.status_code == 200, (email, r.status_code, r.text)
    j = r.json()
    return {"h": {"Authorization": f"Bearer {j['access_token']}"}, "id": j["user"]["id"], "email": email}


def main() -> int:
    c = httpx.Client(base_url=BASE, timeout=30)

    print("\n[1] Security of sign-in")
    r = c.post("/api/auth/send-otp", json={"email": "attacker@e2e.test"})
    check("send code", r.status_code == 200)
    for bad in ("123456", "9068", "009068", "000000"):
        r = c.post("/api/auth/verify-otp", json={"email": "attacker@e2e.test", "code": bad})
        check(f"well-known code {bad} rejected", r.status_code in (400, 429), str(r.status_code))
    r = c.post("/api/auth/send-otp", json={"email": "attacker@e2e.test"})
    check("resend cooldown (429)", r.status_code == 429 and "Retry-After" in r.headers, str(r.status_code))
    r = c.post("/api/auth/send-otp", json={"email": "not-an-email"})
    check("invalid email rejected", r.status_code == 422)

    print("\n[2] Everyone signs in")
    pm = login(c, "pm@e2e.test")
    director = login(c, "director@e2e.test")
    design = login(c, "design.lead@e2e.test")
    dev = login(c, "dev.lead@e2e.test")
    dev2 = login(c, "dev2@e2e.test")
    outsider = login(c, "outsider@e2e.test")
    me = c.get("/api/auth/me", headers=pm["h"]).json()
    check("token works", me["email"] == "pm@e2e.test")
    r = c.get("/api/projects")
    check("anonymous API call refused", r.status_code in (401, 403), str(r.status_code))

    print("\n[3] Workspace, product, idea")
    r = c.post("/api/workspaces/create", headers=pm["h"], json={"name": "E2E Labs", "user_role": "product_manager"})
    check("workspace created", r.status_code == 200, r.text[:120])
    ws = r.json()["id"]
    r = c.post("/api/products", headers=pm["h"], json={"name": "Checkout", "workspace_id": ws, "description": "Payments"})
    check("product created", r.status_code == 201, f"{r.status_code} {r.text[:150]}")
    prod = r.json().get("id")
    r = c.post(
        "/api/ideas",
        headers=pm["h"],
        json={
            "title": "Discount codes",
            "problem_statement": "Customers want percentage discount codes at checkout",
            "product_id": prod,
            "workspace_id": ws,
        },
    )
    check("idea created", r.status_code == 201, r.text[:150])
    idea = r.json()["id"]

    print("\n[4] Invite the leads by email (workspace level)")
    tokens = {}
    for who, role in ((director, "director"), (design, "designer"), (dev, "developer")):
        r = c.post(f"/api/workspaces/{ws}/invites", headers=pm["h"], json={"email": who["email"], "role": role})
        check(f"invite {who['email']}", r.status_code == 201, r.text[:120])
        tokens[who["email"]] = r.json()["token"]
        link = r.json()["inviteLink"]
        check("link is /?invite=<token>", link.endswith(f"/?invite={tokens[who['email']]}"), link)
    r = c.get(f"/api/invites/{tokens[dev['email']]}")
    check("public preview", r.status_code == 200 and r.json()["workspace"]["name"] == "E2E Labs")
    r = c.post("/api/invites/accept", headers=outsider["h"], json={"token": tokens[dev["email"]]})
    check("someone else cannot use an addressed invite", r.status_code == 403, str(r.status_code))
    r = c.post("/api/workspaces/join", headers=outsider["h"], json={"workspace_id": ws})
    check("joining by workspace id alone is closed", r.status_code == 422, str(r.status_code))
    for who in (director, design, dev):
        r = c.post("/api/invites/accept", headers=who["h"], json={"token": tokens[who["email"]]})
        check(f"{who['email']} joined", r.status_code == 200, r.text[:120])
    r = c.post("/api/invites/accept", headers=dev["h"], json={"token": tokens[dev["email"]]})
    check("invite is single-use", r.status_code == 410, str(r.status_code))

    print("\n[5] Idea -> approval -> project")
    r = c.post(f"/api/ideas/{idea}/promote", headers=pm["h"], json={"name": "Too early"})
    check("cannot create project before approval", r.status_code == 409, str(r.status_code))
    r = c.post(f"/api/ideas/{idea}/request-approval", headers=pm["h"], json={"reviewer_ids": [director["id"], design["id"]]})
    check("approval requested", r.status_code == 200 and r.json()["status"] == "pending_approval", r.text[:150])
    r = c.get("/api/idea-approvals/inbox", headers=director["h"])
    check("director sees it in their inbox", any(i["ideaId"] == idea for i in r.json()))
    r = c.post(f"/api/ideas/{idea}/decision", headers=dev["h"], json={"decision": "approve"})
    check("non-reviewer cannot decide", r.status_code == 403, str(r.status_code))
    r = c.post(f"/api/ideas/{idea}/decision", headers=director["h"], json={"decision": "approve"})
    check("director approves (1/2)", r.json()["approvedCount"] == 1 and r.json()["status"] == "pending_approval")
    r = c.post(f"/api/ideas/{idea}/decision", headers=design["h"], json={"decision": "approve"})
    check("designer approves (2/2) -> approved", r.json()["status"] == "approved", r.text[:150])
    r = c.post(
        f"/api/ideas/{idea}/promote",
        headers=pm["h"],
        json={
            "name": "Checkout Discounts",
            "leads": [
                {"user_id": design["id"], "role": "designer", "is_lead": True},
                {"user_id": dev["id"], "role": "developer", "is_lead": True},
            ],
        },
    )
    check("project created from approved idea", r.status_code == 201, r.text[:200])
    pid = r.json()["projectId"]
    r = c.get(f"/api/projects/{pid}/access", headers=pm["h"])
    check("project starts restricted", r.json()["access"] == "restricted" and r.json()["canManage"])

    print("\n[6] Leads grow their own team; access is enforced")
    r = c.post(f"/api/workspaces/{ws}/invites", headers=pm["h"], json={"email": dev2["email"], "role": "developer"})
    c.post("/api/invites/accept", headers=dev2["h"], json={"token": r.json()["token"]})
    r = c.get(f"/api/projects/{pid}", headers=dev2["h"])
    check("workspace member not on the team is kept out", r.status_code == 403, str(r.status_code))
    r = c.get("/api/projects", headers=dev2["h"])
    check("restricted project hidden from their list", pid not in {p["id"] for p in r.json()})
    r = c.post(f"/api/workspaces/{ws}/invites", headers=dev["h"], json={"email": "x@e2e.test", "role": "executive", "project_id": pid})
    check("dev lead cannot mint an executive", r.status_code == 403, str(r.status_code))
    r = c.post(f"/api/workspaces/{ws}/invites", headers=dev["h"], json={"role": "developer", "project_id": pid, "stations": ["developer", "qa"]})
    check("dev lead invites a developer to the project", r.status_code == 201, r.text[:150])
    r2 = c.post("/api/invites/accept", headers=dev2["h"], json={"token": r.json()["token"]})
    check("dev2 joined the project", r2.status_code == 200 and r2.json()["projectId"] == pid, r2.text[:150])
    r = c.get(f"/api/projects/{pid}", headers=dev2["h"])
    check("dev2 now sees the project", r.status_code == 200, str(r.status_code))
    acc = c.get(f"/api/projects/{pid}/access", headers=dev2["h"]).json()
    check("dev2 only has developer+qa stations", sorted(acc["stations"]) == ["developer", "qa"], str(acc["stations"]))
    r = c.get(f"/api/projects/{pid}", headers=outsider["h"])
    check("outsider (other workspace) refused", r.status_code == 403, str(r.status_code))
    members = c.get(f"/api/projects/{pid}/members", headers=pm["h"]).json()
    check("team roster has leads + invitee", {m["email"] for m in members} >= {design["email"], dev["email"], dev2["email"]})
    r = c.post(f"/api/projects/{pid}/members", headers=dev2["h"], json={"user_id": director["id"], "role": "developer"})
    check("plain member cannot add people", r.status_code == 403, str(r.status_code))
    r = c.post(f"/api/projects/{pid}/members", headers=pm["h"], json={"user_id": outsider["id"], "role": "developer"})
    check("cannot add someone outside the workspace", r.status_code == 422, str(r.status_code))

    print("\n[7] Bugs: raise, assign, fix, close")
    r = c.post(f"/api/projects/{pid}/issues", headers=dev2["h"], json={"title": "Discount rounds wrongly", "type": "bug", "priority": "P1", "source": "qa"})
    check("developer raises a bug", r.status_code == 201 and r.json()["key"] == "ISS-1", r.text[:150])
    bug = r.json()["id"]
    r = c.patch(f"/api/issues/{bug}", headers=dev2["h"], json={"assignee_id": dev["id"]})
    check("member cannot hand work to someone else", r.status_code == 403, str(r.status_code))
    r = c.patch(f"/api/issues/{bug}", headers=dev["h"], json={"assignee_id": dev2["id"]})
    check("lead assigns the bug", r.status_code == 200 and r.json()["assigneeName"], r.text[:150])
    r = c.get("/api/issues/mine", headers=dev2["h"])
    check("it appears on the assignee's list", [i["key"] for i in r.json()] == ["ISS-1"])
    r = c.get(f"/api/projects/{pid}/issues", headers=outsider["h"])
    check("outsider cannot read issues", r.status_code == 403)
    for s in ("in_progress", "in_review", "done"):
        r = c.patch(f"/api/issues/{bug}", headers=dev2["h"], json={"status": s})
        check(f"assignee moves it to {s}", r.status_code == 200 and r.json()["status"] == s)
    check("closed bug leaves 'mine'", c.get("/api/issues/mine", headers=dev2["h"]).json() == [])

    print("\n[8] Evidence ledger")
    r = c.get("/api/ledger/verify", headers=pm["h"])
    check("hash chain verifies", r.status_code == 200 and r.json().get("ok", r.json().get("valid", True)) in (True,), r.text[:150])
    r = c.get("/api/ledger?limit=500", headers=pm["h"])
    actions = {e.get("action") for e in r.json()} if r.status_code == 200 else set()
    for a in ("invite.created", "invite.accepted", "idea.approved", "issue.created", "issue.assigned"):
        check(f"ledger recorded {a}", a in actions, str(sorted(actions))[:200])

    print(f"\n{ok_count} passed, {len(failures)} failed")
    for f in failures:
        print("  -", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
