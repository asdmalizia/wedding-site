const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const path = require('path');
const db = require('./database'); // Importando a configuração do banco de dados
const config = require('./config.json');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid'); 
const uniqueId = uuidv4(); // Isto gera um novo UUID
const axios = require('axios');
const fs = require('fs');

console.log("Using access token:", config.mercadoPagoAccessToken);

// Configuração inicial do MercadoPago
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
        imgSrc: [
            "'self'",
            "data:",
            "*"
        ],
        connectSrc: [
            "'self'",
            "https://maps.googleapis.com",
            "https://*.youtube.com"
        ],
        styleSrc: [
            "'self'",
            "'unsafe-inline'"
        ],
        frameSrc: [
            "https://www.youtube.com",
            "https://maps.google.com"
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
    },
    reportOnly: true
}));

app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Definir diretório de visualizações e engine de visualização
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Endpoint para pagamento bem-sucedido
// Endpoint para pagamento bem-sucedido
app.get('/success', (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const external_reference = req.query.external_reference;

    console.log('Pagamento bem-sucedido:', payment_id, status, external_reference);

    // Fetch the purchase details to send to Google Sheets
    axios.get(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
        headers: { 'Authorization': `Bearer ${config.mercadoPagoAccessToken}` }
    }).then(response => {
        const paymentInfo = response.data;
        const { email, description, transaction_amount: amount } = paymentInfo;

        // Insere o item no banco de dados após o pagamento ser aprovado
        db.run("INSERT INTO purchased_items (id, email, description, amount, purchased, payment_status) VALUES (?, ?, ?, ?, 1, 'approved')", [external_reference, email, description, amount], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).send('Error updating database');
            }

            // Envia os dados para o Google Sheets
            axios.post(config.googleSheetUrl, {
                type: 'compra',
                email: email,
                description: description,
                amount: amount
            }).then(response => {
                console.log('Data sent to Google Sheets:', response.data);
            }).catch(error => {
                console.error('Error sending data to Google Sheets:', error);
            });

            res.send(`Pagamento realizado com sucesso! ID do Pagamento: ${payment_id}, Status: ${status}, Ref: ${external_reference}`);
        });
    }).catch(error => {
        console.error('Error fetching payment info:', error);
        res.status(500).send('Error fetching payment info');
    });
});

// Endpoint para pagamento falho
app.get('/failure', (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const status_detail = req.query.status_detail;
    const external_reference = req.query.external_reference;

    console.log('Falha no pagamento:', payment_id, status, status_detail, external_reference);
    res.send(`Falha ao processar o pagamento. ID do Pagamento: ${payment_id}, Status: ${status}, Detalhe: ${status_detail}, Ref: ${external_reference}`);
});

// Endpoint para pagamento pendente
app.get('/pending', (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const external_reference = req.query.external_reference;

    console.log('Pagamento pendente:', payment_id, status, external_reference);
    res.send(`Pagamento pendente. ID do Pagamento: ${payment_id}, Status: ${status}, Ref: ${external_reference}`);
});

// Express.js route
app.get('/check-item/:id', (req, res) => {
    const { id } = req.params;
    console.log("Checking item status for ID:", id);  // Log para verificar o ID recebido

    db.get("SELECT * FROM purchased_items WHERE id = ?", [id], (err, row) => {
        if (err) {
            console.error("Database error:", err);
            res.status(500).json({ error: 'Database error', details: err.message });
            return;
        }
        if (row) {
            console.log("Item found and purchased:", row);  // Log para verificar os dados retornados
            res.json({ purchased: !!row.purchased, price: row.amount, title: row.description });
        } else {
            console.log("Item not found, assuming not purchased for ID:", id);  // Log para confirmar que o item não foi encontrado
            // Retorna como não comprado se não for encontrado no banco
            res.json({ purchased: false, price: null, title: null });
        }
    });
});

app.post('/payments/checkout/:id/:description/:amount', async (req, res) => {
    const { id, description, amount } = req.params;

    if (!id || !description || !amount) {
        console.error('Missing parameters:', req.params);
        return res.status(400).send('Missing parameters');
    }

    const floatAmount = parseFloat(amount);
    if (isNaN(floatAmount)) {
        return res.status(400).send('Invalid amount format');
    }

    const externalReference = uuidv4();
    const email = req.body.email; // Pegando o email do corpo da requisição

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
    };

    try {
        MercadoPago.preferences.create(purchaseOrder).then(response => {
            res.json({ success: true, preference_id: response.body.id });
        }).catch(err => {
            console.error('MercadoPago API error:', err);
            res.status(500).json({ error: 'MercadoPago API error', details: err.message });
        });
    } catch (err) {
        console.error('MercadoPago API error:', err);
        res.status(500).json({ error: 'MercadoPago API error', details: err.message });
    }
});

app.post('/notify', async (req, res) => {
    const { topic, resource } = req.body;

    if (topic === 'merchant_order') {
        try {
            const orderDetails = await fetchOrderDetails(resource);
            console.log('Merchant Order Details:', orderDetails);

            // Verificar se há pagamentos completos
            if (orderDetails.payments && orderDetails.payments.some(payment => payment.status === 'approved')) {
                // Atualiza o status do pedido no seu sistema para "Pago"
                updateOrderStatus(orderDetails.external_reference, 'approved');
                console.log('Payment has been approved and order updated.');
            } else {
                console.log('Payment not approved yet.');
            }
        } catch (error) {
            console.error('Error processing notification:', error);
            res.status(500).send('Error processing notification');
        }
    }

    res.status(200).send('Notification processed successfully');
});

async function fetchOrderDetails(resourceUrl) {
    const response = await axios.get(resourceUrl, {
        headers: { 'Authorization': `Bearer ${config.mercadoPagoAccessToken}` }
    });
    return response.data;
}

function updateOrderStatus(orderId, status) {
    // Aqui você atualiza o status do pedido na sua base de dados
    db.run("UPDATE purchased_items SET purchased = 1, payment_status = ? WHERE id = ?", [status, orderId], function(err) {
        if (err) {
            console.error('Database error:', err.message);
        } else {
            console.log(`Order ${orderId} updated to ${status}`);
        }
    });
}

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
