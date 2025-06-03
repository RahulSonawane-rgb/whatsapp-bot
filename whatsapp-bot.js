const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrImage = require('qr-image');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const qrFilePath = path.join(__dirname, 'qr.png');

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Generate and save QR code as an image
client.on('qr', qr => {
    console.log('QR code string:', qr);
    console.log('QR code generated. Access it at http://<your-render-url>/qr');
    const qrPng = qrImage.image(qr, { type: 'png' });
    qrPng.pipe(fs.createWriteStream(qrFilePath));
});

// Serve QR code image
app.get('/qr', (req, res) => {
    if (fs.existsSync(qrFilePath)) {
        res.sendFile(qrFilePath);
    } else {
        res.status(404).send('QR code not generated yet. Please wait or redeploy.');
    }
});

// Serve a basic homepage
app.get('/', (req, res) => {
    res.send('WhatsApp bot is running. Access the QR code at /qr');
});

// WhatsApp client ready
client.on('ready', () => {
    console.log('WhatsApp bot is ready!');
    // Optionally delete QR code after successful authentication
    if (fs.existsSync(qrFilePath)) {
        fs.unlinkSync(qrFilePath);
    }
});

// Handle incoming messages
client.on('message', async message => {
    let chat;
    // Log message details
    chat = await message.getChat();

    // Ignore group messages
    if (chat.isGroup) {
        console.log(`Ignoring message from group chat: ${chat.id._serialized}`);
        return;
    }
        
    console.log(`Message received from ${message.from}: ${message.body}`);
    const text = message.body.toLowerCase();
    if (text === 'hi' || text === 'hello' || text === 'hay' || text === 'hey' || text === 'hii') {
        console.log('Sending reply to:', message.from);
        await message.reply('Hi there! How can I Help you');
    }
});

// Start Express server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Initialize WhatsApp client
client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down WhatsApp bot...');
    await client.destroy();
    process.exit(0);
});
