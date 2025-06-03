const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const app = express();
const http = require('http');
const fs = require('fs');
const path = require('path');

const OWNER_NUMBER = '918080032223@c.us'; // Replace with actual owner's WhatsApp number
const SUPPORTED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PENDING_DOCUMENTS = 10; // Max 10 documents queued per user
const REASON_TIMEOUT = 10 * 1000; // 10 seconds timeout for reason prompt

const whatsapp = new Client({
    authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }), // For Render persistent disk
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-zygote',
            // Remove --single-process to avoid potential instability
            '--disable-features=TranslateUI',
            '--no-first-run',
            '--disable-extensions',
            '--disable-dbus',
        ],
        timeout: 60000, // 60 seconds for browser initialization
    }
});

whatsapp.on('qr', async (qr) => {
    console.log('QR code generated');
    const qrImage = await qrcode.toDataURL(qr);
    app.get('/', (req, res) => res.send(`<img src="${qrImage}" />`));
});

whatsapp.on('ready', async () => {
    console.log('WhatsApp bot is ready!');
    // Ensure page is fully loaded
    const page = await whatsapp.puppeteerPage;
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
        console.log('Page fully loaded');
    } catch (err) {
        console.error('Navigation wait failed:', err);
    }
});

whatsapp.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});

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

// Handle initialization with retry logic
whatsapp.initialize()
    .then(() => console.log('WhatsApp initialization started'))
    .catch((error) => {
        console.error('Failed to initialize WhatsApp:', error);
        setTimeout(() => {
            console.log('Retrying WhatsApp initialization...');
            whatsapp.initialize().catch((err) => console.error('Retry failed:', err));
        }, 5000); // Retry after 5 seconds
    });

app.listen(3000, '0.0.0.0', () => console.log('Server running on port 3000'));
