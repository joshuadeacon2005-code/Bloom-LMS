import pg from 'pg'

  const employeeData: Array<{
    name: string
    email: string
    role: 'employee' | 'manager' | 'hr_admin'
    regionCode: string
    managerEmail: string | null
  }> = [
    { name: "Yazid Ahmad", email: "yazid.ahmad@bloomandgrowgroup.com", role: "employee", regionCode: "SG", managerEmail: "amy@bloomandgrowgroup.com" },
  { name: "Richard Alejandro", email: "richard.alejandro@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "leyden@bloomandgrowgroup.com" },
  { name: "Nenden Alifa S", email: "nenden.alifa@bloomandgrowgroup.com", role: "manager", regionCode: "ID", managerEmail: null },
  { name: "Maya Amelia", email: "maya.amelia@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "anggraini.hapsari@bloomandgrowgroup.com" },
  { name: "Scott Ang", email: "scott.ang@bloomandgrowgroup.com", role: "manager", regionCode: "SG", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Syazwany Anny", email: "syazwany.anny@bloomandgrowgroup.com", role: "employee", regionCode: "MY", managerEmail: "louise@bloomandgrowgroup.com" },
  { name: "Atiqah Ashaari", email: "atiqah.ecom@bloomandgrowgroup.com", role: "employee", regionCode: "MY", managerEmail: "winnie.lee@bloomandgrowgroup.com" },
  { name: "Chloe Baker", email: "chloe@bloomandgrowgroup.com", role: "employee", regionCode: "AU", managerEmail: "carole@bloomandgrowgroup.com" },
  { name: "Jessica Boler", email: "jessicab@bloomandgrowgroup.com", role: "employee", regionCode: "AU", managerEmail: "carole@bloomandgrowgroup.com" },
  { name: "Tammy Bolton", email: "tammy@bloomandgrowgroup.com", role: "employee", regionCode: "AU", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Eva Chan", email: "eva.chan@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Bud Chang", email: "bud@babycentral.com.hk", role: "employee", regionCode: "HK", managerEmail: "arati@babycentral.com.hk" },
  { name: "Louise Cheang", email: "louise@bloomandgrowgroup.com", role: "manager", regionCode: "MY", managerEmail: "amy@bloomandgrowgroup.com" },
  { name: "Cherry Chen", email: "cherry.chen@bloomandgrowgroup.com", role: "manager", regionCode: "HK", managerEmail: "erica.lye@bloomandgrowgroup.com" },
  { name: "Essena Chen", email: "essena.chen@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "amy@bloomandgrowgroup.com" },
  { name: "Withney Chen", email: "withney@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "jason.fu@bloomandgrowgroup.com" },
  { name: "Zoe Chen", email: "zoe@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Lawrence Choi", email: "lawrence.choi@bloomandgrowgroup.com", role: "manager", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Sydney Choi", email: "sydney@bloomandgrowgroup.com", role: "employee", regionCode: "AU", managerEmail: "jamie@bloomandgrowgroup.com" },
  { name: "Stephanie Choo", email: "stephanie.choo@bloomandgrowgroup.com", role: "employee", regionCode: "MY", managerEmail: "erica.lye@bloomandgrowgroup.com" },
  { name: "Helen Christie", email: "helen.christie@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Elaine Chung", email: "elaine@bloomandgrowgroup.com", role: "hr_admin", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Kim Clarke", email: "kim@bloomandgrowgroup.com", role: "employee", regionCode: "AU", managerEmail: "jamie@bloomandgrowgroup.com" },
  { name: "Joshua Deacon", email: "josh@bloomandgrowgroup.com", role: "employee", regionCode: "AU", managerEmail: "naveen@bloomandgrowgroup.com" },
  { name: "Riana Destiana", email: "riana.destiana@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "anggraini.hapsari@bloomandgrowgroup.com" },
  { name: "Alexandra Dickson Leach", email: "alex@bloomandgrowgroup.com", role: "manager", regionCode: "HK", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Leyden Du", email: "leyden@bloomandgrowgroup.com", role: "hr_admin", regionCode: "HK", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Brigitta Ellen", email: "brigitta.ellen@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "erica.lye@bloomandgrowgroup.com" },
  { name: "Jerald Fan", email: "jerald@babycentral.com.hk", role: "employee", regionCode: "HK", managerEmail: "arati@babycentral.com.hk" },
  { name: "Lily Fan", email: "lily@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "megan.li@bloomandgrow.com.cn" },
  { name: "Jason Fu", email: "jason.fu@bloomandgrowgroup.com", role: "manager", regionCode: "HK", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Hollie Gale", email: "hollie@bloomandgrowgroup.com", role: "employee", regionCode: "AU", managerEmail: "jamie@bloomandgrowgroup.com" },
  { name: "Bobo Gan", email: "bobo.gan@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "jason.fu@bloomandgrowgroup.com" },
  { name: "June Gray", email: "june@bloomandgrowgroup.com", role: "manager", regionCode: "AU", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Anggraini HAPSARI", email: "anggraini.hapsari@bloomandgrowgroup.com", role: "manager", regionCode: "ID", managerEmail: "tannting@bloomandgrowgroup.com" },
  { name: "CiCi Huang", email: "cici.huang@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "amy@bloomandgrowgroup.com" },
  { name: "Ellen Hui", email: "ellen@bloomandgrowgroup.com", role: "hr_admin", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Benjamin Inglis", email: "benjamin.inglis@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Jorge Inso", email: "jorge.inso@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "leyden@bloomandgrowgroup.com" },
  { name: "Carole Irvine", email: "carole@bloomandgrowgroup.com", role: "manager", regionCode: "AU", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Sophie Jiao", email: "sophie.jiao@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Rina Juwita", email: "rina.juwita@bloomandgrowgroup.com", role: "hr_admin", regionCode: "ID", managerEmail: "anggraini.hapsari@bloomandgrowgroup.com" },
  { name: "Idy Kong", email: "idy@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "lawrence.choi@bloomandgrowgroup.com" },
  { name: "Janice Kong", email: "janice.kong@bloomandgrowgroup.com", role: "manager", regionCode: "MY", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Kate Kuang", email: "kate.kuang@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "amy@bloomandgrowgroup.com" },
  { name: "Amy Lam", email: "amy@bloomandgrowgroup.com", role: "manager", regionCode: "HK", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Winnie Lee", email: "winnie.lee@bloomandgrowgroup.com", role: "manager", regionCode: "MY", managerEmail: "tannting@bloomandgrowgroup.com" },
  { name: "Megan Li", email: "megan.li@bloomandgrow.com.cn", role: "manager", regionCode: "CN", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Sissi Li", email: "sissi.li@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "megan.li@bloomandgrow.com.cn" },
  { name: "Vicky Li", email: "vicky.li@bloomandgrowgroup.com", role: "manager", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Mei Liew", email: "mei.liew@bloomandgrowgroup.com", role: "employee", regionCode: "MY", managerEmail: "janice.kong@bloomandgrowgroup.com" },
  { name: "Arati Limbu", email: "arati@babycentral.com.hk", role: "manager", regionCode: "HK", managerEmail: "vicky.li@bloomandgrowgroup.com" },
  { name: "Lina Lina", email: "lina@bloomandgrowgroup.com", role: "manager", regionCode: "SG", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Wynn Liu", email: "wynn.liu@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "cherry.chen@bloomandgrowgroup.com" },
  { name: "Gloria Lo", email: "gloria.lo@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "jason.fu@bloomandgrowgroup.com" },
  { name: "Tann Ling Loh", email: "tannling@bloomandgrowgroup.com", role: "manager", regionCode: "SG", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Tann Ting Loh", email: "tannting@bloomandgrowgroup.com", role: "manager", regionCode: "SG", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Jeremy Low", email: "jeremy.low@bloomandgrowgroup.com", role: "employee", regionCode: "SG", managerEmail: "scott.ang@bloomandgrowgroup.com" },
  { name: "Laura Luo", email: "laura@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "winson.zheng@bloomandgrow.com.cn" },
  { name: "Erica Lye", email: "erica.lye@bloomandgrowgroup.com", role: "manager", regionCode: "SG", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "James Metcalfe", email: "james@bloomandgrowgroup.com", role: "employee", regionCode: "AU", managerEmail: "jamie@bloomandgrowgroup.com" },
  { name: "Asyiqin Nasser", email: "asyiqin.nasser@bloomandgrowgroup.com", role: "employee", regionCode: "SG", managerEmail: "amy@bloomandgrowgroup.com" },
  { name: "JIM ONG", email: "sgaccounts@bloomandgrowgroup.com", role: "manager", regionCode: "SG", managerEmail: "jason.fu@bloomandgrowgroup.com" },
  { name: "Yakub Prastawa", email: "yakub.prastawa@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "lina@bloomandgrowgroup.com" },
  { name: "Atika Putri", email: "atika.putri@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "sgaccounts@bloomandgrowgroup.com" },
  { name: "Jamie Quinn", email: "jamie@bloomandgrowgroup.com", role: "manager", regionCode: "AU", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Ania Rac-Frac", email: "ania@bloomandgrow.com.au", role: "employee", regionCode: "AU", managerEmail: "jamie@bloomandgrowgroup.com" },
  { name: "Deden Ridwan", email: "deden.ridwan@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "lina@bloomandgrowgroup.com" },
  { name: "Teddy Romulo", email: "teddy.romulo@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "naveen@bloomandgrowgroup.com" },
  { name: "Anmol Roop Rai", email: "anmol.rooprai@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "naveen@bloomandgrowgroup.com" },
  { name: "Sharwind Saravanan", email: "sharwind@baby-central.com.sg", role: "employee", regionCode: "SG", managerEmail: "scott.ang@bloomandgrowgroup.com" },
  { name: "Wiwik Setyawati", email: "wiwik.setyawati@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "sgaccounts@bloomandgrowgroup.com" },
  { name: "Meydira Shahnaz", email: "meydira.shahnaz@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: null },
  { name: "Stephanie Shim", email: "stephanie.shim@bloomandgrowgroup.com", role: "employee", regionCode: "SG", managerEmail: "erica.lye@bloomandgrowgroup.com" },
  { name: "Michelle Su", email: "michelle.su@bloomandgrow.com.cn", role: "hr_admin", regionCode: "CN", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Maisarah Sulaiman", email: "maisarah.sulaiman@bloomandgrowgroup.com", role: "employee", regionCode: "MY", managerEmail: "winnie.lee@bloomandgrowgroup.com" },
  { name: "Winki Tam", email: "winki@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "amy@bloomandgrowgroup.com" },
  { name: "Melissa Tan", email: "melissa@baby-central.com.sg", role: "employee", regionCode: "SG", managerEmail: "tannling@bloomandgrowgroup.com" },
  { name: "Martha Tang", email: "martha.tang@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Siti Tarmidi", email: "siti.tarmidi@bloomandgrowgroup.com", role: "employee", regionCode: "MY", managerEmail: "myaccounts@bloomandgrowgroup.com" },
  { name: "Victoria Thomas", email: "victoria@bloomandgrowasia.com", role: "employee", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Rachel Too Yee Ling", email: "rachel.too@bloomandgrowgroup.com", role: "employee", regionCode: "SG", managerEmail: "tannting@bloomandgrowgroup.com" },
  { name: "Mike Tsang", email: "mike.tsang@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "jason.fu@bloomandgrowgroup.com" },
  { name: "Lutfia Usman", email: "lutfia.usman@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "nenden.alifa@bloomandgrowgroup.com" },
  { name: "Angela Valentine", email: "angela.valentine@bloomandgrowgroup.com", role: "employee", regionCode: "ID", managerEmail: "erica.lye@bloomandgrowgroup.com" },
  { name: "Brian Wong", email: "brian@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Michelle Wu", email: "michelle@bloomandgrowgroup.com", role: "employee", regionCode: "HK", managerEmail: "jamie@bloomandgrowgroup.com" },
  { name: "Amy Xu", email: "amy.xu@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "ellen@bloomandgrowgroup.com" },
  { name: "Helen Yan", email: "helen.yan@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "winson.zheng@bloomandgrow.com.cn" },
  { name: "Crystal Yang", email: "crystal@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "jason.fu@bloomandgrowgroup.com" },
  { name: "Enid Yap", email: "enid.yap@bloomandgrowgroup.com", role: "employee", regionCode: "MY", managerEmail: "janice.kong@bloomandgrowgroup.com" },
  { name: "Wai Ming Yap", email: "myaccounts@bloomandgrowgroup.com", role: "manager", regionCode: "MY", managerEmail: "jason.fu@bloomandgrowgroup.com" },
  { name: "Naveen Yellamaddi", email: "naveen@bloomandgrowgroup.com", role: "hr_admin", regionCode: "HK", managerEmail: "alex@bloomandgrowgroup.com" },
  { name: "Ashley Zhang", email: "ashley.zhang@bloomandgrow.com.cn", role: "employee", regionCode: "CN", managerEmail: "megan.li@bloomandgrow.com.cn" },
  { name: "Winson Zheng", email: "winson.zheng@bloomandgrow.com.cn", role: "manager", regionCode: "CN", managerEmail: "ellen@bloomandgrowgroup.com" },
  ]

  const EXPECTED_EMAILS = new Set(employeeData.map(e => e.email))
  const DEFAULT_PASSWORD_HASH = '$2a$12$6Rusoo21F1I/LKjExoRfzO8MM6quAb242ckgnJvVOmgyOqttG2P.e'

  export async function seedEmployees(): Promise<void> {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      console.error('[seed-employees] DATABASE_URL not set, skipping')
      return
    }

    const client = new pg.Client({ connectionString: dbUrl })
    await client.connect()

    try {
      const existingResult = await client.query(
        'SELECT email FROM users WHERE email = ANY($1)',
        [Array.from(EXPECTED_EMAILS)]
      )
      const existingEmails = new Set(existingResult.rows.map((r: { email: string }) => r.email))
      const missing = employeeData.filter(e => !existingEmails.has(e.email))

      if (missing.length === 0) {
        console.log(`[seed-employees] All ${employeeData.length} employees already exist, skipping seed`)
        return
      }

      console.log(`[seed-employees] Found ${existingEmails.size}/${employeeData.length} employees, seeding ${missing.length} missing...`)

      const regionResult = await client.query('SELECT id, code FROM regions')
      const regionMap = new Map<string, number>(regionResult.rows.map((r: { id: number; code: string }) => [r.code, r.id]))

      for (const emp of employeeData) {
        const regionId = regionMap.get(emp.regionCode)
        if (!regionId) {
          console.error(`[seed-employees] Unknown region code ${emp.regionCode} for ${emp.email}, skipping`)
          continue
        }
        await client.query(
          `INSERT INTO users (email, password_hash, name, role, region_id, is_active)
           VALUES ($1, $2, $3, $4, $5, true)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             role = EXCLUDED.role,
             region_id = EXCLUDED.region_id,
             is_active = true`,
          [emp.email, DEFAULT_PASSWORD_HASH, emp.name, emp.role, regionId]
        )
      }

      for (const emp of employeeData) {
        if (emp.managerEmail) {
          await client.query(
            'UPDATE users SET manager_id = (SELECT id FROM users WHERE email = $1) WHERE email = $2',
            [emp.managerEmail, emp.email]
          )
        }
      }

      console.log(`[seed-employees] Successfully seeded ${employeeData.length} employees`)
    } catch (err) {
      console.error('[seed-employees] Error seeding employees:', err)
    } finally {
      await client.end()
    }
  }
  