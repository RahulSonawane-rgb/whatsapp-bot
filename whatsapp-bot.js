const QRCode = require('qrcode');
const { Client, MessageMedia } = require('whatsapp-web.js');
const { createClient } = require('redis');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Custom Redis Auth Strategy for whatsapp-web.js
class RedisAuthStrategy {
    constructor({ client, redisClient }) {
        this.client = client;
        this.redisClient = redisClient;
    }

    async setup(client) {
        this.client = client; // Bind client instance
        console.log('RedisAuthStrategy setup complete');
    }

    async beforeAll() {
        try {
            await this.redisClient.connect();
            console.log('Redis client connected');
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
        }
    }

    async afterAll() {
        try {
            await this.redisClient.quit();
            console.log('Redis client disconnected');
        } catch (error) {
            console.error('Failed to disconnect Redis:', error);
        }
    }

    async logout() {
        try {
            await this.redisClient.del(`session:${this.client.options.puppeteer.sessionId}`);
            console.log('Session cleared from Redis');
        } catch (error) {
            console.error('Failed to clear session from Redis:', error);
        }
    }

    async getAuth() {
        try {
            const sessionData = await this.redisClient.get(`session:${this.client.options.puppeteer.sessionId}`);
            return sessionData ? JSON.parse(sessionData) : null;
        } catch (error) {
            console.error('Failed to get session from Redis:', error);
            return null;
        }
    }

    async saveAuth(authData) {
        try {
            await this.redisClient.set(`session:${this.client.options.puppeteer.sessionId}`, JSON.stringify(authData));
            console.log('Session saved to Redis');
        } catch (error) {
            console.error('Failed to save session to Redis:', error);
        }
    }
}

const OWNER_NUMBER = process.env.OWNER_NUMBER || '91999999900@c.us';
const SUPPORTED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PENDING_DOCUMENTS = 10; // Max 10 documents queued per user
const REASON_TIMEOUT = 10 * 1000; // 10 seconds timeout for reason prompt

// In-memory store for context (queue of documents per user)
const messageContext = new Map();
const reasonTimeouts = new Map(); // Track timeouts per user

// Initialize Redis client
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379' // Replace with Render Key Value endpoint
});

// Configure WhatsApp client with Redis auth strategy
const whatsapp = new Client({
    authStrategy: new RedisAuthStrategy({
        client: null, // Will be set in setup
        redisClient
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
        ],
        sessionId: 'whatsapp-bot-session' // Unique session ID
    }
});

// Create a simple HTTP server to serve the QR code
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        const filePath = path.join(__dirname, 'qrcode.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading QR code page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
});

// Start the server on port assigned by Render or fallback to 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on Render at ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}/`);
});

