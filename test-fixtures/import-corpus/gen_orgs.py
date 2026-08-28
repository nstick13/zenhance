#!/usr/bin/env python3
"""
Synthetic org-import test corpus generator for Zenhance.

Produces ~50 fake orgs as .xlsx files spanning:
  - size:      tiny (~10)  small (~60)  medium (~300)  large (~1800)  huge (~10000)
  - tidiness:  clean  |  messy (bad headers, mixed vocab, junk rows, orphan refs, ...)
  - shape:     wizard-native (People/Teams/Assignments sheets)  |  flat HRIS dump (1 sheet)
  - contractors: none | one lone contractor | embedded in teams | segregated vendor pod
                 | fully outsourced offshore unit | mixed staff-aug + SOW
  - files:     single .xlsx  |  multi-file (roster + orgchart, or per-department split)

Every org gets a folder under OUT/. MANIFEST.json + README.md at OUT/ root describe
each org and the edge cases it is meant to exercise.

Deterministic: seeded per-org so re-runs are stable.
"""

import json
import os
import random
import shutil
from pathlib import Path

from openpyxl import Workbook

OUT = Path(__file__).parent / "orgs"

# ----------------------------------------------------------------------------
# name pools (self-contained; no faker)
# ----------------------------------------------------------------------------
FIRST = """Aaron Abby Adam Adaora Aditi Ahmed Aisha Alan Alex Alice Amara Amir Amy Ana Andre
Angela Anh Anna Anthony Arjun Ava Ben Bianca Bill Bob Brenda Brian Camila Carlos Carol Chen
Chris Claire Colin Dan Dana Daniel David Deepa Diana Diego Dmitri Ed Elena Eli Elif Emma Eric
Fatima Felix Fernanda Finn Frank Gabriel Gao Grace Greg Hannah Hans Hassan Heather Helena Henry
Hiro Ian Ingrid Isaac Ivan Jack Jacob James Jamal Jane Javier Jenny Jesse Jia Jing Joan John
Jonas Jorge Jose Juan Julia Karl Kate Katya Ken Kevin Kim Kiran Lars Laura Lena Leo Li Lin Linda
Lucas Luis Maria Mark Marta Martin Mateo Maya Mei Mia Michael Mike Mira Mohammed Nadia Nate Neha
Nina Noah Nora Olga Oliver Omar Otto Paul Paula Pedro Peter Petra Priya Rachel Rafael Raj Ravi
Rebecca Ren Ricardo Rin Rita Rob Rosa Ruth Ryan Sam Samir Sandra Sara Sasha Sean Sofia Sonia
Steve Sun Tanvi Tara Ted Teresa Thomas Tina Tom Tomas Uma Victor Vikram Wang Wei Will Xin Yan
Yara Yuki Yusuf Zara Zoe""".split()

LAST = """Adams Ahmed Alvarez Andersen Anderson Bailey Baker Bauer Bautista Bennett Bianchi
Blanco Brown Carter Chan Chen Cho Choi Clark Cohen Costa Cruz Davis Delgado Diaz Dubois Edwards
Espinoza Evans Fernandez Ferrari Fischer Fisher Flores Foster Fox Garcia Ghosh Gonzalez Green
Gupta Hall Hansen Harris Hassan Hayashi He Hernandez Ito Ivanov Jackson Jain Jensen Jimenez
Johnson Jones Kang Kaur Kelly Khan Kim King Klein Kobayashi Kowalski Kumar Lam Lee Lewis Li Lin
Liu Lopez Ma Mancini Martin Martinez Mehta Miller Mitchell Moore Morales Moreau Muller Nakamura
Ng Nguyen Novak Ortiz Osei Owens Padilla Park Patel Perez Petrov Phillips Popov Powell Ramirez
Rao Reddy Reyes Ribeiro Rodriguez Rossi Roy Ruiz Santos Sato Schmidt Schneider Scott Sharma Shin
Silva Singh Smith Sokolov Solomon Souza Steele Stewart Suzuki Tanaka Taylor Thompson Torres Tran
Turner Vargas Vega Volkov Walker Wang Watanabe Watson Weber White Williams Wilson Wong Wright Wu
Xu Yamada Yamamoto Yang Yilmaz Yoshida Young Yu Zhang Zhao Zhou""".split()

ORG_ADJ = "Northwind Blue Ridge Meridian Apex Vantage Lighthouse Bright Harbor Cascade Ironclad Sterling Copper Granite Willow Summit Delta Orbit Pioneer Keystone Anchor Vertex Beacon Cobalt Aurora Tangent Foundry Redwood".split()
ORG_NOUN = "Health Logistics Financial Retail Media Robotics Analytics Payments Energy Telecom Insurance Software Devices Mobility Grocery Learning Security Travel Housing Agriculture Biotech Gaming Freight".split()
ORG_SUFFIX = ["", " Inc", " Corp", " Group", " Labs", " Systems", " Technologies", " Co", " Holdings", " LLC"]

VENDORS = ["Infosys", "TCS", "Wipro", "Accenture", "Cognizant", "EPAM", "Globant", "Capgemini",
           "Endava", "ThoughtWorks", "Nagarro", "Persistent"]

