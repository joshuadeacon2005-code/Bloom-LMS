import * as XLSX from 'xlsx'

/**
 * Generate an XLSX buffer from an array of flat objects.
 * Column widths are auto-sized to the header label length + 2.
 */
export function generateXlsx(data: Record<string, unknown>[], sheetName: string): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(data)

  // Auto-fit column widths based on header length
  const headers = Object.keys(data[0] ?? {})
  worksheet['!cols'] = headers.map((h) => ({ wch: h.length + 2 }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return buffer as Buffer
}
