const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const yaml = require('yaml');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;
app.use(express.json());

// Create DB
const db = new sqlite3.Database('./users.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        apikey TEXT,
        emails_pulled INTEGER DEFAULT 0
    )`);
});

// Example users
// db.run("INSERT OR IGNORE INTO users (username, apikey) VALUES (?, ?)", ["ahmed", "my_secret_key"]);

// Middleware for API Key auth
function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key missing' });

    db.get("SELECT * FROM users WHERE apikey = ?", [apiKey], (err, user) => {
        if (err || !user) return res.status(403).json({ error: 'Invalid API Key' });
        req.user = user;
        next();
    });
}

// Config
function readConfig() {
    const file = fs.readFileSync(path.join(__dirname, 'config.yml'), 'utf8');
    return yaml.parse(file);
}
function writeConfig(newConfig) {
    const yamlStr = yaml.stringify(newConfig);
    fs.writeFileSync(path.join(__dirname, 'config.yml'), yamlStr);
}
app.get('/config', (req, res) => {
    res.json(readConfig());
});
app.post('/config', (req, res) => {
    try {
        const newConfig = req.body;
        writeConfig(newConfig)
        res.json({ success: true, message: "Config file successfully updated!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint to pull email
function randomText(randomized = false, length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        if (randomized && Math.floor(Math.random() * 3) != 0) {
            result += chars.charAt(Math.floor(Math.random() * chars.length)).toUpperCase();
        } else {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }
    return result;
}
async function generateEmail() {
    const email = randomText() + "@" + readConfig().EMAIL_DOMAIN;
    const password = randomText(randomized = true, length = 12);
    const url = "https://api.smtp.dev/accounts";
    const headers = {
        "X-API-KEY": readConfig().SMTP_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    };
    const data = {
        "address": email,
        "password": password
    };

    try {
        const response = await axios.post(url, data, { headers });

        if (response.status === 201) {
            return {
                email: email,
                password: password
            };
        } else {
            return await generateEmail();
        }
    } catch (err) {
        console.error('❌ Error creating email:', err.message);
        return null;
    }
}
app.post('/pull-email', authenticate, async (req, res) => {
    try {
        const emailData = await generateEmail();
        if (emailData) {
            db.run("UPDATE users SET emails_pulled = emails_pulled + 1 WHERE id = ?", [req.user.id], (err) => {
                if (err) return res.status(500).json({ error: 'Failed to update count' });

                res.json(emailData);
            });
        } else {
            res.status(500).json({ error: 'Failed to generate email or limit reached' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch email' });
    }
});

// Get user stats
app.get('/stats/:username', (req, res) => {
    const username = req.params.username;
    db.get("SELECT username, emails_pulled FROM users WHERE username = ?", [username], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'User not found' });

        res.json(row);
    });
});

// Get all users
app.get('/users', (req, res) => {
    db.all("SELECT id, username, apikey, emails_pulled FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch users' });
        res.json(rows);
    });
});

// Reset emails number
app.post('/users/:id/reset', (req, res) => {
    const userId = req.params.id;
    db.run("UPDATE users SET emails_pulled = 0 WHERE id = ?", [userId], function (err) {
        if (err) return res.status(500).json({ error: 'Failed to reset count' });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });

        res.json({ success: true });
    });
});

// Add new user
app.post('/users', (req, res) => {
    const { username, apikey } = req.body;
    if (!username || !apikey) return res.status(400).json({ error: 'Username and API Key are required' });

    db.run("INSERT INTO users (username, apikey) VALUES (?, ?)", [username, apikey], function (err) {
        if (err) return res.status(500).json({ error: 'Failed to add user' });
        res.json({ id: this.lastID, username, apikey, emails_pulled: 0 });
    });
});

// Delete user
app.delete('/users/:id', (req, res) => {
    const userId = req.params.id;
    db.run("DELETE FROM users WHERE id = ?", [userId], function (err) {
        if (err) return res.status(500).json({ error: 'Failed to delete user' });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });

        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
app.use(express.static('public'));