# discipline / title material
DISCIPLINES = ["Software Engineering", "Data Engineering", "Data Science", "Product Management",
               "Design", "Product Design", "QA", "Site Reliability", "Security", "Program Management",
               "Engineering Management", "Marketing", "Sales", "Customer Success", "Finance",
               "People Ops", "IT", "Research", "Analytics", "UX Research"]
TITLES = {
    "Software Engineering": ["Software Engineer", "Sr. Software Engineer", "Staff Engineer",
                             "Frontend Engineer", "Backend Engineer", "Full Stack Developer",
                             "Principal Engineer", "Engineering Lead"],
    "Data Engineering": ["Data Engineer", "Sr Data Engineer", "Analytics Engineer", "ETL Developer"],
    "Data Science": ["Data Scientist", "ML Engineer", "Applied Scientist", "Sr. Data Scientist"],
    "Product Management": ["Product Manager", "Sr Product Manager", "Group Product Manager", "PM II"],
    "Design": ["Product Designer", "UX Designer", "UI Designer", "Design Lead"],
    "Product Design": ["Product Designer", "Sr Product Designer"],
    "QA": ["QA Engineer", "SDET", "QA Analyst", "Test Lead"],
    "Site Reliability": ["SRE", "Site Reliability Engineer", "Platform Engineer", "DevOps Engineer"],
    "Security": ["Security Engineer", "AppSec Engineer", "Security Analyst"],
    "Program Management": ["Program Manager", "Technical Program Manager", "Delivery Manager"],
    "Engineering Management": ["Engineering Manager", "Sr Engineering Manager", "Director of Engineering"],
    "Marketing": ["Marketing Manager", "Content Strategist", "Growth Marketer", "Brand Manager"],
    "Sales": ["Account Executive", "Sales Development Rep", "Sales Manager", "Solutions Engineer"],
    "Customer Success": ["Customer Success Manager", "Support Engineer", "Onboarding Specialist"],
    "Finance": ["Financial Analyst", "FP&A Manager", "Controller", "Accountant"],
    "People Ops": ["Recruiter", "HR Business Partner", "People Ops Manager", "Talent Coordinator"],
    "IT": ["IT Support Specialist", "Systems Administrator", "IT Manager"],
    "Research": ["Research Scientist", "Sr Research Scientist"],
    "Analytics": ["Business Analyst", "Data Analyst", "Analytics Manager", "BI Developer"],
    "UX Research": ["UX Researcher", "Sr UX Researcher", "Research Ops"],
}

LOCATIONS = [
    ("San Francisco", "USA", "America/Los_Angeles", "PST"),
    ("New York", "USA", "America/New_York", "EST"),
    ("Austin", "USA", "America/Chicago", "CST"),
    ("Chicago", "USA", "America/Chicago", "Central"),
    ("Denver", "USA", "America/Denver", "MST"),
    ("London", "UK", "Europe/London", "GMT"),
    ("Berlin", "Germany", "Europe/Berlin", "CET"),
    ("Dublin", "Ireland", "Europe/Dublin", "GMT"),
    ("Bengaluru", "India", "Asia/Kolkata", "IST"),
    ("Hyderabad", "India", "Asia/Kolkata", "+05:30"),
    ("Singapore", "Singapore", "Asia/Singapore", "SGT"),
    ("Sydney", "Australia", "Australia/Sydney", "AEST"),
    ("Toronto", "Canada", "America/Toronto", "Eastern"),
    ("Sao Paulo", "Brazil", "America/Sao_Paulo", "BRT"),
    ("Warsaw", "Poland", "Europe/Warsaw", "CET"),
    ("Remote", "", "", ""),
]

STREAM_NAMES = "Checkout Payments Growth Platform Mobile Identity Data Core Marketplace Onboarding Billing Search Notifications Fulfillment Pricing Catalog Trust Infrastructure Partner Insights".split()
TEAM_WORDS = "Falcon Otter Nimbus Comet Pixel Quantum Harbor Ranger Summit Delta Ember Cobalt Lumen Vertex Aurora Cedar Maple Basil Sage Onyx Flux Nova Atlas Orbit Pulse Drift Echo Vault Prism Forge".split()


def rng_for(name):
    return random.Random(hash(name) & 0xFFFFFFFF)


def people_names(r, n):
    seen = set()
    out = []
    while len(out) < n:
        nm = f"{r.choice(FIRST)} {r.choice(LAST)}"
        if nm in seen:
            # keep a few real duplicates on purpose later; here just retry mostly
            if r.random() > 0.03:
                continue
        seen.add(nm)
        out.append(nm)
    return out


