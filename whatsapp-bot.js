const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('./db'); // Import database connection
const multer = require('multer');
const express = require('express');
const cors = require('cors'); // Added for CORS support

// Configuration Constants from Environment Variables
const OWNER_NUMBER = process.env.OWNER_NUMBER || '918080032223@c.us'; // Staff WhatsApp number
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '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';
const PORT = process.env.PORT || 3000; // Use environment port or default to 3000
const SUPPORTED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PENDING_DOCUMENTS = 10; // Max 10 documents queued per user
const REASON_TIMEOUT = 15 * 1000; // 15 seconds timeout for reason prompt
const OWNER_DOCUMENT_TIMEOUT = 5 * 60 * 1000; // 5 minutes timeout for owner document

// Use a temporary directory for document storage
const DOCUMENT_STORAGE_DIR = process.env.DOCUMENT_STORAGE_DIR || path.join(__dirname, 'user_documents');
const app = express();

// Middleware for CORS and JSON parsing
app.use(cors()); // Enable CORS for cross-origin requests
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

// Service Data (unchanged)
const services = {
    'पॅन कार्ड (नवीन/दुरुस्ती)': {
        documents: 'आधार कार्ड, पॅन कार्ड (दुरुस्तीसाठी), पासपोर्ट साइज फोटो (२)',
        charges: 'नवीन ₹170 दुरुस्ती ₹210'
    },
    'मतदान कार्ड (नवीन/दुरुस्ती)': {
        documents: 'आधार कार्ड, मतदान कार्ड (दुरुस्तीसाठी), पासपोर्ट साइज फोटो (२)',
        charges: 'नवीन ₹70 दुरुस्ती ₹50'
    },
    'पोलिस मंजुरी प्रमाणपत्र (PCC)': {
        documents: 'आधार कार्ड, ओळखपत्र (उदा. पॅन कार्ड/ मतदान कार्ड/ ड्रायव्हिंग लायसन्स), जन्म प्रमाणपत्र/शाळा सोडल्याचा दाखला(LC), पासपोर्ट साइज फोटो (२-४), अर्जदाराची स्वाक्षरी, दोन शेजाऱ्यांचे तपशील (नाव, पत्ता, मोबाईल नंबर), नोकरीचे प्रमाणपत्र/नियुक्ती पत्र (आवश्यक असल्यास), मागील पोलिस नोंदी/PCC',
        charges: '₹350'
    },
    'उत्पन्नाचा दाखला': {
        documents: 'तलाठी उत्पन्न दाखला, आधार कार्ड, रेशन कार्ड',
        charges: '₹150'
    },
    'डोमिसाईल / नॅशनलिटी दाखला': {
        documents: 'स्वतःचा LC, वडिलांचा LC, स्वतःचा आधार कार्ड, वडिलांचा आधार कार्ड, दोन पासपोर्ट फोटो, रेशन कार्ड',
        charges: '₹300'
    },
    'नॉन क्रिमीलेयर दाखला': {
        documents: 'तहसीलदार कडील ३ वर्षाचा उत्पन्नाचा दाखला, स्वतःचा जाताचा दाखला, स्वतःचा LC, वडिलांचा LC, स्वतःचा आधार कार्ड, वडिलांचा आधार कार्ड, दोन पासपोर्ट फोटो',
        charges: '₹350'
    },
    'जातिचा दाखला': {
        documents: 'स्वतःचा LC/ बोनाफाईड, वडिलांचा LC, आजोबांचा LC, स्वतःचा आधार कार्ड, वडिलांचा आधार कार्ड, रेशन कार्ड, दोन पासपोर्ट फोटो',
        charges: '₹150'
    },
    'केंद्र शासन जातिचा दाखला': {
        documents: 'तहसीलदार कडील ३ वर्षाचा उत्पन्नाचा दाखला, स्वतःचा जाताचा दाखला, स्वतःचा LC, वडिलांचा LC, स्वतःचा आधार कार्ड, वडिलांचा आधार कार्ड, रेशन कार्ड, दोन पासपोर्ट फोटो',
        charges: '₹150'
    },
    'आर्थिकदृष्ट्या दुर्बल प्रमाणपत्र (EWS)': {
        documents: 'तहसीलदार कडील ३ वर्षाचा उत्पन्नाचा दाखला, स्वतःचा जाताचा दाखला, स्वतःचा LC, वडिलांचा LC, स्वतःचा आधार कार्ड, वडिलांचा आधार कार्ड, रेशन कार्ड, दोन.passपोर्ट फोटो',
        charges: '₹150'
    },
};

// Service Aliases (unchanged)
const serviceAliases = {
    'income certificate': 'उत्पन्नाचा दाखला',
    'income certi': 'उत्पन्नाचा दाखला',
    'utpannacha dakhala': 'उत्पन्नाचा दाखला',
    'utpann dakhala': 'उत्पन्नाचा दाखला',
    'income proof': 'उत्पन्नाचा दाखला',
    'domicile': 'डोमिसाईल / नॅशनलिटी दाखला',
    'domicile certificate': 'डोमिसाईल / नॅशनलिटी दाखला',
    'domicile certi': 'डोमिसाईल / नॅशनलिटी दाखला',
    'domocile': 'डोमिसाईल / नॅशनलिटी दाखला',
    'nationality certificate': 'डोमिसाईल / नॅशनलिटी दाखला',
    'nationality': 'डोमिसाईल / नॅशनलिटी दाखला',
    'nationality certi': 'डोमिसाईल / नॅशनलिटी दाखला',
    'non creamy layer': 'नॉन क्रिमीलेयर दाखला',
    'non creamy layer certificate': 'नॉन क्रिमीलेयर दाखला',
    'ncl certificate': 'नॉन क्रिमीलेयर दाखला',
    'ncl certi': 'नॉन क्रिमीलेयर दाखला',
    'non creamy': 'नॉन क्रिमीलेयर दाखला',
    'non crimilier': 'नॉन क्रिमीलेयर दाखला',
    'non criminal': 'नॉन क्रिमीलेयर दाखला',
    'caste certificate': 'जातीचा दाखला',
    'cast certificate': 'जातीचा दाखला',
    'cast certi': 'जातीचा दाखला',
    'cast': 'जातीचा दाखला',
    'jati dakhala': 'जातीचा दाखला',
    'central caste certificate': 'केंद्र शासन जातिचा दाखला',
    'central cast certificate': 'केंद्र शासन जातिचा दाखला',
    'central cast certi': 'केंद्र शासन जातिचा दाखला',
    'ews certificate': 'आर्थिकदृष्ट्या दुर्बल प्रमाणपत्र (EWS)',
    'ews certi': 'आर्थिकदृष्ट्या दुर्बल प्रमाणपत्र (EWS)',
    'ews': 'आर्थिकदृष्ट्या दुर्बल प्रमाणपत्र (EWS)',
    'ews pramanpatra': 'आर्थिकदृष्ट्या दुर्बल प्रमाणपत्र (EWS)',
    'pan card': 'पॅन कार्ड (नवीन/दुरुस्ती)',
    'pan': 'पॅन कार्ड (नवीन/दुरुस्ती)',
    'pan card certi': 'पॅन कार्ड (नवीन/दुरुस्ती)',
    'tax card': 'पॅन कार्ड (नवीन/दुरुस्ती)',
    'voter card': 'मतदान कार्ड (नवीन/दुरुस्ती)',
    'voter id': 'मतदान कार्ड (नवीन/दुरुस्ती)',
    'election card': 'मतदान कार्ड (नवीन/दुरुस्ती)',
    'matdar card': 'मतदान कार्ड (नवीन/दुरुस्ती)',
    'voting card': 'मतदान कार्ड (नवीन/दुरुस्ती)',
    'police clearance': 'पोलिस मंजुरी प्रमाणपत्र (PCC)',
    'pcc': 'पोलिस मंजुरी प्रमाणपत्र (PCC)',
    'police verification': 'पोलिस मंजुरी प्रमाणपत्र (PCC)',
    'police certificate': 'पोलिस मंजुरी प्रमाणपत्र (PCC)',
};

// In-memory store for context and timeouts
const messageContext = new Map();
const reasonTimeouts = new Map();
const ownerDocumentTimeouts = new Map();

// Ensure document storage directory exists
if (!fs.existsSync(DOCUMENT_STORAGE_DIR)) {
    fs.mkdirSync(DOCUMENT_STORAGE_DIR, { recursive: true });
    console.log(`Created document storage directory: ${DOCUMENT_STORAGE_DIR}`);
}

