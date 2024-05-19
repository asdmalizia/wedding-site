const sqlite3 = require('sqlite3').verbose();

// Cria uma nova instância do banco de dados que aponta para o arquivo 'ecommerce.db'
const db = new sqlite3.Database('./ecommerce.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Connected to the ecommerce database.');
    }
});

// Usando db.serialize para garantir que os comandos sejam executados na ordem correta
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS purchased_items (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        purchased BOOLEAN NOT NULL DEFAULT 0,
        payment_status TEXT DEFAULT 'pending'
    )`, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
        } else {
            console.log('Table created successfully or already exists.');
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS pending_payments (
        external_reference TEXT PRIMARY KEY,
        email TEXT NOT NULL
    )`, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
        } else {
            console.log('Pending payments table created successfully or already exists.');
        }
    });
});

module.exports = db;
