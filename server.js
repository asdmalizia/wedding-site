const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config.json');
const helmet = require('helmet');
const axios = require('axios');

// Caminho para o banco de dados SQLite
const dbPath = path.resolve(__dirname, 'data', 'ecommerce.db');

// Configurar Google Drive API
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const credentials = require('./credentials.json');

const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

MercadoPago.configure({
    access_token: config.mercadoPagoAccessToken
});

const app = express();


app.use(helmet.contentSecurityPolicy({
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
            "'self'",
            "https://http2.mlstatic.com",
            "https://maps.googleapis.com",
            "https://sdk.mercadopago.com/js/v2",
            "https://apis.google.com",
            "https://www.youtube.com",
            "'unsafe-inline'",
            "'unsafe-eval'",
            "'nonce-oNZMR6yDOmJFaX5IMT8KCg=='"
        ],
        imgSrc: ["'self'", "data:", "*"],
        connectSrc: ["'self'", "https://maps.googleapis.com", "https://*.youtube.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameSrc: ["https://www.youtube.com", "https://maps.google.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
    },
    reportOnly: true
}));

app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Conectar ao banco de dados SQLite
let db;
function connectDatabase() {
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Erro ao conectar ao banco de dados SQLite:', err.message);
        } else {
            console.log('Conectado ao banco de dados SQLite.');
        }
    });

    db.all("SELECT id FROM purchased_items", (error, result) => {
        if (error) {
            console.error("Erro ao buscar dados:", error);
            return;
        }
        console.log(result);})
}

