const express = require('express');
const { authenticateUser, requireRole } = require('../middleware/auth.middleware');
const { ROLES } = require('../config/roles');
const candidateController = require('../controllers/candidate.controller');

const router = express.Router();

router.use(authenticateUser, requireRole(ROLES.CANDIDATE));

router.get('/interviews', candidateController.listMyInterviews);

module.exports = router;
