import pg from 'pg'

export async function seedBaseData(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[seed-base] DATABASE_URL not set, skipping')
    return
  }

  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()

  try {
    const regionCheck = await client.query('SELECT count(*) as cnt FROM regions')
    if (parseInt(regionCheck.rows[0].cnt) >= 9) {
      console.log('[seed-base] Base data already seeded, skipping')
      await client.end()
      return
    }

    console.log('[seed-base] Seeding base data...')

    const regionValues = [
      ['Hong Kong', 'HK', 'Asia/Hong_Kong', 'HKD'],
      ['Singapore', 'SG', 'Asia/Singapore', 'SGD'],
      ['Malaysia', 'MY', 'Asia/Kuala_Lumpur', 'MYR'],
      ['Indonesia', 'ID', 'Asia/Jakarta', 'IDR'],
      ['China', 'CN', 'Asia/Shanghai', 'CNY'],
      ['Australia', 'AU', 'Australia/Sydney', 'AUD'],
      ['New Zealand', 'NZ', 'Pacific/Auckland', 'NZD'],
      ['China - Guangzhou', 'CN-GZ', 'Asia/Shanghai', 'CNY'],
      ['China - Shanghai', 'CN-SH', 'Asia/Shanghai', 'CNY'],
    ]

    for (const [name, code, tz, curr] of regionValues) {
      await client.query(
        'INSERT INTO regions (name, code, timezone, currency) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [name, code, tz, curr]
      )
    }

    const regionsResult = await client.query('SELECT id, code FROM regions')
    const regionMap: Record<string, number> = {}
    for (const row of regionsResult.rows) {
      regionMap[row.code] = row.id
    }
    console.log('[seed-base] Regions seeded:', Object.keys(regionMap).join(', '))

    const deptData = [
      ['Sales & Distribution', 'HK'], ['Marketing', 'HK'], ['Operations', 'HK'],
      ['Sales & Distribution', 'SG'], ['Marketing', 'SG'], ['Operations', 'SG'],
      ['Sales & Distribution', 'MY'], ['Marketing', 'MY'],
      ['Sales & Distribution', 'ID'], ['Marketing', 'ID'],
      ['Sales & Distribution', 'CN'], ['Marketing', 'CN'],
      ['Sales & Distribution', 'CN-GZ'], ['Marketing', 'CN-GZ'],
      ['Sales & Distribution', 'CN-SH'], ['Marketing', 'CN-SH'],
      ['Sales & Distribution', 'AU'], ['Operations', 'AU'],
      ['Sales & Distribution', 'NZ'],
      ['Finance', 'HK'], ['Human Resources', 'HK'], ['Technology', 'HK'],
    ]

    for (const [name, regionCode] of deptData) {
      const regionId = regionMap[regionCode]
      if (regionId) {
        await client.query(
          'INSERT INTO departments (name, region_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [name, regionId]
        )
      }
    }
    console.log('[seed-base] Departments seeded')

    const leaveTypeData = [
      ['Annual Leave', 'AL', 'Paid annual leave entitlement', true, false, null],
      ['Sick Leave', 'SL', 'Medical leave for illness or injury', true, false, null],
      ['Maternity Leave', 'ML', 'Paid leave for the birth or adoption of a child (primary caregiver)', true, true, null],
      ['Paternity Leave', 'PL', 'Paid leave for the birth or adoption of a child (secondary caregiver)', true, false, null],
      ['Compassionate Leave', 'CL', 'Leave for bereavement or serious family illness', true, false, 5],
      ['Marriage Leave', 'MRL', 'Leave for the employee\'s own wedding', true, false, 3],
      ['Unpaid Leave', 'UL', 'Leave without pay', false, false, null],
      ['Child Care Leave', 'CCL', 'Government-mandated child care leave', true, false, 6],
      ['Study / Exam Leave', 'STL', 'Leave for approved study or examinations', true, true, 5],
      ['Compensatory Leave', 'COMP_LEAVE', 'Leave earned via approved overtime (non-AU/NZ)', true, false, null],
      ['Time In Lieu', 'TIL', 'Hourly time-off balance earned via approved overtime (AU/NZ)', true, false, null],
    ] as const

    for (const [name, code, desc, isPaid, reqAttach, maxDays] of leaveTypeData) {
      await client.query(
        `INSERT INTO leave_types (name, code, description, is_paid, requires_attachment, max_days_per_year, region_id)
         VALUES ($1, $2, $3, $4, $5, $6, NULL) ON CONFLICT DO NOTHING`,
        [name, code, desc, isPaid, reqAttach, maxDays]
      )
    }

    const ltResult = await client.query('SELECT id, code FROM leave_types')
    const ltMap: Record<string, number> = {}
    for (const row of ltResult.rows) {
      ltMap[row.code] = row.id
    }
    console.log('[seed-base] Leave types seeded:', Object.keys(ltMap).join(', '))

    const policies = [
      ['AL', 'HK', '7', '5', 3], ['AL', 'SG', '7', '5', 3], ['AL', 'MY', '8', '8', 3],
      ['AL', 'ID', '12', '0', 12], ['AL', 'CN', '5', '0', 12], ['AL', 'CN-GZ', '5', '0', 12], ['AL', 'CN-SH', '5', '0', 12], ['AL', 'AU', '20', '20', 0], ['AL', 'NZ', '20', '20', 12],
      ['SL', 'HK', '14', '0', 1], ['SL', 'SG', '14', '0', 3], ['SL', 'MY', '14', '0', 0],
      ['SL', 'ID', '12', '0', 0], ['SL', 'CN', '12', '0', 0], ['SL', 'CN-GZ', '12', '0', 0], ['SL', 'CN-SH', '12', '0', 0], ['SL', 'AU', '10', '10', 0], ['SL', 'NZ', '10', '20', 0],
      ['ML', 'HK', '84', '0', 3], ['ML', 'SG', '112', '0', 3], ['ML', 'MY', '60', '0', 3],
      ['ML', 'ID', '90', '0', 0], ['ML', 'CN', '98', '0', 0], ['ML', 'CN-GZ', '98', '0', 0], ['ML', 'CN-SH', '98', '0', 0], ['ML', 'AU', '365', '0', 12], ['ML', 'NZ', '365', '0', 6],
      ['PL', 'HK', '5', '0', 3], ['PL', 'SG', '14', '0', 3], ['PL', 'MY', '3', '0', 12],
      ['PL', 'ID', '2', '0', 0], ['PL', 'CN', '15', '0', 0], ['PL', 'CN-GZ', '15', '0', 0], ['PL', 'CN-SH', '15', '0', 0], ['PL', 'AU', '5', '0', 12], ['PL', 'NZ', '10', '0', 6],
      ['CL', 'HK', '5', '0', 0], ['CL', 'SG', '3', '0', 0], ['CL', 'MY', '3', '0', 0],
      ['CL', 'ID', '2', '0', 0], ['CL', 'CN', '3', '0', 0], ['CL', 'CN-GZ', '3', '0', 0], ['CL', 'CN-SH', '3', '0', 0], ['CL', 'AU', '5', '0', 0], ['CL', 'NZ', '3', '0', 0],
      ['CCL', 'SG', '6', '0', 3], ['CCL', 'MY', '7', '0', 3], ['CCL', 'AU', '5', '0', 12], ['CCL', 'NZ', '5', '0', 0],
      ['COMP_LEAVE', 'HK', '0', '5', 0], ['COMP_LEAVE', 'SG', '0', '5', 0], ['COMP_LEAVE', 'MY', '0', '5', 0],
      ['COMP_LEAVE', 'ID', '0', '5', 0], ['COMP_LEAVE', 'CN', '0', '5', 0], ['COMP_LEAVE', 'CN-GZ', '0', '5', 0], ['COMP_LEAVE', 'CN-SH', '0', '5', 0],
      ['TIL', 'AU', '0', '20', 0], ['TIL', 'NZ', '0', '20', 0],
    ] as const

    for (const [ltCode, rCode, entDays, coMax, probMonths] of policies) {
      const ltId = ltMap[ltCode as string]
      const rId = regionMap[rCode as string]
      if (ltId && rId) {
        await client.query(
          `INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [ltId, rId, entDays, coMax, probMonths]
        )
      }
    }
    console.log('[seed-base] Leave policies seeded')

    const holidays = [
      ["New Year's Day", '2026-01-01', 'HK'], ['Lunar New Year Day 1', '2026-01-29', 'HK'],
      ['Lunar New Year Day 2', '2026-01-30', 'HK'], ['Lunar New Year Day 3', '2026-01-31', 'HK'],
      ['Lunar New Year (Substitute)', '2026-02-02', 'HK'],
      ['Good Friday', '2026-04-03', 'HK'], ['Day After Good Friday', '2026-04-04', 'HK'],
      ['Ching Ming Festival', '2026-04-05', 'HK'], ['Easter Monday', '2026-04-06', 'HK'],
      ['Ching Ming Festival (Substitute)', '2026-04-07', 'HK'],
      ['Labour Day', '2026-05-01', 'HK'], ["Buddha's Birthday", '2026-05-24', 'HK'],
      ["The Day Following Buddha's Birthday (Sub)", '2026-05-25', 'HK'],
      ['Dragon Boat Festival', '2026-06-19', 'HK'], ['HK SAR Establishment Day', '2026-07-01', 'HK'],
      ['Day After Mid-Autumn Festival', '2026-09-26', 'HK'],
      ['Day After Mid-Autumn Festival (Sub)', '2026-09-28', 'HK'],
      ['National Day', '2026-10-01', 'HK'],
      ['Chung Yeung Festival', '2026-10-11', 'HK'], ['Chung Yeung Festival (Substitute)', '2026-10-12', 'HK'],
      ['Christmas Day', '2026-12-25', 'HK'], ['Boxing Day', '2026-12-26', 'HK'],
      ['Boxing Day (Substitute)', '2026-12-28', 'HK'],
      ["New Year's Day", '2026-01-01', 'SG'], ['Lunar New Year Day 1', '2026-01-29', 'SG'],
      ['Lunar New Year Day 2', '2026-01-30', 'SG'], ['Good Friday', '2026-04-03', 'SG'],
      ['Labour Day', '2026-05-01', 'SG'], ['Vesak Day', '2026-05-24', 'SG'],
      ['Hari Raya Puasa', '2026-03-30', 'SG'], ['Hari Raya Haji', '2026-06-07', 'SG'],
      ['National Day', '2026-08-09', 'SG'], ['Deepavali', '2026-11-08', 'SG'],
      ['Christmas Day', '2026-12-25', 'SG'],
      ["New Year's Day", '2026-01-01', 'MY'], ['Federal Territory Day', '2026-02-01', 'MY'],
      ['Thaipusam', '2026-02-11', 'MY'], ['Lunar New Year Day 1', '2026-01-29', 'MY'],
      ['Lunar New Year Day 2', '2026-01-30', 'MY'], ['Hari Raya Puasa Day 1', '2026-03-30', 'MY'],
      ['Hari Raya Puasa Day 2', '2026-03-31', 'MY'], ['Labour Day', '2026-05-01', 'MY'],
      ['Vesak Day', '2026-05-24', 'MY'], ["Yang di-Pertuan Agong's Birthday", '2026-06-01', 'MY'],
      ['Hari Raya Haji', '2026-06-07', 'MY'], ['Muharram', '2026-06-27', 'MY'],
      ['National Day', '2026-08-31', 'MY'], ['Malaysia Day', '2026-09-16', 'MY'],
      ["Prophet Muhammad's Birthday", '2026-09-06', 'MY'], ['Deepavali', '2026-11-08', 'MY'],
      ['Christmas Day', '2026-12-25', 'MY'],
      ["New Year's Day", '2026-01-01', 'ID'], ['Lunar New Year', '2026-01-29', 'ID'],
      ["Isra Mi'raj", '2026-02-18', 'ID'], ['Nyepi (Hindu New Year)', '2026-03-20', 'ID'],
      ['Good Friday', '2026-04-03', 'ID'], ['Hari Raya Idul Fitri Day 1', '2026-03-30', 'ID'],
      ['Hari Raya Idul Fitri Day 2', '2026-03-31', 'ID'], ['Labour Day', '2026-05-01', 'ID'],
      ['Ascension of Jesus Christ', '2026-05-14', 'ID'], ['Vesak Day', '2026-05-24', 'ID'],
      ['Pancasila Day', '2026-06-01', 'ID'], ['Hari Raya Idul Adha', '2026-06-07', 'ID'],
      ['Islamic New Year', '2026-06-27', 'ID'], ['Independence Day', '2026-08-17', 'ID'],
      ["Prophet Muhammad's Birthday", '2026-09-06', 'ID'], ['Christmas Day', '2026-12-25', 'ID'],
      ["New Year's Day", '2026-01-01', 'CN'], ['Spring Festival Day 1', '2026-01-29', 'CN'],
      ['Spring Festival Day 2', '2026-01-30', 'CN'], ['Spring Festival Day 3', '2026-01-31', 'CN'],
      ['Spring Festival Day 4', '2026-02-01', 'CN'], ['Spring Festival Day 5', '2026-02-02', 'CN'],
      ['Qingming Festival', '2026-04-05', 'CN'], ['Labour Day', '2026-05-01', 'CN'],
      ['Labour Day Holiday', '2026-05-02', 'CN'], ['Labour Day Holiday', '2026-05-03', 'CN'],
      ['Dragon Boat Festival', '2026-06-19', 'CN'], ['Mid-Autumn Festival', '2026-09-26', 'CN'],
      ['National Day', '2026-10-01', 'CN'], ['National Day Holiday', '2026-10-02', 'CN'],
      ['National Day Holiday', '2026-10-03', 'CN'], ['National Day Holiday', '2026-10-04', 'CN'],
      ['National Day Holiday', '2026-10-05', 'CN'], ['National Day Holiday', '2026-10-06', 'CN'],
      ['National Day Holiday', '2026-10-07', 'CN'],
      ["New Year's Day", '2026-01-01', 'CN-GZ'], ['Spring Festival Day 1', '2026-01-29', 'CN-GZ'],
      ['Spring Festival Day 2', '2026-01-30', 'CN-GZ'], ['Spring Festival Day 3', '2026-01-31', 'CN-GZ'],
      ['Spring Festival Day 4', '2026-02-01', 'CN-GZ'], ['Spring Festival Day 5', '2026-02-02', 'CN-GZ'],
      ['Qingming Festival', '2026-04-05', 'CN-GZ'], ['Labour Day', '2026-05-01', 'CN-GZ'],
      ['Labour Day Holiday', '2026-05-02', 'CN-GZ'], ['Labour Day Holiday', '2026-05-03', 'CN-GZ'],
      ['Dragon Boat Festival', '2026-06-19', 'CN-GZ'], ['Mid-Autumn Festival', '2026-09-26', 'CN-GZ'],
      ['National Day', '2026-10-01', 'CN-GZ'], ['National Day Holiday', '2026-10-02', 'CN-GZ'],
      ['National Day Holiday', '2026-10-03', 'CN-GZ'], ['National Day Holiday', '2026-10-04', 'CN-GZ'],
      ['National Day Holiday', '2026-10-05', 'CN-GZ'], ['National Day Holiday', '2026-10-06', 'CN-GZ'],
      ['National Day Holiday', '2026-10-07', 'CN-GZ'],
      ["New Year's Day", '2026-01-01', 'CN-SH'], ['Spring Festival Day 1', '2026-01-29', 'CN-SH'],
      ['Spring Festival Day 2', '2026-01-30', 'CN-SH'], ['Spring Festival Day 3', '2026-01-31', 'CN-SH'],
      ['Spring Festival Day 4', '2026-02-01', 'CN-SH'], ['Spring Festival Day 5', '2026-02-02', 'CN-SH'],
      ['Qingming Festival', '2026-04-05', 'CN-SH'], ['Labour Day', '2026-05-01', 'CN-SH'],
      ['Labour Day Holiday', '2026-05-02', 'CN-SH'], ['Labour Day Holiday', '2026-05-03', 'CN-SH'],
      ['Dragon Boat Festival', '2026-06-19', 'CN-SH'], ['Mid-Autumn Festival', '2026-09-26', 'CN-SH'],
      ['National Day', '2026-10-01', 'CN-SH'], ['National Day Holiday', '2026-10-02', 'CN-SH'],
      ['National Day Holiday', '2026-10-03', 'CN-SH'], ['National Day Holiday', '2026-10-04', 'CN-SH'],
      ['National Day Holiday', '2026-10-05', 'CN-SH'], ['National Day Holiday', '2026-10-06', 'CN-SH'],
      ['National Day Holiday', '2026-10-07', 'CN-SH'],
      ["New Year's Day", '2026-01-01', 'AU'], ['Australia Day', '2026-01-26', 'AU'],
      ['Good Friday', '2026-04-03', 'AU'], ['Easter Saturday', '2026-04-04', 'AU'],
      ['Easter Sunday', '2026-04-05', 'AU'], ['Easter Monday', '2026-04-06', 'AU'],
      ['ANZAC Day', '2026-04-25', 'AU'], ["King's Birthday", '2026-06-08', 'AU'],
      ['Christmas Day', '2026-12-25', 'AU'], ['Boxing Day', '2026-12-26', 'AU'],
      ["New Year's Day", '2026-01-01', 'NZ'], ["New Year's Day (observed)", '2026-01-02', 'NZ'],
      ['Waitangi Day', '2026-02-06', 'NZ'], ['Good Friday', '2026-04-03', 'NZ'],
      ['Easter Monday', '2026-04-06', 'NZ'], ['ANZAC Day', '2026-04-25', 'NZ'],
      ["King's Birthday", '2026-06-01', 'NZ'], ['Matariki', '2026-06-26', 'NZ'],
      ['Labour Day', '2026-10-26', 'NZ'], ['Christmas Day', '2026-12-25', 'NZ'],
      ['Boxing Day', '2026-12-26', 'NZ'],
    ]

    for (const [name, date, regionCode] of holidays) {
      const regionId = regionMap[regionCode]
      if (regionId) {
        await client.query(
          'INSERT INTO public_holidays (name, date, region_id, is_recurring) VALUES ($1, $2, $3, false) ON CONFLICT DO NOTHING',
          [name, date, regionId]
        )
      }
    }
    console.log('[seed-base] Public holidays seeded')
    console.log('[seed-base] Base data seeding complete')
  } catch (err) {
    console.error('[seed-base] Error:', err)
  } finally {
    await client.end()
  }
}
