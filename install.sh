#!/bin/bash
set -euo pipefail

##############################################################################
# Zoom Mate - AI Interview Assistant
# Single-command installation script for Ubuntu 20.04/22.04/24.04
#
# Usage:
#   chmod +x install.sh
#   sudo ./install.sh
#
# This script will:
#   1. Install Node.js 20.x, PostgreSQL 16, Nginx, Certbot
#   2. Create a system user and application directory
#   3. Set up the PostgreSQL database
#   4. Configure environment variables
#   5. Build the application
#   6. Set up systemd service for auto-start
#   7. Configure Nginx reverse proxy with SSL (optional)
##############################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  log_error "This script must be run as root (use sudo ./install.sh)"
  exit 1
fi

APP_NAME="zoommate"
APP_DIR="/opt/zoommate"
APP_USER="zoommate"
APP_GROUP="zoommate"
APP_ENV_FILE="$APP_DIR/.env"
APP_ENV_LOADER="$APP_DIR/bin/zoommate-env.sh"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_NAME="zoommate_db"
DB_USER="zoommate_user"
DB_PASS=$(openssl rand -hex 16)
SESSION_SECRET=$(openssl rand -hex 32)
PORT=5000

echo ""
echo "=============================================="
echo "   Zoom Mate - AI Interview Assistant"
echo "   Installation Script v1.0"
echo "=============================================="
echo ""

read -p "Enter your domain name (or press Enter for IP-based access): " DOMAIN_RAW
read -p "Enter your OpenAI API key (or press Enter to skip): " OPENAI_KEY
read -p "Enter your Stripe Secret Key (or press Enter to skip): " STRIPE_SECRET
read -p "Enter your Stripe Publishable Key (or press Enter to skip): " STRIPE_PUBLISHABLE

DOMAIN=$(echo "$DOMAIN_RAW" | sed 's|https\?://||' | sed 's|/.*||' | sed 's|:.*||' | xargs)
if [ -n "$DOMAIN" ] && ! echo "$DOMAIN" | grep -qP '^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$'; then
  log_error "Invalid domain name: '$DOMAIN'"
  log_error "Please enter a valid domain like 'example.com' or 'app.example.com'"
  exit 1
fi

echo ""
log_info "Starting installation..."

##############################################################################
# 1. System packages
##############################################################################
log_info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

log_info "Installing essential packages..."
apt-get install -y -qq curl wget git rsync build-essential software-properties-common \
  apt-transport-https ca-certificates gnupg lsb-release ufw

##############################################################################
# 2. Node.js 20.x
##############################################################################
log_info "Installing Node.js 20.x..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
log_success "Node.js $(node -v) installed"
log_success "npm $(npm -v) installed"

##############################################################################
# 3. PostgreSQL 16
##############################################################################
log_info "Installing PostgreSQL 16..."
if ! command -v psql &> /dev/null; then
  sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
  wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
  apt-get update -qq
  apt-get install -y -qq postgresql-16
fi

systemctl enable postgresql
systemctl start postgresql
log_success "PostgreSQL installed and running"

##############################################################################
# 4. Create system user
##############################################################################
log_info "Creating application user..."
if ! id "$APP_USER" &>/dev/null; then
  useradd -r -m -s /bin/bash "$APP_USER"
  log_success "User '$APP_USER' created"
else
  log_warn "User '$APP_USER' already exists, skipping"
fi

##############################################################################
# 4.5 Reuse existing configuration on re-runs
##############################################################################
if [ -f "$APP_ENV_FILE" ]; then
  log_info "Existing environment found at $APP_ENV_FILE, reusing persisted secrets/config when possible..."
  # shellcheck disable=SC1090
  set -a
  source "$APP_ENV_FILE"
  set +a
  DB_PASS="${DATABASE_URL#*://}"
  DB_PASS="${DB_PASS#*:}"
  DB_PASS="${DB_PASS%@*}"
  DB_NAME="${DATABASE_URL##*/}"
  DB_USER="${DATABASE_URL#*://}"
  DB_USER="${DB_USER%%:*}"
  SESSION_SECRET="${SESSION_SECRET:-$SESSION_SECRET}"
  OPENAI_KEY="${OPENAI_KEY:-${OPENAI_API_KEY:-}}"
  STRIPE_SECRET="${STRIPE_SECRET:-${STRIPE_SECRET_KEY:-}}"
  STRIPE_PUBLISHABLE="${STRIPE_PUBLISHABLE:-${STRIPE_PUBLISHABLE_KEY:-}}"
  PORT="${PORT:-5000}"
  log_success "Reused existing application secrets and settings"
fi

