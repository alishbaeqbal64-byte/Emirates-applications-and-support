# Emirates Applications & Support

A Discord support-system bot built with **discord.js v14**. Passengers DM the
bot, pick a support type from a dropdown, and chat with staff through a relay
thread — no server access required on their end. Configured for one-click
deployment on Railway.

## How it works

1. **Intake** — A user DMs the bot anything. The bot replies with a dropdown
   menu: **General Support** or **Partnership Support**.
2. **Ticket opens** — On selection the bot creates a thread
   (`support-<username>` / `partnership-<username>`) in the staff channel,
   pings the matching roles, posts the *Emirates Customer Service Centre*
   welcome embed and the gold *Connected* embed, and relays the message that
   started the request. The user's DMs receive the same welcome embed with a
   **Close** button.
3. **Relay** — Every message staff send in the thread is relayed to the user's
   DMs, and every DM the user sends is relayed into the thread. Both directions
   use the same compact embed: author name, message content, original timestamp.
4. **Close** — Staff run `/close` inside the thread (or the user presses
   **Close** in their DMs). A green **Emirates Support Request** embed is posted
   in the thread (Passenger / Status / Ping / Message), a copy is sent to the
   user, and the thread is archived and locked. Deleting the thread also closes
   the ticket and notifies the user.

## Configuration

All configuration is via environment variables. Defaults are already baked in
for the target server — only `DISCORD_TOKEN` is required:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | — | Bot token from the Discord Developer Portal |
| `SUPPORT_CHANNEL_ID` | No | `1549096181903401130` | Staff-only channel where ticket threads are created |
| `GENERAL_ROLE_IDS` | No | `1449091238107283639,1473706134467510364` | Comma-separated roles pinged for General Support |
| `PARTNERSHIP_ROLE_IDS` | No | `1468302255181529295,1475109255945392229` | Comma-separated roles pinged for Partnership Support |
| `GUILD_ID` | No | auto-detected | Server ID; slash commands register per-guild (instant) when set, global otherwise |
| `STAFF_ROLE_ID` | No | — | Extra role allowed to use `/close` (manage-messages/thread perms always work) |
| `CLOSE_PING_ROLE_ID` | No | — | Role shown and pinged in the closing embed's *Ping* line (e.g. Executive Board) |
| `TICKETS_PATH` | No | `<project>/tickets.json` | Where the open-ticket registry is written; point into a mounted volume to persist it |

## Running locally

1. **Node 18+**, then install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`. (The bot itself
   reads plain environment variables — use `export DISCORD_TOKEN=...`, a dotenv
   wrapper, or edit the token in if you prefer.)
3. Start it:
   ```
   npm start
   ```

## Deploying on Railway

The repo ships with a `railway.json` (Nixpacks build, `npm start`, auto-restart
on failure), so Railway needs zero extra setup beyond the token.

**Option A — GitHub deploy (recommended):**
1. Railway Dashboard → **New Project** → **Deploy from GitHub repo** → pick
   this repository.
2. In the service → **Variables** → add `DISCORD_TOKEN` (everything else is
   already defaulted).
3. Deploy — Railway runs `npm install` then `npm start`. Set the `TOKEN`
   variable first or the process will exit until the token is present.

**Option B — CLI:**
```
npm install -g @railway/cli
railway login
railway init          # in this repo
railway variables --set "DISCORD_TOKEN=your-bot-token"
railway up
```

**Persistence (optional but recommended):** Railway's filesystem is ephemeral
across deploys. To keep the open-ticket registry alive, attach a **Volume**
mounted at `/data` in the service settings and set the variable
`TICKETS_PATH=/data/tickets.json`. Without it, tickets open at deploy time
stop relaying after a redeploy — close requests before deploying, or accept
the reset.

The dropdown and Close button use fixed custom IDs, so they keep working
across restarts and redeploys.

## Discord setup

1. Create the application at the [Discord Developer Portal](https://discord.com/developers/applications)
   and copy the **token**.
2. Enable the **Message Content Intent** under *Bot → Privileged Gateway
   Intents* (required to relay DM and thread messages).
3. Invite the bot with the `bot` and `applications.commands` scopes:
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=140771848309760
   ```
   (View Channel, Send Messages, Embed Links, Read Message History, Mention
   Everyone, Create Public Threads, Manage Threads.)
4. Make sure the bot can **mention** the configured staff roles — either give
   it the *Mention @everyone/@here/all roles* permission (included above) or
   mark the roles as mentionable.
5. Keep `SUPPORT_CHANNEL_ID` pointed at a staff-only channel; the ticket
   threads are public threads inside it, so channel permissions gate access.
6. Rename the bot application to something like *Emirates Utilities* to match
   the desired appearance — the display name comes from the bot's username.

## Notes

- `/close` accepts an optional `reason` that replaces the default
  "Support request closed." message in the closing embed.
- A small HTTP health server binds `PORT` (default 3000) and reports status —
  useful for host health checks; the bot itself never requires inbound access.