// Função para inicializar o banco de dados local
function initializeLocalDatabase() {
    connectDatabase();

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
                console.error('Erro ao criar tabela purchased_items:', err.message);
            } else {
                console.log('Tabela purchased_items criada ou já existe.');
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS pending_payments (
            external_reference TEXT PRIMARY KEY,
            email TEXT NOT NULL
        )`, (err) => {
            if (err) {
                console.error('Erro ao criar tabela pending_payments:', err.message);
            } else {
                console.log('Tabela pending_payments criada ou já existe.');
            }
        });
    });

    db.close();
}

// Função para verificar se o arquivo de banco de dados é válido
function isValidDatabase(filePath) {
    try {
        const tempDb = new sqlite3.Database(filePath);
        tempDb.serialize(() => {
            tempDb.run('PRAGMA integrity_check;', (err) => {
                if (err) {
                    throw err;
                }
            });
        });
        tempDb.close();
        return true;
    } catch (error) {
        return false;
    }
}

// Função para fazer upload do banco de dados para o Google Drive
async function uploadDatabase() {
    const fileMetadata = {
        name: 'ecommerce.db',
        parents: ['1ckINIyMwVph6RIkQqmUKTlS8yUmOwwvr'], // substitua pelo ID da pasta no Google Drive
    };
    const media = {
        mimeType: 'application/x-sqlite3',
        body: fs.createReadStream(dbPath),
    };

    // Verificar se o arquivo já existe no Google Drive
    const response = await drive.files.list({
        q: "name='ecommerce.db' and parents in '1ckINIyMwVph6RIkQqmUKTlS8yUmOwwvr'",
        fields: 'files(id, name)',
        spaces: 'drive',
    });

    if (response.data.files.length > 0) {
        const fileId = response.data.files[0].id;
        // Atualizar o arquivo existente
        const updateResponse = await drive.files.update({
            fileId: fileId,
            media: media,
        });
        console.log('Database updated in Google Drive with ID:', updateResponse.data.id);
    } else {
        // Criar um novo arquivo
        const createResponse = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id',
        });
        console.log('Database created in Google Drive with ID:', createResponse.data.id);
    }
}

// Função para baixar o banco de dados do Google Drive
async function downloadDatabase() {
    try {
        // Verificar se o arquivo existe no Google Drive
        const response = await drive.files.list({
            q: "name='ecommerce.db' and parents in '1ckINIyMwVph6RIkQqmUKTlS8yUmOwwvr'",
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        if (response.data.files.length > 0) {
            const fileId = response.data.files[0].id;
            const dest = fs.createWriteStream(dbPath);
            const fileResponse = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
            await new Promise((resolve, reject) => {
                fileResponse.data.on('end', async () => {
                    console.log('Database downloaded from Google Drive.');
                    // Verificar se o banco de dados é válido
                    if (!isValidDatabase(dbPath)) {
                        console.log('Database is not valid. Initializing new database.');
                        initializeLocalDatabase();
                        await uploadDatabase();
                    }
                    resolve();
                }).on('error', (err) => {
                    console.error('Error downloading database from Google Drive:', err);
                    reject(err);
                }).pipe(dest);
            });
        } else {
            // Criar um novo arquivo local se não existir
            console.log('No database found in Google Drive, creating a new one.');
            initializeLocalDatabase();
            await uploadDatabase();
        }
    } catch (error) {
        console.error('Error handling Google Drive file:', error);
    }
}

// Baixar o banco de dados ao iniciar o servidor
(async () => {
    try {
        await downloadDatabase();
        // Conectar ao banco de dados SQLite
        connectDatabase();

        const PORT = process.env.PORT || 8080;
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Error during server initialization:', error);
    }
})();

// Função para fazer backup do banco de dados após cada inserção
async function backupDatabase() {
    try {
        await uploadDatabase();
    } catch (error) {
        console.error('Error during backupDatabase:', error);
    }
}

// Middleware para backup do banco de dados após inserção
async function backupAfterInsert(req, res, next) {
    try {
        await backupDatabase();
        next();
    } catch (error) {
        console.error('Error in backupAfterInsert:', error);
        next(error); // Pass the error to the next middleware
    }
}

app.post('/proxy', async (req, res) => {
    try {
        const response = await axios.post(config.googleSheetUrl, req.body);
        res.json(response.data);
    } catch (error) {
        console.error('Error forwarding request:', error);
        res.status(500).send('Error forwarding request');
    }
});

async function processSuccessfulPayment(payment_id, status, external_reference) {
    console.log('Processing successful payment internally:', payment_id, status, external_reference);

    try {
        const response = await axios.get(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
            headers: { 'Authorization': `Bearer ${config.mercadoPagoAccessToken}` }
        });

        const paymentInfo = response.data;
        let { email, description, transaction_amount: amount } = paymentInfo;

        if (!email) {
            const row = await new Promise((resolve, reject) => {
                db.get("SELECT email FROM pending_payments WHERE external_reference = ?", [external_reference], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            email = row ? row.email : "nao informado";
        }

        const product_id = external_reference.replace(/\d*$/, ''); 

        await new Promise((resolve, reject) => {
            db.run("INSERT INTO purchased_items (id, email, description, amount, purchased, payment_status) VALUES (?, ?, ?, ?, 1, 'approved')", [product_id, email, description, amount], async function(err) {
                if (err) {
                    console.error('Database error:', err.message);
                    return reject('Database error');
                }
                await backupDatabase(); // Certifique-se de fazer backup após a operação
                resolve();
            });
        });

        try {
            await axios.post('https://0.0.0.0:8080/proxy', {
                type: 'compra',
                email: email,
                description: description,
                amount: amount
            });
            console.log('Data sent to Google Sheets via proxy');
        } catch (error) {
            console.error('Error forwarding request:', error.message);
            console.error('Response data:', error.response ? error.response.data : 'No response data');
            throw new Error('Error forwarding request');
        }

    } catch (error) {
        console.error('Error processing payment:', error.message);
        throw new Error('Error processing payment');
    }
}

app.get('/presentes', (req, res) => {
    res.sendFile(path.join(__dirname, 'presentes.html'));
});

app.get('/success', async (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const external_reference = req.query.external_reference;

    console.log('Pagamento bem-sucedido:', payment_id, status, external_reference);

    try {
        await processSuccessfulPayment(payment_id, status, external_reference);
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Pagamento Bem-sucedido</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f4f4f9;
                        color: #333;
                        text-align: center;
                        padding: 50px;
                    }
                    .success-container {
                        background-color: #fff;
                        border-radius: 10px;
                        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                        display: inline-block;
                        padding: 30px;
                        margin-top: 50px;
                    }
                    .success-icon {
                        font-size: 50px;
                        color: #4CAF50;
                    }
                    .success-message {
                        font-size: 24px;
                        margin: 20px 0;
                    }
                    .redirect-button {
                        background-color: #4CAF50;
                        color: white;
                        padding: 15px 25px;
                        border: none;
                        border-radius: 5px;
                        text-decoration: none;
                        font-size: 18px;
                        cursor: pointer;
                    }
                    .redirect-button:hover {
                        background-color: #45a049;
                    }
                </style>
            </head>
            <body>
                <div class="success-container">
                    <div class="success-icon">✔️</div>
                    <div class="success-message">Recebemos a confirmação do seu pagamento!<br>Maxine e Felipe agradecem pelo presente.</div>
                    <a href="/" class="redirect-button">Voltar para o site</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error processing successful payment:', error.message);
        res.redirect('https://www.casamentomaxinefelipe.com.br');
    }
});

app.get('/failure', (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const status_detail = req.query.status_detail;
    const external_reference = req.query.external_reference;

    console.log('Falha no pagamento:', payment_id, status, status_detail, external_reference);
    res.send(`Falha ao processar o pagamento. ID do Pagamento: ${payment_id}, Status: ${status}, Detalhe: ${status_detail}, Ref: ${external_reference}, por favor, cheque seu email e tente realizar o pagamento novamente.`);
});

app.get('/pending', async (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const external_reference = req.query.external_reference;

    console.log('Pagamento pendente:', payment_id, status, external_reference);

    res.redirect(config.url_after_payment);
});

app.get('/check-item/:id', (req, res) => {
    const { id } = req.params;
    console.log("Checking item status for ID:", id);
    

    function checkApprovedPurchase(baseId, callback) {
        db.get("SELECT * FROM purchased_items WHERE id LIKE ? AND payment_status = 'approved'", [`${baseId}%`], (err, row) => {
            if (err) {
                callback(err, null);
            } else {
                callback(null, row);
            }
        });
    }

    checkApprovedPurchase(id, (err, row) => {
        console.log("Id:", id);
        if (err) {
            console.error("Database error:", err);
            res.status(500).json({ error: 'Database error', details: err.message });
            return;
        }
        if (row) {
            
            console.log("Item found and purchased:", row);
            res.json({ purchased: !!row.purchased, price: row.amount, title: row.description });
        } else {
            console.log("Item not found, assuming not purchased for ID:", id);
            res.json({ purchased: false, price: null, title: null });
        }
    });
});

app.post('/payments/checkout/:id/:description/:amount', backupAfterInsert, async (req, res) => {
    const { id, description, amount } = req.params;
    const email = req.body.email;

    if (!id || !description || !amount || !email) {
        console.error('Missing parameters:', req.params);
        return res.status(400).send('Missing parameters');
    }

    const floatAmount = parseFloat(amount);
    if (isNaN(floatAmount)) {
        return res.status(400).send('Invalid amount format');
    }

    function generateUniqueId(baseId, callback) {
        let newId = baseId;
        db.get("SELECT external_reference FROM pending_payments WHERE external_reference = ?", [newId], function (err, row) {
            if (err) {
                callback(err, null);
            } else if (row) {
                let i = 1;
                let incrementId = () => {
                    newId = `${baseId}${i}`;
                    db.get("SELECT external_reference FROM pending_payments WHERE external_reference = ?", [newId], function (err, row) {
                        if (err) {
                            callback(err, null);
                        } else if (row) {
                            i++;
                            incrementId();
                        } else {
                            callback(null, newId);
                        }
                    });
                };
                incrementId();
            } else {
                callback(null, newId);
            }
        });
    }

    generateUniqueId(id, async (err, externalReference) => {
        if (err) {
            console.error('Error generating unique ID:', err.message);
            return res.status(500).json({ error: 'Database error', details: err.message });
        }

        const baseUrl = config.url_after_payment;

        const purchaseOrder = {
            items: [{
                id: id,
                title: description,
                quantity: 1,
                currency_id: 'BRL',
                unit_price: floatAmount
            }],
            back_urls: {
                success: `${baseUrl}/success?payment_id=:id&status=approved&external_reference=${externalReference}`,
                failure: `${baseUrl}/failure`,
                pending: `${baseUrl}/pending?payment_id=:id&status=pending&external_reference=${externalReference}`
            },
            auto_return: "approved",
            external_reference: externalReference,
            payer: {
                email: email
            }
        };

        try {
            await new Promise((resolve, reject) => {
                db.run("INSERT INTO pending_payments (external_reference, email) VALUES (?, ?)", [externalReference, email], async function (err) {
                    if (err) {
                        console.error('Database error:', err);
                        reject('Database error');
                    }
                    await backupDatabase(); // Certifique-se de fazer backup após a operação
                    resolve();
                });
            });

            const response = await MercadoPago.preferences.create(purchaseOrder);
            console.log('Preference created:', response.body.id); // Log adicional para verificação
            res.json({ success: true, preference_id: response.body.id });
        } catch (err) {
            console.error('Error creating MercadoPago preference:', err);
            res.status(500).json({ error: 'MercadoPago API error', details: err.message });
        }
    });
});

app.post('/notify', backupAfterInsert, async (req, res) => {
    const { topic, resource } = req.body;

    if (topic === 'merchant_order') {
        try {
            const orderDetails = await fetchOrderDetails(resource);
            console.log('Merchant Order Details:', orderDetails);

            if (orderDetails.payments && orderDetails.payments.some(payment => payment.status === 'approved')) {
                const approvedPayment = orderDetails.payments.find(payment => payment.status === 'approved');
                await processSuccessfulPayment(approvedPayment.id, approvedPayment.status, orderDetails.external_reference);
                console.log('Payment has been approved and order updated.');
            } else {
                console.log('Payment not approved yet.');
            }
            res.status(200).send('Notification processed successfully'); // Move this line inside the try block
        } catch (error) {
            console.error('Error processing notification:', error.message);
            return res.status(500).send('Error processing notification'); // Use return to ensure the function exits
        }
    } else {
        console.log('Unhandled topic:', topic);
        return res.status(200).send('Notification processed successfully'); // Ensure the function exits
    }
});

async function fetchOrderDetails(resourceUrl) {
    const response = await axios.get(resourceUrl, {
        headers: { 'Authorization': `Bearer ${config.mercadoPagoAccessToken}` }
    });
    return response.data;
}

