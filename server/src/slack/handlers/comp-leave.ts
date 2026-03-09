import type { App, BlockAction } from '@slack/bolt'
import { randomUUID } from 'crypto'
import { addRequestToSheet } from '../google-sheets'
import * as dbService from '../db-service'
import { isAUNZRegion } from './utils'

// Work session interface for per-date timing
interface WorkSession {
  date: string
  startTime: string
  endTime: string
}

function buildWorkSessionBlocks(isAUNZ: boolean, sessionCount: number, existingSessions: WorkSession[] = []): any[] {
  const sessionBlocks: any[] = []

  for (let i = 1; i <= sessionCount; i++) {
    const existingSession = existingSessions[i - 1]
    const entryLabel = i === 1
      ? (isAUNZ ? 'Overtime Entry' : 'Work Entry')
      : `Entry ${i}`

    if (i > 1) {
      sessionBlocks.push({ type: 'divider' })
    }

    sessionBlocks.push({
      type: 'section',
      block_id: `entry_header_${i}`,
      text: { type: 'mrkdwn', text: `*${entryLabel}*` }
    })

    sessionBlocks.push({
      type: 'input',
      block_id: `date_of_work_${i}`,
      element: {
        type: 'datepicker',
        action_id: `date_picker_${i}`,
        ...(existingSession?.date ? { initial_date: existingSession.date } : {}),
        placeholder: { type: 'plain_text', text: 'Select date' }
      },
      label: { type: 'plain_text', text: 'Date' },
      optional: i > 1
    })

    sessionBlocks.push({
      type: 'input',
      block_id: `start_time_${i}`,
      element: {
        type: 'timepicker',
        action_id: `start_time_picker_${i}`,
        ...(existingSession?.startTime ? { initial_time: existingSession.startTime } : {}),
        placeholder: { type: 'plain_text', text: 'Start time' }
      },
      label: { type: 'plain_text', text: 'Start Time' },
      optional: i > 1
    })

    sessionBlocks.push({
      type: 'input',
      block_id: `end_time_${i}`,
      element: {
        type: 'timepicker',
        action_id: `end_time_picker_${i}`,
        ...(existingSession?.endTime ? { initial_time: existingSession.endTime } : {}),
        placeholder: { type: 'plain_text', text: 'End time' }
      },
      label: { type: 'plain_text', text: 'End Time' },
      optional: i > 1
    })
  }

  if (sessionCount < 10) {
    sessionBlocks.push({
      type: 'actions',
      block_id: 'add_date_action',
      elements: [
        {
          type: 'button',
          action_id: 'add_another_date',
          text: { type: 'plain_text', text: '+ Add another date/time entry' },
          style: 'primary'
        }
      ]
    })
  }

  return sessionBlocks
}

function buildModalBlocks(
  isAUNZ: boolean,
  userEmail: string,
  userName: string,
  sessionCount = 1,
  existingSessions: WorkSession[] = []
): any[] {
  const blocks: any[] = []

  const compensationOptions = isAUNZ
    ? [{ text: { type: 'plain_text' as const, text: 'Time In Lieu' }, value: 'TimeInLieu' }]
    : [
        { text: { type: 'plain_text' as const, text: 'Cash' }, value: 'Cash' },
        { text: { type: 'plain_text' as const, text: 'Leave' }, value: 'Leave' },
      ]

  blocks.push({
    type: 'input',
    block_id: 'compensation_type',
    element: {
      type: 'radio_buttons',
      action_id: 'comp_type_select',
      options: compensationOptions,
      initial_option: isAUNZ ? compensationOptions[0] : undefined
    },
    label: {
      type: 'plain_text',
      text: isAUNZ ? 'Compensation Type (Time In Lieu)' : 'Compensation Type'
    }
  })

  blocks.push({
    type: 'input',
    block_id: 'employee_email',
    element: {
      type: 'plain_text_input',
      action_id: 'email_input',
      initial_value: userEmail,
      placeholder: { type: 'plain_text', text: 'Enter your email' }
    },
    label: { type: 'plain_text', text: 'Employee Email' }
  })

  blocks.push({
    type: 'input',
    block_id: 'employee_name',
    element: {
      type: 'plain_text_input',
      action_id: 'name_input',
      initial_value: userName,
      placeholder: { type: 'plain_text', text: 'Enter your full name' }
    },
    label: { type: 'plain_text', text: isAUNZ ? 'Name of Employee' : 'Employee Name' }
  })

  blocks.push(...buildWorkSessionBlocks(isAUNZ, sessionCount, existingSessions))

  blocks.push({
    type: 'input',
    block_id: 'overtime_reason',
    element: {
      type: 'plain_text_input',
      action_id: 'overtime_reason_input',
      placeholder: { type: 'plain_text', text: 'e.g. Client deadline, Event support' }
    },
    label: { type: 'plain_text', text: 'Reason for Overtime' }
  })

  blocks.push({
    type: 'input',
    block_id: 'quantity',
    element: {
      type: 'number_input',
      action_id: 'quantity_input',
      is_decimal_allowed: !isAUNZ,
      min_value: isAUNZ ? '1' : '0.5',
      placeholder: { type: 'plain_text', text: isAUNZ ? 'Enter hours' : 'Enter days' }
    },
    label: { type: 'plain_text', text: isAUNZ ? 'Hours Requested' : 'Days Requested' },
    hint: {
      type: 'plain_text',
      text: isAUNZ ? 'Hours (1-20)' : 'Days requested (0.5-5). Increments of 0.5.'
    }
  })

  return blocks
}

