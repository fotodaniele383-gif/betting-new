// reset_db.js - Script di Pulizia
const sqlite3 = require('better-sqlite3');
const db = new sqlite3('database_betting.db');

console.log("🧹 Avvio pulizia del database...");

// Svuota le tabelle delle scommesse
db.prepare('DELETE FROM ai_forward_test').run();
db.prepare('DELETE FROM historical_bets').run();

// Resetta gli ID contatori a zero
db.prepare('DELETE FROM sqlite_sequence WHERE name="ai_forward_test"').run();
db.prepare('DELETE FROM sqlite_sequence WHERE name="historical_bets"').run();

console.log("✅ Database azzerato con successo! Il Paper Trading è vuoto. I parametri di Setup sono intatti.");