import { Router } from 'express'
import authRouter from './auth'
import usersRouter from './users'
import leaveRouter from './leave'
import approvalsRouter from './approvals'
import balancesRouter from './balances'
import adminRouter from './admin'
import notificationsRouter from './notifications'
import reportsRouter from './reports'

const router = Router()

router.use('/auth', authRouter)
router.use('/users', usersRouter)
router.use('/leave', leaveRouter)
router.use('/approvals', approvalsRouter)
router.use('/balances', balancesRouter)
router.use('/admin', adminRouter)
router.use('/notifications', notificationsRouter)
router.use('/reports', reportsRouter)

export default router
