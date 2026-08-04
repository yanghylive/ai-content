# WeChat Token Broker

This optional deployment keeps the WeChat AppSecret on a Linux server with a
fixed public egress IP. The broker binds only to `127.0.0.1:8765`, caches the
stable access token in memory, and exposes a token read through a restricted SSH
forced-command account.

## Security model

- The HTTP listener is reachable only from the server loopback interface.
- AppSecret and broker keys live only in root-managed server files.
- The SSH reader key cannot open a shell, allocate a TTY, run an arbitrary
  command, or forward ports.
- Responses are marked `no-store`; application logs never contain the token.
- The operator workstation stores only a dedicated SSH private key.
- The server's actual public egress IP must be present in the WeChat API
  allowlist.

This is an operational reference, not a hosted service. Review the commands for
the target Linux distribution and SSH policy before applying them.

## Requirements

- Linux with systemd and OpenSSH server
- Python 3.9+ and curl
- Root access for installation
- A dedicated SSH key pair generated for token reads
- WeChat AppID/AppSecret with the required API permission

The examples assume:

```text
/opt/wechat-token-broker/
/etc/wechat-token-broker.env
/etc/wechat-token-broker-reader.key
wechat-token-reader
```

## 1. Prepare the server files

From this `server/` directory:

```bash
sudo install -d -o root -g root -m 0755 /opt/wechat-token-broker
sudo install -o root -g root -m 0644 token_broker.py \
  /opt/wechat-token-broker/token_broker.py
sudo install -o root -g root -m 0755 wechat-token-read \
  /opt/wechat-token-broker/wechat-token-read
sudo install -o root -g root -m 0644 wechat-token-broker.service \
  /etc/systemd/system/wechat-token-broker.service
```

Create the restricted SSH user without a password:

```bash
sudo useradd --system --create-home --shell /bin/sh wechat-token-reader
sudo passwd --lock wechat-token-reader
sudo install -d -o wechat-token-reader -g wechat-token-reader -m 0700 \
  /home/wechat-token-reader/.ssh
```

If the user already exists, verify its home, shell, ownership, and locked
password rather than recreating it.

## 2. Install secrets

Generate one random broker key and place the same value in both root-managed
files:

```bash
umask 077
broker_key="$(openssl rand -hex 32)"

sudo install -o root -g root -m 0600 wechat-token-broker.env.example \
  /etc/wechat-token-broker.env
sudo sed -i "s/^WECHAT_TOKEN_BROKER_KEY=.*/WECHAT_TOKEN_BROKER_KEY=${broker_key}/" \
  /etc/wechat-token-broker.env

printf '%s\n' "$broker_key" |
  sudo tee /etc/wechat-token-broker-reader.key >/dev/null
sudo chown root:wechat-token-reader /etc/wechat-token-broker-reader.key
sudo chmod 0640 /etc/wechat-token-broker-reader.key
unset broker_key
```

Edit `/etc/wechat-token-broker.env` as root and set the real `WECHAT_APP_ID` and
`WECHAT_APP_SECRET`. Keep `WECHAT_API_BASE=https://api.weixin.qq.com` unless a
separately reviewed endpoint is required.

Do not paste secret values into shell history, tickets, logs, or Git.

## 3. Restrict the SSH key

Generate a dedicated key on the operator workstation:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/wechat-token-reader -C wechat-token-reader
```

On the server, add the resulting public key as one line in
`/home/wechat-token-reader/.ssh/authorized_keys`, prefixed exactly with:

```text
restrict,command="/opt/wechat-token-broker/wechat-token-read" ssh-ed25519 PUBLIC_KEY_MATERIAL wechat-token-reader
```

Then enforce ownership and permissions:

```bash
sudo chown wechat-token-reader:wechat-token-reader \
  /home/wechat-token-reader/.ssh/authorized_keys
sudo chmod 0600 /home/wechat-token-reader/.ssh/authorized_keys
```

`restrict` requires a current OpenSSH version. On older supported deployments,
replace it with all of:

```text
no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding
```

Keep the forced `command=...` option in either form.

## 4. Start and verify the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wechat-token-broker.service

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent http://127.0.0.1:8765/healthz >/dev/null; then
    break
  fi
  sleep 1
done

curl --fail --silent http://127.0.0.1:8765/healthz
sudo ss -ltnp | grep '127.0.0.1:8765'
sudo systemctl --no-pager --full status wechat-token-broker.service
```

The readiness loop is intentional: systemd may report the process active before
the Python listener accepts connections.

Verify the forced command from the operator workstation:

```bash
ssh -T \
  -i ~/.ssh/wechat-token-reader \
  -o BatchMode=yes \
  -o ClearAllForwardings=yes \
  wechat-token-reader@BROKER_HOST
```

Expected output is a small JSON object containing `access_token`,
`expires_in`, and `source`. Do not paste that output into logs or issues.

Also verify that arbitrary commands and forwarding are rejected:

```bash
ssh -T -i ~/.ssh/wechat-token-reader \
  wechat-token-reader@BROKER_HOST 'id'

ssh -N -L 9999:127.0.0.1:8765 \
  -i ~/.ssh/wechat-token-reader \
  wechat-token-reader@BROKER_HOST
```

## 5. Configure the client

In the operator's ignored `env/.env`:

```dotenv
WECHAT_TOKEN_BROKER_SSH_HOST=BROKER_HOST
WECHAT_TOKEN_BROKER_SSH_PORT=22
WECHAT_TOKEN_BROKER_SSH_USER=wechat-token-reader
WECHAT_TOKEN_BROKER_SSH_KEY=/absolute/path/to/.ssh/wechat-token-reader
WECHAT_TOKEN_BROKER_KNOWN_HOSTS=/absolute/path/to/known_hosts
```

Pin the host key in the dedicated `known_hosts` file before the first token
request. The client deliberately enables strict host-key checking.

## Rotation and recovery

- Rotate the SSH key by installing a new restricted public key, testing it, then
  removing the old line.
- Rotate `WECHAT_TOKEN_BROKER_KEY` in both server files, restart the service,
  and test the forced command.
- Rotate the WeChat AppSecret in `/etc/wechat-token-broker.env`, restart the
  service, and recheck the allowlist and token read.
- On suspected disclosure, disable the SSH key first, rotate every affected
  secret, and inspect SSH and systemd metadata without printing token values.

## Tests

The broker's local unit tests do not contact WeChat:

```bash
python3 test_token_broker.py
```
