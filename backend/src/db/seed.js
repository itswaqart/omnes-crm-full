require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const bcrypt = require("bcryptjs");
const { query, pool } = require("./pool");

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const DEFAULT_PW = "Omnes2026!";

async function seed() {
  console.log("🌱  Seeding OMNES CRM database…");

  const pwHash = await bcrypt.hash(DEFAULT_PW, ROUNDS);

  // ── Users ──────────────────────────────────────────────────
  const users = [
    { name: "Layla Al Mansoori", email: "layla@omnesmedia.com", role: "super_admin", team: "Management",  mustChange: false },
    { name: "James Carter",      email: "james@omnesmedia.com", role: "sales_manager", team: "UAE Sales", mustChange: false },
    { name: "Sara Khalid",       email: "sara@omnesmedia.com",  role: "sales_rep",     team: "UAE Sales", mustChange: false },
    { name: "Rami Hassan",       email: "rami@omnesmedia.com",  role: "sales_rep",     team: "KSA Sales", mustChange: false },
    { name: "Nour Farouk",       email: "nour@omnesmedia.com",  role: "viewer",        team: "Finance",   mustChange: false },
  ];

  const userIds = {};
  for (const u of users) {
    const res = await query(
      `INSERT INTO users (name, email, password_hash, role, team, must_change_pw)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [u.name, u.email, pwHash, u.role, u.team, u.mustChange]
    );
    userIds[u.email] = res.rows[0].id;
    console.log(`  ✓ User: ${u.name}`);
  }

  // ── Leads ──────────────────────────────────────────────────
  const leads = [
    { company:"Luxury Motors UAE",    contact:"Ahmed Al Rashid", email:"ahmed@luxmotors.ae",      phone:"+971 50 123 4567", stage:"Proposal",    value:180000, prob:70,  source:"Referral",     assignee:"sara@omnesmedia.com",  category:"Automotive", property:"OMNES Lifestyle", type:"Direct", notes:"Interested in full-page spreads and digital package" },
    { company:"Maison Parfum",        contact:"Claire Dubois",   email:"claire@maisonparfum.fr",  phone:"+33 1 2345 6789",  stage:"Qualified",   value:95000,  prob:50,  source:"Cold Outreach", assignee:"sara@omnesmedia.com",  category:"Luxury",     property:"OMNES Magazine",  type:"Agency", notes:"Agency deal via Creative Hub Paris" },
    { company:"TechVision KSA",       contact:"Khalid Al Saud",  email:"khalid@techvision.sa",    phone:"+966 55 987 6543", stage:"Contacted",   value:60000,  prob:30,  source:"Event",         assignee:"rami@omnesmedia.com",  category:"Technology", property:"OMNES Digital",   type:"Direct", notes:"Met at GITEX, keen on Q3 campaign" },
    { company:"Riviera Hotels Group", contact:"Sofia Marcello",  email:"sofia@rivierahotels.com", phone:"+39 02 345 6789",  stage:"Closed Won",  value:250000, prob:100, source:"Inbound",       assignee:"james@omnesmedia.com", category:"Hospitality",property:"OMNES Travel",    type:"Direct", notes:"Annual partnership signed" },
    { company:"NovaSport",            contact:"Marcus Webb",     email:"marcus@novasport.com",    phone:"+44 20 7123 4567", stage:"New",         value:45000,  prob:20,  source:"Referral",      assignee:"rami@omnesmedia.com",  category:"Sports",     property:"OMNES Digital",   type:"Agency", notes:"Intro call scheduled" },
    { company:"Al Baraka Finance",    contact:"Fatima Al Zaabi", email:"fatima@albaraka.ae",      phone:"+971 4 234 5678",  stage:"Closed Lost", value:75000,  prob:0,   source:"Cold Outreach", assignee:"sara@omnesmedia.com",  category:"Finance",    property:"OMNES Business",  type:"Direct", notes:"Budget constraints, revisit Q4" },
  ];

  const leadIds = [];
  for (const l of leads) {
    const res = await query(
      `INSERT INTO leads (company,contact,email,phone,stage,value,probability,source,category,property,deal_type,assigned_to,notes,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW() - INTERVAL '30 days' * random())
       RETURNING id`,
      [l.company,l.contact,l.email,l.phone,l.stage,l.value,l.prob,l.source,l.category,l.property,l.type,userIds[l.assignee],l.notes,userIds["layla@omnesmedia.com"]]
    );
    leadIds.push({ id: res.rows[0].id, assignee: l.assignee, company: l.company });
    console.log(`  ✓ Lead: ${l.company}`);
  }

  // ── Activities ─────────────────────────────────────────────
  const acts = [
    { leadIdx:0, type:"Call",    note:"Discussed spring campaign options. Client very interested in cover placement.", assignee:"sara@omnesmedia.com" },
    { leadIdx:0, type:"Email",   note:"Sent updated rate card and digital add-on proposal.",                          assignee:"sara@omnesmedia.com" },
    { leadIdx:1, type:"Meeting", note:"Video call with agency team. Need to revise creative specs.",                  assignee:"sara@omnesmedia.com" },
    { leadIdx:3, type:"Note",    note:"Contract signed and sent to finance. PO received.",                           assignee:"james@omnesmedia.com" },
    { leadIdx:2, type:"Call",    note:"Follow-up call. Client requested digital media kit.",                         assignee:"rami@omnesmedia.com"  },
  ];

  for (const a of acts) {
    await query(
      `INSERT INTO activities (lead_id,type,note,user_id) VALUES ($1,$2,$3,$4)`,
      [leadIds[a.leadIdx].id, a.type, a.note, userIds[a.assignee]]
    );
  }
  console.log(`  ✓ ${acts.length} activities seeded`);

  // ── Audit ──────────────────────────────────────────────────
  await query(
    `INSERT INTO audit_log (user_id,action,target) VALUES ($1,'System Seeded','Initial data loaded')`,
    [userIds["layla@omnesmedia.com"]]
  );

  console.log("\n✅  Seed complete!");
  console.log(`\n   Default password for all accounts: ${DEFAULT_PW}`);
  console.log("   Users must change password after first login.\n");

  await pool.end();
}

seed().catch(err => { console.error("Seed failed:", err); process.exit(1); });