export function registerCompLeaveHandlers(app: App) {
  // /comp-leave slash command
  app.command('/comp-leave', async ({ command, ack, client }) => {
    console.log('[comp-leave] Command received from user:', command.user_id)
    try {
      await ack()

      let userEmail = ''
      let userName = ''
      let isAUNZ = false

      // Get Slack profile info
      try {
        const userInfo = await client.users.info({ user: command.user_id })
        userEmail = userInfo.user?.profile?.email || ''
        userName = userInfo.user?.real_name || userInfo.user?.name || ''
      } catch (err) {
        console.error('[comp-leave] Error fetching Slack user info:', err)
      }

      // Look up DB user to determine region
      if (command.user_id) {
        try {
          const dbUser = await dbService.getUserBySlackId(command.user_id)
          if (dbUser) {
            isAUNZ = isAUNZRegion(dbUser.region.code)
            // Use DB email/name if Slack profile is empty
            if (!userEmail) userEmail = dbUser.email
            if (!userName) userName = dbUser.name
          } else if (userEmail) {
            // Fall back to email lookup
            const dbUserByEmail = await dbService.getUserByEmail(userEmail)
            if (dbUserByEmail) {
              isAUNZ = isAUNZRegion(dbUserByEmail.region.code)
            }
          }
        } catch (err) {
          console.error('[comp-leave] Error looking up DB user:', err)
        }
      }

      const modalBlocks = buildModalBlocks(isAUNZ, userEmail, userName)

      await client.views.open({
        trigger_id: command.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'comp_leave_modal',
          private_metadata: JSON.stringify({ isAUNZ, sessionCount: 1 }),
          title: { type: 'plain_text', text: 'Compensation Leave' },
          submit: { type: 'plain_text', text: 'Submit Request' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: modalBlocks
        }
      })
      console.log('[comp-leave] Modal opened successfully')
    } catch (error) {
      console.error('[comp-leave] Error opening modal:', error)
    }
  })

  // "Add another date" button
  app.action('add_another_date', async ({ ack, body, client }) => {
    try {
      await ack()

      const viewBody = body as any
      const view = viewBody.view
      const values = view.state.values
      const metadata = JSON.parse(view.private_metadata || '{}')
      const currentSessionCount = metadata.sessionCount || 1
      const newSessionCount = Math.min(currentSessionCount + 1, 10)
      const isAUNZ = metadata.isAUNZ || false

      const existingSessions: WorkSession[] = []
      for (let i = 1; i <= currentSessionCount; i++) {
        existingSessions.push({
          date: values[`date_of_work_${i}`]?.[`date_picker_${i}`]?.selected_date || '',
          startTime: values[`start_time_${i}`]?.[`start_time_picker_${i}`]?.selected_time || '',
          endTime: values[`end_time_${i}`]?.[`end_time_picker_${i}`]?.selected_time || '',
        })
      }

      const userEmail = values.employee_email?.email_input?.value || ''
      const userName = values.employee_name?.name_input?.value || ''

      const modalBlocks = buildModalBlocks(isAUNZ, userEmail, userName, newSessionCount, existingSessions)

      await client.views.update({
        view_id: view.id,
        view: {
          type: 'modal',
          callback_id: 'comp_leave_modal',
          private_metadata: JSON.stringify({ isAUNZ, sessionCount: newSessionCount }),
          title: { type: 'plain_text', text: 'Compensation Leave' },
          submit: { type: 'plain_text', text: 'Submit Request' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: modalBlocks
        }
      })
    } catch (error) {
      console.error('[comp-leave] Error adding entry:', error)
    }
  })

  // Modal submission
  app.view('comp_leave_modal', async ({ ack, body, view, client }) => {
    console.log('[comp-leave] Modal submitted by user:', body.user.id)

    const values = view.state.values
    const employeeEmail = values.employee_email.email_input.value || ''
    const employeeName = values.employee_name.name_input.value || ''
    const compensationType = values.compensation_type.comp_type_select.selected_option?.value as 'Cash' | 'Leave' | 'TimeInLieu'

    const metadata = JSON.parse(view.private_metadata || '{}')
    const sessionCount = metadata.sessionCount || 1
    const isAUNZFromMetadata = metadata.isAUNZ || false

    const workSessions: WorkSession[] = []
    for (let i = 1; i <= sessionCount; i++) {
      const dateValue = values[`date_of_work_${i}`]?.[`date_picker_${i}`]?.selected_date
      const startTime = values[`start_time_${i}`]?.[`start_time_picker_${i}`]?.selected_time || ''
      const endTime = values[`end_time_${i}`]?.[`end_time_picker_${i}`]?.selected_time || ''
      if (dateValue) {
        workSessions.push({ date: dateValue, startTime, endTime })
      }
    }

    const dateOfWork = workSessions[0]?.date || ''
    const overtimeStartTime = workSessions[0]?.startTime || ''
    const overtimeEndTime = workSessions[0]?.endTime || ''
    const overtimeReason = values.overtime_reason?.overtime_reason_input?.value || ''

    const rawQuantity = values.quantity?.quantity_input?.value
    const quantity = parseFloat(rawQuantity || '0')
    const days = compensationType === 'Cash' || compensationType === 'Leave' ? quantity : 0
    const hours = compensationType === 'TimeInLieu' ? quantity : 0

    // Validation
    const errors: Record<string, string> = {}

    if (workSessions.length === 0) {
      errors['date_of_work_1'] = 'Please select at least one date.'
    }

    if (compensationType === 'Cash' || compensationType === 'Leave') {
      if (!quantity || isNaN(quantity)) {
        errors['quantity'] = 'Please enter the number of days (0.5 - 5)'
      } else if (quantity < 0.5) {
        errors['quantity'] = 'Minimum value is 0.5 days.'
      } else if (quantity > 5) {
        errors['quantity'] = 'Maximum value is 5 days.'
      } else if ((quantity * 10) % 5 !== 0) {
        errors['quantity'] = 'Must be in increments of 0.5 days.'
      }
    }

    if (compensationType === 'TimeInLieu') {
      if (!quantity || isNaN(quantity)) {
        errors['quantity'] = 'Please enter the number of hours (1 - 20)'
      } else if (quantity < 1) {
        errors['quantity'] = 'Minimum value is 1 hour.'
      } else if (quantity > 20) {
        errors['quantity'] = 'Maximum value is 20 hours.'
      } else if (!Number.isInteger(quantity)) {
        errors['quantity'] = 'Hours must be whole numbers.'
      }
    }

    for (let i = 0; i < workSessions.length; i++) {
      const session = workSessions[i]
      const n = i + 1
      if (session.date) {
        if (!session.startTime) errors[`start_time_${n}`] = `Start time is required for entry ${n}.`
        if (!session.endTime) errors[`end_time_${n}`] = `End time is required for entry ${n}.`
        if (session.startTime && session.endTime) {
          const [sh, sm] = session.startTime.split(':').map(Number)
          const [eh, em] = session.endTime.split(':').map(Number)
          if (eh * 60 + em <= sh * 60 + sm) {
            errors[`end_time_${n}`] = 'End time must be after start time.'
          }
        }
      }
    }

    if (!workSessions[0]?.startTime) errors['start_time_1'] = 'Start time is required.'
    if (!workSessions[0]?.endTime) errors['end_time_1'] = 'End time is required.'

    if (isAUNZFromMetadata && compensationType !== 'TimeInLieu') {
      errors['compensation_type'] = 'AU/NZ employees can only request Time In Lieu.'
    }
    if (!isAUNZFromMetadata && compensationType === 'TimeInLieu') {
      errors['compensation_type'] = 'Time In Lieu is only available for AU/NZ employees.'
    }

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors } as any)
      return
    }

    await ack()

    try {
      const requestId = randomUUID()
      const dateCreated = new Date().toISOString()

      // Look up employee in DB to get region and supervisor
      const dbEmployee = await dbService.getUserByEmail(employeeEmail)
      let supervisorEmail = 'No supervisor assigned'
      let subsidiary = 'Unknown'

      if (dbEmployee) {
        subsidiary = dbEmployee.region.code
        const supEmail = await dbService.getSupervisorEmail(dbEmployee.id)
        if (supEmail) supervisorEmail = supEmail
      } else {
        console.warn(`[comp-leave] Employee not found in DB: ${employeeEmail}`)
      }

      // Secondary region validation
      const isAUNZRequest = isAUNZRegion(subsidiary)
      if (isAUNZRequest && compensationType !== 'TimeInLieu') {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'Your request could not be processed. AU/NZ employees can only request Time In Lieu.'
        })
        return
      }
      if (!isAUNZRequest && compensationType === 'TimeInLieu') {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'Your request could not be processed. Time In Lieu is only available for AU/NZ employees.'
        })
        return
      }

      // Log to Google Sheets
      const requestData = {
        requestId,
        staffName: employeeName,
        staffEmail: employeeEmail,
        subsidiary,
        compensationType,
        leaveDays: compensationType === 'Leave' || compensationType === 'Cash' ? days : undefined,
        timeInLieuHours: compensationType === 'TimeInLieu' ? hours : undefined,
        dateOfWork,
        reason: overtimeReason,
        supervisorEmail,
        status: 'Pending' as const,
        dateCreated,
      }

      await addRequestToSheet(requestData)

      // Send DM to supervisor
      if (supervisorEmail !== 'No supervisor assigned') {
        try {
          const supervisorSlackUser = await client.users.lookupByEmail({ email: supervisorEmail })
          if (supervisorSlackUser.user?.id) {
            const sessionsDisplay = workSessions.length > 1
              ? workSessions.map(s => `• ${s.date}: ${s.startTime} \u2013 ${s.endTime}`).join('\n')
              : `${dateOfWork}: ${overtimeStartTime} \u2013 ${overtimeEndTime}`

            const quantityField = compensationType === 'TimeInLieu'
              ? { type: 'mrkdwn' as const, text: `*Hours:*\n${hours} hours` }
              : { type: 'mrkdwn' as const, text: `*Days:*\n${days} days` }

            await client.chat.postMessage({
              channel: supervisorSlackUser.user.id,
              text: `New Compensation Request from ${employeeName}`,
              blocks: [
                { type: 'header', text: { type: 'plain_text', text: 'New Compensation Request' } },
                { type: 'divider' },
                {
                  type: 'section',
                  fields: [
                    { type: 'mrkdwn', text: `*Employee:*\n${employeeName} (${employeeEmail})` },
                    { type: 'mrkdwn', text: `*Type:*\n${compensationType === 'TimeInLieu' ? 'Time In Lieu' : compensationType}` },
                    { type: 'mrkdwn', text: `*${workSessions.length > 1 ? 'Work Sessions' : 'Date & Time'}:*\n${sessionsDisplay}` },
                    quantityField,
                  ]
                },
                { type: 'section', text: { type: 'mrkdwn', text: `*Reason for Overtime:*\n> ${overtimeReason}` } },
                { type: 'divider' },
                {
                  type: 'actions',
                  block_id: 'approval_actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: 'Approve Request' },
                      style: 'primary',
                      action_id: 'approve_request',
                      value: requestId,
                    },
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: 'Reject Request' },
                      style: 'danger',
                      action_id: 'reject_request',
                      value: requestId,
                    },
                  ]
                }
              ]
            })
          }
        } catch (err) {
          console.error('[comp-leave] Error sending DM to supervisor:', err)
        }
      }

      // Confirm to employee
      const empSessDisplay = workSessions.length > 1
        ? workSessions.map(s => `• ${s.date}: ${s.startTime} \u2013 ${s.endTime}`).join('\n')
        : `${dateOfWork}: ${overtimeStartTime} \u2013 ${overtimeEndTime}`

      const empQtyField = compensationType === 'TimeInLieu'
        ? { type: 'mrkdwn' as const, text: `*Hours:*\n${hours}` }
        : { type: 'mrkdwn' as const, text: `*Days:*\n${days}` }

      await client.chat.postMessage({
        channel: body.user.id,
        text: 'Your compensation request has been submitted successfully!',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Request Submitted Successfully' } },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Your compensation request has been submitted and *${supervisorEmail !== 'No supervisor assigned' ? 'your supervisor has been notified' : 'is pending supervisor assignment'}*.\n\nPlease wait for your supervisor's decision. You will receive a notification once reviewed.`
            }
          },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: '*Request Details:*' } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Request ID:*\n${requestId}` },
              { type: 'mrkdwn', text: `*Status:*\nPending Approval` },
              { type: 'mrkdwn', text: `*Type:*\n${compensationType === 'TimeInLieu' ? 'Time In Lieu' : compensationType}` },
              empQtyField,
              { type: 'mrkdwn', text: `*${workSessions.length > 1 ? 'Work Sessions' : 'Date & Time'}:*\n${empSessDisplay}` },
              { type: 'mrkdwn', text: `*Supervisor:*\n${supervisorEmail !== 'No supervisor assigned' ? supervisorEmail : 'Not assigned yet'}` },
            ]
          }
        ]
      })
    } catch (error) {
      console.error('[comp-leave] Error handling modal submission:', error)
    }
  })
}