// Serve the main webpage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'CyberWebpage.html'));
});

// API to fetch services
app.get('/api/services', (req, res) => {
    res.json({ services });
});

// API to track work order status
app.post('/api/track', (req, res) => {
    const { orderId, phoneNumber } = req.body;
    if (!orderId || !phoneNumber) {
        return res.status(400).json({ error: 'Order ID and Phone Number are required' });
    }

    const whatsappId = `${phoneNumber}@c.us`;

    const query = `
        SELECT wo.orderId, wo.serviceType, wo.status, wo.lastUpdated
        FROM work_orders wo
        WHERE wo.orderId = ? AND wo.whatsappId = ?
    `;
    const documentsQuery = `
        SELECT documentId, mimetype, filename
        FROM documents
        WHERE orderId = ?
    `;

    db.get(query, [orderId, whatsappId], (err, row) => {
        if (err) {
            console.error('Error fetching work status:', err);
            return res.status(500).json({ error: 'Error fetching work status' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Order not found or phone number does not match' });
        }

        const response = {
            orderId: row.orderId,
            serviceType: row.serviceType,
            status: row.status,
            lastUpdated: new Date(row.lastUpdated).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).replace(',', '')
        };

        // Check if status is Completed
        const isCompleted = row.status.toLowerCase() === 'completed' || row.status.toLowerCase() === 'complete' || row.status.toLowerCase() === 'done';
        if (isCompleted) {
            db.all(documentsQuery, [orderId], (docErr, docs) => {
                if (docErr) {
                    console.error('Error fetching documents:', docErr);
                    return res.status(500).json({ error: 'Error fetching documents' });
                }
                response.documents = docs.map(doc => ({
                    documentId: doc.documentId,
                    filename: doc.filename,
                    mimetype: doc.mimetype
                }));
                res.json(response);
            });
        } else {
            res.json(response);
        }
    });
});

// API to download documents
app.get('/api/document/:orderId/:documentId', (req, res) => {
    const { orderId, documentId } = req.params;
    const { phoneNumber } = req.query;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone Number is required' });
    }

    const whatsappId = `${phoneNumber}@c.us`;

    // Verify the order belongs to the user
    const orderQuery = `
        SELECT orderId FROM work_orders
        WHERE orderId = ? AND whatsappId = ? AND status IN ('Completed', 'Complete', 'Done')
    `;
    const documentQuery = `
        SELECT mimetype, filename, data
        FROM documents
        WHERE documentId = ? AND orderId = ?
    `;

    db.get(orderQuery, [orderId, whatsappId], (err, orderRow) => {
        if (err) {
            console.error('Error verifying order:', err);
            return res.status(500).json({ error: 'Error verifying order' });
        }
        if (!orderRow) {
            return res.status(403).json({ error: 'Order not found, not completed, or not authorized' });
        }

        db.get(documentQuery, [documentId, orderId], (docErr, docRow) => {
            if (docErr) {
                console.error('Error fetching document:', docErr);
                return res.status(500).json({ error: 'Error fetching document' });
            }
            if (!docRow) {
                return res.status(404).json({ error: 'Document not found' });
            }

            const buffer = Buffer.from(docRow.data, 'base64');
            res.setHeader('Content-Type', docRow.mimetype);
            res.setHeader('Content-Disposition', `attachment; filename="${docRow.filename}"`);
            res.send(buffer);
        });
    });
});

// WhatsApp Client Setup
const whatsapp = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // Run in headless mode for production
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, // Use env variable for cloud compatibility
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
        ],
    }
});

let responseFooter;

// HTTP Server for QR Code and API
const server = http.createServer(app);
server.listen(PORT, () => {
    console.log(`Server started at port https://localhost:${PORT}`);
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_DOCUMENT_SIZE },
    fileFilter: (req, file, cb) => {
        if (SUPPORTED_DOCUMENT_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type'), false);
        }
    }
});

// API to handle application submission
app.post('/api/apply', upload.array('documents', MAX_PENDING_DOCUMENTS), (req, res) => {
    const { name, phone, reason } = req.body;
    const files = req.files;

    if (!name || !phone || !reason || !files || files.length === 0) {
        return res.status(400).json({ error: 'Name, phone number, service, and at least one document are required' });
    }
    const whatsappId = `91${phone}@c.us`;
    const orderId = `WO-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const submissionDate = new Date().toISOString();
    const initialStatus = 'Pending Review';

    // Normalize service type
    let serviceType = reason;
    const normalizedReason = reason.toLowerCase().trim();
    if (services[reason]) {
        serviceType = reason;
    } else if (serviceAliases[normalizedReason]) {
        serviceType = serviceAliases[normalizedReason];
    }

    // Save client
    db.run(`INSERT OR IGNORE INTO clients (whatsappId, joinedDate) VALUES (?, ?)`, [whatsappId, submissionDate], (err) => {
        if (err) {
            console.error('Error inserting client:', err);
            return res.status(500).json({ error: 'Error saving client' });
        }

        // Save work order
        db.run(
            `INSERT INTO work_orders (orderId, whatsappId, serviceType, reason, submissionDate, status, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [orderId, whatsappId, serviceType, reason, submissionDate, initialStatus, submissionDate],
            async function(err) {
                if (err) {
                    console.error("Error inserting work order:", err.message);
                    return res.status(500).json({ error: 'Error saving work order' });
                }

                // Save documents to database
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const documentId = uuidv4();
                    const filename = `${reason}_${file.originalname}`;
                    db.run(
                        `INSERT INTO documents (documentId, orderId, mimetype, filename, data) VALUES (?, ?, ?, ?, ?)`,
                        [documentId, orderId, file.mimetype, filename, file.buffer.toString('base64')],
                        (err) => {
                            if (err) console.error(`Error saving document ${filename}:`, err.message);
                        }
                    );
                }

                // Clear in-memory context
                const userContext = messageContext.get(whatsappId) || {};
                userContext.documents = [];
                userContext.awaitingReason = false;
                messageContext.set(whatsappId, userContext);

                const confirmation = `धन्यवाद! तुमचे काम नोंदवले आहे. *ऑर्डर आयडी: ${orderId}*. आमचे कर्मचारी लवकरच तुमच्याशी संपर्क साधतील आणि पुढील प्रक्रिया करतील.\n\nतुम्ही तुमच्या कामाची स्थिती कधीही *'माझ्या कामाची स्थिती'* ही कमांड वापरून तपासू शकता.${responseFooter}`;
                whatsapp.sendMessage(whatsappId, confirmation).catch(err => console.error('Error sending confirmation:', err));

                // Notify owner via WhatsApp
                const documentInfo = files.map(file => file.originalname).join(', ');
                whatsapp.sendMessage(OWNER_NUMBER,
                    `🟢 *नवीन काम नोंदवले आहे!* 🟢\n\n` +
                    `*वापरकर्ता:* ${whatsappId.split('@')[0]}\n` +
                    `*सेवा:* ${reason}\n` +
                    `*ऑर्डर आयडी:* ${orderId}\n` +
                    `*दस्तऐवज:* ${documentInfo}\n\n` +
                    `कागदपत्रे पाहण्यासाठी, कृपया हा आदेश पाठवा: *get_docs ${orderId}*`
                ).then(() => {
                    whatsapp.sendMessage(OWNER_NUMBER, `${orderId}`);
                }).catch(err => console.error('Error notifying owner:', err));

                // Send response to client
                res.json({ success: true, orderId, message: `Application submitted successfully! Order ID: ${orderId}. Our staff will contact you soon.` });
            }
        );
    });
});

