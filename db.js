const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    // Initialize tables
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          whatsappId TEXT UNIQUE NOT NULL,
          joinedDate TEXT NOT NULL
        )
      `, (err) => {
        if (err) console.error('Error creating clients table:', err.message);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS work_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          orderId TEXT UNIQUE NOT NULL,
          whatsappId TEXT NOT NULL,
          serviceType TEXT,
          documentsSent TEXT,
          reason TEXT,
          userName TEXT,
          submissionDate TEXT,
          status TEXT,
          lastUpdated TEXT,
          notes TEXT
        )
      `, (err) => {
        if (err) console.error('Error creating work_orders table:', err.message);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS documents (
          documentId TEXT PRIMARY KEY,
          orderId TEXT NOT NULL,
          mimetype TEXT NOT NULL,
          filename TEXT NOT NULL,
          data TEXT,
          FOREIGN KEY (orderId) REFERENCES work_orders(orderId)
        )
      `, (err) => {
        if (err) console.error('Error creating documents table:', err.message);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          documents TEXT,
          charges TEXT
        )
      `, (err) => {
        if (err) console.error('Error creating services table:', err.message);
      });
    });
  }
});

module.exports = db;