whatsapp.on('qr', async (qr) => {
    try {
        // Generate QR code as a data URL
        const qrDataUrl = await QRCode.toDataURL(qr);
        
        // Create HTML content with the QR code
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
                    <h1>Scan the QR Code to Log In to WhatsApp</h1>
                    <img src="${qrDataUrl}" alt="WhatsApp QR Code">
                </div>
            </body>
            </html>
        `;
        
        // Save the HTML content to a file
        fs.writeFileSync(path.join(__dirname, 'qrcode.html'), htmlContent);
        console.log(`QR code generated at ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}/`);
    } catch (error) {
        console.error('Error generating QR code:', error);
    }
});

whatsapp.on('ready', () => {
    console.log('WhatsApp bot is ready!');
});

whatsapp.on('authenticated', () => {
    console.log('Authenticated successfully, session saved to Redis');
});

whatsapp.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
});

// Message handling
whatsapp.on('message', async (message) => {
    let chat;
    try {
        // Validate message
        if (!message || !message.from || !message.from.includes('@c.us')) {
            console.error('Invalid message received:', JSON.stringify(message, null, 2));
            return;
        }

        // Log message details
        console.log(`Message received from ${message.from}: ${message.body || '[Media]'}`);

        // Validate chat
        chat = await message.getChat();
        if (!chat || !chat.id) {
            console.error('Invalid chat for message:', message.body);
            return;
        }
        // Ignore group messages
        if (chat.isGroup) {
            console.log(`Ignoring message from group chat: ${chat.id._serialized}`);
            return;
        }

        console.log('Chat ID:', chat.id._serialized);

        // Initialize context for user if not exists
        if (!messageContext.has(message.from)) {
            messageContext.set(message.from, { documents: [], awaitingReason: false });
        }
        const userContext = messageContext.get(message.from);

        // Respond to greetings (case-insensitive)
        const messageBody = message.body ? message.body.toLowerCase() : '';
        if (messageBody === 'hello' || messageBody === 'हाय') {
            const greeting = `Hello! Welcome to our Cyber Cafe. We assist with government job applications and other services (except Aadhar updates, bank transfers, or bank KYC).\nनमस्ते! आमच्या सायबर कॅफेमध्ये स्वागत आहे. आम्ही सरकारी नोकरी अर्ज आणि इतर सेवा (आधार अपडेट, बँक हस्तांतरण किंवा बँक KYC वगळता) प्रदान करतो.`;
            await whatsapp.sendMessage(message.from, greeting);
            messageContext.delete(message.from); // Clear context
            if (reasonTimeouts.has(message.from)) {
                clearTimeout(reasonTimeouts.get(message.from));
                reasonTimeouts.delete(message.from);
            }
            return;
        }

        // Handle document uploads
        if (message.hasMedia) {
            await chat.sendStateTyping(); // Indicate typing state
            const media = await message.downloadMedia();
            if (!media || !SUPPORTED_DOCUMENT_TYPES.includes(media.mimetype)) {
                console.log('Unsupported media type:', media ? media.mimetype : 'No media');
                await whatsapp.sendMessage(message.from, 'असमर्थित दस्तऐवज स्वरूप. कृपया PDF, JPEG, PNG, किंवा Word दस्तऐवज पाठवा.\nUnsupported document format. Please send PDF, JPEG, PNG, or Word documents.');
                return;
            }

            // Check document size
            if (message._data.size > MAX_DOCUMENT_SIZE) {
                await whatsapp.sendMessage(message.from, 'दस्तऐवज खूप मोठा आहे. कृपया 10 MB पेक्षा लहान फाइल पाठवा.\nDocument too large. Please send a file smaller than 10 MB.');
                return;
            }

            // Check if max pending documents reached
            if (userContext.documents.length >= MAX_PENDING_DOCUMENTS) {
                await whatsapp.sendMessage(message.from, `कृपया एका वेळी ${MAX_PENDING_DOCUMENTS} पेक्षा जास्त दस्तऐवज पाठवू नका. प्रथम विद्यमान दस्तऐवजांसाठी कारण द्या.\nPlease do not send more than ${MAX_PENDING_DOCUMENTS} documents at a time. Provide a reason for existing documents first.`);
                return;
            }

            // Store document in queue
            userContext.documents.push({
                mimetype: media.mimetype,
                data: media.data,
                filename: message._data.filename || `document_${userContext.documents.length + 1}`,
            });
            messageContext.set(message.from, userContext);

            console.log('Document added to queue for', message.from, userContext);

            // Clear existing timeout and set new one
            if (reasonTimeouts.has(message.from)) {
                clearTimeout(reasonTimeouts.get(message.from));
            }
            reasonTimeouts.set(
                message.from,
                setTimeout(async () => {
                    if (messageContext.has(message.from) && userContext.documents.length > 0 && !userContext.awaitingReason) {
                        userContext.awaitingReason = true;
                        messageContext.set(message.from, userContext);
            
                        for (let i=0; i < userContext.documents.length; i++) {
                            await whatsapp.sendMessage(message.from, `"${i+1}" received.`);
                        }
                        // Get chat object for typing state
                        const chat = await whatsapp.getChatById(message.from);
                        await chat.sendStateTyping(); // Indicate typing state
                        
                        await whatsapp.sendMessage(
                            message.from,
                            `आपण ${userContext.documents.length} दस्तऐवज पाठवले आहेत. कृपया सर्व दस्तऐवजांसाठी एक कारण सांगा (उदा., "Government Job Application").\nYou have sent ${userContext.documents.length} document(s). Please provide a single reason for all documents (e.g., "Government Job Application").`
                        );
                        
                        await chat.clearState(); // Clear typing state
                    }
                }, REASON_TIMEOUT)
            );
            await chat.clearState(); // Clear typing state
        } else if (userContext.awaitingReason && message.body) {
            // Handle the reason for all documents in the queue
            const reason = message.body.trim();
            console.log('Processing reason:', reason, 'for user:', message.from);

            if (reason === '') {
                await whatsapp.sendMessage(message.from, 'कृपया वैध कारण सांगा (उदा., "Government Job Application").\nPlease provide a valid reason (e.g., "Government Job Application").');
                return;
            }

            // Clear timeout
            if (reasonTimeouts.has(message.from)) {
                clearTimeout(reasonTimeouts.get(message.from));
                reasonTimeouts.delete(message.from);
            }

            // Process all documents
            const documents = userContext.documents;
            if (documents.length === 0) {
                console.error('No documents found in context for reason:', reason);
                await whatsapp.sendMessage(message.from, 'त्रुटी: कोणतेही दस्तऐवज सापडले नाहीत. कृपया दस्तऐवज पुन्हा पाठवा.\nError: No documents found. Please send the documents again.');
                messageContext.delete(message.from);
                return;
            }

            await chat.sendStateTyping(); // Indicate typing state
            // Send caption message
            const fileList = documents.map(doc => doc.filename).join(', ');
            const caption = `Received ${documents.length} document(s) from ${message.from} for: ${reason}\nFiles: ${fileList}`;
            await whatsapp.sendMessage(OWNER_NUMBER, caption);

            // Forward each document
            let successCount = 0;
            let failedFiles = [];
            for (let i = 0; i < documents.length; i++) {
                const mediaData = documents[i];
                const fileExtension = mediaData.mimetype.split('/')[1] || 'file';
                const filename = `${reason}_${mediaData.filename}.${fileExtension}`;

                console.log(`Attempting to forward document ${i + 1}/${documents.length} to owner:`, {
                    owner: OWNER_NUMBER,
                    reason: reason,
                    filename: filename,
                    mimetype: mediaData.mimetype,
                    dataLength: mediaData.data.length
                });

                try {
                    const mediaMessage = new MessageMedia(mediaData.mimetype, mediaData.data, filename);
                    await whatsapp.sendMessage(OWNER_NUMBER, '', { media: mediaMessage });
                    console.log(`Document ${i + 1} successfully forwarded to owner: ${filename}`);
                    successCount++;
                } catch (forwardError) {
                    console.error(`Failed to forward document ${i + 1}: ${filename}`, forwardError);
                    failedFiles.push(filename);
                }

                // Add a small delay to avoid rate-limiting (optional, test if needed)
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Send confirmation to user
            let userMessage = `${successCount} दस्तऐवज "${reason}" साठी मालकाकडे पाठवले गेले आहेत. आम्ही लवकरच आपल्याशी संपर्क साधू!\n${successCount} document(s) forwarded to the owner for "${reason}". We'll get back to you soon!`;
            if (failedFiles.length > 0) {
                userMessage += `\nत्रुटी: खालील दस्तऐवज पाठवण्यात अयशस्वी: ${failedFiles.join(', ')}. कृपया पुन्हा प्रयत्न करा.\nError: Failed to forward the following documents: ${failedFiles.join(', ')}. Please try again.`;
            }
            await chat.clearState(); // Clear typing state
            await whatsapp.sendMessage(message.from, userMessage);

            // Clear context
            messageContext.delete(message.from);
            console.log('Context cleared for', message.from);
        }
    } catch (error) {
        console.error('Error handling message:', error);
        console.log('Full message object:', JSON.stringify(message, null, 2));
        console.log('Chat object:', JSON.stringify(chat || {}, null, 2));
        await whatsapp.sendMessage(message.from, 'क्षमस्व, त्रुटी आली. कृपया पुन्हा प्रयत्न करा किंवा समर्थनाशी संपर्क साधा.\nSorry, an error occurred. Please try again or contact support.');
        messageContext.delete(message.from);
        if (reasonTimeouts.has(message.from)) {
            clearTimeout(reasonTimeouts.get(message.from));
            reasonTimeouts.delete(message.from);
        }
    }
});

whatsapp.initialize().catch((error) => {
    console.error('Failed to initialize WhatsApp:', error);
});