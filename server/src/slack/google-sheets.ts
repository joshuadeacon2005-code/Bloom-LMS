import { google } from 'googleapis';

let sheetsClient: any = null;

async function getGoogleSheetsClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!serviceAccountKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable is required. Set it to the JSON content of your service account key file.');
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountKey);
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must be valid JSON. Make sure to set the entire JSON content of your service account key file.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  console.log('[sheets] Google Sheets client initialized with service account');

  return sheetsClient;
}

export interface CompensationRequest {
  requestId: string;
  staffName: string;
  jobTitle?: string;
  staffEmail: string;
  subsidiary: string;
  compensationType: 'Cash' | 'Leave' | 'Overtime' | 'TimeInLieu';
  leaveDays?: number;
  overtimeHours?: number;
  timeInLieuHours?: number;
  dateOfWork: string;
  reason: string;
  supervisorEmail: string;
  status: 'Pending' | 'Supervisor Approved' | 'Approved' | 'Rejected';
  dateCreated: string;
  calamariCredited?: string;
}

function getSheetNameForSubsidiary(subsidiary: string): string {
  const auNzRegions = ['AU', 'NZ'];
  return auNzRegions.includes(subsidiary) ? 'AU-NZ Requests' : 'Other Regions';
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface LeaveRequestRow {
  requestId: number;
  employeeName: string;
  email: string;
  regionCode: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  reason: string;
  status: string;
  submittedDate: string;
}

export interface BalanceWithAvailable {
  leaveType?: { name: string };
  year: number;
  entitled: number;
  used: number;
  pending: number;
  carried: number;
  adjustments: number;
  available: number;
}

// ──────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────

async function ensureSheetWithHeaders(
  sheets: any,
  spreadsheetId: string,
  tabName: string,
  headers: string[]
): Promise<void> {
  const endCol = String.fromCharCode(64 + headers.length);
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:${endCol}1`,
    });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1:${endCol}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      });
      console.log(`[sheets] ${tabName} headers written`);
    }
  } catch (err: any) {
    if (err.message?.includes('Unable to parse range')) {
      // Tab doesn't exist yet — create it then write headers
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const existing: string[] =
        spreadsheet.data.sheets?.map((s: any) => s.properties?.title) ?? [];
      if (!existing.includes(tabName)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
        });
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1:${endCol}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      });
      console.log(`[sheets] ${tabName} tab created and headers written`);
    } else {
      throw err;
    }
  }
}

// ──────────────────────────────────────────────────────────────
// Sheet initialisation
// ──────────────────────────────────────────────────────────────

const APPROVAL_LOG_HEADERS = [
  'Timestamp', 'Request ID', 'Employee Name', 'Email', 'Region',
  'Leave Type', 'Start Date', 'End Date', 'Working Days',
  'Action', 'Approver Name', 'Comments',
];

const BALANCE_ADJUSTMENTS_HEADERS = [
  'Timestamp', 'Employee Name', 'Email', 'Region',
  'Leave Type', 'Adjustment Type', 'Days', 'Hours (TIL only)', 'Reference ID',
];

const EMPLOYEE_DIRECTORY_HEADERS = [
  'Employee ID', 'Name', 'Email', 'Region', 'Role',
  'Manager Name', 'Slack ID', 'Status', 'Created At',
];

const LEAVE_REQUESTS_HEADERS = [
  'Request ID', 'Employee Name', 'Email', 'Region', 'Leave Type',
  'Start Date', 'End Date', 'Working Days', 'Reason', 'Status',
  'Submitted Date', 'Approver', 'Action Date',
];

const LEAVE_BALANCES_HEADERS = [
  'Employee Name', 'Email', 'Region', 'Leave Type', 'Year',
  'Entitled Days', 'Used Days', 'Pending Days', 'Carried Over', 'Adjustments',
  'Available Days', 'Last Updated',
];

async function initializeLeaveRequestsSheet(sheets: any, spreadsheetId: string): Promise<void> {
  await ensureSheetWithHeaders(sheets, spreadsheetId, 'Leave Requests', LEAVE_REQUESTS_HEADERS);
}

async function initializeBalancesSheet(sheets: any, spreadsheetId: string): Promise<void> {
  await ensureSheetWithHeaders(sheets, spreadsheetId, 'Leave Balances', LEAVE_BALANCES_HEADERS);
}

export async function initializeSheet() {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      console.error('[sheets] GOOGLE_SPREADSHEET_ID not set. Google Sheets logging disabled.');
      return;
    }

    const sheets = await getGoogleSheetsClient();

    try {
      const auNzResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'AU-NZ Requests!A1:O1',
      });

      if (!auNzResponse.data.values || auNzResponse.data.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'AU-NZ Requests!A1:O1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [[
              'Request ID',
              'Staff Name',
              'Job Title',
              'Staff Email',
              'Subsidiary',
              'Compensation Type',
              'Leave Days',
              'Overtime Hours',
              'Time In Lieu Hours',
              'Date of Work',
              'Reason',
              'Supervisor Email',
              'Status',
              'Date Created',
              'DB Credited'
            ]]
          }
        });
        console.log('[sheets] AU-NZ Requests sheet headers initialized');
      }
    } catch (error: any) {
      if (error.message?.includes('Unable to parse range')) {
        console.log('[sheets] AU-NZ Requests sheet does not exist, creating...');
        try {
          const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
          const existingSheets = spreadsheet.data.sheets?.map((s: any) => s.properties?.title) || [];

          if (!existingSheets.includes('AU-NZ Requests')) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: {
                requests: [{
                  addSheet: {
                    properties: { title: 'AU-NZ Requests' }
                  }
                }]
              }
            });
          }

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'AU-NZ Requests!A1:O1',
            valueInputOption: 'RAW',
            requestBody: {
              values: [[
                'Request ID',
                'Staff Name',
                'Job Title',
                'Staff Email',
                'Subsidiary',
                'Compensation Type',
                'Leave Days',
                'Overtime Hours',
                'Time In Lieu Hours',
                'Date of Work',
                'Reason',
                'Supervisor Email',
                'Status',
                'Date Created',
                'DB Credited'
              ]]
            }
          });
          console.log('[sheets] AU-NZ Requests sheet created and initialized');
        } catch (createError) {
          console.error('[sheets] Error creating AU-NZ Requests sheet:', createError);
        }
      }
    }

    try {
      const otherResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Other Regions!A1:N1',
      });

      if (!otherResponse.data.values || otherResponse.data.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Other Regions!A1:N1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [[
              'Request ID',
              'Staff Name',
              'Staff Email',
              'Subsidiary',
              'Compensation Type',
              'Leave Days',
              'Overtime Hours',
              'Time In Lieu Hours',
              'Date of Work',
              'Reason',
              'Supervisor Email',
              'Status',
              'Date Created',
              'DB Credited'
            ]]
          }
        });
        console.log('[sheets] Other Regions sheet headers initialized');
      }
    } catch (error: any) {
      if (error.message?.includes('Unable to parse range')) {
        console.log('[sheets] Other Regions sheet does not exist, creating...');
        try {
          const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
          const existingSheets = spreadsheet.data.sheets?.map((s: any) => s.properties?.title) || [];

          if (!existingSheets.includes('Other Regions')) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: {
                requests: [{
                  addSheet: {
                    properties: { title: 'Other Regions' }
                  }
                }]
              }
            });
          }

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Other Regions!A1:N1',
            valueInputOption: 'RAW',
            requestBody: {
              values: [[
                'Request ID',
                'Staff Name',
                'Staff Email',
                'Subsidiary',
                'Compensation Type',
                'Leave Days',
                'Overtime Hours',
                'Time In Lieu Hours',
                'Date of Work',
                'Reason',
                'Supervisor Email',
                'Status',
                'Date Created',
                'DB Credited'
              ]]
            }
          });
          console.log('[sheets] Other Regions sheet created and initialized');
        } catch (createError) {
          console.error('[sheets] Error creating Other Regions sheet:', createError);
        }
      }
    }

    await initializeLeaveRequestsSheet(sheets, spreadsheetId).catch((e) =>
      console.error('[sheets] Error initialising Leave Requests tab:', e)
    );
    await initializeBalancesSheet(sheets, spreadsheetId).catch((e) =>
      console.error('[sheets] Error initialising Leave Balances tab:', e)
    );
    await ensureSheetWithHeaders(sheets, spreadsheetId, 'Approval Log', APPROVAL_LOG_HEADERS).catch((e) =>
      console.error('[sheets] Error initialising Approval Log tab:', e)
    );
    await ensureSheetWithHeaders(sheets, spreadsheetId, 'Balance Adjustments', BALANCE_ADJUSTMENTS_HEADERS).catch((e) =>
      console.error('[sheets] Error initialising Balance Adjustments tab:', e)
    );
    await ensureSheetWithHeaders(sheets, spreadsheetId, 'Employee Directory', EMPLOYEE_DIRECTORY_HEADERS).catch((e) =>
      console.error('[sheets] Error initialising Employee Directory tab:', e)
    );

    console.log('[sheets] Google Sheets initialized successfully');
  } catch (error) {
    console.error('[sheets] Error initializing Google Sheets:', error);
  }
}

export async function addRequestToSheet(request: CompensationRequest): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      console.error('[sheets] GOOGLE_SPREADSHEET_ID not set.');
      return false;
    }

    const sheets = await getGoogleSheetsClient();
    const sheetName = getSheetNameForSubsidiary(request.subsidiary);
    const isAUNZ = sheetName === 'AU-NZ Requests';

    const rowData = isAUNZ
      ? [
          request.requestId,
          request.staffName,
          request.jobTitle || '',
          request.staffEmail,
          request.subsidiary,
          request.compensationType,
          request.leaveDays?.toString() || '',
          request.overtimeHours?.toString() || '',
          request.timeInLieuHours?.toString() || '',
          request.dateOfWork,
          request.reason,
          request.supervisorEmail,
          request.status,
          request.dateCreated,
          ''
        ]
      : [
          request.requestId,
          request.staffName,
          request.staffEmail,
          request.subsidiary,
          request.compensationType,
          request.leaveDays?.toString() || '',
          request.overtimeHours?.toString() || '',
          request.timeInLieuHours?.toString() || '',
          request.dateOfWork,
          request.reason,
          request.supervisorEmail,
          request.status,
          request.dateCreated,
          ''
        ];

    const range = isAUNZ ? `${sheetName}!A:O` : `${sheetName}!A:N`;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData]
      }
    });

    console.log(`[sheets] Request ${request.requestId} added to ${sheetName}`);
    return true;
  } catch (error) {
    console.error('[sheets] Error adding request to sheet:', error);
    return false;
  }
}

export async function updateRequestStatus(
  requestId: string,
  newStatus: string,
  expectedOldStatus?: string
): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      console.error('[sheets] GOOGLE_SPREADSHEET_ID not set.');
      return false;
    }

    const sheets = await getGoogleSheetsClient();

    const sheetsToSearch = ['AU-NZ Requests', 'Other Regions'];

    for (const sheetName of sheetsToSearch) {
      try {
        const isAUNZ = sheetName === 'AU-NZ Requests';
        const statusColumn = isAUNZ ? 'M' : 'L';
        const range = `${sheetName}!A:${statusColumn}`;

        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });

        const rows = response.data.values || [];
        const rowIndex = rows.findIndex((row: any) => row[0] === requestId);

        if (rowIndex !== -1) {
          const statusColIndex = isAUNZ ? 12 : 11;
          const currentStatus = rows[rowIndex][statusColIndex] || '';

          if (expectedOldStatus && currentStatus !== expectedOldStatus) {
            console.log(`[sheets] Status update rejected for ${requestId}: expected "${expectedOldStatus}" but found "${currentStatus}"`);
            return false;
          }

          const statusRange = `${sheetName}!${statusColumn}${rowIndex + 1}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: statusRange,
            valueInputOption: 'RAW',
            requestBody: {
              values: [[newStatus]]
            }
          });

          console.log(`[sheets] Status updated to ${newStatus} for request ${requestId} in ${sheetName}`);
          return true;
        }
      } catch (error: any) {
        if (!error.message?.includes('Unable to parse range')) {
          throw error;
        }
      }
    }

    console.error(`[sheets] Request ${requestId} not found in any sheet`);
    return false;
  } catch (error) {
    console.error('[sheets] Error updating request status:', error);
    return false;
  }
}

