/**
 * Mock org for the v2 canvas lab. Per docs/LAB.md a lab uses hardcoded data
 * only — this is a flattened, client-safe copy of the canonical demo org in
 * `lib/data/demoOrg.ts` (which imports Drizzle and must not reach the client).
 *
 * The shape is the point: a flat node list carrying its own `x`/`y`, with
 * relationships as ids. That is what free-form placement needs and what the
 * radial layout cannot express. Positions below are a one-time deterministic
 * seed (trains anchored, squads ringed around a train, people ringed around
 * their home squad); in the real v2 they become persisted per-workspace data
 * and dragging is authoritative.
 *
 * A person's "home" is their majority seat (>=60%). Anyone whose biggest slice
 * is smaller is a genuine cross-cutting supporter and clusters in `Cross-cutting`
 * — the shared-resource story that is Zenhance's actual differentiator.
 */

/** One rung of the semantic-zoom ladder resolves to one of these. */
export type NodeKind = "squad" | "person";

export type Allocation = { unit: string; role: string; pct: number };

export type SquadNode = {
  id: string;
  kind: "squad";
  name: string;
  x: number;
  y: number;
  train: string;
  lead: string | null;
  targetHeadcount: number | null;
  roi: number | null;
  openRoles: number;
  isExternal: boolean;
  vendorName: string | null;
  isCrossCutting?: boolean;
};

export type PersonNode = {
  id: string;
  kind: "person";
  name: string;
  x: number;
  y: number;
  title: string;
  /** Squad id this person sits in on the map. */
  homeId: string;
  costPerMonth: number;
  /** Formal reporting line — the `reports_to` layer. */
  managerId: string | null;
  lastVacationAt: string | null;
  startDate: string | null;
  skills: string[];
  /** Delivery layer — one edge per team this person actually works on. */
  allocations: Allocation[];
};

export type MapNode = SquadNode | PersonNode;

export type Train = {
  id: string;
  name: string;
  roi: number | null;
  anchor: { x: number; y: number } | null;
};

export const trains: Train[] = [
  {
    "id": "atlas",
    "name": "Atlas",
    "roi": 11000000,
    "anchor": {
      "x": 640,
      "y": 620
    }
  },
  {
    "id": "orion",
    "name": "Orion",
    "roi": 9500000,
    "anchor": {
      "x": 1760,
      "y": 620
    }
  },
  {
    "id": "vega",
    "name": "Vega",
    "roi": 6500000,
    "anchor": {
      "x": 1200,
      "y": 1500
    }
  },
  {
    "id": "infosys-contractors",
    "name": "Infosys Contractors",
    "roi": null,
    "anchor": {
      "x": 2320,
      "y": 1500
    }
  },
  {
    "id": "cross-cutting",
    "name": "Cross-cutting",
    "roi": null,
    "anchor": {
      "x": 1200,
      "y": -120
    }
  }
];

