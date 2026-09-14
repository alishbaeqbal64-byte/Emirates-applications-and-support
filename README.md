# Emirates Applications and Support

A Discord support bot for Emirates. A passenger messages the bot by DM, chooses General Support or Partnership Support, and receives a dedicated support thread in the configured staff channel.

## Features

- DM intake with a dropdown menu.
- Separate role pings for general and partnership requests.
- Welcome and connection embeds in the DM and support thread.
- Two-way relay: passenger messages go to the thread, and staff thread messages go back to the passenger as embeds.
- `/close [reason]` closes the request, sends a green closing embed, locks the thread, and archives it.
- Small HTTP health server for Render web services.

## Discord setup

1. Create a Discord application and bot.
2. Enable the **Message Content Intent** under Bot > Privileged Gateway Intents.
3. Invite the bot with the `bot` and `applications.commands` scopes.
4. Give it permission to view the support channel, send messages, embed links, read message history, create public threads, manage threads, and mention the configured support roles.
5. Keep the bot token in an environment variable. Never commit it to GitHub.

## Local setup

```bash
npm install
npm start
```

Copy `.env.example` to `.env` and provide `DISCORD_TOKEN` before starting. The bot reads environment variables directly; use a local environment loader or export them in your shell.

## Render deployment

Create a new Render Blueprint from this repository, or create a Node web service with:

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Add `DISCORD_TOKEN` as a secret environment variable. The channel and role IDs already have the requested defaults, but they can be overridden in Render environment variables.

Render's local filesystem is not persistent across deploys. If open tickets must survive restarts, attach a disk and set `TICKETS_PATH` to a file on that disk, such as `/data/tickets.json`.
