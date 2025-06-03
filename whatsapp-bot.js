const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', qr => {
    console.log('QR code received, scan it with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp bot is ready!');
});

client.on('message', async message => {
    const text = message.body.toLowerCase();
    console.log(text);
    if (text === 'hello') {
        await message.reply('Hi there! How can I assist you today?');
    }
});

client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
});

process.on('SIGINT', async () => {
    console.log('Shutting down WhatsApp bot...');
    await client.destroy();
    process.exit(0);
});