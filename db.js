import mysql from "mysql2/promise";

const DB_HOST = process.env.DB_HOST || "";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_NAME = process.env.DB_NAME || "";
const DB_USER = process.env.DB_USER || "";
const DB_PASSWORD = process.env.DB_PASSWORD || "";

let pool;
let initialized = false;

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const timestamp = Date.parse(`${value}T00:00:00`);
  return !Number.isNaN(timestamp);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeTripPayload(payload = {}) {
  const trip = {
    applicant: normalizeString(payload.applicant, "demo_user"),
    start_city: normalizeString(payload.start_city),
    arrival_city: normalizeString(payload.arrival_city),
    start_date: normalizeString(payload.start_date),
    end_date: normalizeString(payload.end_date),
    transport: normalizeString(payload.transport),
    reason: normalizeString(payload.reason),
    status: normalizeString(payload.status, "pending") || "pending",
  };

  const errors = [];

  if (!trip.start_city) {
    errors.push("start_city is required");
  }

  if (!trip.arrival_city) {
    errors.push("arrival_city is required");
  }

  if (!trip.transport) {
    errors.push("transport is required");
  }

  if (!trip.reason) {
    errors.push("reason is required");
  }

  if (!isValidDate(trip.start_date)) {
    errors.push("start_date must be YYYY-MM-DD");
  }

  if (!isValidDate(trip.end_date)) {
    errors.push("end_date must be YYYY-MM-DD");
  }

  if (isValidDate(trip.start_date) && isValidDate(trip.end_date)) {
    const start = Date.parse(`${trip.start_date}T00:00:00`);
    const end = Date.parse(`${trip.end_date}T00:00:00`);

    if (end < start) {
      errors.push("end_date must be later than or equal to start_date");
    }
  }

  if (errors.length > 0) {
    const error = new Error("Invalid trip payload");
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  return trip;
}

function ensureConfig() {
  const missing = [];

  if (!DB_HOST) {
    missing.push("DB_HOST");
  }

  if (!DB_NAME) {
    missing.push("DB_NAME");
  }

  if (!DB_USER) {
    missing.push("DB_USER");
  }

  if (!DB_PASSWORD) {
    missing.push("DB_PASSWORD");
  }

  if (missing.length > 0) {
    const error = new Error(`Missing database environment variables: ${missing.join(", ")}`);
    error.statusCode = 500;
    throw error;
  }
}

function getPool() {
  if (!pool) {
    ensureConfig();
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4",
      timezone: "local",
    });
  }

  return pool;
}

export async function initializeDatabase() {
  if (initialized) {
    return;
  }

  const connectionPool = getPool();

  await connectionPool.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      applicant VARCHAR(255) NOT NULL,
      start_city VARCHAR(255) NOT NULL,
      arrival_city VARCHAR(255) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      transport VARCHAR(255) NOT NULL,
      reason TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  initialized = true;
}

export async function createTrip(payload) {
  await initializeDatabase();

  const trip = normalizeTripPayload(payload);
  const connectionPool = getPool();
  const [result] = await connectionPool.execute(
    `
      INSERT INTO trips (
        applicant,
        start_city,
        arrival_city,
        start_date,
        end_date,
        transport,
        reason,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      trip.applicant,
      trip.start_city,
      trip.arrival_city,
      trip.start_date,
      trip.end_date,
      trip.transport,
      trip.reason,
      trip.status,
    ]
  );

  return getTripById(Number(result.insertId));
}

export async function listTrips() {
  await initializeDatabase();

  const connectionPool = getPool();
  const [rows] = await connectionPool.query(`
    SELECT
      id,
      applicant,
      start_city,
      arrival_city,
      DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
      transport,
      reason,
      status,
      DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
    FROM trips
    ORDER BY id DESC
  `);

  return rows;
}

export async function getTripById(id) {
  await initializeDatabase();

  const connectionPool = getPool();
  const [rows] = await connectionPool.execute(
    `
      SELECT
        id,
        applicant,
        start_city,
        arrival_city,
        DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
        transport,
        reason,
        status,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM trips
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

export function getDbInfo() {
  return {
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    configured: Boolean(DB_HOST && DB_NAME && DB_USER && DB_PASSWORD),
  };
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    initialized = false;
  }
}
