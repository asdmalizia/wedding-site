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

console.log("Using access token:", config.mercadoPagoAccessToken);


// Configuração inicial do MercadoPago
MercadoPago.configure({
    access_token: config.mercadoPagoAccessToken
});

const app = express();
app.use(helmet.contentSecurityPolicy({
    directives: {
        defaultSrc: ["'self'"], // Padrão para a maioria das fontes
        scriptSrc: [
            "'self'",
            "https://http2.mlstatic.com",
            "https://maps.googleapis.com",
            "https://sdk.mercadopago.com/js/v2",
            "https://apis.google.com",
            "https://www.youtube.com",
            "'unsafe-inline'", // Se necessário para inline scripts
            "'unsafe-eval'", // Se necessário para eval
            "'nonce-oNZMR6yDOmJFaX5IMT8KCg=='" // Para scripts com um nonce específico
        ],
        imgSrc: [
            "'self'",
            "data:",
            "*", // Permite todas as origens para imagens
        ],
        connectSrc: [ // Permite conexões a APIs
            "'self'",
            "https://maps.googleapis.com",
            "https://*.youtube.com", // Inclui YouTube API
        ],
        styleSrc: [ // Estilos, incluindo inline e externos
            "'self'",
            "'unsafe-inline'"
        ],
        frameSrc: [ // Permite iframes de fontes específicas
            "https://www.youtube.com",
            "https://maps.google.com"
        ],
        objectSrc: ["'none'"], // Bloqueia todos os objetos, como Flash
        upgradeInsecureRequests: [], // Opcional, força https
    },
    reportOnly: true // Altere para true para testar sem bloquear recursos
}));

app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({extended: true}));
// Definir diretório de visualizações e engine de visualização
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Endpoint para pagamento bem-sucedido
app.get('/success', (req, res) => {
    const payment_id = req.query.payment_id;
    const status = req.query.status;
    const external_reference = req.query.external_reference;

    console.log('Pagamento bem-sucedido:', payment_id, status, external_reference);
    res.send(`Pagamento realizado com sucesso! ID do Pagamento: ${payment_id}, Status: ${status}, Ref: ${external_reference}`);
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

    const purchaseOrder = {
        items: [{
            id: externalReference,
            title: description,
            quantity: 1,
            currency_id: 'BRL',
            unit_price: floatAmount
        }],
        back_urls: {
            success: "http://localhost:3000/success",
            failure: "http://localhost:3000/failure",
            pending: "http://localhost:3000/pending"
        },
        auto_return: "all",
        external_reference: externalReference,
    };

    try {
        const response = await MercadoPago.preferences.create(purchaseOrder);
        res.json({ success: true, preference_id: response.body.id });
    } catch (err) {
        console.error('MercadoPago API error:', err);
        res.status(500).json({ error: 'MercadoPago API error', details: err.message });
    }
});



const axios = require('axios'); // Você precisará do axios para fazer chamadas HTTP

app.post('/notify', async (req, res) => {
    const { topic, resource } = req.body;

    if (topic === 'merchant_order') {
        try {
            const orderDetails = await fetchOrderDetails(resource);
            console.log('Merchant Order Details:', orderDetails);

            // Verificar se há pagamentos completos
            if (orderDetails.payments && orderDetails.payments.some(payment => payment.status === 'approved')) {
                // Atualiza o status do pedido no seu sistema para "Pago"
                updateOrderStatus(orderDetails.external_reference, 'Paid');
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
    console.log(`Order ${orderId} updated to ${status}`);
}




const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});