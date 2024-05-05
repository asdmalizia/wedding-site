const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const MercadoPago = require('mercadopago');
const path = require('path');
const db = require('./database'); // Importando a configuração do banco de dados
const config = require('./config.json');
const helmet = require('helmet');


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
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Definir diretório de visualizações e engine de visualização
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Rota para verificar o estado de compra de um item
app.get('/check-item/:id', (req, res) => {
    const { id } = req.params;
    db.get("SELECT purchased FROM purchased_items WHERE id = ?", [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
            return;
        }
        res.json({ purchased: !!row && !!row.purchased });
    });
});

// Rota para processar pagamentos
app.post('/payments/checkout/:id/:email/:description/:amount', (req, res) => {
    const { id, email, description, amount } = req.params;

    db.get("SELECT purchased FROM purchased_items WHERE id = ?", [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
            return;
        }
        if (row && row.purchased) {
            res.status(400).json({ error: 'Item already purchased' });
            return;
        }

        const purchaseOrder = {
            items: [{
                id: id,
                title: description,
                quantity: 1,
                currency_id: 'BRL',
                unit_price: parseFloat(amount)
            }],
            payer: { email: email },
            back_urls: {
                success: "http://localhost:3000/success",
                failure: "http://localhost:3000/failure",
                pending: "http://localhost:3000/pending"
            },
            auto_return: "all",
            external_reference: id,
        };

        MercadoPago.preferences.create(purchaseOrder).then(response => {
            db.run("INSERT INTO purchased_items (id, email, description, amount, purchased) VALUES (?, ?, ?, ?, 1)",
                [id, email, description, parseFloat(amount)],
                (err) => {
                    if (err) {
                        res.status(500).json({ error: 'Failed to record the purchase' });
                        return;
                    }
                    res.json({ success: true, preference_id: response.body.id });
                }
            );
        }).catch(err => {
            console.error('MercadoPago API error:', err);
            res.status(500).json({ error: 'MercadoPago API error', details: err.message });
        });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});