export async function updateRequestValues(
  requestId: string,
  updates: {
    leaveDays?: number;
    overtimeHours?: number;
    timeInLieuHours?: number;
    status?: string;
  }
): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      console.error('[sheets] GOOGLE_SPREADSHEET_ID not set.');
      return false;
    }

    const sheets = await getGoogleSheetsClient();

    const sheetsToSearch = ['AU-NZ Requests', 'Other Regions'];

    for (const sheetName of sheetsToSearch) {
      try {
        const isAUNZ = sheetName === 'AU-NZ Requests';
        const endCol = isAUNZ ? 'O' : 'N';
        const range = `${sheetName}!A:${endCol}`;

        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });

        const rows = response.data.values || [];
        const rowIndex = rows.findIndex((row: any) => row[0] === requestId);

        if (rowIndex !== -1) {
          const currentRow = rows[rowIndex];

          if (isAUNZ) {
            if (updates.leaveDays !== undefined) currentRow[6] = updates.leaveDays.toString();
            if (updates.overtimeHours !== undefined) currentRow[7] = updates.overtimeHours.toString();
            if (updates.timeInLieuHours !== undefined) currentRow[8] = updates.timeInLieuHours.toString();
            if (updates.status !== undefined) currentRow[12] = updates.status;
          } else {
            if (updates.leaveDays !== undefined) currentRow[5] = updates.leaveDays.toString();
            if (updates.overtimeHours !== undefined) currentRow[6] = updates.overtimeHours.toString();
            if (updates.timeInLieuHours !== undefined) currentRow[7] = updates.timeInLieuHours.toString();
            if (updates.status !== undefined) currentRow[11] = updates.status;
          }

          const updateRange = `${sheetName}!A${rowIndex + 1}:${endCol}${rowIndex + 1}`;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: updateRange,
            valueInputOption: 'RAW',
            requestBody: {
              values: [currentRow]
            }
          });

          console.log(`[sheets] Request ${requestId} updated in ${sheetName}`);
          return true;
        }
      } catch (error: any) {
        if (!error.message?.includes('Unable to parse range')) {
          throw error;
        }
      }
    }

    console.error(`[sheets] Request ${requestId} not found in any sheet`);
    return false;
  } catch (error) {
    console.error('[sheets] Error updating request values:', error);
    return false;
  }
}

