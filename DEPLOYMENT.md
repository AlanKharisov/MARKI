# Deployment

This project has one Rust backend and multiple frontend apps:

- `api/`: Rust/Axum backend.
- `identity/`: main React app, built with CRA/react-app-rewired and deployable to GitHub Pages.
- `admin/`: Vite admin frontend.
- `admin-company/`: Vite company admin frontend. This directory is currently recorded by the parent repository as a gitlink/submodule-like entry, but `.gitmodules` is missing. Do not change or repair that structure during deployment prep unless it is handled as a separate Git task.

Never copy SSH keys, Firebase service account JSON files, `.env` files, or production secrets into Git. The root `.gitignore` is expected to block real env files, private-key-like files, and service account JSON filenames.

## Local Development

Backend:

```bash
cp api/.env.example api/.env
# Edit api/.env locally with real values.
cargo run -p idenity-api
```

The local backend should be reachable at:

```bash
curl http://localhost:8090/health
```

Main frontend:

```bash
cd identity
cp .env.example .env.local
npm install
npm start
```

`identity/.env.local` should use:

```bash
REACT_APP_API_URL=http://localhost:8090
```

Admin frontend:

```bash
cd admin
cp .env.example .env.local
npm install
npm run dev
```

Company admin frontend:

```bash
cd admin-company
cp .env.example .env.local
npm install
npm run dev
```

The `admin-company/` path is currently documented as deployment prep only. The parent repository shows it as a gitlink/submodule-like entry without a matching `.gitmodules` file; leave that unresolved until a separate Git cleanup task is approved.

## Backend AWS Deployment

Prerequisites:

- AWS server public IP or DNS name.
- SSH username, for example `ubuntu` or `ec2-user`.
- External SSH private key path on your PC, for example `/path/outside/project/my-aws-key.pem`.
- Production backend domain, for example `idenity.onrender.com`.

Use the SSH key only from its external path:

```bash
ssh -i /path/outside/project/my-aws-key.pem ubuntu@SERVER_IP
```

Do not move or copy the key into this repository.

If the key has an unusual extension such as `.ssh`, check it safely from outside the project:

```bash
ls -l /path/outside/project/my-aws-key.ssh
file /path/outside/project/my-aws-key.ssh
ssh-keygen -y -f /path/outside/project/my-aws-key.ssh >/dev/null
chmod 600 /path/outside/project/my-aws-key.ssh
```

The extension is not important. The file must be a valid private key and readable only by your user.

Server setup outline:

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev nginx certbot python3-certbot-nginx
```

Install Rust on the server if building there:

```bash
curl https://sh.rustup.rs -sSf | sh
. "$HOME/.cargo/env"
```

Build the backend:

```bash
cargo build --release -p idenity-api
```

Place the binary in a stable server path, for example:

```bash
sudo mkdir -p /opt/idenity-api
sudo cp target/release/idenity-api /opt/idenity-api/idenity-api
```

Store production env values in a server-only file:

```bash
sudo install -m 600 -o root -g root /dev/null /etc/idenity-api.env
sudo nano /etc/idenity-api.env
```

## Production Environment Variables

Template for `/etc/idenity-api.env`:

```bash
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_API_KEY=your-firebase-web-api-key
FIREBASE_STORAGE_BUCKET=your-firebase-storage-bucket
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"your-firebase-project-id","private_key_id":"replace-me","private_key":"replace-with-server-private-key-only","client_email":"firebase-adminsdk@example.iam.gserviceaccount.com","client_id":"replace-me","token_uri":"https://oauth2.googleapis.com/token"}'
SOLANA_RPC_URL=https://api.devnet.solana.com
PORT=8090
ALLOWED_ORIGIN=https://alankharisov.github.io
ADMIN_UIDS=uid1,uid2
```

`FIREBASE_SERVICE_ACCOUNT_JSON` is a server secret. Keep it out of Git, frontend code, GitHub Pages, and deployment logs.

## systemd Service Template

Create `/etc/systemd/system/idenity-api.service`:

```ini
[Unit]
Description=Idenity API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/idenity-api
ExecStart=/opt/idenity-api/idenity-api
EnvironmentFile=/etc/idenity-api.env
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable idenity-api
sudo systemctl start idenity-api
sudo systemctl status idenity-api
```

Check logs:

```bash
sudo journalctl -u idenity-api -f
```

## Nginx Reverse Proxy Template

Create `/etc/nginx/sites-available/idenity-api`:

```nginx
server {
    listen 80;
    server_name idenity.onrender.com;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/idenity-api /etc/nginx/sites-enabled/idenity-api
sudo nginx -t
sudo systemctl reload nginx
```

Add HTTPS:

```bash
sudo certbot --nginx -d idenity.onrender.com
```

## GitHub Pages Deployment

Main frontend path:

```bash
cd identity
```

Local production env template:

```bash
cp .env.example .env.production
```

Set production API URL:

```bash
REACT_APP_API_URL=https://idenity.onrender.com
```

For `admin/` and `admin-company/`, use the matching Vite variable names if those apps are deployed later:

```bash
VITE_API_URL=https://idenity.onrender.com
VITE_API_BASE_URL=https://idenity.onrender.com
VITE_SOLANA_RPC=https://api.devnet.solana.com
```

Build:

```bash
npm install
npm run build
```

Deploy only after approval:

```bash
npm run deploy
```

This uses `gh-pages -d build` from `identity/package.json` and publishes to the repository `gh-pages` branch.

Firebase Auth must allow the GitHub Pages domain:

```text
alankharisov.github.io
```

If the app is served under the repository path, verify:

```text
https://alankharisov.github.io/idenity
```

## Verification Checklist

Before committing:

- `git status --short --branch`
- Confirm no `.env`, `.env.local`, `.env.development`, `.env.production`, `.pem`, `.ssh`, or service account JSON files are staged.
- Confirm deployment docs and `.env.example` files contain placeholders only.

Backend:

- `cargo build --release -p idenity-api`
- `curl http://127.0.0.1:8090/health` works on the server.
- `curl https://idenity.onrender.com/health` works externally.
- `sudo systemctl status idenity-api` is healthy.
- `sudo journalctl -u idenity-api -n 100` has no missing env errors.
- Authenticated Firebase endpoints work with a real token.
- Upload/storage endpoints work.
- Solana RPC calls work without rate-limit failures.

Frontend:

- `cd identity && npm run build`
- Production bundle calls `https://idenity.onrender.com`, not `localhost:8090`.
- GitHub Pages loads the app.
- Refreshing nested routes works.
- Firebase login works after authorized-domain setup.
- Browser console has no CORS errors.
- QR/NFT links resolve under the expected GitHub Pages URL.

Do not push, deploy, or connect to AWS until deployment is explicitly approved.