##############################################################################
# 5. Set up PostgreSQL database
##############################################################################
log_info "Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;"
log_success "Database '$DB_NAME' configured"

DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"

##############################################################################
# 6. Set up application directory
##############################################################################
log_info "Setting up application directory..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/bin"

if [ -f "$SOURCE_DIR/package.json" ] && [ -d "$SOURCE_DIR/client" ] && [ -d "$SOURCE_DIR/server" ]; then
  log_info "Copying application files from $SOURCE_DIR..."
  rsync -a --exclude='node_modules' --exclude='.git' --exclude='.env' "$SOURCE_DIR/" "$APP_DIR/"
else
  log_error "No application files found. Please run this script from the project root directory."
  log_error "Example: cd /path/to/zoommate && sudo ./install.sh"
  exit 1
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
log_success "Application files installed to $APP_DIR"

##############################################################################
# 7. Create environment file
##############################################################################
log_info "Creating environment configuration..."

write_env_var() {
  local key="$1"
  local value="$2"
  local escaped_value
  escaped_value=$(printf '%s' "$value" | sed 's/["\$`\\]/\\&/g')
  if echo "$escaped_value" | grep -q '[[:space:]#=]'; then
    echo "${key}=\"${escaped_value}\"" >> "$APP_DIR/.env"
  else
    echo "${key}=${escaped_value}" >> "$APP_DIR/.env"
  fi
}

: > "$APP_ENV_FILE"
echo "# Zoom Mate Environment Configuration" >> "$APP_ENV_FILE"
echo "# Generated on $(date)" >> "$APP_ENV_FILE"
echo "" >> "$APP_ENV_FILE"
write_env_var "NODE_ENV" "production"
write_env_var "PORT" "$PORT"
write_env_var "DATABASE_URL" "$DATABASE_URL"
write_env_var "SESSION_SECRET" "$SESSION_SECRET"
echo "" >> "$APP_ENV_FILE"
echo "# AI API Keys" >> "$APP_ENV_FILE"
[ -n "$OPENAI_KEY" ] && write_env_var "OPENAI_API_KEY" "$OPENAI_KEY"
echo "" >> "$APP_ENV_FILE"
echo "# Stripe Configuration (optional)" >> "$APP_ENV_FILE"
[ -n "$STRIPE_SECRET" ] && write_env_var "STRIPE_SECRET_KEY" "$STRIPE_SECRET"
[ -n "$STRIPE_PUBLISHABLE" ] && write_env_var "STRIPE_PUBLISHABLE_KEY" "$STRIPE_PUBLISHABLE"
echo "" >> "$APP_ENV_FILE"
write_env_var "APP_DOMAIN" "${DOMAIN:-localhost}"

cat > "$APP_ENV_LOADER" << 'EOF'
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi
exec "$@"
EOF

chmod 600 "$APP_ENV_FILE"
chmod 755 "$APP_ENV_LOADER"
chown "$APP_USER:$APP_GROUP" "$APP_ENV_FILE" "$APP_ENV_LOADER"
log_success "Environment file created at $APP_ENV_FILE"
log_success "Environment loader created at $APP_ENV_LOADER"

##############################################################################
# 8. Install dependencies and build
##############################################################################
log_info "Installing Node.js dependencies..."
cd "$APP_DIR"
rm -rf "$APP_DIR/node_modules"
if [ -f "$APP_DIR/package-lock.json" ]; then
  sudo -u "$APP_USER" env -u NODE_ENV npm ci --include=dev
else
  sudo -u "$APP_USER" env -u NODE_ENV npm install --include=dev
fi
sudo -u "$APP_USER" npx tsx --version >/dev/null
log_success "Dependencies installed"

log_info "Building application..."
sudo -u "$APP_USER" env -u NODE_ENV "$APP_ENV_LOADER" npm run build
[ -f "$APP_DIR/dist/index.cjs" ] || { log_error "Build finished without dist/index.cjs"; exit 1; }
log_success "Application built successfully"

log_info "Pushing database schema..."
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && set -a && source '$APP_ENV_FILE' && set +a && npx drizzle-kit push --force"
log_success "Database schema applied"

##############################################################################
# 9. Create systemd service
##############################################################################
log_info "Creating systemd service..."
cat > /etc/systemd/system/zoommate.service << EOF
[Unit]
Description=Zoom Mate - AI Interview Assistant
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash -lc 'cd "$APP_DIR" && set -a && source "$APP_ENV_FILE" && set +a && exec /usr/bin/node dist/index.cjs'
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zoommate

# Security hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=$APP_DIR

# Resource limits
LimitNOFILE=65535
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable zoommate
systemctl start zoommate
log_success "Systemd service created and started"

