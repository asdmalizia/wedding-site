const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const path = require('path');
const db = require('./database'); // Importando a configuração do banco de dados
const config = require('./config.json');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

console.log("Using access token:", config.mercadoPagoAccessToken);

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

app.post('/proxy', async (req, res) => {
    console.log('Received request at /proxy:', req.body);
    try {
        const response = await axios.post(config.googleSheetUrlc, req.body, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('Response from Google Sheets:', response.data);
        res.json(response.data);
    } catch (error) {
        console.error('Error forwarding request:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
            res.status(error.response.status).send(error.response.data);
        } else {
            res.status(500).send('Error forwarding request');
        }
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
            db.run("INSERT INTO purchased_items (id, email, description, amount, purchased, payment_status) VALUES (?, ?, ?, ?, 1, 'approved')", [product_id, email, description, amount], function(err) {
                if (err) {
                    console.error('Database error:', err.message);
                    return reject('Database error');
                }
                resolve();
            });
        });

        try {
            await axios.post('https://casamentomaxinefelipe.com.br/proxy', {
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
        res.status(500).send('Error processing payment');
    }
});

app.get('/failure', (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const status_detail = req.query.status_detail;
    const external_reference = req.query.external_reference;

    console.log('Falha no pagamento:', payment_id, status, status_detail, external_reference);
    res.send(`Falha ao processar o pagamento. ID do Pagamento: ${payment_id}, Status: ${status}, Detalhe: ${status_detail}, Ref: ${external_reference}`);
});

app.get('/pending', (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const external_reference = req.query.external_reference;

    console.log('Pagamento pendente:', payment_id, status, external_reference);
    res.send(`Pagamento pendente. ID do Pagamento: ${payment_id}, Status: ${status}, Ref: ${external_reference}`);
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

app.post('/payments/checkout/:id/:description/:amount', async (req, res) => {
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
                success: `${baseUrl}/success`,
                failure: `${baseUrl}/failure`,
                pending: `${baseUrl}/pending`
            },
            auto_return: "all",
            external_reference: externalReference,
            payer: {
                email: email
            }
        };

        try {
            await new Promise((resolve, reject) => {
                db.run("INSERT INTO pending_payments (external_reference, email) VALUES (?, ?)", [externalReference, email], function (err) {
                    if (err) {
                        console.error('Database error:', err);
                        reject('Database error');
                    } else {
                        resolve();
                    }
                });
            });

            const response = await MercadoPago.preferences.create(purchaseOrder);
            res.json({ success: true, preference_id: response.body.id });
        } catch (err) {
            console.error('Error creating MercadoPago preference:', err);
            res.status(500).json({ error: 'MercadoPago API error', details: err.message });
        }
    });
});

app.post('/notify', async (req, res) => {
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});