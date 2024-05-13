const sqlite3 = require('sqlite3').verbose();

// Cria uma nova instância do banco de dados que aponta para o arquivo 'ecommerce.db'
const db = new sqlite3.Database('./ecommerce.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the ecommerce database.');
});

// Usando db.serialize para garantir que os comandos sejam executados na ordem correta

db.serialize(() => {
    db.run("DROP TABLE IF EXISTS purchased_items", (err) => {
        if (err) {
            console.error('Error dropping table:', err.message);
        } else {
            console.log('Table dropped successfully.');
            db.run(`CREATE TABLE purchased_items (
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
                    console.log('Table created successfully.');
                }
            });
        }
    });
});


module.exports = db;