export const seedNodes: MapNode[] = [
  {
    "id": "starlight",
    "kind": "squad",
    "name": "Starlight",
    "x": 640,
    "y": 240,
    "train": "Atlas",
    "lead": "Thomas Le",
    "targetHeadcount": 6,
    "roi": 4200000,
    "openRoles": 1,
    "isExternal": false,
    "vendorName": null
  },
  {
    "id": "moonlight",
    "kind": "squad",
    "name": "Moonlight",
    "x": 969,
    "y": 810,
    "train": "Atlas",
    "lead": "Priya Nair",
    "targetHeadcount": 6,
    "roi": 3600000,
    "openRoles": 1,
    "isExternal": false,
    "vendorName": null
  },
  {
    "id": "nebula",
    "kind": "squad",
    "name": "Nebula",
    "x": 311,
    "y": 810,
    "train": "Atlas",
    "lead": "Liam Walsh",
    "targetHeadcount": 5,
    "roi": 3200000,
    "openRoles": 1,
    "isExternal": false,
    "vendorName": null
  },
  {
    "id": "earthlight",
    "kind": "squad",
    "name": "Earthlight",
    "x": 1760,
    "y": 240,
    "train": "Orion",
    "lead": "Lena Ortiz",
    "targetHeadcount": 6,
    "roi": 3500000,
    "openRoles": 1,
    "isExternal": false,
    "vendorName": null
  },
  {
    "id": "dawnbreak",
    "kind": "squad",
    "name": "Dawnbreak",
    "x": 2089,
    "y": 810,
    "train": "Orion",
    "lead": "Hannah Schmidt",
    "targetHeadcount": 5,
    "roi": 3000000,
    "openRoles": 1,
    "isExternal": false,
    "vendorName": null
  },
  {
    "id": "tideway",
    "kind": "squad",
    "name": "Tideway",
    "x": 1431,
    "y": 810,
    "train": "Orion",
    "lead": "Diego Alvarez",
    "targetHeadcount": 5,
    "roi": 2800000,
    "openRoles": 1,
    "isExternal": false,
    "vendorName": null
  },
  {
    "id": "ironclad",
    "kind": "squad",
    "name": "Ironclad",
    "x": 1200,
    "y": 1120,
    "train": "Vega",
    "lead": "Fatima Noor",
    "targetHeadcount": 6,
    "roi": 3400000,
    "openRoles": 1,
    "isExternal": false,
    "vendorName": null
  },
  {
    "id": "lighthouse",
    "kind": "squad",
    "name": "Lighthouse",
    "x": 1529,
    "y": 1690,
    "train": "Vega",
    "lead": "Ravi Kapoor",
    "targetHeadcount": 5,
    "roi": 2600000,
    "openRoles": 1,
    "isExternal": false,
    "vendorName": null
  },
  {
    "id": "infosys-contractors",
    "kind": "squad",
    "name": "Infosys Contractors",
    "x": 2320,
    "y": 1500,
    "train": "Infosys Contractors",
    "lead": null,
    "targetHeadcount": 4,
    "roi": null,
    "openRoles": 2,
    "isExternal": true,
    "vendorName": "Infosys"
  },
  {
    "id": "cross-cutting",
    "kind": "squad",
    "name": "Cross-cutting",
    "x": 1200,
    "y": -120,
    "train": "Cross-cutting",
    "lead": "Sarah Reeve",
    "targetHeadcount": null,
    "roi": null,
    "openRoles": 0,
    "isExternal": false,
    "vendorName": null,
    "isCrossCutting": true
  },
  {
    "id": "angela-smith",
    "kind": "person",
    "name": "Angela Smith",
    "x": 640,
    "y": 72,
    "title": "Engineer",
    "homeId": "starlight",
    "costPerMonth": 9200,
    "managerId": "aimee-bradford",
    "lastVacationAt": "2023-01-05",
    "startDate": "2022-01-10",
    "skills": [
      "Java",
      "JavaScript",
      "CRM"
    ],
    "allocations": [
      {
        "unit": "starlight",
        "role": "Engineer",
        "pct": 60
      },
      {
        "unit": "moonlight",
        "role": "Engineer",
        "pct": 40
      }
    ]
  },
  {
    "id": "areline-de-lisle",
    "kind": "person",
    "name": "Areline De Lisle",
    "x": 800,
    "y": 188,
    "title": "QA Engineer",
    "homeId": "starlight",
    "costPerMonth": 8500,
    "managerId": "thomas-le",
    "lastVacationAt": null,
    "startDate": "2021-09-01",
    "skills": [
      "QA",
      "Automation",
      "Cypress"
    ],
    "allocations": [
      {
        "unit": "starlight",
        "role": "QA",
        "pct": 100
      }
    ]
  },
  {
    "id": "ben-carter",
    "kind": "person",
    "name": "Ben Carter",
    "x": 739,
    "y": 376,
    "title": "Engineer",
    "homeId": "starlight",
    "costPerMonth": 7600,
    "managerId": "sarah-reeve",
    "lastVacationAt": null,
    "startDate": "2024-02-01",
    "skills": [
      "JavaScript",
      "React"
    ],
    "allocations": [
      {
        "unit": "starlight",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "owen-reilly",
    "kind": "person",
    "name": "Owen Reilly",
    "x": 541,
    "y": 376,
    "title": "Engineer",
    "homeId": "starlight",
    "costPerMonth": 8100,
    "managerId": "thomas-le",
    "lastVacationAt": null,
    "startDate": "2023-05-01",
    "skills": [
      "Java",
      "Spring"
    ],
    "allocations": [
      {
        "unit": "starlight",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "thomas-le",
    "kind": "person",
    "name": "Thomas Le",
    "x": 480,
    "y": 188,
    "title": "Senior Engineer",
    "homeId": "starlight",
    "costPerMonth": 10200,
    "managerId": "aimee-bradford",
    "lastVacationAt": null,
    "startDate": "2020-03-01",
    "skills": [
      "Java",
      "Kafka",
      "Microservices"
    ],
    "allocations": [
      {
        "unit": "starlight",
        "role": "Team Lead",
        "pct": 100
      }
    ]
  },
  {
    "id": "devraj-patel",
    "kind": "person",
    "name": "Devraj Patel",
    "x": 1200,
    "y": -350,
    "title": "Security Engineer",
    "homeId": "cross-cutting",
    "costPerMonth": 11800,
    "managerId": "sarah-reeve",
    "lastVacationAt": "2023-02-01",
    "startDate": "2020-08-01",
    "skills": [
      "AppSec",
      "Threat modeling",
      "Compliance"
    ],
    "allocations": [
      {
        "unit": "nebula",
        "role": "Security",
        "pct": 30
      },
      {
        "unit": "earthlight",
        "role": "Security",
        "pct": 30
      },
      {
        "unit": "dawnbreak",
        "role": "Security",
        "pct": 30
      },
      {
        "unit": "ironclad",
        "role": "Security",
        "pct": 30
      }
    ]
  },
  {
    "id": "grace-okafor",
    "kind": "person",
    "name": "Grace Okafor",
    "x": 1419,
    "y": -191,
    "title": "Staff Platform Engineer",
    "homeId": "cross-cutting",
    "costPerMonth": 11600,
    "managerId": "sarah-reeve",
    "lastVacationAt": null,
    "startDate": "2021-01-15",
    "skills": [
      "Go",
      "Kubernetes",
      "CI/CD"
    ],
    "allocations": [
      {
        "unit": "starlight",
        "role": "Platform",
        "pct": 40
      },
      {
        "unit": "nebula",
        "role": "Platform",
        "pct": 40
      }
    ]
  },
  {
    "id": "helena-brandt",
    "kind": "person",
    "name": "Helena Brandt",
    "x": 1335,
    "y": 66,
    "title": "Agile Coach",
    "homeId": "cross-cutting",
    "costPerMonth": 10200,
    "managerId": "sarah-reeve",
    "lastVacationAt": null,
    "startDate": "2019-11-01",
    "skills": [
      "Coaching",
      "SAFe",
      "Facilitation"
    ],
    "allocations": [
      {
        "unit": "tideway",
        "role": "Scrum Master",
        "pct": 50
      },
      {
        "unit": "lighthouse",
        "role": "Scrum Master",
        "pct": 50
      }
    ]
  },
  {
    "id": "marcus-webb",
    "kind": "person",
    "name": "Marcus Webb",
    "x": 1065,
    "y": 66,
    "title": "Staff SRE",
    "homeId": "cross-cutting",
    "costPerMonth": 12200,
    "managerId": "sarah-reeve",
    "lastVacationAt": "2023-06-01",
    "startDate": "2020-03-01",
    "skills": [
      "Kubernetes",
      "Terraform",
      "Observability"
    ],
    "allocations": [
      {
        "unit": "starlight",
        "role": "SRE",
        "pct": 40
      },
      {
        "unit": "moonlight",
        "role": "SRE",
        "pct": 40
      },
      {
        "unit": "nebula",
        "role": "SRE",
        "pct": 40
      }
    ]
  },
  {
    "id": "yuki-tanaka",
    "kind": "person",
    "name": "Yuki Tanaka",
    "x": 981,
    "y": -191,
    "title": "Data / Analytics Engineer",
    "homeId": "cross-cutting",
    "costPerMonth": 10900,
    "managerId": "sarah-reeve",
    "lastVacationAt": null,
    "startDate": "2021-07-01",
    "skills": [
      "SQL",
      "dbt",
      "Python"
    ],
    "allocations": [
      {
        "unit": "moonlight",
        "role": "Data",
        "pct": 35
      },
      {
        "unit": "earthlight",
        "role": "Data",
        "pct": 35
      },
      {
        "unit": "dawnbreak",
        "role": "Data",
        "pct": 35
      }
    ]
  },
  {
    "id": "naomi-cole",
    "kind": "person",
    "name": "Naomi Cole",
    "x": 969,
    "y": 642,
    "title": "QA Engineer",
    "homeId": "moonlight",
    "costPerMonth": 8200,
    "managerId": "priya-nair",
    "lastVacationAt": null,
    "startDate": "2022-10-01",
    "skills": [
      "QA",
      "Selenium"
    ],
    "allocations": [
      {
        "unit": "moonlight",
        "role": "QA",
        "pct": 100
      }
    ]
  },
  {
    "id": "priya-nair",
    "kind": "person",
    "name": "Priya Nair",
    "x": 1137,
    "y": 810,
    "title": "Engineer",
    "homeId": "moonlight",
    "costPerMonth": 9100,
    "managerId": "aimee-bradford",
    "lastVacationAt": null,
    "startDate": "2021-04-01",
    "skills": [
      "Java",
      "Spring",
      "Kafka"
    ],
    "allocations": [
      {
        "unit": "moonlight",
        "role": "Team Lead",
        "pct": 100
      }
    ]
  },
  {
    "id": "richard-stewartson",
    "kind": "person",
    "name": "Richard Stewartson",
    "x": 969,
    "y": 978,
    "title": "Database Engineer",
    "homeId": "moonlight",
    "costPerMonth": 9600,
    "managerId": "priya-nair",
    "lastVacationAt": null,
    "startDate": "2020-11-01",
    "skills": [
      "Postgres",
      "ETL",
      "Performance"
    ],
    "allocations": [
      {
        "unit": "moonlight",
        "role": "Database Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "sofia-marchetti",
    "kind": "person",
    "name": "Sofia Marchetti",
    "x": 801,
    "y": 810,
    "title": "Engineer",
    "homeId": "moonlight",
    "costPerMonth": 8900,
    "managerId": "aaron-richter",
    "lastVacationAt": null,
    "startDate": "2023-01-15",
    "skills": [
      "JavaScript",
      "React",
      "Node"
    ],
    "allocations": [
      {
        "unit": "moonlight",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "felix-braun",
    "kind": "person",
    "name": "Felix Braun",
    "x": 311,
    "y": 642,
    "title": "QA Engineer",
    "homeId": "nebula",
    "costPerMonth": 7900,
    "managerId": "liam-walsh",
    "lastVacationAt": null,
    "startDate": "2024-04-01",
    "skills": [
      "QA",
      "Performance testing"
    ],
    "allocations": [
      {
        "unit": "nebula",
        "role": "QA",
        "pct": 100
      }
    ]
  },
  {
    "id": "hana-kim",
    "kind": "person",
    "name": "Hana Kim",
    "x": 479,
    "y": 810,
    "title": "Engineer",
    "homeId": "nebula",
    "costPerMonth": 8700,
    "managerId": "liam-walsh",
    "lastVacationAt": null,
    "startDate": "2022-06-01",
    "skills": [
      "Go",
      "Kubernetes"
    ],
    "allocations": [
      {
        "unit": "nebula",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "liam-walsh",
    "kind": "person",
    "name": "Liam Walsh",
    "x": 311,
    "y": 978,
    "title": "Senior Engineer",
    "homeId": "nebula",
    "costPerMonth": 10100,
    "managerId": "aimee-bradford",
    "lastVacationAt": null,
    "startDate": "2020-07-01",
    "skills": [
      "Go",
      "gRPC",
      "Distributed systems"
    ],
    "allocations": [
      {
        "unit": "nebula",
        "role": "Team Lead",
        "pct": 100
      }
    ]
  },
  {
    "id": "tobias-frank",
    "kind": "person",
    "name": "Tobias Frank",
    "x": 143,
    "y": 810,
    "title": "Engineer",
    "homeId": "nebula",
    "costPerMonth": 8400,
    "managerId": "liam-walsh",
    "lastVacationAt": null,
    "startDate": "2023-03-01",
    "skills": [
      "Rust",
      "Go"
    ],
    "allocations": [
      {
        "unit": "nebula",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "aisha-bello",
    "kind": "person",
    "name": "Aisha Bello",
    "x": 1760,
    "y": 72,
    "title": "Engineer",
    "homeId": "earthlight",
    "costPerMonth": 8300,
    "managerId": "lena-ortiz",
    "lastVacationAt": null,
    "startDate": "2023-07-01",
    "skills": [
      "JavaScript",
      "React"
    ],
    "allocations": [
      {
        "unit": "earthlight",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "carlos-mendes",
    "kind": "person",
    "name": "Carlos Mendes",
    "x": 1920,
    "y": 188,
    "title": "Engineer",
    "homeId": "earthlight",
    "costPerMonth": 8800,
    "managerId": "aimee-bradford",
    "lastVacationAt": null,
    "startDate": "2022-03-01",
    "skills": [
      "Java",
      "Spring"
    ],
    "allocations": [
      {
        "unit": "earthlight",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "lena-ortiz",
    "kind": "person",
    "name": "Lena Ortiz",
    "x": 1859,
    "y": 376,
    "title": "QA Lead",
    "homeId": "earthlight",
    "costPerMonth": 9300,
    "managerId": "aaron-richter",
    "lastVacationAt": null,
    "startDate": "2021-02-01",
    "skills": [
      "QA",
      "Selenium",
      "Leadership"
    ],
    "allocations": [
      {
        "unit": "earthlight",
        "role": "Team Lead",
        "pct": 100
      }
    ]
  },
  {
    "id": "sven-larsson",
    "kind": "person",
    "name": "Sven Larsson",
    "x": 1661,
    "y": 376,
    "title": "Senior Engineer",
    "homeId": "earthlight",
    "costPerMonth": 10000,
    "managerId": "aaron-richter",
    "lastVacationAt": null,
    "startDate": "2019-08-01",
    "skills": [
      "Java",
      "Architecture"
    ],
    "allocations": [
      {
        "unit": "earthlight",
        "role": "Senior Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "zara-haddad",
    "kind": "person",
    "name": "Zara Haddad",
    "x": 1600,
    "y": 188,
    "title": "Engineer",
    "homeId": "earthlight",
    "costPerMonth": 8000,
    "managerId": null,
    "lastVacationAt": null,
    "startDate": "2024-01-10",
    "skills": [
      "Python",
      "Django"
    ],
    "allocations": [
      {
        "unit": "earthlight",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "chloe-dubois",
    "kind": "person",
    "name": "Chloe Dubois",
    "x": 2089,
    "y": 642,
    "title": "QA Engineer",
    "homeId": "dawnbreak",
    "costPerMonth": 7800,
    "managerId": "hannah-schmidt",
    "lastVacationAt": null,
    "startDate": "2024-03-01",
    "skills": [
      "QA",
      "Automation"
    ],
    "allocations": [
      {
        "unit": "dawnbreak",
        "role": "QA",
        "pct": 100
      }
    ]
  },
  {
    "id": "hannah-schmidt",
    "kind": "person",
    "name": "Hannah Schmidt",
    "x": 2257,
    "y": 810,
    "title": "Engineer",
    "homeId": "dawnbreak",
    "costPerMonth": 9000,
    "managerId": "aaron-richter",
    "lastVacationAt": null,
    "startDate": "2021-05-01",
    "skills": [
      "Java",
      "Kafka"
    ],
    "allocations": [
      {
        "unit": "dawnbreak",
        "role": "Team Lead",
        "pct": 100
      }
    ]
  },
  {
    "id": "mateo-rossi",
    "kind": "person",
    "name": "Mateo Rossi",
    "x": 2089,
    "y": 978,
    "title": "Engineer",
    "homeId": "dawnbreak",
    "costPerMonth": 8200,
    "managerId": "hannah-schmidt",
    "lastVacationAt": null,
    "startDate": "2023-04-01",
    "skills": [
      "JavaScript",
      "Vue"
    ],
    "allocations": [
      {
        "unit": "dawnbreak",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "omar-farouk",
    "kind": "person",
    "name": "Omar Farouk",
    "x": 1921,
    "y": 810,
    "title": "Engineer",
    "homeId": "dawnbreak",
    "costPerMonth": 8600,
    "managerId": "hannah-schmidt",
    "lastVacationAt": null,
    "startDate": "2022-09-01",
    "skills": [
      "Go",
      "Kubernetes"
    ],
    "allocations": [
      {
        "unit": "dawnbreak",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "diego-alvarez",
    "kind": "person",
    "name": "Diego Alvarez",
    "x": 1431,
    "y": 642,
    "title": "Senior Engineer",
    "homeId": "tideway",
    "costPerMonth": 9900,
    "managerId": "aaron-richter",
    "lastVacationAt": null,
    "startDate": "2020-02-01",
    "skills": [
      "Java",
      "Architecture",
      "Kafka"
    ],
    "allocations": [
      {
        "unit": "tideway",
        "role": "Team Lead",
        "pct": 100
      }
    ]
  },
  {
    "id": "mei-lin",
    "kind": "person",
    "name": "Mei Lin",
    "x": 1599,
    "y": 810,
    "title": "Engineer",
    "homeId": "tideway",
    "costPerMonth": 8500,
    "managerId": "diego-alvarez",
    "lastVacationAt": null,
    "startDate": "2022-11-01",
    "skills": [
      "Java",
      "Spring"
    ],
    "allocations": [
      {
        "unit": "tideway",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "paul-nguyen",
    "kind": "person",
    "name": "Paul Nguyen",
    "x": 1431,
    "y": 978,
    "title": "Engineer",
    "homeId": "tideway",
    "costPerMonth": 8100,
    "managerId": "diego-alvarez",
    "lastVacationAt": null,
    "startDate": "2023-06-01",
    "skills": [
      "Go",
      "gRPC"
    ],
    "allocations": [
      {
        "unit": "tideway",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "sara-lindqvist",
    "kind": "person",
    "name": "Sara Lindqvist",
    "x": 1263,
    "y": 810,
    "title": "QA Engineer",
    "homeId": "tideway",
    "costPerMonth": 7700,
    "managerId": "diego-alvarez",
    "lastVacationAt": null,
    "startDate": "2024-05-01",
    "skills": [
      "QA",
      "Cypress"
    ],
    "allocations": [
      {
        "unit": "tideway",
        "role": "QA",
        "pct": 100
      }
    ]
  },
  {
    "id": "fatima-noor",
    "kind": "person",
    "name": "Fatima Noor",
    "x": 1200,
    "y": 952,
    "title": "Team Lead",
    "homeId": "ironclad",
    "costPerMonth": 10300,
    "managerId": "nadia-khan",
    "lastVacationAt": null,
    "startDate": "2019-04-01",
    "skills": [
      "Leadership",
      "Java",
      "Security"
    ],
    "allocations": [
      {
        "unit": "ironclad",
        "role": "Team Lead",
        "pct": 100
      }
    ]
  },
  {
    "id": "ingrid-solberg",
    "kind": "person",
    "name": "Ingrid Solberg",
    "x": 1368,
    "y": 1120,
    "title": "Engineer",
    "homeId": "ironclad",
    "costPerMonth": 8400,
    "managerId": "fatima-noor",
    "lastVacationAt": null,
    "startDate": "2023-02-01",
    "skills": [
      "Go",
      "Kubernetes"
    ],
    "allocations": [
      {
        "unit": "ironclad",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "jonas-berg",
    "kind": "person",
    "name": "Jonas Berg",
    "x": 1200,
    "y": 1288,
    "title": "Engineer",
    "homeId": "ironclad",
    "costPerMonth": 8800,
    "managerId": "fatima-noor",
    "lastVacationAt": null,
    "startDate": "2022-02-01",
    "skills": [
      "Java",
      "Spring"
    ],
    "allocations": [
      {
        "unit": "ironclad",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "kwame-mensah",
    "kind": "person",
    "name": "Kwame Mensah",
    "x": 1032,
    "y": 1120,
    "title": "QA Engineer",
    "homeId": "ironclad",
    "costPerMonth": 7900,
    "managerId": "fatima-noor",
    "lastVacationAt": null,
    "startDate": "2023-09-01",
    "skills": [
      "QA",
      "Automation"
    ],
    "allocations": [
      {
        "unit": "ironclad",
        "role": "QA",
        "pct": 100
      }
    ]
  },
  {
    "id": "emma-thompson",
    "kind": "person",
    "name": "Emma Thompson",
    "x": 1529,
    "y": 1522,
    "title": "QA Engineer",
    "homeId": "lighthouse",
    "costPerMonth": 8300,
    "managerId": "ravi-kapoor",
    "lastVacationAt": null,
    "startDate": "2022-07-01",
    "skills": [
      "QA",
      "Selenium"
    ],
    "allocations": [
      {
        "unit": "lighthouse",
        "role": "QA",
        "pct": 100
      }
    ]
  },
  {
    "id": "lucas-silva",
    "kind": "person",
    "name": "Lucas Silva",
    "x": 1697,
    "y": 1690,
    "title": "Engineer",
    "homeId": "lighthouse",
    "costPerMonth": 8200,
    "managerId": "ravi-kapoor",
    "lastVacationAt": null,
    "startDate": "2023-08-01",
    "skills": [
      "JavaScript",
      "React"
    ],
    "allocations": [
      {
        "unit": "lighthouse",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "noah-berger",
    "kind": "person",
    "name": "Noah Berger",
    "x": 1529,
    "y": 1858,
    "title": "Engineer",
    "homeId": "lighthouse",
    "costPerMonth": 7800,
    "managerId": null,
    "lastVacationAt": null,
    "startDate": "2024-06-01",
    "skills": [
      "Python",
      "FastAPI"
    ],
    "allocations": [
      {
        "unit": "lighthouse",
        "role": "Engineer",
        "pct": 100
      }
    ]
  },
  {
    "id": "ravi-kapoor",
    "kind": "person",
    "name": "Ravi Kapoor",
    "x": 1361,
    "y": 1690,
    "title": "Senior Engineer",
    "homeId": "lighthouse",
    "costPerMonth": 10000,
    "managerId": "nadia-khan",
    "lastVacationAt": null,
    "startDate": "2020-10-01",
    "skills": [
      "Java",
      "Architecture"
    ],
    "allocations": [
      {
        "unit": "lighthouse",
        "role": "Team Lead",
        "pct": 100
      }
    ]
  },
  {
    "id": "anita-desai",
    "kind": "person",
    "name": "Anita Desai",
    "x": 2320,
    "y": 1332,
    "title": "Contractor — QA",
    "homeId": "infosys-contractors",
    "costPerMonth": 6800,
    "managerId": null,
    "lastVacationAt": null,
    "startDate": "2025-01-01",
    "skills": [
      "QA",
      "Automation"
    ],
    "allocations": [
      {
        "unit": "infosys-contractors",
        "role": "Contractor",
        "pct": 100
      }
    ]
  },
  {
    "id": "vikram-rao",
    "kind": "person",
    "name": "Vikram Rao",
    "x": 2320,
    "y": 1668,
    "title": "Contractor — Engineer",
    "homeId": "infosys-contractors",
    "costPerMonth": 7000,
    "managerId": null,
    "lastVacationAt": null,
    "startDate": "2024-09-01",
    "skills": [
      "Java",
      "Spring"
    ],
    "allocations": [
      {
        "unit": "infosys-contractors",
        "role": "Contractor",
        "pct": 100
      }
    ]
  },
  {
    "id": "sarah-reeve",
    "kind": "person",
    "name": "Sarah Reeve",
    "x": 1367,
    "y": -516,
    "title": "Delivery Lead",
    "homeId": "cross-cutting",
    "costPerMonth": 15500,
    "managerId": null,
    "lastVacationAt": null,
    "startDate": "2017-02-01",
    "skills": [
      "Leadership",
      "SAFe",
      "Org design"
    ],
    "allocations": []
  },
  {
    "id": "aimee-bradford",
    "kind": "person",
    "name": "Aimee Bradford",
    "x": 1596,
    "y": 47,
    "title": "RTE — Atlas",
    "homeId": "cross-cutting",
    "costPerMonth": 12800,
    "managerId": "sarah-reeve",
    "lastVacationAt": "2025-09-01",
    "startDate": "2019-06-15",
    "skills": [
      "Leadership",
      "Architecture",
      "Java"
    ],
    "allocations": []
  },
  {
    "id": "aaron-richter",
    "kind": "person",
    "name": "Aaron Richter",
    "x": 1033,
    "y": 276,
    "title": "RTE — Orion",
    "homeId": "cross-cutting",
    "costPerMonth": 12600,
    "managerId": "sarah-reeve",
    "lastVacationAt": null,
    "startDate": "2018-05-01",
    "skills": [
      "Leadership",
      "Go",
      "Platform"
    ],
    "allocations": []
  },
  {
    "id": "nadia-khan",
    "kind": "person",
    "name": "Nadia Khan",
    "x": 804,
    "y": -287,
    "title": "RTE — Vega",
    "homeId": "cross-cutting",
    "costPerMonth": 12400,
    "managerId": "sarah-reeve",
    "lastVacationAt": null,
    "startDate": "2019-09-01",
    "skills": [
      "Leadership",
      "Product",
      "Agile"
    ],
    "allocations": []
  }
];

