require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { APP_URL } = require('./config/app');
const authRoutes = require('./routes/auth.routes');
const hrRoutes = require('./routes/hr.routes');
const vacancyRoutes = require('./routes/vacancy.routes');
const publicRoutes = require('./routes/public.routes');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');

const app = express();

const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';

// Allow the signed-in app origin and the public application-page origin (the
// same host in the usual local setup, but APP_URL may differ in deployment).
const allowedOrigins = [...new Set([FRONTEND_URL, APP_URL])];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', authRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/vacancies', vacancyRoutes);
app.use('/api/public', publicRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
