require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { APP_URL } = require('./config/app');
const { isAllowedOrigin } = require('./config/cors');
const { isScreeningConfigured } = require('./config/aiOptions');
const authRoutes = require('./routes/auth.routes');
const hrRoutes = require('./routes/hr.routes');
const vacancyRoutes = require('./routes/vacancy.routes');
const applicationRoutes = require('./routes/application.routes');
const publicRoutes = require('./routes/public.routes');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');

const app = express();

const PORT = process.env.PORT || 5000;

// CORS: allow the configured origin(s) plus any localhost / private-LAN origin,
// so the static frontend works from 127.0.0.1, "localhost" or the machine's LAN
// IP on any laptop without per-machine configuration. See config/cors.js.
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
  })
);
app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', authRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/vacancies', vacancyRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/public', publicRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`CORS: configured origins = ${APP_URL}; localhost + private LAN origins are also allowed`);
  console.log(
    `PB-05 AI CV screening: ${
      isScreeningConfigured()
        ? 'enabled'
        : 'inactive (no AI provider credentials / disabled) — screenings stay pending'
    }`
  );
});