// Dynamic QR Code Route
app.get('/qrcode', (req, res) => {
    if (!global.qrDataUrl) {
        return res.status(503).send('QR code not available. Please wait for WhatsApp client to generate QR.');
    }
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp QR Code</title>
            <style>
                body { display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f0f0; }
                .container { text-align: center; }
                h1 { font-family: Arial, sans-serif; color: #333; }
                img { border: 5px solid #fff; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>WhatsApp लॉगिनसाठी QR कोड स्कॅन करा</h1>
                <img src="${global.qrDataUrl}" alt="WhatsApp QR Code">
            </div>
        </body>
        </html>
    `;
    res.send(htmlContent);
});

// OpenRouter AI API Handler
async function handleAIResponse(message, userMessage) {
    try {
        const serviceList = Object.keys(services).join(', ');
        const prompt = `You are a Cafe Buddy WhatsApp bot acting as the cyber cafe itself, not just an assistant. You help users with any kind of work typically done at a cyber cafe, even if it’s not listed in ${serviceList}.
                    If the user asks about something a cyber cafe can usually do (e.g., form filling, document help, online applications), respond in short, polite Marathi.
                    Append the command only if it's relevant to the user's request.
                    Available commands: ${responseFooter}  
                    Tell them what documents are needed and ask: "काम सुरू करू का?" (Shall we begin?)
                    If they agree, ask them to send the required documents and mention the reason. Then say the staff will contact them.
                    If the query is unrelated (e.g., history, politics, general questions), reply:
                    "माफ करा, या विषयात मी मदत करू शकत नाही. कृपया सायबर कॅफे संबंधित विचारणा करा."
                    If the work is related but requires staff approval (e.g., price, custom work), reply with an empty string "". User Message: "${userMessage}"`;
        
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'x-ai/grok-3-beta',
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: userMessage }
                ],
                max_tokens: 200,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const aiResponse = response.data.choices[0].message.content.trim();
        return aiResponse === '' ? '' : `${aiResponse}`;
    } catch (error) {
        console.error('Error calling OpenRouter API:', error.response ? error.response.data : error.message);
        await whatsapp.sendMessage(message.from, `क्षमस्व, तुमच्या प्रश्नावर प्रक्रिया करताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा किंवा कर्मचाऱ्यांशी संपर्क साधा.`);
        await whatsapp.sendMessage(message.from, `कर्मचाऱ्यांशी संपर्क साधण्यासाठी Contact Staff टाइप करा. 😊`);
        return '';
    }
}

// Command Handlers (unchanged)
async function handleGreeting(message, userContext) {
    try {
        const serviceList = Object.keys(services).map(name => `\n- ${name}`).join('');
        const greeting = `🟢 नमस्कार! मी तुमचा WhatsApp सहाय्यक बोट आहे.\n\nमी तुमचं स्वागत करतोय! खाली दिलेली सेवा मी सध्या देऊ शकतो:\n\n🗂️ सेवांची यादी:\n${serviceList}\n\nकृपया तुमची सेवा निवडा किंवा आपला प्रश्न विचारा.${responseFooter}`;
        await whatsapp.sendMessage(message.from, greeting);
        messageContext.delete(message.from);
        clearUserTimeout(message.from);
        clearOwnerDocumentTimeout(message.from);
        console.log('Greeting sent to', message.from);
    } catch (error) {
        console.error('Error in handleGreeting:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function handleServiceList(message, userContext) {
    try {
        const serviceList = Object.keys(services).map(name => `\n- ${name}`).join('');
        const response = `खालील सेवांची यादी उपलब्ध आहे:\n${serviceList}\n\nकृपया तुमची सेवा निवडा किंवा तुमचा प्रश्न विचारा.`;
        await whatsapp.sendMessage(message.from, response);
        console.log('Service list sent to', message.from);
    } catch (error) {
        console.error('Error in handleServiceList:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function handleDocumentsRequest(message, userContext, serviceName) {
    try {
        if (!services[serviceName]) {
            const response = `सेवा "${serviceName}" सापडली नाही.\n\nकृपया खालील सेवांपैकी एक निवडा:\n${Object.keys(services).map(name => `\n- ${name}`).join('')}`;
            await whatsapp.sendMessage(message.from, response);
            console.log(`Service ${serviceName} not found for`, message.from);
            return;
        }
        const documents = services[serviceName].documents;
        if (!documents || documents.trim() === '') {
            console.error(`No documents defined for service: ${serviceName}`);
            await whatsapp.sendMessage(message.from, `क्षमस्व, "${serviceName}" साठी कागदपत्रांची माहिती उपलब्ध नाही. कृपया कर्मचाऱ्यांशी संपर्क साधा.`);
            await whatsapp.sendMessage(message.from, `कर्मचाऱ्यांशी संपर्क साधण्यासाठी Contact Staff टाइप करा. 😊`);
            return;
        }
        const formattedDocuments = documents.split(',').map(doc => `\n- ${doc}`).join('.');
        const chargeofdoc = services[serviceName].charges;
        const response = `${serviceName} साठी खालील कागदपत्रे आवश्यक आहेत:\n${formattedDocuments}\n\nसेवा शुल्क: ${chargeofdoc}\n\nजर तुम्हाला ही सेवा हवी असेल तर कृपया वरील कागदपत्रे पाठवा.`;
        await whatsapp.sendMessage(message.from, response);
        console.log(`Document requirements for ${serviceName} sent to`, message.from);
    } catch (error) {
        console.error('Error in handleDocumentsRequest:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function processStaffContactReason(whatsappId, userContext, reason) {
    try {
        userContext.awaitingStaffContactReason = false;
        messageContext.set(whatsappId, userContext);
        clearUserTimeout(whatsappId);

        await whatsapp.sendMessage(whatsappId, `धन्यवाद! तुमचे कारण "${reason}" कर्मचाऱ्यांना पाठवले आहे. आम्ही लवकरच तुमच्याशी संपर्क साधू.${responseFooter}`);
        await whatsapp.sendMessage(OWNER_NUMBER, `नवीन कर्मचारी संपर्क विनंती:\nWhatsApp ID: ${whatsappId}\nकारण: ${reason}\nकृपया कार्यवाही करा.`);
        console.log(`Staff contact reason "${reason}" processed for ${whatsappId}`);
    } catch (error) {
        console.error('Error in processStaffContactReason:', error);
        await whatsapp.sendMessage(whatsappId, `क्षमस्व, कर्मचारी संपर्क विनंतीवर प्रक्रिया करताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function processWorkOrder(whatsappId, userContext, reason, userName) {
    try {
        const documents = userContext.documents;
        if (!documents || documents.length === 0) {
            console.error('No documents found for work order:', whatsappId);
            await whatsapp.sendMessage(whatsappId, `त्रुटी: कोणतेही दस्तऐवज सापडले नाहीत. कृपया दस्तऐवज पाठवा.`);
            return;
        }

        const documentsInfo = documents.map(doc => doc.filename).join(', ');
        const orderId = `WO-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const submissionDate = new Date().toISOString();
        const initialStatus = 'Pending Review';

        // Determine serviceType based on reason
        let serviceType = reason;
        const normalizedReason = reason.toLowerCase().trim();
        if (services[reason]) {
            serviceType = reason;
        } else if (serviceAliases[normalizedReason]) {
            serviceType = serviceAliases[normalizedReason];
        }

        // Save client if not exists
        db.run(`INSERT OR IGNORE INTO clients (whatsappId, joinedDate) VALUES (?, ?)`, [whatsappId, submissionDate], (err) => {
            if (err) console.error("Error inserting client:", err.message);
        });

        // Save work order
        db.run(
            `INSERT INTO work_orders (orderId, whatsappId, serviceType, documentsSent, reason, userName, submissionDate, status, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [orderId, whatsappId, serviceType, documentsInfo, reason, userName, submissionDate, initialStatus, submissionDate],
            async function(err) {
                if (err) {
                    console.error("Error inserting work order:", err.message);
                    await whatsapp.sendMessage(whatsappId, `क्षमस्व, तुमचे काम नोंदवताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.`);
                    return;
                }

                // Save documents to database
                for (let i = 0; i < documents.length; i++) {
                    const mediaData = documents[i];
                    const documentId = uuidv4();
                    const filename = `${reason}_${mediaData.filename}`;
                    db.run(
                        `INSERT INTO documents (documentId, orderId, mimetype, filename, data) VALUES (?, ?, ?, ?, ?)`,
                        [documentId, orderId, mediaData.mimetype, filename, mediaData.data],
                        (err) => {
                            if (err) console.error(`Error saving document ${filename}:`, err.message);
                        }
                    );
                }

                // Update context
                userContext.documents = [];
                userContext.awaitingReason = false;
                userContext.lastReason = null;
                messageContext.set(whatsappId, userContext);

                // Notify user
                const confirmation = `धन्यवाद! तुमचे काम नोंदवले आहे. *ऑर्डर आयडी: ${orderId}*. आमचे कर्मचारी लवकरच तुमच्याशी संपर्क साधतील आणि पुढील प्रक्रिया करतील.\n\nतुम्ही तुमच्या कामाची स्थिती कधीही *'माझ्या कामाची स्थिती'* ही कमांड वापरून तपासू शकता.${responseFooter}`;
                await whatsapp.sendMessage(whatsappId, confirmation);
                await whatsapp.sendMessage(whatsappId, `${serviceType}\n${orderId}`);

                // Notify owner
                whatsapp.sendMessage(OWNER_NUMBER,
                    `🟢 *नवीन काम नोंदवले आहे!* 🟢\n\n` +
                    `*वापरकर्ता:* ${whatsappId.split('@')[0]}\n` +
                    `*सेवा:* ${reason}\n` +
                    `*ऑर्डर आयडी:* ${orderId}\n` +
                    `*दस्तऐवज:* ${documentsInfo}\n\n` +
                    `कागदपत्रे पाहण्यासाठी, कृपया हा आदेश पाठवा: *get_docs ${orderId}*`
                ).then(() => {
                    whatsapp.sendMessage(OWNER_NUMBER, `${orderId}`);
                }).catch(err => console.error('Error notifying owner:', err));

                console.log('Work order saved and notifications sent for', whatsappId);
            }
        );
    } catch (error) {
        console.error('Error in processWorkOrder:', error);
        await whatsapp.sendMessage(whatsappId, `क्षमस्व, तुमचे काम नोंदवताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.`);
    }
}

async function handleCheckStatus(message, userContext) {
    try {
        const whatsappId = message.from;
        userContext.awaitingOrderId = true;
        messageContext.set(whatsappId, userContext);
        
        await whatsapp.sendMessage(
            whatsappId,
            `कृपया तुमचा ऑर्डर आयडी द्या (उदा., WO-123456-ABC) जेणेकरून मी तुमच्या कामाची स्थिती तपासू शकेन.${responseFooter}`
        );
        console.log('Prompted user for order ID:', whatsappId);
        
    } catch (error) {
        console.error('Error in handleCheckStatus:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function getWorkList(message, userContext) {
    try {
        const whatsappId = message.from;

        // Queries for work orders
        const pendingQuery = `
            SELECT DISTINCT orderId, serviceType, status, lastUpdated
            FROM work_orders
            WHERE whatsappId = ? AND status NOT IN ('Completed', 'Done')
            ORDER BY submissionDate DESC
        `;
        const completedQuery = `
            SELECT DISTINCT orderId, serviceType, status, lastUpdated
            FROM work_orders
            WHERE whatsappId = ? AND status IN ('Completed', 'Done')
            ORDER BY submissionDate DESC
        `;
        const documentsQuery = `
            SELECT documentId, mimetype, filename, data
            FROM documents
            WHERE orderId = ?
        `;

        // Promisify db.all
        const dbAll = (sql, params) => new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Fetch pending and completed orders
        const pendingRows = await dbAll(pendingQuery, [whatsappId]);
        const completedRows = await dbAll(completedQuery, [whatsappId]);

        if (pendingRows.length === 0 && completedRows.length === 0) {
            await whatsapp.sendMessage(whatsappId, `तुम्ही सध्या कोणतीही कामे सबमिट केलेली नाहीत.${responseFooter}`);
            return;
        }

        let response = `तुम्ही सबमिट केलेल्या कामांची स्थिती:\n\n`;

        // Pending orders
        if (pendingRows.length > 0) {
            response += `📌 पेंडिंग कामे:\n\n`;
            for (const row of pendingRows) {
                response += `➡️ सेवा प्रकार: ${row.serviceType}\n-`;
                response += `   ऑर्डर आयडी: ${row.orderId}\n-`;
                response += `   स्थिती: ${row.status}\n-`;
                response += `   शेवटचे अपडेट: ${new Date(row.lastUpdated).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                }).replace(',', '')}\n\n`;
            }
        }

        // Completed orders
        if (completedRows.length > 0) {
            response += `📌 पूर्ण झालेली कामे:\n\n`;
            for (const row of completedRows) {
                response += `➡️ सेवा प्रकार: ${row.serviceType}\n-`;
                response += `   ऑर्डर आयडी: ${row.orderId}\n-`;
                response += `   स्थिती: ${row.status}\n-`;
                response += `   शेवटचे अपडेट: ${new Date(row.lastUpdated).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                }).replace(',', '')}\n`;

                // Fetch documents for this order
                const documents = await dbAll(documentsQuery, [row.orderId]);
                if (documents.length > 0) {
                    const docNames = documents.map(doc => doc.filename).join(', ');
                    response += `   दस्तऐवज: ${docNames} (खाली संलग्न)\n*टीप :- पूर्ण झालेलं दस्तऐवज हवं असेल तर फक्त पूर्ण झालेली ऑर्डर आयडी पाठवा*\n`;
                }
                response += `\n`;
            }
        }

        response += `तुम्हाला अधिक तपशील हवा असल्यास, कृपया कर्मचाऱ्यांशी संपर्क साधा.`;
        await whatsapp.sendMessage(whatsappId, response);
        await whatsapp.sendMessage(whatsappId, `कर्मचाऱ्यांशी संपर्क साधण्यासाठी Contact Staff टाइप करा. 😊`);

        // Send order IDs
        for (const row of [...pendingRows, ...completedRows]) {
            if (row.orderId) {
                await whatsapp.sendMessage(whatsappId, `${row.serviceType} :\n${row.orderId}`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        console.log('Work status sent to', whatsappId);
    } catch (error) {
        console.error('Error in getWorkList:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function handleOrderIdStatus(message, userContext, orderId) {
    try {
        const whatsappId = message.from;

        // Query for specific work order
        const query = `
            SELECT orderId, serviceType, status, lastUpdated
            FROM work_orders
            WHERE orderId = ? AND whatsappId = ?
        `;
        const documentsQuery = `
            SELECT documentId, mimetype, filename, data
            FROM documents
            WHERE orderId = ?
        `;

        // Promisify db.get and db.all
        const dbGet = (sql, params) => new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        const dbAll = (sql, params) => new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const row = await dbGet(query, [orderId, whatsappId]);
        if (!row) {
            await whatsapp.sendMessage(
                whatsappId,
                `ऑर्डर आयडी ${orderId} सापडला नाही किंवा हा तुमच्या WhatsApp आयडीशी जुळत नाही. कृपया योग्य ऑर्डर आयडी तपासा आणि पुन्हा प्रयत्न करा.${responseFooter}`
            );
            userContext.awaitingOrderId = false;
            messageContext.set(whatsappId, userContext);
            clearUserTimeout(whatsappId);
            return;
        }

        let response = `तुमच्या ऑर्डर ${orderId} ची स्थिती:\n\n`;
        response += `➡️ सेवा प्रकार: ${row.serviceType}\n`;
        response += `   ऑर्डर आयडी: ${row.orderId}\n`;
        response += `   स्थिती: ${row.status}\n`;
        response += `   शेवटचे अपडेट: ${new Date(row.lastUpdated).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }).replace(',', '')}\n\n`;

        // Check if status is completed
        const isCompleted = row.status.toLowerCase() === 'completed' || row.status.toLowerCase() === 'complete' || row.status.toLowerCase() === 'done';
        if (isCompleted) {
            response += `तुमचे काम पूर्ण झाले आहे! खालील दस्तऐवज संलग्न आहेत:\n`;
        } else {
            response += `तुम्हाला अधिक तपशील हवा असल्यास, कृपया कर्मचाऱ्यांशी संपर्क साधा.`;
        }

        await whatsapp.sendMessage(whatsappId, response);
        await whatsapp.sendMessage(whatsappId, `कर्मचाऱ्यांशी संपर्क साधण्यासाठी Contact Staff टाइप करा. 😊`);

        // Send order ID
        await whatsapp.sendMessage(whatsappId, `${row.serviceType} :\n${row.orderId}`);
        await new Promise(resolve => setTimeout(resolve, 500));

        // If completed, send documents
        if (isCompleted) {
            const documents = await dbAll(documentsQuery, [orderId]);
            if (documents.length === 0) {
                await whatsapp.sendMessage(whatsappId, `ऑर्डर ${orderId} साठी कोणतेही पूर्ण झालेले दस्तऐवज सापडले नाहीत. कृपया कर्मचाऱ्यांशी संपर्क साधा.${responseFooter}`);
            } else {
                for (const doc of documents) {
                    if (doc.documentId && doc.mimetype && doc.data) {
                        try {
                            const media = new MessageMedia(doc.mimetype, doc.data, doc.filename);
                            await whatsapp.sendMessage(whatsappId, `पूर्ण झालेला दस्तऐवज: ${doc.filename}`, { media });
                            console.log(`Sent completed document ${doc.filename} for order ${orderId} to ${whatsappId}`);
                        } catch (sendError) {
                            console.error(`Error sending document ${doc.filename} for order ${orderId}:`, sendError);
                            await whatsapp.sendMessage(whatsappId, `त्रुटी: ऑर्डर ${orderId} साठी दस्तऐवज ${doc.filename} पाठवता आला नाही. कृपया कर्मचाऱ्यांशी संपर्क साधा.${responseFooter}`);
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Avoid rate limits
                    }
                }
            }
        }

        userContext.awaitingOrderId = false;
        messageContext.set(whatsappId, userContext);
        clearUserTimeout(whatsappId);
        console.log(`Order status for ${orderId} sent to`, whatsappId);
    } catch (error) {
        console.error('Error in handleOrderIdStatus:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, ऑर्डर ${orderId} ची स्थिती तपासताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
        userContext.awaitingOrderId = false;
        messageContext.set(message.from, userContext);
        clearUserTimeout(message.from);
    }
}

async function handleChargesRequest(message, userContext) {
    try {
        const chargesList = Object.entries(services).map(([name, data]) => `\n- ${name}: ${data.charges}`).join('');
        const response = `सेवा शुल्क माहिती:\n${chargesList}\n\nकृपया तुमची सेवा निवडा किंवा तुमचा प्रश्न विचारा.`;
        await whatsapp.sendMessage(message.from, response);
        console.log('Charges list sent to', message.from);
    } catch (error) {
        console.error('Error in handleChargesRequest:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function handleStaffContact(message, userContext) {
    try {
        userContext.awaitingStaffContactReason = true;
        messageContext.set(message.from, userContext);
        await whatsapp.sendMessage(message.from, `कृपया कर्मचाऱ्यांशी संपर्क साधण्याचे कारण सांगा (उदा., "पॅन कार्डच्या शुल्काबाबत माहिती हवी").`);
        console.log('Prompted user for staff contact reason:', message.from);

        reasonTimeouts.set(
            message.from,
            setTimeout(async () => {
                userContext = messageContext.get(message.from) || {};
                if (userContext.awaitingStaffContactReason) {
                    userContext.awaitingStaffContactReason = false;
                    messageContext.set(message.from, userContext);
                    await whatsapp.sendMessage(message.from, `कर्मचाऱ्यांशी संपर्क साधण्याचे कारण देण्याची वेळ संपली. कृपया पुन्हा 'कर्मचाऱ्यांशी संपर्क करायचा आहे' कमांड वापरा (Contact staff).`);
                    console.log('Staff contact reason timeout for', message.from);
                }
            }, REASON_TIMEOUT)
        );
    } catch (error) {
        console.error('Error in handleStaffContact:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function handleDocumentPrompt(message, userContext) {
    try {
        const response = `धन्यवाद! कृपया तुमची संबंधित कागदपत्रे मला पाठवा. मी तुमच्या कागदपत्रांवर काम सुरू करेन आणि लवकरच संपर्क साधेन.\n\nजर काही अजून प्रश्न असतील तर विचारायला मोकळ्या मनाने विचारा.${responseFooter}`;
        await whatsapp.sendMessage(message.from, response);
        console.log('Document prompt sent to', message.from);
    } catch (error) {
        console.error('Error in handleDocumentPrompt:', error);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
    }
}

async function handleOwnerUpdateStatus(message, userContext) {
    try {
        const parts = message.body.trim().split(' ');
        if (parts.length < 3 || message.body.toLowerCase() === 'status') {
            await whatsapp.sendMessage(OWNER_NUMBER, `कृपया योग्य फॉरमॅट वापरा: *status <ऑर्डर आयडी> <नवीन स्थिती>*\nउदा: status WO-123456 Payment Pending`);
            return;
        }

        const orderId = parts[1].trim();
        const tempStatus = parts.slice(2).join(' ').trim();
        const newStatus = tempStatus.toLowerCase();

        if (orderId === '' || newStatus === '') {
            await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर आयडी आणि नवीन स्थिती आवश्यक आहे. उदाहरण: *status WO-123456 Payment Pending*`);
            return;
        }

        const lastUpdated = new Date().toISOString();

        db.run(
            `UPDATE work_orders SET status = ?, lastUpdated = ? WHERE orderId = ?`,
            [newStatus, lastUpdated, orderId],
            async function(err) {
                if (err) {
                    console.error("Error updating work order status:", err.message);
                    await whatsapp.sendMessage(OWNER_NUMBER, `स्थिती अपडेट करताना त्रुटी आली: ${err.message}`);
                    return;
                }
                if (this.changes > 0) {
                    await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर आयडी ${orderId} ची स्थिती यशस्वीरित्या "${newStatus}" मध्ये अपडेट केली.`);

                    // Check if status is Completed
                    const isCompleted = newStatus.toLowerCase() === 'completed' || newStatus.toLowerCase() === 'complete' || newStatus.toLowerCase() === 'done';
                    if (isCompleted) {
                        // Update status to "Completed" consistently
                        db.run(
                            `UPDATE work_orders SET status = ?, lastUpdated = ?, notes = ? WHERE orderId = ?`,
                            ['completed', new Date().toISOString(), 'काम पूर्ण झाले आहे.', orderId],
                            async function(updateErr) {
                                if (updateErr) {
                                    console.error("Error updating order status to completed:", updateErr.message);
                                    await whatsapp.sendMessage(OWNER_NUMBER, `त्रुटी: ऑर्डर ${orderId} ची स्थिती अपडेट करता आली नाही.`);
                                    return;
                                }

                                // Delete associated documents from database
                                db.run(`DELETE FROM documents WHERE orderId = ?`, [orderId], async (deleteErr) => {
                                    if (deleteErr) {
                                        console.error("Error deleting documents for order:", deleteErr.message);
                                        await whatsapp.sendMessage(OWNER_NUMBER, `त्रुटी: ऑर्डर ${orderId} साठी दस्तऐवज हटवता आले नाहीत.`);
                                        return;
                                    }
                                    await whatsapp.sendMessage(OWNER_NUMBER, `✅ ऑर्डर ${orderId} यशस्वीरित्या पूर्ण झाली आहे. सर्व दस्तऐवज हटवले.`);
                                    console.log(`Order ${orderId} completed and documents deleted from database.`);
                                });

                                userContext.awaitingOwnerDocument = true;
                                userContext.orderIdForDocument = orderId;
                                messageContext.set(OWNER_NUMBER, userContext);
                                await whatsapp.sendMessage(
                                    OWNER_NUMBER,
                                    `कृपया ऑर्डर ${orderId} साठी पूर्ण झालेला दस्तऐवज (PDF, JPEG, PNG, Word) पाठवा.`
                                );

                                // Set timeout for owner document
                                ownerDocumentTimeouts.set(
                                    OWNER_NUMBER,
                                    setTimeout(async () => {
                                        userContext = messageContext.get(OWNER_NUMBER) || {};
                                        if (userContext.awaitingOwnerDocument) {
                                            userContext.awaitingOwnerDocument = false;
                                            userContext.orderIdForDocument = null;
                                            messageContext.set(OWNER_NUMBER, userContext);
                                            await whatsapp.sendMessage(
                                                OWNER_NUMBER,
                                                `ऑर्डर ${orderId} साठी दस्तऐवज अपलोड करण्याची वेळ संपली. आवश्यक असल्यास पुन्हा स्थिती अपडेट करा.`
                                            );
                                            console.log(`Owner document timeout for order ${orderId}`);
                                        }
                                    }, OWNER_DOCUMENT_TIMEOUT)
                                );
                            }
                        );
                    }

                    // Notify client
                    db.get(`SELECT whatsappId, serviceType FROM work_orders WHERE orderId = ?`, [orderId], async (err, row) => {
                        if (err) {
                            console.error('Error fetching client WhatsApp ID:', err.message);
                            return;
                        }
                        if (row && row.whatsappId) {
                            await whatsapp.sendMessage(
                                row.whatsappId,
                                `तुमच्या कामाची स्थिती अपडेट झाली आहे:\n\n` +
                                `➡️ सेवा प्रकार: ${row.serviceType}\n` +
                                `   ऑर्डर आयडी: ${orderId}\n` +
                                `   स्थिती: ${newStatus}\n` +
                                `   शेवटचे अपडेट: ${new Date(lastUpdated).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true
                                }).replace(',', '')}\n\n` +
                                `${isCompleted ? `पूर्ण झालेला दस्तऐवज लवकरच पाठवला जाईल. ` : ''}` +
                                `तुम्ही 'माझ्या कामाची स्थिती/Document status' वापरून तपासू शकता किंवा वेबसाइटवर ऑर्डर आयडी आणि फोन नंबर टाकून तपासू शकता.`
                            );
                            console.log(`Notified client ${row.whatsappId} about status update for ${orderId}`);
                        }
                    });
                } else {
                    await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर आयडी ${orderId} सापडला नाही.`);
                }
            }
        );
    } catch (error) {
        console.error('Error in handleOwnerUpdateStatus:', error);
        await whatsapp.sendMessage(OWNER_NUMBER, `स्थिती अपडेट करताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.`);
    }
}

async function handleOwnerDeleteOrder(message) {
    try {
        const parts = message.body.trim().split(' ');
        if (parts.length !== 2) {
            await whatsapp.sendMessage(OWNER_NUMBER, `कृपया योग्य फॉरमॅट वापरा: *delete <ऑर्डर आयडी>*\nउदा: delete WO-123456`);
            return;
        }

        const orderId = parts[1].trim();

        db.run(`DELETE FROM work_orders WHERE orderId = ?`, [orderId], async function(err) {
            if (err) {
                console.error("Error deleting work order:", err.message);
                await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर हटवताना त्रुटी आली: ${err.message}`);
                return;
            }
            if (this.changes > 0) {
                db.run(`DELETE FROM documents WHERE orderId = ?`, [orderId], (err) => {
                    if (err) console.error("Error deleting associated documents:", err.message);
                });
                await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर आयडी ${orderId} यशस्वीरित्या हटवला.`);
                console.log(`Work order ${orderId} deleted by owner.`);
            } else {
                await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर आयडी ${orderId} सापडला नाही.`);
            }
        });
    } catch (error) {
        console.error('Error in handleOwnerDeleteOrder:', error);
        await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर हटवताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.`);
    }
}

async function handleOwnerListOrders(message) {
    try {
        const parts = message.body.trim().split(' ');
        let query = `SELECT orderId, whatsappId, serviceType, status FROM work_orders WHERE status NOT IN ('completed', 'done', 'complete') ORDER BY submissionDate DESC LIMIT 10`;
        let params = [];

        if (parts.length > 1) {
            const targetWhatsappId = parts[1].trim();
            query = `SELECT orderId, whatsappId, serviceType, status FROM work_orders WHERE whatsappId = ? AND status NOT IN ('completed', 'done', 'complete') ORDER BY submissionDate DESC LIMIT 10`;
            params.push(targetWhatsappId);
        }

        db.all(query, params, async (err, rows) => {
            if (err) {
                console.error('Error fetching pending orders for owner:', err);
                await whatsapp.sendMessage(OWNER_NUMBER, `पेंडिंग ऑर्डरची यादी मिळवताना त्रुटी आली.`);
                return;
            }

            if (rows.length === 0) {
                await whatsapp.sendMessage(OWNER_NUMBER, `कोणतीही पेंडिंग ऑर्डर सापडली नाही.${parts.length > 1 ? ` (WhatsApp ID: ${params[0]})` : ''}`);
                return;
            }

            let response = `पेंडिंग ऑर्डरची यादी (${rows.length}):\n\n`;
            rows.forEach(row => {
                response += `*ID:* ${row.orderId}\n`;
                response += `*Client:* ${row.whatsappId.split('@')[0]}\n`;
                response += `*Service:* ${row.serviceType || 'N/A'}\n`;
                response += `*Status:* ${row.status}\n\n`;
            });
            await whatsapp.sendMessage(OWNER_NUMBER, response);
            console.log('Pending orders list sent to owner');
        });
    } catch (error) {
        console.error('Error in handleOwnerListOrders:', error);
        await whatsapp.sendMessage(OWNER_NUMBER, `पेंडिंग ऑर्डरची यादी मिळवताना त्रुटी आली.`);
    }
}

async function handleOwnerListCompletedOrders(message) {
    try {
        const parts = message.body.trim().split(' ');
        let query = `SELECT orderId, whatsappId, serviceType, status FROM work_orders WHERE status IN ('completed', 'done', 'complete') ORDER BY submissionDate DESC LIMIT 10`;
        let params = [];

        if (parts.length > 1) {
            const targetWhatsappId = parts[1].trim();
            query = `SELECT orderId, whatsappId, serviceType, status FROM work_orders WHERE whatsappId = ? AND status IN ('completed', 'done', 'complete') ORDER BY submissionDate DESC LIMIT 10`;
            params.push(targetWhatsappId);
        }

        db.all(query, params, async (err, rows) => {
            if (err) {
                console.error('Error fetching completed orders for owner:', err);
                await whatsapp.sendMessage(OWNER_NUMBER, `पूर्ण झालेल्या ऑर्डरची यादी मिळवताना त्रुटी आली.`);
                return;
            }

            if (rows.length === 0) {
                await whatsapp.sendMessage(OWNER_NUMBER, `कोणतीही पूर्ण झालेली ऑर्डर सापडली नाही.${parts.length > 1 ? ` (WhatsApp ID: ${params[0]})` : ''}`);
                return;
            }

            let response = `पूर्ण झालेल्या ऑर्डरची यादी (${rows.length}):\n\n`;
            rows.forEach(row => {
                response += `*ID:* ${row.orderId}\n`;
                response += `*Client:* ${row.whatsappId.split('@')[0]}\n`;
                response += `*Service:* ${row.serviceType || 'N/A'}\n`;
                response += `*Status:* ${row.status}\n\n`;
            });
            await whatsapp.sendMessage(OWNER_NUMBER, response);
            console.log('Completed orders list sent to owner');
        });
    } catch (error) {
        console.error('Error in handleOwnerListCompletedOrders:', error);
        await whatsapp.sendMessage(OWNER_NUMBER, `पूर्ण झालेल्या ऑर्डरची यादी मिळवताना त्रुटी आली.`);
    }
}

async function handleGetDocumentsForOrder(message, userContext, orderId) {
    const docs_id = orderId.toUpperCase();
    try {
        if (message.from !== OWNER_NUMBER) {
            await whatsapp.sendMessage(message.from, 'आपल्याला या आदेशाची परवानगी नाही.');
            return;
        }

        if (!docs_id) {
            await whatsapp.sendMessage(message.from, 'कृपया ऑर्डर आयडी द्या. उदाहरणार्थ: get_docs WO-123456789-ABC');
            return;
        }

        db.get(`SELECT reason FROM work_orders WHERE orderId = ?`, [docs_id], async (err, row) => {
            if (err) {
                console.error('Error fetching order reason:', err);
                await whatsapp.sendMessage(OWNER_NUMBER, `त्रुटी: ऑर्डर ${docs_id} साठी माहिती मिळवता आली नाही.`);
                return;
            }

            if (!row) {
                await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर आयडी ${docs_id} सापडला नाही.`);
                return;
            }

            const reason = row.reason;
            db.all(`SELECT documentId, mimetype, filename, data FROM documents WHERE orderId = ?`, [docs_id], async (err, docs) => {
                if (err) {
                    console.error('Error fetching documents for order:', err);
                    await whatsapp.sendMessage(OWNER_NUMBER, `त्रुटी: ऑर्डर ${docs_id} साठी कागदपत्रे मिळवता आली नाहीत.`);
                    return;
                }

                if (!docs || docs.length === 0) {
                    await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर ${docs_id} साठी कोणतेही कागदपत्रे उपलब्ध नाहीत.\n\nकारण: *${reason}*`);
                    return;
                }

                // Check if the order is completed before sending documents
                db.get(`SELECT status FROM work_orders WHERE orderId = ?`, [docs_id], async (err, statusRow) => {
                    if (err) {
                        console.error('Error fetching order status:', err);
                        await whatsapp.sendMessage(OWNER_NUMBER, `त्रुटी: ऑर्डर ${docs_id} साठी स्थिती मिळवता आली नाही.`);
                        return;
                    }
                    if (!statusRow) {
                        await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर आयडी ${docs_id} सापडला नाही.`);
                        return;
                    }
                    const status = (statusRow.status || '').toLowerCase();
                    if (status === 'completed' || status === 'done' || status === 'complete') {
                        await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर ${docs_id} पूर्ण झाली आहे, त्यामुळे संबंधित कागदपत्रे हटवण्यात आली आहेत.`);
                        return;
                    }

                    await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर ${docs_id} साठी कारण: *${reason}*\n\nखालील कागदपत्रे पाठवत आहे:`);

                    for (const doc of docs) {
                        try {
                            const media = new MessageMedia(doc.mimetype, doc.data, doc.filename);
                            await whatsapp.sendMessage(OWNER_NUMBER, '', { media });
                            console.log(`Sent document ${doc.filename} for order ${docs_id} to owner`);
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to prevent flooding
                        } catch (mediaSendError) {
                            console.error(`Error sending document ${doc.filename}:`, mediaSendError);
                            await whatsapp.sendMessage(OWNER_NUMBER, `त्रुटी: ${doc.filename} पाठवताना अडचण आली.`);
                        }
                    }

                    await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर ${docs_id} साठी सर्व कागदपत्रे पाठवली.`);
                    console.log(`Documents for order ${docs_id} sent to owner.`);
                });
            });
        });
    } catch (error) {
        console.error('Error in handleGetDocumentsForOrder:', error);
        await whatsapp.sendMessage(OWNER_NUMBER, `कागदपत्रे मिळवताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.`);
    }
}

function clearUserTimeout(userId) {
    if (reasonTimeouts.has(userId)) {
        clearTimeout(reasonTimeouts.get(userId));
        reasonTimeouts.delete(userId);
        console.log('Cleared reason timeout for', userId);
    }
}

function clearOwnerDocumentTimeout(userId) {
    if (ownerDocumentTimeouts.has(userId)) {
        clearTimeout(ownerDocumentTimeouts.get(userId));
        ownerDocumentTimeouts.delete(userId);
        console.log('Cleared owner document timeout for', userId);
    }
}

// QR Code Generation
whatsapp.on('qr', async (qr) => {
    try {
        global.qrDataUrl = await QRCode.toDataURL(qr); // Store QR code in memory
        console.log('QR code generated and available at /qrcode');
    } catch (error) {
        console.error('Error generating QR code:', error);
    }
});

whatsapp.on('ready', () => {
    console.log('WhatsApp bot is ready!');
});

whatsapp.on('message', async (message) => {
    try {
        // Validate message
        if (!message || !message.from || !message.from.includes('@c.us')) {
            console.error('Invalid message received:', JSON.stringify(message, null, 2));
            return;
        }

        const chat = await message.getChat();
        if (!chat || !chat.id || chat.isGroup) {
            console.log(`Ignoring group message or invalid chat: ${chat?.id?._serialized || 'unknown'}`);
            return;
        }

        // Initialize user context
        if (!messageContext.has(message.from)) {
            messageContext.set(message.from, {
                documents: [],
                awaitingReason: false,
                lastReason: null,
                awaitingOwnerDocument: false,
                orderIdForDocument: null,
                awaitingStaffContactReason: false,
                awaitingOrderId: false
            });
        }
        let userContext = messageContext.get(message.from);

        const messageBody = message.body ? message.body.trim().toLowerCase() : '';
        const originalMessage = message.body ? message.body.trim() : '';
        const normalizedInput = originalMessage.toLowerCase().trim();

        if (message.from === OWNER_NUMBER) {
            responseFooter = `\n\nCommand for admin :\n- Status <ORDER_ID> <NEW_STATUS>\n- Delete <ORDER_ID>\n- List (Showing Pending Work)\n- Complete (Showing Completed Work)\n- Get_Docs <ORDER_ID>`;
        } else {
            responseFooter = '\n\n📌 कमांड:\n- हाय / hi / hello / hey\n- सेवांची यादी / service list / list of services\n- कागदपत्र कोणती लागतात? / documents list / list of document\n- सेवा शुल्क काय आहे? / charges / service charges\n- कर्मचाऱ्यांशी संपर्क करायचा आहे\n- कागदपत्र पाठवू का? / ready for sending document\n- माझ्या कामाची स्थिती / status / check my work status\n- माझे काम / my works list / work list';
        }

        // Handle commands
        await chat.sendStateTyping();

        // --- OWNER COMMANDS ---
        if (message.from === OWNER_NUMBER) {
            // Handle owner document upload
            if (userContext.awaitingOwnerDocument && message.hasMedia) {
                try {
                    const media = await message.downloadMedia();
                    if (!media || !media.mimetype) {
                        await whatsapp.sendMessage(OWNER_NUMBER, `त्रुटी: दस्तऐवज डाउनलोड करता आला नाही. कृपया पुन्हा प्रयत्न करा.`);
                        await chat.clearState();
                        return;
                    }

                    if (!SUPPORTED_DOCUMENT_TYPES.includes(media.mimetype)) {
                        await whatsapp.sendMessage(OWNER_NUMBER, `असमर्थित दस्तऐवज स्वरूप. कृपया PDF, JPEG, PNG, किंवा Word दस्तऐवज पाठवा.`);
                        await chat.clearState();
                        return;
                    }

                    if (message._data.size > MAX_DOCUMENT_SIZE) {
                        await whatsapp.sendMessage(OWNER_NUMBER, `दस्तऐवज खूप मोठा आहे. कृपया 10 MB पेक्षा लहान फाइल पाठवा.`);
                        await chat.clearState();
                        return;
                    }

                    const orderId = userContext.orderIdForDocument;
                    const documentId = uuidv4();
                    const filename = message._data.filename || `completed_${orderId}.${media.mimetype.split('/')[1]}`;

                    db.run(
                        `INSERT INTO documents (documentId, orderId, mimetype, filename, data) VALUES (?, ?, ?, ?, ?)`,
                        [documentId, orderId, media.mimetype, filename, media.data],
                        async (err) => {
                            if (err) {
                                console.error('Error saving owner document:', err.message);
                                await whatsapp.sendMessage(OWNER_NUMBER, `दस्तऐवज जतन करताना त्रुटी: ${err.message}`);
                                return;
                            }

                            userContext.awaitingOwnerDocument = false;
                            userContext.orderIdForDocument = null;
                            messageContext.set(OWNER_NUMBER, userContext);
                            clearOwnerDocumentTimeout(OWNER_NUMBER);

                            await whatsapp.sendMessage(OWNER_NUMBER, `ऑर्डर ${orderId} साठी दस्तऐवज ${filename} यशस्वीरित्या जतन केला.`);
                            console.log(`Owner document ${filename} saved for order ${orderId}`);

                            // Notify client
                            db.get(`SELECT whatsappId FROM work_orders WHERE orderId = ?`, [orderId], async (err, row) => {
                                if (err) {
                                    console.error('Error fetching client WhatsApp ID:', err.message);
                                    return;
                                }
                                if (row && row.whatsappId) {
                                    try {
                                        const mediaMessage = new MessageMedia(media.mimetype, media.data, filename);
                                        await whatsapp.sendMessage(row.whatsappId, `तुमच्या ऑर्डर ${orderId} साठी पूर्ण झालेला दस्तऐवज:`, { media: mediaMessage });
                                        console.log(`Sent completed document to client ${row.whatsappId}`);
                                    } catch (sendError) {
                                        console.error(`Error sending document to client ${row.whatsappId}:`, sendError);
                                        await whatsapp.sendMessage(row.whatsappId, `त्रुटी: तुमचा पूर्ण झालेला दस्तऐवज पाठवता आला नाही. कृपया 'माझ्या कामाची स्थिती (Document status)' तपासा किंवा वेबसाइटवर ऑर्डर आयडी आणि फोन नंबर टाकून तपासा.`);
                                    }
                                }
                            });
                        }
                    );
                    await chat.clearState();
                    return;
                } catch (mediaError) {
                    console.error('Error processing owner document:', mediaError);
                    await whatsapp.sendMessage(OWNER_NUMBER, `दस्तऐवज प्रक्रिया करताना त्रुटी. कृपया पुन्हा प्रयत्न करा.`);
                    await chat.clearState();
                    return;
                }
            }

            // Other owner commands
            if (messageBody.startsWith('status ')) {
                await handleOwnerUpdateStatus(message, userContext);
                await chat.clearState();
                return;
            } else if (messageBody.startsWith('delete ')) {
                await handleOwnerDeleteOrder(message);
                await chat.clearState();
                return;
            } else if (messageBody.startsWith('list')) {
                await handleOwnerListOrders(message);
                await chat.clearState();
                return;
            } else if (messageBody.startsWith('completed') || messageBody.startsWith('complete')) {
                await handleOwnerListCompletedOrders(message);
                await chat.clearState();
                return;
            } else if (messageBody.startsWith('get_docs')) {
                const orderId = messageBody.split(' ')[1]?.trim();
                await handleGetDocumentsForOrder(message, userContext, orderId);
                await chat.clearState();
                return;
            }
        }

        // --- User Commands ---
        // Handle staff contact reason
        if (userContext.awaitingStaffContactReason) {
            const reason = message.body ? message.body.trim() : 'No reason provided';
            if (reason === '' && !message.hasMedia) {
                await whatsapp.sendMessage(message.from, `कृपया वैध कारण सांगा (उदा., 'पॅन कार्डच्या शुल्काबाबत माहिती हवी').${responseFooter}`);
                await chat.clearState();
                return;
            }
            await processStaffContactReason(message.from, userContext, reason);
            await chat.clearState();
            return;
        }
        // Handle order ID for status check
        if (message.body.startsWith('WO-')) {
            const orderId = message.body.trim();
            await handleOrderIdStatus(message, userContext, orderId);
            await chat.clearState();
            return;
        }
        // Handle reason and name
        if (userContext.awaitingReason && message.body) {
            try {
                const input = message.body.trim();
                const parts = input.split(',').map(part => part.trim());
                if (parts.length < 2 || parts[0] === '' || parts[1] === '') {
                    await whatsapp.sendMessage(
                        message.from,
                        `कृपया वैध कारण आणि नाव सांगा (उदा., "Domocile, राम शिंदे").`
                    );
                    return;
                }

                const reason = parts[0];
                const userName = parts[1];

                clearUserTimeout(message.from);
                await processWorkOrder(message.from, userContext, reason, userName);
                await chat.clearState();
            } catch (error) {
                console.error('Error processing reason and name:', error);
                await whatsapp.sendMessage(message.from, `क्षमस्व, तुमच्या कारण आणि नावावर प्रक्रिया करताना त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
                await chat.clearState();
            }
            return;
        }

        // Other user commands
        if (messageBody === 'हाय' || messageBody === 'hii' || messageBody === 'hyy' || messageBody === 'hy' || messageBody === 'hi' || messageBody === 'hello' || messageBody === 'hey' || messageBody === 'yo') {
            await handleGreeting(message, userContext);
        } else if (messageBody === 'सेवांची यादी' || messageBody === 'service' || messageBody === 'services' || messageBody === 'services list' || messageBody === 'service list' || messageBody === 'list of services') {
            await handleServiceList(message, userContext);
        } else if (messageBody === 'कागदपत्र कोणती लागतात?' || messageBody === 'document' || messageBody === 'documents' || messageBody === 'documents list' || messageBody === 'document list' || messageBody === 'list of document') {
            const response = `कृपया खालील सेवांपैकी एक निवडा ज्यासाठी कागदपत्रे हवी आहेत:\n${Object.keys(services).map(name => `\n- ${name}`).join('')}`;
            await whatsapp.sendMessage(message.from, response);
            console.log('Documents request prompt sent to', message.from);
        } else if (messageBody === 'सेवा शुल्क काय आहे?' || messageBody === 'service charges' || messageBody === 'charges' || messageBody === 'charge' || messageBody === 'services charges') {
            await handleChargesRequest(message, userContext);
        } else if (messageBody === 'कर्मचाऱ्यांशी संपर्क करायचा आहे' || messageBody === 'contact staff') {
            await handleStaffContact(message, userContext);
        } else if (messageBody === 'कागदपत्र पाठवू का?' || messageBody === 'sending document' || messageBody === 'ready for sending document') {
            await handleDocumentPrompt(message, userContext);
        } else if (messageBody === 'माझ्या कामाची स्थिती' || messageBody === 'check my work status' || messageBody === 'document status' || messageBody === 'status') {
            await handleCheckStatus(message, userContext);
        } else if (messageBody === 'माझे काम' || messageBody === 'my works list' || messageBody === 'work list') {
            await getWorkList(message, userContext);
        } else if (services[originalMessage] || serviceAliases[normalizedInput]) {
            const serviceName = services[originalMessage] ? originalMessage : serviceAliases[normalizedInput];
            await handleDocumentsRequest(message, userContext, serviceName);
            console.log(`Matched service ${serviceName} for input: ${originalMessage}`);
        } else if (message.hasMedia) {
            try {
                console.log('Attempting to download media for', message.from);
                await whatsapp.sendMessage(message.from, `⏳ कृपया थोडा वेळ थांबा, तुमचा दस्तऐवज प्रोसेस करत आहोत. धन्यवाद! 😊`);
                const media = await message.downloadMedia();
                if (!media || !media.mimetype) {
                    console.error('Media download failed or missing mimetype:', media);
                    await whatsapp.sendMessage(message.from, `त्रुटी: दस्तऐवज डाउनलोड करता आला नाही. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
                    await chat.clearState();
                    return;
                }

                if (!SUPPORTED_DOCUMENT_TYPES.includes(media.mimetype)) {
                    console.log('Unsupported media type:', media.mimetype);
                    await whatsapp.sendMessage(message.from, `असमर्थित दस्तऐवज स्वरूप. कृपया PDF, JPEG, PNG, किंवा Word दस्तऐवज पाठवा.`);
                    await chat.clearState();
                    return;
                }

                if (message._data.size > MAX_DOCUMENT_SIZE) {
                    console.log('Document too large:', message._data.size);
                    await whatsapp.sendMessage(message.from, `दस्तऐवज खूप मोठा आहे. कृपया 10 MB पेक्षा लहान फाइल पाठवा.`);
                    await chat.clearState();
                    return;
                }

                if (userContext.documents.length >= MAX_PENDING_DOCUMENTS) {
                    console.log('Too many pending documents for', message.from);
                    await whatsapp.sendMessage(message.from, `कृपया एका वेळी ${MAX_PENDING_DOCUMENTS} पेक्षा जास्त दस्तऐवज पाठवू नका. प्रथम विद्यमान दस्तऐवजांसाठी कारण द्या.`);
                    await chat.clearState();
                    return;
                }

                // Store document in memory temporarily
                const filename = message._data.filename || `${Date.now()}-${message.from.split('@')[0]}.${media.mimetype.split('/')[1]}`;
                userContext.documents.push({
                    mimetype: media.mimetype,
                    filename: filename,
                    data: media.data
                });
                messageContext.set(message.from, userContext);
                console.log('Document added to queue for', message.from, userContext);

                clearUserTimeout(message.from);

                // Prompt for reason and name
                reasonTimeouts.set(
                    message.from,
                    setTimeout(async () => {
                        try {
                            userContext = messageContext.get(message.from);
                            if (userContext && userContext.documents.length > 0 && !userContext.awaitingReason) {
                                userContext.awaitingReason = true;
                                messageContext.set(message.from, userContext);

                                for (let i = 0; i < userContext.documents.length; i++) {
                                    await whatsapp.sendMessage(message.from, `"${userContext.documents[i].filename}" प्राप्त झाला.`);
                                }
                                await chat.sendStateTyping();
                                await whatsapp.sendMessage(
                                    message.from,
                                    `आपण ${userContext.documents.length} दस्तऐवज पाठवले आहेत. कृपया सर्व दस्तऐवजांसाठी कारण आणि तुमचे नाव सांगा (उदा., "Domocile, राम शिंदे").`
                                );
                                console.log('Prompted user for reason and name:', message.from);
                            }
                        } catch (error) {
                            console.error('Error in reason timeout:', error);
                            await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
                        }
                    }, REASON_TIMEOUT)
                );

                await chat.clearState();
                console.log('Media processing completed for', message.from);
            } catch (mediaError) {
                console.error('Error processing media:', mediaError);
                await whatsapp.sendMessage(message.from, `त्रुटी: दस्तऐवज प्रक्रिया करताना अडचण. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
                await chat.clearState();
            }
        } else if (messageBody && !message.hasMedia) {
            const aiResponse = await handleAIResponse(message, originalMessage);
            if (aiResponse) {
                await whatsapp.sendMessage(message.from, aiResponse);
            } else {
                await handleStaffContact(message, userContext);
                console.log('AI prompted staff contact for', message.from);
            }
        }

        await chat.clearState();
    } catch (generalError) {
        console.error('General error in message handler:', generalError);
        await whatsapp.sendMessage(message.from, `क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा.${responseFooter}`);
        messageContext.delete(message.from);
        clearUserTimeout(message.from);
        clearOwnerDocumentTimeout(message.from);
    }
});

whatsapp.initialize().catch((error) => {
    console.error('Failed to initialize WhatsApp:', error);
});