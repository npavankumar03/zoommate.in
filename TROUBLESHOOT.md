# Zoom Mate - Installation & Troubleshooting Guide

## Table of Contents
1. [System Requirements](#system-requirements)
2. [Pre-Installation Checklist](#pre-installation-checklist)
3. [Installation Issues](#installation-issues)
4. [Database Issues](#database-issues)
5. [Application Issues](#application-issues)
6. [Nginx & SSL Issues](#nginx--ssl-issues)
7. [Stripe Payment Issues](#stripe-payment-issues)
8. [AI Model Issues](#ai-model-issues)
9. [Performance Optimization](#performance-optimization)
10. [Backup & Recovery](#backup--recovery)
11. [Updating Zoom Mate](#updating-zoom-mate)
12. [Common Error Messages](#common-error-messages)
13. [Logs & Debugging](#logs--debugging)
14. [Security Hardening](#security-hardening)

---

## System Requirements

| Component       | Minimum         | Recommended      |
|-----------------|-----------------|------------------|
| OS              | Ubuntu 20.04    | Ubuntu 22.04+    |
| RAM             | 1 GB            | 2 GB+            |
| CPU             | 1 vCPU          | 2 vCPUs          |
| Disk            | 10 GB           | 20 GB+           |
| Node.js         | 18.x            | 20.x             |
| PostgreSQL      | 14              | 16               |

### Required Ports
- **80** - HTTP (Nginx)
- **443** - HTTPS (Nginx + SSL)
- **5000** - Application (internal, proxied by Nginx)
- **5432** - PostgreSQL (localhost only)

---

## Pre-Installation Checklist

Before running `install.sh`, ensure:

- [ ] You are running Ubuntu 20.04, 22.04, or 24.04
- [ ] You have root/sudo access
- [ ] Your server has internet access
- [ ] Port 80 and 443 are open on your firewall/cloud provider
- [ ] You have a domain name pointed to your server IP (optional but recommended)
- [ ] You have your API keys ready (OpenAI, Stripe - optional)

### Check Ubuntu Version
```bash
lsb_release -a
```

### Check Available Disk Space
```bash
df -h /
```

### Check Available RAM
```bash
free -m
```

---

## Installation Issues

### Error: "This script must be run as root"
**Solution:** Run the script with sudo:
```bash
sudo ./install.sh
```

### Error: "Permission denied" when running install.sh
**Solution:** Make the script executable:
```bash
chmod +x install.sh
sudo ./install.sh
```

### Error: "No application files found"
**Cause:** You are not running the script from the project root directory.
**Solution:**
```bash
cd /path/to/zoommate-project
sudo ./install.sh
```

### Node.js Installation Fails
**Manual fix:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # Should show v20.x.x
```

### PostgreSQL Installation Fails
**Manual fix:**
```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update
sudo apt-get install -y postgresql-16
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### npm install Fails with "EACCES" Permission Error
**Solution:**
```bash
sudo chown -R zoommate:zoommate /opt/zoommate
cd /opt/zoommate
sudo -u zoommate npm install
```

### Build Fails: `tsx: not found`
**Cause:** Dev dependencies were skipped, usually because `NODE_ENV=production` was set before `npm install`.

**Solution:**
```bash
cd /opt/zoommate
sudo -u zoommate env -u NODE_ENV npm install --include=dev
sudo -u zoommate npx tsx --version
sudo -u zoommate env -u NODE_ENV npm run build
```

**Do not** build this repo with production-only dependencies. `tsx` is required for `npm run build`.

### Build Fails: `Failed to resolve entry for package "framer-motion"`
**Cause:** The install on the server is inconsistent or partially reused. This is usually fixed by a clean lockfile-based reinstall.

**Solution:**
```bash
cd /opt/zoommate
rm -rf node_modules
unset NODE_ENV
npm ci --include=dev
npx tsx --version
npm run build
```

If `package-lock.json` is missing, use:
```bash
npm install --include=dev
```

### Build Fails: "Out of memory"
**Cause:** Not enough RAM for the build process.
**Solution:** Add swap space:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Retry the build
cd /opt/zoommate
sudo -u zoommate npm run build
```

---

## Database Issues

### Cannot Connect to Database
**Check PostgreSQL status:**
```bash
sudo systemctl status postgresql
```

**Check if database exists:**
```bash
sudo -u postgres psql -l | grep zoommate
```

**Check connection:**
```bash
sudo -u postgres psql -d zoommate_db -c "SELECT 1;"
```

### Error: "FATAL: password authentication failed"
**Reset the database password:**
```bash
sudo -u postgres psql -c "ALTER ROLE zoommate_user WITH PASSWORD 'new_password_here';"
```
Then update `DATABASE_URL` in `/opt/zoommate/.env`.

### Error: "relation does not exist"
**Cause:** Database schema not applied.
**Solution:**
```bash
cd /opt/zoommate
sudo -u zoommate bash -c "source .env && npx drizzle-kit push --force"
```

### Database Schema Push Hangs / Requires Input
**Solution:** Use the `--force` flag:
```bash
cd /opt/zoommate
sudo -u zoommate npx drizzle-kit push --force
```

### Manual Database Schema Creation
If drizzle-kit fails, apply the schema manually:
```bash
sudo -u postgres psql -d zoommate_db << 'SQL'
CREATE TABLE IF NOT EXISTS users (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE,
    password text NOT NULL,
    email text,
    role text NOT NULL DEFAULT 'user',
    minutes_used integer NOT NULL DEFAULT 0,
    minutes_purchased integer NOT NULL DEFAULT 0,
    referral_credits integer NOT NULL DEFAULT 0,
    stripe_customer_id text,
    stripe_subscription_id text,
    plan text NOT NULL DEFAULT 'free',
    status text NOT NULL DEFAULT 'active',
    last_login_at timestamp,
    created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id varchar NOT NULL,
    name text NOT NULL,
    content text NOT NULL,
    type text NOT NULL DEFAULT 'general',
    created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meetings (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id varchar NOT NULL,
    title text NOT NULL,
    type text NOT NULL DEFAULT 'interview',
    response_format text NOT NULL DEFAULT 'concise',
    custom_instructions text,
    document_ids text[] DEFAULT '{}',
    model text NOT NULL DEFAULT 'gpt-4o',
    status text NOT NULL DEFAULT 'setup',
    total_minutes integer NOT NULL DEFAULT 0,
    conversation_context text NOT NULL DEFAULT '',
    created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS responses (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id varchar NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    response_type text NOT NULL DEFAULT 'auto',
    created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_logs (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id varchar NOT NULL,
    admin_id varchar NOT NULL,
    type text NOT NULL,
    amount integer NOT NULL,
    reason text,
    created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    message text NOT NULL,
    type text NOT NULL DEFAULT 'info',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL
);
SQL
```

### Backup Database
```bash
sudo -u postgres pg_dump zoommate_db > ~/zoommate_backup_$(date +%Y%m%d).sql
```

### Restore Database
```bash
sudo -u postgres psql zoommate_db < ~/zoommate_backup_20250101.sql
```

---

## Application Issues

### Service Won't Start
**Check service status and logs:**
```bash
sudo systemctl status zoommate
sudo journalctl -u zoommate -n 50 --no-pager
```

### Error: "SESSION_SECRET environment variable must be set"
**Solution:** Ensure the .env file is properly configured:
```bash
cat /opt/zoommate/.env | grep SESSION_SECRET
```
If missing, generate one:
```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> /opt/zoommate/.env
sudo systemctl restart zoommate
```

### Error: "EADDRINUSE: port 5000 already in use"
**Find and kill the process using port 5000:**
```bash
sudo lsof -i :5000
sudo kill -9 <PID>
sudo systemctl restart zoommate
```

### Application Crashes Repeatedly
**Check logs for the root cause:**
```bash
sudo journalctl -u zoommate -n 100 --no-pager
```

**Common causes:**
1. Missing environment variables - check `.env` file
2. Database connection issues - verify DATABASE_URL
3. Out of memory - check with `free -m`

### Login Works But Authenticated Pages Show "Session Expired"
**Cause:** Session cookies are not persisting correctly, often due to reverse proxy configuration.

**Solution 1 - Check Nginx proxy headers:**
Ensure your Nginx config includes these headers:
```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;
```

**Solution 2 - If running behind a load balancer without HTTPS termination:**
Add `COOKIE_SECURE=false` to your `.env` file:
```bash
echo "COOKIE_SECURE=false" >> /opt/zoommate/.env
sudo systemctl restart zoommate
```

**Solution 3 - Verify session table exists:**
```bash
sudo -u postgres psql -d zoommate_db -c "\dt session"
```
If the table doesn't exist, restart the application (it auto-creates on start):
```bash
sudo systemctl restart zoommate
```

### 401 Errors After Login Behind Reverse Proxy
**Cause:** When deployed behind Nginx or a load balancer, the app needs to trust the proxy to correctly identify the protocol (HTTP vs HTTPS). The application now has `trust proxy` enabled by default.

If you're still experiencing issues:
1. Confirm Nginx sends `X-Forwarded-Proto` header
2. If using HTTP only (no SSL), set `COOKIE_SECURE=false` in `.env`
3. Check browser cookies - ensure the session cookie is being set

### Reset Admin Password
```bash
# Generate a new bcrypt hash
NEW_HASH=$(node -e "const bcrypt=require('bcrypt'); bcrypt.hash('newpassword123', 10).then(h=>console.log(h))")

# Update in database
sudo -u postgres psql -d zoommate_db -c "UPDATE users SET password='$NEW_HASH' WHERE username='admin';"

echo "Admin password reset to: newpassword123"
```

### Error: `DATABASE_URL must be set`
**Cause:** The service started without exporting `.env` into the runtime shell.

**Check the configured file:**
```bash
sudo cat /opt/zoommate/.env | grep DATABASE_URL
```

**Check the systemd service:**
```bash
sudo systemctl cat zoommate
```

**Restart after reloading `.env`:**
```bash
sudo systemctl daemon-reload
sudo systemctl restart zoommate
sudo journalctl -u zoommate -n 50 --no-pager
```

The current installer creates `/opt/zoommate/bin/zoommate-env.sh` and starts the service through a shell that explicitly sources `/opt/zoommate/.env` before running `node dist/index.cjs`.

### Create a New Admin User
```bash
cd /opt/zoommate
NEW_PASS="your_secure_password"
HASH=$(node -e "const bcrypt=require('bcrypt'); bcrypt.hash('$NEW_PASS', 10).then(h=>console.log(h))")

sudo -u postgres psql -d zoommate_db -c "
INSERT INTO users (id, username, password, email, role, plan, status)
VALUES (gen_random_uuid(), 'newadmin', '$HASH', 'admin@example.com', 'admin', 'enterprise', 'active');"

echo "New admin created - username: newadmin, password: $NEW_PASS"
```

---

## Nginx & SSL Issues

### Nginx Fails to Start
**Check configuration syntax:**
```bash
sudo nginx -t
```

**Check error log:**
```bash
sudo tail -20 /var/log/nginx/error.log
```

### Error: "502 Bad Gateway"
**Cause:** The application is not running.
**Solution:**
```bash
sudo systemctl status zoommate
sudo systemctl restart zoommate
# Wait 5 seconds
curl http://localhost:5000
```

### SSL Certificate Issues
**Renew certificate manually:**
```bash
sudo certbot renew --dry-run  # Test first
sudo certbot renew            # Actually renew
```

**Install SSL certificate for the first time:**
```bash
sudo certbot --nginx -d yourdomain.com
```

### Error: "Too many redirects"
**Check Nginx config for redirect loops:**
```bash
sudo nano /etc/nginx/sites-available/zoommate
```
Ensure you don't have conflicting redirect rules.

### WebSocket / SSE Not Working
**Ensure Nginx config includes these headers:**
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection 'upgrade';
proxy_buffering off;
proxy_cache off;
```

---

## Stripe Payment Issues

### Stripe Not Configured
**Add Stripe keys to environment:**
```bash
sudo nano /opt/zoommate/.env
# Add:
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_PUBLISHABLE_KEY=pk_live_...
sudo systemctl restart zoommate
```

### Webhook Errors
**Ensure your domain is accessible and configure the webhook URL in Stripe Dashboard:**
1. Go to https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://yourdomain.com/api/stripe/webhook`
3. Select events: `checkout.session.completed`, `customer.subscription.*`

### Test vs Live Mode
- Test keys start with `sk_test_` and `pk_test_`
- Live keys start with `sk_live_` and `pk_live_`
- Use test keys for development, live keys for production

---

## AI Model Issues

### OpenAI API Key Not Working
**Verify your key:**
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Common issues:**
1. Key has expired or been revoked
2. Insufficient credits in your OpenAI account
3. Key doesn't have access to the required model

### Gemini API Key Not Working
**Verify your key:**
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_API_KEY"
```

### Responses are Slow
1. Use faster models (gpt-4o-mini, gemini-2.0-flash)
2. Set the default model to a faster option in Admin > Settings
3. Use "concise" or "short" response format

### API Rate Limits
- OpenAI has rate limits based on your tier
- Gemini has different rate limits
- Set up a queue for managing multiple simultaneous requests in production

---

## Performance Optimization

### Add Swap Space (for low-memory servers)
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Optimize PostgreSQL
Edit `/etc/postgresql/16/main/postgresql.conf`:
```
shared_buffers = 256MB
effective_cache_size = 768MB
maintenance_work_mem = 64MB
work_mem = 4MB
max_connections = 100
```

Then restart:
```bash
sudo systemctl restart postgresql
```

### Enable Gzip Compression in Nginx
Add to your Nginx server block:
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml;
gzip_min_length 256;
```

### Monitor System Resources
```bash
# Real-time monitoring
htop

# Disk usage
df -h

# Memory usage
free -m

# Check application memory
ps aux | grep node
```

---

## Backup & Recovery

### Automated Daily Backups
Create a backup script:
```bash
sudo nano /opt/zoommate/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/opt/zoommate/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
sudo -u postgres pg_dump zoommate_db > "$BACKUP_DIR/db_$TIMESTAMP.sql"
cp /opt/zoommate/.env "$BACKUP_DIR/env_$TIMESTAMP.bak"
find "$BACKUP_DIR" -name "*.sql" -mtime +30 -delete
echo "Backup completed: $TIMESTAMP"
```

```bash
chmod +x /opt/zoommate/backup.sh
```

Add to crontab for daily backups at 2 AM:
```bash
sudo crontab -e
# Add: 0 2 * * * /opt/zoommate/backup.sh
```

### Restore from Backup
```bash
sudo systemctl stop zoommate
sudo -u postgres psql -d zoommate_db < /opt/zoommate/backups/db_20250101_020000.sql
sudo systemctl start zoommate
```

---

## Updating Zoom Mate

### Standard Update Process
```bash
cd /path/to/new-zoommate-source

# Stop the service
sudo systemctl stop zoommate

# Backup current version
sudo cp -r /opt/zoommate /opt/zoommate.backup

# Copy new files (preserve .env and node_modules)
sudo rsync -a --exclude='node_modules' --exclude='.env' --exclude='.git' . /opt/zoommate/

# Install dependencies and rebuild
cd /opt/zoommate
sudo -u zoommate npm install
sudo -u zoommate npm run build

# Apply database changes
sudo -u zoommate npx drizzle-kit push --force

# Restart
sudo systemctl start zoommate
```

### Rollback an Update
```bash
sudo systemctl stop zoommate
sudo rm -rf /opt/zoommate
sudo mv /opt/zoommate.backup /opt/zoommate
sudo systemctl start zoommate
```

---

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL not running | `sudo systemctl start postgresql` |
| `EADDRINUSE :::5000` | Port 5000 in use | Kill other process or change PORT in .env |
| `Cannot find module` | Dependencies not installed | `cd /opt/zoommate && npm install` |
| `ENOMEM` | Out of memory | Add swap space (see above) |
| `EPERM: operation not permitted` | Permission issue | `sudo chown -R zoommate:zoommate /opt/zoommate` |
| `SSL_ERROR_RX_RECORD_TOO_LONG` | SSL misconfigured | Check Nginx SSL config or renew cert |
| `Error: connect ETIMEDOUT` | AI API unreachable | Check internet connection and API key |
| `Unauthorized` | Session expired | Clear cookies and log in again |
| `403 Admin access required` | Not admin user | Set role to admin in database |

---

## Logs & Debugging

### View Application Logs
```bash
# Live logs
sudo journalctl -u zoommate -f

# Last 100 lines
sudo journalctl -u zoommate -n 100 --no-pager

# Logs from today
sudo journalctl -u zoommate --since today

# Logs from last hour
sudo journalctl -u zoommate --since "1 hour ago"
```

### View Nginx Logs
```bash
# Access log
sudo tail -f /var/log/nginx/access.log

# Error log
sudo tail -f /var/log/nginx/error.log
```

### View PostgreSQL Logs
```bash
sudo tail -f /var/log/postgresql/postgresql-16-main.log
```

### Debug Mode
To run the application in debug mode temporarily:
```bash
sudo systemctl stop zoommate
cd /opt/zoommate
sudo -u zoommate bash -c "source .env && NODE_ENV=development node dist/index.js"
# Press Ctrl+C to stop, then restart the service
sudo systemctl start zoommate
```

### Check System Health
```bash
# System overview
sudo systemctl status zoommate postgresql nginx

# Check all ports
sudo ss -tlnp | grep -E '(5000|80|443|5432)'

# Check disk space
df -h

# Check memory
free -m

# Check CPU usage
top -bn1 | head -5
```

---

## Security Hardening

### Change Default Admin Password
Log in to the admin panel immediately after installation and change the default password.

### Secure the .env File
```bash
sudo chmod 600 /opt/zoommate/.env
sudo chown zoommate:zoommate /opt/zoommate/.env
```

### Enable Fail2ban
```bash
sudo apt-get install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### Automatic Security Updates
```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### Restrict SSH Access
```bash
# Use SSH keys instead of passwords
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd
```

---

## Getting Help

If you're still having issues:

1. Check the logs (see [Logs & Debugging](#logs--debugging))
2. Search for the error message in this guide
3. Verify all environment variables are set correctly
4. Ensure your server meets the minimum requirements
5. Try restarting all services:
   ```bash
   sudo systemctl restart postgresql nginx zoommate
   ```

### Quick Health Check Command
```bash
echo "=== Zoom Mate Health Check ==="
echo "PostgreSQL: $(systemctl is-active postgresql)"
echo "Nginx: $(systemctl is-active nginx)"
echo "Zoom Mate: $(systemctl is-active zoommate)"
echo "Port 5000: $(ss -tlnp | grep 5000 | wc -l) listener(s)"
echo "Port 80: $(ss -tlnp | grep :80 | wc -l) listener(s)"
echo "Disk: $(df -h / | tail -1 | awk '{print $5}') used"
echo "Memory: $(free -m | grep Mem | awk '{print $3}')MB / $(free -m | grep Mem | awk '{print $2}')MB"
```