log_info "Waiting for service health..."
sleep 5
if ! systemctl is-active --quiet zoommate; then
  log_error "zoommate service failed to become healthy"
  journalctl -u zoommate -n 50 --no-pager || true
  exit 1
fi
if ! curl -fsS "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
  log_warn "Service is running but HTTP health probe on port $PORT did not return 200 yet"
else
  log_success "Application is responding on port $PORT"
fi

##############################################################################
# 10. Nginx reverse proxy
##############################################################################
log_info "Installing Nginx..."
apt-get install -y -qq nginx
systemctl enable nginx

if [ -n "$DOMAIN" ]; then
  log_info "Configuring Nginx for domain: $DOMAIN"
  cat > /etc/nginx/sites-available/zoommate << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
    }

    client_max_body_size 50M;
}
EOF

  ln -sf /etc/nginx/sites-available/zoommate /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default

  nginx -t && systemctl reload nginx
  log_success "Nginx configured for $DOMAIN"

  # SSL with Certbot
  log_info "Installing Certbot for SSL..."
  apt-get install -y -qq certbot python3-certbot-nginx

  read -p "Set up SSL certificate now? (y/n): " SETUP_SSL
  if [ "$SETUP_SSL" = "y" ] || [ "$SETUP_SSL" = "Y" ]; then
    read -p "Enter email for SSL certificate notifications: " SSL_EMAIL
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$SSL_EMAIL" --redirect
    log_success "SSL certificate installed"
    systemctl enable certbot.timer
    log_success "Auto-renewal enabled"
  else
    log_warn "SSL skipped. Run 'sudo certbot --nginx -d $DOMAIN' later to enable HTTPS"
  fi
else
  log_info "Configuring Nginx for IP-based access..."
  cat > /etc/nginx/sites-available/zoommate << EOF
server {
    listen 80 default_server;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
    }

    client_max_body_size 50M;
}
EOF

  ln -sf /etc/nginx/sites-available/zoommate /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  log_success "Nginx configured for IP-based access"
fi

##############################################################################
# 11. Firewall configuration
##############################################################################
log_info "Configuring firewall..."
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable
log_success "Firewall configured (SSH + HTTP/HTTPS)"

##############################################################################
# 12. Create admin user
##############################################################################
log_info "Creating default admin user..."
ADMIN_PASS=$(openssl rand -hex 8)
ADMIN_HASH=$(node -e "const bcrypt=require('bcrypt'); bcrypt.hash('$ADMIN_PASS', 10).then(h=>console.log(h))")

sudo -u postgres psql -d "$DB_NAME" -c "
INSERT INTO users (id, username, password, email, role, plan, status)
VALUES (gen_random_uuid(), 'admin', '$ADMIN_HASH', 'admin@zoommate.app', 'admin', 'enterprise', 'active')
ON CONFLICT (username) DO NOTHING;
" 2>/dev/null || true

##############################################################################
# Summary
##############################################################################
echo ""
echo "=============================================="
echo "   Installation Complete!"
echo "=============================================="
echo ""
log_success "Zoom Mate has been installed successfully!"
echo ""
echo "  Application URL:  ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$(hostname -I | awk '{print $1}')}"
echo "  App Directory:    $APP_DIR"
echo "  Config File:      $APP_ENV_FILE"
echo "  Env Loader:       $APP_ENV_LOADER"
echo "  Service Name:     zoommate"
echo ""
echo "  Default Admin Account:"
echo "    Username: admin"
echo "    Password: $ADMIN_PASS"
echo "    (Change this immediately after first login!)"
echo ""
echo "  Database:"
echo "    Name: $DB_NAME"
echo "    User: $DB_USER"
echo "    Pass: $DB_PASS"
echo ""
echo "  Useful Commands:"
echo "    sudo systemctl status zoommate     - Check service status"
echo "    sudo systemctl restart zoommate    - Restart the app"
echo "    sudo systemctl stop zoommate       - Stop the app"
echo "    sudo journalctl -u zoommate -f     - View live logs"
echo "    sudo nano $APP_ENV_FILE            - Edit configuration"
echo ""
echo "  After editing .env, restart with:"
echo "    sudo systemctl restart zoommate"
echo ""

if [ -z "$OPENAI_KEY" ]; then
  log_warn "No OpenAI API key was provided. Add it to $APP_DIR/.env or via the admin panel."
fi
if [ -z "$STRIPE_SECRET" ]; then
  log_warn "No Stripe keys were provided. Payment features will be disabled."
fi

echo ""
log_info "For troubleshooting, see TROUBLESHOOT.md in the project directory."
echo ""