export async function getRequestById(requestId: string): Promise<CompensationRequest | null> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      console.error('[sheets] GOOGLE_SPREADSHEET_ID not set.');
      return null;
    }

    const sheets = await getGoogleSheetsClient();

    const sheetsToSearch = ['AU-NZ Requests', 'Other Regions'];

    for (const sheetName of sheetsToSearch) {
      try {
        const isAUNZ = sheetName === 'AU-NZ Requests';
        const endCol = isAUNZ ? 'O' : 'N';
        const range = `${sheetName}!A:${endCol}`;

        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });

        const rows = response.data.values || [];
        const row = rows.find((row: any) => row[0] === requestId);

        if (row) {
          if (isAUNZ) {
            return {
              requestId: row[0],
              staffName: row[1],
              jobTitle: row[2] || undefined,
              staffEmail: row[3],
              subsidiary: row[4],
              compensationType: row[5] as any,
              leaveDays: row[6] ? parseFloat(row[6]) : undefined,
              overtimeHours: row[7] ? parseFloat(row[7]) : undefined,
              timeInLieuHours: row[8] ? parseFloat(row[8]) : undefined,
              dateOfWork: row[9],
              reason: row[10],
              supervisorEmail: row[11],
              status: row[12] as any,
              dateCreated: row[13],
              calamariCredited: row[14] || undefined
            };
          } else {
            return {
              requestId: row[0],
              staffName: row[1],
              staffEmail: row[2],
              subsidiary: row[3],
              compensationType: row[4] as any,
              leaveDays: row[5] ? parseFloat(row[5]) : undefined,
              overtimeHours: row[6] ? parseFloat(row[6]) : undefined,
              timeInLieuHours: row[7] ? parseFloat(row[7]) : undefined,
              dateOfWork: row[8],
              reason: row[9],
              supervisorEmail: row[10],
              status: row[11] as any,
              dateCreated: row[12],
              calamariCredited: row[13] || undefined
            };
          }
        }
      } catch (error: any) {
        if (!error.message?.includes('Unable to parse range')) {
          throw error;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('[sheets] Error getting request by ID:', error);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Leave Requests tab
// ──────────────────────────────────────────────────────────────

export async function addLeaveRequestToSheet(data: LeaveRequestRow): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return false;

    const sheets = await getGoogleSheetsClient();
    const row = [
      data.requestId.toString(),
      data.employeeName,
      data.email,
      data.regionCode,
      data.leaveTypeName,
      data.startDate,
      data.endDate,
      data.workingDays.toString(),
      data.reason,
      data.status,
      data.submittedDate,
      '', // Approver — filled on action
      '', // Action Date — filled on action
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Leave Requests!A:M',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    console.log(`[sheets] Leave request ${data.requestId} added to Leave Requests tab`);
    return true;
  } catch (error) {
    console.error('[sheets] Error adding leave request to sheet:', error);
    return false;
  }
}

export async function updateLeaveRequestInSheet(
  requestId: number,
  newStatus: string,
  approverName?: string,
  actionDate?: string
): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return false;

    const sheets = await getGoogleSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Leave Requests!A:M',
    });

    const rows: string[][] = res.data.values ?? [];
    const rowIndex = rows.findIndex((r) => r[0] === requestId.toString());
    if (rowIndex === -1) {
      console.warn(`[sheets] Leave request ${requestId} not found in Leave Requests tab`);
      return false;
    }

    const updates: [string, string][] = [
      [`Leave Requests!J${rowIndex + 1}`, newStatus],
    ];
    if (approverName !== undefined) {
      updates.push([`Leave Requests!L${rowIndex + 1}`, approverName]);
    }
    if (actionDate !== undefined) {
      updates.push([`Leave Requests!M${rowIndex + 1}`, actionDate]);
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates.map(([range, value]) => ({ range, values: [[value]] })),
      },
    });

    console.log(`[sheets] Leave request ${requestId} updated to status "${newStatus}"`);
    return true;
  } catch (error) {
    console.error('[sheets] Error updating leave request in sheet:', error);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Leave Balances tab (upsert by email + leave type + year)
// ──────────────────────────────────────────────────────────────

export async function upsertEmployeeBalancesInSheet(
  employeeName: string,
  email: string,
  regionCode: string,
  balances: BalanceWithAvailable[]
): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return false;

    const sheets = await getGoogleSheetsClient();
    const now = new Date().toISOString();

    // Read existing rows
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Leave Balances!A:L',
    });
    const rows: string[][] = res.data.values ?? [];

    const updateData: { range: string; values: string[][] }[] = [];
    const appendRows: string[][] = [];

    for (const bal of balances) {
      const leaveTypeName = bal.leaveType?.name ?? 'Unknown';
      const year = bal.year.toString();

      const newRow = [
        employeeName,
        email,
        regionCode,
        leaveTypeName,
        year,
        bal.entitled.toString(),
        bal.used.toString(),
        bal.pending.toString(),
        bal.carried.toString(),
        bal.adjustments.toString(),
        bal.available.toString(),
        now,
      ];

      // Match by email (col B=index 1), leave type (col D=index 3), year (col E=index 4)
      const existingIndex = rows.findIndex(
        (r) => r[1] === email && r[3] === leaveTypeName && r[4] === year
      );

      if (existingIndex !== -1) {
        updateData.push({
          range: `Leave Balances!A${existingIndex + 1}:L${existingIndex + 1}`,
          values: [newRow],
        });
      } else {
        appendRows.push(newRow);
      }
    }

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: updateData },
      });
    }

    if (appendRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Leave Balances!A:L',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: appendRows },
      });
    }

    console.log(`[sheets] Balances upserted for ${email} (${balances.length} leave types)`);
    return true;
  } catch (error) {
    console.error('[sheets] Error upserting employee balances:', error);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Approval Log tab
// ──────────────────────────────────────────────────────────────

export interface ApprovalLogRow {
  requestId: number;
  employeeName: string;
  email: string;
  regionCode: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  action: 'Approved' | 'Rejected' | 'Pending (Next Level)';
  approverName: string;
  comments?: string;
}

export async function logApprovalAction(data: ApprovalLogRow): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return false;

    const sheets = await getGoogleSheetsClient();
    const row = [
      new Date().toISOString(),
      data.requestId.toString(),
      data.employeeName,
      data.email,
      data.regionCode,
      data.leaveTypeName,
      data.startDate,
      data.endDate,
      data.workingDays.toString(),
      data.action,
      data.approverName,
      data.comments ?? '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Approval Log!A:L',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    console.log(`[sheets] Approval action logged: ${data.action} for request ${data.requestId}`);
    return true;
  } catch (error) {
    console.error('[sheets] Error logging approval action:', error);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Balance Adjustments tab
// ──────────────────────────────────────────────────────────────

export interface BalanceAdjustmentRow {
  employeeName: string;
  email: string;
  regionCode: string;
  leaveTypeName: string;
  adjustmentType: 'TIL Credit' | 'Comp Credit' | 'Leave Used' | 'Manual';
  days: number;
  hours?: number;
  referenceId?: string | number;
}

export async function logBalanceAdjustment(data: BalanceAdjustmentRow): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return false;

    const sheets = await getGoogleSheetsClient();
    const row = [
      new Date().toISOString(),
      data.employeeName,
      data.email,
      data.regionCode,
      data.leaveTypeName,
      data.adjustmentType,
      data.days.toString(),
      data.hours !== undefined ? data.hours.toString() : '',
      data.referenceId !== undefined ? data.referenceId.toString() : '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Balance Adjustments!A:I',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    console.log(`[sheets] Balance adjustment logged: ${data.adjustmentType} for ${data.email}`);
    return true;
  } catch (error) {
    console.error('[sheets] Error logging balance adjustment:', error);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Employee Directory tab (full refresh)
// ──────────────────────────────────────────────────────────────

export interface EmployeeDirectoryRow {
  id: number;
  name: string;
  email: string;
  regionCode: string;
  role: string;
  managerName?: string;
  slackUserId?: string | null;
  isActive: boolean;
  createdAt: string;
}

export async function syncEmployeeDirectory(employees: EmployeeDirectoryRow[]): Promise<boolean> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return false;

    const sheets = await getGoogleSheetsClient();

    // Clear all data rows (keep header row 1)
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Employee Directory!A2:I',
    });

    if (employees.length === 0) return true;

    const rows = employees.map((e) => [
      e.id.toString(),
      e.name,
      e.email,
      e.regionCode,
      e.role,
      e.managerName ?? '',
      e.slackUserId ?? '',
      e.isActive ? 'Active' : 'Inactive',
      e.createdAt,
    ]);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Employee Directory!A2',
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });

    console.log(`[sheets] Employee Directory synced (${employees.length} employees)`);
    return true;
  } catch (error) {
    console.error('[sheets] Error syncing employee directory:', error);
    return false;
  }
}