# ----------------------------------------------------------------------------
# core model: build a clean org in memory, then optionally mess it up / reshape
# ----------------------------------------------------------------------------
def build_org(spec):
    r = rng_for(spec["id"])
    n = spec["headcount"]

    # ---- hierarchy: groups (streams) -> teams --------------------------------
    if n <= 15:
        n_streams, team_per = 1, r.randint(1, 2)
    elif n <= 80:
        n_streams, team_per = r.randint(1, 2), r.randint(2, 4)
    elif n <= 400:
        n_streams, team_per = r.randint(3, 5), r.randint(3, 5)
    elif n <= 2500:
        n_streams, team_per = r.randint(6, 10), r.randint(4, 7)
    else:
        n_streams, team_per = r.randint(12, 20), r.randint(5, 9)

    streams = r.sample(STREAM_NAMES, min(n_streams, len(STREAM_NAMES)))
    teams = []  # dict(name, parent, kind)
    used_team = set()
    for s in streams:
        k = r.randint(max(1, team_per - 1), team_per + 1)
        for _ in range(k):
            w = r.choice(TEAM_WORDS)
            tn = f"Team {w}" if r.random() < 0.5 else f"{s} {w}"
            while tn in used_team:
                w = r.choice(TEAM_WORDS)
                tn = f"{s} {w} {r.randint(2,9)}"
            used_team.add(tn)
            teams.append({"name": tn, "parent": s, "kind": "team"})
    for s in streams:
        teams.append({"name": s, "parent": "", "kind": "group"})

    leaf_teams = [t for t in teams if t["kind"] == "team"]
    if not leaf_teams:
        leaf_teams = [{"name": "Team One", "parent": "", "kind": "team"}]
        teams = leaf_teams[:]

    # ---- people -----------------------------------------------------------
    names = people_names(r, n)
    people = []
    for i, nm in enumerate(names):
        disc = r.choice(DISCIPLINES)
        title = r.choice(TITLES[disc])
        loc = r.choice(LOCATIONS)
        people.append({
            "name": nm,
            "title": title,
            "discipline": disc,
            "location": loc[0] + (f", {loc[1]}" if loc[1] else ""),
            "country": loc[1],
            "timezone": loc[2],
            "tz_abbr": loc[3],
            "employment": "fte",
            "vendor": "",
            "start": f"{r.randint(2014, 2025)}-{r.randint(1,12):02d}-{r.randint(1,28):02d}",
            "cost": r.choice([9, 11, 13, 15, 18, 22, 26, 30]) * 1000,
            "team": r.choice(leaf_teams)["name"],
            "manager": "",
            "alloc": 100,
        })

    # managers: one lead per leaf team, leads report up a chain
    by_team = {}
    for p in people:
        by_team.setdefault(p["team"], []).append(p)
    leads = {}
    for tname, members in by_team.items():
        lead = r.choice(members)
        lead["title"] = r.choice(["Engineering Manager", "Team Lead", "Delivery Manager"])
        lead["discipline"] = "Engineering Management"
        leads[tname] = lead["name"]
        for m in members:
            if m is not lead:
                m["manager"] = lead["name"]
    # leads report to a handful of "directors"
    lead_people = [p for p in people if p["name"] in leads.values()]
    directors = lead_people[: max(1, len(lead_people) // 6)] or lead_people[:1]
    for lp in lead_people:
        if lp not in directors:
            lp["manager"] = r.choice(directors)["name"]
    for d in directors[1:]:
        d["manager"] = directors[0]["name"]
    directors[0]["manager"] = ""
    directors[0]["title"] = "VP Engineering"

    # ---- contractor pattern ---------------------------------------------
    cp = spec["contractors"]
    ext_teams = []
    if cp == "none":
        pass
    elif cp == "one":
        p = r.choice([x for x in people if x["manager"]])
        p["employment"] = "contractor"
        p["vendor"] = r.choice(VENDORS)
        p["cost"] = r.choice([16, 18, 20, 24]) * 1000
    elif cp == "embedded":
        k = max(2, int(n * r.uniform(0.08, 0.2)))
        for p in r.sample(people, min(k, len(people))):
            if not p["manager"]:
                continue
            p["employment"] = r.choice(["contractor", "contractor", "vendor"])
            p["vendor"] = r.choice(VENDORS)
    elif cp == "segregated":
        v = r.choice(VENDORS)
        pod = {"name": f"{v} Pod", "parent": r.choice(streams) if streams else "", "kind": "team"}
        teams.append(pod)
        ext_teams.append(pod["name"])
        k = max(3, int(n * r.uniform(0.1, 0.25)))
        for p in r.sample(people, min(k, len(people))):
            p["team"] = pod["name"]
            p["employment"] = "contractor"
            p["vendor"] = v
            p["manager"] = ""
        # a vendor lead
        vl = r.choice([p for p in people if p["team"] == pod["name"]])
        vl["title"] = "Vendor Delivery Lead"
    elif cp == "offshore":
        v = r.choice(VENDORS)
        off_stream = f"{v} ({r.choice(['Bengaluru','Hyderabad','Pune','Manila'])})"
        teams.append({"name": off_stream, "parent": "", "kind": "group"})
        ext_teams.append(off_stream)
        k = max(5, int(n * r.uniform(0.25, 0.45)))
        offshore_people = r.sample(people, min(k, len(people)))
        sub = []
        for j in range(max(1, k // 12)):
            tn = f"{v} Squad {j+1}"
            teams.append({"name": tn, "parent": off_stream, "kind": "team"})
            ext_teams.append(tn)
            sub.append(tn)
        for p in offshore_people:
            p["team"] = r.choice(sub)
            p["employment"] = "vendor"
            p["vendor"] = v
            p["timezone"] = "Asia/Kolkata"
            p["tz_abbr"] = "IST"
            p["location"] = "Bengaluru, India"
            p["country"] = "India"
    elif cp == "mixed":
        # staff aug (contractor, embedded) + one SOW pod (vendor)
        v1, v2 = r.sample(VENDORS, 2)
        for p in r.sample(people, max(2, int(n * 0.08))):
            if p["manager"]:
                p["employment"] = "contractor"
                p["vendor"] = v1
        pod = {"name": f"{v2} SOW", "parent": r.choice(streams) if streams else "", "kind": "team"}
        teams.append(pod)
        ext_teams.append(pod["name"])
        for p in r.sample(people, max(3, int(n * 0.1))):
            p["team"] = pod["name"]
            p["employment"] = "vendor"
            p["vendor"] = v2
            p["manager"] = ""

    # ---- some people split across two teams (assignments < 100) ----------
    extra_assignments = []
    if spec["shape"] == "wizard" and n >= 30:
        for p in r.sample(people, max(1, int(n * r.uniform(0.03, 0.12)))):
            p["alloc"] = r.choice([50, 60, 70, 80])
            other = r.choice(leaf_teams)["name"]
            if other != p["team"]:
                extra_assignments.append({
                    "person": p["name"], "team": other,
                    "role": "", "alloc": 100 - p["alloc"], "open": ""
                })
    # a few open roles
    open_roles = []
    if n >= 20:
        for _ in range(max(1, int(n * 0.02))):
            open_roles.append({
                "person": "", "team": r.choice(leaf_teams)["name"],
                "role": r.choice(sum(TITLES.values(), [])), "alloc": 100, "open": "yes"
            })

    return {
        "spec": spec, "r": r, "people": people, "teams": teams,
        "leaf_teams": leaf_teams, "streams": streams,
        "extra_assignments": extra_assignments, "open_roles": open_roles,
        "ext_teams": ext_teams,
    }


# ----------------------------------------------------------------------------
# messiness
# ----------------------------------------------------------------------------
EMP_DIRTY = {
    "fte": ["Full-Time", "FTE", "Perm", "Permanent", "Employee", "Regular", "Staff", "FT", "Badge"],
    "contractor": ["Contractor", "Contract", "Contingent Worker", "T&M", "Consultant", "C2C",
                   "Freelance", "CW", "Temp", "Non-Employee"],
    "vendor": ["Vendor", "Supplier", "Managed Service", "Offshore", "Outsourced", "3rd Party",
               "Partner", "MSP"],
}


def messify_person_value(r, p, field):
    """Return a dirtied string for a person field, per messy org."""
    if field == "employment":
        base = r.choice(EMP_DIRTY[p["employment"]])
        if p["vendor"] and r.random() < 0.4:
            return f"{base} ({p['vendor']})"
        return base
    if field == "timezone":
        return r.choice([p["timezone"], p["tz_abbr"], p["tz_abbr"],
                         p["timezone"].split("/")[-1].replace("_", " ") if "/" in p["timezone"] else p["tz_abbr"]])
    if field == "start":
        y, m, d = p["start"].split("-")
        return r.choice([
            p["start"], f"{int(m)}/{int(d)}/{y}", f"{d}-{['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][int(m)]}-{y}",
            y, f"Q{(int(m)-1)//3+1} {y}", "",
        ])
    if field == "name":
        nm = p["name"]
        roll = r.random()
        if roll < 0.15:
            f, l = nm.split(" ", 1)
            return f"{l.upper()}, {f}"
        if roll < 0.25:
            return f"  {nm} "
        if roll < 0.3:
            return nm.upper()
        return nm
    return ""


def apply_messiness(org):
    """Mutate people/teams in place to reflect a messy export, and return notes."""
    r = org["r"]
    people = org["people"]
    notes = []

    # orphan manager refs
    if r.random() < 0.6:
        victims = r.sample([p for p in people if p["manager"]], k=max(1, len(people) // 40))
        for p in victims:
            p["manager"] = f"{r.choice(FIRST)} {r.choice(LAST)}"
        notes.append(f"{len(victims)} manager reference(s) point to people not in the file")

    # missing disciplines / titles
    if r.random() < 0.7:
        for p in r.sample(people, k=max(1, int(len(people) * r.uniform(0.05, 0.3)))):
            if r.random() < 0.5:
                p["discipline"] = ""
            else:
                p["title"] = r.choice(["", "TBD", "N/A", "-", "Team Member"])
        notes.append("some rows missing discipline and/or title")

    # missing / junk timezones & locations
    if r.random() < 0.6:
        for p in r.sample(people, k=max(1, int(len(people) * 0.15))):
            p["timezone"] = r.choice(["", "-", "N/A", "GMT+5:30", "UTC", "flexible"])
        notes.append("junk / blank timezone values (GMT+5:30, 'flexible', blank)")

    # dirty employment vocab
    org["dirty_employment"] = True
    notes.append("employment column uses free-text vocab (Perm, T&M, Contingent Worker, 'Contractor (Infosys)')")

    # duplicate a couple of people (same name, different row)
    if r.random() < 0.4 and len(people) > 5:
        dup = r.choice(people)
        clone = dict(dup)
        clone["team"] = r.choice(org["leaf_teams"])["name"]
        people.append(clone)
        notes.append(f"duplicate person row: '{dup['name']}' appears twice")

    # blank rows + totals row + note row (added at write time)
    org["junk_rows"] = True
    notes.append("blank spacer rows, a 'Total' row, and a free-text note row in the sheet")

    # orphan team parent
    if r.random() < 0.5 and org["teams"]:
        t = r.choice([t for t in org["teams"] if t["kind"] == "team"])
        t["parent"] = "Innovation Office"
        notes.append(f"team '{t['name']}' references a parent ('Innovation Office') that isn't defined")

    # an empty team
    if r.random() < 0.5:
        org["teams"].append({"name": "Special Projects", "parent": "", "kind": "team"})
        notes.append("team 'Special Projects' has no members")

    # inconsistent team 'kind' vocab
    org["dirty_kind"] = True
    notes.append("team kind column mixes Squad / Tribe / Chapter / Dept / Group")

    # over-allocation for a few
    if r.random() < 0.4:
        for p in r.sample(people, k=max(1, len(people) // 50)):
            p["alloc"] = 100
            org["extra_assignments"].append({
                "person": p["name"], "team": r.choice(org["leaf_teams"])["name"],
                "role": "", "alloc": 60, "open": ""
            })
        notes.append("a few people allocated >100% across teams")

    # dirty names
    org["dirty_names"] = True
    notes.append("names in mixed formats ('SMITH, Jane', ALL CAPS, padded whitespace)")

    return notes


# ----------------------------------------------------------------------------
# header sets (clean vs messy) — wizard aliases still need to *mostly* catch messy
# ----------------------------------------------------------------------------
CLEAN_HEADERS_PEOPLE = ["Name", "Title", "Discipline", "Manager", "Employment", "Location",
                        "Timezone", "Start Date", "Cost/Month"]
MESSY_HEADERS_PEOPLE = ["Employee Name", "Job Title", "Job Family", "Reports To", "Worker Type",
                        "Office", "Time Zone", "Hire Date", "Annual Cost"]

CLEAN_HEADERS_TEAMS = ["Name", "Kind", "Parent", "Lead", "External?", "Vendor"]
MESSY_HEADERS_TEAMS = ["Team", "Level", "Parent Team", "Team Lead", "Is External", "Supplier"]

KIND_DIRTY = ["Squad", "Tribe", "Chapter", "Dept", "Group", "team", "Pod"]


def kind_value(org, kind):
    if org.get("dirty_kind") and org["r"].random() < 0.8:
        if kind == "group":
            return org["r"].choice(["Tribe", "Dept", "Group", "Division"])
        return org["r"].choice(["Squad", "Chapter", "Pod", "team"])
    return kind


def emp_value(org, p):
    if org.get("dirty_employment"):
        return messify_person_value(org["r"], p, "employment")
    return {"fte": "FTE", "contractor": "Contractor", "vendor": "Vendor"}[p["employment"]]


def name_value(org, p):
    if org.get("dirty_names"):
        return messify_person_value(org["r"], p, "name")
    return p["name"]


def tz_value(org, p):
    if org["spec"]["tidy"] == "messy":
        return messify_person_value(org["r"], p, "timezone")
    return p["timezone"]


def start_value(org, p):
    if org["spec"]["tidy"] == "messy":
        return messify_person_value(org["r"], p, "start")
    return p["start"]


# ----------------------------------------------------------------------------
# writers
# ----------------------------------------------------------------------------
def _add_junk_rows(ws, org, ncols):
    if not org.get("junk_rows"):
        return
    ws.append([""] * ncols)
    note = ["Note: headcount reconciled to HRIS as of 2026-06-30. Contractors excluded from FTE total."]
    ws.append(note + [""] * (ncols - 1))
    ws.append([""] * ncols)
    total = ["Total"] + [""] * (ncols - 1)
    if ncols >= 2:
        total[-1] = len(org["people"])
    ws.append(total)


def write_wizard(path, org):
    wb = Workbook()
    messy = org["spec"]["tidy"] == "messy"
    ph = MESSY_HEADERS_PEOPLE if messy else CLEAN_HEADERS_PEOPLE
    th = MESSY_HEADERS_TEAMS if messy else CLEAN_HEADERS_TEAMS

    ws = wb.active
    ws.title = "People"
    ws.append(ph)
    people = list(org["people"])
    if org.get("junk_rows"):
        org["r"].shuffle(people)
    for i, p in enumerate(people):
        row = [
            name_value(org, p), p["title"],
            p["discipline"], p["manager"], emp_value(org, p),
            p["location"], tz_value(org, p), start_value(org, p), p["cost"],
        ]
        ws.append(row)
        if org.get("junk_rows") and org["r"].random() < 0.02:
            ws.append([""] * len(ph))
    _add_junk_rows(ws, org, len(ph))

    ws2 = wb.create_sheet("Teams")
    ws2.append(th)
    for t in org["teams"]:
        lead = ""
        # find a lead name
        members = [p for p in org["people"] if p["team"] == t["name"]]
        if members:
            lead = members[0]["name"]
        is_ext = "yes" if t["name"] in org["ext_teams"] else ""
        vendor = ""
        if is_ext:
            vm = [p["vendor"] for p in members if p["vendor"]]
            vendor = vm[0] if vm else org["r"].choice(VENDORS)
        ws2.append([t["name"], kind_value(org, t["kind"]), t["parent"], lead, is_ext, vendor])

    ws3 = wb.create_sheet("Assignments")
    ws3.append(["Person", "Team", "Role", "Allocation %", "Open Role?"])
    for p in org["people"]:
        pct = p["alloc"]
        if messy and org["r"].random() < 0.3:
            pct = org["r"].choice([f"{p['alloc']}%", str(p["alloc"] / 100), p["alloc"]])
        ws3.append([p["name"], p["team"], p["title"], pct, ""])
    for a in org["extra_assignments"]:
        ws3.append([a["person"], a["team"], a["role"], a["alloc"], a["open"]])
    for o in org["open_roles"]:
        ws3.append([o["person"], o["team"], o["role"], o["alloc"], o["open"]])

    wb.save(path)


def write_flat(path, org, cols=None):
    """Single-sheet HRIS dump: one row per person, hierarchy in columns."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Roster" if org["spec"]["tidy"] == "clean" else org["r"].choice(
        ["Sheet1", "Export", "Headcount", "ActiveEmployees"])
    messy = org["spec"]["tidy"] == "messy"

    if messy:
        headers = ["Emp ID", "Employee Name", "Job Title", "Job Family", "Department",
                   "Team", "Reports To", "Worker Type", "Supplier", "Location", "Country",
                   "Time Zone", "Hire Date", "Annual Cost"]
    else:
        headers = ["Employee ID", "Name", "Title", "Discipline", "Value Stream", "Team",
                   "Manager", "Employment", "Vendor", "Location", "Country", "Timezone",
                   "Start Date", "Cost/Month"]
    ws.append(headers)

    stream_of = {}
    for t in org["teams"]:
        if t["kind"] == "team":
            stream_of[t["name"]] = t["parent"]

    people = list(org["people"])
    if messy:
        org["r"].shuffle(people)
    for i, p in enumerate(people):
        eid = f"E{10000 + i}" if not messy else org["r"].choice([f"{10000+i}", f"E-{10000+i}", ""])
        ws.append([
            eid, name_value(org, p), p["title"],
            p["discipline"], stream_of.get(p["team"], ""), p["team"],
            p["manager"], emp_value(org, p), p["vendor"],
            p["location"], p["country"], tz_value(org, p),
            start_value(org, p), p["cost"],
        ])
        if org.get("junk_rows") and org["r"].random() < 0.015:
            ws.append([""] * len(headers))
    _add_junk_rows(ws, org, len(headers))
    wb.save(path)


def write_multifile(folder, org):
    """Split across files the way real customers hand it over."""
    r = org["r"]
    style = org["spec"].get("multi_style", "roster_orgchart")
    files = []

    if style == "roster_orgchart":
        # file 1: people roster (flat). file 2: org chart (teams + parents + leads)
        p1 = folder / "01_people_roster.xlsx"
        wb = Workbook(); ws = wb.active; ws.title = "People"
        ws.append(["Name", "Title", "Discipline", "Manager", "Employment", "Vendor",
                   "Location", "Timezone", "Start Date", "Cost/Month", "Team"])
        for p in org["people"]:
            ws.append([name_value(org, p), p["title"], p["discipline"], p["manager"],
                       emp_value(org, p), p["vendor"], p["location"], tz_value(org, p),
                       start_value(org, p), p["cost"], p["team"]])
        wb.save(p1); files.append(p1.name)

        p2 = folder / "02_org_structure.xlsx"
        wb = Workbook(); ws = wb.active; ws.title = "Teams"
        ws.append(["Name", "Kind", "Parent", "Lead", "External?", "Vendor"])
        for t in org["teams"]:
            members = [p for p in org["people"] if p["team"] == t["name"]]
            lead = members[0]["name"] if members else ""
            is_ext = "yes" if t["name"] in org["ext_teams"] else ""
            ws.append([t["name"], kind_value(org, t["kind"]), t["parent"], lead, is_ext,
                       (members[0]["vendor"] if members and members[0]["vendor"] else "")])
        wb.save(p2); files.append(p2.name)

    elif style == "per_department":
        # one file per stream, each with its own People sheet; no teams file at all
        for s in (org["streams"] or ["Org"]):
            sp = [p for p in org["people"]
                  if org.get("_stream_of", {}).get(p["team"]) == s
                  or any(t["name"] == p["team"] and t["parent"] == s for t in org["teams"])]
            if not sp:
                continue
            fn = folder / f"{s.replace(' ', '_')}.xlsx"
            wb = Workbook(); ws = wb.active; ws.title = "People"
            ws.append(["Name", "Title", "Team", "Manager", "Employment", "Location", "Timezone"])
            for p in sp:
                ws.append([name_value(org, p), p["title"], p["team"], p["manager"],
                           emp_value(org, p), p["location"], tz_value(org, p)])
            wb.save(fn); files.append(fn.name)
        # people with no matched stream -> a leftovers file
        matched = set()
        for t in org["teams"]:
            if t["parent"] in (org["streams"] or []):
                pass
        # crude leftovers
        leftovers = [p for p in org["people"]
                     if not any(t["name"] == p["team"] and t["parent"] in (org["streams"] or [])
                                for t in org["teams"])]
        if leftovers:
            fn = folder / "_unassigned.xlsx"
            wb = Workbook(); ws = wb.active; ws.title = "People"
            ws.append(["Name", "Title", "Team", "Manager", "Employment"])
            for p in leftovers:
                ws.append([name_value(org, p), p["title"], p["team"], p["manager"], emp_value(org, p)])
            wb.save(fn); files.append(fn.name)

    elif style == "roster_plus_contractors":
        # FTEs in one file, contractors in a totally separate one (common!)
        fte = [p for p in org["people"] if p["employment"] == "fte"]
        ext = [p for p in org["people"] if p["employment"] != "fte"]
        f1 = folder / "employees.xlsx"
        wb = Workbook(); ws = wb.active; ws.title = "Employees"
        ws.append(["Name", "Title", "Discipline", "Manager", "Team", "Location", "Timezone", "Start Date"])
        for p in fte:
            ws.append([name_value(org, p), p["title"], p["discipline"], p["manager"], p["team"],
                       p["location"], tz_value(org, p), start_value(org, p)])
        wb.save(f1); files.append(f1.name)

        f2 = folder / "contractors_and_vendors.xlsx"
        wb = Workbook(); ws = wb.active; ws.title = "Contractors"
        ws.append(["Contractor Name", "Role", "Agency", "Assigned Team", "Bill Rate (monthly)", "Location", "Onboarded"])
        for p in ext:
            ws.append([name_value(org, p), p["title"], p["vendor"] or org["r"].choice(VENDORS),
                       p["team"], p["cost"], p["location"], start_value(org, p)])
        if not ext:
            ws.append(["(none on file)", "", "", "", "", "", ""])
        wb.save(f2); files.append(f2.name)

    return files


# ----------------------------------------------------------------------------
# the 50-org plan
# ----------------------------------------------------------------------------
SIZE_TIERS = {
    "tiny":   (8, 14),
    "small":  (35, 80),
    "medium": (180, 420),
    "large":  (1200, 2200),
    "huge":   (9000, 10000),
}

CONTRACTOR_PATTERNS = ["none", "one", "embedded", "segregated", "offshore", "mixed"]


def make_specs():
    specs = []
    combos = []
    # deliberate spread across the axes
    plan = [
        # (size, tidy, shape, contractors, files)
        ("tiny", "clean", "flat", "none", "single"),
        ("tiny", "clean", "wizard", "one", "single"),
        ("tiny", "messy", "flat", "one", "single"),
        ("tiny", "messy", "flat", "embedded", "single"),
        ("tiny", "clean", "flat", "none", "single"),

        ("small", "clean", "wizard", "none", "single"),
        ("small", "clean", "flat", "embedded", "single"),
        ("small", "messy", "flat", "embedded", "single"),
        ("small", "messy", "wizard", "segregated", "single"),
        ("small", "clean", "flat", "one", "multi:roster_plus_contractors"),
        ("small", "messy", "flat", "mixed", "multi:roster_orgchart"),
        ("small", "clean", "wizard", "segregated", "single"),
        ("small", "messy", "flat", "none", "single"),
        ("small", "clean", "flat", "offshore", "single"),

        ("medium", "clean", "wizard", "none", "single"),
        ("medium", "clean", "flat", "embedded", "single"),
        ("medium", "messy", "flat", "embedded", "single"),
        ("medium", "messy", "flat", "segregated", "single"),
        ("medium", "clean", "flat", "offshore", "single"),
        ("medium", "messy", "wizard", "offshore", "single"),
        ("medium", "clean", "flat", "mixed", "multi:roster_orgchart"),
        ("medium", "messy", "flat", "mixed", "multi:roster_plus_contractors"),
        ("medium", "clean", "wizard", "segregated", "single"),
        ("medium", "messy", "flat", "none", "multi:per_department"),
        ("medium", "clean", "flat", "embedded", "multi:per_department"),
        ("medium", "messy", "flat", "one", "single"),
        ("medium", "clean", "wizard", "embedded", "single"),
        ("medium", "messy", "flat", "offshore", "multi:roster_plus_contractors"),

        ("large", "clean", "flat", "none", "single"),
        ("large", "clean", "flat", "embedded", "single"),
        ("large", "messy", "flat", "embedded", "single"),
        ("large", "messy", "flat", "segregated", "single"),
        ("large", "clean", "flat", "offshore", "single"),
        ("large", "messy", "flat", "offshore", "single"),
        ("large", "clean", "wizard", "mixed", "single"),
        ("large", "messy", "flat", "mixed", "multi:roster_orgchart"),
        ("large", "clean", "flat", "embedded", "multi:per_department"),
        ("large", "messy", "flat", "mixed", "multi:roster_plus_contractors"),
        ("large", "clean", "flat", "segregated", "single"),
        ("large", "messy", "wizard", "none", "single"),

        ("huge", "clean", "flat", "none", "single"),
        ("huge", "clean", "flat", "embedded", "single"),
        ("huge", "messy", "flat", "embedded", "single"),
        ("huge", "clean", "flat", "offshore", "single"),
        ("huge", "messy", "flat", "offshore", "single"),
        ("huge", "messy", "flat", "mixed", "multi:roster_orgchart"),
        ("huge", "clean", "flat", "segregated", "single"),
        ("huge", "messy", "flat", "mixed", "single"),
        ("huge", "clean", "flat", "embedded", "multi:per_department"),
        ("huge", "messy", "flat", "segregated", "multi:roster_plus_contractors"),
    ]
    used_orgnames = set()
    rr = random.Random(42)
    for idx, (size, tidy, shape, contractors, files) in enumerate(plan, 1):
        lo, hi = SIZE_TIERS[size]
        hc = rr.randint(lo, hi)
        while True:
            nm = f"{rr.choice(ORG_ADJ)} {rr.choice(ORG_NOUN)}{rr.choice(ORG_SUFFIX)}"
            if nm not in used_orgnames:
                used_orgnames.add(nm); break
        slug = f"{idx:02d}-{size}-{tidy}-{contractors}"
        multi_style = files.split(":", 1)[1] if files.startswith("multi") else None
        specs.append({
            "id": slug,
            "index": idx,
            "org_name": nm,
            "size_tier": size,
            "headcount": hc,
            "tidy": tidy,
            "shape": shape,
            "contractors": contractors,
            "files": "multi" if files.startswith("multi") else "single",
            "multi_style": multi_style,
        })
    return specs


CONTRACTOR_DESC = {
    "none": "no contractors — all FTE",
    "one": "exactly one lone contractor buried in a team",
    "embedded": "contractors/vendor staff embedded across many teams alongside FTEs",
    "segregated": "contractors fenced into a single vendor pod under one stream",
    "offshore": "a whole offshore delivery org (own group + squads), mostly vendor, IST",
    "mixed": "both — staff-aug contractors embedded + a separate SOW/vendor pod",
}
SHAPE_DESC = {
    "flat": "single flat HRIS-style dump (one row per person, hierarchy in columns, no Assignments)",
    "wizard": "wizard-native workbook with People / Teams / Assignments sheets",
}
MULTI_DESC = {
    "roster_orgchart": "2 files: people roster + separate org-structure workbook",
    "per_department": "one file per value stream, no teams file, plus an _unassigned leftovers file",
    "roster_plus_contractors": "2 files: employees in one, contractors/vendors in a totally separate one with different columns",
}


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    specs = make_specs()
    manifest = []

    for spec in specs:
        org = build_org(spec)
        notes = []
        if spec["tidy"] == "messy":
            notes = apply_messiness(org)

        folder = OUT / spec["id"]
        folder.mkdir()
        files = []

        if spec["files"] == "multi":
            files = write_multifile(folder, org)
        elif spec["shape"] == "wizard":
            fn = folder / f"{spec['org_name'].replace(' ', '_').replace(',', '')}.xlsx"
            write_wizard(fn, org)
            files = [fn.name]
        else:
            fn = folder / f"{spec['org_name'].replace(' ', '_').replace(',', '')}.xlsx"
            write_flat(fn, org)
            files = [fn.name]

        edge = list(notes)
        if spec["contractors"] != "none":
            edge.append(f"contractor pattern: {CONTRACTOR_DESC[spec['contractors']]}")
        if spec["shape"] == "flat":
            edge.append("no Assignments sheet — importer must infer 100% single-team membership")
            edge.append("no explicit Teams sheet — teams (and parent groups) exist only as columns")
        if spec["files"] == "multi":
            edge.append(f"multi-file handover ({MULTI_DESC[spec['multi_style']]}) — cross-file name resolution not built yet")
        if spec["size_tier"] in ("large", "huge"):
            edge.append(f"scale: {org['people'].__len__()} people / {len(org['teams'])} teams — import + layout perf")

        manifest.append({
            "id": spec["id"],
            "org_name": spec["org_name"],
            "folder": spec["id"],
            "files": files,
            "size_tier": spec["size_tier"],
            "headcount_people_rows": len(org["people"]),
            "teams": len(org["teams"]),
            "tidiness": spec["tidy"],
            "shape": SHAPE_DESC[spec["shape"]],
            "layout": "single file" if spec["files"] == "single" else MULTI_DESC[spec["multi_style"]],
            "contractors": CONTRACTOR_DESC[spec["contractors"]],
            "edge_cases": edge,
        })
        print(f"  {spec['id']:32s} {len(org['people']):>6} ppl  {len(files)} file(s)")

    (OUT / "MANIFEST.json").write_text(json.dumps(manifest, indent=2))

    # README
    lines = ["# Synthetic org-import test corpus", "",
             f"{len(manifest)} fake orgs for exercising the Zenhance importer. Generated by `gen_orgs.py` (seeded, reproducible).",
             "",
             "## Axes covered", "",
             "| Axis | Values |", "|---|---|",
             "| Size | tiny (~10) · small (~60) · medium (~300) · large (~1.8k) · huge (~10k) |",
             "| Tidiness | clean · messy (bad headers, mixed vocab, junk rows, orphan refs, dup rows, bad dates) |",
             "| Shape | flat HRIS dump (1 sheet) · wizard-native (People/Teams/Assignments) |",
             "| Contractors | none · one lone · embedded · segregated vendor pod · full offshore org · mixed staff-aug+SOW |",
             "| Files | single .xlsx · multi-file (roster+orgchart · per-department · employees+contractors split) |",
             "", "## Orgs", ""]
    for m in manifest:
        lines.append(f"### {m['id']} — {m['org_name']}")
        lines.append("")
        lines.append(f"- **{m['size_tier']}**, {m['headcount_people_rows']} people rows, {m['teams']} teams — {m['tidiness']}")
        lines.append(f"- Shape: {m['shape']}")
        lines.append(f"- Layout: {m['layout']}")
        lines.append(f"- Files: {', '.join(m['files'])}")
        lines.append(f"- Contractors: {m['contractors']}")
        lines.append("- Edge cases:")
        for e in m["edge_cases"]:
            lines.append(f"  - {e}")
        lines.append("")
    (OUT / "README.md").write_text("\n".join(lines))
    print(f"\nWrote {len(manifest)} orgs to {OUT}")
    print(f"  {OUT}/MANIFEST.json  {OUT}/README.md")


if __name__ == "__main__":
    main()
